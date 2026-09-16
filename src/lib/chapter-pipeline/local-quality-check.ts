/**
 * local-quality-check.ts — STATION 4A：本地 5 栏分质检（毫秒级）
 *
 * 本文件是 P0 改造的核心模块。目标：
 *   在 stream/route.ts 完成单章正文生成后、保存到 DB / 推进下一章之前，
 *   立刻进行 5 栏分 + FAILURE_REPORT，最终给一章一个 0-100 的 LOCAL_SCORE。
 *
 *   通过门槛（STATION 6 门禁）：
 *     finalLocalScore >= 80  且  无「ERROR 级硬矛盾」
 *
 * 5 栏分：
 *   ① 账本一致性（15 项状态硬矛盾）— 30 分底分，每项 ERROR -15 / WARN -5
 *   ② 语义复述检测              — 15 分底分，ERROR -15 / WARN -8
 *   ③ AI 套话密度                — 15 分底分，密度越高扣越多
 *   ④ 视角/人称越界              — 20 分底分，第一人称视角错漏 -20
 *   ⑤ 结尾结构分类               — 20 分底分，真人类型 +分，AI 模板/连着 3 章同类扣分
 *
 * 输出 FAILURE_REPORT（给模型回炉重写用的结构化文本）：
 *   必须把「具体命中的第几条 / 账本的哪个字段 / 原文中的哪个句子 / 应该怎么改」全部列清楚，
 *   避免只给模型一句笼统的"你这里有问题"让它自己猜。
 */

import {
  semanticDedupReport,
  type SemanticDedupReport,
} from './semantic-dedup';
import {
  classifyEnding,
  endingRotationPenalty,
  cutOffPickList,
  type EndingCategory,
  type EndingClassification,
} from './ending-rotator';

/** POV/复述统计前需剔除的模板句：现行第三人称通用切尾句池 + 历史遗留第一人称武侠串文句（旧章节残留扫描） */
const POV_NOISE_PICKS: string[] = [
  ...cutOffPickList,
  // —— 历史遗留（旧版 CUT_OFF_PICK，曾作为切尾句写入大量章节）——
  '怀里的木匣又重重地硌了我一下', '刀已出鞘半截，却再难推进半分', '我攥紧了青砖棱子，手心全是冷汗',
  '指缝间的窝头已经凉透，我却没敢松手', '门外的雨更大了', '远处传来三声梆子，两短一长',
  '榻下那人忽然抬眼看我', '他咳出来的血溅在门槛边，像一行没写完的字',
  // —— 其他高频模板噪声 ——
  '风在这一刻仿佛凝固住了', '夜色里传来三声梆子响', '他的背影在路灯下拖得很长很长', '系统提示',
];

export type QualityItemLevel = 'ERROR' | 'WARN' | 'PASS';

export interface QualityIssue {
  id: string;              // 稳定 id，如 CONSISTENCY-03 / DEDUP / CLICHE / POV / ENDING
  level: QualityItemLevel;
  title: string;           // 短标题（可展示在前端）
  detail: string;          // 详细描述：命中了什么 + 应如何修改
  penalty: number;         // 扣分（正数表示扣分幅度）
}

export interface LocalQualityReport {
  finalScore: number;      // 0~100
  pass: boolean;           // 是否通过门禁（>= 80 且无 ERROR）
  hardContradiction: boolean; // 是否存在硬矛盾（true 必须回炉或中断批量）
  columns: {
    consistencyScore: number; // 0~30
    dedupScore: number;       // 0~15
    clicheScore: number;      // 0~15
    povScore: number;         // 0~20
    endingScore: number;      // 0~20
    intraChapterRepeatPenalty?: number; // 负值·扣分
    povSwitchPenalty?: number;           // 负值·扣分
  };
  issues: QualityIssue[];
  dedupReport?: SemanticDedupReport;
  endingReport?: EndingClassification;
  aiClicheDensity: number;   // ‰ 千分比（命中条数 ×1000 / 总字数）
  failureReport: string;     // 给 LLM 回炉重写用的 FAILURE_REPORT 文本

  // deprecated creative-hub shim
  marketHotness?: {
    total: number;
    grade: string;
    dimension: Record<string, number>;
    creativeSupplementTips: string[];
  };

}

/* =========================================================
 * 账本 & 15 项一致性（P0 · STATION 4A-1）
 * ========================================================= */
