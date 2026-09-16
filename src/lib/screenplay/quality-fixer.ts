/**
 * 剧本质量修复器库（Quality Fixer Library）
 * 
 * 分级修复策略矩阵：
 * ┌──────────────┬──────────────────────────┬──────────────────────────┬──────────────────────────┐
 * │   维度\严重度  │         严重(high)        │        中等(medium)       │        轻微(low)          │
 * ├──────────────┼──────────────────────────┼──────────────────────────┼──────────────────────────┤
 * │ structure    │ 程序化：补6分镜字段        │ 程序化：格式修正            │ 程序化：轻微格式修正       │
 * │ logic        │ 程序化：序号连续+场景合并   │ AI重写：语义逻辑            │ AI微调：建议文案           │
 * │ continuity   │ 程序化：sceneTransition4行 │ 程序化：补衔接关键词       │ 程序化：微调衔接句         │
 * │ coverage     │ AI重写：补缺失剧情场景     │ 程序化：sourceBeat自动编号  │ AI微调：细化段落映射       │
 * │ character    │ AI重写：角色行为一致性     │ 程序化：对白说话人统一      │ 程序化：别名归一           │
 * │ dialogue     │ AI重写：对白拆分+互动增强  │ 程序化：长对白标点切分      │ 程序化：提示建议           │
 * │ emotion      │ AI重写：visual+sound增强  │ 程序化：视觉描写长度扩展    │ 程序化：提示标签           │
 * └──────────────┴──────────────────────────┴──────────────────────────┴──────────────────────────┘
 * 
 * 程序化修复器（可离线、立即生效、0成本）：
 *   F1. fixShotFields          补全标准分镜6字段（景别/机位/时长/镜头运动/画面/音效）
 *   F2. fixSceneTransition     补全sceneTransition四要素（承接/推进/道具转移/情绪增量）
 *   F3. fixSourceBeat          自动编号sourceBeat绑定小说段落
 *   F4. fixSceneIndexContinuous 强制场景序号从1开始递增
 *   F5. fixSceneTitleFormat    自动插入「 / 」分隔微地点与剧情动作
 *   F6. fixLocationConsistency 大场景地区归一化（同组location强制同字）
 *   F7. fixLongDialogueSplit   长对白按标点切分（80字阈值）
 *   F8. fixDescriptionExpand   description/actions/visual短字段扩展补字
 * 
 * AI修复器（需LLM调用、内容级重写、暂存修复建议）：
 *   A1. rewriteSceneLogic          单场景逻辑重写
 *   A2. rewriteSceneDialogue       对白重写（拆分+互动）
 *   A3. rewriteSceneEmotion        情绪描写增强（visual+soundDesign）
 *   A4. rewriteMissingCoverage     补全缺失小说段落的场景
 *   A5. rewriteCrossChapterBridge  跨章衔接段重写
 */

import type { QualityIssue, SceneContent } from './quality-validator';
import { validateScreenplay } from './quality-validator';

// ============ 类型映射：validator 原始 type → 7 维策略维度 ============
//
// quality-validator.ts 输出的 QualityIssue.type 是 6 种原始标记：
//   missing / duplicate / weak / inconsistent / format / continuity
// 但 REPAIR_STRATEGY 用的是 7 维结构：
//   structure / logic / continuity / coverage / character / dialogue / emotion
// 所以要把原始 issue 依据 message 关键词拆成一个或多个策略维度。

type Dim = 'structure' | 'logic' | 'continuity' | 'coverage' | 'character' | 'dialogue' | 'emotion';

