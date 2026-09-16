/**
 * continuity-checker.ts — Station 5 · 跨章衔接综合检测器（新版，P2-R2）
 *
 * 把原来的 checkStateContinuity + similarity 重复检测 + 复述 dedup 合并为统一的
 * `computeChapterContinuityReport(prev, cur, anchor?)`：
 *   输出一份 ContinuityReport（0~100 分 + QualityIssue[] + FAILURE_REPORT 文本）。
 *
 *  4 个维度（各 25 分）：
 *    A. 状态词承接 (25)  → 上章强状态词 vs 本章开头 600 字
 *    B. 实体共享度 (25)  → 上章末2句 vs 本章前450字 3-gram Jaccard / 句级相似度
 *    C. 重复/复述警戒 (25)  → 上章末 300 字 vs 本章首 300 字 2-gram Jaccard；≥45% 扣光
 *    D. 过渡合法性 (25)  → 时间跳变/场景跳变是否有过渡句；无过渡且跳变大扣分
 *
 * ⚠️  任意维度出现 ERROR 级问题（如：状态断裂 + 实体 0 共享 + 复述>65%），
 *     直接把 continuity.hardBreak = true，交由 STATION 6 门禁与 4A 重写循环。
 *
 * 额外提供：
 *   - CLOSING_PHRASES_SHARED：收束句（本章完/综上/总之…）+ 6 类 AI 模板结尾的共享黑名单；
 *   - scanAndRepairClosingPhrases(text)：Station 3 程序化扫描 + 裁到上一个开放式句末（必要时返回"需要重写最后一段"的信号）。
 */

/** ================== 收束句 & AI 模板结尾共享黑名单 ==================
 *  Prompt 里：作为【🚫 收束句禁用清单】段贴给 AI
 *  Station 3：程序化扫描命中后，裁到上一个"开放式句末"
 *  Station 5 / 全本衔接扫描：命中则给本章结尾打 CONT-ENDING-CLOSED WARN
 */
export const CLOSING_PHRASES_EXPLICIT = [
  '本章完', '（本章完）', '【本章完】', '未完待续', '（未完待续）', '【未完待续】',
  '综上', '总之', '综上所述', '概而言之', '总而言之', '本章讲述的就是', '这一章讲的就是',
  '上面讲的就是', '此事告一段落', '一切归于平静', '就这样结束了', '算是了结', '此事就此了结',
  '——（本章完）', '（第.*章完）',
];
// 6 类 AI 模板结尾·命中强的关键词短语（与 ending-rotator.ts AI_PATTERNS 对应文字版，方便 Prompt 直接粘贴）
export const AI_TEMPLATE_CLOSING_HINTS = [
  '（哲理升华类）：注定.*一生；成为.*转折点；改变.*命运；那一刻起；命运.*齿轮；冥冥之中；命运的安排；宿命；终究是；终将',
  '（时间跳变类）：天色渐明；夜幕降临；夜深了；夜色渐深；东方既白；天将破晓；时光.*逝；转眼.*过去；一转眼；一夜无话；一夜无事',
  '（本章总结类）：就这样.*度过；于是.*结束；这一天.*就.*了；一切.*归于平静；此事.*告一段落；算是.*了结；本章.*说的就是',
  '（展望挑战类）：更大的挑战；前方的路；未来.*未知；前路漫漫；风雨兼程；路还很长；等着.*去.*；然而.*却.*不知；他并不知道',
  '（安逸入眠类）：进入梦乡；沉沉睡去；伴着.*入眠；鼾声；悄然入睡；安稳.*睡；渐渐.*睡；睡了过去',
  '（上帝视角预告类）：然而.*却.*不知；他却不知道；他并不知道；故事才刚刚开始；这只是.*的开始；大戏.*才拉开',
];
// 空话钩子（给 Station 1 三段式 Prompt 用）
export const EMPTY_HOOK_PHRASES_SHARED = [
  '旧关系突然反咬一口','身边最亲近的人隐瞒关键事实','顺藤摸瓜向核心圈推进','更深的阴谋浮出水面','真相逐渐浮出水面','案件陷入僵局','隐藏的秘密被揭开','更大的危机正在逼近','新的线索出现了','真相变得越来越复杂','真相远比想象中复杂','一切都变得不一样了','事情渐渐失控','局面变得复杂','事情变得微妙','剧情发展','故事继续','新挑战','新角色登场','命运转折','真相复杂','一切才刚开始','事情没那么简单','带着心事入睡',
];

