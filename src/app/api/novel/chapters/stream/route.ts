import { NextRequest } from 'next/server';
import { getModelName, getTemperature, getRawAIConfig } from '@/lib/ai-config';
import { getUserFromToken } from '@/lib/auth';
import { novelManager } from '@/storage/database';
import { userManager } from '@/storage/database';
import { getPromptWithFallback } from '@/lib/prompt-helper';
import { getDb } from '@/storage/database/sqlite';
import { memberLevels } from '@/storage/database/shared/schema';
import { eq } from 'drizzle-orm';
import { extractJsonObject } from '@/lib/json-parser';
import { sanitizeChapterDelta, sanitizeChapterText } from '@/lib/chapter-text-cleaner';
import { formatChapterTitle, stripChapterTitlePrefix } from '@/lib/chapter-title';
import { appendAgentSkillPrompt } from '@/lib/agent-skills';
import { buildNovelCreativeBlocks, type CreativeInjectionSpec } from '@/lib/creative-hub';
import {
  runLocalQualityCheck,
  type ChapterStateLedger,
  type LocalQualityReport,
} from '@/lib/chapter-pipeline/local-quality-check';
import {
  LastRecords,
  buildLedgerFrom,
  summarizeChapterForLedger,
  stableRunKey,
  snapshotLastRecordToDB,
  restoreLastRecordsFromDB,
} from '@/lib/chapter-pipeline/three-tables';
import { classifyEnding } from '@/lib/chapter-pipeline/ending-rotator';
import {
  runStation4B,
  type Station4BResult,
} from '@/lib/chapter-pipeline/deep-quality-client';

const TIMEOUT_MS = 360_000; // 360秒超时（推理量大的模型/中文长结构需要更宽窗口）（每章独立生成，总时间可能较长）

// ========== 跨章衔接修复（针对社畜灵媒案例：铁链拖走→突然自由身）==========
// 空话钩子检测：如果钩子全部都是空话泛词，正文生成直接回退到"用上章结尾实体开场"
const EMPTY_HOOK_PHRASES = [
  '旧关系突然反咬一口', '身边最亲近的人隐瞒关键事实', '顺藤摸瓜向核心圈推进',
  '更深的阴谋浮出水面', '真相逐渐浮出水面', '案件陷入僵局',
  '隐藏的秘密被揭开', '更大的危机正在逼近', '新的线索出现了',
  '真相变得越来越复杂', '真相远比想象中复杂', '一切都变得不一样了',
  '事情渐渐失控', '局面变得复杂', '事情变得微妙', '剧情发展',
  '故事继续', '新挑战', '新角色登场', '命运转折', '真相复杂',
  '一切才刚开始', '事情没那么简单', '带着心事入睡',
];
function isEmptyHook(hook: string): boolean {
  if (!hook) return true;
  // 命中 ≥ 1 条空话词条（哪怕只有一小段）即标记为空话钩子，交由后续"降级回退"处理
  for (const p of EMPTY_HOOK_PHRASES) {
    if (hook.includes(p)) return true;
  }
  return false;
}

// 3-gram 实体抽取（与 structure/route.ts 对齐）
function extractGrams3(text: string): Set<string> {
  const clean = String(text || '').replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF0-9A-Za-z]/g, ' ');
  const joined = clean.split(/\s+/).filter(Boolean).join('');
  const STOP_ALL = '的了在是和与为从到这那他她它们也又就都还但而并及将把被向于给让使要会能可以一个上下中里前后不没有着过或等如此因为所以非乃之乎者也若则即却便既仍其实似乎或者几乎已经正在刚刚将要马上曾被就得呀呢吧啦嘛哦啊哎嘛哟呗喽啰';
  const STOP_FL = '的了在是和与为从到这那他她它们也又就都还但而并及将把被向于给让使要会能可以个上下中里前后不没有着过或等如此因为所以非若则即却便既仍';
  const set = new Set<string>();
  for (let i = 0; i + 3 <= joined.length; i++) {
    const tok = joined.slice(i, i + 3);
    if (!/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(tok)) continue;
    if (/^[0-9]+$/.test(tok)) continue;
    if (/^[A-Za-z]+$/.test(tok)) continue;
    let solid = 0;
    for (const ch of tok) if (!STOP_ALL.includes(ch)) solid++;
    if (solid < 2) continue;
    if (STOP_FL.includes(tok[0]) || STOP_FL.includes(tok[2])) continue;
    set.add(tok);
  }
  return set;
}

// 从章节结尾提取"状态锚点"：最后 2 句 + 强状态词（铁链、拖走等）联合摘要
// ⚠️ 状态词必须命中"尾段 300 字"（避免 800 字前半段的普通词误命中）
const STATE_STRONG_KEYWORDS = ['铁链','手腕','拖走','拖向','关押','被捕','拘留','黑暗','深处','手铐','押送','审讯','密室','囚笼','束缚','受伤','血迹','昏迷','逃脱','逃走','解救','冰凉','刺骨','监察使','脚镣','监牢','牢房','绑架','囚禁','纸条','字条','门缝','快逃','红绳','工作日志','档案','抽屉'];
function extractStateAnchor(prevContent: string): { sentences: string; strong: string[] } {
  const full = String(prevContent || '');
  const tail = full.slice(-800); // 用于分词（范围不变）
  const tailMost = full.slice(-350); // ✨ 状态词只在"尾 350 字"内匹配，避免远离结尾的通用词误命中
  const parts = tail.split(/(?<=[。！？!?；…])/).filter(Boolean);
  const last2 = parts.slice(-2).join('').trim();
  const strongHits = STATE_STRONG_KEYWORDS.filter(k => tailMost.includes(k));
  return { sentences: last2, strong: Array.from(new Set(strongHits)) };
}

// 本地状态连续性校验：上章结尾状态词 vs 本章开头 500 字
// 返回 { pass, violations[] }
function checkStateContinuity(prevContent: string, curContent: string): { pass: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!prevContent || !curContent) return { pass: true, issues };
  const state = extractStateAnchor(prevContent);
  const curHead = curContent.slice(0, 600); // 本章前600字 = 开场+第一段
  // 规则1：如果上章有强状态词（≥2个），本章开头必须承接 ≥1 个 或 有"逃脱/释放/醒来/怎么到的"等过渡描写
  if (state.strong.length >= 2) {
    const picked = state.strong.filter(k => curHead.includes(k));
    const transitionWords = ['挣脱', '松开', '解开', '释放', '醒来', '发现自己', '怎么到', '逃了', '逃出', '从.*里出来', '被.*放了', '被带', '牢房', '审讯室', '关押室', '醒过来', '意识'];
    const hasTransition = transitionWords.some(w => new RegExp(w).test(curHead));
    if (picked.length === 0 && !hasTransition) {
      issues.push(`上章结尾存在强状态词 [${state.strong.join('/')}]，但本章开头没有任何承接（没有状态词也没有"逃脱/释放/醒来"等过渡描写）`);
    }
  }
  // 规则2：3-gram 实体共享（上章末2句 vs 本章前 400 字）
  const prevGrams = extractGrams3(state.sentences);
  const curGrams = extractGrams3(curContent.slice(0, 450));
  let shared = 0;
  const sharedList: string[] = [];
  for (const g of prevGrams) {
    if (curGrams.has(g)) { shared++; sharedList.push(g); }
  }
  // 如果存在强烈状态词且没有共享实体 → 强断裂
  if (state.strong.length >= 2 && shared === 0 && state.sentences.length > 20) {
    issues.push(`实体层断裂：上章结尾与本章开头 3-gram 共享实体为 0，上章关键信息 [${state.strong.join('/')}] 完全被跳过`);
  }
  return { pass: issues.length === 0, issues };
}
// ========== 跨章衔接修复 END ==========

// 计算两段文本的相似度（基于n-gram重合度，返回0-1的浮点数）
function calcTextSimilarity(textA: string, textB: string): number {
  if (!textA || !textB) return 0;
  if (textA.length < 10 || textB.length < 10) return 0;

  // 使用字符n-gram（2-gram）计算重合度
  const n = 2;
  const getNgrams = (text: string, n: number): Set<string> => {
    const normalized = text.replace(/\s+/g, ''); // 去除空白
    const grams = new Set<string>();
    for (let i = 0; i <= normalized.length - n; i++) {
      grams.add(normalized.slice(i, i + n));
    }
    return grams;
  };

  const ngramsA = getNgrams(textA, n);
  const ngramsB = getNgrams(textB, n);

  if (ngramsA.size === 0 || ngramsB.size === 0) return 0;

  // 计算交集
  let intersection = 0;
  ngramsA.forEach(g => { if (ngramsB.has(g)) intersection++; });

  // Jaccard相似度
  const unionSize = ngramsA.size + ngramsB.size - intersection;
  return unionSize > 0 ? intersection / unionSize : 0;
}
// ============ 反剧透后处理：检测并截断正文中提前出现的"下章钩子内容" ============
function cjk2grams(text: string): Set<string> {
  const s = (text || '').replace(/\s+/g, '');
  const g = new Set<string>();
  for (let i = 0; i <= s.length - 2; i++) g.add(s.slice(i, i + 2));
  return g;
}
function jaccard2(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach(x => { if (b.has(x)) inter++; });
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}
/**
 * @returns { trimmed: string; truncated: boolean; cutAtChar?: number; overlapScore: number; warnings: string[] }
 */
function detectAndTrimNextHookSpoiler(
  curText: string,
  nextHookRaw: string | null | undefined,
  chapterN: number,
  totalChapters: number,
  chapterHookText: string
): { trimmed: string; truncated: boolean; cutAtChar?: number; overlapScore: number; warnings: string[] } {
  const warnings: string[] = [];
  if (!curText || !nextHookRaw || chapterN >= totalChapters) return { trimmed: curText, truncated: false, overlapScore: 0, warnings };
  const text = curText.replace(/\s+/g, '');
  if (text.length < 200) return { trimmed: curText, truncated: false, overlapScore: 0, warnings };

  // ① 关键词命中：从 nextHook 提取 2~4 字名词短语（排除章末衔接区）
  const spoilerStartPct = 0.70; // 末尾30%视作章末衔接允许区，不截断
  const spoilerSafeStart = Math.floor(text.length * spoilerStartPct);
  const spoilableZone = text.slice(0, spoilerSafeStart);

  const hookPhrases = (nextHookRaw.match(/[一-龥A-Za-z0-9]{2,8}/g) || [])
    .filter(p => p.length >= 2 && p.length <= 8 && !/^(本章|上章|下章|第.*章|结尾|悬念|开头|剧情|钩子|人物|冲突|场景|然而|但是|于是|然后|同时|接着|终于|突然|忽然|竟然|居然|其实|因为|所以|虽然|不过)$/.test(p));
  const uniquePhrases = Array.from(new Set(hookPhrases)).slice(0, 30);
  let hitPhrase: string | null = null;
  let hitIndex = -1;
  for (const ph of uniquePhrases) {
    // 必须是下章钩子有 而 当前章钩子没有 的短语（否则属于本章应写内容）
    if (chapterHookText && chapterHookText.includes(ph)) continue;
    const idx = spoilableZone.lastIndexOf(ph);
    if (idx >= 0 && idx > hitIndex) {
      hitIndex = idx;
      hitPhrase = ph;
    }
  }

  // ② 2-gram Jaccard 滑动窗（每100字窗口）vs nextHook
  const hookGrams = cjk2grams(nextHookRaw);
  const curHookGrams = cjk2grams(chapterHookText || '');
  let windowMax = 0;
  let windowHitIdx = -1;
  const winStep = 60;
  const winSize = 120;
  for (let i = 0; i + winSize <= spoilerSafeStart; i += winStep) {
    const wg = cjk2grams(spoilableZone.slice(i, i + winSize));
    const sim = jaccard2(wg, hookGrams);
    // 扣除和当前章钩子的重合
    const curSim = jaccard2(wg, curHookGrams);
    const netSim = Math.max(0, sim - curSim * 0.5);
    if (netSim > windowMax && netSim >= 0.12) {
      windowMax = netSim;
      windowHitIdx = i + winSize;
    }
  }

  // 取两种检测中更靠前的截断点
  let cutChar = -1;
  let overlapScore = Math.max(
    hitPhrase ? 0.3 : 0,
    windowMax
  );
  if (hitIndex >= 0 && windowHitIdx >= 0) cutChar = Math.max(hitIndex, windowHitIdx);
  else if (hitIndex >= 0) cutChar = hitIndex;
  else if (windowHitIdx >= 0 && windowMax >= 0.18) cutChar = windowHitIdx;

  if (cutChar < 0) return { trimmed: curText, truncated: false, overlapScore, warnings };

  // 映射回原文位置（考虑空白被去除）—— 做一个简单的 forward mapping
  let rawIdx = 0, normIdx = 0;
  while (normIdx < cutChar && rawIdx < curText.length) {
    if (!/s/.test(curText[rawIdx])) normIdx++;
    rawIdx++;
  }
  const rawCut = rawIdx;

  // 截断到最近的句末标点（。！？！」』）之前
  const tailZone = curText.slice(Math.max(0, rawCut - 60), Math.min(curText.length, rawCut + 120));
  const punctIdx = tailZone.search(/[。！？!?」』…—]+/);
  let finalCut = rawCut;
  if (punctIdx >= 0) {
    finalCut = Math.max(0, rawCut - 60) + punctIdx + 1;
  }
  // 最小长度保护：截断后若 < 600 字则不切（宁可不切也不破坏本章完整性）
  if (finalCut < 600) {
    warnings.push('Spoiler detected but truncation would leave <600 chars; skipped. phrase=' + (hitPhrase || '-') + ' winSim=' + windowMax.toFixed(2));
    return { trimmed: curText, truncated: false, overlapScore, warnings };
  }
  warnings.push('Spoiler trimmed at char=' + finalCut + '/' + curText.length + ' phrase=' + (hitPhrase || '-') + ' winSim=' + windowMax.toFixed(2));
  console.warn('[Anti-Spoiler][Ch' + chapterN + '] 检测到剧透内容已截断：phrase=' + (hitPhrase || '-') + ' winSim=' + windowMax.toFixed(2) + ' cut=' + finalCut + '/' + curText.length);
  return { trimmed: curText.slice(0, finalCut), truncated: true, cutAtChar: finalCut, overlapScore, warnings };
}


