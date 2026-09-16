/**
 * three-tables.ts — 三表 · LastRecords 单一真相源（P0 runtime 版）
 *
 * STATION 0 解决：现有管线里有三份并行的"上章真相"：
 *   (A) 前端传的 previousChapterContent / chapterHistorySummary
 *   (B) 循环体内局部 lastChapterActualContent / lastCharacterState（每次循环后更新）
 *   (C) DB 里实际存过的 chapters
 * 三者不一致 → 会出现"宗门/人名/上章场景乱跳"。
 *
 * 本文件封装 LastRecords（最近 3 章摘要 + 状态账本 + 结尾类型队列），
 * 作为 stream 路由循环里唯一从左章到右章传值的真相源。
 *
 * P0 只做 runtime 内存版（单批生成保证一致）；P1 会把 LastRecords 落 novel.db。
 */

import type { EndingCategory } from './ending-rotator';
import type { ChapterStateLedger } from './local-quality-check';
import { removeKnownCrossBookFragments } from '@/lib/script-source-cleaner';

/** ================================================================================
 *  ChapterHardAnchor —— 跨章衔接"硬锚点"（单一真相源）
 *
 *  每章结束时从已定稿的 chapterCleanContent 计算一次，写入 LastRecordEntry.hardAnchor
 *  下一章 Station 1 Prompt 构建时直接引用此字段，避免再次临时计算导致的不一致。
 *  ================================================================================ */
export interface ChapterHardAnchor {
  /** 章末最后 1~2 句完整原文句（≤140 字，清洗空白后贴进下章 prompt） */
  finalSentences: string;
  /** 尾 350 字内命中的强状态/伤情/场景词数组（铁链、拖走、昏迷、纸条、门缝…） */
  strongKeywords: string[];
  /** 尾段实体锚点：从 finalSentences 提取的 top-6 有效 3-gram（按"前半段铺垫实体+末句实体+状态词加权"排序，去重） */
  anchorNgrams: string[];
  /** 章末场景快照：天气 / 地点 / 光线 / 室内外 / 时间（白天/深夜/凌晨），从 tailContent 关键词推断后拼接自然语言 ≤60 字 */
  sceneSnapshot: string;
  /** 章末"未完成信号"：按结尾分类 + 最后 30 字内的未闭合动作/悬念词（例：『动作切断：铁链刚套上手腕 未完成的动作=被拖走』） */
  unresolvedSignal: string;
}

/** 强状态关键词（跨文件共享版本，与 stream/route.ts STATE_STRONG_KEYWORDS 保持同步，最终合并到这里作为单一来源） */
const STRONG_KEYWORDS_SHARED = ['铁链','手腕','拖走','拖向','关押','被捕','拘留','黑暗','深处','手铐','押送','审讯','密室','囚笼','束缚','受伤','血迹','昏迷','逃脱','逃走','解救','冰凉','刺骨','监察使','脚镣','监牢','牢房','绑架','囚禁','纸条','字条','门缝','快逃','红绳','工作日志','档案','抽屉','匕首','短剑','刀','药瓶','账本','钥匙','信封','密信','令牌','玉牌','玉佩','血迹斑斑','浑身发抖','意识模糊','脚步声','敲门声','手机响','电话响','推门','枪响'];