import type { ChapterHardAnchor } from './three-tables';

export type ContinuityIssueLevel = 'ERROR' | 'WARN' | 'PASS';
export interface ContinuityIssue {
  id:
    | 'CONT-STATE-MISS'
    | 'CONT-STATE-SOFT'
    | 'CONT-NGRAM-ZERO'
    | 'CONT-NGRAM-LOW'
    | 'CONT-REPEAT-HIGH'
    | 'CONT-REPEAT-MED'
    | 'CONT-TRANSITION-ABRUPT'
    | 'CONT-TRANSITION-TIME-JUMP'
    | 'CONT-ENDING-CLOSED';
  level: ContinuityIssueLevel;
  title: string;
  detail: string;
  penalty: number; // 正数·扣分幅度
  // 给 LLM 回炉时的"具体修复建议例句"
  suggestion: string;
  // 给前端展示的证据片段
  evidence?: { prevTail?: string; curHead?: string; sharedGrams?: string[] };
}

export interface ContinuityReport {
  finalScore: number;       // 0~100（4 维各 25）
  pass: boolean;            // ≥70 且无 ERROR 才算通过（比 4A 稍宽，因为衔接允许稍软过渡）
  hardBreak: boolean;       // 硬断裂：至少 1 个 ERROR 且总分 <50
  columns: {
    stateScore: number;
    ngramScore: number;
    repeatScore: number;
    transitionScore: number;
  };
  issues: ContinuityIssue[];
  // 给 4A FailureReport 喂回的衔接条目串（可直接拼接）
  failureSection: string;
}

// ====================== 通用工具（与 stream/route.ts 保持等价实现）======================

function splitSentences(text: string): string[] {
  return String(text ?? '')
    .replace(/\s+/g, '')
    .split(/(?<=[。！？!?；;])/)
    .map(s => s.trim())
    .filter(s => s.length >= 2);
}