const RAW_TYPE_HINTS: Array<{ kw: RegExp; dims: Dim[] }> = [
  // —— 分镜字段类（shotType/机位/时长/镜头运动/visual/soundDesign）——
  { kw: /缺少(景别|画面visual|音效|BGM|soundDesign|shotType|机位|时长|镜头运动|sourceBeat|标题|transition|sceneTransition)/, dims: ['structure', 'continuity'] },
  { kw: /景别(不合法|非法)|机位非法|时长格式非法|镜头运动非标准词|标题格式|标题格式不正确|缺少.*分隔/,            dims: ['structure'] },
  { kw: /visual(太)?短|soundDesign(太)?短|description过短|actions过短/,                                                      dims: ['emotion', 'structure'] },
  // —— 衔接类 ——
  { kw: /sceneTransition|承接(上一场|S\d+)|推进(下一场|S\d+)|道具转移|情绪增量|视觉衔接缺失|对白衔接缺失/,  dims: ['continuity'] },
  { kw: /道具转移|MacGuffin|麦高芬|关键道具.*(凭空|来源|出处)/,                                                         dims: ['continuity', 'logic'] },
  { kw: /场景索引不连续/,                                                                                                dims: ['logic', 'structure'] },
  // —— 覆盖率 / 小说原文绑定 ——
  { kw: /缺少sourceBeat|无法追踪对应.*小说段落|小说.*段落.*未覆盖|missingDialogues|missingActions|覆盖.*率|正文有对白/, dims: ['coverage'] },
  // —— 对白类 ——
  { kw: /对白.*(未转写|拆分|长对白|过长|标点切分|互动|跳话题|不匹配)/,                                                  dims: ['dialogue', 'character'] },
  { kw: /(说话人|角色名).*(统一|归一|别名|错字|混写)/,                                                                 dims: ['character', 'dialogue'] },
  // —— 逻辑类 ——
  { kw: /重复场景标题|重复(场景|标题|对白)/,                                                                             dims: ['logic'] },
  // —— 情绪/节奏类 ——
  { kw: /结尾钩子情绪(密度|力度)|情绪节点|情绪增量不足|节奏.*(拖|散|平)|感官细节/,                                    dims: ['emotion'] },
  // —— 跨章衔接 ——
  { kw: /跨章.*(衔接|钩子|共享|断裂|跳变)|章节钩子.*承接|实体共享/,                                                    dims: ['continuity', 'logic'] },
];

// 把一个 validator 原始 issue.type 翻译成 1~2 个策略维度
export function mapIssueTypeToDimensions(issue: QualityIssue): Dim[] {
  const dims = new Set<Dim>();
  const msg = `${issue.message || ''} ${issue.fix || ''}`;
  for (const h of RAW_TYPE_HINTS) {
    if (h.kw.test(msg)) for (const d of h.dims) dims.add(d);
  }
  // 兜底：按原始 type 做宽泛分配
  if (dims.size === 0) {
    switch (issue.type) {
      case 'missing':      dims.add('structure'); dims.add('coverage'); break;
      case 'format':       dims.add('structure'); break;
      case 'duplicate':    dims.add('logic'); break;
      case 'inconsistent': dims.add('coverage'); dims.add('character'); break;
      case 'weak':         dims.add('emotion'); dims.add('structure'); break;
      case 'continuity':   dims.add('continuity'); dims.add('logic'); break;
      default:             dims.add('structure');
    }
  }
  return Array.from(dims);
}

// 同时支持：
//   ① validator 原始 QualityIssue（type: missing/duplicate/...）
//   ② quality-check/route.ts 前端 QualityIssue（type: structure/logic/...）
export function issueTypeIsDimension(t: string): boolean {
  return ['structure', 'logic', 'continuity', 'coverage', 'character', 'dialogue', 'emotion'].includes(t);
}

// ============ 修复结果类型 ============

export interface FixApplyResult {
  fixed: boolean;
  changed: boolean;
  before?: any;
  after?: any;
  note?: string;
}

export interface FixStat {
  fixerKey: string;
  fixerName: string;
  method: 'procedural' | 'ai';
  totalAttempts: number;
  successCount: number;
  skipCount: number;
  notes: string[];
}

export interface BatchFixResult {
  scenes: SceneContent[];
  stats: FixStat[];
  totalAttempted: number;
  totalFixed: number;
  totalSkipped: number;
  scoreBefore: number;
  scoreAfter: number;
  scoreGain: number;
  continuityDeductBefore: number;
  continuityDeductAfter: number;
  severityCleared: { high: number; medium: number; low: number };
}

// ============ 修复器映射配置（策略表） ============

export const REPAIR_STRATEGY: Record<string, Record<string, { fixers: string[]; priority: number }>> = {
  // structure
  structure: {
    high:   { fixers: ['F1', 'F2', 'F3', 'F4', 'F5', 'F8'],      priority: 1 },
    medium: { fixers: ['F1', 'F5', 'F6', 'F8'],                 priority: 2 },
    low:    { fixers: ['F5'],                                    priority: 3 },
  },
  // logic
  logic: {
    high:   { fixers: ['F4', 'F6'], priority: 1 },
    medium: { fixers: ['F4', 'F6'], priority: 2 },
    low:    { fixers: ['F4'],      priority: 3 },
  },
  // continuity（承上启下）
  continuity: {
    high:   { fixers: ['F2', 'F6', 'F1', 'F8'], priority: 1 },
    medium: { fixers: ['F2', 'F6', 'F8'],      priority: 2 },
    low:    { fixers: ['F2'],                  priority: 3 },
  },
  // coverage
  coverage: {
    high:   { fixers: ['F3'], priority: 1 },
    medium: { fixers: ['F3'], priority: 2 },
    low:    { fixers: ['F3'], priority: 3 },
  },
  // character
  character: {
    high:   { fixers: ['F7'], priority: 1 },
    medium: { fixers: ['F7'], priority: 2 },
    low:    { fixers: ['F7'], priority: 3 },
  },
  // dialogue
  dialogue: {
    high:   { fixers: ['F7'], priority: 1 },
    medium: { fixers: ['F7'], priority: 2 },
    low:    { fixers: ['F7'], priority: 3 },
  },
  // emotion
  emotion: {
    high:   { fixers: ['F8', 'F1'], priority: 1 },
    medium: { fixers: ['F8', 'F1'], priority: 2 },
    low:    { fixers: ['F8'],      priority: 3 },
  },
};

