/**
 * semantic-dedup.ts — 语义复述检测（P0 · STATION 4A-2）
 *
 * 原版只用「2-gram Jaccard 字面相似度」，对"换说法复述"非常不敏感：
 *   样例问题章第 2 章开头复述完整剧情，字面相似度只有 8.4%，被判为"不重复"。
 *
 * 本文件新增三栏检测，合并返回 0-100 分（越⾼越像复述，≥40 视为 WARN，≥65 视为 ERROR）：
 *   ① literalBigramScore  —— 保留原版 2-gram，作为下限
 *   ② sentenceJaccard     —— 分句后再比较「本章开头 5 句 / 上章结尾 5 句」的词集重合
 *   ③ eventOverlapScore   —— 提取"主语-动作-宾语"事件三元组，比较事件重叠度
 */

const NGRAM_N = 2;

function splitSentences(text: string): string[] {
  if (!text) return [];
  return text
    .replace(/\s+/g, '')
    .split(/(?<=[。！？!?；;])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  a.forEach((g) => {
    if (b.has(g)) intersection++;
  });
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function tokenize(text: string): Set<string> {
  const normalized = text.replace(/\s+/g, '');
  const grams = new Set<string>();
  for (let i = 0; i <= normalized.length - NGRAM_N; i++) {
    grams.add(normalized.slice(i, i + NGRAM_N));
  }
  return grams;
}

/** ① 原版字面 2-gram（保留） */
export function literalBigramScore(prevEnd: string, curStart: string): number {
  return jaccard(tokenize(prevEnd), tokenize(curStart));
}

/** ② 句级 Jaccard：分句子再取集合重合，对"换说法复述"敏感度大幅提升 */
export function sentenceJaccardScore(prevEnd: string, curStart: string): number {
  const prevSents = splitSentences(prevEnd).slice(-5);
  const curSents = splitSentences(curStart).slice(0, 5);
  if (prevSents.length === 0 || curSents.length === 0) return 0;

  const bestPerSent: number[] = [];
  for (const cur of curSents) {
    let best = 0;
    for (const prev of prevSents) {
      const sim = jaccard(tokenize(cur), tokenize(prev));
      if (sim > best) best = sim;
    }
    bestPerSent.push(best);
  }
  // 至少 2 句达到 ≥ 0.55 就判复述
  const matching = bestPerSent.filter((s) => s >= 0.55).length;
  const thresholdRatio = Math.min(1, matching / 2); // 够 2 句就封顶到 1.0
  const avgBest =
    bestPerSent.reduce((a, b) => a + b, 0) / Math.max(1, bestPerSent.length);
  return Math.max(avgBest, thresholdRatio);
}

/** ③ 事件重叠度：提取「主语名词块 + 动作动词块」二元组，比较上章结尾 vs 本章开头 */
const SUBJECT_HINTS =
  /(他|她|它|我|你|我们|你们|他们|她们|魏十七|那人|来人|黑衣人|白衣人|玄衣人|师父|师兄|师弟|掌柜|伙计|主角|配角|少年|少女|老者|书生|剑客|刀客)/g;
const ACTION_HINTS = [
  '走进|闯|跨入|推开|撞到|顶|闩',
  '问|答|说|喊|叫|低声|冷笑|苦笑|喃喃|咬牙|开口|开口道',
  '握着|攥着|揣着|拿着|抱着|丢|抛|扔|接|抽|拔|拾取|捡到|摸到|发现',
  '受伤|渗血|流血|倒下|爬起|站起|蹲下|躺下|退回|靠在',
  '下雨|刮风|下雨点|停雨|敲门|叩门|脚步声由远|脚步声近',
  '发现|撞见|遇到|看到|盯|注视|打量|瞅',
  '穿|戴着|披着|罩着|衣衫',
  '找|追问|追查|要|索要|取',
];
const ACTION_REGEX = new RegExp(`(${ACTION_HINTS.join('|')})`, 'g');

function extractEvents(text: string): Set<string> {
  if (!text) return new Set<string>();
  const subjects = new Set<string>();
  let m: RegExpExecArray | null;
  SUBJECT_HINTS.lastIndex = 0;
  while ((m = SUBJECT_HINTS.exec(text)) !== null) subjects.add(m[0]);

  const actions = new Set<string>();
  ACTION_REGEX.lastIndex = 0;
  while ((m = ACTION_REGEX.exec(text)) !== null) actions.add(m[0]);

  // 生成「subject × action」组合（只取附近 10 字内的配对）
  const events = new Set<string>();
  const cleaned = text.replace(/\s+/g, '');
  for (const s of subjects) {
    let pos = 0;
    while ((pos = cleaned.indexOf(s, pos)) !== -1) {
      const window = cleaned.slice(Math.max(0, pos - 6), pos + s.length + 16);
      for (const a of actions) {
        if (window.includes(a)) {
          events.add(`${s}|${a}`);
        }
      }
      pos += s.length;
      if (events.size > 40) break;
    }
    if (events.size > 40) break;
  }

  // 兜底：如果 10 字窗口配对为空，退化为「subject + action」笛卡尔组合（上限 30）
  if (events.size === 0) {
    const subArr = Array.from(subjects).slice(0, 6);
    const actArr = Array.from(actions).slice(0, 5);
    for (const s of subArr) {
      for (const a of actArr) {
        events.add(`${s}|${a}`);
      }
    }
  }
  return events;
}

export function eventOverlapScore(prevEnd: string, curStart: string): number {
  const prevEvents = extractEvents(prevEnd);
  const curEvents = extractEvents(curStart);
  if (prevEvents.size === 0 || curEvents.size === 0) return 0;
  return jaccard(prevEvents, curEvents);
}

export interface SemanticDedupReport {
  literal: number; // 0~1
  sentence: number; // 0~1
  event: number; // 0~1
  overall: number; // 综合 0~1（加权：事件最敏感，其次句级，其次字面）
  level: 'pass' | 'warn' | 'error';
  repeatedSentences?: string[]; // 被判定为复述的句子（可解释性输出）
}

/**
 * 综合复述评分（三栏加权）
 */
export function semanticDedupReport(
  previousTail: string, // 上章结尾（建议 400-600 字）
  currentHead: string, // 本章开头（建议 400-600 字）
): SemanticDedupReport {
  const literal = literalBigramScore(previousTail, currentHead);
  const sentence = sentenceJaccardScore(previousTail, currentHead);
  const event = eventOverlapScore(previousTail, currentHead);

  // 权重：事件重叠 0.55 / 句级 0.30 / 字面 0.15
  const overall = event * 0.55 + sentence * 0.30 + literal * 0.15;

  let level: SemanticDedupReport['level'] = 'pass';
  if (overall >= 0.65 || event >= 0.7 || sentence >= 0.75) level = 'error';
  else if (overall >= 0.4 || event >= 0.5 || sentence >= 0.55) level = 'warn';

  // 可解释性：找出本章开头 5 句里，与上章结尾最佳匹配 ≥ 0.55 的前几句
  const repeatedSentences = (() => {
    if (level === 'pass') return undefined;
    const prevSents = splitSentences(previousTail).slice(-5);
    const curSents = splitSentences(currentHead).slice(0, 5);
    const hits: string[] = [];
    for (const cur of curSents) {
      let best = 0;
      for (const prev of prevSents) {
        const s = jaccard(tokenize(cur), tokenize(prev));
        if (s > best) best = s;
      }
      if (best >= 0.55)
        hits.push(`${cur}（相似度 ${(best * 100).toFixed(0)}%）`);
    }
    return hits.length > 0 ? hits : undefined;
  })();

  return { literal, sentence, event, overall, level, repeatedSentences };
}