export function buildHardAnchor(
  chapterContent: string,
  ending?: { primary: EndingCategory; isHuman: boolean } | null,
): ChapterHardAnchor {
  const full = String(chapterContent ?? '').replace(/\s+/g, ' ').trim();
  const tail = full.slice(-800);
  const tailMost = full.slice(-350);
  // ① finalSentences：最后 1~2 句完整原文句（按 。！？!?；… 切分后取末 2 句），上限 140 字
  const parts = tail.split(/(?<=[。！？!?；…])/).map(s => s.trim()).filter(Boolean);
  const last2 = parts.slice(-2).join(' ').trim();
  const finalSentences = last2.length > 140 ? last2.slice(-140) : last2;

  // ② strongKeywords：仅尾 350 字内匹配，避免远离结尾的通用词误命中
  const strongKeywords = STRONG_KEYWORDS_SHARED.filter(k => tailMost.includes(k));

  // ③ anchorNgrams：3-gram 抽取（与 stream/route.ts extractGrams3 逻辑一致）
  const STOP_ALL = '的了在是和与为从到这那他她它们也又就都还但而并及将把被向于给让使要会能可以一个上下中里前后不没有着过或等如此因为所以非乃之乎者也若则即却便既仍其实似乎或者几乎已经正在刚刚将要马上曾被就得呀呢吧啦嘛哦啊哎嘛哟呗喽啰';
  const STOP_FL = '的了在是和与为从到这那他她它们也又就都还但而并及将把被向于给让使要会能可以个上下中里前后不没有着过或等如此因为所以非若则即却便既仍';
  const gramsBase = finalSentences + tailMost.slice(0, 120);
  const clean = gramsBase.replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF0-9A-Za-z]/g, ' ');
  const joined = clean.split(/\s+/).filter(Boolean).join('');
  const freq = new Map<string, number>();
  for (let i = 0; i + 3 <= joined.length; i++) {
    const tok = joined.slice(i, i + 3);
    if (!/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(tok)) continue;
    if (/^[0-9]+$/.test(tok)) continue;
    if (/^[A-Za-z]+$/.test(tok)) continue;
    let solid = 0;
    for (const ch of tok) if (!STOP_ALL.includes(ch)) solid++;
    if (solid < 2) continue;
    if (STOP_FL.includes(tok[0]) || STOP_FL.includes(tok[2])) continue;
    let bonus = 1;
    if (strongKeywords.some(k => tok.includes(k) || k.includes(tok.slice(0, 2)) || k.includes(tok.slice(1)))) bonus += 7;
    if (finalSentences.includes(tok)) bonus += 5;
    freq.set(tok, (freq.get(tok) || 0) + bonus);
  }
  const anchorNgrams = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([tok]) => tok);

  // ④ sceneSnapshot：简单规则拼接的场景自然语言快照
  const clues: string[] = [];
  if (/深夜|夜里|深夜里|夜半|三更|子时/.test(tailMost)) clues.push('时间=深夜');
  else if (/凌晨|破晓|天刚亮|东方既白|黎明/.test(tailMost)) clues.push('时间=凌晨');
  else if (/黄昏|傍晚|夕阳|暮色|日落/.test(tailMost)) clues.push('时间=黄昏');
  else if (/正午|烈日|午后|午时/.test(tailMost)) clues.push('时间=白天/正午');
  else if (/白天|日光|阳光|上午|下午/.test(tailMost)) clues.push('时间=白天');
  if (/雨|大雨|小雨|细雨|暴雨|雨丝/.test(tailMost)) clues.push('天气=下雨');
  else if (/雪|飘雪|落雪|北风|寒风/.test(tailMost)) clues.push('天气=寒冷/下雪');
  else if (/晴|烈日|阳光/.test(tailMost)) clues.push('天气=晴');
  if (/审讯室|牢房|囚笼|密室|监牢|关押室/.test(tailMost)) clues.push('地点=封闭羁押空间');
  else if (/庙|破庙|土地庙|祠堂/.test(tailMost)) clues.push('地点=庙/祠堂');
  else if (/屋|堂屋|内室|房|屋内|屋中|房间|卧室|书房|办公室/.test(tailMost)) clues.push('地点=室内');
  else if (/街|巷|路|道|院|院子|庭院|广场|郊外|野外/.test(tailMost)) clues.push('地点=室外公共/野外空间');
  if (/月|灯|烛|烛光|月光|夜色/.test(tailMost)) clues.push('光线=昏暗/烛光/月光');
  else if (/日光|阳光|烈日|正午/.test(tailMost)) clues.push('光线=明亮');
  const sceneSnapshot = clues.length ? clues.join('；') : '未识别特定场景';

  // ⑤ unresolvedSignal：未完成信号
  const last30 = full.slice(-30);
  let signalDetail = '';
  if (ending?.primary === 'action-cut') signalDetail = '动作切断：关键动作做到一半截住';
  else if (ending?.primary === 'hook-question') signalDetail = '钩子问句：信息悬念尚未揭示';
  else if (ending?.primary === 'detail-reveal') signalDetail = '细节揭示：道具/伤情/线索刚出现，尚未延伸';
  else if (ending?.primary === 'line-dialogue') signalDetail = '台词截断：末句对白/叙述未完待续';
  else if (!ending?.isHuman) signalDetail = 'AI 模板结尾：下章需主动打破总结感、写新动作推进剧情';
  else signalDetail = '普通结尾：下章按时间/地点/新事件自然承接';
  // 补充具体的未完成动作线索（末 30 字里的强状态词）
  const tailClue = STRONG_KEYWORDS_SHARED.find(k => last30.includes(k));
  if (tailClue) signalDetail += `；结尾30字未完成线索=『${tailClue}』`;
  const unresolvedSignal = signalDetail;

  return {
    finalSentences,
    strongKeywords: Array.from(new Set(strongKeywords)),
    anchorNgrams,
    sceneSnapshot,
    unresolvedSignal,
  };
}