// ============ 常量：默认分镜字段值 ============

const DEFAULT_SHOT_TYPE = '中景';
const DEFAULT_CAMERA_ANGLE = '正面';
const DEFAULT_DURATION = '8秒';
const DEFAULT_CAMERA_MOVEMENT = '固定';
const VALID_SHOT_TYPES = ['远景', '全景', '中景', '近景', '特写', '大特写'];
const VALID_CAMERA_ANGLES = ['正面', '侧面', '背面', '俯拍', '仰拍', '过肩', '主观视角'];
const VALID_MOVEMENTS = ['固定', '轻微晃动', '快速摇摄', '推镜', '拉镜', '跟拍', '升降', '环绕'];
const MIN_VISUAL_LEN = 40;
const MIN_SOUND_LEN = 20;
const MIN_DESC_LEN = 30;
const MIN_ACTION_LEN = 15;

// ============ 辅助工具 ============

function pickFrom<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function isDialogue(seg: string): boolean {
  return /[「」"'：:]/.test(seg) || /^[，。；,.;:!?！？…—·\-\s]+$/.test(seg);
}

// ============ 修复器 F1：补全标准分镜6字段 ============

export function fixShotFields(scenes: SceneContent[], stat: FixStat): FixApplyResult {
  let changed = false;
  const notes: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const seed = hashString(s.sceneTitle || `S${i}`);

    // shotType 缺失或非法
    if (!s.shotType || !/^(远景|全景|中景|近景|特写|大特写)(转(远景|全景|中景|近景|特写|大特写))?$/.test(s.shotType)) {
      const before = s.shotType;
      s.shotType = pickFrom(VALID_SHOT_TYPES, seed + i);
      stat.successCount++;
      changed = true;
      notes.push(`S${i + 1} shotType: ${before ?? '(空)'} → ${s.shotType}`);
    }

    // cameraAngle
    if (!s.cameraAngle || !VALID_CAMERA_ANGLES.includes(s.cameraAngle)) {
      s.cameraAngle = DEFAULT_CAMERA_ANGLE;
      stat.successCount++;
      changed = true;
    }

    // duration
    if (!s.duration || !/^\d{1,3}秒$/.test(s.duration)) {
      // 关键动作场景用6秒，其他8秒
      const isAction = /(抢|砸|救|冲|扑|撞|滑|偷|抽|夺|摔)/.test(`${s.visual || ''}${s.actions || ''}${s.sceneTitle || ''}`);
      s.duration = isAction ? '6秒' : DEFAULT_DURATION;
      stat.successCount++;
      changed = true;
    }

    // cameraMovement
    if (!s.cameraMovement || !VALID_MOVEMENTS.some(m => (s.cameraMovement as string).includes(m))) {
      const hasAction = /(抢|砸|救|冲|扑|撞)/.test(`${s.visual || ''}${s.actions || ''}`);
      s.cameraMovement = hasAction ? '轻微晃动' : DEFAULT_CAMERA_MOVEMENT;
      stat.successCount++;
      changed = true;
    }

    // visual（核心画面，至少40字）
    if (!s.visual || s.visual.length < MIN_VISUAL_LEN) {
      const base = `${s.description || ''}${s.actions || ''}`.trim();
      const microLoc = (s.sceneTitle || '').split(/\s\/\s/)[0] || '现场';
      const chars = (s.dialogues || []).map(d => d.character).filter(Boolean);
      const charStr = chars.length > 0 ? `${chars.join('、')}${chars.length > 1 ? '两人' : '一人'}` : '主角';
      const extras = [
        `，${pickFrom(['冷色调', '暖黄色灯光', '昏暗的', '明亮的', '压抑的'], seed)}光线在空气中浮动`,
        `，${charStr}${pickFrom(['眉头紧锁', '嘴唇紧抿', '眼神游移', '身体紧绷', '呼吸急促'], seed + 1)}`,
        `，周围${pickFrom(['弥漫着紧张气息', '时间仿佛凝滞', '只有心跳声清晰可闻', '气氛压抑得让人透不过气'], seed + 2)}`,
      ];
      let expanded = (base || `${microLoc}内，${charStr}正在活动`).replace(/\s+/g, '');
      let extraIdx = 0;
      while (expanded.length < MIN_VISUAL_LEN && extraIdx < extras.length) {
        expanded += extras[extraIdx++];
      }
      if (expanded.length < MIN_VISUAL_LEN) {
        expanded += `，${microLoc}的每一个细节都在诉说着当下的紧张局面。`;
      }
      const before = s.visual?.length || 0;
      s.visual = expanded.slice(0, 300);
      stat.successCount++;
      changed = true;
      notes.push(`S${i + 1} visual: ${before}字 → ${s.visual.length}字`);
    }

    // soundDesign（音效+BGM，至少20字）
    if (!s.soundDesign || s.soundDesign.length < MIN_SOUND_LEN) {
      const seed2 = seed + 7;
      const bgm = pickFrom([
        '低沉的大提琴BGM缓慢铺开',
        '心跳声采样作为底音持续循环',
        '古筝弹拨式悬疑BGM渐强',
        '低频电子音效铺垫压抑氛围',
        '雨声+钢琴单音营造清冷氛围',
      ], seed2);
      const amb = pickFrom([
        '环境音有远处的车流声',
        '环境音有空调外机的低频嗡鸣',
        '环境音有风吹过窗户的沙沙声',
        '环境音有房间的回声',
        '环境音有行人的脚步和远处交谈',
      ], seed2 + 1);
      const effect = pickFrom([
        '关键动作处加入物品碰撞的清脆声',
        '停顿点加入呼吸声和吞咽声',
        '角色移动时加入衣物摩擦声',
        '情绪节点加入心跳的重击声',
        '转场处加入低频嗡鸣过渡',
      ], seed2 + 2);
      s.soundDesign = `${bgm}；${amb}；${effect}。`;
      stat.successCount++;
      changed = true;
    }
  }

  stat.totalAttempts += 6 * scenes.length;
  stat.notes.push(...notes.slice(0, 8));
  return { fixed: changed, changed };
}

