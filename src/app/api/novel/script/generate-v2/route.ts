import { NextRequest, NextResponse } from 'next/server';
import { getModelName, getTemperature, getRawAIConfig } from '@/lib/ai-config';
import { extractJsonObject } from '@/lib/json-parser';
import { sanitizeChapterText } from '@/lib/chapter-text-cleaner';
import { getPromptWithFallback } from '@/lib/prompt-helper';
import { scriptManager } from '@/storage/database/scriptManager';
import { novelManager } from '@/storage/database/novelManager';
import { validateScreenplay } from '@/lib/screenplay/quality-validator';

export const maxDuration = 600;

// ==================== 类型定义 ====================

interface ChapterAnalysis {
  characters: Array<{ id: string; name: string; role: string; personality: string; emotionalState: string; relationships: string[] }>;
  locations: Array<{ id: string; name: string; type: string; timeOfDay: string; atmosphere: string; props: string[] }>;
  emotionBeats: Array<{ type: string; description: string; fromEmotion: string; toEmotion: string; trigger: string }>;
  keyConflicts: string[];
  unresolvedThreads: string[];
  dialogueCount: number;
  actionDensity: string;
  pacing: string;
  summary: string;
  keyMoments: Array<{ description: string; type: string }>;
  // ====== 洪水进门风格新增：道具 / 时间轴 / 角色状态寄存器 ======
  macGuffins?: Array<{ name: string; physicalState: string; lastHeldBy: string; narrativeValue: string; charRange?: [number, number] }>;
  timeAxis?: Array<{ label: string; charRange: [number, number]; weatherOrLight?: string; elapsed?: string }>;
  characterStatesAtMoments?: Array<{ character: string; charIndex: number; physical: string; emotional: string; goal: string; onScreen: boolean }>;
  chapterEndingCliffhanger?: string;   // 本集结尾必须被下一集第 1 分镜承接的悬念钩子（20~60 字）
  chapterOpeningCallback?: string;     // 本章开场，必须承接上一章 chapterEndingCliffhanger 的写法说明
}

interface SceneOutline {
  sceneIndex: number;
  sceneTitle: string;
  purpose: string;
  location: string;
  characters: string[];
  emotionalGoal: string;
  keyAction: string;
  conflict: string;
  setup: string;
  payoff: string;
  // ====== 洪水进门风格新增 ======
  totalSceneCount?: number;
  charRange?: [number, number];          // 对应正文的字符范围（保证分镜时间线 100% 不重叠、无倒叙）
  carriesHookFromPrevChapter?: string;   // 若为本章第 1 分镜，承接上一章 chapterEndingCliffhanger 的具体描写
  leavesHookForNextChapter?: string;     // 若为本章最后一分镜，输出悬念钩子
  macGuffinsTouched?: string[];          // 本分镜触碰/状态变化的关键道具清单
  characterDelta?: Array<{ name: string; physical: string; emotional: string; goal: string }>; // 本分镜后，角色状态改变的增量
  timeAndWeather?: string;               // 对应洪水进门「清晨/日/夜/次日」时间标签
}

interface DetailedScene {
  sceneIndex: number;
  sceneTitle: string;
  description: string;
  actions: string;
  dialogues: Array<{ character: string; line: string }>;
  stageDirections: string;
  sourceBeat: string;
  sceneTransition: string;
  location: string; // 大场景地区（如"阴司办事处"、"云小汐宿舍"）：同一栋建筑/大地点内所有分镜必须用字完全一致，真正换地方时才更新
  // ===== 标准分镜字段（前端按「景别/机位/时长/镜头运动/画面/对白/音效BGM」格式展示）=====
  shotType?: string;       // 景别：远景 / 全景 / 中景 / 近景 / 特写 / 大特写 等
  cameraAngle?: string;    // 机位：正面 / 侧面 / 背面 / 俯拍 / 仰拍 / 过肩 / 主观视角 等
  duration?: string;       // 时长：如 "12秒"、"5秒"（整数 + 秒）
  cameraMovement?: string; // 镜头运动：固定 / 轻微晃动 / 快速摇摄 / 推镜 / 拉镜 / 跟拍 / 升降 等
  visual?: string;         // 画面：纯画面描述（含环境+人物动作+表情，不含对白与音效；至少 40 字）
  soundDesign?: string;    // 音效/BGM：环境音 + 人物呼吸声/脚步声等 + 背景音乐风格描写
}

interface ChapterBible {
  characters: Record<string, { name: string; role: string; appearance: string; personality: string; currentEmotionalState: string; lastSeenChapter: number; lastSeenLocation: string; lastAction: string }>;
  locations: Record<string, { name: string; type: string; description: string; props: string[]; lastSeenChapter: number }>;
}

interface ChapterContinuity {
  chapterIndex: number;
  chapterTitle: string;
  endingState: string;
  pendingConflicts: string[];

  characterStates: Record<string, string>;
  locationStates: Record<string, string>;
  lastSceneTitle: string;
  lastEmotionalBeat: string;
  // ====== 洪水进门风格新增 ======
  chapterEndingCliffhanger: string;   // 下一章第 1 分镜的承接硬锚点
  chapterEndingSnapshot: {
    timeOfDay: string;                // 离开时的时间标签（清晨/日/夜/次日）
    location: string;                 // 离开时的大地点
    onScreenCharacters: string[];     // 画面最后在场人物
    macGuffinsInPlay: string[];       // 画面最后在动的道具（如"铁箱滑入水中"）
    dominantEmotion: string;          // 主导情绪，如"刘桂兰无声落泪的寒心"
  };
  macGuffinLedger: Array<{ name: string; chapterIndex: number; lastPhysicalState: string; lastHeldBy: string; lastLocation: string }>;
}

// ==================== 工具函数 ====================

function toIntegerOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(num) ? num : null;
}

function cleanText(value: any): string {
  let text = sanitizeChapterText(typeof value === 'string' ? value : '');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\s+([，。！？；：、])/g, '$1');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function calcTargetSceneCount(wordCount: number): number {
  const base = Math.round(wordCount / 800 * 5);
  return Math.max(5, Math.min(base, 20));
}

function safeEnqueue(controller: ReadableStreamDefaultController, data: string): boolean {
  try {
    if (controller.desiredSize === null) return false;
    controller.enqueue(new TextEncoder().encode(data));
    return true;
  } catch {
    return false;
  }
}

function safeClose(controller: ReadableStreamDefaultController) {
  try { controller.close(); } catch {}
}

// ==================== 洪水进门风格：跨分镜连贯性寄存器 ====================

/** 角色寄存器（SceneStateRegister.characters）：每个角色当前的身体/情绪/目标/手持道具 */
interface CharacterFrame {
  physical: string;   // 身体状态：如"右腿缠纱布，在二楼楼梯口无法站立"
  emotional: string;  // 情绪状态：如"焦虑、责备、三分疲惫七分倔强"
  goal: string;       // 当前目标：如"先保命、追问谁让我死的"
  heldItems: string[]; // 当前手持/身上的关键道具
  lastLocation: string;
  lastSceneIndex: number;
}

/** 道具（MacGuffin）寄存器 */
interface MacGuffinFrame {
  physicalState: string; // 如"68万定期存折，在刘桂兰贴身衣袋的防水袋里"
  lastHeldBy: string;    // 最后持有者（角色名 or "环境-铁箱" or "刘桂兰贴身防水袋"）
  lastLocation: string;
  lastSceneIndex: number;
  narrativeStakes: string; // 为什么重要
}

/** 跨分镜状态机：每个 scene 生成前先读，生成后后处理再写 */
interface SceneStateRegister {
  chapterIndex: number;
  timeCursor: string;              // 当前时间游标（如"清晨 06:20"、"洪水后第2天"）
  locationCursor: string;          // 当前大地点
  weatherLight: string;            // 光线/天气
  characters: Record<string, CharacterFrame>;
  macGuffins: Record<string, MacGuffinFrame>;
  lastSceneTail: string;           // 上一分镜 visual 最后一句（承接用的画面锚点）
  lastDialogueTail: string;        // 上一分镜最后一句对白的后半句（承接用的对白锚点）
  hookFromPrevChapter: string;     // 上一章悬念钩子（仅本章 scene1 有值）
}

/**
 * 初始化/下一章承接时创建寄存器
 * - previousChapterContinuity: 上一章的 ChapterContinuity（仅跨章时传）
 * - analysis: 本章 phase1 的分析结果，用于写入 macGuffins / 角色起始态
 */
function createSceneStateRegister(
  chapterIndex: number,
  analysis: ChapterAnalysis,
  previousChapterContinuity?: ChapterContinuity,
): SceneStateRegister {
  const characters: Record<string, CharacterFrame> = {};
  for (const c of analysis.characters || []) {
    characters[c.name] = {
      physical: '待开场明确',
      emotional: c.emotionalState || '中性',
      goal: '未明确',
      heldItems: [],
      lastLocation: previousChapterContinuity?.chapterEndingSnapshot?.location || analysis.locations?.[0]?.name || '',
      lastSceneIndex: 0,
    };
  }
  const macGuffins: Record<string, MacGuffinFrame> = {};
  for (const m of analysis.macGuffins || []) {
    macGuffins[m.name] = {
      physicalState: m.physicalState,
      lastHeldBy: m.lastHeldBy,
      lastLocation: analysis.locations?.[0]?.name || '',
      lastSceneIndex: 0,
      narrativeStakes: m.narrativeValue,
    };
  }
  const firstTimeAxis = analysis.timeAxis?.[0];
  const firstLoc = analysis.locations?.[0]?.name || previousChapterContinuity?.chapterEndingSnapshot?.location || '';
  return {
    chapterIndex,
    timeCursor: firstTimeAxis?.label || firstTimeAxis?.weatherOrLight || '待明确',
    locationCursor: firstLoc,
    weatherLight: firstTimeAxis?.weatherOrLight || analysis.locations?.[0]?.atmosphere || analysis.locations?.[0]?.timeOfDay || '',
    characters,
    macGuffins,
    lastSceneTail: previousChapterContinuity
      ? `【承接上集结尾】${previousChapterContinuity.chapterEndingCliffhanger || previousChapterContinuity.endingState}`
      : '',
    lastDialogueTail: '',
    hookFromPrevChapter: previousChapterContinuity?.chapterEndingCliffhanger || '',
  };
}