export interface ChapterStateLedger {
  /** 人物外观 */
  protagonistName?: string;
  outfit?: string;          // 衣着：如"玄色短打"
  hairstyle?: string;       // 发型：如"束发""披发"
  bodyBuilt?: string;       // 身形：如"瘦削"
  accessories?: string[];   // 佩戴道具：如["斗笠","木匣","短剑"]
  /** 伤情 / 身体状态 */
  injuries?: string[];      // 已知伤情：如["左肩渗血""右臂擦伤"]
  hungry?: boolean;         // 饿
  tired?: boolean;          // 累
  /** 手上/身上持有物 */
  holding?: string[];       // 如["窝头""木匣子"]
  pockets?: string[];       // 如["铜钱三枚"]
  /** 位置 / 场景 */
  scene?: string;           // 如"破庙门槛"
  positionInScene?: string; // 如"门槛外蹲着"
  weather?: string;         // 如"阴雨"
  daytime?: string;         // 如"深夜"
  /** 视角（默认第一人称，可选第三人称有限） */
  pov?: 'first' | 'third-limited';
  povCharacterName?: string;
}

// 命中账本项的禁止表达（正则），每项命中即与账本矛盾
const CONSISTENCY_RULES: Array<{
  id: string;
  title: string;
  /** 根据账本决定是否激活；激活后返回"禁止出现的正则数组" */
  build: (ledger: ChapterStateLedger) => { forbiddenRegex: RegExp[]; expectedState: string } | null;
}> = [
    // CS-01 衣着矛盾
    {
      id: 'CONSISTENCY-01',
      title: '人物衣着矛盾',
      build: (L) => {
        if (!L.outfit) return null;
        // 提取关键词：玄色/短打 / 白衣 / 襦裙 / 锦袍 等，列出典型"与该衣着冲突"的说法
        const outfit = L.outfit;
        const forbidden: RegExp[] = [];
        if (/玄色|短打|布衣|粗衣/.test(outfit)) {
          forbidden.push(/(白衣|锦袍|绸缎|丝袍|华贵|华服|襦裙|绫罗)/);
        }
        if (/白衣|书生/.test(outfit)) {
          forbidden.push(/(玄色短打|短打|粗布|布衣|衣衫褴褛|土布)/);
        }
        if (/锦袍|绸缎|华服/.test(outfit)) {
          forbidden.push(/(布衣|粗布|短打|土布|褴褛)/);
        }
        return { forbiddenRegex: forbidden, expectedState: outfit };
      },
    },
    // CS-02 伤情：左肩渗血 禁止写"面无表情/完全正常/毫发无损"
    {
      id: 'CONSISTENCY-02',
      title: '伤情遗忘（左肩渗血类）',
      build: (L) => {
        const injuries = L.injuries ?? [];
        if (injuries.length === 0) return null;
        const hasBleeding = injuries.some((i) => /渗血|流血|出血|血|伤口/.test(i));
        const hasArm = injuries.some((i) => /臂|肩|手/.test(i));
        const hasLeg = injuries.some((i) => /腿|膝|脚|踝/.test(i));
        const forbidden: RegExp[] = [];
        forbidden.push(/(毫发无损|毫发无伤|完好无损|安然无恙|未受分毫|丝毫无伤|全身完好)/);
        forbidden.push(/(谈笑风生|大步流星|神清气爽|面色如常|从容不迫|一派轻松)/);
        if (hasBleeding) {
          forbidden.push(/(面不改色|毫不在意|笑.*未受伤|像没事人一样)/);
        }
        if (hasArm) {
          forbidden.push(/(双臂张开|双臂.*抱|两手.*抱拳|左右开弓|双手捧起|双手高举)/);
        }
        if (hasLeg) {
          forbidden.push(/(健步如飞|飞奔|一跃而起|跳了起来|三步两步|连跑带跳)/);
        }
        return { forbiddenRegex: forbidden, expectedState: injuries.join(' + ') };
      },
    },
    // CS-03 饿/累 矛盾
    {
      id: 'CONSISTENCY-03',
      title: '饥饿/疲惫状态矛盾',
      build: (L) => {
        if (!L.hungry && !L.tired) return null;
        const forbidden: RegExp[] = [];
        if (L.hungry) {
          forbidden.push(/(酒足饭饱|吃得过瘾|腹中满满|不饿|饱食|饱餐|吃饱喝足|毫无饥饿)/);
        }
        if (L.tired) {
          forbidden.push(/(精力充沛|精神抖擞|神清气爽|生龙活虎|不觉半点疲惫)/);
        }
        return { forbiddenRegex: forbidden, expectedState: `hungry=${L.hungry ?? false} tired=${L.tired ?? false}` };
      },
    },
    // CS-04 持有物凭空/消失
    {
      id: 'CONSISTENCY-04',
      title: '持有物凭空出现或凭空消失',
      build: (L) => {
        const holding = L.holding ?? [];
        if (holding.length === 0) return null;
        // 如果账本持有窝头/木匣，则本章开头不能凭空出现与账本完全无关的"剑已出鞘""短剑寒光"这类主手换道具
        const forbidden: RegExp[] = [];
        const hasFood = holding.some((h) => /窝头|饼|饭|面|干粮|包子/.test(h));
        const hasWoodenBox = holding.some((h) => /木匣|匣子|木盒|盒/.test(h));
        const hasSword = holding.some((h) => /剑|短剑|刀|匕首/.test(h));
        if (hasFood || hasWoodenBox) {
          if (!hasSword) {
            forbidden.push(/(剑已出鞘|短剑寒光|拔剑|抽刀|握着剑|手里.*剑|手中.*刀)/);
          }
        }
        return { forbiddenRegex: forbidden, expectedState: `holding: ${holding.join(',')}` };
      },
    },
    // CS-05 场景/位置跳跃
    {
      id: 'CONSISTENCY-05',
      title: '场景位置无过渡跳跃',
      build: (L) => {
        if (!L.positionInScene) return null;
        const pos = L.positionInScene;
        const forbidden: RegExp[] = [];
        // 在门槛 / 门外 -> 本章开头 300 字直接写"在堂屋中央"没有"迈步进门/跨入/推门"等过渡
        if (/门槛|门外|门口|屋外|檐下/.test(pos)) {
          forbidden.push(/(屋中央|堂屋中央|庙中央|室内中央|房间正中|里屋|灶前|桌旁|店内深处|柜台前|院子当中)/);
        }
        return { forbiddenRegex: forbidden, expectedState: pos };
      },
    },
    // CS-06 天气/时段矛盾
    {
      id: 'CONSISTENCY-06',
      title: '天气/昼夜状态矛盾',
      build: (L) => {
        if (!L.weather && !L.daytime) return null;
        const forbidden: RegExp[] = [];
        if (/雨|阴雨|雨丝|大雨|暴雨/.test(L.weather ?? '')) {
          forbidden.push(/(天晴|明月当空|星光璀璨|万里无云|日头正盛|烈日当空)/);
        }
        if (/深夜|半夜|子夜|亥时|三更/.test(L.daytime ?? '')) {
          forbidden.push(/(清晨|正午|日头|下午|傍晚前|白天|朝阳|晨光)/);
        }
        return { forbiddenRegex: forbidden, expectedState: `weather=${L.weather ?? '-'} daytime=${L.daytime ?? '-'}` };
      },
    },
  ];

