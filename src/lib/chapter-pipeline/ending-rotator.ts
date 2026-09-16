/**
 * ending-rotator.ts — 结尾分类 & 轮换（P0 · STATION 4A-5）
 *
 * 10 类结尾：
 *   真人 4 类（推荐轮盘轮换）：
 *     action-cut   — 动作切断（关键动作做到一半截住，如"剑刚出鞘半截"）
 *     hook-question — 钩子问句（信息悬念+问句，如"来人竟叫出只有他才知道的那个名号"）
 *     detail-reveal — 细节揭示（道具/环境/身体细节揭示，如"指缝间渗血的窝头"）
 *     line-dialogue — 台词截断（最后一句对白不完整或反转）
 *
 *   AI 模板 6 类（命中扣分，禁连着 3 章同类）：
 *     ai-echo-philosophy  — 升华式总结/哲理总结 ("这一夜的经历，将注定改变他一生")
 *     ai-time-skip        — "天色渐明/夜幕降临/时光飞逝"式时间跳
 *     ai-summary-all      — 一句话复述整章事件做结
 *     ai-look-forward     — "未来的路还很长/他将面对更大的挑战"展望式
 *     ai-peaceful-rest    — "伴着鼾声入眠/渐渐进入梦乡"安逸收束
 *     ai-placeholder      — "然而他并不知道……"式上帝视角预告
 *
 * 返回：
 *   { primary: EndingCategory, allHits: {cat, phrase, score}[], score: 0~1 (真人类越高越好 / AI 类越低越好) }
 */

export type EndingCategory =
  | 'action-cut'
  | 'hook-question'
  | 'detail-reveal'
  | 'line-dialogue'
  | 'ai-echo-philosophy'
  | 'ai-time-skip'
  | 'ai-summary-all'
  | 'ai-look-forward'
  | 'ai-peaceful-rest'
  | 'ai-placeholder';

export interface EndingHit {
  category: EndingCategory;
  phrase: string;          // 命中的原句片段（可解释性）
  score: number;           // 0~1 命中置信度
}

export interface EndingClassification {
  primary: EndingCategory;
  isHuman: boolean;        // 是否属于"真人 4 类"
  allHits: EndingHit[];
  aiHitDensity: number;    // AI 模板命中数（扣分项）
  score: number;           // 0~1（真人类 +0.3/类；AI 类 -0.25/类）
}

const HUMAN_PATTERNS: Array<[EndingCategory, RegExp, string]> = [
  ['action-cut', /(刚.*半截|正.*到一半|手刚.*到|还没.*完|话还没.*口|尚未.*毕|话没说完|剑刚.*鞘|刀刚.*出)/, '动作切断'],
  ['hook-question', /(竟是|竟然|殊不知|怎会|居然|谁知|怎料|却不知|未曾想|没想到.*竟是|只有.*才.*知道|那个.*名字|那个.*名号|那句.*口诀)/, '钩子揭示'],
  ['hook-question', /[？?]$|(？\s*$|\?\s*$)/, '问号结尾'],
  ['detail-reveal', /(只见|原来|细看之下|仔细一看|定睛一看|低头一看|却见|竟见|指缝|怀里|腰间|袖中|袖管|衣襟|靴筒里|掌心.*|指缝间|衣内|怀中)/, '细节揭示'],
  ['line-dialogue', /("[^"]*$|“[^”]*$|「[^」]*$|《[^》]*$|'[^']*$|——\s*$|……\s*$|\.\.\.\s*$)/, '台词/省略截断'],
];

const AI_PATTERNS: Array<[EndingCategory, RegExp, string]> = [
  ['ai-echo-philosophy', /(注定.*一生|成为.*转折点|改变.*命运|那一刻起|命运.*齿轮|冥冥之中|命运的安排|宿命|终究是|终将)/, '哲理升华'],
  ['ai-time-skip', /(天色渐明|夜幕降临|夜深了|夜色渐深|东方既白|天将破晓|时光.*逝|转眼.*过去|一转眼|一夜无话|一夜无事)/, '时间跳'],
  ['ai-summary-all', /(就这样.*度过|于是.*结束|这一天.*就.*了|一切.*归于平静|此事.*告一段落|算是.*了结|本章.*说的就是|上面讲的就是|这一章.*)/, '本章总结'],
  ['ai-look-forward', /(更大的挑战|前方的路|未来.*未知|前路漫漫|风雨兼程|路还很长|等着.*去.*|他不知道.*|他不知道的是|然而.*不知道|却不知|而他不知|殊不知)/, '展望挑战'],
  ['ai-peaceful-rest', /(进入梦乡|沉沉睡去|伴着.*入眠|鼾声|悄然入睡|安稳.*睡|渐渐.*睡|睡了过去)/, '安逸入眠'],
  ['ai-placeholder', /(然而.*却.*不知|他却不知道|他并不知道|故事才刚刚开始|这只是.*的开始|大戏.*才拉开)/, '上帝视角预告'],
];