// 从章节内容中提取人物关键状态（伤情、位置、资源等）
function extractCharacterState(content: string, characterName?: string): string {
  if (!content) return '';

  const stateLines: string[] = [];
  const text = content.toLowerCase();

  // 1. 提取伤情/伤势
  const injuryPatterns = [
    /([\u4e00-\u9fa5]+)(?:的|得)?(?:肋骨|腿|手|脚|胸|背|肩|臂|腹|头|脸|眼|牙|血|伤|骨折|断裂|撕裂|划伤|刺伤|砍伤|烧伤|烫伤|中毒|感染|化脓)/g,
    /(?:肋骨断裂|左腿.{0,6}(?:渗血|受伤|划伤|劈裂)|右腿.{0,6}(?:渗血|受伤|划伤|劈裂)|左臂.{0,6}(?:渗血|受伤|划伤)|右臂.{0,6}(?:渗血|受伤|划伤))/g,
    /(?:浑身.{0,6}(?:是血|是伤|无力)|鲜血.{0,6}(?:直流|涌出|喷涌)|伤口.{0,6}(?:流血|渗血|化脓))/g,
  ];
  for (const pattern of injuryPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      stateLines.push(`伤情：${matches.slice(0, 3).join('、')}`);
      break;
    }
  }

  // 2. 提取位置
  const locationPatterns = [
    /(?:站在|坐在|躺在|蹲在|靠在|躲在|藏在)?.{0,10}(?:(?:的|里|中|上|下|内).{0,10}(?:房间|小屋|角落|墙边|门口|窗前|屋顶|地下|密室|通道|走廊|大厅|广场|街道|巷子里|院内|室外))/g,
    /(?:在|位于).{0,15}(?:(?:房间|小屋|角落|墙边|门口|窗前|屋顶|地下|密室|通道|走廊|大厅|广场|街道|巷子|院子|楼))/g,
  ];
  for (const pattern of locationPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      // 取最后一个位置描述（最接近结尾的）
      const lastMatch = matches[matches.length - 1];
      stateLines.push(`位置：${lastMatch}`);
      break;
    }
  }

  // 3. 提取资源/道具
  const itemPatterns = [
    /(?:手里|手中|手上|腰间|怀里|口袋里|背包里|储物袋里).{0,15}(?:(?:拿着|握着|攥着|紧握着|抱着|夹着|揣着).{0,20})?/g,
    /(?:获得|得到|捡到|发现|缴获|夺取).{0,15}(?:(?:碎片|铁片|武器|道具|宝物|碎片|芯片|零件|装备|物品))/g,
  ];
  for (const pattern of itemPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      stateLines.push(`物品：${matches.slice(-2).join('、')}`);
      break;
    }
  }

  // 4. 提取情绪状态
  const emotionPatterns = [
    /(?:情绪|心情|神情|面色|表情).{0,10}(?:(?:紧张|焦虑|恐惧|愤怒|悲伤|绝望|兴奋|震惊|疑惑|警惕|放松|释然))/g,
    /(?:(?:紧张|焦虑|恐惧|愤怒|悲伤|绝望|兴奋|震惊|疑惑|警惕|放松|释然))的?(?:心情|神情|面色|表情)/g,
    /(?:心跳|呼吸|颤抖|哆嗦|发凉|发麻|发烫).{0,5}(?:(?:加速|急促|剧烈|不稳|不规则))?/g,
  ];
  for (const pattern of emotionPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      stateLines.push(`情绪：${matches.slice(-2).join('、')}`);
      break;
    }
  }

  // 5. 提取战斗状态
  const battlePatterns = [
    /(?:(?:战斗|搏斗|厮杀|激战|交锋|打斗).{0,10}(?:(?:结束|结束了|结束后|告一段落|告一段落之后)))/g,
    /(?:(?:刺|砍|劈|斩|射|投|挥|打|击).{0,5}(?:(?:向|出|下|过去|出去)).{0,10}(?:(?:倒下|倒地|惨叫|死亡|受伤|败北)))/g,
  ];
  for (const pattern of battlePatterns) {
    const matches = content.match(pattern);
    if (matches) {
      stateLines.push(`战斗状态：${matches.slice(-1).join('、')}`);
      break;
    }
  }

  // 6. 提取时间状态
  const timePatterns = [
    /(?:(?:这时|此时|此刻|忽然|突然|顷刻|瞬间).{0,10}(?:(?:天色|时间|时辰|时分)))/g,
    /(?:(?:夜深|深夜|凌晨|破晓|天明|黄昏|暮色|夜幕|天亮|日落).{0,5}(?:(?:时分|时刻|之后|前后))?)/g,
  ];
  for (const pattern of timePatterns) {
    const matches = content.match(pattern);
    if (matches) {
      stateLines.push(`时间：${matches.slice(-1).join('、')}`);
      break;
    }
  }

  if (stateLines.length === 0) return '';
  return `【上一章人物状态账本（本章必须严格遵守，绝对禁止矛盾）】\n${stateLines.join('\n')}`;
}