export interface ConsistencyCheckResult {
  issues: QualityIssue[];
  score: number; // 满分 30
}

function findForbiddenOccurrences(
  text: string,
  forbiddenRegex: RegExp[],
): { phrase: string; index: number; regex: RegExp }[] {
  const occurrences: { phrase: string; index: number; regex: RegExp }[] = [];
  for (const re of forbiddenRegex) {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = r.exec(text)) !== null) {
      // 只取开头 300 字内的命中作为"承接矛盾"（后续中段有合理叙事会自行消除）
      if (m.index > 300) continue;
      occurrences.push({ phrase: m[0], index: m.index, regex: re });
      if (!re.global) break;
    }
  }
  return occurrences;
}

export function runConsistencyCheck(
  chapterContent: string,
  ledger: ChapterStateLedger,
): ConsistencyCheckResult {
  const issues: QualityIssue[] = [];
  const head = (chapterContent ?? '').replace(/\s+/g, '');
  let totalDeducted = 0;

  for (const rule of CONSISTENCY_RULES) {
    const built = rule.build(ledger);
    if (!built) continue;
    const occ = findForbiddenOccurrences(head, built.forbiddenRegex);
    if (occ.length === 0) continue;

    // 单条规则里，命中 1 条 = WARN -5，命中 2+ 条 = ERROR -15
    const level: QualityItemLevel = occ.length >= 2 ? 'ERROR' : 'WARN';
    const penalty = level === 'ERROR' ? 15 : 5;
    totalDeducted += penalty;
    const samplePhrases = occ.map((o) => `"${o.phrase}"@第${o.index}字`).slice(0, 3).join('、');
    issues.push({
      id: rule.id,
      level,
      title: rule.title,
      detail: `账本期望状态：${built.expectedState}；本章开头 300 字内出现 ${occ.length} 处矛盾：${samplePhrases}。` +
        `请在开头前 1-2 句给出自然过渡，或不要与账本状态相冲突。`,
      penalty,
    });
  }

  const score = Math.max(0, 30 - totalDeducted);
  return { issues, score };
}

/* =========================================================
 * 视角/人称越界（P0 · STATION 4A-4）
 * ========================================================= */