/** 把寄存器压缩成 LLM 能直接读的文字块（写进 phase4 user prompt 最顶） */
function formatStateRegisterForPrompt(reg: SceneStateRegister, sceneIndex: number, totalScenes: number, outline: SceneOutline): string {
  const lines: string[] = [];
  lines.push(`===== 【洪水进门风格·跨分镜连续性寄存器｜第 ${reg.chapterIndex + 1} 集 分镜${sceneIndex}/${totalScenes}】 =====`);
  lines.push(`· 时间游标：${reg.timeCursor} ｜光线天气：${reg.weatherLight || '待明确'} ｜大地点：${reg.locationCursor || outline.location || '待从小说地点时间线选'}`);
  lines.push(`· 上一分镜画面锚点（必须先写完它的"接下来 1 秒发生什么"再进入本分镜剧情）：${reg.lastSceneTail || '（本章第1分镜）'}`);
  lines.push(`· 上一分镜对白锚点（本分镜如接对白，必须顺着它的语势接）：${reg.lastDialogueTail || '（无）'}`);
  if (sceneIndex === 1 && reg.hookFromPrevChapter) {
    lines.push(`· 【跨集硬承接·必写】上一章结尾钩子（本集第1分镜的第1个△动作必须直接回应这件事）：${reg.hookFromPrevChapter}`);
    if (outline.carriesHookFromPrevChapter) lines.push(`· 大纲承诺的承接方式：${outline.carriesHookFromPrevChapter}`);
  }
  if (sceneIndex === totalScenes && outline.leavesHookForNextChapter) {
    lines.push(`· 【跨集悬念·必留】本章最后一个分镜的结尾画面/台词必须停在：${outline.leavesHookForNextChapter}`);
  }
  lines.push('· 角色当前态（本分镜 visual/dialogue 必须以这些状态为起点，不能跳变；有变化必须在 visual 里写出具体动作）：');
  for (const [name, c] of Object.entries(reg.characters)) {
    lines.push(`   - ${name}：身体=${c.physical}｜情绪=${c.emotional}｜目标=${c.goal}｜手持=${c.heldItems.join('、') || '无'}｜上镜位置=${c.lastLocation || '?'}（上一场S${c.lastSceneIndex}）`);
  }
  if (Object.keys(reg.macGuffins).length) {
    lines.push('· 关键道具状态机（本分镜若碰触/移动/打开/转移，必须先写"在哪"再写"怎么动"；禁止凭空出现/消失）：');
    for (const [name, m] of Object.entries(reg.macGuffins)) {
      lines.push(`   - ${name}：状态=${m.physicalState}｜持有者=${m.lastHeldBy}｜所在地=${m.lastLocation}（S${m.lastSceneIndex}）｜利害=${m.narrativeStakes}`);
    }
  } else {
    lines.push('· 关键道具状态机：本章尚未识别 MacGuffin。若正文中出现"存折/铁箱/钥匙/证件/防水袋/借条/公章/执照/配方"等，必须在首次出现时登记为道具并跟踪。');
  }
  if (outline.macGuffinsTouched?.length) {
    lines.push(`· 本分镜大纲承诺要触碰的道具（必须出现、状态必须改变、并在 visual 里写清楚转移路径）：${outline.macGuffinsTouched.join('、')}`);
  }
  if (outline.timeAndWeather) lines.push(`· 本分镜承诺时间：${outline.timeAndWeather}`);
  return lines.join('\n');
}

/** 把本分镜生成结果回写到寄存器（保证下一分镜读状态不出错） */
function updateSceneStateRegister(reg: SceneStateRegister, scene: DetailedScene): SceneStateRegister {
  const visualText = scene.visual || scene.actions || scene.description || '';
  const combined = `${visualText} ${scene.stageDirections || ''}`;
  const tailSentence = visualText.replace(/\s+/g, '').slice(-38);

  // 解析对白尾巴（最后一句的后半 26 字）
  let dialogueTail = reg.lastDialogueTail;
  const d = (scene.dialogues || []);
  if (d.length > 0) {
    const last = d[d.length - 1];
    dialogueTail = `${last.character || ''}：${(last.line || '').slice(-26)}`;
  }

  // 简单关键字更新角色态（LLM 写了 visual 里的变化 → 粗暴覆盖；后续可升级为 LLM 后处理）
  const characters = { ...reg.characters };
  for (const name of Object.keys(characters)) {
    if (!combined.includes(name)) continue;
    // 从 visual 中提取"name，X"和"name X"周围 32 字作为身体/情绪线索
    const i = combined.indexOf(name);
    const after = combined.slice(i, i + 48);
    const cur = characters[name];
    characters[name] = { ...cur, lastSceneIndex: scene.sceneIndex, lastLocation: scene.location || cur.lastLocation };
    if (/腿|伤|纱布|血|躺|轮椅|担架|背|湿透|发抖|哆嗦|包扎|住院|清创/.test(after)) {
      characters[name].physical = after.slice(0, 28);
    }
    if (/怒|哭|泪|吼|冷|失望|急|发抖|倔强|疲惫|心酸|颤抖|哽咽|红了眼眶/.test(after)) {
      const emo = after.match(/([^\s，。；,.;:：!?！？、]{0,4}(?:怒|哭|泪|吼|冷|失望|急|发抖|倔强|疲惫|心酸|颤抖|哽咽|红了眼眶)[^\s，。；,.;:：!?！？、]{0,4})/);
      if (emo) characters[name].emotional = emo[1] + '（自' + scene.sceneTitle + '）';
    }
  }

  // 道具状态机：同样以名字在 text 中出现的上下文做粗更新
  const macGuffins = { ...reg.macGuffins };
  for (const name of Object.keys(macGuffins)) {
    if (!combined.includes(name)) continue;
    const i = combined.indexOf(name);
    const after = combined.slice(i, i + 48);
    macGuffins[name] = {
      ...macGuffins[name],
      physicalState: after.slice(0, 32),
      lastLocation: scene.location || macGuffins[name].lastLocation,
      lastSceneIndex: scene.sceneIndex,
    };
    // 粗略识别持有者：最近出现的角色名
    for (const cname of Object.keys(characters)) {
      if (after.includes(cname)) { macGuffins[name].lastHeldBy = cname; break; }
    }
  }

  return {
    ...reg,
    locationCursor: scene.location || reg.locationCursor,
    lastSceneTail: tailSentence,
    lastDialogueTail: dialogueTail,
    characters,
    macGuffins,
  };
}

/**
 * 把寄存器 + quality-validator 的 issues 合并成 qualityFeedback（给 retry 下一轮用）
 * 比原版多写 6 条连贯性维度。
 */
function buildContinuityFeedback(reg: SceneStateRegister, validatorIssues: Array<{ type: string; message: string; fix: string }>): string {
  const base = validatorIssues.length
    ? validatorIssues.map((i, n) => `${n + 1}.[${i.type}] ${i.message} → 修正：${i.fix}`).join('\n')
    : '';
  const extra: string[] = [];
  extra.push('【连贯性专列·下一轮必须兑现】');
  extra.push('1. 分镜衔接硬规则：本分镜 visual 的前 1～2 句，必须是上一分镜最后一帧画面（"画面锚点"栏）的"接下来 1 秒发生了什么"，再推进到本段新动作。若跳帧/瞬移，扣分。');
  extra.push('2. 对白衔接硬规则：若本分镜有对白且上一分镜有对白尾（对白锚点），第一句对白的语势/人物顺序/话题必须是对上一句的"直接回应 / 立刻打断 / 沉默后反击"三连之一，禁止跳到新话题。');
  extra.push('3. 道具硬规则：每一次"铁箱/存折/卡/防水袋/借条"被移动、被抢、被藏、被打开，visual 里必须写出"从哪来→经谁手→到哪去"三节点；sceneTransition 必须写明"本场景新获得/新失去的道具"。');
  extra.push('4. 角色状态硬规则：本分镜里所有角色的"衣着 / 伤处 / 手持物 / 情绪表情"，必须与连续性寄存器一致。若变化（如纱布泡水、裤子湿透、手里多出存折），visual 前两句必须明确写出"怎么变的"。');
  extra.push('5. 时间地点硬规则：本分镜 shotType/cameraAngle/duration/cameraMovement 要匹配动作节奏："抢存折/救母亲/砸铁锤/铁箱滑入急流"这种关键时刻须写成特写+快速摇摄+短促秒数(3~6秒)，纯对白场景须写成中景/近景+固定/轻微晃动+较长秒数(8~15秒)。');
  extra.push('6. 跨章钩子硬规则：本章第 1 分镜必须把"跨集硬承接"作为第一个△动作；本章最后一分镜的最后一个△动作必须停在悬念钩子上（不能用"大家回家吃饭了"这种平收）。');
  return base ? `${base}\n\n${extra.join('\n')}` : extra.join('\n');
}

// ==================== 从小说正文原文提取「真实地点时间线」====================
type LocationAnchor = {
  locationName: string;      // 粗粒度大地点名（如"阴司办事处""云小汐宿舍"）
  charStart: number;         // 该地点段在章节正文中的起始字符位置
  charEnd: number;           // 该地点段在章节正文中的结束字符位置
  sourceTrigger: string;     // 提取依据（方便 debug）
  evidence: string;          // 原文片段证据
};

/**
 * 地点关键词 → 粗粒度大地点名
 * 说明：这些正则用于从小说正文原文（而非分镜title）中直接识别发生了什么大地点
 */
const NOVEL_LOCATION_RULES: Array<{ re: RegExp; canonical: string }> = [
  // —— 办公/机构类 ——
  { re: /阴司[^\s，。；,.!?:：]{0,10}(办事处|办公楼|办公区|大楼|大厦|办公大楼)/g, canonical: '阴司办事处' },
  { re: /(阴司办事处|阴司办公|阴司大厅|阴司走廊|阴司档案室|阴司茶水间|阴司会议室)/g, canonical: '阴司办事处' },
  { re: /([^\s，。；,.!?:：]{0,6}办事处|办事处)/g, canonical: '阴司办事处' }, // 兜底：若原文写"办事处"，默认按设定的主办事处名
  { re: /[^\s，。；,.!?:：]{0,6}(公司|集团|总部|写字楼|办公楼)/g, canonical: '公司总部' },
  { re: /(档案室|资料室|会议室|茶水间|办公室门口|走廊)/g, canonical: '阴司办事处' },
  // —— 居住类 ——
  { re: /(自己的宿舍|她的宿舍|他的宿舍|云小汐宿舍|宿舍)/g, canonical: '云小汐宿舍' },
  { re: /(她的公寓|自己的公寓|出租屋|租房|住处|小公寓|自己家|她的家|回到家|回到家中|回到家里|走进家门|家门)/g, canonical: '云小汐宿舍' },
  // —— 通用场所（按出现字前面冠名字归一） ——
  { re: /[^\s，。；,.!?:：]{2,12}(仓库|码头|港口|工厂|车间|工地|学校|教室|医院|病房|警局|派出所|法院|监狱|看守所|车站|机场|地铁|公园|广场|餐厅|饭馆|酒吧|茶馆|咖啡厅|会所|KTV|夜店|酒店|旅馆|会所|码头|赌场|别墅|庄园|城堡|会所)/g, canonical: null as unknown as string }, // 保留原始命中的名称
];