export interface LastRecordEntry {
  chapterNumber: number;
  title: string;
  /** 三栏摘要：开头钩子（30字）+ 中间核心事件（80字）+ 结尾钩子（50字） */
  summary: { head: string; middle: string; tail: string };
  /** 结尾 500 字原文（复述检测用） */
  tailRaw: string;
  /** 章节最终字数 */
  chars: number;
  /** 结尾类型 */
  endingCategory?: EndingCategory;
  /** 本章结尾时提取的结构化账本（下章一致性检查用） */
  ledgerTail: ChapterStateLedger;
  /** 4A 质检分（便于前端展示） */
  localFinalScore?: number;
  /** ★ 跨章衔接硬锚点（Station 1 Prompt 直接引用，避免重复计算） */
  hardAnchor?: ChapterHardAnchor;
}

export class LastRecords {
  static readonly MAX_WINDOW = 3;
  private entries: LastRecordEntry[] = [];

  constructor(initialEntries: LastRecordEntry[] = []) {
    this.entries = [...initialEntries].slice(-LastRecords.MAX_WINDOW);
  }

  /** 最近一章（= 下一章要"承接"的那章） */
  latest(): LastRecordEntry | undefined {
    if (this.entries.length === 0) return undefined;
    return this.entries[this.entries.length - 1];
  }

  /** 最近 n 章（默认 3），按章节升序返回 */
  window(n: number = LastRecords.MAX_WINDOW): LastRecordEntry[] {
    return [...this.entries].slice(-n);
  }

  /** 最近结尾类型数组（结尾轮换用） */
  endingCategories(): EndingCategory[] {
    return this.entries
      .map((e) => e.endingCategory)
      .filter((c): c is EndingCategory => !!c);
  }

  /** 把上一章作为账本（给 4A 质检用）：空的话返回空账本 */
  asLedger(protagonistName?: string): ChapterStateLedger {
    const latest = this.latest();
    if (!latest) {
      return { protagonistName };
    }
    return {
      protagonistName,
      ...latest.ledgerTail,
    };
  }

  /** 给 Prompt 组装用的自然语言"最近 3 章 LastRecords 摘要" */
  asPromptText(): string {
    if (this.entries.length === 0) return '';
    const lines = ['【最近 3 章剧情真相（LastRecords，单一真相源）】'];
    for (const e of this.window(3)) {
      lines.push(
        `- 第${e.chapterNumber}章 ${e.title || ''}：「${e.summary.head}」→「${e.summary.middle}」→「${e.summary.tail}」(字数:${e.chars})`,
      );
    }
    lines.push('—— 本章必须严格承接：最新一章的结尾账本 + 结尾状态。');
    return lines.join('\n');
  }

  /** 追加一章（自动维护窗口大小） */
  push(entry: LastRecordEntry): void {
    // 如果传入的 entry 没有 hardAnchor，自动用 tailRaw+endingCategory 兜底构建（保证跨批次/断点续传时的老记录也有硬锚点）
    if (!entry.hardAnchor && entry.tailRaw) {
      try {
        const ending = entry.endingCategory
          ? { primary: entry.endingCategory, isHuman: ['action-cut','hook-question','detail-reveal','line-dialogue'].includes(entry.endingCategory) }
          : null;
        entry = { ...entry, hardAnchor: buildHardAnchor(entry.tailRaw, ending as any) };
      } catch { /* ignore */ }
    }
    this.entries.push(entry);
    if (this.entries.length > LastRecords.MAX_WINDOW) {
      this.entries = this.entries.slice(-LastRecords.MAX_WINDOW);
    }
  }

  get length(): number {
    return this.entries.length;
  }
}

/* =========================================================
 * 把现有 extractCharacterState() 返回的"状态账本 string"解析成结构化 ChapterStateLedger
 * （兼容现有系统，不用大改 prompt 生成）
 * ========================================================= */
const LINE_REG: Partial<Record<keyof ChapterStateLedger, RegExp[]>> = {
  injuries: [/伤情[：:]\s*(.+)/],
  positionInScene: [/位置[：:]\s*(.+)/],
  holding: [/物品[：:]\s*(.+)/],
  // 时间 → daytime
  daytime: [/时间[：:]\s*(.+)/],
} as const;

/**
 * 解析 stream 路由内 extractCharacterState() 返回的那串账本文本，
 * 同时结合"上章正文原文 tail"做一些补充识别（衣着/天气/视角等）。
 */