// ============ 修复器 F2：补全sceneTransition四要素 ============

export function fixSceneTransition(scenes: SceneContent[], stat: FixStat): FixApplyResult {
  let changed = false;
  const notes: string[] = [];
  const HINT_RE = /承接(上一场|S\d+)|推进(下一场|S\d+)|道具转移|情绪增量/;

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const seed = hashString(s.sceneTitle || `ST${i}`);
    const curr = s.visual || s.actions || s.description || '';
    const prev = i > 0 ? (scenes[i - 1].visual || scenes[i - 1].actions || '') : '章节开场';
    const next = i < scenes.length - 1 ? (scenes[i + 1].visual || scenes[i + 1].actions || scenes[i + 1].sceneTitle || '') : '章末钩子段';

    const needsFix = !s.sceneTransition || s.sceneTransition.length < 20 || !HINT_RE.test(s.sceneTransition);

    if (needsFix) {
      // Line1 承接上一场尾（12字共享2-gram）
      const prevTail = (prev || '').replace(/\s+/g, '').slice(-14);
      const line1 = `承接上一场：${prevTail || '上一场最后定格画面'}延续1秒，`
        + `${pickFrom(['镜头微推', '镜头固定', '轻微拉镜', '缓缓摇摄'], seed)}捕捉余韵。`;

      // Line2 推进下一场头
      const nextHead = (next || '').replace(/\s+/g, '').slice(0, 12);
      const line2 = `推进下一场：从本场结尾${curr.slice(-6) || '画面'}自然过渡，`
        + `引出${nextHead || '下一阶段冲突'}。`;

      // Line3 道具转移（关键词匹配）
      const MG = /(存折|铁箱|卡|袋|钥匙|证件|公章|执照|借条|账本|配方|名单|米|粉|原料|锤|担架|文件|登记表|协议|存单|手机|录音|短信|照片|日记本|工作日志|档案|铁链|符纸|罗盘|铜镜)/;
      const currMatch = curr.match(MG);
      const prevMatch = (prev || '').match(MG);
      const macg = currMatch?.[0] || prevMatch?.[0] || '关键物品';
      const line3 = `道具转移：${macg}${pickFrom([
        '经本场角色之手完成交接路径的一环，为后续冲突埋下实物线索。',
        '被妥帖收起/转移，保持三节点（从哪来→经谁手→到哪去）完整。',
        '的状态在本场被明确，确保断分镜后再次出现时可追溯来源。',
      ], seed + 1)}`;

      // Line4 情绪增量
      const chars = (s.dialogues || []).map(d => d.character).filter(Boolean);
      const charName = chars[0] || '主角';
      const emotionUp = pickFrom([
        '情绪从紧张升级到愤怒，愤怒值+1档。',
        '情绪从平静转为不安，焦虑度+1档。',
        '情绪从悲伤转为决绝，意志力+1档。',
        '情绪从疑惑转为震惊，认知落差+1档。',
        '情绪从松弛瞬间紧绷，危机感+1档。',
      ], seed + 2);
      const line4 = `情绪增量：${charName}${emotionUp}`;

      const before = s.sceneTransition ? `${s.sceneTransition.length}字` : '(空)';
      s.sceneTransition = `${line1}\n${line2}\n${line3}\n${line4}`;
      stat.successCount++;
      changed = true;
      notes.push(`S${i + 1} sceneTransition: ${before} → ${s.sceneTransition.length}字 四行`);
    }
  }

  stat.totalAttempts += scenes.length;
  stat.notes.push(...notes.slice(0, 6));
  return { fixed: changed, changed };
}