const HUMAN_SET = new Set<EndingCategory>([
  'action-cut',
  'hook-question',
  'detail-reveal',
  'line-dialogue',
]);

export function classifyEnding(chapterContent: string): EndingClassification {
  const clean = (chapterContent || '').replace(/\s+/g, ' ').trim();
  if (clean.length === 0) {
    return {
      primary: 'ai-summary-all',
      isHuman: false,
      allHits: [],
      aiHitDensity: 0,
      score: 0,
    };
  }

  // 取最后 300 字作为分析窗口
  const tail = clean.slice(Math.max(0, clean.length - 300));
  const hits: EndingHit[] = [];

  for (const [category, re, name] of HUMAN_PATTERNS) {
    const m = tail.match(re);
    if (m) {
      const phrase = (m[0] ?? name).slice(0, 30);
      // 以问号结尾的句子出现在末尾 30 字内权重更高
      const bonus = /[？?]$|问号结尾/.test(name) && tail.length - (tail.search(re) + (m[0]?.length ?? 0)) < 40 ? 1 : 0.7;
      hits.push({ category, phrase, score: bonus });
    }
  }

  const hitsAi: EndingHit[] = [];
  for (const [category, re, name] of AI_PATTERNS) {
    const m = tail.match(re);
    if (m) {
      const phrase = (m[0] ?? name).slice(0, 30);
      // 离末尾越近权重越高
      const pos = tail.indexOf(m[0] ?? '');
      const distanceToEnd = Math.max(0, tail.length - (pos + (m[0]?.length ?? 0)));
      const proximity = 1 - Math.min(1, distanceToEnd / 200); // 越靠近 200 字内越重
      hitsAi.push({ category, phrase, score: 0.4 + 0.6 * proximity });
    }
  }

  const allHits = [...hits, ...hitsAi];

  // 主类别：真人类权重 1.0，AI 类权重 0.75。按 hit.score 加权总和最高者胜出
  const tally: Record<string, number> = {};
  for (const h of hits) tally[h.category] = (tally[h.category] ?? 0) + h.score * 1.0;
  for (const h of hitsAi) tally[h.category] = (tally[h.category] ?? 0) + h.score * 0.75;

  let primary: EndingCategory = 'ai-summary-all';
  let maxVal = -1;
  for (const k of Object.keys(tally)) {
    if (tally[k] > maxVal) {
      maxVal = tally[k];
      primary = k as EndingCategory;
    }
  }

  // 结尾分类分：真人类 0.3/类，AI 类 -0.25/类。上限 1，下限 0
  const humanCatSet = new Set(hits.map((h) => h.category));
  const aiCatSet = new Set(hitsAi.map((h) => h.category));
  const base = 0.5; // 中立分
  let score =
    base +
    humanCatSet.size * 0.3 -
    aiCatSet.size * 0.25;
  // 结尾是问号的强真人倾向 +0.15
  if (/[？?]\s*$/.test(tail)) score += 0.15;
  score = Math.max(0, Math.min(1, score));

  return {
    primary,
    isHuman: HUMAN_SET.has(primary),
    allHits,
    aiHitDensity: aiCatSet.size,
    score,
  };
}