function jaccardSet(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach(x => { if (b.has(x)) inter++; });
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function extractNgrams(text: string, n = 3): Set<string> {
  const normalized = String(text ?? '').replace(/\s+/g, '');
  const grams = new Set<string>();
  const STOP_FL = '的了在是和与为从到这那他她它们也又就都还但而并及将把被向于给让使要会能可以个上下中里前后不没有着过或等如此因为所以非若则即却便既仍';
  for (let i = 0; i <= normalized.length - n; i++) {
    const tok = normalized.slice(i, i + n);
    if (!/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(tok)) continue;
    if (/^[0-9]+$/.test(tok)) continue;
    if (STOP_FL.includes(tok[0]) || STOP_FL.includes(tok[n - 1])) continue;
    grams.add(tok);
  }
  return grams;
}

// ====================== 维度 A：状态词承接 ======================
const TRANSITION_WORDS = [
  '挣脱','松开','解开','释放','醒来','发现自己','怎么到','逃了','逃出','从.*里出来','被.*放了','被带',
  '牢房','审讯室','关押室','醒过来','意识恢复','迷迷糊糊睁开','意识回笼','猛地睁开','被推搡','被押送',
  '缓过神','回过神','恍惚','恍惚间','睁眼','抬眼','浑身.*疼','骨头.*散架','恍惚中','才发现',
];
function hasTransition(curHead: string): boolean {
  return TRANSITION_WORDS.some(w => new RegExp(w).test(curHead));
}

function computeStateScore(
  prev: { strongKeywords: string[]; finalSentences: string },
  curHead: string,
): { score: number; issue: ContinuityIssue | null } {
  const strong = prev.strongKeywords ?? [];
  if (strong.length === 0) return { score: 25, issue: null }; // 无强状态就按默认满

  const picked = strong.filter(k => curHead.includes(k));
  const transition = hasTransition(curHead);

  // 状态词 ≥2 且一个没承接 + 无过渡 = ERROR（-20）
  if (strong.length >= 2 && picked.length === 0 && !transition) {
    return {
      score: 5,
      issue: {
        id: 'CONT-STATE-MISS',
        level: 'ERROR',
        title: '强状态硬断裂',
        detail: `上章结尾含有强状态词 [${strong.join('/')}]，但本章开头 600 字既未承接状态，也未使用"挣脱/解开/醒来/从XX里出来"等过渡描写。`,
        penalty: 20,
        suggestion:
          `两种写法二选一：(a) 仍处于该状态下开场，例："铁链硌得手腕生疼，她发现自己被关在一间没有窗的审讯室里"；` +
          `(b) 给出状态的解脱过程，例："当冰凉的铁链终于从手腕被解开，她被推搡着带进一间狭小的档案室"。`,
        evidence: { prevTail: prev.finalSentences, curHead: curHead.slice(0, 200) },
      },
    };
  }
  // 强状态只承接 0 个，但有过渡 = WARN（-8）
  if (strong.length >= 2 && picked.length === 0 && transition) {
    return {
      score: 17,
      issue: {
        id: 'CONT-STATE-SOFT',
        level: 'WARN',
        title: '强状态软承接（只有过渡无状态词/实体呼应）',
        detail: `上章结尾强状态 [${strong.join('/')}]，本章使用了过渡句但没有出现任何状态词或前文实体。`,
        penalty: 8,
        suggestion: `在过渡句中加入一个具体状态实体，例如把"她慢慢睁开眼"改写成"铁链的冰凉还留在手腕上，她慢慢睁开眼"。`,
        evidence: { prevTail: prev.finalSentences, curHead: curHead.slice(0, 200) },
      },
    };
  }
  // 强状态只有 1 个且没承接（但可能是弱状态）→ 轻微 -3
  if (strong.length === 1 && picked.length === 0 && !transition) {
    return {
      score: 22,
      issue: {
        id: 'CONT-STATE-SOFT',
        level: 'WARN',
        title: '弱状态未呼应',
        detail: `上章结尾出现状态词 [${strong[0]}]，本章未呼应。`,
        penalty: 3,
        suggestion: `在开头加一句轻承接：比如"${strong[0]}的余感还在"。`,
        evidence: { prevTail: prev.finalSentences, curHead: curHead.slice(0, 120) },
      },
    };
  }
  // 正常：满 25
  return { score: 25, issue: null };
}

// ====================== 维度 B：实体共享度 ======================
function computeNgramScore(
  prevFinalSentences: string,
  curContent: string,
): { score: number; issue: ContinuityIssue | null; sharedGrams: string[] } {
  const tailGrams = extractNgrams(prevFinalSentences, 3);
  const headGrams = extractNgrams(curContent.slice(0, 450), 3);
  // ② 句级 Jaccard：上章末 5 句 vs 本章前 5 句（敏感度大幅提升）
  const prevSents = splitSentences(prevFinalSentences).slice(-5);
  const curSents = splitSentences(curContent.slice(0, 450)).slice(0, 5);
  let bestPerSentSum = 0;
  for (const c of curSents) {
    let best = 0;
    for (const p of prevSents) {
      const s = jaccardSet(extractNgrams(p, 2), extractNgrams(c, 2));
      if (s > best) best = s;
    }
    bestPerSentSum += best;
  }
  const sentJaccardMean = curSents.length > 0 ? bestPerSentSum / curSents.length : 0;
  const gramJac = jaccardSet(tailGrams, headGrams);
  const total = Math.max(gramJac, sentJaccardMean); // 取两者更高的（任一维度有衔接即算通过）

  const shared: string[] = [];
  tailGrams.forEach(g => { if (headGrams.has(g)) shared.push(g); });

  if (total === 0 && prevFinalSentences.length > 30) {
    return {
      score: 4,
      sharedGrams: shared.slice(0, 8),
      issue: {
        id: 'CONT-NGRAM-ZERO',
        level: 'ERROR',
        title: '实体层完全断裂（0 共享）',
        detail: '上章结尾与本章开头的 3-gram 实体共享度为 0，且分句级 Jaccard 也为 0：等于换了一本书在写。',
        penalty: 21,
        suggestion:
          `把第 1 段改写为承接上章最后两句的连续画面，必须出现至少一个上章结尾实体（人物/道具/地点/伤情）。` +
          `例：上章结尾"铁链套上了她的手腕，她被拖向黑暗深处"→本章开头"铁链的冰凉仍刻在手腕上，云小汐在颠簸中睁开眼——"（实体链：铁链/手腕/云小汐）。`,
        evidence: { prevTail: prevFinalSentences.slice(0, 120), curHead: curContent.slice(0, 200), sharedGrams: shared },
      },
    };
  }
  if (total < 0.03) {
    return {
      score: 14,
      sharedGrams: shared.slice(0, 8),
      issue: {
        id: 'CONT-NGRAM-LOW',
        level: 'WARN',
        title: '实体衔接偏弱（共享<3%）',
        detail: `上章结尾与本章开头的实体重合度仅 ${Math.round(total * 1000) / 10}‰，读者需要自己重新拼剧情。`,
        penalty: 11,
        suggestion: '在开头第 1-3 句里加入至少一个"上章结尾最后两句"中出现过的具体名词或形容词（人名/伤情/道具/天气/地点）。',
        evidence: { prevTail: prevFinalSentences.slice(0, 100), curHead: curContent.slice(0, 150), sharedGrams: shared },
      },
    };
  }
  // total ≥0.03 线性映射 15→25
  const score = Math.min(25, 15 + Math.round((total - 0.03) * 250));
  return { score, issue: null, sharedGrams: shared.slice(0, 8) };
}

// ====================== 维度 C：重复/复述警戒 ======================
function computeRepeatScore(
  prevTail300: string,
  curHead300: string,
): { score: number; issue: ContinuityIssue | null; similarityPct: number } {
  const a = extractNgrams(prevTail300, 2);
  const b = extractNgrams(curHead300, 2);
  const sim = jaccardSet(a, b);
  const simPct = Math.round(sim * 100);

  if (sim > 0.65) {
    return {
      score: 0,
      similarityPct: simPct,
      issue: {
        id: 'CONT-REPEAT-HIGH',
        level: 'ERROR',
        title: '复述度极高（>65%）',
        detail: `本章开头与上章结尾的 2-gram 相似度达 ${simPct}%，等于整章回放。`,
        penalty: 25,
        suggestion: '开头禁止任何回顾，必须写新动作/新对白/新画面的推进。对上章已发生事件，最多用一句心理/肢体余波轻轻带过，不能复述事件过程或对白。',
        evidence: { prevTail: prevTail300.slice(0, 150), curHead: curHead300.slice(0, 150) },
      },
    };
  }
  if (sim > 0.45) {
    return {
      score: 12,
      similarityPct: simPct,
      issue: {
        id: 'CONT-REPEAT-MED',
        level: 'WARN',
        title: '复述度偏高（>45%）',
        detail: `本章开头与上章结尾的 2-gram 相似度达 ${simPct}%，疑似"话说/且说/回忆"式回看上章。`,
        penalty: 13,
        suggestion: '删掉回顾段，把开头改成"承接状态后的下一步新动作"。例：把"话说上回陈大牛在废铁堆发现铁片…"改成"陈大牛低头看着手心泛着微光的铁片，没敢马上动弹——"。',
        evidence: { prevTail: prevTail300.slice(0, 120), curHead: curHead300.slice(0, 120) },
      },
    };
  }
  // 线性：sim=0 → 25 分，sim=0.45 → 12 分
  const score = Math.max(0, Math.min(25, Math.round(25 - (sim / 0.45) * 13)));
  return { score, issue: null, similarityPct: simPct };
}

// ====================== 维度 D：过渡合法性 ======================
const TIME_JUMP_RE = /(第二天|三天后|一个月后|半年后|一年后|数月后|几日后|次日|翌日|十年后|一夜无话|一夜无事|天光大亮|转眼已是|时光飞逝|忽忽数日)/;
function computeTransitionScore(
  prevScene: string,
  curHead: string,
): { score: number; issue: ContinuityIssue | null } {
  const timeHit = TIME_JUMP_RE.exec(curHead.slice(0, 400));
  // 如果上章 sceneSnapshot 里是"羁押/昏迷/被拖走"这类强封闭场景，但本章直接出现"第二天 + 室内/办公室/自由活动"的组合 → 硬跳
  const prisonClue = /羁押|牢房|审讯室|囚笼|监牢|密室|关押/.test(prevScene);
  const freedomJump = /(办公室|家中|街上闲逛|公司|学校|咖啡厅|宿舍|家里|家中|会议室|卧室)/.test(curHead.slice(0, 500));
  if (prisonClue && freedomJump && !hasTransition(curHead)) {
    return {
      score: 2,
      issue: {
        id: 'CONT-TRANSITION-ABRUPT',
        level: 'ERROR',
        title: '场景硬跳（羁押→自由）',
        detail: '上章结尾是羁押/牢房类封闭场景，但本章直接切到办公室/家中等自由场景，没有任何"释放/被押送转移/越狱/审讯完带回"的过渡。',
        penalty: 23,
        suggestion: '加 1~2 句过渡，明确交代角色是"怎么到这个新场景的"：是被人带过去的？还是被释放？还是换了个平行场景（如回忆/另一条线）？',
        evidence: { prevTail: prevScene, curHead: curHead.slice(0, 200) },
      },
    };
  }
  if (timeHit && !hasTransition(curHead.slice(0, 500)) && prisonClue) {
    return {
      score: 10,
      issue: {
        id: 'CONT-TRANSITION-TIME-JUMP',
        level: 'WARN',
        title: '时间跳变魔法（无过渡）',
        detail: `本章开头使用了"${timeHit[0]}"进行时间跳变，但上章是封闭/强冲突场景，没有交代这段时间里发生了什么，容易让读者断片。`,
        penalty: 15,
        suggestion: '在时间跳变前插入 1 句过渡。例："七天后，云小汐终于被带出了那间没有窗的审讯室——"。',
        evidence: { prevTail: prevScene, curHead: curHead.slice(0, 200) },
      },
    };
  }
  return { score: 25, issue: null };
}

// ====================== 合并入口 ======================

export interface ContinuityInput {
  /** 上一章完整正文（cleanContent，已 sanitize） */
  previousChapterCleanContent: string;
  /** 本章完整正文（cleanContent，已 sanitize） */
  currentChapterCleanContent: string;
  /** 上一章的 hardAnchor（若没传，内部会用 previousChapterCleanContent 兜底构建） */
  previousHardAnchor?: ChapterHardAnchor | null;
  /** 上一章 ending 的 isHuman 标签（用于 unresolvedSignal 推断，可选） */
  previousEnding?: { primary?: string; isHuman?: boolean } | null;
  /** 上一章编号（仅用于日志/错误信息） */
  previousChapterNumber?: number;
}

export function computeChapterContinuityReport(input: ContinuityInput): ContinuityReport {
  const prev = input.previousChapterCleanContent ?? '';
  const cur = input.currentChapterCleanContent ?? '';
  // 兜底构建 hardAnchor（若调用方没传）
  let anchor = input.previousHardAnchor ?? null;
  if (!anchor && prev) {
    // 轻量导入（避免循环）：如果 three-tables 可用就用，否则自己手工降级
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./three-tables');
      if (mod?.buildHardAnchor) anchor = mod.buildHardAnchor(prev, input.previousEnding as any);
    } catch { /* ignore */ }
  }
  if (!anchor) {
    // 终极降级：手工凑一个
    const sentences = splitSentences(prev).slice(-2).join(' ');
    anchor = {
      finalSentences: sentences.slice(-140),
      strongKeywords: [],
      anchorNgrams: [],
      sceneSnapshot: '未识别特定场景',
      unresolvedSignal: '普通结尾：下章按时间/地点/新事件自然承接',
    };
  }

  const curHead600 = cur.slice(0, 600);
  const curHead300 = cur.slice(0, 300);
  const prevTail300 = prev.slice(-300);

  const a = computeStateScore(
    { strongKeywords: anchor.strongKeywords, finalSentences: anchor.finalSentences },
    curHead600,
  );
  const b = computeNgramScore(anchor.finalSentences, cur);
  const c = computeRepeatScore(prevTail300, curHead300);
  const d = computeTransitionScore(anchor.sceneSnapshot, curHead600);

  const stateScore = a.score;
  const ngramScore = b.score;
  const repeatScore = c.score;
  const transitionScore = d.score;

  const finalScore = stateScore + ngramScore + repeatScore + transitionScore;
  const issues: ContinuityIssue[] = [a.issue, b.issue, c.issue, d.issue].filter((x): x is ContinuityIssue => !!x);
  const anyError = issues.some(i => i.level === 'ERROR');
  const pass = finalScore >= 70 && !anyError;
  const hardBreak = anyError && finalScore < 50;

  // FAILURE_REPORT § 拼接（4A 循环直接用）
  const failureSection = issues.length
    ? [
        '',
        '【🔴 FAILURE_REPORT · §跨章衔接 (CONT)】',
        `衔接综合分 = ${finalScore}/100（${pass ? '✅ 达标' : '❌ 未达标，硬断裂=' + hardBreak}）`,
        `  · 状态承接 A=${stateScore}/25，实体共享 B=${ngramScore}/25，复述警戒 C=${repeatScore}/25（相似度=${c.similarityPct}%），过渡合法 D=${transitionScore}/25`,
        ...issues.map(
          (i, idx) =>
            `  ${idx + 1}. [${i.level}] ${i.id} ${i.title}（-${i.penalty}分）：${i.detail} → ✅ 修复建议：${i.suggestion}`,
        ),
      ].join('\n')
    : '';

  return {
    finalScore,
    pass,
    hardBreak,
    columns: { stateScore, ngramScore, repeatScore, transitionScore },
    issues,
    failureSection,
  };
}