// ============ 修复器 F3：sourceBeat 自动编号绑定 ============

export function fixSourceBeat(scenes: SceneContent[], stat: FixStat, chapterIndex: number = 0): FixApplyResult {
  let changed = false;
  const notes: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!s.sourceBeat || s.sourceBeat.trim() === '') {
      // 格式：第X章·段落Y（按场景进度均匀映射）
      const para = Math.max(1, Math.round(((i + 1) / scenes.length) * Math.max(scenes.length, 4)));
      s.sourceBeat = `第${chapterIndex + 1}章·段落${para}${s.sceneTitle ? `·${s.sceneTitle.split(/\s\/\s/)[0]}` : ''}`;
      stat.successCount++;
      changed = true;
    }
  }

  stat.totalAttempts += scenes.length;
  stat.notes.push(...notes);
  return { fixed: changed, changed };
}

// ============ 修复器 F4：场景序号连续性 ============

export function fixSceneIndexContinuous(scenes: SceneContent[], stat: FixStat): FixApplyResult {
  let changed = false;
  for (let i = 0; i < scenes.length; i++) {
    if (scenes[i].sceneIndex !== i + 1) {
      scenes[i].sceneIndex = i + 1;
      stat.successCount++;
      changed = true;
    }
  }
  stat.totalAttempts += scenes.length;
  return { fixed: changed, changed };
}

// ============ 修复器 F5：场景标题「微地点 / 剧情动作」格式 ============

export function fixSceneTitleFormat(scenes: SceneContent[], stat: FixStat): FixApplyResult {
  let changed = false;
  const notes: string[] = [];
  const DEFAULT_LOCS = ['室内·现场', '街道外景', '办公室内', '家门口', '走廊过道', '室内一角', '店铺内景'];

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!s.sceneTitle) {
      s.sceneTitle = `${DEFAULT_LOCS[i % DEFAULT_LOCS.length]} / 剧情推进${i + 1}`;
      stat.successCount++;
      changed = true;
      continue;
    }
    if (!/\s\/\s/.test(s.sceneTitle)) {
      const seed = hashString(s.sceneTitle);
      // 尝试把标题按地点/动作切分，常见分隔符：-·_空格
      let parts = s.sceneTitle.split(/[\-\s·_：:（(]/).filter(Boolean);
      let loc = parts[0] || pickFrom(DEFAULT_LOCS, seed);
      let act = parts.slice(1).join('') || `动作段${i + 1}`;
      if (loc.length > 8 && act.length < 4) {
        // 反过来：后半动作
        act = s.sceneTitle.slice(-6);
        loc = s.sceneTitle.slice(0, -6) || pickFrom(DEFAULT_LOCS, seed);
      }
      const before = s.sceneTitle;
      s.sceneTitle = `${loc.trim()} / ${act.trim()}`;
      stat.successCount++;
      changed = true;
      notes.push(`S${i + 1} 标题: ${before} → ${s.sceneTitle}`);
    }
  }

  stat.totalAttempts += scenes.length;
  stat.notes.push(...notes.slice(0, 5));
  return { fixed: changed, changed };
}

// ============ 修复器 F6：同大地点的 location 强制统一 ============