export function runPOVCheck(
  chapterContent: string,
  ledger: ChapterStateLedger,
): { score: number; issues: QualityIssue[] } {
  const pov = ledger.pov ?? 'first';
  const povChar = ledger.povCharacterName ?? ledger.protagonistName ?? '';
  const issues: QualityIssue[] = [];
  let score = 20;
  const content = chapterContent ?? '';

  if (pov === 'first') {
    // 第一人称：
    //   ① 不得出现"我心想"——想法就是我本人的话，直接叙述即可，"我心想"3字 AI 味极浓
    //   ② 不得对"我"出现外貌描写，除非"我"在看镜子/水面等反射
    //   ③ 不得写出他人的明确心理活动（"他心想/暗道/暗骂/暗喜"等），只能靠言行推断
    const patterns: Array<[RegExp, string, number]> = [
      [/(我心想|我暗道|我暗骂|我暗喜|我想道|我心里想)/, '第一人称"我心想/我暗道"属于 AI 模板废句，删掉改成直接叙述即可', 5],
      [/(我长着|我.*脸型|我的.*眉毛|我的.*眼睛|我的鼻子|我的嘴角|我的额头|我这.*样子)/, '第一人称视角不应描写自己的脸型/五官，除非在看水面/铜镜等反射物', 8],
      [/((?<!我)(他|她|那人|来人|掌柜|伙计|师兄|师父|黑衣人|白衣人)(?:.*?))(?:心想|暗道|暗骂|暗喜|心头一震|心下一沉|心下一动|心里想|暗自高兴|暗自恼怒)/, '第一人称视角不得直接写出他人的心理活动（他心想/暗道…），只能描写其表情/动作/对白，由读者推断', 10],
    ];
    for (const [re, explain, penalty] of patterns) {
      const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      const hits = content.match(r);
      if (!hits) continue;
      score = Math.max(0, score - penalty);
      issues.push({
        id: 'POV-01',
        level: penalty >= 10 ? 'ERROR' : 'WARN',
        title: '视角越界：第一人称心理描写',
        detail: `${explain}。共命中 ${hits.length} 处，示例：${hits.slice(0, 2).map((h) => `"${h.slice(0, 30)}"`).join('、')}`,
        penalty,
      });
    }

    // 第一人称应至少有 3 次以上"我"字出现（非主角视角全写第三人称属于跑飞）
    const firstPronounMatches = content.match(/我(?!们)/g);
    if (!firstPronounMatches || firstPronounMatches.length < 3) {
      score = Math.max(0, score - 15);
      issues.push({
        id: 'POV-02',
        level: 'ERROR',
        title: '视角丢失：第一人称变成第三人称',
        detail: `设定为第一人称（主角 ${povChar || '未指定'}），但本章"我"字仅出现 ${firstPronounMatches?.length ?? 0} 次，疑似直接转写第三人称上帝视角。请严格回到"我"的叙事视角。`,
        penalty: 15,
      });
    }
  }

  return { score, issues };
}

/* =========================================================
 * AI 套话密度（P0 · STATION 4A-3）
 * ========================================================= */
const AI_CLICHES = [
  /(不由得|不禁|不由|不自觉|下意识|情不自禁|忍俊不禁)/,
  /(眼中闪过一丝|眸中闪过|眼底闪过|眸底闪过|眼神微微|目光一凝|眼神一动|目光微动|眼神复杂)/,
  /(微微一(怔|愣|顿|笑|叹|沉|震)|淡淡一(笑|叹|说)|冷冷一(笑|哼)|轻轻一(笑|叹|摇头))/,
  /(心中一动|心头一(震|紧|沉|凛|松)|心下(一动|一沉|一惊|了然|稍安))/,
  /(深吸一口气|叹了口气|轻叹了一声|轻叹一声|倒吸一口凉气)/,
  /(仿佛|似乎|宛若|犹如|宛如|好似|恍若|如同)[^。！？!?]{0,30}(一般|一样|似的|般)/,
  /(一股莫名的|一股难言的|一种说不出的|一种无法言喻的|一股难以言表的)/,
  /(不知为何|不知怎的|不知什么时候|不知从何时起|不知过了多久|也不知过了多久)/,
  /(在这一刻|此时此刻|到了最后|事到如今|话说回来|总而言之|言归正传|归根结底)/,
  /(这一幕|这一切|这幅画面|这个念头|这种感觉|这个想法)/,
  /(而他却不知道|他不知道的是|然而他并不知道|可惜他不知道|殊不知)/,
  /(眼神中透露出|目光中带着|脸上露出了|嘴角微微上扬|脸上浮现出)/,
  /(与此同时|在那之后|接下来的日子里|从那天起|从此以后|后来的后来)/,
  /(时间一分一秒|时光荏苒|岁月如梭|白驹过隙|转眼间|转瞬即逝|一晃|光阴似箭)/,
  /(夜凉如水|月色如华|月华如练|寒风凛冽|烈日当空|乌云密布|狂风大作)/,
  /(剑眉星目|面如冠玉|玉树临风|英俊潇洒|风度翩翩|气宇轩昂|沉鱼落雁|闭月羞花|倾国倾城|秀色可餐)/,
  /(不禁让人心头|让人不禁|令人|使人)/,
  /(一切尽在不言中|仿佛一切都静止了|时间仿佛静止了|空气仿佛凝固了)/,
  /(这注定是|终将成为|必将载入|将改变)/,
  /(而这，不过是|故事才刚刚开始|命运的齿轮开始缓缓转动)/,
  /(话说(那天|那日|那晚)|说起(那天|那日|那晚)|且说(那天|那日|那晚))/,
  /(真是.*啊|简直.*了|太.*了|何等的|何其)/,
];