/** 纯移动触发动词 + 其后 2-16 字的地点宾语 模式 */
const MOVEMENT_VERBS_PATTERNS = [
  /(来到|走进|到达|抵达|赶到|走入|踏进|跨入|进入|迈入|拐进|穿过|停在|驻足在|来到了|走进了|到达了|抵达了|赶到了|跨入了|进入了|走到)[^\s，。；,.!?:：【「\[\(]{0,2}([^\s，。；,.!?:：【「\[\(]{2,18})/g,
  /(回到|返回|赶回|回到了|返回了|赶回了|推门进|推开[^\s，。；,.!?:：]{0,8}门，走进)[^\s，。；,.!?:：【「\[\(]{0,2}([^\s，。；,.!?:：【「\[\(]{2,18})/g,
  /(走出|离开|踏出|步出|走出了|离开了|踏出了|步出了)[^\s，。；,.!?:：【「\[\(]{0,2}([^\s，。；,.!?:：【「\[\(]{2,18})/g,
];

/**
 * 从小说章节正文原文中提取地点变化锚点（按正文字符顺序）
 * 返回结构：连续时间段 [{locationName, charStart, charEnd, sourceTrigger, evidence}]
 */
function extractChapterLocationAnchors(chapterContent: string): LocationAnchor[] {
  const text = chapterContent || '';
  if (!text) return [];

  /** 命中记录：{ charIndex, matchedCanonicalOrName, sourceTrigger, evidence } */
  type Hit = { charIndex: number; locName: string; trigger: string; evidence: string };
  const hits: Hit[] = [];

  // —— (A) 关键词规则扫描 ——
  for (const rule of NOVEL_LOCATION_RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      const matched = m[0];
      const group0 = m[1] || matched;
      // canonical 为 null 时用命中的真实词（保留原名），否则用规则表指定的 canonical
      let canon = rule.canonical;
      if (!canon) {
        // 没指定 canonical：把整个命中（前面冠 + 场所）作为地点名，但去掉尾端标点
        canon = matched.replace(/[，。；,.!?:：]+$/g, '').trim();
        if (canon.length < 2) canon = group0;
      }
      const snippet = text.slice(Math.max(0, m.index - 8), Math.min(text.length, m.index + matched.length + 12));
      hits.push({
        charIndex: m.index,
        locName: canon,
        trigger: `关键词命中「${matched.slice(0, 20)}」`,
        evidence: `…${snippet}…`,
      });
    }
  }

  // —— (B) 移动触发动词扫描 (来到/回到/走出 + X) ——
  for (const pattern of MOVEMENT_VERBS_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const verb = m[1] || '';
      const noun = (m[2] || '').replace(/[，。；,.!?:：]+$/g, '').trim();
      if (!noun || noun.length < 2) continue;
      // 跳过纯方向或纯动作宾语（她/他/我/门/楼梯/人群/黑暗/光/车/台阶等）
      const skipNouns = ['她', '他', '我', '你', '门', '楼梯', '人群', '黑暗', '光线', '台阶', '电梯', '走廊', '车', '车旁', '阴影里', '身后', '面前', '怀里', '屋里', '房间里', '外面', '里面'];
      if (skipNouns.includes(noun)) continue;
      // 再用规则表对宾语做一次粗归一（如果 noun 是"办事处"→"阴司办事处"等）
      let canonName = noun;
      for (const rule of NOVEL_LOCATION_RULES) {
        rule.re.lastIndex = 0;
        const rm = rule.re.exec(noun + ' ');
        if (rm && rule.canonical) { canonName = rule.canonical; break; }
      }
      const snippet = text.slice(Math.max(0, m.index - 4), Math.min(text.length, m.index + (m[0].length || 10) + 8));
      const isLeaveVerb = /^(走出|离开|踏出|步出)/.test(verb);
      hits.push({
        charIndex: m.index + (verb.length || 0), // 把锚点记在宾语位置附近（leave 动词的位置也记下）
        locName: isLeaveVerb ? `离开→${canonName}` : canonName,
        trigger: `移动动词「${verb}」→「${noun}」`,
        evidence: `…${snippet}…`,
      });
    }
  }

  // —— (C) 去重 + 排序 + 连续性分段 ——
  // 1. 先按 charIndex 升序
  hits.sort((a, b) => a.charIndex - b.charIndex);

  // 2. 合并同一字符位置附近的多命中（保留 canonical 名出现更多的那个）
  const dedupHits: Hit[] = [];
  for (const h of hits) {
    const last = dedupHits[dedupHits.length - 1];
    if (last && Math.abs(last.charIndex - h.charIndex) <= 12 && last.locName === h.locName) continue; // 同地近距重复，跳过
    dedupHits.push(h);
  }

  // 3. 把"离开→X"命中解释为切地点信号：遇到离开X如果紧接着下一个是Y，就标记一次切换（否则保持原样）
  //    先把 "离开→X" 这种虚拟名 还原为 X（下一个地点） 或 仅作为断点
  const cleanedHits: Hit[] = [];
  for (let i = 0; i < dedupHits.length; i++) {
    const h = dedupHits[i];
    if (!h.locName.startsWith('离开→')) { cleanedHits.push(h); continue; }
    // 作为分隔：如果后续有不同地点，保留切分；但本点不输出独立地点
    const nextLoc = dedupHits.slice(i + 1).find(x => !x.locName.startsWith('离开→'));
    if (nextLoc) {
      // 把"离开X"记录作为一个"地点切换"的锚点，但不创建新段
      cleanedHits.push({ ...h, locName: nextLoc.locName, trigger: `（${h.trigger}→切换到下一段）` });
    }
  }

  // 4. 把连续 hits 压缩为分段时间线（同地名合并成一段，遇到不同地名就切新段）
  const anchors: LocationAnchor[] = [];
  let i = 0;
  while (i < cleanedHits.length) {
    const curLoc = cleanedHits[i].locName;
    let j = i;
    // 向前扩展到下一个不同地点名的 hit 之前
    while (j < cleanedHits.length && cleanedHits[j].locName === curLoc) j++;
    const segmentStart = cleanedHits[i].charIndex;
    const segmentEnd = j < cleanedHits.length ? cleanedHits[j].charIndex - 1 : text.length;
    // 证据：取段内第一条和最后一条
    const firstHit = cleanedHits[i];
    const lastHit = cleanedHits[j - 1];
    anchors.push({
      locationName: curLoc,
      charStart: segmentStart,
      charEnd: segmentEnd,
      sourceTrigger: `${firstHit.trigger}${lastHit !== firstHit ? ` → ... → ${lastHit.trigger}` : ''}`,
      evidence: `首见：${firstHit.evidence}${lastHit !== firstHit ? `；尾见：${lastHit.evidence}` : ''}`,
    });
    i = j;
  }

  // 5. 补段头：正文从章首到第一次命中之间也算一段（继承第一地点名，因为章首默认从第一出现的地点开场）
  if (anchors.length > 0 && anchors[0].charStart > 40) {
    const first = anchors[0];
    anchors.unshift({
      locationName: first.locationName,
      charStart: 0,
      charEnd: first.charStart - 1,
      sourceTrigger: `章首默认承接「${first.locationName}」开场`,
      evidence: `章首片段：…${text.slice(0, 60)}…`,
    });
  }

  // 6. 补段尾：最后一段 charEnd 延伸到正文末尾
  if (anchors.length > 0) {
    anchors[anchors.length - 1].charEnd = text.length;
  }

  return anchors;
}

/** 把 LocationAnchor[] 渲染成 phase4 user prompt 可阅读的一段文字（附清单索引，便于AI按场景顺序对应） */
function formatLocationTimelineForPrompt(anchors: LocationAnchor[]): string {
  if (!anchors || anchors.length === 0) {
    return '【小说原文地点线索暂缺】请直接根据章节正文中明确写到的地点来判断，按剧情真实发生的大地点填写 location 字段。';
  }
  const list = anchors.map((a, idx) => {
    const progress = `字符位置 ${a.charStart}-${a.charEnd}（约章${Math.round(a.charStart/(anchors[anchors.length-1].charEnd||1)*100)}% - ${Math.round(a.charEnd/(anchors[anchors.length-1].charEnd||1)*100)}%）`;
    return `${idx + 1}. 📍大地点：${a.locationName}\n   范围：${progress}\n   证据：${a.sourceTrigger}\n   原文片段：${a.evidence}`;
  }).join('\n');
  const uniqueLocs = Array.from(new Set(anchors.map(a => a.locationName))).join('、');
  return `【本章节小说真实地点时间线】（按正文情节先后顺序，location 字段必须严格从此清单里选词！）：
> 可用大地点名清单：${uniqueLocs}
> 规则：若某段剧情落在上述第 N 段范围内，场景的 location 就必须写"第 N 段的📍大地点名"；整章只有一个地点时，所有分镜 location 重复同一字符串。
${list}`;
}

/** 给指定剧情片段（某一段正文或某一分镜对应原文位置）反查应该归属于哪个大地点 */
function findLocationAtChar(anchors: LocationAnchor[], charIndex: number): string | null {
  if (!anchors || !anchors.length) return null;
  for (const a of anchors) {
    if (charIndex >= a.charStart && charIndex <= a.charEnd) return a.locationName;
  }
  // charIndex 超出所有段范围时返回最近一段
  if (charIndex <= anchors[0].charStart) return anchors[0].locationName;
  return anchors[anchors.length - 1].locationName;
}

/**
 * location 大场景地区归一化（后处理）：
 * 1. 用圣经 locations 登记名作权威，匹配到的都替换成登记名
 * 2. 同一大地点内微地点（XX工位/走廊/门口/大厅等）合并成粗粒度标签
 * 3. 把"XX反应/XX靠近/XX伸手"等动作词过滤掉，从 description 首句提取真实地点
 * 4. 最终保证：相邻同大地点的 scenes.location 完全一致（不会出现"阴司办事处走廊"+"裴无道工位"两个变体）
 */
function normalizeSceneLocations(
  scenes: DetailedScene[],
  bibleLocations: Record<string, { name: string; type: string; description: string; props: string[]; lastSeenChapter: number }>,
  anchors?: LocationAnchor[]
): void {
  const canonicalNames = Object.values(bibleLocations || {}).map(l => l.name).filter(Boolean);

  // 从 description 首句「微地点 【景别】...」提取微地点部分（去掉【...】及之后的内容）
  const extractMicroLocation = (desc: string, title: string): string => {
    const head = (desc || title || '').split(/\n/)[0] || '';
    // 去掉【景别】/「景别」/ [景别] 及其前后空格
    const withoutShot = head.replace(/[【「\[\(][^】」\]\)]{0,20}[】」\]\)]/g, ' ').replace(/\s+/g, ' ').trim();
    // 中文标点前作为地点（如"阴司办事处走廊及办公区，阴森的..."→取逗号前）
    const commaIdx = withoutShot.search(/[，。！？；,\.!?：:]/);
    return (commaIdx > 0 ? withoutShot.slice(0, commaIdx) : withoutShot).trim();
  };

  const isPureActionPhrase = (s: string): boolean => {
    if (!s) return true;
    // 包含"反应/靠近/伸手/皱眉/微笑/离开/走来/坐下/站起/对话"等纯动作结尾/开头的视为动作词而非地点
    return /(反应|靠近|伸手|对话|对白|对峙|冲突|相遇|回忆|闪回|特写|镜头|动作|场景|一幕|片段)$/.test(s) ||
           /^(反应|靠近|伸手|皱眉|微笑|转身|离开|走来|站起|坐下|抬头|低头)/.test(s);
  };

  // 粗粒度聚类函数：如果字符串 A 包含字符串 B（或 B 包含 A），返回更短的那个（视为"大场景地区"根）
  const findRootLocation = (candidates: string[]): string => {
    const list = [...new Set(candidates.filter(c => c && !isPureActionPhrase(c)))].sort((a, b) => a.length - b.length);
    if (list.length === 0) return '';
    // 如果有 bible location 命中，优先用它
    for (const name of canonicalNames) {
      if (list.some(c => c.includes(name) || name.includes(c))) return name;
    }
    // 尝试找公共包含关系的最短根（如果没有，就返回出现次数最多的）
    const shortest = list[0];
    const contained = list.every(c => c.includes(shortest) || shortest.length <= 3);
    if (contained) return shortest;
    // 否则按频次
    const counts: Record<string, number> = {};
    for (const c of list) counts[c] = (counts[c] || 0) + 1;
    let best = list[0], bestCount = 0;
    for (const [k, v] of Object.entries(counts)) if (v > bestCount) { best = k; bestCount = v; }
    return best;
  };

  // 为每个 scene 生成"地点候选"（优先级：AI 写的 location →  bible locations 命中 → description 首句微地点）
  const candidatesPerScene: string[] = scenes.map(s => {
    const explicit = (s.location || '').trim();
    if (explicit && !isPureActionPhrase(explicit)) {
      // 尝试直接命中 bible location（如果 location 里包含某个 bible location 或被其包含，规范化为 bible location）
      for (const name of canonicalNames) {
        if (explicit === name) return name;
        if (explicit.includes(name) || name.includes(explicit)) return name;
      }
      return explicit;
    }
    // description 里扫 bible locations 命中
    const headText = (s.description || '') + ' ' + (s.sceneTitle || '');
    for (const name of canonicalNames) {
      if (headText.includes(name)) return name;
    }
    const micro = extractMicroLocation(s.description, s.sceneTitle);
    return micro;
  });

  // 按 sceneIndex 顺序聚类：location 名称或 micro 有公共根/bible 名相同的视为同组
  const finalLocations: string[] = new Array(scenes.length).fill('');
  let i = 0;
  while (i < scenes.length) {
    const seed = candidatesPerScene[i];
    let j = i;
    const groupCandidates: string[] = [];
    // 取一个可能的组名：用 seed 的粗粒度根（扫 bible location 匹配）
    let groupRoot = '';
    for (const name of canonicalNames) {
      if (seed && (seed.includes(name) || name.includes(seed))) { groupRoot = name; break; }
    }
    if (!groupRoot) {
      // 试从 description 头部找 bible location
      for (const name of canonicalNames) {
        if ((scenes[i].description || '').includes(name)) { groupRoot = name; break; }
      }
    }
    // 向前扩展：只要 candidates[j] 与 groupRoot 有关系（包含/被包含）或同一 bible location 命中描述，就加入同组
    while (j < scenes.length) {
      const desc = scenes[j].description || '';
      const cand = candidatesPerScene[j];
      let belongs = false;
      if (groupRoot) {
        belongs = (cand && (cand.includes(groupRoot) || groupRoot.includes(cand))) || desc.includes(groupRoot);
      } else {
        // 没有 root 时，和 seed 的 micro 根判断包含关系
        const root = findRootLocation([seed, cand]);
        belongs = !!root && seed && cand && (seed.includes(root) || cand.includes(root) || root.length >= 2);
        if (!root || root.length < 2) {
          // 如果微地点里有"工位/走廊/门口"等建筑内部词，且没有跨大地点，也视为同组
          const buildingWords = ['办事处', '公司', '办公室', '大楼', '家', '宿舍', '别墅', '学校', '医院', '警局', '工厂', '车站', '机场', '街道', '公园'];
          const matchSeed = buildingWords.find(w => seed.includes(w));
          const matchCand = buildingWords.find(w => cand.includes(w));
          if (matchSeed && matchSeed === matchCand) { belongs = true; groupRoot = seed.split(matchSeed)[0] + matchSeed; }
        } else if (!groupRoot) {
          groupRoot = root;
        }
      }
      if (!belongs && j === i) { belongs = true; } // 第一个 scene 必然进组
      if (!belongs) break;
      if (cand && !isPureActionPhrase(cand)) groupCandidates.push(cand);
      j++;
    }
    // 确定组名：优先 bible location，其次 groupCandidates 粗根，最后 seed
    let groupName = groupRoot;
    if (!groupName) groupName = findRootLocation(groupCandidates) || seed || '未命名地点';
    // 清洗组名末尾的"反应/靠近/画面"等污染
    if (isPureActionPhrase(groupName)) {
      // 退化：重新从所有 scenes 的 description 里找公共子串
      for (const name of canonicalNames) {
        const allHave = scenes.slice(i, j).every(s => (s.description || '').includes(name));
        if (allHave) { groupName = name; break; }
      }
    }
    for (let k = i; k < j; k++) finalLocations[k] = groupName;
    i = j;
  }

  // ============== 兜底修正：用「小说正文原文地点时间线」作为权威，覆盖 AI 或聚类的错误 ==============
  if (anchors && anchors.length > 0 && scenes.length > 0) {
    const totalChars = Math.max(1, anchors[anchors.length - 1].charEnd || 1);
    // 先尝试：场景 description 片段在章节正文中的匹配位置来精准反查
    // 简化实现：按"场景进度百分比"映射到正文字符位置（sceneIndex 越后 → 映射越靠后）
    for (let k = 0; k < scenes.length; k++) {
      const scene = scenes[k];
      let anchorLoc: string | null = null;

      // 方案一：description 中若直接包含某个锚点的大地点关键词，就直接命中
      const descriptionText = (scene.description || '') + ' ' + (scene.sceneTitle || '') + ' ' + (scene.actions || '') + ' ' + (scene.stageDirections || '');
      for (const a of anchors) {
        if (descriptionText.includes(a.locationName)) { anchorLoc = a.locationName; break; }
        // 同时也测试地点名的关键词片段（"办事处""宿舍""仓库"）
        for (const rule of NOVEL_LOCATION_RULES) {
          if (!rule.canonical) continue;
          rule.re.lastIndex = 0;
          if (rule.re.test(descriptionText)) {
            anchorLoc = rule.canonical;
            break;
          }
        }
        if (anchorLoc) break;
      }

      // 方案二：若 description 全文没直接命中，就按"场景进度"映射到字符位置
      if (!anchorLoc) {
        // 按 sceneIndex 进度：sceneIndex 1 → 5%, last scene → 95%，中间线性分布
        const pct = scenes.length === 1 ? 0.5 : ((scene.sceneIndex || (k + 1)) - 1) / (scenes.length - 1);
        const clampedPct = Math.min(0.98, Math.max(0.02, 0.05 + 0.9 * pct));
        const charPos = Math.floor(clampedPct * totalChars);
        anchorLoc = findLocationAtChar(anchors, charPos);
      }

      // 方案三：bible canonicalNames 匹配（仅当还没找到时，避免冲突）
      if (!anchorLoc) {
        for (const name of canonicalNames) {
          if (descriptionText.includes(name)) { anchorLoc = name; break; }
        }
      }

      if (anchorLoc && anchorLoc !== '未标注地区') {
        // 只在以下情况覆盖：1) 当前 finalLocations[k] 为空或"未命名地点"；2) 或当前值与 anchorLoc 无公共包含关系；
        const cur = finalLocations[k];
        if (!cur || cur === '未命名地点' || cur === '未标注地区') {
          finalLocations[k] = anchorLoc;
        } else if (!(cur.includes(anchorLoc) || anchorLoc.includes(cur))) {
          // 两者根本不相关 → 以"小说正文锚点"为准覆盖（因为锚点来自原文剧情真实位置）
          finalLocations[k] = anchorLoc;
        }
      }
    }

  // ==================== 覆盖后的"同地再收缩"：把同一锚点大地点但被误分段的情况合并（保证同一大地点用字100%一致）====================
    // 将 finalLocations 中所有值先做一轮"如果属于同一 anchor 的大地点名就强制统一为 anchor 的写法"
    const uniqueAnchorLocs = Array.from(new Set(anchors.map(a => a.locationName).filter(Boolean)));
    for (let k = 0; k < finalLocations.length; k++) {
      const cur = finalLocations[k];
      if (!cur) continue;
      for (const anLoc of uniqueAnchorLocs) {
        if (cur !== anLoc && (cur.includes(anLoc) || anLoc.includes(cur) || anLoc.length >= 2 && cur.length >= 2 &&
          // 或者 cur 中包含锚点名里的核心名词（办事处/宿舍/仓库/码头等）
          NOVEL_LOCATION_RULES.some(r => {
            if (!r.canonical) return false;
            r.re.lastIndex = 0;
            const a = r.re.test(anLoc + ' ');
            r.re.lastIndex = 0;
            const b = r.re.test(cur + ' ');
            return a && b && r.canonical === anLoc;
          }))) {
          finalLocations[k] = anLoc;
          break;
        }
      }
    }
  }

  // ===== 最终一步：微地点 → 大场景地区（macro）强制升级 =====
  // 说明：bible/novel_scenes 常把"阴司办事处走廊""地下档案室""审讯室"等登记为独立条目；
  // 为了后续前端按大地区分组时能合并，这里把同一大地区的所有微名统一为同一个 macro 字符串。
  // 若某条已属于 anchor/粗粒度 也可以再走一次，结果幂等。
  const MACRO_RULES_BACKEND: Array<{ re: RegExp; macro: string }> = [
    // —— 诡界/阴司系（《社畜灵媒》等）——
    { re: /(阴司办事处|阴司大楼|阴司办公区|阴司走廊|阴司办公室|阴司茶水间|地下档案室|档案室|审讯室|资料室|会议室|办事处)/, macro: '阴司办事处' },
    { re: /(云小汐的宿舍|云小汐宿舍|宿舍|她的公寓|她的家|自己的公寓|自己家|出租屋|租房|住处)/, macro: '云小汐宿舍' },
    { re: /(排水道入口|幽都石板路|幽都街道|幽都街区|阴街|奈何桥|孟婆汤)/, macro: '幽都街区' },
    { re: /阎罗殿/, macro: '阎罗殿' },
    // —— 天庭系（《丹炉底下黑乎乎》等）——
    { re: /(南天门[^\s，。；,.!?]*(垃圾山|垃圾堆|天庭临时工宿舍|临时工宿舍)|垃圾山|垃圾堆|临时工宿舍|天庭临时工宿舍)/, macro: '南天门外垃圾山' },
    { re: /(太上老君炼丹炉|老君炼丹炉|炼丹炉)/, macro: '太上老君炼丹炉' },
    { re: /(月老红线仓库|红线仓库)/, macro: '月老红线仓库' },
    { re: /(雷公电母法器库|法器库)/, macro: '雷公电母法器库' },
    { re: /(广寒宫废墟|广寒宫)/, macro: '广寒宫废墟' },
    { re: /(凌霄殿|天庭凌霄殿)/, macro: '天庭凌霄殿' },
  ];
  for (let k = 0; k < finalLocations.length; k++) {
    const cur = finalLocations[k] || '';
    if (!cur || cur === '未标注地区' || cur === '未命名地点') continue;
    for (const rule of MACRO_RULES_BACKEND) {
      if (rule.re.test(cur)) {
        finalLocations[k] = rule.macro;
        break;
      }
    }
  }
  // 邻居补全（3 轮）：补全仍然为空/未标注的场景
  const UNKNOWN_MARKERS = ['', '未标注地区', '未命名地点'];
  for (let round = 0; round < 3; round++) {
    let changed = false;
    for (let k = 0; k < finalLocations.length; k++) {
      if (!UNKNOWN_MARKERS.includes(finalLocations[k] || '')) continue;
      const prev = k > 0 ? finalLocations[k - 1] : '';
      const next = k < finalLocations.length - 1 ? finalLocations[k + 1] : '';
      const hasPrev = prev && !UNKNOWN_MARKERS.includes(prev);
      const hasNext = next && !UNKNOWN_MARKERS.includes(next);
      if (hasPrev && hasNext && prev === next) { finalLocations[k] = prev; changed = true; }
      else if (hasPrev && !hasNext) { finalLocations[k] = prev; changed = true; }
      else if (hasNext && !hasPrev) { finalLocations[k] = next; changed = true; }
    }
    if (!changed) break;
  }

  // 写回所有 scenes.location
  for (let k = 0; k < scenes.length; k++) {
    if (finalLocations[k] && !UNKNOWN_MARKERS.includes(finalLocations[k])) (scenes[k] as any).location = finalLocations[k];
  }
}

// ==================== Phase 1: 章节深度分析（洪水进门风格增强版） ====================

async function phase1DeepAnalysis(
  chapterContent: string,
  chapterTitle: string,
  chapterIndex: number,
  configId: string | null,
  previousContinuity?: ChapterContinuity,
): Promise<ChapterAnalysis> {
  const model = await getModelName(configId);
  const temperature = await getTemperature(configId, 0.3);

  const prevBlock = previousContinuity
    ? `【上一章（第${previousContinuity.chapterIndex + 1}集）结尾承接锚点·MANDATORY】
- 上一章结尾悬念钩子（本章第 1 分镜第 1 个△动作必须直接回应这件事）：${previousContinuity.chapterEndingCliffhanger || previousContinuity.endingState || '（无）'}
- 上一章结尾画面冻结帧（时间/地点/人物/道具/情绪）：
  · 时间：${previousContinuity.chapterEndingSnapshot?.timeOfDay || '?'}
  · 地点：${previousContinuity.chapterEndingSnapshot?.location || '?'}
  · 在场人物：${previousContinuity.chapterEndingSnapshot?.onScreenCharacters?.join('、') || '?'}
  · 最后在动的关键道具：${previousContinuity.chapterEndingSnapshot?.macGuffinsInPlay?.join('、') || '?'}
  · 主导情绪：${previousContinuity.chapterEndingSnapshot?.dominantEmotion || '?'}
- 上一章离开时的道具台账（本章若再出现必须延续状态，不能凭空重置）：${
  (previousContinuity.macGuffinLedger || [])
    .map(x => `${x.name}（${x.lastPhysicalState}，${x.lastHeldBy}持有，在${x.lastLocation}）`)
    .join('；') || '（无）'
}

【连续性禁令】
1. 本章 timeAxis[0] 必须承接上一章的时间（不能从"清晨"突然跳回"昨夜"，不能回到过去）。
2. 本章角色起始情绪必须以 last emotionalBeat 为起点，至少用 1 个分镜过渡才能反转。
3. 上一章登记为"已被偷走的卡/被铁箱锁的存折"，本章出现时必须先解释"怎么找回来/怎么拿到钥匙"。

【本章开场必须给出的承接写法】
请在 chapterOpeningCallback 字段里，用一句话写出"本章第1个△动作，具体怎么承接上一章 chapterEndingCliffhanger"的画面（不少于 30 字）。\n\n`
    : '';

  const expectedJsonShape = `{"characters":[{"id":"","name":"","role":"","personality":"","emotionalState":"","relationships":[]}],"locations":[{"id":"","name":"","type":"","timeOfDay":"","atmosphere":"","props":[]}],"emotionBeats":[{"type":"","description":"","fromEmotion":"","toEmotion":"","trigger":""}],"keyConflicts":[],"unresolvedThreads":[],"dialogueCount":0,"actionDensity":"","pacing":"","summary":"","keyMoments":[{"description":"","type":""}],"macGuffins":[{"name":"","physicalState":"","lastHeldBy":"","narrativeValue":"","charRange":[0,0]}],"timeAxis":[{"label":"","charRange":[0,0],"weatherOrLight":"","elapsed":""}],"characterStatesAtMoments":[{"character":"","charIndex":0,"physical":"","emotional":"","goal":"","onScreen":true}],"chapterEndingCliffhanger":"","chapterOpeningCallback":""}`;

  const systemPrompt = `你是《洪水进门，三个儿子还在抢存折》风格的连贯性分析师。输出 JSON，字段说明：
- macGuffins：本章所有"能推动剧情反转"的实体物件清单（68万存折/生锈铁箱/防水袋/银行卡/借条/公章/营业执照/泡水原料等），每项写明 名字、当前物理状态、最后持有者、戏剧重要性、在正文中首次出现字符区间。空数组或缺少也会扣分。
- timeAxis：按章节正文字符顺序给出时间刻度数组（如 清晨 0-800；日 800-2400；夜 2400-3200；次日 3200+），每项含 label / charRange[2] / weatherOrLight / elapsed 相对上一刻流逝。
- characterStatesAtMoments：每个角色在重要分镜切换点（按字符位置）的身体/情绪/目标/是否在场快照。
- chapterEndingCliffhanger：本章最后一句对白或最后一个△动作"停在悬念上"的画面描述（20~60字）。它将被下一章第 1 分镜第 1 个△动作原封不动承接（不能平收）。
- chapterOpeningCallback：${previousContinuity ? '【MANDATORY】本章第 1 个△动作怎么承接上一章结尾钩子（≥30 字，先写画面再推进）' : '若是第 1 章，填"无"'}。
只输出 JSON，JSON 结构必须严格匹配：${expectedJsonShape}。只输出JSON。`;

  const userPrompt = `章节：${chapterTitle}（第${chapterIndex + 1}章）
正文字符总数：${chapterContent.length}\n\n${prevBlock}正文：${chapterContent}`;

  return callLLM(model, temperature, systemPrompt, userPrompt, configId);
}

// ==================== Phase 2: 圣经管理 ====================

function buildBibleFromAnalysis(bible: ChapterBible, chapterIndex: number, analysis: ChapterAnalysis): ChapterBible {
  const newBible = { characters: { ...bible.characters }, locations: { ...bible.locations } };

  for (const char of analysis.characters) {
    const existing = newBible.characters[char.name] || { name: char.name, role: char.role, appearance: '', personality: char.personality, currentEmotionalState: char.emotionalState, lastSeenChapter: chapterIndex, lastSeenLocation: '', lastAction: '' };
    newBible.characters[char.name] = { ...existing, personality: char.personality, currentEmotionalState: char.emotionalState, lastSeenChapter: chapterIndex };
  }

  for (const loc of analysis.locations) {
    newBible.locations[loc.name] = { name: loc.name, type: loc.type, description: loc.atmosphere, props: loc.props, lastSeenChapter: chapterIndex };
  }

  return newBible;
}

function getBibleContext(bible: ChapterBible, currentChapterIndex: number): string {
  const lines: string[] = [];
  for (const [name, char] of Object.entries(bible.characters)) {
    if (char.lastSeenChapter >= currentChapterIndex - 1) {
      lines.push(`- ${name} (${char.role}): 情绪="${char.currentEmotionalState}", 最后在第${char.lastSeenChapter + 1}章`);
    }
  }
  for (const [name, loc] of Object.entries(bible.locations)) {
    if (loc.lastSeenChapter >= currentChapterIndex - 1) {
      lines.push(`- ${name}: ${loc.description}`);
    }
  }
  return lines.join('\n') || '暂无圣经数据';
}

// ==================== Phase 3: 场景大纲规划（洪水进门风格：带时间/道具/跨章钩子） ====================

async function phase3OutlinePlanning(
  chapterContent: string,
  chapterTitle: string,
  targetSceneCount: number,
  configId: string | null,
  analysis: ChapterAnalysis,
  previousContinuity?: ChapterContinuity,
): Promise<SceneOutline[]> {
  const model = await getModelName(configId);
  const temperature = await getTemperature(configId, 0.3);

  const cliffhanger = previousContinuity?.chapterEndingCliffhanger || '';
  const prevBlock = cliffhanger
    ? `【承接上一章 · MANDATORY】
- 上一章结尾悬念钩子：${cliffhanger}
- 本章第 1 个场景大纲的 sceneTitle 必须写"微地点 / 回应上一章结尾悬念的动作"；sceneIndex=1 的 carriesHookFromPrevChapter 必须详细写出"第一个△动作如何直接承接钩子画面"；若 chapterIndex=1 场景大纲的开头和 chapterEndingCliffhanger 之间没有共享人物/道具/地点，视为不通过。
- 本章 phase1 给出的本章开场写法：${analysis.chapterOpeningCallback || '（未提供，仍需自己在 carriesHookFromPrevChapter 中明确写出）'}
`
    : '';
  const nextBlock = analysis.chapterEndingCliffhanger
    ? `【悬念留给下一章 · MANDATORY】
- 本章最后一个场景（sceneIndex=${targetSceneCount}）的 leavesHookForNextChapter 必须是：${analysis.chapterEndingCliffhanger}
- 最后一个场景的 keyAction / conflict / payoff 必须以这个悬念钩子 payoff 收尾，不能平收，不能"大家离开"这种。
`
    : '';

  const timeBlock = (analysis.timeAxis || []).length
    ? `【章节真实时间轴（按正文顺序，charRange 对应正文字符区间）】
${analysis.timeAxis.map(t => `- ${t.label} charRange=[${t.charRange?.[0]},${t.charRange?.[1]}] 天气/光线=${t.weatherOrLight || '?'} 相对流逝=${t.elapsed || '?'}`).join('\n')}
`
    : '【时间轴】若正文有时间变化（清晨/日/夜/次日/三天后），请为每个分镜大纲标注 timeAndWeather。';

  const macgBlock = (analysis.macGuffins || []).length
    ? `【本章 MacGuffin 道具清单（本分镜若"触碰/转移/打开"，macGuffinsTouched 必须列出）】
${analysis.macGuffins.map(m => `- ${m.name}｜初始态=${m.physicalState}｜初始持=${m.lastHeldBy}｜值=${m.narrativeValue}｜首次出现在[${m.charRange?.[0]},${m.charRange?.[1]}]`).join('\n')}
`
    : '【道具提醒】若正文有存折/铁箱/卡/防水袋/借条/公章/执照/泡水原料等，请在 macGuffinsTouched 标出本分镜处理的道具。';

  const expectedOutlinesJson = `{"outlines":[{"sceneIndex":1,"sceneTitle":"微地点 / 剧情动作","purpose":"","location":"大场景地区（只能是后面 locations 清单之一且同大地点所有分镜用字完全一致）","characters":[],"emotionalGoal":"","keyAction":"","conflict":"","setup":"","payoff":"","totalSceneCount":${targetSceneCount},"charRange":[0,0],"carriesHookFromPrevChapter":"","leavesHookForNextChapter":"","macGuffinsTouched":[],"characterDelta":[{"name":"","physical":"","emotional":"","goal":""}],"timeAndWeather":""}]}`;

  const systemPrompt = `你是《洪水进门，三个儿子还在抢存折》风格的影视分镜规划师。输出严格 JSON，必须填满下面新增的 7 个字段：
- totalSceneCount：固定填 ${targetSceneCount}（与 outlines 数组长度一致）。
- charRange[2]：正文字符区间 [startInclusive, endExclusive]；所有 scene 的 charRange 必须首尾相接、严格递增、无重叠、无空洞、联合覆盖整章正文 95% 以上。这是防跳帧/防乱序的基础，若 scene2 起始字符早于 scene1 结尾字符，整章作废重算。
- carriesHookFromPrevChapter：sceneIndex=1 的大纲必填，写明第 1 个△动作画面（≥30 字），必须包含至少一个来自上一章 chapterEndingCliffhanger 的共享人物/道具/地点。其他 scene 置空串。
- leavesHookForNextChapter：sceneIndex=最后一场的大纲必填，写明"停在悬念"上的收尾画面；其他 scene 置空串。
- macGuffinsTouched：本分镜会触碰/转移/打开/状态改变的 MacGuffin 名字数组。
- characterDelta：本分镜结束后，角色身体/情绪/目标的增量变化；不变化的角色不要写。
- timeAndWeather：本分镜所属的时间/光线（"清晨 / 暴雨"、"日 / 病房白光"、"夜 / 病房昏暗走廊灯"、"次日 / 阴天放晴"）。
- location 必须是大场景地区，所有同一栋大建筑/园区/住宅区内的分镜 location 用字必须严格一致（不要"裴无道工位""云小汐反应"等），真换地方才换。
- sceneTitle 强制「微地点 / 剧情动作」格式（参考：刘桂兰家二楼楼梯口 / 三儿子冲进门；院门木船旁 / 铁箱滑入急流）。
建议分镜数：${targetSceneCount}。只输出 JSON，结构为 ${expectedOutlinesJson}`;

  const userPrompt = `章节：${chapterTitle}\n正文字符总数：${chapterContent.length}\n\n${prevBlock}${nextBlock}${timeBlock}\n${macgBlock}\n\n正文：${chapterContent}`;

  return callLLM(model, temperature, systemPrompt, userPrompt, configId);
}

// ==================== Phase 4: 场景详细生成（洪水进门风格） ====================

const HONGSHUI_EXAMPLE_BLOCK = `【参考风格范式：请严格按此连贯性+标准分镜7项输出】
**场景4**：院门木船旁 / 铁箱滑入急流
- 景别：中景转近景
- 机位：正面
- 时长：11秒
- 镜头运动：推镜→轻微晃动（模拟急流冲击）
- 画面：陈春梅和村干部合力把发抖的刘桂兰扶上木船，船绳绷紧在水里扯出白浪。三个儿子这才抱着没砸开的铁箱追出院门，鞋底踩在浑黄的台阶上打滑。村干部大喊船位不够，一股急流横向撞来，刘建国怀里的铁箱猛然滑脱，箱角划过栏杆跌入水中，溅起一大片混着泥沙的水花。
- 对白：
  村干部：船只能再上一人！老人先走，你们沿安全绳撤！铁箱留下！
  刘建国（抱紧铁箱）：这里面全是我们家的东西！
  刘建国：钱！
- 音效/BGM：木船挤压声、洪水拍打院门的哗哗声、铁链绷紧的吱呀声、铁箱落水的闷响；弦乐短促推到高点后，突收为雨声留白。
- 【连贯性标注·请你在 sceneTransition 里也照这个结构写一句】
  · 承接S3尾：陈春梅刚把刘桂兰绑在背上、村干部在院门拉紧安全绳。
  · 推进S5开场：刘桂兰上船离开时隔着雨幕看三个儿子 → 三人同时扑进水里捞箱、谁也没扶母亲 → 情绪从慌乱推到极致寒心。
  · 道具转移：铁箱从"刘建国怀里"→"急流滑入水中"→"三个儿子把它拖回楼梯平台"；存折从未在铁箱里的真相被 S5 收尾回收。
  · 角色情绪增量：刘桂兰 担心→失望→寒心落泪；三兄弟 着急→慌不择"母"。
  · 标准分镜节奏匹配：铁箱滑脱瞬间写"近景 + 轻微晃动 + 2秒单镜头"压缩到动作点。`;

async function phase4GenerateDetailedScenes(
  chapterContent: string,
  chapterTitle: string,
  outline: SceneOutline,
  bibleContext: string,
  stateRegisterBlock: string,        // 洪水进门状态机的 text block
  previousScenes: DetailedScene[],
  qualityFeedback?: string,
  configId: string | null = null,
): Promise<any> {
  const model = await getModelName(configId);
  const temperature = await getTemperature(configId, 0.4);

  let continuityContext = '';
  if (previousScenes.length > 0) {
    const lastScene = previousScenes[previousScenes.length - 1];
    continuityContext = `【上一分镜·API兼容版兜底摘要】
标题：${lastScene.sceneTitle}
对白：${(lastScene.dialogues || []).map(d => `${d.character}：${d.line}`).join('；') || '无'}
sceneTransition：${lastScene.sceneTransition || '无'}`;
  }

  // ===== 从章节正文原文提取「真实地点时间线」=====
  const locationAnchors = extractChapterLocationAnchors(chapterContent);
  const locationTimelineBlock = formatLocationTimelineForPrompt(locationAnchors);

  const systemPrompt = await getScriptSystemPrompt(qualityFeedback);

  const total = outline?.totalSceneCount || Math.max(1, outline?.sceneIndex || 1);
  const sceneOrderHint = outline?.sceneIndex
    ? `（分镜编号 S${outline.sceneIndex}/${total}；对应正文字符区间建议 ${outline.charRange ? `[${outline.charRange[0]},${outline.charRange[1]}]` : '见上面 charRange'}；大致进度 ${Math.round((outline.sceneIndex / total) * 100)}%）`
    : '';

  const deltaBlock = (outline.characterDelta || []).length
    ? `本分镜承诺输出的角色增量变化（sceneTransition 最后一行必须复述这些变化已兑现）：\n${outline.characterDelta.map(d => `  · ${d.name}｜身:${d.physical}｜情:${d.emotional}｜目标:${d.goal}`).join('\n')}\n`
    : '';

  const userPrompt = `${stateRegisterBlock}
${continuityContext ? continuityContext + '\n\n' : ''}${qualityFeedback ? `⚠️ 质量修正（上一轮不通过的问题，逐条修复后再输出）：\n${qualityFeedback}\n\n` : ''}${locationTimelineBlock}

===== 【洪水进门风格·参考范式】 =====
${HONGSHUI_EXAMPLE_BLOCK}

===== 场景大纲（本场景唯一改编依据） =====
标题：${outline.sceneTitle}${sceneOrderHint}
目的：${outline.purpose}
冲突：${outline.conflict}
setup：${outline.setup}
payoff：${outline.payoff}
关键动作：${outline.keyAction}
角色：${outline.characters?.join('、') || ''}
${outline.timeAndWeather ? `本分镜承诺时间：${outline.timeAndWeather}` : ''}
${deltaBlock}
圣经上下文：${bibleContext}

===== 章节正文原文 =====
${chapterContent}

===== 强制要求（任何一条不满足都算不通过 quality 校验重试） =====
1. 先用 1～2 句 visual 承接「洪水进门风格·跨分镜连续性寄存器」里写的 "上一分镜画面锚点"：如果锚点是"上一分镜的最后一帧"，本分镜前两句必须写"这一帧的接下来 1 秒发生了什么"，再推进到新动作。瞬移、跳帧、直接切入新对白 → 判定失败。
2. 对白必须"对答"：若上一分镜对白锚点不是空，本分镜第一句对白必须是对它的 直接回应 / 立刻打断 / 沉默后反击 三连之一；对同一话题先回应再换话题。
3. MacGuffin 转移三节点：凡本分镜有存折/铁箱/卡/防水袋/钥匙/借条等物件移动 / 被抢 / 被藏 / 被打开，visual 里必须明确写出"从哪来 → 经过谁的手 → 到哪去"三节点，写不出算失败。
4. 角色状态不能跳变：寄存器里写了某角色"腿缠纱布/湿透/发抖/手里攥存折"等状态，本分镜若不先写"纱布重新包扎/换上干衣服"等过渡，visual 不能突然出现干干净净的新形象。
5. 节奏匹配：抢存折 / 救人 / 砸铁锤 / 铁箱入急流等关键时刻 → 近景/特写 + 短促秒数(3~6s) + 快速摇摄/轻微晃动；母子对白对峙 / 三兄弟假惺惺合照 → 中景/近景 + 长秒数(8~15s) + 固定/轻微晃动。
6. sceneTransition 必须按范式里的结构写 4 行：
   · 承接上一场尾：S${Math.max(1, outline.sceneIndex - 1)}的画面/对白锚点。
   · 推进下一场头：S${Math.min(total, outline.sceneIndex + 1)}将从哪个动作点开场。
   · 道具转移：本分镜新获得/失去/转移了哪些道具、去向。
   · 角色情绪增量：哪些角色从X情绪变成Y情绪，原因一句话。
7. location 字段：必须先对照「小说真实地点时间线」的进度范围选对应 📍大地点名，直接抄，不能自造新词，同大地点所有分镜用字完全一致。
8. sceneTitle 必须是「微地点 / 剧情动作」格式（斜线两边各一个空格）。
9. 标准分镜 6 项（shotType/cameraAngle/duration/cameraMovement/visual/soundDesign）必须拆到独立字段，不允许混写进 description / actions / stageDirections。visual ≥ 40 字，soundDesign ≥ 20 字。
10. ${outline.sceneIndex === 1 && outline.carriesHookFromPrevChapter ? `【第1分镜·跨章承接MANDATORY】本分镜第一个△动作画面必须兑现：${outline.carriesHookFromPrevChapter}` : ''}
11. ${outline.sceneIndex === total && outline.leavesHookForNextChapter ? `【最后分镜·跨章钩子MANDATORY】本分镜最后一句对白或最后一个△动作必须停在悬念上：${outline.leavesHookForNextChapter}。不能平收！` : ''}

只输出 JSON（且 scenes 数组长度必须为 1）：{"scenes":[{"sceneIndex":${outline.sceneIndex},"sceneTitle":"","location":"","shotType":"","cameraAngle":"","duration":"","cameraMovement":"","visual":"","dialogues":[],"soundDesign":"","description":"","actions":"","stageDirections":"","sourceBeat":"","sceneTransition":""}]}`;

  return callLLM(model, temperature, systemPrompt, userPrompt, configId);
}

// ==================== 辅助函数 ====================

async function callLLM(model: string, temperature: number, systemPrompt: string, userPrompt: string, configId: string | null): Promise<any> {
  const { apiUrl, apiKey, provider } = await getRawAIConfig(configId);
  console.log(`[ScriptGenerateV2] Using provider: ${provider}`);
  
  const resp = await fetch(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], temperature, max_tokens: 8192 }),
  });

  if (!resp.ok) throw new Error(`AI接口错误: ${resp.status}`);

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (!content.trim()) throw new Error('AI返回内容为空');

  const cleaned = content.replace(/<think[\s\S]*?<\/think>/gi, '').replace(/<thinking[\s\S]*?<\/thinking>/gi, '').trim();
  const parsed = extractJsonObject<any>(cleaned);
  if (!parsed) throw new Error('JSON解析失败');
  return parsed;
}

async function getScriptSystemPrompt(qualityFeedback?: string): Promise<string> {
  const forcedRules = `强制执行：1.严格遵守JSON格式 2.以章节正文为唯一改编源 3.场景承接上一场 4.对白必须转dialogues 5.同大地点细分微地点 6.禁止Entity等内部标记 7.只输出JSON 8.【location是大场景地区字段】：同一栋建筑/园区/宿舍/街道等大地点内的所有分镜，location必须用字完全一致（例如全在"阴司办事处"内的8个分镜，location必须都写"阴司办事处"，不能写"阴司办事处走廊"、"裴无道工位"、"走廊及办公区"等变体）；只有当剧情真正移动到另一大地点时，location才切换成新的地点名（如从"阴司办事处"走到"云小汐宿舍"时切换）。9.【sceneTitle 标题格式】：必须写成「微地点 / 剧情动作」，斜线左右留空格，例如 "排水道内 / 对峙"、"裴无道工位 / 交代任务"、"云小汐宿舍 / 夜读日志"；禁止再用"内外景-微地点-时间"的旧格式。10.【标准分镜字段强制拆开】：必须按下面 6 个独立字段输出，绝对禁止把"景别/机位/时长/镜头运动/画面/音效BGM"的信息混写到 description / actions / stageDirections 里：
  - shotType(景别)：必须填 远景/全景/中景/近景/特写/大特写 中之一；如有转换用 "中景转近景"
  - cameraAngle(机位)：必须填 正面/侧面/背面/俯拍/仰拍/过肩/主观视角 中之一
  - duration(时长)：整数 + "秒"，例如 "12秒"、"5秒"（对白 1 句约 2-3 秒，动作戏每段 3-8 秒）
  - cameraMovement(镜头运动)：固定/轻微晃动/快速摇摄/推镜/拉镜/跟拍/升降/环绕 等
  - visual(画面)：纯画面描写，含环境光线+人物站位+肢体动作+面部表情；至少 40 字；禁止写对白；禁止写"BGM/音效"类文字
  - soundDesign(音效/BGM)：环境音 + 人物脚步声/呼吸声/物品碰撞声等具体音效 + 背景音乐风格（例："滴水声被放大，呼吸声清晰可闻，紧张的氛围感音乐渐强"）
11.【对白字段要求】：每条对白的 character 必须是登记过的角色名；line 必须是小说原文对白的直接转写（允许极小量口语化通顺改写但不可改含义）；空对白场景 dialogues 写空数组 []。
12.【兼容字段兜底】：description 仍需写微地点+环境气氛，作为旧数据兼容；actions 仍需写角色动作摘要；stageDirections 写一句话运镜概述；但展示给用户时以 shotType/cameraAngle/duration/cameraMovement/visual/soundDesign 六个新字段为准。
13.【location 必须取小说正文中明确发生的大地点名】：用户提示会给出【本章节小说真实地点时间线】清单，写每个场景时必须先读完这段清单，再按"本段剧情在正文中的位置"选出属于哪个大地点段，直接抄对应的 📍大地点名。绝不允许使用清单中不存在的新词、缩写或别名。若清单只有一个大地点名，则所有场景 location 必须重复那一个。14.【每场对白数量上限】：每个场景（分镜）的 dialogues 数组长度控制在 1~2 句，最多不超过 3 句。若原文该段有超过3句对话，必须拆成多个分镜（用镜头切换/画面动作/环境描写隔开），禁止在单场景内堆砌长篇对白。拆分时保持剧情连贯，不丢信息。`;

  const outputFormat = `{"scenes":[{"sceneIndex":1,"sceneTitle":"微地点 / 剧情动作（例：排水道内 / 对峙）","location":"【必填】大场景地区名（只能从「小说真实地点时间线清单」里选；同大地点下所有分镜用字必须完全一致，不能编造清单中不存在的新名）","shotType":"景别（远景/全景/中景/近景/特写/大特写，可加"转"）","cameraAngle":"机位（正面/侧面/背面/俯拍/仰拍/过肩/主观视角 选其一）","duration":"整数+秒，如 12秒、5秒","cameraMovement":"镜头运动（固定/轻微晃动/快速摇摄/推镜/拉镜/跟拍/升降/环绕 等）","visual":"画面描写（环境光线+人物动作+表情，≥40字，禁止写对白/音效）","dialogues":[{"character":"角色名","line":"台词原文转写"}],"soundDesign":"音效/BGM（环境音+具体音效+BGM风格，≥20字）","description":"兼容兜底：微地点+环境气氛描写","actions":"兼容兜底：角色关键动作摘要","stageDirections":"兼容兜底：一句话运镜概述","sourceBeat":"对应小说原文的剧情片段说明","sceneTransition":"承上启下说明（承接上一场什么，引出下一场什么）"}]}`;

  const fallbackPrompt = `你是一位资深影视剧本编剧。场景划分：时空转换即换场景、焦点转移即换场景、对白场景为一段完整对话、动作场景为一个连续段落。字段要求：sceneTitle 必须为"微地点 / 剧情动作"格式；标准分镜 6 项（shotType/cameraAngle/duration/cameraMovement/visual/soundDesign）必须拆开填写；dialogues口语化符合人物性格；sceneTransition必须说明承接上一场和引出下一场；【location字段是大场景地区分组标签】，连续分镜只要没离开当前建筑/大地点（例如整章都在"阴司办事处"内各工位和走廊），location必须严格重复同一字符串，禁止换说法或加前后缀；真正跨大地点时location才切换。`;

  const promptBody = await getPromptWithFallback('script-generate-system', fallbackPrompt);
  return `${forcedRules}\n\n${promptBody}\n\n${outputFormat}`;
}

// ==================== 主处理逻辑 ====================

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { novelId, startChapter, endChapter, configId, chapterIndex: requestedChapterIndexRaw, chapterBible: requestedBible } = body;

  if (!novelId) return NextResponse.json({ error: '缺少小说ID' }, { status: 400 });

  const novel = await novelManager.getById(novelId);
  if (!novel) return NextResponse.json({ error: '小说不存在' }, { status: 404 });

  const structure = typeof novel.structure === 'string' ? JSON.parse(novel.structure) : novel.structure;
  const idea = typeof novel.idea === 'string' ? JSON.parse(novel.idea) : novel.idea;
  const novelChapters = Array.isArray(novel.chapters) ? novel.chapters : [];

  let chaptersInfo: Array<{ title: string; summary?: string }> = [];
  if (structure?.chapters && Array.isArray(structure.chapters)) {
    chaptersInfo = structure.chapters.map((ch: any, i: number) => ({
      title: novelChapters[i]?.title || ch.title || `第${i + 1}章`,
      summary: cleanText(novelChapters[i]?.content)?.substring(0, 600) || '',
    }));
  } else {
    const chapterCount = novelChapters.length || structure?.chapterHooks?.length || novel.totalChapters || 0;
    for (let i = 0; i < chapterCount; i++) {
      chaptersInfo.push({ title: novelChapters[i]?.title || `第${i + 1}章`, summary: cleanText(novelChapters[i]?.content)?.substring(0, 600) || '' });
    }
  }

  const totalNovelChapters = chaptersInfo.length;
  if (totalNovelChapters === 0) return NextResponse.json({ error: '小说暂无章节' }, { status: 400 });

  const requestedChapterIndex = toIntegerOrNull(requestedChapterIndexRaw);
  let actualStart: number, actualEnd: number;

  if (requestedChapterIndex !== null) {
    if (requestedChapterIndex < 0 || requestedChapterIndex >= totalNovelChapters) return NextResponse.json({ error: `第${requestedChapterIndex + 1}章不存在` }, { status: 400 });
    actualStart = requestedChapterIndex + 1;
    actualEnd = requestedChapterIndex + 1;
  } else {
    actualStart = Math.max(1, toIntegerOrNull(startChapter) ?? 1);
    actualEnd = Math.min(totalNovelChapters, toIntegerOrNull(endChapter) ?? totalNovelChapters);
    if (actualStart > actualEnd) return NextResponse.json({ error: '章节范围不正确' }, { status: 400 });
  }

  let script = await scriptManager.getScriptByNovelId(novelId, novel.userId);
  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController | null = null;
  let isStreamClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      controllerRef = controller;
      try {
        if (!script) {
          script = await scriptManager.createScript({ novelId, userId: novel.userId, status: 'generating', chapters: [] });
        } else if (script.status !== 'generating') {
          await scriptManager.updateScript(script.id, { status: 'generating' });
        }

        let bible: ChapterBible = requestedBible ? { characters: requestedBible.characters || {}, locations: requestedBible.locations || {} } : { characters: {}, locations: {} };
        const continuityTracker: ChapterContinuity[] = [];
        const totalChapters = actualEnd - actualStart + 1;
        let completedCount = 0;

        safeEnqueue(controller, `data: ${JSON.stringify({ type: 'start', totalChapters })}\n\n`);
        const existingChapters = Array.isArray(script?.chapters) ? [...script.chapters] : [];

        for (let i = actualStart; i <= actualEnd; i++) {
          const chapterIndex = i - 1;
          const chapterTitle = chaptersInfo[chapterIndex]?.title || `第${i}章`;

          while (existingChapters.length <= chapterIndex) {
            existingChapters.push({ chapterIndex, chapterTitle, screenplay: null, imagePrompts: null, videoPrompts: null });
          }

          const chapterContent = cleanText(novelChapters[chapterIndex]?.content);
          if (!chapterContent || chapterContent.length < 50) {
            existingChapters[chapterIndex] = { ...existingChapters[chapterIndex], screenplay: { scenes: [], status: 'failed', error: '章节正文缺失' } };
            safeEnqueue(controller, `data: ${JSON.stringify({ type: 'error', chapterIndex, error: '章节正文缺失' })}\n\n`);
            completedCount++;
            continue;
          }

          const rawExisting = existingChapters[chapterIndex]?.screenplay?.scenes || [];
          if (rawExisting.length > 0 && rawExisting.length >= calcTargetSceneCount(chapterContent.length) * 0.8) {
            safeEnqueue(controller, `data: ${JSON.stringify({ type: 'skip', chapterIndex, sceneCount: rawExisting.length })}\n\n`);
            completedCount++;
            continue;
          }

          safeEnqueue(controller, `data: ${JSON.stringify({ type: 'chapter_start', chapterIndex, title: chapterTitle })}\n\n`);

          // Phase 1: 章节深度分析
          safeEnqueue(controller, `data: ${JSON.stringify({ type: 'phase', phase: 1, name: '章节深度分析' })}\n\n`);
          let analysis: ChapterAnalysis;
          const prevChapterContinuity = continuityTracker[continuityTracker.length - 1];
          try {
            analysis = await phase1DeepAnalysis(chapterContent, chapterTitle, chapterIndex, configId, prevChapterContinuity);
            safeEnqueue(controller, `data: ${JSON.stringify({ type: 'phase_complete', phase: 1, characters: analysis.characters.length, locations: analysis.locations.length, macguffins: (analysis.macGuffins || []).length, hasCliffhanger: !!analysis.chapterEndingCliffhanger })}\n\n`);
          } catch (e: any) {
            console.error('[v2] Phase 1 失败:', e?.message);
            analysis = { characters: [], locations: [], emotionBeats: [], keyConflicts: [], unresolvedThreads: [], dialogueCount: 0, actionDensity: 'medium', pacing: 'medium', summary: chapterContent.substring(0, 200), keyMoments: [], macGuffins: [], timeAxis: [], characterStatesAtMoments: [], chapterEndingCliffhanger: '', chapterOpeningCallback: '' };
          }

          // Phase 2: 更新圣经
          bible = buildBibleFromAnalysis(bible, chapterIndex, analysis);
          const bibleContext = getBibleContext(bible, chapterIndex);
          safeEnqueue(controller, `data: ${JSON.stringify({ type: 'phase', phase: 2, name: '圣经更新', characterCount: Object.keys(bible.characters).length })}\n\n`);

          // Phase 3: 场景大纲规划
          safeEnqueue(controller, `data: ${JSON.stringify({ type: 'phase', phase: 3, name: '场景大纲规划' })}\n\n`);
          const targetSceneCount = calcTargetSceneCount(chapterContent.length);
          let outlines: SceneOutline[] = [];
          try {
            outlines = await phase3OutlinePlanning(chapterContent, chapterTitle, targetSceneCount, configId, analysis, prevChapterContinuity);
            safeEnqueue(controller, `data: ${JSON.stringify({ type: 'phase_complete', phase: 3, outlineCount: outlines.length, carryHook: outlines[0]?.carriesHookFromPrevChapter ? 1 : 0, leaveHook: outlines[outlines.length - 1]?.leavesHookForNextChapter ? 1 : 0 })}\n\n`);
          } catch (e: any) {
            console.error('[v2] Phase 3 失败:', e?.message);
            outlines = [];
          }
          // 给每个 outline 补齐 totalSceneCount（防止 phase3 LLM 漏填导致 phase4 计算最后一场失败）
          for (const o of outlines) o.totalSceneCount = outlines.length;

          // Phase 4: 场景详细生成
          safeEnqueue(controller, `data: ${JSON.stringify({ type: 'phase', phase: 4, name: '场景详细生成' })}\n\n`);
          const previousScenes: DetailedScene[] = [];
          let allScenes: DetailedScene[] = [];
          let retryCount = 0;
          const maxRetries = 3;
          let qualityFeedback: string | undefined;
          let sceneStateRegister: SceneStateRegister | null = null;

          while (!allScenes.length && retryCount < maxRetries) {
            if (retryCount > 0) safeEnqueue(controller, `data: ${JSON.stringify({ type: 'retry', retry: retryCount })}\n\n`);
            allScenes = [];
            // 每轮 retry 重置状态寄存器（因为上一轮 scenes 作废重算）
            sceneStateRegister = createSceneStateRegister(chapterIndex, analysis, prevChapterContinuity);

            for (const outline of outlines) {
              if (isStreamClosed) break;
              safeEnqueue(controller, `data: ${JSON.stringify({ type: 'scene_start', sceneIndex: outline.sceneIndex, title: outline.sceneTitle })}\n\n`);
              try {
                const regBlock = formatStateRegisterForPrompt(sceneStateRegister, outline.sceneIndex, outlines.length || 1, outline);
                const result = await phase4GenerateDetailedScenes(chapterContent, chapterTitle, outline, bibleContext, regBlock, previousScenes, qualityFeedback, configId);
                if (result?.scenes && Array.isArray(result.scenes) && result.scenes.length > 0) {
                  const s0 = result.scenes[0];
                  const scene: DetailedScene = {
                    sceneIndex: outline.sceneIndex || 1,
                    sceneTitle: s0.sceneTitle || outline.sceneTitle,
                    description: s0.description || '',
                    actions: s0.actions || '',
                    dialogues: (s0.dialogues || []).map((d: any) => ({ character: d.character || '', line: d.line || '' })),
                    stageDirections: s0.stageDirections || '',
                    sourceBeat: s0.sourceBeat || '',
                    sceneTransition: s0.sceneTransition || '',
                    location: (s0.location || outline.location || '').trim(),
                    shotType: s0.shotType || '',
                    cameraAngle: s0.cameraAngle || '',
                    duration: s0.duration || '',
                    cameraMovement: s0.cameraMovement || '',
                    visual: s0.visual || '',
                    soundDesign: s0.soundDesign || '',
                  };
                  allScenes.push(scene);
                  previousScenes.push(scene);
                  // ↓ 关键：本分镜结束 → 更新寄存器写入角色/道具/画面/对白锚点
                  sceneStateRegister = updateSceneStateRegister(sceneStateRegister, scene);
                  safeEnqueue(controller, `data: ${JSON.stringify({ type: 'scene_generated', scene })}\n\n`);
                }
              } catch (e: any) {
                console.error('[v2] 场景生成失败:', e?.message);
              }
            }

            if (allScenes.length > 0) {
              const qualityReport = validateScreenplay(allScenes, chapterContent);
              safeEnqueue(controller, `data: ${JSON.stringify({ type: 'quality_check', score: qualityReport.score, issues: qualityReport.issues.length, continuityDeduct: (qualityReport as any).continuityDeduct ?? 0 })}\n\n`);
              if (!qualityReport.ok && retryCount < maxRetries - 1) {
                const base = qualityReport.issues.map(i => `${i.type}: ${i.message} - ${i.fix}`);
                qualityFeedback = buildContinuityFeedback(sceneStateRegister!, qualityReport.issues);
                retryCount++;
                allScenes = [];
                // 重试时 qualityFeedback 也要包含 validator + continuity 两块
                if (base.length > 0) qualityFeedback = `${base.join('\n')}\n\n${qualityFeedback}`;
                continue;
              }
              // ── location 大场景地区归一化（后处理，保证同一大地点下用字100%一致）
              const chapterLocationAnchors = extractChapterLocationAnchors(chapterContent);
              normalizeSceneLocations(allScenes, bible?.locations || {}, chapterLocationAnchors);
              // ── 把归一化后的 scenes 重新推到 previousScenes 供后续 chapter 承接 ──
              previousScenes.length = 0;
              previousScenes.push(...allScenes);
              // ── location 归一后同步到寄存器（避免下一章读到旧大地点）──
              if (sceneStateRegister && previousScenes.length) {
                sceneStateRegister.locationCursor = previousScenes[previousScenes.length - 1].location || sceneStateRegister.locationCursor;
              }
            }
          }

          // Phase 5: 更新连续性追踪（洪水进门风格·新增 chapterEndingSnapshot 与道具 ledger）
          if (allScenes.length > 0 && sceneStateRegister) {
            const lastScene = allScenes[allScenes.length - 1];
            const lastVisual = lastScene.visual || lastScene.actions || lastScene.description || '';
            const lastDialogue = (lastScene.dialogues || []).slice(-1)[0];
            const onScreen = Object.values(sceneStateRegister.characters)
              .filter(c => c.lastSceneIndex >= allScenes.length - 2)
              .map(c => Object.keys(sceneStateRegister.characters).find(k => sceneStateRegister!.characters[k] === c) as string)
              .filter(Boolean)
              .concat(Object.keys(sceneStateRegister.characters).filter(n => lastVisual.includes(n)))
              .filter((v, i, arr) => arr.indexOf(v) === i)
              .slice(0, 6);
            const macgInPlay = Object.keys(sceneStateRegister.macGuffins).filter(n => lastVisual.includes(n) || (lastDialogue?.line || '').includes(n));
            const ledger = Object.entries(sceneStateRegister.macGuffins).map(([name, m]) => ({
              name,
              chapterIndex,
              lastPhysicalState: m.physicalState,
              lastHeldBy: m.lastHeldBy,
              lastLocation: m.lastLocation || lastScene.location || '',
            }));
            // 合并上一章 ledger：同名道具覆盖最新状态
            const prevLedger = prevChapterContinuity?.macGuffinLedger || [];
            const merged = [...prevLedger];
            for (const item of ledger) {
              const j = merged.findIndex(x => x.name === item.name);
              if (j >= 0) merged[j] = item; else merged.push(item);
            }
            continuityTracker.push({
              chapterIndex,
              chapterTitle,
              endingState: lastScene.sceneTransition || '本章结束',
              pendingConflicts: analysis.unresolvedThreads || [],
              characterStates: Object.fromEntries(
                Object.entries(sceneStateRegister.characters).map(([n, c]) => [n, `身=${c.physical}｜情=${c.emotional}｜目标=${c.goal}`]),
              ),
              locationStates: Object.fromEntries(analysis.locations.map(l => [l.name, l.atmosphere])),
              lastSceneTitle: lastScene.sceneTitle,
              lastEmotionalBeat: analysis.emotionBeats[analysis.emotionBeats.length - 1]?.description || '',
              chapterEndingCliffhanger: analysis.chapterEndingCliffhanger || lastScene.sceneTransition || `三兄弟/母亲关系仍在对峙（${lastScene.sceneTitle}）`,
              chapterEndingSnapshot: {
                timeOfDay: sceneStateRegister.timeCursor,
                location: lastScene.location || sceneStateRegister.locationCursor,
                onScreenCharacters: onScreen,
                macGuffinsInPlay: macgInPlay,
                dominantEmotion: (analysis.emotionBeats?.[analysis.emotionBeats.length - 1]?.toEmotion) || (lastDialogue?.line?.slice?.(-14) || ''),
              },
              macGuffinLedger: merged,
            });
          }

          existingChapters[chapterIndex] = {
            ...existingChapters[chapterIndex],
            chapterTitle,
            screenplay: { scenes: allScenes, status: allScenes.length > 0 ? 'completed' : 'failed' },
            chapterAnalysis: analysis,
            bibleSnapshot: bible,
          };

          try {
            await scriptManager.updateScript(script.id, { chapters: existingChapters });
            safeEnqueue(controller, `data: ${JSON.stringify({ type: 'chapter_save', chapterIndex, sceneCount: allScenes.length })}\n\n`);
          } catch (e) {
            console.error('[v2] 保存失败:', e);
          }

          completedCount++;
          safeEnqueue(controller, `data: ${JSON.stringify({ type: 'progress', chapterIndex, completed: completedCount, total: totalChapters })}\n\n`);
        }

        await scriptManager.updateScript(script.id, { chapters: existingChapters, status: 'completed' });
        safeEnqueue(controller, `data: ${JSON.stringify({ type: 'complete', totalChapters: completedCount })}\n\n`);
      } catch (error: any) {
        console.error('[v2] 剧本生成异常:', error);
        if (script?.id) await scriptManager.updateScript(script.id, { status: 'failed' }).catch(() => {});
        safeEnqueue(controller, `data: ${JSON.stringify({ type: 'error', error: error?.message || '生成失败' })}\n\n`);
      } finally {
        isStreamClosed = true;
        safeClose(controllerRef);
      }
    },
    cancel() { isStreamClosed = true; console.log('[v2] 客户端断开连接'); },
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
}