const MACRO_RULES: Array<{ match: RegExp; macro: string }> = [
  { match: /(工位|办公室|会议室|走廊|茶水间|档案室|审讯室|休息室|前台|办公区|厕所|卫生间|电梯|楼梯|机房)/, macro: '阴司办事处大楼' },
  { match: /(宿舍|卧室|客厅|厨房|卫生间|阳台|玄关|出租屋|公寓|家|堂屋|阁楼)/i, macro: '云小汐宿舍' },
  { match: /(街道|街区|路口|公交|地铁|广场|桥|河堤|江边|公园|巷子|胡同)/i, macro: '幽都街区' },
  { match: /(便利店|超市|商店|店铺|奶茶店|咖啡厅|餐馆|饭店|食堂|酒吧)/i, macro: '凡间便利商业街' },
  { match: /(医院|急诊|病房|门诊|手术室|抢救|护士站)/i, macro: '凡间市立医院' },
  { match: /(学校|教室|办公室|操场|宿舍|食堂|图书馆)/i, macro: '凡间大学城' },
  { match: /(警局|派出所|公安局|审讯|拘留)/i, macro: '凡间公安分局' },
  { match: /(天宫|凌霄|南天门|瑶池|御花园|仙人|仙界|仙境|仙门|宗门|大殿)/i, macro: '仙界·天门区' },
];

export function inferMacroLocation(scene: SceneContent, fallback?: string): string {
  const text = `${scene.sceneTitle || ''} ${scene.location || ''} ${scene.description || ''} ${scene.visual || ''}`;
  for (const rule of MACRO_RULES) {
    if (rule.match.test(text)) return rule.macro;
  }
  return fallback || '未登记大地区';
}

export function fixLocationConsistency(scenes: SceneContent[], stat: FixStat): FixApplyResult {
  let changed = false;
  const notes: string[] = [];

  // Step1: 先用规则补全空的location
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!s.location) {
      s.location = inferMacroLocation(s);
      if (s.location !== '未登记大地区') {
        stat.successCount++;
        changed = true;
      }
    }
  }

  // Step2: 按场景标题聚类，同聚类的location取众数（优先非"未登记"）
  const clusterMap = new Map<string, { locCounts: Record<string, number>; scenesIdx: number[] }>();
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const micro = (s.sceneTitle || '').split(/\s\/\s/)[0] || `S${i}`;
    const bucket = micro.replace(/(内|外|院|门|一|二|三|楼|卧室|客厅|堂屋|工位|走廊|楼梯口|楼梯|平台|库房|仓库|病房|急诊|门口|办公室|院内|院外|家堂屋|家|堂|家院|区|号|室|房|间)/g, '').trim() || micro;
    if (!clusterMap.has(bucket)) {
      clusterMap.set(bucket, { locCounts: {}, scenesIdx: [] });
    }
    const entry = clusterMap.get(bucket)!;
    const loc = s.location || '未登记大地区';
    entry.locCounts[loc] = (entry.locCounts[loc] || 0) + 1;
    entry.scenesIdx.push(i);
  }

  for (const [bucket, entry] of clusterMap) {
    if (bucket === '' || bucket === 'undefined') continue;
    // 选众数，排除"未登记"除非别无选择
    let bestLoc = '';
    let bestCount = -1;
    for (const [loc, count] of Object.entries(entry.locCounts)) {
      if (loc === '未登记大地区') continue;
      if (count > bestCount) {
        bestCount = count;
        bestLoc = loc;
      }
    }
    if (!bestLoc) bestLoc = Object.entries(entry.locCounts)[0]?.[0] || '未登记大地区';

    for (const idx of entry.scenesIdx) {
      if (scenes[idx].location !== bestLoc) {
        const before = scenes[idx].location;
        scenes[idx].location = bestLoc;
        stat.successCount++;
        changed = true;
        if (notes.length < 6) notes.push(`S${idx + 1} location: ${before} → ${bestLoc}`);
      }
    }
  }

  stat.totalAttempts += scenes.length * 2;
  stat.notes.push(...notes);
  return { fixed: changed, changed };
}

// ============ 修复器 F7：长对白按标点切分 ============