const AI_STRUCTURAL_CLICHES = [
  /(心中一动.*?深吸一口气|深吸一口气.*?心中一动)/,
  /(眼中闪过一丝.*?微微一[怔愣住笑]|微微一[怔愣住笑].*?眼中闪过一丝)/,
  /(不知为何.*?一股难言的|一股难言的.*?不知为何)/,
  /(仿佛.*一般.*?似的)/,
  /(与此同时.*?在那一刻|在那一刻.*?与此同时)/,
];

export function runClicheCheck(chapterContent: string): {
  score: number;
  density: number; // ‰
  hits: { phrase: string; index: number }[];
  issues: QualityIssue[];
} {
  const content = chapterContent ?? '';
  const chars = Math.max(1, content.length);
  const hits: { phrase: string; index: number }[] = [];

  for (const re of AI_CLICHES) {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = r.exec(content)) !== null) {
      hits.push({ phrase: m[0], index: m.index });
      if (!r.global) break;
    }
  }

  let struct = 0;
  for (const re of AI_STRUCTURAL_CLICHES) {
    const count = (content.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) ?? []).length;
    struct += count;
  }

  // 总命中 = 单次套话 + 2 × 结构套话（结构套话权重更高）
  const totalHits = hits.length + struct * 2;
  const density = (totalHits * 1000) / chars; // ‰

  let score = 15;
  let level: QualityItemLevel = 'PASS';
  let deduction = 0;
  let reason = '';

  if (density >= 30) {
    deduction = 15;
    level = 'ERROR';
    reason = `AI 套话密度 30‰ 以上（${density.toFixed(1)}‰），全章腔调到全 AI 模板，必须重写。`;
  } else if (density >= 15) {
    deduction = 10;
    level = 'ERROR';
    reason = `AI 套话密度 ≥ 15‰（${density.toFixed(1)}‰），读者明显能读出 AI 味。`;
  } else if (density >= 8) {
    deduction = 6;
    level = 'WARN';
    reason = `AI 套话密度 ≥ 8‰（${density.toFixed(1)}‰），开头和中间段可删一批模板词。`;
  } else if (density >= 4) {
    deduction = 3;
    level = 'WARN';
    reason = `AI 套话密度 ≥ 4‰（${density.toFixed(1)}‰），少量套话可清洗。`;
  }
  score = Math.max(0, score - deduction);

  const issues: QualityIssue[] = [];
  if (level !== 'PASS') {
    const sample = hits.slice(0, 6).map((h) => `"${h.phrase.slice(0, 20)}"@${h.index}`).join('、');
    issues.push({
      id: 'CLICHE',
      level,
      title: 'AI 套话密度过高',
      detail: `${reason}共命中 ${hits.length} 条词 + ${struct} 条结构组合。示例：${sample}。改写建议：(1) 把"微微一X/眼中闪过"全删掉，用具体动作和对白替代；(2) 删除"心中一动/深吸一口气"结构组合；(3) 删除"夜凉如水/月华如练"烂俗写景，用 1 个具体的环境细节替代。`,
      penalty: deduction,
    });
  }

  return { score, density, hits, issues };
}

/* =========================================================
 * 综合质检总入口
 * ========================================================= */
export interface LocalQualityCheckInput {
  chapterNumber: number;
  chapterContent: string;
  /** 账本：来自上章结尾状态提取 */
  ledger: ChapterStateLedger;
  /** 上一章结尾（复述检测用，建议 400-600 字） */
  previousChapterTail: string;
  /** 最近 2-3 章的结尾类型（用于结尾轮换判定） */
  recentEndingCategories?: EndingCategory[];

  // deprecated creative-hub shims
  chapterHook?: string;
  totalChapters?: number;
  characterKeywords?: string[];
  creativeHubSummary?: string;

}