async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number }): Promise<Response> {
  const { timeout = TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...fetchOptions, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

export async function POST(request: NextRequest) {
  // 创建AbortController，支持用户主动取消
  const abortController = new AbortController();
  request.signal.addEventListener('abort', () => {
    console.log('[Stream] Client disconnected, aborting generation');
  });

  try {
    const body = await request.json();
    const { idea, structure, tone, genderTarget, narrativePerspective, protagonistName, supportingCharacterName, batchStart = 1, batchSize = 5, configId, previousChapterContent = '', previousChapterTitle = '', chapterHistorySummary = '', existingTitles = [], useCustomPrompt = false, customSystemPrompt = '', novelId = '', creativeHub } = body;

    // 检查用户登录状态和章节限制（游客模式跳过）
    const authHeader = request.headers.get('Authorization');
    const payload = getUserFromToken(authHeader || '');
    
    if (payload) {
      // 登录用户，检查章节限制
      const user = await userManager.getUserById(payload.userId);
      if (user) {
        // 获取用户会员等级的章节上限
        // 优先级：用户单独设置 > 会员等级设置 > 免费用户默认11章
        let chapterLimit = user.chapterLimit !== null && user.chapterLimit !== undefined
          ? user.chapterLimit
          : null;
        if (chapterLimit === null && user.memberLevelId) {
          const db = await getDb();
          const levelsResult = await db.select().from(memberLevels).where(eq(memberLevels.id, user.memberLevelId)).limit(1);
          chapterLimit = levelsResult[0]?.chapterLimit ?? 11;
        } else if (chapterLimit === null) {
          chapterLimit = 11;
        }
        const currentChapters = await novelManager.getUserTotalChapters(payload.userId);
        const requestedChapters = batchSize || 1;
        
        // chapterLimit === 0 表示无限制，跳过检查
        if (chapterLimit > 0 && currentChapters + requestedChapters > chapterLimit) {
          const remaining = Math.max(0, chapterLimit - currentChapters);
          return new Response(
            JSON.stringify({
              error: `您的会员等级最多只能生成 ${chapterLimit} 章，当前已有 ${currentChapters} 章，剩余 ${remaining} 章可生成`
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    }
    // 游客模式：不检查章节限制，直接生成

    if (!idea || !structure) {
      return new Response(
        '主题创意和结构分析信息不完整',
        { status: 400 }
      );
    }

    const modelName = await getModelName(configId);
    const temperature = await getTemperature(configId, 0.65);
    const { apiUrl, apiKey, provider } = await getRawAIConfig(configId);

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API密钥未配置，请先在"API设置"中配置有效的AI接口密钥' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    console.log(`[Chapters/Stream] Using provider: ${provider}, model: ${modelName}`);

    // 直接 fetch 流式调用，明确设置 max_tokens=16384，避免 SDK 默认 4096 导致章节截断
    // 关键：设置 reasoning_effort='none' 禁用推理模式，防止AI输出思考内容被过滤后产生空章节
    async function* streamWithMaxTokens(
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
      temp: number,
      maxTokens = 16384
    ) {
      const resp = await fetchWithTimeout(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: modelName,
          messages,
          stream: true,
          temperature: temp,
          max_tokens: maxTokens,
          reasoning_effort: 'none',
        }),
        timeout: TIMEOUT_MS,
      });
      if (!resp.ok || !resp.body) throw new Error(`AI 接口错误: ${resp.status}`);
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') return;
          try {
            const j = JSON.parse(raw);
            const c = j.choices?.[0]?.delta?.content;
            const rc = j.choices?.[0]?.delta?.reasoning_content;
            // 优先输出实际内容，过滤推理思考内容
            if (c !== undefined && c !== null) yield { content: c };
            else if (rc !== undefined && rc !== null) {
              // reasoning_content 直接跳过，不作为正文输出
            }
          } catch {}
        }
      }
    }
    
    // 性别方向说明
    const genderTargetName = genderTarget === 'male' ? '男频' : '女频';
    const genderGuide = genderTarget === 'male' 
      ? `【男频创作指南】
- 主角通常是男性，强调热血、成长、升级、打脸、兄弟情
- 情节节奏快，爽点密集，注重实力提升和对抗
- 配角多为兄弟、对手、美女角色
- 情感线相对简单，多是后宫或单一女主
- 强调"从弱变强"、"逆袭翻盘"、"征服挑战"等主题`
      : `【女频创作指南】
- 主角通常是女性，强调情感、细腻、成长、爱情
- 情节节奏相对较慢，注重情感描写和心理刻画
- 配角多为闺蜜、情敌、男主、男配
- 情感线复杂细腻，多重情感纠葛和内心戏
- 强调"情感救赎"、"自我成长"、"命中注定"等主题`;

    // 叙事视角说明
    const perspectiveMap: Record<string, { name: string; guide: string; rules: string }> = {
      'first-person': {
        name: '第一人称',
        guide: '以"我"来叙述',
        rules: `【第一人称叙事铁律】
- 全文只能用"我"作为叙述主体，所有信息和感受必须通过"我"的五官和判断传递
- ❌ 绝对禁止：写"我"不在场的事情、写他人的心理活动、写"我"不知道的信息
- ❌ 绝对禁止：使用"他心想""她暗自决定""他们不知道的是"等第三人称心理描写
- ✅ 正确做法：通过"我"的观察来推断他人——"他的眼神闪了闪，我猜他没说实话""她的手在发抖，看得出她很害怕"
- ✅ 正确做法：用"我"的感知替代上帝视角——"我听见隔壁传来争吵声""我注意到他的手指在发抖"
- 对话中可以借他人之口传递信息，但叙述视角必须始终锁定在"我"`
      },
      'third-limited': {
        name: '第三人称限制',
        guide: '用"他/她"称呼主角，视角锁定主角',
        rules: `【第三人称限制叙事铁律】
- 用"他/她"称呼主角，但视角始终锁定在主角身上
- ✅ 可以写：主角的所见所闻所想、主角观察到的他人行为
- ❌ 绝对禁止：切换到其他角色的心理活动——"李明心想""王芳暗自决定"都是违规
- ❌ 绝对禁止：写主角不知道的事情或不在场的事件
- ✅ 正确做法：通过主角的观察来呈现——"他看到她的手在发抖""从她躲闪的眼神中，他读出了什么"`
      },
      'third-omniscient': {
        name: '第三人称全知',
        guide: '上帝视角，可自由切换任何角色视角',
        rules: `【第三人称全知叙事铁律】
- 上帝视角，可以自由切换到任何角色的心理和视角
- ✅ 可以写：任何角色的心理活动、任何地点正在发生的事情
- ✅ 视角切换：可以在不同角色之间切换，展示多线叙事
- ⚠️ 切换规则：每次视角切换必须有明确的场景过渡（换段/换节），不能在同一段落内频繁切换
- ⚠️ 停留规则：每个视角至少停留1-2段，让读者"住进去"再切
- ✅ 适合：群像戏、权谋文、多线叙事、需要展示全局信息的故事`
      },
      'second-person': {
        name: '第二人称',
        guide: '用"你"来叙述，把读者拉进故事',
        rules: `【第二人称叙事铁律】
- 全文用"你"来叙述，让读者成为故事参与者
- ✅ 写法："你推开门，看见了那个不该出现的人""你的手心开始冒汗"
- ❌ 绝对禁止：突然切换到"他"或"我"的叙述视角，造成人称混乱
- ❌ 绝对禁止：让"你"变成旁观者——"你看着他做XX"，而应该是"你做了XX"
- ✅ 正确做法：每一段都要让"你"有感觉、有选择、有反应
- ✅ 适合：恐怖、悬疑、互动叙事等需要极强代入感的题材`
      }
    };
    const perspectiveInfo = perspectiveMap[narrativePerspective || 'third-omniscient'] || perspectiveMap['third-omniscient'];
    const perspectiveGuide = `【叙事视角：${perspectiveInfo.name}】${perspectiveInfo.guide}`;
    const agentContext = {
      genre: idea?.genre || idea?.category,
      tone,
      genderTarget,
      theme: idea?.theme,
      concept: idea?.concept,
      setting: idea?.setting,
      text: [
        idea?.theme,
        idea?.concept,
        idea?.characters,
        idea?.supportingCharacters,
        idea?.characterRelationships,
        idea?.setting,
        structure?.mainPlot,
        structure?.keyConflicts,
        structure?.keyScenes,
        structure?.keyItems,
      ].filter(Boolean).join('\n'),
    };

    const encoder = new TextEncoder();

    // 计算批次范围
    const totalChapters = structure.chapterHooks.length;
    const startChapter = batchStart;
    const endChapter = Math.min(startChapter + batchSize - 1, totalChapters);

    // 获取当前批次的章节钩子
    const currentBatchHooks = (structure?.chapterHooks || []).slice(startChapter - 1, endChapter);

    // ========== ★ 创意源泉注入：爆款题材+情绪G点+四步呼吸法+人设名场面（逐章正文层）==========
    const creativeSpec: CreativeInjectionSpec = (creativeHub && typeof creativeHub === 'object') ? creativeHub : {};
    creativeSpec.targetEpisodes = creativeSpec.targetEpisodes || totalChapters;
    const creativeBlocks = buildNovelCreativeBlocks(creativeSpec);
    const creativeChapterSys = creativeBlocks.chapterSystemAddon;
    const creativeChapterUser = creativeBlocks.chapterUserContext;
    console.log('[Stream] Creative hub injection:', creativeBlocks.humanReadableSummary);

    // 从钩子中提炼标题的正则方法，作为 fallback
    const extractTitleFromHook = (hookText: string): string => {
      if (!hookText) return '';

      const dePatterns = [
        /([^\s，。！？、；：]{2,4})的([^\s，。！？、；：]{2,4})的/g,
        /([^\s，。！？、；：]{2,4})的([^\s，。！？、；：]{2,4})/g,
      ];
      for (const pattern of dePatterns) {
        const m = pattern.exec(hookText);
        if (m) {
          const combined = m[1] + m[2];
          const len = [...combined].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x7f ? 1 : 0.5), 0);
          if (len >= 5 && len <= 10) return combined;
          const part2Len = [...m[2]].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x7f ? 1 : 0.5), 0);
          if (part2Len >= 3 && part2Len <= 8) return m[2];
        }
      }

      const clauses = hookText.split(/[，。！？、；：\s]+/).filter(c => c.length >= 2);
      const coreWords: string[] = [];
      for (const clause of clauses) {
        const cleaned = clause
          .replace(/^(于是|然后|但是|可是|虽然|然而|因此|所以|他|她|它|他们)/, '')
          .replace(/(之后|以前|时候|地方|起来|出来|下去|起来)/, '');
        if (cleaned.length >= 2 && cleaned.length <= 6) {
          coreWords.push(cleaned);
        } else if (cleaned.length > 6) {
          coreWords.push(cleaned.slice(0, 2));
          coreWords.push(cleaned.slice(-2));
        }
      }

      if (coreWords.length >= 2) {
        const combined = coreWords.slice(0, 2).join('');
        const len = [...combined].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x7f ? 1 : 0.5), 0);
        if (len >= 5 && len <= 10) return combined;
        if (len > 10) return combined.slice(0, 8);
      }
      if (coreWords.length >= 3) {
        const combined = coreWords[0] + coreWords[2];
        const len = [...combined].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x7f ? 1 : 0.5), 0);
        if (len >= 5 && len <= 10) return combined;
      }
      if (coreWords.length >= 1) {
        const single = coreWords[0];
        if (single.length >= 5) return single.slice(0, 8);
      }

      const first8 = hookText.replace(/\s/g, '').slice(0, 8);
      const first8Len = [...first8].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x7f ? 1 : 0.5), 0);
      if (first8Len >= 5) return first8;

      return '';
    };

    // AI 批量生成章节标题（在流开始前调用）
    const aiGeneratedTitles: Record<number, string> = {};
    try {
      const hooksForAI = currentBatchHooks.map((hook: string, index: number) => ({
        chapterNum: startChapter + index,
        hook: hook,
      }));

      // 收集所有已生成的标题，用于去重
      const existingTitleSet = new Set<string>();
      if (existingTitles && Array.isArray(existingTitles)) {
        existingTitles.forEach((t: { title: string }) => {
          if (t?.title) existingTitleSet.add(stripChapterTitlePrefix(t.title));
        });
      }

      const titleSystemPrompt = await getPromptWithFallback('chapter-title-system', `你是一位资深小说编辑，擅长为章节提炼富有文学性和吸引力的标题。
规则：
1. 根据每章钩子对应的故事情节，生成能概括该章核心事件/冲突/意象的标题
2. 标题长度4-14个中文字符（以准确概括情节为准，可长可短）
3. 标题要有画面感和文学性，能引发读者好奇
4. 只输出标题本体：严禁带"第X章/第X集"等序号前缀，严禁带冒号，不要使用引号、书名号等标点符号
5. 标题要体现该章的核心冲突、转折或意象
6. 避免空洞抽象（如"命运的转折""新的开始"），要具体有画面感
7. 严禁与已生成的章节标题重复，每个标题必须独一无二
8. 输出严格JSON格式：{"titles": {"1": "标题1", "2": "标题2", ...}}，key是章节序号字符串
示例：{"titles":{"1":"纸条","2":"洞口","3":"日记"}}`, {
        ...agentContext,
        text: [agentContext.text, currentBatchHooks.join('\n')].filter(Boolean).join('\n'),
      });

      const existingTitlesText = existingTitleSet.size > 0 
        ? `\n\n⚠️ 以下标题已经使用，严禁重复或使用相似标题：\n${Array.from(existingTitleSet).map(t => `- ${t}`).join('\n')}` 
        : '';

      const titleUserPrompt = `请为以下章节钩子生成标题：

${hooksForAI.map((h: { chapterNum: number; hook: string }) => `第${h.chapterNum}章钩子：${h.hook}`).join('\n')}

题材：${idea.genre || idea.theme || ''}
核心设定：${idea.setting || ''}
${existingTitlesText}

请输出JSON格式：{"titles": {"${startChapter}": "标题", "${startChapter + 1}": "标题", ...}}`;

      const titleMessages = [
        { role: 'system' as const, content: titleSystemPrompt },
        { role: 'user' as const, content: titleUserPrompt },
      ];

      const titleStream = streamWithMaxTokens(titleMessages, 0.5, 4096);

      let titleFullText = '';
      for await (const chunk of titleStream) {
        if (chunk.content) {
          titleFullText += chunk.content.toString();
        }
      }

      const titleResult = extractJsonObject<Record<string, Record<string, string>>>(titleFullText, ['titles']);
      if (titleResult?.titles) {
        // 收集本批次已生成的标题，用于去重检查
        const batchTitleSet = new Set<string>();
        
        for (const [numStr, title] of Object.entries(titleResult.titles)) {
          const num = parseInt(numStr);
          if (!isNaN(num) && num >= startChapter && num <= endChapter && typeof title === 'string' && title.trim()) {
            const trimmedTitle = title.trim();
            
            // 检查是否与已有标题重复
            const isDuplicate = existingTitleSet.has(trimmedTitle) || batchTitleSet.has(trimmedTitle);
            
            if (isDuplicate) {
              // 标题重复，生成一个变体
              console.log(`[Stream] Title "${trimmedTitle}" is duplicate, generating variant`);
              // 添加章节序号作为后缀以确保唯一性
              const variantTitle = `${trimmedTitle}·${num}`;
              aiGeneratedTitles[num] = variantTitle;
              batchTitleSet.add(variantTitle);
            } else {
              aiGeneratedTitles[num] = trimmedTitle;
              batchTitleSet.add(trimmedTitle);
            }
          }
        }
      }
      console.log(`[Stream] AI generated titles: ${JSON.stringify(aiGeneratedTitles)}`);
    } catch (error) {
      console.error('[Stream] AI title generation failed, using fallback:', error);
    }

    // 生成章节标题：优先使用AI生成的标题，回退到正则提取
    const generateTitleFromHook = (chapterNum: number): string => {
      const ai = aiGeneratedTitles[chapterNum];
      if (ai) return formatChapterTitle(chapterNum, ai);
      const hook = structure.chapterHooks?.[chapterNum - 1] || '';
      const title = hook ? extractTitleFromHook(hook) : '';
      return formatChapterTitle(chapterNum, title);
    };
    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        // 控制器状态追踪
        let isControllerClosed = false;
        // 记录已完成的章节索引（防止重复生成）
        const completedChapters = new Set<number>();

        // [断点续传] 每章定稿后立刻写回 novels.chapters（幂等覆盖），断连后可从 novelId 续传
        const resolvedNovelId = String(novelId || '').trim();
        let saveInFlight = Promise.resolve();
        const saveChapterSnapshotToNovel = (chNum: number, chTitle: string, chContent: string, userId: string | undefined, opts?: { passed?: boolean }) => {
          if (!resolvedNovelId || !userId) return;
          if (!chContent) return;
          const passed = opts?.passed ?? false;
          saveInFlight = saveInFlight.catch(() => {}).then(async () => {
            try {
              const existing = await novelManager.getById(resolvedNovelId);
              const prevChapters: Array<{ index?: number; title: string; content: string }> =
                Array.isArray(existing?.chapters) ? existing.chapters as any : [];
              const next = [...prevChapters];
              const idx = next.findIndex((c) => (c.index ?? 0) === chNum);
              const clean = sanitizeChapterText(chContent);
              if (idx >= 0) {
                next[idx] = { ...(next[idx] || {}), index: chNum, title: chTitle || next[idx].title || formatChapterTitle(chNum), content: clean };
              } else {
                next.push({ index: chNum, title: chTitle || formatChapterTitle(chNum), content: clean });
              }
              next.sort((a,b) => (a.index ?? 0) - (b.index ?? 0));
              const currentCount = next.filter(c => c && typeof c.content === 'string' && c.content.length > 200).length;
              const totalCount = existing?.totalChapters ?? next.length;
              const newStatus: string = passed && currentCount >= totalCount ? 'completed' : 'generating';
              await novelManager.update(resolvedNovelId, userId, {
                chapters: next as any,
                currentChapters: currentCount,
                status: newStatus,
                totalChapters: totalCount,
              } as any);
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'chapter_saved', chapter: chNum, chars: clean.length, passed, novelId: resolvedNovelId, status: newStatus, currentChapters: currentCount })}\n\n`));
              console.log('[Stream][Save] Ch' + chNum + ' saved chars=' + clean.length + ' passed=' + passed + ' status=' + newStatus);
            } catch (e) {
              // 保存失败只打日志，不阻塞生成主流程
              console.warn('[Stream][Save] Ch' + chNum + ' 落库失败（不阻塞生成）：', e instanceof Error ? e.message : e);
            }
          });
        };

        // 安全的enqueue函数，检查控制器状态并捕获所有错误
        const safeEnqueue = (data: Uint8Array): boolean => {
          if (isControllerClosed) {
            return false;
          }
          try {
            controller.enqueue(data);
            return true;
          } catch (error) {
            console.error('[Stream] Error in enqueue:', error);
            isControllerClosed = true;
            return false;
          }
        };

        // 发送错误消息并关闭流
        const sendErrorAndClose = (errorMessage: string) => {
          if (!isControllerClosed) {
            try {
              safeEnqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: 'error', message: errorMessage })}\n\n`
                )
              );
            } catch (e) {
              console.error('[Stream] Failed to send error message:', e);
            }
            isControllerClosed = true;
            try {
              controller.close();
            } catch (e) {
              console.error('[Stream] Failed to close controller:', e);
            }
          }
        };

        try {
          // 发送批次信息
          safeEnqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'batch_info',
                batchStart: startChapter,
                batchEnd: endChapter,
                totalChapters: totalChapters,
                batchSize: currentBatchHooks.length,
                isFirstBatch: startChapter === 1,
                isLastBatch: endChapter === totalChapters,
              })}\n\n`
            )
          );

          // 阶段心跳 1/5：加载写作 prompt（SSE 保活 + 前端可显示详细进度）
          if (!safeEnqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'progress', stage: 'load_prompt', message: '加载写作提示词…' })}\n\n`
          ))) throw new Error('SSE 连接已关闭 (load_prompt)');

          // 如果用户启用了自定义模板且提供了自定义提示词，使用自定义的；否则使用数据库中的系统提示词
          const chapterAgentContext = {
            ...agentContext,
            text: [
              agentContext.text,
              currentBatchHooks.join('\n'),
              previousChapterContent,
            ].filter(Boolean).join('\n'),
          };
          const baseSystemPrompt = useCustomPrompt && customSystemPrompt
            ? appendAgentSkillPrompt('chapter-stream-system', customSystemPrompt, chapterAgentContext)
            : await getPromptWithFallback('chapter-stream-system', `你是一位浸淫创作多年、作品沉淀了烟火气的真人作家。你的写作逻辑不是"制造爽点"，而是"讲一个值得讲的故事"。你相信文字的力量在于真实——真实的情绪、真实的细节、真实的留白。

【核心创作理念——真人才有的写作直觉】

## 一、语言要有体温
- 句子不必"完美"，可以有轻微的口语化、联想式表达
- 允许适度的"不完美感"：碎片化心理描写、情绪留白、生活化细节
- 避免AI式的"逻辑过度严密""语言过于规整""无多余情绪铺垫"
- 拒绝套话、空话和模板化句式，像你伏案写作时的自然流露
- 贴合真人写作中偶尔的联想式表达，不刻意追求"完美闭环"

## 二、每章结尾——这是重中之重
**绝对禁止AI式结尾**：禁止总结本章内容、强行升华主题、刻意留下"明显悬念"、用固定句式收尾。遵循真人作家的结尾逻辑，采用以下方式（交替使用）：

① **场景留白式**：结尾停留在具体场景或细微动作上，无总结、无刻意悬念，只呈现画面感
  示例："她把那封皱巴巴的信塞进抽屉最深处，指尖蹭过木柜的纹路，窗外的雨还没停"

② **情绪余韵式**：结尾聚焦人物的细微情绪、心理波动，不直白点破
  示例："他握着那枚旧纽扣，指腹反复摩挲，直到掌心发潮，竟没发现眼眶已经发热"

③ **戛然而止式**：在情节推进的关键节点自然收尾，不刻意强调"后续"
  示例："门被推开的瞬间，他看清了来人的脸，所有的话都堵在了喉咙里"

④ **细节呼应式**：结尾呼应本章前文的某个小细节（物品、动作、一句话），形成细腻的闭环
  示例："她端起桌上的凉茶，抿了一口，还是和去年夏天一样的味道，只是身边再没人陪她吐槽茶太苦"

## 三、开篇要有画面感
- 开头300-500字要有画面感和情绪铺垫，拒绝生硬切入
- 用具体场景带读者进入故事，而不是干巴巴交代背景
- "阳光透过窗帘的缝隙落在她手背上，她盯着那道细长的光斑发呆"——这是真人写作
- 而非AI式的"李明是一个普通的上班族，每天早上8点起床"——这是机械填表

## 四、章节推进逻辑——真人作家"边构思边推进"
把每章分成3-5个中段节点，每个节点是"创作思路"而非"固定话术"：
- **第一段**：开篇快速承接上章，1-2句话带入场景，展开核心事件
- **第二段**：矛盾浮现或情绪堆积，主角面临选择或困境
- **第三段**：转折或剧变，剧情自然推进
- **第四段**：结尾收束，选一种真人化收尾方式，自然停笔

## 五、对话要像真人说话
- 对话符合人物性格，有口头禅、有语气起伏
- 拒绝AI式的"过于规整、无情绪波动"的对话
- 让人物的话里有潜台词，有没说出口的东西

## 六、情绪的表达方式
- 情绪靠细节传递，不靠直白描述
- "他眼眶红了"比"他很伤心"强一百倍
- "她攥紧拳头，指甲掐进肉里"比"她很愤怒"有画面感
- 允许轻微的"跑题式细节"——一个无关紧要的小动作、一句闲话，让人物更鲜活

## 七、风格基调融合
${Array.isArray(tone) && tone.length > 0 ? `当前基调：${tone.join('、')}` : ''}
- 语言风格贴合题材（现实题材用生活化口语，悬疑题材用克制的叙述，言情题材用细腻的情绪描写）
- 基调体现在情节和细节中，而不是空话

## 八、完整性与篇幅
- **篇幅**：每章正文严格控制在 1000-1800 字之间（不足说明情节没展开，超出说明冗余）
- ⚠️ **必须写到章节自然结束点，绝对不允许在句子中间或段落中间截断输出**
- **在 1000-1800 字内把本章核心情节写完整、写出钩子**：严禁注水、堆砌形容、重复叙述
- 严禁压缩情节、严禁"略过"式概述、严禁草率收尾

## 九、写作流程
### 步骤一：列本章3句剧情大纲
1. **本章发生啥**：本章核心事件是什么？
2. **遇到啥**：主角遇到什么阻碍或转折？
3. **结尾落在哪**：用哪种真人化方式收尾？

### 步骤二：按思路动笔
按四段结构自然书写，允许适量细节冗余（贴合真人写作习惯）

### 步骤三：结尾自然收束
选一种真人化结尾方式，不拖剧情凑字数，在自然节点果断收笔，**必须写完最后一句才停笔**

### 步骤四：通读微调
写完通读全章，确保：情节完整、语言自然、结尾不做作、没有AI痕迹

## 十、禁忌清单（必须遵守）
❌ 禁止以下行为：
- 结尾强行总结本章核心（如"本章主要讲述了…""综上所述…"）
- 结尾刻意引导（如"下一章更精彩""未完待续"）
- 语言过于华丽空洞
- 人物行为逻辑过于完美、缺乏人性瑕疵
- 细节缺乏生活化气息
- 套用固定模板句式
- 每句话都紧扣主线（允许适度游离的细节）

【人物命名铁律 - 绝对禁止使用以下AI烂大街名字】
❌ 禁止男性名：叶辰、林辰、楚辰、夜宸、江辰、墨渊、墨尘、墨寒、墨枭、墨辞、萧逸、萧珩、萧烬、萧玄、萧辰、顾言琛、顾夜寒、顾云深、顾临川、顾景琛、陆沉渊、陆知衍、陆廷川、陆星辞、陆泽言、沈寂、沈砚、沈聿、沈辞、沈亦臻、凌夜、凌骁、凌宸、凌烬、凌玄、厉霆骁、厉烬言、厉司寒、厉夜珩、厉泽渊、傅斯年、傅景深、傅夜辞、傅云宸、傅聿白、云澈、玄澈、苍珩、冥夜、君夜、陈默
❌ 禁止女性名：苏晚、苏清鸢、苏念、苏瑶、苏汐、温阮、温瑜、温舒然、温知夏、温晚卿、洛璃、洛汐、洛烟、洛清欢、洛知予、云舒、云绾、云瑶、云晚、云汐月、许念、许知意、许清禾、许绾宁、许悠然、白芷、白若溪、白灵汐、白慕颜、白清瑶、叶绾绾、叶知微、叶晚柠、叶灵萱、叶清寒、唐知予、唐慕晚、唐沁柔、唐云汐、唐舒颜、宁汐、宁晚、宁知鸢、宁清瑶、宁绾柔、夏晚晴、夏知柠、夏灵玥、慕晚、林语嫣
✅ 必须使用真实、生活化、有烟火气的名字，像你身边真实存在的人名

${perspectiveInfo.rules}

- 题材：${idea.genre}
- 核心设定：${idea.setting}
- 主要人物：${idea.characters}
${idea.supportingCharacters ? `- 配角设定：${idea.supportingCharacters}` : ''}
${idea.characterRelationships ? `- 角色关系体系：${idea.characterRelationships}` : ''}
- 剧情框架：${structure.mainPlot}
- 关键场景：${structure.keyScenes || "详见结构"}
- 关键物品：${structure.keyItems || "详见结构"}

【章节连贯性 - 最重要，违反即废稿】
- 每一章都必须在整体框架内创作，不能偏离主题创意和结构分析
- 开头必须承接上一章结尾的人物状态和情绪（用1-2句简短过渡，严禁复述上一章完整剧情）
- 严禁跨章重复演绎：上一章已发生的事件、对白、动作，本章绝对禁止重写或改写
- 结尾选一种真人化收尾方式，自然停笔
- 每章只聚焦一条核心剧情线
- 严格遵循章节钩子展开，钩子是每章的核心任务
- 人物行为必须符合角色关系体系和性格设定
- 剧情推进必须遵循mainPlot的总体框架方向
- 关键冲突、关键场景、关键物品要在对应章节中自然融入

## 十、冲突阶梯递进——让冲突不断升级
- 每个关键冲突不是"出现-消失"的，而是必须**贯穿多个章节、层层升级**
- 冲突的三个递进层次：①对立建立→②矛盾深化→③高潮爆发
- 当某个冲突不在本章"主场"时，也要用1-2句细节维持其存在感（如对手的阴影、内心的一闪念、旁人的提醒）
- ❌ 禁止冲突"断崖式消失"：第2章建立了冲突，第3-8章完全不提，第9章突然爆发——这叫断裂
- ✅ 正确做法：即使本章不聚焦此冲突，也要让读者感觉到这条暗线在涌动

## 十一、关键场景氛围渲染——场景要有画面感
- 每个关键场景必须有**独特氛围标签**：时辰、天气、光线、气味、声音
- 同一场景不同章节出现时，氛围要**随剧情推进而变化**（如矿洞：第1章阴森压抑→第10章血腥疯狂）
- 关键场景的5感描写至少覆盖3感（视觉+听觉+触觉/嗅觉/味觉之一）
- 场景氛围要为剧情服务：压抑场景配沉重氛围，爆发场景配炽烈氛围

【输出格式】
直接输出正文内容，不要写"第X章"标题行，不要任何开场白。篇幅1000-1800 字，写完整本章全部情节，必须写到章节自然结束点，严禁截断，严禁提前收尾。

⚠️ 铁律：直接开始正文，不写章节序号、不写标题、不写"好的"等任何开场白。`, chapterAgentContext);

          const systemPrompt = `${baseSystemPrompt}

${creativeChapterSys}

【最终输出硬规则 - 优先级最高】
- 只输出小说正文，禁止输出任何代码、JSON、Markdown、XML、HTML、数组、对象、字段名或调试标记。
- 禁止输出 entity / people / place / item / scene 等内部实体标签，禁止输出 □entity□[...]□、<entity>...</entity> 之类标注。
- Agent Skills 只作为写作规则内化使用，不得把技能说明、分析标签、数据结构、字段名写进正文。
- 若需要记录人物、地点、物品关系，只能转化为自然中文叙事。`;

          const userPrompt = `【创作任务】
目标读者：${genderTargetName}
${genderGuide}
${perspectiveGuide}
${protagonistName && protagonistName.trim() ? `主角名字：${protagonistName}（全文统一使用此名字）` : ''}
${supportingCharacterName && supportingCharacterName.trim() ? `配角名字：${supportingCharacterName}（如有多个用逗号分隔，在章节中合理安排这些配角出场）` : ''}

【核心设定】
- 主题：${idea.theme}
- 创意：${idea.concept}
- 人物：${idea.characters}
${idea.supportingCharacters ? `- 配角：${idea.supportingCharacters}` : ''}
${idea.characterRelationships ? `- 角色关系：${idea.characterRelationships}` : ''}
- 世界观：${idea.setting}

【情节框架 - 必须严格遵循】
主线剧情：${structure.mainPlot}
${structure.keyConflicts ? `关键冲突：${structure.keyConflicts}` : ''}
${structure.keyScenes ? `关键场景：${structure.keyScenes}` : ''}
${structure.keyItems ? `关键物品：${structure.keyItems}` : ''}

【章节序列定位 - 只告诉你章节在全书中的位置，绝不泄露未来章钩子原文】
${structure.chapterHooks.map((_hook: string, i: number) => {
  const num = i + 1;
  if (num >= startChapter && num <= endChapter) return `▶ 第${num}章：—— 正在创作`;
  if (num < startChapter) return `  第${num}章：—— 已完成`;
  return `  第${num}章：—— 未创作（内容严格保密，不可窥探）`;
}).join('\n')}
（共${structure.chapterHooks.length}章）
⚠️ 【铁律】未来章钩子你无权查看，任何关于第${endChapter + 1}章及以后的剧情细节均属未知，严禁臆测或提前写出！

${previousChapterContent ? `【上一章已发生内容 - 仅供参考状态，严禁重复演绎】
上一章标题：第${startChapter - 1}章 ${previousChapterTitle || ''}
上一章结尾状态（⚠️ 以下事件已完整发生，本章绝对禁止重写或改写！）：
${previousChapterContent.slice(-300)}

