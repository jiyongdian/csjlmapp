/**
 * 剧本质量验证器（洪水进门风格 + 2026市场热度扩展）
 * 多维度验证：场景结构 + 标准分镜 6 字段 + 跨分镜衔接 6 硬规则 + 角色/道具状态机 + ★ 市场热度 4 维度
 */
import { computeHotnessScore } from '../creative-hub';

export interface HotnessBreakdown {
  total: number;                                     // 0-100
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  dimension: {
    genreMatch: number;    // 题材匹配度
    hookPower: number;     // 开场钩子强度
    rhythmFit: number;     // 节奏适配性
    archetypePop: number;  // 人设流行度
  };
  details: string[];
  suggestions: string[];
  matchedGenreNames: string[];
}

export interface QualityReport {
  ok: boolean;
  issues: QualityIssue[];
  suggestions: string[];
  score: number; // 0-100 （创作分：含技术字段+连贯性）
  marketScore?: number; // 0-100（市场热度分：题材×钩子×节奏×人设）
  hotness?: HotnessBreakdown;  // 市场热度 4 维度拆解
  finalScore?: number;  // 创作分 70% + 市场热度分 30% = 最终综合分（0-100）
  continuityDeduct?: number; // 连贯性相关扣分合计
  marketDeduct?: number;      // 市场维度相关扣分/加分合计（正=加分）
}

export type IssueType =
  | 'missing'
  | 'duplicate'
  | 'weak'
  | 'inconsistent'
  | 'format'
  | 'continuity'
  | 'market';     // ★ 新增：市场热度问题

export interface QualityIssue {
  type: IssueType;
  severity: 'error' | 'warning' | 'info';
  message: string;
  fix: string;
  dimension?: 'genreMatch' | 'hookPower' | 'rhythmFit' | 'archetypePop'; // 当 type=market 时使用
}

export interface SceneContent {
  sceneIndex: number;
  sceneTitle: string;
  description: string;
  actions: string;
  dialogues: Array<{ character: string; line: string }>;
  stageDirections: string;
  sourceBeat: string;
  sceneTransition: string;
  location?: string;
  shotType?: string;
  cameraAngle?: string;
  duration?: string;
  cameraMovement?: string;
  visual?: string;
  soundDesign?: string;
}

const MIN_DESCRIPTION_LENGTH = 30;
const MIN_ACTIONS_LENGTH = 15;
const MIN_TRANSITION_LENGTH = 20;
const MIN_VISUAL_LENGTH = 40;
const MIN_SOUND_DESIGN_LENGTH = 20;

const VALID_SHOT_TYPES = /^(远景|全景|中景|近景|特写|大特写)(转(远景|全景|中景|近景|特写|大特写))?$/;
const VALID_CAMERA_ANGLES = /^(正面|侧面|背面|俯拍|仰拍|过肩|主观视角)$/;
const VALID_DURATION = /^\d{1,3}秒$/;
const VALID_MOVEMENTS = /^(固定|轻微晃动|快速摇摄|推镜|拉镜|跟拍|升降|环绕)(→?(固定|轻微晃动|快速摇摄|推镜|拉镜|跟拍|升降|环绕))*$/;

// MacGuffin 关键词：凡文本中出现这些词，都被视为"关键道具"，应该在前后场保持转移连贯性
const MACGUFFIN_HINTS = /(存折|铁箱|卡|防水袋|钥匙|证件|身份证|公章|营业执照|借条|账本|配方|客户名单|米|米粉|原料|横幅|锤子|铁锤|担架|担架床|文件袋|登记表|协议|公章|执照|汇款|存单|银行卡|密码|手机|短信|电话|录音)/;