/** 最近 3 章结尾类型历史：同类连着 2 次，第 3 次同类直接判 WARN */
export function endingRotationPenalty(
  recentEndingCategories: EndingCategory[],
  current: EndingCategory,
): { level: 'pass' | 'warn' | 'error'; reason?: string } {
  const last3 = [...recentEndingCategories].slice(-3);
  if (last3.length < 2) return { level: 'pass' };

  // 连着 3 次同类
  if (last3.length >= 2 && last3.every((c) => c === current)) {
    return {
      level: 'error',
      reason: `连续 ${last3.length + 1} 章结尾类型【${current}】完全相同，模板感极强。`,
    };
  }
  // 前一次同类型 -> warn（非 AI 类可适当放宽，这里严格执行）
  if (last3[last3.length - 1] === current) {
    return {
      level: 'warn',
      reason: `上一章结尾类型已是【${current}】，本章继续使用，建议轮换。`,
    };
  }
  return { level: 'pass' };
}
export interface AiEndingGuardResult {
  touched: boolean; originalEnding: string; replacedEnding: string; newContent: string; primary: EndingCategory | 'trap-tail';
}
const TRAP_TAIL_LITERALS: string[] = [
  '夜幕降临，一切归于平静。', '一切归于平静。', '故事才刚刚开始。',
  '而这，不过是后续一系列风波的开端罢了。', '命运的齿轮开始缓缓转动。', '命运的齿轮，开始缓缓转动。',
  '他并不知道，这一夜，将改变他的一生。', '殊不知，这一夜的经历，将注定改变他一生。',
  '前路漫漫，风雨兼程，他将面对更大的挑战。', '就这样，一夜无话。', '一夜无话。',
  '夜深了，他渐渐进入梦乡。',
];
// 切尾句候选池：仅供「命中 AI 套话尾时」做一次性本地替换。
// 铁律：必须 ①第三人称/无主语（禁出现"我"，避免第一人称 POV 污染）②不含任何门派/朝代专属道具
// （木匣/窝头/青砖/梆子/门槛/刀剑等），保证跨题材通用；③句式命中 HUMAN_PATTERNS（动作切断/钩子/细节揭示）。
export const CUT_OFF_PICK: string[] = [
  '那只手刚伸到一半，又猛地缩了回去。',
  '来的人，竟然是他。',
  '他低头一看，掌心不知何时被掐出了几道血痕。',
  '一句话没说完，声音就断在了风里。',
  '黑暗里站着的，竟是一个谁也没想到的人。',
  '他猛然抬头，却见一道影子贴着墙根一闪而过。',
  '那只手刚触到门板，门却从里面被拉开了。',
  '这个时候找上门来的，还能有谁？',
];
export const cutOffPickList: readonly string[] = CUT_OFF_PICK;
export function guardForAiEnding(input: string, seed = 0): AiEndingGuardResult {
  const text = input || '';
  const trimmed = text.replace(/\s+$/g, '');
  if (trimmed.length < 120) return { touched: false, originalEnding: '', replacedEnding: '', newContent: text, primary: 'ai-summary-all' };
  for (const t of TRAP_TAIL_LITERALS) {
    if (trimmed.endsWith(t)) {
      let chopped = trimmed.slice(0, Math.max(0, trimmed.length - t.length)).replace(/\s+$/g, '');
      if (!chopped) chopped = trimmed;
      const pick = CUT_OFF_PICK[(seed + chopped.length) % CUT_OFF_PICK.length];
      const candidate = chopped + '\n' + pick;
      if (candidate.length >= trimmed.length * 0.92) {
        return { touched: true, originalEnding: t, replacedEnding: '\n' + pick, newContent: candidate, primary: 'trap-tail' };
      }
    }
  }
  const cls = classifyEnding(text);
  if (!cls.isHuman) {
    const tail = trimmed.slice(Math.max(0, trimmed.length - 400));
    let found: { cat: EndingCategory; pos: number; len: number } | null = null;
    for (const [cat, re, _name] of AI_PATTERNS) {
      const m = tail.match(re);
      if (m && typeof m.index === 'number') {
        const abs = Math.max(0, trimmed.length - 400) + m.index;
        if (!found || abs > found.pos) found = { cat, pos: abs, len: (m[0] || '').length };
      }
    }
    let chopped = trimmed;
    if (found) {
      const candidate = trimmed.slice(0, found.pos).replace(/\s+$/g, '');
      if (candidate.length >= trimmed.length * 0.9) chopped = candidate;
    }
    const pick = CUT_OFF_PICK[(seed + trimmed.length) % CUT_OFF_PICK.length];
    const candidate = chopped + '\n' + pick;
    if (candidate.length >= trimmed.length * 0.9) {
      return { touched: true, originalEnding: found ? trimmed.slice(found.pos, found.pos + found.len + 20) : trimmed.slice(-30), replacedEnding: '\n' + pick, newContent: candidate, primary: cls.primary };
    }
  }
  return { touched: false, originalEnding: '', replacedEnding: '', newContent: text, primary: cls.primary };
}