🚫 严禁复述或重演上一章的任何动作、对白、场景变化
✅ 本章必须从上述事件**结束之后**开始新剧情推进` : `【开篇章节】第1章需建立世界观、引入主角、开启冲突，紧扣第1章钩子。`}

【章节任务】
创作第${startChapter}至${endChapter}章，共${currentBatchHooks.length}章：

${currentBatchHooks.map((hook: string, index: number) => {
  const chNum = startChapter + index;
  const prevHook = chNum > 1 ? structure.chapterHooks[chNum - 2] : null;
  const isLast = chNum === structure.chapterHooks.length;
  return `【第${chNum}章】
钩子：${hook}${prevHook ? `\n上章钩子（已完成，仅用于承接参考）：${prevHook}` : ''}${!isLast ? `\n下章预告：本章结尾仅用1-3句场景化引子自然铺垫下一章开头场景，严禁提前展开下一章具体剧情` : `\n【最后一章】解决核心冲突，完成人物成长弧，给出有力结局`}
→ 严格按本章钩子展开剧情，绝对禁止跨章写出第${chNum + 1}章及以后的具体剧情（标题由系统自动生成，你不需要写标题）`;
}).join('\n\n')}

${endChapter === structure.chapterHooks.length ? `【结局】这是最后几章，需解决冲突、完成人物成长、给故事圆满结局。` : ''}

【写作要求（严格遵循）】
1. **框架红线**：每章必须在整体框架内创作，紧扣主线剧情方向，不偏离不跑题
2. **连贯红线**：开头1-2句简短过渡承接上章人物状态，然后立即推进新剧情，**严禁复述上一章已发生的任何事件**
3. **钩子红线**：严格遵循章节钩子展开，钩子是每章的核心任务，不能偏移
4. **篇幅红线**：每章1000-1800 字，完整展开本章全部情节；写完后立即核验情节是否完整、字数是否达标
5. **冲突递进红线**：每章至少推进1条关键冲突（哪怕只用1-2句维持暗线存在感），禁止冲突"断崖式消失"
6. **场景氛围红线**：关键场景必须有独特氛围（时辰/天气/光线/气味），场景氛围要随剧情变化
7. 剧情结构：开场过渡→钩子核心事件推进→冲突递进→小转折→结尾留下一章伏笔
8. 精简多余心理碎碎念、重复景物描写、无用灌水对话
9. 结尾卡点利落，自然埋下与下一章钩子呼应的伏笔
10. 文风贴合网文阅读节奏，段落简短易读
11. **🚫 跨章重复禁令**：绝对禁止将上一章已完整演绎的场景、对白、动作在本章重写或改写后重现
12. **🚫 同章内桥段复演禁令**：同一章之内，已经写过的 10 秒级剧情桥段（例如："追债人离开后→回到摊位→撬锁→四只海獭闯入→海獭开口"）绝对不能再写一遍；哪怕换人称/换视角/换对白外壳也不行。
13. **🚫 同一章叙事视角(POV)锁死**：本章开头一旦用了"第一人称(我/咱/俺)"或"第三人称(他/她/主角名字)"，整章从第一段到最后一段必须保持一致，**严禁在同一段或同一章中间出现"纪凡赛尔……"前一句、后一句突然变成"我站在烂摊子前…"这种人称漂移**。若发生漂移，属于重大事故级错误。
14. **✅ 新剧情推进要求**：每写完一个桥段(≈4句/80字)，立刻推进一步剧情（人物位置/关系/道具/情绪/线索五者之一必须变化），禁止原地打转或"场景 A → 场景 A 第二遍"

${creativeChapterUser}

请开始创作：`;

          // 逐章顺序生成：每章独立调用AI，彻底解决截断和不连贯问题
          // - 每章有独立的 token 预算，不会被其他章节占用导致截断
          // - 每章拿到上一章的真实输出内容作为上下文，保证连贯
          // - 维护人物状态账本，确保跨章状态一致
          // ============= STATION 0：三表初始化（LAST_RECORDS 单一真相源）P0+P1 ==============
          const narrativePOV: 'first' | 'third-limited' =
            narrativePerspective?.includes?.('第三') || narrativePerspective?.includes?.('第三人称')
              ? 'third-limited'
              : 'first';
          const resolvedUserId = (typeof payload === 'object' && payload && (payload as any).userId) ? String((payload as any).userId) : undefined;
          const runKeyLR = stableRunKey({ idea, structure, userId: resolvedUserId });
          const restoredFromDB = await restoreLastRecordsFromDB(runKeyLR);
          const lastRecords = new LastRecords(restoredFromDB.length ? restoredFromDB : undefined);
          // 仅当 DB 恢复结果为空时，才用 previousChapterContent 再塞一次（避免窗口被重复覆盖）
          const dbRestoredChCount = restoredFromDB.length;
          let lastRecordsInitialized = dbRestoredChCount > 0 ? true : false;
          if (!lastRecordsInitialized && previousChapterContent) {
            const prevSummary = summarizeChapterForLedger(previousChapterContent);
            const prevStateStr = extractCharacterState(previousChapterContent, protagonistName);
            const prevLedger = buildLedgerFrom(prevStateStr, prevSummary.tailRaw, protagonistName, narrativePOV);
            const prevEnding = classifyEnding(previousChapterContent);
            lastRecords.push({
              chapterNumber: startChapter - 1,
              title: previousChapterTitle || '',
              summary: { head: prevSummary.head, middle: prevSummary.middle, tail: prevSummary.tail },
              tailRaw: prevSummary.tailRaw,
              chars: prevSummary.chars,
              endingCategory: prevEnding.primary,
              ledgerTail: prevLedger,
            });
            const initParts = ['[Pipeline-ST0] ch=' + (startChapter - 1),
              'scene=' + (prevLedger.scene || '-'),
              'outfit=' + (prevLedger.outfit || '-'),
              'injuries=' + (prevLedger.injuries || []).length,
              'holding=' + (prevLedger.holding || []).length];
            console.log(initParts.join(' | '));
          }
          let lastChapterActualContent = previousChapterContent;
          let lastChapterActualTitle = previousChapterTitle;
          let lastCharacterState = previousChapterContent
            ? extractCharacterState(previousChapterContent, protagonistName)
            : '';
          let pipelineBulkBreak = false;
          let pipelinePassedChapters = 0;
          // P1 追踪：最近 1 章 deepFinalScore（complete 事件带 lastDeepFinalScore 给前端）
          let lastDeepFinalScore: number | null = null;

          // 阶段心跳 2/5：三表账本初始化 + 进入章节循环
          if (!safeEnqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'progress', stage: 'init_ledger', message: '初始化跨章账本…' })}\n\n`
          ))) throw new Error('SSE 连接已关闭 (init_ledger)');

          for (let chNum = startChapter; chNum <= endChapter; chNum++) {
            if (isControllerClosed) break;

            const hook = structure.chapterHooks[chNum - 1];
            const prevHook = chNum > 1 ? structure.chapterHooks[chNum - 2] : null;
            const nextHook = chNum < structure.chapterHooks.length ? structure.chapterHooks[chNum] : null;
            const chTitle = generateTitleFromHook(chNum);
            const hookWindow = structure.chapterHooks
              .map((item: string, idx: number) => ({ num: idx + 1, hook: item }))
              .filter((item: { num: number; hook: string }) => item.num >= Math.max(1, chNum - 1) && item.num <= chNum)
              .map((item: { num: number; hook: string }) => {
                if (item.num === chNum) return `▶ 第${item.num}章：${item.hook}（当前章·核心任务·必须100%展开·不可偏移）`;
                return `  第${item.num}章：${item.hook}（已完成·仅用于承接上章人物状态）`;
              })
              .concat(chNum < structure.chapterHooks.length ? ['  第' + (chNum + 1) + '章：———具体内容不提供·本章结尾仅需用1-3句场景化引子衔接开头场景·严禁展开下章具体剧情'] : [])
              .join('\n');

            // 发送章节开始事件
            if (!safeEnqueue(encoder.encode(
              `data: ${JSON.stringify({ type: 'chapter_start', chapter: chNum, title: chTitle })}\n\n`
            ))) break;
            // 阶段心跳 3/5：调用 AI 生成正文前保活
            if (!safeEnqueue(encoder.encode(
              `data: ${JSON.stringify({ type: 'progress', stage: 'generate_ch', chapter: chNum, message: '第'+chNum+'章：正在请求 AI 正文…' })}\n\n`
            ))) throw new Error('SSE 连接已关闭 (generate_ch.'+chNum+')');
            // 构建单章 prompt：聚焦当前章，带入上章真实内容
            const perChapterUserPrompt = [
              `目标读者：${genderTargetName}`,
              genderGuide,
              perspectiveGuide,
              protagonistName?.trim() ? `主角名字：${protagonistName}（全文统一使用此名字）` : '',
              supportingCharacterName?.trim() ? `配角名字：${supportingCharacterName}（在章节中合理安排出场）` : '',
              '',
              '【小说核心设定】',
              `主题：${idea.theme}`,
              `创意：${idea.concept}`,
              `主线剧情：${structure.mainPlot}`,
              `人物：${idea.characters}`,
              idea.supportingCharacters ? `配角：${idea.supportingCharacters}` : '',
              idea.characterRelationships ? `角色关系：${idea.characterRelationships}` : '',
              `世界观：${idea.setting}`,
              structure.keyConflicts ? `关键冲突（持续推进，禁止断崖消失）：${structure.keyConflicts}` : '',
              structure.keyScenes ? `关键场景：${structure.keyScenes}` : '',
              structure.keyItems ? `关键物品：${structure.keyItems}` : '',
              '',
              // 注入完整的章节历史摘要，确保跨批次连贯性
              chapterHistorySummary || '',
              '',
              `【本章在全书中的位置】第${chNum}/${structure.chapterHooks.length}章`,
              hookWindow,
              '',
              // ===== 跨章衔接修复：状态锚点硬注入 + 空话钩子回退 =====
              (() => {
                // ① 空话钩子检测
                const hookEmpty = isEmptyHook(hook);
                return hookEmpty
                  ? `【钩子降级提示】本章钩子经检测为空话泛化钩子（缺少可落地的具体场景/实体），下面的"上章结尾状态锚点"替代钩子作为本章开场的**第一优先级约束**，钩子仅作参考。`
                  : '';
              })(),
              lastChapterActualContent
                ? (() => {
                    const stateAnchor = extractStateAnchor(lastChapterActualContent);
                    const stateBlock = stateAnchor.strong.length
                      ? `上章结尾关键状态词（必须承接或写出过渡）：${stateAnchor.strong.join('、')}`
                      : '';
                    const hookEmpty = isEmptyHook(hook);
                    return `【上一章已发生内容（仅供理解人物当前状态，严禁重复演绎或改写以下任何内容！）】