/** 把所有问题串成 FAILURE_REPORT（给 LLM 回炉重写的自然语言文本） */
function buildFailureReport(
  input: LocalQualityCheckInput,
  report: LocalQualityReport,
): string {
  const { chapterNumber } = input;
  const lines: string[] = [];
  lines.push(`【FAILURE_REPORT · 第${chapterNumber}章 本地质检未通过】`);
  lines.push(`最终分数：${report.finalScore}/100（通过门槛 ≥80，且无硬矛盾）；硬矛盾：${report.hardContradiction ? '有' : '无'}`);
  lines.push(`五栏分：一致性=${report.columns.consistencyScore}/30 · 复述=${report.columns.dedupScore}/15 · 套话=${report.columns.clicheScore}/15 · 视角=${report.columns.povScore}/20 · 结尾=${report.columns.endingScore}/20`);
  lines.push('');
  lines.push(`— 命中问题清单（共 ${report.issues.length} 条）—`);

  for (const issue of report.issues) {
    lines.push(`  [${issue.level}] ${issue.id} · ${issue.title}（-${issue.penalty}）`);
    lines.push(`    → ${issue.detail}`);
  }

  if (report.dedupReport && report.dedupReport.level !== 'pass') {
    lines.push(`  [复述${report.dedupReport.level.toUpperCase()}] overall=${(report.dedupReport.overall * 100).toFixed(1)}%，字面=${(report.dedupReport.literal * 100).toFixed(1)}% · 句级=${(report.dedupReport.sentence * 100).toFixed(1)}% · 事件=${(report.dedupReport.event * 100).toFixed(1)}%`);
    if (report.dedupReport.repeatedSentences && report.dedupReport.repeatedSentences.length > 0) {
      lines.push('    疑似复述句子：');
      for (const s of report.dedupReport.repeatedSentences) lines.push(`      - ${s}`);
    }
  }

  lines.push('');
  lines.push('【重写指令】');
  lines.push('1. 严禁整体复述上一章剧情；本章必须从【上章结尾事件完全结束之后】开始。');
  lines.push(`2. 账本状态（必须严格遵守，不得矛盾）：${JSON.stringify(input.ledger)}`);
  lines.push('3. 按上面命中问题逐条修正；禁止再出现相同的 AI 套话和结构组合。');
  lines.push('4. 严格遵守视角约束；不得越界写他人心理活动。');
  lines.push('5. 重新输出完整正文（不必写"第X章"标题）。');

  return lines.join('\n');
}