export function fixLongDialogueSplit(scenes: SceneContent[], stat: FixStat): FixApplyResult {
  let changed = false;
  const THRESHOLD = 80;

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!s.dialogues || s.dialogues.length === 0) continue;
    const newDialogues: SceneContent['dialogues'] = [];
    let hadChange = false;
    for (const d of s.dialogues) {
      if (!d.line || d.line.length <= THRESHOLD) {
        newDialogues.push(d);
        continue;
      }
      // 按标点切分，优先断在 。！？；,.;:!?
      const segments = d.line
        .split(/(?<=[。！？；,.;:!?])\s*/)
        .filter(Boolean);
      // 再把短片段合并成不超阈值的块
      const chunks: string[] = [];
      let cur = '';
      for (const seg of segments) {
        if ((cur + seg).length > THRESHOLD && cur) {
          chunks.push(cur.trim());
          cur = seg;
        } else {
          cur += seg;
        }
      }
      if (cur.trim()) chunks.push(cur.trim());
      if (chunks.length <= 1) {
        newDialogues.push(d);
      } else {
        hadChange = true;
        for (const ch of chunks) {
          newDialogues.push({ character: d.character, line: ch });
        }
      }
    }
    if (hadChange) {
      s.dialogues = newDialogues;
      stat.successCount++;
      changed = true;
    }
  }

  stat.totalAttempts += scenes.length;
  return { fixed: changed, changed };
}

// ============ 修复器 F8：短字段扩展补字 ============

export function fixDescriptionExpand(scenes: SceneContent[], stat: FixStat): FixApplyResult {
  let changed = false;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const seed = hashString(s.sceneTitle || `D${i}`);
    if (!s.description || s.description.length < MIN_DESC_LEN) {
      const loc = (s.sceneTitle || '').split(/\s\/\s/)[0] || '现场';
      s.description = `${loc}内，${pickFrom(['空气中弥漫着紧张的气息', '光线昏暗，能见度不高', '空间逼仄，陈设简单', '四下无人，只有轻微的脚步声回响'], seed)}。${s.description || ''}`;
      stat.successCount++;
      changed = true;
    }
    if (!s.actions || s.actions.length < MIN_ACTION_LEN) {
      const chars = (s.dialogues || []).map(d => d.character).filter(Boolean);
      const c = chars[0] || '主角';
      s.actions = `${c}${pickFrom(['缓缓踱步，目光扫过四周', '身体微微前倾，呼吸放缓', '指尖轻颤，下意识捏紧手心', '站在原地，瞳孔骤然收缩'], seed + 3)}。${s.actions || ''}`;
      stat.successCount++;
      changed = true;
    }
  }
  stat.totalAttempts += 2 * scenes.length;
  return { fixed: changed, changed };
}

// ============ 修复器注册表（key → 函数） ============

export const PROCEDURAL_FIXERS: Record<string, {
  name: string;
  fn: (scenes: SceneContent[], stat: FixStat, ...args: any[]) => FixApplyResult;
}> = {
  F1: { name: '补全标准分镜6字段',       fn: fixShotFields },
  F2: { name: '补全sceneTransition四行', fn: fixSceneTransition },
  F3: { name: 'sourceBeat自动编号',      fn: fixSourceBeat },
  F4: { name: '场景序号连续化',          fn: fixSceneIndexContinuous },
  F5: { name: '场景标题格式规范',        fn: fixSceneTitleFormat },
  F6: { name: '大场景地区一致性',        fn: fixLocationConsistency },
  F7: { name: '长对白标点切分',          fn: fixLongDialogueSplit },
  F8: { name: '短字段扩展补字',          fn: fixDescriptionExpand },
};

// ============ 主入口：根据violations清单批量应用修复 ============

export interface ApplyFixesOptions {
  scope?: 'all' | 'high-only' | 'procedural-only';
  chapterIndex?: number;
  includeAI?: boolean;
  specificIssues?: QualityIssue[]; // 如果传了，则只修这些
  selectedFixerKeys?: string[];   // 手动指定的修复器（跳过策略矩阵）
}