// ===========================================================================
// 收束句/AI 模板结尾：程序化扫描 + 裁到上一个开放式句末（Station 3）
// ===========================================================================
export interface ClosingRepairResult {
  /** 修复后的正文 */
  repairedText: string;
  /** 是否真的命中并修复了（false = 原文没问题） */
  anyHit: boolean;
  /** 命中的短语（可记录到日志/SSE） */
  hits: string[];
  /** 是否需要 AI 重写最后一段（true 表示程序化裁剪后剩余字数<200，需要微 prompt 重写尾段） */
  needRewriteTail: boolean;
  /** 裁剪位置（character offset），供前端高亮 */
  cutAt?: number;
}

/** 显式正则版黑名单：为精确匹配，CLOSING_PHRASES_EXPLICIT 里的"."要转义 */
function buildClosingRegex(): RegExp {
  const allPhrases: string[] = [];
  for (const p of CLOSING_PHRASES_EXPLICIT) {
    allPhrases.push(p.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
  }
  // 再附加 AI_模板 强关键词的关键字字面匹配（不做整句 regex，避免低命中）
  const plainKeywords = [
    '注定.*一生','成为.*转折点','改变.*命运','那一刻起','命运.*齿轮','冥冥之中','命运的安排','宿命','终究是','终将',
    '天色渐明','夜幕降临','夜深了','夜色渐深','东方既白','天将破晓','一转眼','一夜无话','一夜无事',
    '一切归于平静','此事.*告一段落','算是.*了结',
    '更大的挑战','前方的路','前路漫漫','风雨兼程','路还很长','然而.*却.*不知','他并不知道',
    '进入梦乡','沉沉睡去','伴着.*入眠','鼾声','悄然入睡','渐渐.*睡','睡了过去',
    '故事才刚刚开始','这只是.*的开始','大戏.*才拉开',
  ];
  for (const k of plainKeywords) {
    // 中文正则直接用，不用 escape（但 .* 保留，用于匹配）
    allPhrases.push(k);
  }
  return new RegExp('(' + allPhrases.join('|') + ')', 'g');
}
/** 找最后一个开放式句末：。！？!?；… 等句末标点，位置尽量在章末 70%~100% 区间；
 *  回退策略：找不到就用倒数第二个完整句句末 */
function findLastOpenSentenceEnd(text: string, minCutAt: number): number {
  const t = String(text ?? '');
  // 只在 [minCutAt, end] 范围内向回搜索（避免切掉太多正文）
  const scanStart = Math.max(0, minCutAt);
  const scan = t.slice(scanStart);
  const openEndings = /[。！？!?；…]/g;
  const positions: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = openEndings.exec(scan)) !== null) positions.push(scanStart + m.index + 1);
  if (positions.length === 0) return t.length;
  // 优先：倒数第 3 个句号（保留足够尾段悬念），否则取倒数第 1 个
  return positions.length >= 3 ? positions[positions.length - 3] : positions[positions.length - 1];
}
export function scanAndRepairClosingPhrases(textIn: string): ClosingRepairResult {
  const text = String(textIn ?? '');
  const re = buildClosingRegex();
  const hitsSet = new Set<string>();
  let earliestHitOffset = text.length;
  const matches = text.matchAll(re);
  for (const m of matches) {
    hitsSet.add(m[0]);
    if (typeof m.index === 'number' && m.index < earliestHitOffset) earliestHitOffset = m.index;
  }
  if (hitsSet.size === 0) {
    return { repairedText: text, anyHit: false, hits: [], needRewriteTail: false };
  }
  const hits = Array.from(hitsSet);
  // 命中点：允许命中点前面的 70% 正文不被裁（只裁命中点往后的收束句）
  const safeBound = Math.floor(text.length * 0.70);
  const cutFrom = Math.min(earliestHitOffset, text.length - 1);
  if (cutFrom < safeBound) {
    // 命中点太靠前，说明不是"章末收束"而是正文正常使用"终将/宿命"等词 → 不做裁剪
    return { repairedText: text, anyHit: true, hits, needRewriteTail: false };
  }
  // 把 cutFrom 向前回退到"上一个完整句末"（findLastOpenSentenceEnd 里按句末标点回退）
  const cutAt = findLastOpenSentenceEnd(text, safeBound);
  const repaired = text.slice(0, cutAt);
  const needRewriteTail = repaired.length < Math.max(200, text.length * 0.5);
  return {
    repairedText: repaired,
    anyHit: true,
    hits,
    needRewriteTail,
    cutAt,
  };
}