第${chNum - 1}章《${lastChapterActualTitle || ''}》剧情摘要（⚠️ 以下事件已经完整发生过，本章绝对禁止重写、复述或换说法重复！）：
${lastChapterActualContent.slice(-500)}

🚫 严格禁令：
1. 禁止以任何形式重写或改写上一章已发生的动作、对白、场景变化
2. 禁止用"话说""且说""回忆""上次说到"等方式复述上一章内容
3. 本章必须从上述事件**结束之后**立即推进新剧情
4. 开头用1-2句简短过渡句带过上章状态，然后立刻进入本章核心任务
5. 人物的位置、伤情、持有物品等状态必须与上一章结尾保持一致
6. ${hookEmpty ? '【空话钩子模式·铁律】本章钩子为空话泛词，开头前300字必须优先承接上述"上章结尾状态锚点"，严禁直接跳过状态写新剧情！' : ''}
${stateBlock ? `

【🔴 上章结尾状态锚点·本章开头必须承接·高优先级】
上章结尾最后 2 句：${stateAnchor.sentences}
${stateBlock}
⚠️ 本章开头前 300 字内必须出现：要么出现上述状态词之一，要么用"挣脱/解开/醒来/发现自己在/从XX里出来/被带/牢房/审讯室"等过渡描写，说明人物如何从此状态进入本章剧情。
⚠️ 绝对禁止硬跳：如上章写被铁链拖走关押，本章不能一开头就自由地坐在办公室查资料（必须有释放/逃脱/押解等过渡）。` : ''}