export function buildLedgerFrom(
  characterStateString: string,
  tailContent: string,
  protagonistName?: string,
  pov: 'first' | 'third-limited' = 'first',
): ChapterStateLedger {
  const ledger: ChapterStateLedger = { protagonistName, pov, povCharacterName: protagonistName };
  const lines = (characterStateString ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const line of lines) {
    for (const key of Object.keys(LINE_REG) as Array<keyof ChapterStateLedger>) {
      for (const re of LINE_REG[key] ?? []) {
        const m = line.match(re);
        if (!m) continue;
        const raw = m[1].trim();
        switch (key) {
          case 'injuries': {
            ledger.injuries = raw.split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean);
            break;
          }
          case 'holding': {
            // 形如：手里攥着个啃了一半的窝头、怀里揣着个油布包的木匣
            ledger.holding = raw
              .split(/[、,，;；]/)
              .map((s) => s.trim())
              .filter((s) => s.length > 1);
            break;
          }
          case 'positionInScene': {
            ledger.positionInScene = raw;
            // 场景字段派生
            if (/庙|破庙|土地庙/.test(raw)) ledger.scene = '破庙';
            else if (/堂屋|堂|屋内|屋/.test(raw)) ledger.scene = '屋内';
            else if (/院|院子/.test(raw)) ledger.scene = '院子';
            else if (/街|巷|路/.test(raw)) ledger.scene = '街道';
            break;
          }
          case 'daytime': {
            ledger.daytime = raw;
            break;
          }
          default:
            break;
        }
      }
    }
  }

  // 从 tailContent 原文再补几项（衣着 / 天气 / 饿 / 持有物补充）
  // 防跨书串文：旧章尾可能含旧版切尾句/串文碎片（木匣、窝头、刀已出鞘等他书道具），
  // 先按黑名单剔除再做关键词提取，避免把他书道具/状态写进账本并喂给下一章 AI。
  const text = removeKnownCrossBookFragments(tailContent ?? '');
  // 衣着
  const outfitMatch = text.match(/(玄色短打|粗布短打|白衣|锦袍|青衫|襦裙|布衣|粗布衣衫|书生袍|华服)/);
  if (outfitMatch && !ledger.outfit) ledger.outfit = outfitMatch[1];
  // 天气
  const weatherMatch = text.match(/(阴雨|大雨|小雨|暴雨|雨丝|飘雨|下雪|寒风|烈日|晴天|月明)/);
  if (weatherMatch && !ledger.weather) ledger.weather = weatherMatch[1];
  // 饿 / 累
  if (!ledger.hungry && /饿得|饥饿|肚子.*叫|饥肠|窝头|干粮|啃.*窝头|啃.*饼/.test(text)) {
    ledger.hungry = true;
  }
  if (!ledger.tired && /累|疲惫|乏|力竭|腿沉|眼皮.*沉/.test(text)) {
    ledger.tired = true;
  }
  // 补充持有物（关键词命中）
  const extras = new Set<string>();
  for (const kw of ['窝头', '木匣', '短剑', '匕首', '刀', '铜钱', '银子', '斗笠', '包子', '干粮', '油灯']) {
    if (text.includes(kw)) extras.add(kw);
  }
  if (extras.size > 0) {
    const merged = new Set<string>(ledger.holding ?? []);
    extras.forEach((e) => merged.add(e));
    ledger.holding = Array.from(merged);
  }

  return ledger;
}