export function runLocalQualityCheck(input: LocalQualityCheckInput): LocalQualityReport {
  const { chapterContent, ledger, previousChapterTail, recentEndingCategories = [] } = input;

  // ① 账本一致性
  const consistency = runConsistencyCheck(chapterContent, ledger);
  // ② 语义复述
  const currentHead = (chapterContent ?? '').slice(0, 600);
  const dedup = semanticDedupReport(previousChapterTail, currentHead);
  let dedupScore = 15;
  const dedupIssues: QualityIssue[] = [];
  if (dedup.level === 'error') {
    dedupScore = 0;
    dedupIssues.push({
      id: 'DEDUP',
      level: 'ERROR',
      title: '复述上章：换说法重写完整剧情',
      detail: `综合复述度 ${(dedup.overall * 100).toFixed(1)}%（事件 ${(dedup.event * 100).toFixed(1)}%），属于「把上章剧情用不同的话再写一遍」。必须把开头整体砍掉，从新动作/新对白开始。`,
      penalty: 15,
    });
  } else if (dedup.level === 'warn') {
    dedupScore = 15 - 8;
    dedupIssues.push({
      id: 'DEDUP',
      level: 'WARN',
      title: '复述嫌疑：开头 1-2 句仍贴近上章',
      detail: `综合复述度 ${(dedup.overall * 100).toFixed(1)}%。建议删掉开头的过渡废句，直接用第一个动作开章。`,
      penalty: 8,
    });
  }

  // ③ AI 套话密度
  const cliche = runClicheCheck(chapterContent);
  // ④ 视角越界
  const pov = runPOVCheck(chapterContent, ledger);
  // ⑤ 结尾结构
  const ending = classifyEnding(chapterContent);
  const rotPenalty = endingRotationPenalty(recentEndingCategories, ending.primary);

  let endingScore = Math.round(ending.score * 20); // 0~1 → 0~20
  const endingIssues: QualityIssue[] = [];
  if (!ending.isHuman) {
    const catPenalty = Math.min(10, ending.aiHitDensity * 4);
    endingScore = Math.max(0, endingScore - catPenalty);
    endingIssues.push({
      id: 'ENDING-AI',
      level: ending.aiHitDensity >= 2 ? 'ERROR' : 'WARN',
      title: '结尾是 AI 模板类',
      detail: `结尾主类型：${ending.primary}（AI 模板类），命中 ${ending.aiHitDensity} 类 AI 模板词。示例：${ending.allHits.filter((h) => h.category.startsWith('ai-')).slice(0, 2).map((h) => `"${h.phrase}"`).join('、')}。请改用"动作切断 / 钩子问句 / 细节揭示 / 台词截断"其中之一做结尾。`,
      penalty: catPenalty,
    });
  }
  if (rotPenalty.level !== 'pass') {
    const pen = rotPenalty.level === 'error' ? 12 : 6;
    endingScore = Math.max(0, endingScore - pen);
    endingIssues.push({
      id: 'ENDING-ROT',
      level: rotPenalty.level,
      title: '结尾类型连续重复',
      detail: rotPenalty.reason ?? '结尾类型与最近章节重复，造成节奏模板感。',
      penalty: pen,
    });
  }

  const issues: QualityIssue[] = [
    ...consistency.issues,
    ...dedupIssues,
    ...cliche.issues,
    ...pov.issues,
    ...endingIssues,
  ];

// ===== 【同章桥段复述 / POV 漂移 硬性扣分 (D-3)】=====
  let intraChapterPenalty = 0;
  let povSwitchPenalty = 0;
  try {
    const rawContent = content || '';
    const blocks = rawContent.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
    // --- A. POV 漂移检测：句级 4 句滑窗（覆盖段内漂移场景）---
    // 先把全文按句切，再做 4 句滑窗 POV 标签，相邻滑窗 POV 明确相反即算 1 次 switch
    const _qc_pov_split = (s: string): string[] => {
      const res: string[] = [];
      let cur = '';
      let inQuote = 0;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        cur += ch;
        if ('「『“'.indexOf(ch) !== -1) inQuote++;
        if ('」』”'.indexOf(ch) !== -1) inQuote = Math.max(0, inQuote - 1);
        if (inQuote === 0 && '。！？!?；…'.indexOf(ch) !== -1) {
          const t = cur.trim(); if (t) res.push(t); cur = '';
        } else if (ch === '\n' && cur.trim()) {
          const t = cur.trim(); if (t) res.push(t); cur = '';
        }
      }
      const t = cur.trim(); if (t) res.push(t);
      return res;
    };
    // === [D9 FIX-C] POV 判定 先去对白+去模板句，再统计人称 ===
    const _cutOffPicks: string[] = POV_NOISE_PICKS;
    const _stripPovNoise = (s: string): string => {
      let out = s || '';
      out = out.replace(/「[^」\n]*?」/g, ' ').replace(/『[^』\n]*?』/g, ' ');
      out = out.replace(/"[^"\n]*?"/g, ' ').replace(/“[^”\n]*?”/g, ' ');
      for (const pk of _cutOffPicks) if (pk) out = out.split(pk).join(' ');
      return out;
    };
    const _qc_sents = _qc_pov_split(rawContent);
    let switches = 0;
    let _lastPov: 'first' | 'third' | 'none' = 'none';
    for (let _i = 0; _i < _qc_sents.length; _i += 2) {
      const _rawWin = _qc_sents.slice(_i, _i + 4).join(' ');
      if (_rawWin.length < 20) continue;
      const _win = _stripPovNoise(_rawWin);  // FIX-C: 对白+模板句前置剔除
      const _f = (_win.match(/(^|[^A-Za-z0-9_])[我咱俺](?!们)|我的|俺的|咱的|老子/g) || []).length;
      const _he = (_win.match(/[他她它]|他们|她们/g) || []).length;
      const _pr = (_win.match(/[\u4E00-\u9FFF]{2,4}(?=[的了在把被将向想对去到说喊问道看吃听见掏出])/g) || []).length;
      const _t = _he + _pr;
      let tag: 'first' | 'third' | 'none' = 'none';
      if (_f >= _t + 2) tag = 'first';
      else if (_t >= _f + 1) tag = 'third';
      if (tag !== 'none' && _lastPov !== 'none' && tag !== _lastPov) switches++;
      if (tag !== 'none') _lastPov = tag;
    }
    // 阈值：句级 window POV 切换非常明确才是事故 → ≥1 次开始扣分；≥2 次 ERROR
    if (switches >= 1) {
      povSwitchPenalty = switches >= 3 ? 22 : switches === 2 ? 15 : 10;
    }
// --- B. 桥段复述检测：连续 4 句 × 2-gram Jaccard ≥ 0.60 → 同章复述 ---
    // FIX-C2: 对白内容是台词呼应，不算桥段复述 → 先剔除对白+模板句
    const _dedupNoiseStrip = (s: string): string => {
      let out = s || '';
      out = out.replace(/「[^」\n]*?」/g, ' ').replace(/『[^』\n]*?』/g, ' ');
      out = out.replace(/"[^"\n]*?"/g, ' ').replace(/“[^”\n]*?”/g, ' ');
      const picks2: string[] = POV_NOISE_PICKS;
      for (const pk of picks2) if (pk) out = out.split(pk).join(' ');
      return out;
    };
    const sents = _dedupNoiseStrip(rawContent)
      .replace(/\r\n?/g, '\n')
      .split(/(?<=[。！？!?；…])|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const normSim = (s: string) =>
      s
        .replace(/[「」『』"“”‘'()（）【】\[\]《》]/g, '')
        .replace(/[，。！？!?；：、…—·,.\-\s\t\u3000/\\_=+*#@$%^&<>{}|~0-9]+/g, '')
        .trim();
    const seenWindows: string[] = [];
    let repeatCount = 0;
    for (let i = 0; i < sents.length; i += 2) {
      const win = sents.slice(i, i + 4).join(' ');
      if (win.length < 50) continue;
      const nw = normSim(win);
      if (!nw) continue;
      // bigram 集合 -> 拼成单个字符串存储（避免 Set 遍历开销但仍能逐字符 substring 查交）
      const sa = new Set<string>();
      for (let j = 0; j < nw.length - 1; j++) sa.add(nw[j] + nw[j + 1]);
      let foundDup = false;
      for (const sk of seenWindows) {
        let inter = 0;
        for (const x of sa) if (sk.includes(x)) inter++;
        const uni = sa.size + Math.max(0, sk.length - sa.size + inter);
        if (uni > 0 && inter / Math.max(2, Math.min(sa.size, 1000)) >= 0.60) {
          repeatCount++;
          foundDup = true;
          break;
        }
      }
      const arr: string[] = [];
      for (const x of sa) arr.push(x);
      seenWindows.push('\x01' + arr.join('\x01') + '\x01');
      if (foundDup) {
        // 命中复述 → 登记 ERROR 级 issue
        issues.push({
          level: 'ERROR',
          code: 'INTRA_CHAPTER_REPEAT',
          message:
            '检测到同章内桥段复述（前后两段发生的剧情/对白骨架相似度≥60%）。示例片段：' +
            win.slice(0, 40),
        });
      }
    }
    if (repeatCount >= 1) {
      intraChapterPenalty = repeatCount >= 3 ? 25 : repeatCount === 2 ? 18 : 12;
    }
    if (povSwitchPenalty > 0) {
      issues.push({
        level: povSwitchPenalty >= 15 ? 'ERROR' : 'WARN',
        code: 'INTRA_CHAPTER_POV_SWITCH',
        message: '同章内叙事人称(POV)发生 ' + switches + ' 次 第一↔第三人称 切换（应全程保持同一种）。',
      });
    }
  } catch (e) {
    issues.push({
      level: 'WARN',
      code: 'INTRA_CHAPTER_CHECKS_SKIP',
      message: '同章复述/POV 检查跳过：' + (e instanceof Error ? e.message : String(e)),
    });
  }

  const beforeFinalScore = Math.max(
    0,
    Math.min(100, consistency.score + dedupScore + cliche.score + pov.score + endingScore),
  );
  const finalScore = Math.max(0, beforeFinalScore - intraChapterPenalty - povSwitchPenalty);
  const hardContradiction =
    consistency.issues.some((i) => i.level === 'ERROR') ||
    dedup.level === 'error' ||
    pov.issues.some((i) => i.level === 'ERROR') ||
    cliche.issues.some((i) => i.level === 'ERROR') ||
    endingIssues.some((i) => i.level === 'ERROR') ||
    issues.some((i) => i.code === 'INTRA_CHAPTER_REPEAT' && i.level === 'ERROR') ||
    issues.some((i) => i.code === 'INTRA_CHAPTER_POV_SWITCH' && i.level === 'ERROR');
  // 阈值：总分 ≥ 80 且两条硬性红线分别 <12 / <10 才能 pass（否则 STATION 6 打回重写）
  const pass =
    finalScore >= 80 && !hardContradiction && intraChapterPenalty < 12 && povSwitchPenalty < 10;

  const report: LocalQualityReport = {
    finalScore,
    pass,
    hardContradiction,
    columns: {
      consistencyScore: consistency.score,
      dedupScore,
      clicheScore: cliche.score,
      povScore: pov.score,
      endingScore,
      intraChapterRepeatPenalty: -intraChapterPenalty,
      povSwitchPenalty: -povSwitchPenalty,
    },
    issues,
    dedupReport: dedup,
    endingReport: ending,
    aiClicheDensity: cliche.density,
    failureReport: '',
  };

  report.failureReport = buildFailureReport(input, report);
  return report;
}