✅ 正确做法示例：
- 上章结尾："他手中握着铁片，身体涌动异样力量" → 本章开头："陈大牛低头看着手心泛着微光的铁片，没敢马上动弹"（承接状态，不重演）
- 上章结尾："铁链套上了她的手腕，她被拖向黑暗深处" → 本章开头："铁链的冰凉仍刻在手腕上，云小汐在颠簸中睁开眼——这是一间没有窗的审讯室"（承接状态词+写出过渡）
- ❌ 错误做法："话说陈大牛那天在废铁堆发现了一块碎片..."（复述上章剧情）
- ❌ 错误做法：上章结尾被拖走，本章开头直接写"第二天她坐在办公室查资料"（硬跳状态、无任何过渡）`;
                  })()
                : '【第一章】建立世界观，引入主角，开启故事冲突，紧扣第1章钩子。',
              '',
              // 注入人物状态账本（跨章状态一致性硬约束）
              lastCharacterState
                ? `${lastCharacterState}
⚠️ 本章必须严格遵守以上状态，绝对禁止出现矛盾（如上章说肋骨断裂，本章不能突然说左腿受伤；如上章说某角色在某处，本章不能说他不在）`
                : '',
              '',
              prevHook ? `上章钩子（已完成，承接参考）：${prevHook}` : '',
              '',
              `【第${chNum}章核心任务 - 必须严格执行】`,
              hook,
              '',
              chNum < structure.chapterHooks.length
                ? `【伏笔铁律】本章结尾仅用1-3句场景化引子自然衔接到下一章开头场景（例如时间/地点/气氛/一个未接的电话/一扇刚推开的门），严禁写出下一章的具体人物动作、对白、剧情事件、冲突内容。绝对禁止提前展开第${chNum + 1}章的具体钩子情节。`
                : '【这是全书最后一章】解决核心冲突，完成人物成长弧，给出有力结局。',
              '',
              '【写作要求】',
              '1. 开头1-2句简短过渡承接上章人物状态和情绪，然后立即推进新剧情',
              '2. 严格按本章钩子展开核心剧情，钩子是本章核心任务，100%内容服务于本章钩子，绝不偏移',
              '3. 篇幅1000-1800 字，完整展开本章全部情节，必须写到自然结束点、严禁截断',
              '4. 结尾选一种真人化方式收束（场景留白/情绪余韵/戛然而止/细节呼应）',
              '5. 🚫 禁剧透未来章：本章只写本章钩子要求的剧情范围，结尾仅用1-3句场景化引子衔接下一章开头场景（如时间推移/地点切换/门被推开/电话响起等），绝对禁止写出下一章及以后的具体剧情、对白、冲突、人物动作细节',
              '6. 🚫 绝对禁止在本章提前展开"下一章钩子"里提到的任何具体事件或对白，未来章对本章作者而言完全未知',
              '7. 每章至少用1-2句维持一条关键冲突的暗线存在感，禁止冲突断崖消失',
              '8. 🚫 严禁复述或重演上一章已完整演绎的任何场景、对白、动作',
              '9. 🔒 人物状态一致性：严格遵守上一章的伤情/位置/物品/情绪状态，禁止出现矛盾',
              '',
              `直接输出第${chNum}章正文，不要写"第${chNum}章"标题行，不要任何开场白：`,
            ].filter(Boolean).join('\n');

            const chapterMessages = [
              { role: 'system' as const, content: systemPrompt },
              { role: 'user' as const, content: perChapterUserPrompt },
            ];

            // 单章 token 预算 8192，支持1500-3000字中文内容
            const chapterStream = streamWithMaxTokens(chapterMessages, temperature, 16384);
            let chapterRawContent = '';
            let chapterCleanContent = '';
            let chapterSentLength = 0;
            let inThinkingCh = false;

            for await (const chunk of chapterStream) {
              if (isControllerClosed) break;
              // null/undefined 也要处理，不能跳过
              const content = chunk.content ?? '';
              if (!content) continue;

              let text = content.toString();

              // 过滤思考标签
              if (inThinkingCh) {
                const endIdx = text.indexOf('</think');
                if (endIdx !== -1) {
                  text = text.substring(text.indexOf('>', endIdx) + 1);
                  inThinkingCh = false;
                } else {
                  continue;
                }
              }
              const thinkStart = text.indexOf('<think');
              if (thinkStart !== -1) {
                const thinkEnd = text.indexOf('</think', thinkStart);
                if (thinkEnd !== -1) {
                  text = text.substring(0, thinkStart) + text.substring(text.indexOf('>', thinkEnd) + 1);
                } else {
                  text = text.substring(0, thinkStart);
                  inThinkingCh = true;
                }
              }

              chapterRawContent += text;
              const cleanedResult = sanitizeChapterDelta(chapterRawContent, chapterSentLength, true);
              chapterCleanContent = cleanedResult.cleanText;
              chapterSentLength = cleanedResult.sentLength;
              text = cleanedResult.delta;

              if (!text.trim()) continue;
              const sent = safeEnqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'content', chapter: chNum, content: text })}\n\n`
              ));
              if (!sent) {
                console.log(`[Stream] Chapter ${chNum} content send failed, breaking`);
                break;
              }
              // 调试日志：每100个字符记录一次
              if (chapterSentLength % 100 < text.length) {
                console.log(`[Stream] Chapter ${chNum} sent ${chapterSentLength} chars`);
              }
            }

            // 章节结束
            if (!isControllerClosed) {
              safeEnqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'chapter_end', chapter: chNum })}\n\n`
              ));
              console.log(`[Stream] Chapter ${chNum} done, chars: ${chapterCleanContent.length}`);
            }

            // [P7-D] 流式期间跳过 AI 模板尾拦截（避免每 delta 乱切尾）。此处一次性定稿清理，再进 4A/4B 质检：
              chapterCleanContent = sanitizeChapterText(chapterCleanContent, false, {
                protagonistName,
                thirdPerson: narrativePOV === 'third-limited',
              });

              // [Anti-Spoiler] 反剧透后处理：若正文在"章末30%允许区之前"提前写出下章钩子的具体内容，自动截断
              const spoilerResult = detectAndTrimNextHookSpoiler(chapterCleanContent, nextHook, chNum, structure.chapterHooks.length, hook);
              if (spoilerResult.truncated) {
                chapterCleanContent = spoilerResult.trimmed;
                chapterSentLength = chapterCleanContent.length;
                safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'spoiler_truncated', chapter: chNum, cutAtChar: spoilerResult.cutAtChar ?? null, overlapScore: Math.round(spoilerResult.overlapScore * 100), warnings: spoilerResult.warnings ?? [], message: '检测到下章钩子内容已提前出现在本章正文非衔接区，已自动截断到句末标点' })}\n\n`));
              }

              // 阶段心跳 4/5：正文生成完毕，进入 4A 质检 / 重复检测 / 4B 深审
            if (!safeEnqueue(encoder.encode(
              `data: ${JSON.stringify({ type: 'progress', stage: 'quality_check', chapter: chNum, message: '第'+chNum+'章：进入 4A 质检…' })}\n\n`
            ))) throw new Error('SSE 连接已关闭 (quality_check.'+chNum+')');

            // 🚫 跨章重复检测：对比上一章结尾与本章开头的相似度
            if (lastChapterActualContent && !isControllerClosed) {
              const prevEnd = lastChapterActualContent.slice(-300);
              const curStart = chapterCleanContent.slice(0, 300);
              const similarity = calcTextSimilarity(prevEnd, curStart);
              
              // 降低阈值到0.45，更敏感地检测重复
              if (similarity > 0.45) {
                console.warn(`[Stream] Chapter ${chNum} repetition detected! Similarity: ${(similarity * 100).toFixed(1)}%`);
                
                // 发送重复检测警告
                safeEnqueue(encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'repetition_warning',
                    chapter: chNum,
                    similarity: Math.round(similarity * 100),
                    message: `检测到与上一章结尾内容重复度达${(similarity * 100).toFixed(0)}%，已在后续章节生成中加入去重指令`,
                  })}\n\n`
                ));

                // 在传递给下一章的内容前添加去重标记
                // 重新生成当前章节（仅1次重试）
                console.log(`[Stream] Attempting regeneration for chapter ${chNum} due to repetition`);
                
                // 重新构建prompt，明确指出重复问题
                const retryPrompt = [
                  `目标读者：${genderTargetName}`,
                  '',
                  '【🔴 上一章结尾内容（当前本章开头与此高度重复，必须彻底规避！）】',
                  prevEnd,
                  '',
                  '【警告】上一章结尾已经完整演绎了上述事件，你生成的开头内容与此高度重复。',
                  '本章必须从上述事件**完全结束之后**开始，绝对禁止重写任何已发生的动作、对白、场景。',
                  '',
                  `【第${chNum}章核心任务 - 必须严格执行】`,
                  hook,
                  '',
                  `直接重新输出第${chNum}章正文：`,
                ].join('\n');

                // 重试生成
                const retryMessages = [
                  { role: 'system' as const, content: systemPrompt },
                  { role: 'user' as const, content: retryPrompt },
                ];

                const retryStream = streamWithMaxTokens(retryMessages, temperature, 16384);
                let retryContent = '';
                let retrySentLength = 0;

                for await (const chunk of retryStream) {
                  if (isControllerClosed) break;
                  const content = chunk.content ?? '';
                  if (!content) continue;

                  let text = content.toString();
                  retryContent += text;
                  const cleanedResult = sanitizeChapterDelta(retryContent, retrySentLength, true);
                  retrySentLength = cleanedResult.sentLength;

                  if (!safeEnqueue(encoder.encode(
                    `data: ${JSON.stringify({ type: 'content', chapter: chNum, content: cleanedResult.delta })}\n\n`
                  ))) break;
                }

                if (!isControllerClosed) {
                  safeEnqueue(encoder.encode(
                    `data: ${JSON.stringify({
                      type: 'regeneration_done',
                      chapter: chNum,
                      chars: retrySentLength,
                    })}\n\n`
                  ));
                  console.log(`[Stream] Chapter ${chNum} regenerated, chars: ${retrySentLength}`);
                }

                chapterCleanContent = retryContent;
                chapterSentLength = retrySentLength;
              }
            }

            // ============= 跨章衔接修复：状态连续性本地校验（Ch2→Ch3铁链拖走→办公室硬跳的终极防线）=============
            let stateContinuityPassed = !lastChapterActualContent;
            if (lastChapterActualContent && !isControllerClosed && chapterCleanContent.length > 300) {
              const stateCheck = checkStateContinuity(lastChapterActualContent, chapterCleanContent);
              if (!stateCheck.pass) {
                console.warn(`[StateContinuity] Chapter ${chNum} 检测到状态硬断裂！issues=${JSON.stringify(stateCheck.issues)}`);
                safeEnqueue(encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'state_continuity_warning',
                    chapter: chNum,
                    issues: stateCheck.issues,
                    message: `检测到与上章的状态断裂：${stateCheck.issues[0]}，正在自动重写本章开头…`,
                  })}\n\n`
                ));

                // 仅 1 次重试：用上章的状态锚点 + 明确过渡场景要求，重建 prompt
                const prevState = extractStateAnchor(lastChapterActualContent);
                const forcedTransitionPrompt = [
                  `目标读者：${genderTargetName}`,
                  perspectiveGuide,
                  protagonistName?.trim() ? `主角名字：${protagonistName}` : '',
                  supportingCharacterName?.trim() ? `配角名字：${supportingCharacterName}` : '',
                  '',
                  '【🔴 上章结尾状态锚点·必须承接·违反直接废稿】',
                  `上章最后 2 句：${prevState.sentences}`,
                  prevState.strong.length ? `关键状态词：${prevState.strong.join('、')}` : '',
                  '',
                  '【绝对禁止】',
                  '- 禁止直接跳过状态写新剧情：如果上章写主角被铁链拖走关押，本章开头绝对不能直接写"第二天在办公室查资料"',
                  '- 禁止"时间跳变魔法"：不能"第二天/三天后"就直接恢复自由身，必须给出释放/逃脱/押解/醒转等过渡过程',
                  '',
                  '【✅ 强制要求·本章开头前 300 字】',
                  prevState.strong.length
                    ? `开头必须先承接状态词 [${prevState.strong.join('/')}]，通过以下任意一种方式进入本章剧情：` +
                      `\n  a) 描写角色仍处于该状态下的场景（例："铁链硌得手腕生疼，云小汐发现自己被关在一间审讯室里"）` +
                      `\n  b) 写状态的解脱与过渡（例："当冰凉的铁链终于从手腕松开，云小汐被推搡着带进一间狭小的档案室"）` +
                      `\n  c) 写醒来/意识恢复等视角转折（例："铁链的冰凉像一场未醒的噩梦，云小汐猛地睁开眼——但手铐仍牢牢扣在手腕上"）`
                    : '开头承接上章结尾最后 2 句描写的状态，1-2 句过渡后立即进入本章核心剧情',
                  '',
                  '【写作红线】严禁复述上一章已发生的完整剧情；严禁用"话说、且说、回忆"起笔；开头必须写新的行动/新的场景（承接状态后的下一步），不是回顾。',
                  '',
                  `【第${chNum}章核心任务】`,
                  hook,
                  '',
                  `直接输出第${chNum}章正文（篇幅1000-1800字，写完整本章情节，结尾留钩子），不要写章节序号、标题、任何开场白：`,
                ].filter(Boolean).join('\n');

                const retryStream = streamWithMaxTokens(
                  [{ role: 'system' as const, content: systemPrompt }, { role: 'user' as const, content: forcedTransitionPrompt }],
                  temperature, 16384
                );
                let retryContent = '';
                let retryClean = '';
                let retryLen = 0;
                for await (const chunk of retryStream) {
                  if (isControllerClosed) break;
                  const t = chunk.content ?? '';
                  if (!t) continue;
                  retryContent += t;
                  const res = sanitizeChapterDelta(retryContent, retryLen, true);
                  retryLen = res.sentLength;
                  retryClean = res.cleanText;
                  if (res.delta.trim()) {
                    safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', chapter: chNum, content: res.delta })}\n\n`));
                  }
                }
                chapterCleanContent = retryClean;
                chapterSentLength = retryLen;
                console.log(`[StateContinuity] Chapter ${chNum} 已重建，新开头：${chapterCleanContent.slice(0, 80)}`);
                safeEnqueue(encoder.encode(
                  `data: ${JSON.stringify({ type: 'regeneration_done', chapter: chNum, chars: chapterSentLength, reason: 'state_continuity_fix' })}\n\n`
                ));
              } else {
                stateContinuityPassed = true;
              }
            }
            if (lastChapterActualContent && stateContinuityPassed) {
              console.log(`[StateContinuity] Chapter ${chNum} 状态连续性校验通过 ✅`);
            }

            // ============= STATION 4A：本地 5 栏分质检（P0）=============
            let localScoreAttempts = 0;
            const MAX_LOCAL_RETRY = 2;
            let localReport: LocalQualityReport | null = null;
            while (localScoreAttempts <= MAX_LOCAL_RETRY && !isControllerClosed) {
              const latest = lastRecords.latest();
              const prevTailRaw = latest ? latest.tailRaw : '';
              const recentEndings = lastRecords.endingCategories();
              const ledger = latest
                ? lastRecords.asLedger(protagonistName)
                : ({ protagonistName, pov: narrativePOV, povCharacterName: protagonistName } as ChapterStateLedger);
              localReport = runLocalQualityCheck({
                chapterNumber: chNum,
                chapterContent: chapterCleanContent,
                ledger,
                previousChapterTail: prevTailRaw,
                recentEndingCategories: recentEndings,
                // ★ 创意源泉·热度评估上下文
                chapterHook: hook,
                totalChapters,
                characterKeywords: [protagonistName, supportingCharacterName].filter(Boolean).flatMap((s) => (s || '').split(/[,，、\s]+/).filter(Boolean)),
                creativeHubSummary: creativeBlocks.humanReadableSummary,
              });
              const col = localReport.columns;
              const st4aLog = '[Pipeline-ST4A] Ch' + chNum +
                ' attempt=' + (localScoreAttempts + 1) +
                ' score=' + localReport.finalScore +
                ' pass=' + localReport.pass +
                ' hard=' + localReport.hardContradiction +
                ' | C=' + col.consistencyScore + '/30' +
                ' D=' + col.dedupScore + '/15' +
                ' Cl=' + col.clicheScore + '/15' +
                ' P=' + col.povScore + '/20' +
                ' E=' + col.endingScore + '/20' +
                ' cd=' + localReport.aiClicheDensity.toFixed(1) + '‰';
              console.log(st4aLog);
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'local_quality', chapter: chNum, attempt: localScoreAttempts + 1, finalScore: localReport.finalScore, pass: localReport.pass, hardContradiction: localReport.hardContradiction, columns: localReport.columns, issueCount: localReport.issues.length, aiClicheDensity: localReport.aiClicheDensity, issuesHead: (localReport.issues || []).slice(0, 6).map((i) => ({ id: i.id, level: i.level, title: i.title, penalty: i.penalty })), marketHotness: localReport.marketHotness ? { total: localReport.marketHotness.total, grade: localReport.marketHotness.grade, dimension: localReport.marketHotness.dimension, creativeSupplementTips: localReport.marketHotness.creativeSupplementTips.slice(0, 8) } : undefined })}\n\n`));
              if (localReport.pass) break;
              if (localScoreAttempts >= MAX_LOCAL_RETRY) break;
              localScoreAttempts += 1;
              console.log('[Pipeline-ST4A-Retry] Ch' + chNum + ' #' + localScoreAttempts);
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'local_regeneration_start', chapter: chNum, attempt: localScoreAttempts, reason: 'LOCAL_SCORE=' + localReport.finalScore + '/100 ISSUE#=' + localReport.issues.length + ' HARD=' + localReport.hardContradiction })}\n\n`));
              const retryPrompt = [
                '目标读者：' + genderTargetName,
                '',
                '【🔴 FAILURE_REPORT · 本地 5 栏分质检未通过】',
                localReport.failureReport,
                '',
                '【第' + chNum + '章核心任务（仍需执行）】',
                hook,
                '',
                nextHook ? '⚠️ 严禁剧透下一章：本章结尾仅用1-3句场景化引子衔接下一章开头场景，绝对禁止写出下章具体剧情' : '',
                '',
                '直接重新输出完整第' + chNum + '章正文（不要写标题，不要任何说明）：',
              ].filter(Boolean).join('\n');
              const retryMessages = [
                { role: 'system' as const, content: systemPrompt },
                { role: 'user' as const, content: retryPrompt },
              ];
              const retryStream = streamWithMaxTokens(retryMessages, temperature, 16384);
              let retryRaw = '';
              let retrySent = 0;
              for await (const chunk of retryStream) {
                if (isControllerClosed) break;
                const chunkText = chunk.content ?? '';
                if (!chunkText) continue;
                retryRaw += chunkText.toString();
                const cleaned = sanitizeChapterDelta(retryRaw, retrySent, true);
                const delta = cleaned.delta;
                retrySent = cleaned.sentLength;
                chapterCleanContent = cleaned.cleanText;
                chapterSentLength = retrySent;
                if (!delta.trim()) continue;
                safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', chapter: chNum, content: delta })}\n\n`));
              }
              if (!isControllerClosed) safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'regeneration_done', chapter: chNum, chars: retrySent })}\n\n`));
            }

            // 防御：while 循环若因 isControllerClosed 前置为 true 而一次未进，localReport 仍为 null → 安全中断
            if (!localReport) {
              console.warn('[Pipeline-ST4A] Ch' + chNum + ' 4A while 循环未执行，controller 可能已提前关闭；跳过后续流水线');
              pipelineBulkBreak = true;
              break;
            }
            const finalLocal = localReport;
            let deep4b: Station4BResult | null = null;
            if (finalLocal.pass && !isControllerClosed) {
              const latest4b = lastRecords.latest();
              const prevRaw4b = latest4b ? latest4b.tailRaw : '';
              const recent4b = lastRecords.endingCategories();
              const ledger4b = latest4b
                ? lastRecords.asLedger(protagonistName)
                : ({ protagonistName, pov: narrativePOV, povCharacterName: protagonistName } as ChapterStateLedger);
              // 4A ≥ 95 分时跳过 4B（强信任本地检），减少 LLM 调用成本
              const skip4b = finalLocal.finalScore >= 95 && finalLocal.issues.length === 0;
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'deep_quality_start', chapter: chNum, skip: skip4b, reason: skip4b ? '本地满分跳过4B' : '调用4B深度审' })}\n\n`));
              if (!skip4b) {
                deep4b = await runStation4B({
                  configId,
                  idea,
                  structure,
                  tone,
                  genderTarget,
                  narrativePerspective,
                  chapter: { index: chNum, title: chTitle, content: chapterCleanContent },
                  previousChapter: latest4b ? { index: latest4b.chapterNumber, title: latest4b.title, content: latest4b.tailRaw } : undefined,
                  nextChapter: nextHook ? undefined : undefined,
                  chapterHook: hook,
                  previousHook: (prevHook ?? undefined),
                  nextHook: (nextHook ?? undefined),
                  previousChapterTail: prevRaw4b,
                  ledger: ledger4b,
                  recentEndingCategories: recent4b,
                  localReport: finalLocal,
                });
                const ch = deep4b;
                safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'deep_quality_done', chapter: chNum, status: ch.status, deepScore: ch.deepFinalScore, deepIssues: (((ch as any).deep?.issues) || []).slice(0, 6), summary: ch.deep.summary, revisedApplied: ch.status === 'fixed-applied', rejected: ch.status === 'fixed-rejected', rejectReason: ch.rejectReason ?? null, degraded: ch.status === 'degraded', fixShortened: ch.fixShortened ?? false, shortenedContentLen: (ch.fixShortened && ch.deep?.revisedContent?.length) ? ch.deep.revisedContent.length : null, warnings: ch.warnings ?? null })}\n\n`));
                // P2-R1：若 4B 返回 status=fixed 但 revisedContent<300 视为"半章修复"，追加专门 SSE 事件 + WARN log 供运维/前端监控
                if (ch.fixShortened) {
                  safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'deep_quality_fix_shortened', chapter: chNum, revisedContentLen: ch.deep.revisedContent.length, expectedMin: 300, deepScore: ch.deepFinalScore, warnings: ch.warnings ?? null })}\n\n`));
                  console.warn('[Pipeline-ST4B-SHORT-FIX] Ch' + chNum + ' revisedContent=' + ch.deep.revisedContent.length + '/<300 deepScore=' + ch.deepFinalScore + ' gate_blocked=' + (ch.deepFinalScore < 90));
                }
                if (ch.status === 'fixed-applied') {
                  // 把修复版正文作为"新本章内容"替换当前内容（推给前端一个 regeneration_done 标记，便于 UI 刷新展示）
                  const delta = ((ch as any).finalContent ?? "").slice(chapterSentLength); // 一般 4B 改完长度变化不大；直接整章替换更安全
                  // 整章替换：先重置 chapterCleanContent 再推一个 chapter_content_replace 特殊事件给前端整段 replace（而非基于 delta）
                  chapterCleanContent = ch.finalContent;
                  chapterSentLength = chapterCleanContent.length;
                  safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'deep_quality_regeneration', chapter: chNum, chars: chapterSentLength, replacedContent: chapterCleanContent.slice(0, 300), fullContent: chapterCleanContent })}\n\n`));
                }
              } else {
                // 跳过 4B 时伪造一个 deep 结果（pass-through），便于 complete 带 deepScore
                deep4b = {
                  status: 'pass-through',
                  deep: { status: 'pass', score: finalLocal.finalScore, issues: ['本地≥95跳过4B'], summary: '跳过4B', revisedContent: chapterCleanContent },
                  finalContent: chapterCleanContent,
                  deepFinalScore: Math.min(100, finalLocal.finalScore + 5),
                };
              }
            } else if (!finalLocal.pass) {
              // 4A 没过，不浪费 token 跑 4B：仍给一个"不存在的 deep4b"，便于门禁统一代码路径
            }

            // ============= STATION 6：门禁（P0+P1 双重）=============
            const localScore = finalLocal.finalScore;
            const deepScore = deep4b ? deep4b.deepFinalScore : 0;
            const localOk = finalLocal.pass;
            // deep 默认门槛 ≥ 90；若 deep 未运行（4A 没过 4B 没调）则要求 4A 必须已经 ≥95 才能单独通过
            const deepOk = !!deep4b && deepScore >= 90;
            const softPassByLocalOnly = !deep4b && localScore >= 95 && !finalLocal.hardContradiction;
            // P2-R3：4B 未运行但 4A ≥95 无硬矛盾 → ST6 软通过。显式打 SSE + log 便于监控，避免被误判为 4B 服务挂了。
            if (softPassByLocalOnly) {
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'pipeline_gate_softpass', chapter: chNum, finalScore: localScore, hardContradiction: false, reason: '4B未运行(4A未过或skipLLM未触发)，但本地≥95无硬矛盾，ST6软通过' })}\n\n`));
              console.log('[Pipeline-ST6-SOFT-PASS] Ch' + chNum + ' local=' + localScore + '（deep 未运行，靠 4A≥95 软通过）');
            }
            const gatePass = (localOk && (deepOk || softPassByLocalOnly));
            lastDeepFinalScore = deep4b ? deepScore : null;
            // 阶段心跳 5/5：STATION 6 门禁判定
            if (!safeEnqueue(encoder.encode(
              `data: ${JSON.stringify({ type: 'progress', stage: 'station6_gate', chapter: chNum, message: '第'+chNum+'章：STATION 6 门禁判定中…' })}\n\n`
            ))) throw new Error('SSE 连接已关闭 (station6_gate.'+chNum+')');

            if (!gatePass) {
              const reasons = [];
              if (!localOk) reasons.push('4A不通过 score=' + localScore + ' hard=' + finalLocal.hardContradiction);
              else if (!deepOk && !softPassByLocalOnly) reasons.push('4B 深审分=' + deepScore + ' < 90，且未达到本地≥95跳过阈值');
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'pipeline_gate_blocked', chapter: chNum, finalScore: localScore, deepScore, hardContradiction: finalLocal.hardContradiction, attempts: localScoreAttempts + 1, issuesHead: (finalLocal.issues || []).slice(0, 10).map((i) => ({ id: i.id, level: i.level, title: i.title, detail: (i.detail ?? "").slice(0, 120) })), message: '门禁未通过：' + reasons.join('；') + '。本批后续章节已停止生成，建议手动改稿或重新生成本章以提升分数。' })}\n\n`));
              const m = '[Pipeline-ST6-BREAK] 第' + chNum + '章 未过门禁（local=' + localScore + ' deep=' + deepScore + '）；中断批量';
              console.error(m);
              pipelineBulkBreak = true;
            }

            const chapterSummary = summarizeChapterForLedger(chapterCleanContent);
            const chapterStateStr = extractCharacterState(chapterCleanContent, protagonistName);
            const chapterLedger = buildLedgerFrom(chapterStateStr, chapterSummary.tailRaw, protagonistName, narrativePOV);
            const chapterEnding = classifyEnding(chapterCleanContent);
            lastRecords.push({
              chapterNumber: chNum,
              title: chTitle,
              summary: { head: chapterSummary.head, middle: chapterSummary.middle, tail: chapterSummary.tail },
              tailRaw: chapterSummary.tailRaw,
              chars: chapterSummary.chars,
              endingCategory: chapterEnding.primary,
              ledgerTail: chapterLedger,
              localFinalScore: finalLocal.finalScore,
            });
            // P3-3：本章快照持久化（异步，不阻塞生成）
            snapshotLastRecordToDB(runKeyLR, {
              chapterNumber: chNum,
              title: chTitle,
              summary: { head: chapterSummary.head, middle: chapterSummary.middle, tail: chapterSummary.tail },
              tailRaw: chapterSummary.tailRaw,
              chars: chapterSummary.chars,
              endingCategory: chapterEnding.primary,
              ledgerTail: chapterLedger,
              localFinalScore: finalLocal.finalScore,
            }, { userId: resolvedUserId }).catch(() => {});
            // [断点续传] 门禁前先保存本章终稿（避免断连/门禁时丢失已生成内容）
            saveChapterSnapshotToNovel(chNum, chTitle, chapterCleanContent, resolvedUserId, { passed: gatePass });
            lastChapterActualContent = chapterCleanContent;
            lastChapterActualTitle = chTitle;
            lastCharacterState = chapterStateStr;
            if (gatePass) pipelinePassedChapters++;
            if (pipelineBulkBreak) break;
          }

          // 发送完成事件（通过门禁的章节数 & 门禁中断原因 & 最后一章 deep 分）
          if (!isControllerClosed) {
            const expectedCount = currentBatchHooks.length;
            const blockedAt = pipelineBulkBreak ? pipelinePassedChapters + startChapter - 1 : null;
            safeEnqueue(encoder.encode(
              `data: ${JSON.stringify({ type: 'complete', generatedCount: pipelinePassedChapters, expectedCount, passedCount: pipelinePassedChapters, bulkBreak: pipelineBulkBreak, blockedAt, lastDeepFinalScore, missingChapters: Array.from({ length: Math.max(0, expectedCount - pipelinePassedChapters) }, (_, i) => startChapter + pipelinePassedChapters + i) })}\n\n`
            ));
            const finishLog = '[Stream] Batch passed=' + pipelinePassedChapters +
              '/' + expectedCount + ' bulkBreak=' + pipelineBulkBreak + ' blockedAt=' + blockedAt + ' lastDeep=' + lastDeepFinalScore;
            console.log(finishLog);
            isControllerClosed = true;
            controller.close();
          }
        } catch (error) {
          console.error('[Stream] Error in stream:', error);
          sendErrorAndClose(`生成章节时出错: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('Error generating chapters:', error);
    // 统一返回JSON格式错误
    return new Response(
      JSON.stringify({
        error: true,
        message: error instanceof Error ? error.message : '生成章节失败',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