/** 把章节正文切成「开头钩子 / 中间核心 / 结尾钩子」3 栏摘要（给 LastRecords.summary 用） */
export function summarizeChapterForLedger(
  chapterContent: string,
): { head: string; middle: string; tail: string; tailRaw: string; chars: number } {
  const cleaned = (chapterContent ?? '').replace(/\s+/g, '');
  const chars = cleaned.length;
  const headRaw = cleaned.slice(0, Math.min(cleaned.length, 400));
  const tailRaw = cleaned.slice(Math.max(0, cleaned.length - 500));
  const midStart = Math.floor(cleaned.length * 0.35);
  const midRaw = cleaned.slice(midStart, midStart + 500);

  const squeeze = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n) + '…');
  return {
    head: squeeze(headRaw, 30),
    middle: squeeze(midRaw, 80),
    tail: squeeze(tailRaw, 50),
    tailRaw,
    chars,
  };
}
/* P3-3：LastRecords 跨请求持久化（chapter_pipeline_runs 表） */
const RUN_CACHE_TTL_MS = 1000 * 60 * 60 * 8;
const _runKeyMemo = new Map<string, string>();
export function stableRunKey(params: { idea?: string | Record<string, any> | null; structure?: any; novelId?: string; userId?: string }): string {
  if (params.novelId) return 'nid:' + params.novelId + (params.userId ? ':u:' + params.userId : '');
  const ideaStr = (() => {
    const v = params.idea;
    if (v == null) return '';
    if (typeof v === 'string') return v.slice(0, 200);
    try { return [v.theme, v.concept, v.category, v.genre].filter(Boolean).join(' | ').slice(0, 200); }
    catch { return JSON.stringify(v).slice(0, 200); }
  })();
  const structStr = typeof params.structure === 'string' ? params.structure.slice(0, 300) : JSON.stringify(params.structure || {}).slice(0, 300);
  const seed = [params.userId || 'anon', ideaStr, structStr].join('||');
  if (_runKeyMemo.has(seed)) return _runKeyMemo.get(seed)!;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const k = 'hash:' + (h >>> 0).toString(36);
  _runKeyMemo.set(seed, k);
  return k;
}
type DBDriver = { insert: (row: Record<string, any>) => Promise<void>; select: (runKey: string, limit: number) => Promise<any[]> };
async function getDBDriver(): Promise<DBDriver | null> {
  try {
    const sqliteMod = await import('@/storage/database/sqlite');
    const db: any = sqliteMod.getDb ? await sqliteMod.getDb() : (sqliteMod as any).default;
    const schema: any = await import('@/storage/database/shared/schema');
    const { eq, gt, and, asc } = await import('drizzle-orm');
    if (!db || !schema?.chapterPipelineRuns) return null;
    const tbl = schema.chapterPipelineRuns;
    return {
      insert: async (row) => { try { await db.insert(tbl).values(row).onConflictDoUpdate({ target: tbl.id, set: row }); } catch {} },
      select: async (runKey, limit) => {
        try { return await db.select().from(tbl).where(and(eq(tbl.runKey, runKey), gt(tbl.createdAt, new Date(Date.now() - RUN_CACHE_TTL_MS).toISOString()))).orderBy(asc(tbl.chapterNumber)).limit(limit); }
        catch { return []; }
      },
    };
  } catch { return null; }
}
export async function restoreLastRecordsFromDB(runKey: string): Promise<LastRecordEntry[]> {
  const driver = await getDBDriver();
  if (!driver) return [];
  const rows = await driver.select(runKey, LastRecords.MAX_WINDOW);
  const result: LastRecordEntry[] = [];
  for (const r of rows) {
    let ledger: any = undefined;
    try { ledger = r.ledgerTailJson ? JSON.parse(r.ledgerTailJson) : undefined; } catch {}
    let anchor: ChapterHardAnchor | undefined = undefined;
    try {
      if (r.hardAnchorJson && String(r.hardAnchorJson).trim()) {
        const parsed = JSON.parse(r.hardAnchorJson);
        if (parsed && typeof parsed === 'object') anchor = parsed as ChapterHardAnchor;
      }
    } catch {}
    result.push({
      chapterNumber: Number(r.chapterNumber), title: r.title || '',
      summary: { head: r.summaryHead || '', middle: r.summaryMiddle || '', tail: r.summaryTail || '' },
      tailRaw: r.tailRaw || '', chars: Number(r.chars || 0),
      endingCategory: (r.endingCategory as any) || undefined,
      ledgerTail: (ledger || {}) as any,
      localFinalScore: r.localFinalScore != null ? Number(r.localFinalScore) : undefined,
      hardAnchor: anchor,
    });
  }
  console.log('[LastRecords-DB] restoreFromDB runKey=' + runKey + ' rows=' + result.length);
  return result;
}
export async function snapshotLastRecordToDB(runKey: string, entry: LastRecordEntry, extras: { userId?: string } = {}): Promise<void> {
  const driver = await getDBDriver();
  if (!driver) return;
  let ledgerJson = '{}';
  try { ledgerJson = JSON.stringify(entry.ledgerTail || {}); } catch {}
  let anchorJson: string | null = null;
  try {
    if (entry.hardAnchor) anchorJson = JSON.stringify(entry.hardAnchor);
  } catch {}
  await driver.insert({
    id: runKey + ':ch:' + entry.chapterNumber, runKey, userId: extras.userId || null, chapterNumber: entry.chapterNumber,
    title: entry.title || null, summaryHead: entry.summary.head || null, summaryMiddle: entry.summary.middle || null, summaryTail: entry.summary.tail || null,
    tailRaw: entry.tailRaw || null, chars: entry.chars || 0, endingCategory: entry.endingCategory || null,
    ledgerTailJson: ledgerJson, localFinalScore: entry.localFinalScore ?? null,
    hardAnchorJson: anchorJson,
  });
}