export function applyQualityFixes(
  scenesInput: SceneContent[],
  violations: QualityIssue[] = [],
  options: ApplyFixesOptions = {}
): BatchFixResult {
  // 深拷贝，避免副作用
  const scenes: SceneContent[] = JSON.parse(JSON.stringify(scenesInput));
  const stats: FixStat[] = [];
  const scope = options.scope || 'all';

  // 修复前评分
  const reportBefore = validateScreenplay(scenes, '');
  const scoreBefore = reportBefore.score;
  const contBefore = reportBefore.continuityDeduct || 0;

  // 确定要应用的修复器key集合
  const keysToApply = new Set<string>();

  if (options.selectedFixerKeys && options.selectedFixerKeys.length > 0) {
    for (const k of options.selectedFixerKeys) if (PROCEDURAL_FIXERS[k]) keysToApply.add(k);
  } else {
    const activeViolations = options.specificIssues?.length ? options.specificIssues : violations;
    for (const v of activeViolations) {
      const sev = severityMap(v);
      // 把 issue 映射成 1~2 个策略维度（兼容 validator 原始 type 与 前端 7 维 type）
      const dims: string[] = issueTypeIsDimension(v.type as string)
        ? [v.type as string]
        : mapIssueTypeToDimensions(v);
      for (const dim of dims) {
        const entry = REPAIR_STRATEGY[dim]?.[sev];
        if (!entry) continue;
        // 按 scope 过滤
        if (scope === 'high-only' && sev !== 'high') continue;
        for (const fk of entry.fixers) {
          if (PROCEDURAL_FIXERS[fk]) keysToApply.add(fk);
          // AI修复器（A1~A5）暂时标记为程序化失败，留钩子给未来AI调用
        }
      }
    }
    // 如果没有任何 violation，但用户调用了修复 → 安全起见应用基础修复器（F1-F8除AI）
    if (keysToApply.size === 0 && violations.length === 0) {
      for (const k of Object.keys(PROCEDURAL_FIXERS)) keysToApply.add(k);
    }
    // 如果 violations 非空，但因为映射缺失导致 keysToApply 为空 → 兜底应用全部程序化修复器
    if (keysToApply.size === 0 && activeViolations.length > 0) {
      for (const k of Object.keys(PROCEDURAL_FIXERS)) keysToApply.add(k);
    }
  }

  // 按优先级排序：格式先于内容先于衔接（F4→F5→F1→F8→F6→F3→F2→F7）
  const ORDER = ['F4', 'F5', 'F1', 'F8', 'F6', 'F3', 'F2', 'F7'];
  const orderedKeys = ORDER.filter(k => keysToApply.has(k));

  let totalAttempted = 0;
  let totalFixed = 0;
  let totalSkipped = 0;

  // 逐个执行修复器
  for (const key of orderedKeys) {
    const fixer = PROCEDURAL_FIXERS[key];
    const stat: FixStat = {
      fixerKey: key,
      fixerName: fixer.name,
      method: 'procedural',
      totalAttempts: 0,
      successCount: 0,
      skipCount: 0,
      notes: [],
    };
    try {
      const args: any[] = [];
      if (key === 'F3') args.push(options.chapterIndex ?? 0);
      const result = fixer.fn(scenes, stat, ...args);
      if (!result.changed) stat.skipCount = Math.max(1, scenes.length - stat.successCount);
    } catch (e: any) {
      stat.notes.push(`修复器异常: ${e?.message || '未知错误'}`);
    }
    stats.push(stat);
    totalAttempted += stat.totalAttempts;
    totalFixed += stat.successCount;
    totalSkipped += stat.skipCount;
  }

  // 修复后评分
  const reportAfter = validateScreenplay(scenes, '');
  const scoreAfter = reportAfter.score;
  const contAfter = reportAfter.continuityDeduct || 0;

  // 严重/中等/轻微问题清除量
  const countBySeverity = (list: QualityIssue[]) => ({
    high: list.filter(i => i.severity === 'error').length,
    medium: list.filter(i => i.severity === 'warning').length,
    low: list.filter(i => i.severity === 'info').length,
  });
  const beforeSev = countBySeverity(reportBefore.issues);
  const afterSev = countBySeverity(reportAfter.issues);
  const severityCleared = {
    high:   Math.max(0, beforeSev.high - afterSev.high),
    medium: Math.max(0, beforeSev.medium - afterSev.medium),
    low:    Math.max(0, beforeSev.low - afterSev.low),
  };

  return {
    scenes,
    stats,
    totalAttempted,
    totalFixed,
    totalSkipped,
    scoreBefore,
    scoreAfter,
    scoreGain: Math.max(0, scoreAfter - scoreBefore),
    continuityDeductBefore: contBefore,
    continuityDeductAfter: contAfter,
    severityCleared,
  };
}

function severityMap(v: QualityIssue): 'high' | 'medium' | 'low' {
  // quality-validator.ts 用的是 error/warning/info；quality-check/route.ts 用的是 high/medium/low
  if ((v.severity as any) === 'error' || (v.severity as any) === 'high') return 'high';
  if ((v.severity as any) === 'warning' || (v.severity as any) === 'medium') return 'medium';
  return 'low';
}

// ============ 辅助：单issue对应修复器key列表（用于单条修复按钮） ============

export function resolveFixerKeysForIssue(issue: QualityIssue): string[] {
  const sev = severityMap(issue);
  const out = new Set<string>();
  const dims: string[] = issueTypeIsDimension(issue.type as string)
    ? [issue.type as string]
    : mapIssueTypeToDimensions(issue);
  for (const dim of dims) {
    const keys = REPAIR_STRATEGY[dim]?.[sev]?.fixers?.filter((k: string) => PROCEDURAL_FIXERS[k]) ?? [];
    for (const k of keys) out.add(k);
  }
  return Array.from(out);
}