// 便利导出：供 novel-generator 前端"全本衔接扫描"按钮调用的批量函数
export function scanFullBookContinuity(
  chapters: Array<{ index: number; title: string; content: string }>,
): Array<{
  prevIndex: number;
  nextIndex: number;
  report: ContinuityReport;
  sharedGrams: string[];
  similarityPct: number;
  summaryHeadline: string;
  endingClosed: { hits: string[]; needRewriteTail: boolean };
}> {
  const results: any[] = [];
  for (let i = 0; i < chapters.length - 1; i++) {
    const prev = chapters[i];
    const next = chapters[i + 1];
    if (!prev?.content || !next?.content) continue;
    const report = computeChapterContinuityReport({
      previousChapterCleanContent: prev.content,
      currentChapterCleanContent: next.content,
      previousChapterNumber: prev.index,
    });
    const endClosed = scanAndRepairClosingPhrases(prev.content);
    // 额外给出人类可读摘要
    const headline = report.pass
      ? `✅ 第${prev.index}章 → 第${next.index}章 衔接通过（${report.finalScore}/100）`
      : report.hardBreak
      ? `🔥 第${prev.index}章 → 第${next.index}章 硬断裂（${report.finalScore}/100）：${report.issues.find(i=>i.level==='ERROR')?.title || ''}`
      : `⚠️ 第${prev.index}章 → 第${next.index}章 衔接偏弱（${report.finalScore}/100）：${report.issues[0]?.title || ''}`;
    results.push({
      prevIndex: prev.index,
      nextIndex: next.index,
      report,
      sharedGrams: (report.issues.find(i => i.id === 'CONT-NGRAM-ZERO' || i.id === 'CONT-NGRAM-LOW')?.evidence as any)?.sharedGrams ?? [],
      similarityPct: c2Similarity(report),
      summaryHeadline: headline + (endClosed.anyHit ? ` · 章末收束句命中[${endClosed.hits.slice(0,3).join('/')}]` : ''),
      endingClosed: { hits: endClosed.hits, needRewriteTail: endClosed.needRewriteTail },
    });
  }
  return results;
}
function c2Similarity(r: ContinuityReport): number {
  const repIssue = r.issues.find(i => i.id === 'CONT-REPEAT-HIGH' || i.id === 'CONT-REPEAT-MED');
  if (!repIssue) return 0;
  const m = /(\d+)%/.exec(repIssue.detail);
  return m ? Number(m[1]) : 0;
}