/** 常用虚词 / 纯过渡 → 不计入 对白连续性共享字符 */
const DIALOGUE_FILLER = /^[\s，。；,.!?:：'"()（）—…·\-嗯啊哎哦哈呀呢吗吧了的是不说就我你他她它]+$/u;

export function validateScreenplay(
  scenes: SceneContent[],
  chapterContent?: string,
): QualityReport {
  const issues: QualityIssue[] = [];
  const suggestions: string[] = [];
  let continuityDeduct = 0;

  if (scenes.length === 0) {
    return {
      ok: false,
      issues: [{ type: 'missing', severity: 'error', message: '没有生成任何场景', fix: '请重新生成剧本' }],
      suggestions: [],
      score: 0,
      continuityDeduct: 0,
    };
  }

  let score = 100;

  // ---------- 1. 场景索引连续性 ----------
  const expectedIndices = scenes.map((_, i) => i + 1);
  const actualIndices = scenes.map(s => s.sceneIndex);
  if (JSON.stringify(expectedIndices) !== JSON.stringify(actualIndices)) {
    issues.push({
      type: 'format', severity: 'warning',
      message: '场景索引不连续',
      fix: '确保sceneIndex从1开始递增',
    });
    score -= 8;
  }

  // ---------- 2. 场景标题格式：要求「微地点 / 剧情动作」 ----------
  for (const scene of scenes) {
    if (!scene.sceneTitle) {
      issues.push({ type: 'missing', severity: 'error', message: `场景${scene.sceneIndex}缺少标题`, fix: '添加场景标题，格式：微地点 / 剧情动作' });
      score -= 6;
    } else if (!/\s\/\s/.test(scene.sceneTitle)) {
      issues.push({
        type: 'format', severity: 'warning',
        message: `场景${scene.sceneIndex}标题格式不正确（缺少「 / 」分隔）：${scene.sceneTitle}`,
        fix: '使用格式「微地点 / 剧情动作」，斜线两侧保留空格，如"排水道内 / 对峙"',
      });
      score -= 3;
    }
  }

  // ---------- 3. description/actions/transition 兜底字段长度 ----------
  const weakDesc = scenes.filter(s => (s.description?.length || 0) < MIN_DESCRIPTION_LENGTH);
  if (weakDesc.length > 0) {
    issues.push({ type: 'weak', severity: 'warning', message: `${weakDesc.length}个场景description过短(≥${MIN_DESCRIPTION_LENGTH})`, fix: '增加环境气氛、光线、陈设' });
    score -= weakDesc.length * 2;
  }
  const weakAct = scenes.filter(s => (s.actions?.length || 0) < MIN_ACTIONS_LENGTH);
  if (weakAct.length > 0) { score -= weakAct.length * 1; }

  const weakTrans = scenes.filter(s => {
    if (!s.sceneTransition || s.sceneTransition.length < MIN_TRANSITION_LENGTH) return true;
    // 现在 sceneTransition 必须至少覆盖 4 条结构中的 2 条关键字
    const hints = /承接(上一场|S\d+)|推进(下一场|S\d+)|道具转移|情绪增量/;
    return !hints.test(s.sceneTransition);
  });
  if (weakTrans.length > 0) {
    issues.push({
      type: 'continuity', severity: 'warning',
      message: `${weakTrans.length}个场景sceneTransition缺少4行结构（承接/推进/道具转移/情绪增量）`,
      fix: 'sceneTransition必须写4行：承接上一场尾 / 推进下一场头 / 道具转移 / 角色情绪增量',
    });
    score -= weakTrans.length * 3;
    continuityDeduct += weakTrans.length * 3;
  }

  // ---------- 4. 标准分镜 6 字段（洪水进门风格新增·硬校验） ----------
  const missingShots: number[] = [];
  const invalidShots: number[] = [];
  const missingVisuals: number[] = [];
  const shortVisuals: number[] = [];
  const missingSound: number[] = [];
  const shortSound: number[] = [];

  for (const s of scenes) {
    if (!s.shotType) missingShots.push(s.sceneIndex);
    else if (!VALID_SHOT_TYPES.test(s.shotType)) invalidShots.push(s.sceneIndex);
    if (!s.visual) missingVisuals.push(s.sceneIndex);
    else if (s.visual.length < MIN_VISUAL_LENGTH) shortVisuals.push(s.sceneIndex);
    if (!s.soundDesign) missingSound.push(s.sceneIndex);
    else if (s.soundDesign.length < MIN_SOUND_DESIGN_LENGTH) shortSound.push(s.sceneIndex);
    if (s.cameraAngle && !VALID_CAMERA_ANGLES.test(s.cameraAngle)) {
      issues.push({ type: 'format', severity: 'warning', message: `场景${s.sceneIndex}机位非法：${s.cameraAngle}`, fix: '机位仅允许：正面/侧面/背面/俯拍/仰拍/过肩/主观视角' });
      score -= 1;
    }
    if (s.duration && !VALID_DURATION.test(s.duration)) {
      issues.push({ type: 'format', severity: 'warning', message: `场景${s.sceneIndex}时长格式非法：${s.duration}`, fix: '时长：整数+秒，如"12秒"' });
      score -= 1;
    }
    if (s.cameraMovement && !VALID_MOVEMENTS.test(s.cameraMovement)) {
      issues.push({ type: 'format', severity: 'info', message: `场景${s.sceneIndex}镜头运动非标准词：${s.cameraMovement}`, fix: '镜头运动建议用 固定/轻微晃动/快速摇摄/推镜/拉镜/跟拍/升降/环绕，可连写' });
    }
  }

  if (missingShots.length) { issues.push({ type: 'missing', severity: 'error', message: `${missingShots.length}个场景缺少景别shotType：S${missingShots.join(',S')}`, fix: '补填景别：远景/全景/中景/近景/特写/大特写' }); score -= missingShots.length * 3; }
  if (invalidShots.length) { issues.push({ type: 'format', severity: 'warning', message: `${invalidShots.length}个场景景别不合法：S${invalidShots.join(',S')}`, fix: '景别仅允许：远景/全景/中景/近景/特写/大特写，转换用"中景转近景"' }); score -= invalidShots.length * 2; }
  if (missingVisuals.length) { issues.push({ type: 'missing', severity: 'error', message: `${missingVisuals.length}个场景缺少画面visual`, fix: 'visual写环境+人物站位+肢体动作+表情，至少40字' }); score -= missingVisuals.length * 4; continuityDeduct += missingVisuals.length * 3; }
  if (shortVisuals.length) { issues.push({ type: 'weak', severity: 'warning', message: `${shortVisuals.length}个场景visual太短(≥${MIN_VISUAL_LENGTH})`, fix: 'visual补足环境光线细节、微表情、背景人群动作等画面信息' }); score -= shortVisuals.length * 2; }
  if (missingSound.length) { issues.push({ type: 'missing', severity: 'error', message: `${missingSound.length}个场景缺少音效/BGM soundDesign`, fix: 'soundDesign写环境音+具体音效+BGM风格，至少20字' }); score -= missingSound.length * 3; continuityDeduct += missingSound.length * 2; }
  if (shortSound.length) { issues.push({ type: 'weak', severity: 'warning', message: `${shortSound.length}个场景soundDesign太短(≥${MIN_SOUND_DESIGN_LENGTH})`, fix: '补全呼吸声/脚步声/物品碰撞声等具体音效 + BGM风格描写' }); score -= shortSound.length; }

  // ---------- 5. 对白完整性 ----------
  const scenesWithDialogue = scenes.filter(s => s.dialogues && s.dialogues.length > 0);
  if (scenesWithDialogue.length === 0 && chapterContent && /[「」"'：:]/.test(chapterContent.slice(0, 300))) {
    issues.push({ type: 'missing', severity: 'error', message: '章节正文有对白但剧本未转写dialogues', fix: '将原文对白转写进dialogues字段，角色名/台词一一对应' });
    score -= 15;
  }

  // ---------- 5.1 每场对白数量上限（1~2句，最多3句）----------
  const overDialogueScenes = scenes.filter(s => s.dialogues && s.dialogues.length > 3);
  if (overDialogueScenes.length > 0) {
    issues.push({ type: 'structure', severity: 'warning', message: `${overDialogueScenes.length}个场景对白超过3句（每场应控制在1~2句，最多3句）`, fix: '将长对话拆成多个场景，用镜头切换/画面动作/环境描写隔开' });
    score -= overDialogueScenes.length * 3;
  }

  // ---------- 6. sourceBeat 覆盖率 ----------
  const missingSourceBeats = scenes.filter(s => !s.sourceBeat || s.sourceBeat.trim() === '');
  if (missingSourceBeats.length > scenes.length * 0.25) {
    issues.push({ type: 'inconsistent', severity: 'warning', message: `${missingSourceBeats.length}个场景缺少sourceBeat`, fix: '每个场景绑定当前章节正文的剧情段（可写原文片段）' });
    score -= missingSourceBeats.length * 2;
  }

  // ---------- 7. 重复场景标题 ----------
  const titleSet = new Set<string>();
  for (const scene of scenes) {
    const t = scene.sceneTitle?.replace(/[\s（）()【】\[\]「」『』·\-—…]/g, '') || '';
    if (t && titleSet.has(t)) {
      issues.push({ type: 'duplicate', severity: 'error', message: `重复场景标题: ${scene.sceneTitle}`, fix: '同一大地点连续出现时，细分微地点/动作阶段（"卧室 / 砸铁锤" → "一楼 / 水涌进堂屋"）' });
      score -= 10;
    }
    titleSet.add(t);
  }

  // ======================================================================
  // ================= 洪水进门风格：6 类连贯性硬校验（★核心） =================
  // ======================================================================
  // 连贯度总分权重：满分 40，每类不达标扣分，并累计到 continuityDeduct
  let continuityScore = 40;

  // ---------- 连贯 1：视觉承接 ----------
  // S[n].visual 前 12 字 / 前 20 字 的 1~3 字串 必须出现在 S[n-1].visual 尾 30 字中（人物名、地点、道具任一共享即 OK）
  let badVisual = 0;
  for (let i = 1; i < scenes.length; i++) {
    const prev = (scenes[i - 1].visual || scenes[i - 1].actions || scenes[i - 1].description || '').replace(/\s+/g, '');
    const curr = (scenes[i].visual || scenes[i].actions || scenes[i].description || '').replace(/\s+/g, '');
    if (!prev || !curr) { badVisual++; continue; }
    const tail = prev.slice(-30);
    const head = curr.slice(0, 20);
    // 至少 1 个 2-gram 共享（或共享人物名/道具名）
    let shared = false;
    if (chapterContent) {
      const names = [...chapterContent.matchAll(/[\u4e00-\u9fa5]{2,4}(?=[，。！？：；,.!?;:（）(])/g)].map(m => m[0]).slice(0, 8);
      for (const n of names) if (tail.includes(n) && head.includes(n)) { shared = true; break; }
    }
    if (!shared) {
      const mg = tail.match(MACGUFFIN_HINTS);
      if (mg && head.includes(mg[0])) shared = true;
    }
    if (!shared) {
      for (let k = 0; k < head.length - 1; k++) {
        const gram = head.slice(k, k + 2);
        if (gram.length === 2 && tail.includes(gram)) { shared = true; break; }
      }
    }
    if (!shared) badVisual++;
  }
  if (badVisual > 0) {
    continuityScore -= badVisual * 2;
    continuityDeduct += badVisual * 2;
    issues.push({ type: 'continuity', severity: 'warning', message: `视觉衔接缺失 ${badVisual} 处`, fix: '本分镜 visual 前1-2句必须先写"上一分镜最后一帧的接下来 1 秒发生了什么"，再推进新动作' });
  }

  // ---------- 连贯 2：对白承接 ----------
  // 若 S[n-1] 有对白尾，S[n] 头两句对白必须和上一句尾 14 字 char 集有 ≥3 字共享（话题不跳变）
  let badDialogue = 0;
  for (let i = 1; i < scenes.length; i++) {
    const pd = scenes[i - 1].dialogues || [];
    const cd = scenes[i].dialogues || [];
    if (pd.length === 0 || cd.length === 0) continue;
    const tail = (pd[pd.length - 1].line || '').replace(/\s+/g, '').slice(-18);
    const head = (cd[0].line || '').replace(/\s+/g, '').slice(0, 24);
    if (DIALOGUE_FILLER.test(tail) || DIALOGUE_FILLER.test(head)) continue;
    let shared = 0;
    for (const ch of tail) if (head.includes(ch)) shared++;
    if (shared < 2) badDialogue++;
  }
  if (badDialogue > 0) {
    continuityScore -= badDialogue * 2;
    continuityDeduct += badDialogue * 2;
    issues.push({ type: 'continuity', severity: 'warning', message: `对白衔接缺失 ${badDialogue} 处`, fix: '相邻分镜的对白必须"对答"：直接回应/立刻打断/沉默后反击 三选一，禁止跳话题' });
  }

  // ---------- 连贯 3：道具转移三节点 ----------
  // S[n] visual 里提到 MacGuffin 词时：若在 S[n-1] 里不存在、也没写「从A拿」这种来源句 → 扣分
  const keyMacGuffinSet = new Set<string>();
  for (const s of scenes) {
    const text = `${s.visual || ''} ${(s.dialogues || []).map(d => d.line).join('')}`;
    let m: RegExpExecArray | null;
    const re = new RegExp(MACGUFFIN_HINTS.source, 'g');
    while ((m = re.exec(text)) !== null) keyMacGuffinSet.add(m[0]);
  }
  let badMacg = 0;
  const macgSeenIn: Record<string, number> = {};
  for (let i = 0; i < scenes.length; i++) {
    const text = `${scenes[i].visual || ''} ${(scenes[i].dialogues || []).map(d => d.line).join('')}`;
    for (const m of keyMacGuffinSet) {
      if (!text.includes(m)) continue;
      const prev = i > 0 ? `${scenes[i - 1].visual || ''} ${(scenes[i - 1].dialogues || []).map(d => d.line).join('')}` : '';
      const last = (macgSeenIn[m] ?? -1);
      if (last >= 0 && last < i - 1) {
        // 道具中间断了 ≥1 分镜再出现 → 必须有来源句
        if (!/(从|拿|取|掏|翻|摸|递|接|拿出来|拿过来|找|捡|抢|抱|拖|抽|捡回|取回|偷走|偷|放进|塞入|塞到|挂在|系在|绑在)/.test(text)) badMacg++;
      }
      macgSeenIn[m] = i;
      void prev;
    }
  }
  if (badMacg > 0) {
    continuityScore -= badMacg * 2;
    continuityDeduct += badMacg * 2;
    issues.push({ type: 'continuity', severity: 'warning', message: `道具凭空出现/消失 ${badMacg} 处`, fix: '道具每次出现必须写 从哪来→经谁手→到哪去 三节点；断分镜后再出现必须补来源句' });
  }

  // ---------- 连贯 4：角色状态不跳变 ----------
  // 伤/湿/纱布/轮椅等身体标志：一旦出现，后续分镜必须仍然存在（除非写出"换干衣服""拆线"等过渡句）
  const persistTraits = /(腿伤|伤|纱布|血|湿透|发抖|哆嗦|担架|轮椅|拐杖|包扎|清创|住院|绑在背|背|抽筋|咳嗽|发烧|瘸|跛)/;
  const resetTraits = /(换干|换上|拆线|出院|脱下|重新包扎|擦干|擦干身|烤干|烘干|淋浴|洗澡|清洁)/;
  let badState = 0;
  const charTrait: Record<string, string> = {};
  for (let i = 0; i < scenes.length; i++) {
    const text = `${scenes[i].visual || scenes[i].actions || scenes[i].description || ''}`;
    const chars = [...new Set(text.match(/[\u4e00-\u9fa5]{2,3}/g) || [])].filter(t => /[刘陈张李王赵黄周吴徐孙朱马胡林郭何高罗郑梁宋唐许韩冯邓曹彭曾萧董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢傅钟姜崔谭廖范汪陆金石田韦贾夏|建国|建军|建伟|桂兰|春梅|小满|村干部|村医|民警|警官|吴婶|刘小满|急救医生|急救护士|受灾核验员|女工们|建国妻|大勇|刘大勇]/.test(t)).slice(0, 8);
    for (const c of chars) {
      const tr = text.match(new RegExp(`(${c}[^，。；,.!?:：]*(${persistTraits.source.slice(1, -1)}))`, 'u'));
      if (tr) charTrait[c] = charTrait[c] ? `${charTrait[c]}，${tr[1].slice(-8)}` : tr[1].slice(-12);
      if (charTrait[c]) {
        // 是否仍然在当前分镜里出现这些特征？没出现 → 必须有 reset 句
        const traitWords = charTrait[c].split(/[，、。,]/).filter(Boolean).slice(-2).join('|');
        if (traitWords && text.includes(c)) {
          const still = new RegExp(`(${traitWords}|${resetTraits.source.slice(1, -1)})`, 'u');
          if (!still.test(text)) badState++;
        }
      }
    }
  }
  if (badState > 0) {
    continuityScore -= badState;
    continuityDeduct += badState;
    issues.push({ type: 'continuity', severity: 'warning', message: `角色状态跳变 ${badState} 处`, fix: '伤/湿/纱布/轮椅等状态一旦建立，后续分镜要么保留、要么写出过渡（换干衣服/拆线等）' });
  }

  // ---------- 连贯 5：节奏匹配（景别/时长/镜头运动 vs 动作密度） ----------
  // 关键时刻（抢/砸/救/撞/冲/扑/滑入/偷/取等动词）→ 近景/特写 + 时长 ≤6秒
  const keyActionRe = /(抢|砸|救母|救|铁箱滑入|冲|扑进水里|扑|撞|滑入|偷|偷走|抽走|抢回|抢回箱)/;
  let badPace = 0;
  for (const s of scenes) {
    const keyHit = keyActionRe.test(`${s.visual || ''}${s.sceneTitle || ''}${(s.dialogues || []).map(d => d.line).join('')}`);
    if (!keyHit) continue;
    const durationMatch = (s.duration || '').match(/^(\d{1,3})秒$/);
    if (durationMatch && Number(durationMatch[1]) > 8) badPace++;
    if (s.shotType && !/(特写|近景|转近景|转特写)/.test(s.shotType)) badPace++;
  }
  if (badPace > 0) {
    continuityScore -= Math.ceil(badPace / 2);
    continuityDeduct += Math.ceil(badPace / 2);
    issues.push({ type: 'continuity', severity: 'info', message: `节奏不匹配 ${badPace} 处`, fix: '关键时刻（抢/砸/救/撞）须近景/特写 + 短时长(≤6s) + 轻微晃动/快速摇摄' });
  }

  // ---------- 连贯 6：location 大场景地区一致性 ----------
  // 同大地点（基于 sceneTitle 微地点前半段聚类）的所有场景 location 必须完全同字
  let badLoc = 0;
  const locBucket = new Map<string, Set<string>>();
  for (const s of scenes) {
    const micro = (s.sceneTitle || '').split(/\s\/\s/)[0] || `${s.sceneIndex}`;
    const bucket = micro.replace(/(内|外|院|门|一|二|三|楼|卧室|客厅|堂屋|工位|走廊|楼梯口|楼梯|平台|客厅|库房|仓库|病房|急诊|门口|木船旁|自助银行|学校|安置点|米粉作坊|办公室|院外|院内|家堂屋|家|堂|家院)/g, '').trim() || micro;
    if (!locBucket.has(bucket)) locBucket.set(bucket, new Set());
    if (s.location) locBucket.get(bucket)!.add(s.location);
  }
  for (const [_, set] of locBucket) {
    if (set.size > 1) badLoc += (set.size - 1);
  }
  if (badLoc > 0) {
    continuityScore -= badLoc * 2;
    continuityDeduct += badLoc * 2;
    issues.push({ type: 'continuity', severity: 'warning', message: `同一大地点的分镜 location 用字不一致 ${badLoc} 处`, fix: '同一栋建筑/园区/街道内所有分镜，location 必须完全同字重复，不能换任何说法、加前后缀' });
  }

  score = Math.max(0, score + Math.min(continuityScore, 40) - 40);
  score = Math.max(0, Math.min(100, score));

  if (continuityScore < 30) suggestions.push('连贯性低于及格线：优先补齐 视觉承接（画面锚点）、对白对答、道具转移三节点，三者修复后连贯性会显著抬升。');

  // ======================================================================
  // ================= ★ 市场热度 4 维度评分（创意源泉集成） =================
  // ======================================================================
  // 拼接所有场景文本 → 喂给 creative-hub.computeHotnessScore
  let marketScore = 0;
  let hotness: HotnessBreakdown | undefined;
  let marketDeduct = 0;

  try {
    // 构造评论文本：场景标题 × N + 所有 visual + 所有对白 + 章节原文（如果有）
    const allSceneText = scenes.map((s) => [
      s.sceneTitle || '',
      s.visual || s.description || s.actions || '',
      (s.dialogues || []).map((d) => `${d.character}：${d.line}`).join('\n'),
    ].join('\n')).join('\n\n');
    const fullText = `${chapterContent || ''}\n${allSceneText}`;

    // 开场文本 = 第1场所有内容（用于判断钩子强度）
    const s0 = scenes[0];
    const openingText = s0 ? [
      s0.sceneTitle || '',
      s0.visual || s0.description || '',
      (s0.dialogues || []).slice(0, 3).map((d) => d.line).join(''),
    ].join(' ') : '';

    // 人设关键词 = 从对白角色名 + visual中提取的人物标签
    const charNames = [...new Set(scenes.flatMap((s) => (s.dialogues || []).map((d) => d.character)).filter(Boolean))];
    const traitWords = (() => {
      const traitRe = /(重生|穿越|黑莲花|霸总|赘婿|战神|太奶奶|奶爸|后妈|博士|循环|扮猪|冷面|清冷|精英|耙耳朵|保安|首富|神医|龙王)/g;
      const hits = fullText.match(traitRe) || [];
      return [...new Set(hits)];
    })();
    const characterKeywords = [...charNames, ...traitWords];

    // 集数估算：基于章节数量的提示
    const estimatedEpisodes = scenes.length >= 6 ? Math.max(80, scenes.length * 10) : scenes.length * 8;

    const raw = computeHotnessScore(fullText, {
      openingFirst1000Chars: openingText.slice(0, 1000),
      characterKeywords,
      structureHint: { totalEpisodes: estimatedEpisodes, acts: 5 },
    });

    marketScore = raw.total;

    // 映射到 HotnessBreakdown
    hotness = {
      total: raw.total,
      grade: raw.grade,
      dimension: {
        genreMatch: raw.dimension.genreMatch,
        hookPower: raw.dimension.hookPower,
        rhythmFit: raw.dimension.rhythmFit,
        archetypePop: raw.dimension.archetypePop,
      },
      details: raw.details,
      suggestions: raw.suggestions,
      matchedGenreNames: raw.matchedGenres.map((g) => g.name),
    };

    // 将低于60分的市场维度转化为 quality issues，便于修复器一键处理
    const marketDimensions: Array<{
      key: 'genreMatch' | 'hookPower' | 'rhythmFit' | 'archetypePop';
      label: string;
      threshold: number;
      suggestion: string;
    }> = [
      { key: 'genreMatch', label: '题材匹配度', threshold: 40, suggestion: '前往「🔥 创意灵感中心」挑选热门题材标签，一键注入剧本（推荐：重生复仇/AI漫剧玄幻/年代温情/先婚后爱/反差萌奇幻）。' },
      { key: 'hookPower', label: '钩子强度', threshold: 50, suggestion: '套用7类黄金开场钩子公式中任一类，把冲突/悬念/反差压缩到第1场前50字，删除"清晨/醒来/我叫"等铺垫。' },
      { key: 'rhythmFit', label: '节奏适配性', threshold: 45, suggestion: '按百集×5幕节奏模板规划：破局1-10集卡一/升级11-50集卡二/爆点51-100集卡三，每15-20秒一个情绪过山车。' },
      { key: 'archetypePop', label: '人设流行度', threshold: 30, suggestion: '从12大爆款人设原型中选2-3个（黑莲花/扮猪吃虎/冷面隐忍/18岁太奶奶/双强前任修罗场等），替换当前人物设定。' },
    ];

    for (const dim of marketDimensions) {
      const value = hotness.dimension[dim.key];
      if (value < dim.threshold) {
        const severity: QualityIssue['severity'] = value < 20 ? 'error' : value < 35 ? 'warning' : 'info';
        issues.push({
          type: 'market',
          dimension: dim.key,
          severity,
          message: `市场维度·${dim.label}偏低（${value}/100），影响爆款转化率`,
          fix: dim.suggestion,
        });
        marketDeduct += Math.round((dim.threshold - value) / 5);
      }
    }

    // 合并市场热度建议到全局suggestions
    if (raw.suggestions.length) {
      suggestions.push(...raw.suggestions.map((s) => `【市场热度】${s}`));
    }

    // 市场维度加分/减分
    if (marketScore >= 85) marketDeduct = +10;  // S级市场潜力 → 加分
    else if (marketScore >= 70) marketDeduct = +4;  // A级 → 小幅加分
  } catch (_e) {
    // 市场评分失败不影响主流程
    void _e;
  }

  // ======================================================================
  // =========================== 最终综合分计算 =============================
  // ======================================================================
  // 创作分（字段+连贯性）70% + 市场热度分 30% = finalScore
  const creativePart = score * 0.7;
  const marketPart = marketScore * 0.3;
  const finalScore = Math.round(Math.min(100, Math.max(0, creativePart + marketPart + (marketDeduct > 0 ? marketDeduct : 0))));

  return {
    ok: finalScore >= 65,
    issues,
    suggestions,
    score,                                                           // 创作分 0-100
    marketScore: marketScore || undefined,                            // 市场热度分 0-100
    hotness,                                                          // 热度4维度拆解
    finalScore,                                                       // 综合分 = 创作70% + 市场30% ± 修正
    continuityDeduct: Math.max(0, continuityDeduct),
    marketDeduct,
  };
}
