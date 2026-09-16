import { skillManager } from '@/storage/database';
import { skillLearningManager, type SkillVersionRecord, type SkillUsageRecord } from '@/storage/database/skillLearningManager';
import {
  SKILL_STAGES, SYSTEM_SKILL_USER, getStageDef, stageByPromptCode, type SkillStage,
} from '@/lib/skill-stage';

const CACHE_TTL = 30_000;
let cache: { at: number; value: Record<SkillStage, string> } | null = null;

const AUTO_BLOCK_HEADER = '【自动强化规则】';

const REINFORCEMENT_RULES: Record<SkillStage, { marker: string; rule: string }[]> = {
  novel: [
    { marker: '章末钩子', rule: '章末钩子：每章结尾必须抛出一个具体悬念或未解问题，禁止以总结、抒情或时间跳转收尾。' },
    { marker: '一致性检查', rule: '一致性检查：落笔前核对人物设定、前文伏笔与时间线，出现冲突时以已有设定为准。' },
    { marker: '去 AI 味', rule: '去 AI 味：避免成排的形容词、对称排比与万能抒情句；用具体动作和细节代替抽象概括。' },
    { marker: '对白推进', rule: '对白推进：对话要承担信息或冲突，禁止只用于寒暄与重复已知信息。' },
  ],
  script: [
    { marker: '可拍摄性', rule: '可拍摄性：所有描述必须能转成镜头，禁止写不可拍的内心独白与抽象心理。' },
    { marker: '场景钩子', rule: '场景钩子：每场戏结尾留转折或悬念，衔接下一场。' },
    { marker: '台词信息量', rule: '台词信息量：每句台词要么推进剧情、要么塑造人物，不写无信息量的寒暄。' },
    { marker: '格式规范', rule: '格式规范：场景标题／出场人物／动作／对白分行输出，便于后续拆分镜与配音。' },
  ],
  'image-prompt': [
    { marker: '主体优先', rule: '主体优先：先写清画面主体与动作，再补环境、光线、构图，避免主次颠倒。' },
    { marker: '可视觉化', rule: '可视觉化：只使用能画出来的名词与形容词，禁止比喻、成语与心理描写。' },
    { marker: '角色一致性', rule: '角色一致性：同一角色在各分镜中的外貌、发型、服装、年龄描述必须完全一致。' },
    { marker: '参考提及', rule: '参考提及：画面中出现的人物／场景／物品按登记名称以 @ 提及，便于参考图匹配。' },
  ],
  'video-prompt': [
    { marker: '运镜明确', rule: '运镜明确：每个镜头必须写明机位与运动方式（推、拉、摇、移、跟、升降）及速度。' },
    { marker: '时间轴分段', rule: '时间轴分段：把镜头拆成若干时间片逐段描述画面变化，保证可执行。' },
    { marker: '声音设计', rule: '声音设计：标注对白、音效与音乐情绪，并与画面节奏对齐。' },
    { marker: '首尾衔接', rule: '首尾衔接：镜头起始状态承接上一镜头结尾，避免跳变。' },
  ],
};

export function invalidateSkillCache(): void {
  cache = null;
}

export async function listStageSkills(stage: SkillStage) {
  const all = await skillManager.listAllByUser(SYSTEM_SKILL_USER);
  return all.filter((s) => s.category === stage);
}

async function buildStageTexts(): Promise<Record<SkillStage, string>> {
  const all = await skillManager.listByUser(SYSTEM_SKILL_USER);
  const out: Record<SkillStage, string> = { novel: '', script: '', 'image-prompt': '', 'video-prompt': '' };
  for (const stage of SKILL_STAGES) {
    const parts = all
      .filter((s) => s.category === stage.key)
      .map((s) => (s.systemPrompt || '').trim())
      .filter(Boolean);
    out[stage.key] = parts.join('\n\n');
  }
  return out;
}

export async function getStageSkillText(stage: SkillStage): Promise<string> {
  try {
    if (!cache || Date.now() - cache.at > CACHE_TTL) {
      cache = { at: Date.now(), value: await buildStageTexts() };
    }
    return cache.value[stage] || '';
  } catch {
    return '';
  }
}

export async function getSkillTextByPromptCode(code: string): Promise<string> {
  const stage = stageByPromptCode(code);
  if (!stage) return '';
  return getStageSkillText(stage);
}

export async function recordStageUsage(stage: SkillStage, promptCode: string, refId?: string): Promise<void> {
  try {
    const skills = (await skillManager.listByUser(SYSTEM_SKILL_USER)).filter((s) => s.category === stage);
    for (const skill of skills) {
      await skillLearningManager.recordUsage({ skillId: skill.id, stage, promptCode, refId: refId ?? null });
    }
    void maybeAutoOptimize(stage);
  } catch {
    /* 学习记录失败不影响生成 */
  }
}

export async function seedStageSkills(): Promise<{ created: number; skipped: number }> {
  const existing = await skillManager.listAllByUser(SYSTEM_SKILL_USER);
  let created = 0;
  let skipped = 0;
  for (let i = 0; i < SKILL_STAGES.length; i++) {
    const stage = SKILL_STAGES[i];
    const has = existing.some((s) => s.category === stage.key && s.name === stage.defaultSkill.name);
    if (has) {
      skipped++;
      continue;
    }
    const skill = await skillManager.create({
      userId: SYSTEM_SKILL_USER,
      name: stage.defaultSkill.name,
      description: stage.defaultSkill.description,
      category: stage.key as any,
      systemPrompt: stage.defaultSkill.systemPrompt,
      userPrompt: stage.defaultSkill.userPrompt,
      parameters: { autoOptimize: false, optimizeThreshold: 20 },
      isDefault: true,
      isActive: true,
      sortOrder: i * 10,
    });
    await skillLearningManager.createVersion({
      skillId: skill.id,
      systemPrompt: skill.systemPrompt,
      userPrompt: skill.userPrompt,
      note: '默认技能初始版本',
      source: 'seed',
      status: 'active',
    });
    created++;
  }
  invalidateSkillCache();
  return { created, skipped };
}

export async function applySkillVersion(versionId: string) {
  const version = await skillLearningManager.getVersion(versionId);
  if (!version) return null;
  const skill = await skillManager.getById(version.skillId);
  if (!skill) return null;
  await skillLearningManager.activateVersion(versionId);
  const updated = await skillManager.update(skill.id, skill.userId, {
    systemPrompt: version.systemPrompt ?? '',
    userPrompt: version.userPrompt ?? '',
  });
  invalidateSkillCache();
  return updated;
}

function stripAutoBlock(text: string): string {
  const idx = text.indexOf(AUTO_BLOCK_HEADER);
  return idx === -1 ? text.trimEnd() : text.slice(0, idx).trimEnd();
}

function buildReinforced(base: string, stage: SkillStage): { text: string; applied: string[] } {
  const clean = stripAutoBlock(base || '');
  const rules = REINFORCEMENT_RULES[stage] || [];
  const missing = rules.filter((r) => clean.indexOf(r.marker) === -1);
  if (!missing.length) return { text: clean, applied: [] };
  const block = [AUTO_BLOCK_HEADER, ...missing.map((r, i) => `${i + 1}. ${r.rule}`)].join('\n');
  return { text: clean ? clean + '\n\n' + block : block, applied: missing.map((r) => r.marker) };
}

export interface OptimizeResult {
  skillId: string;
  stage: SkillStage;
  usageCount: number;
  version: SkillVersionRecord;
  insights: string[];
  appliedRules: string[];
}

export async function optimizeSkill(skillId: string, source: 'manual' | 'auto' = 'manual'): Promise<OptimizeResult | null> {
  const skill = await skillManager.getById(skillId);
  if (!skill) return null;
  const stageDef = getStageDef(skill.category);
  if (!stageDef) return null;
  const stage = stageDef.key;

  const usageCount = await skillLearningManager.usageCount(skillId);
  const recent: SkillUsageRecord[] = await skillLearningManager.recentUsage(skillId, 200);
  const codes = Array.from(new Set(recent.map((r) => r.promptCode).filter(Boolean))) as string[];

  const { text, applied } = buildReinforced(skill.systemPrompt || '', stage);

  const insights: string[] = [];
  insights.push(`该技能累计被生成流程调用 ${usageCount} 次。`);
  if (codes.length) insights.push(`覆盖提示词点位：${codes.join('、')}。`);
  else insights.push('尚未采集到调用点位，建议先在对应生成页跑一次生成。');
  if (applied.length) insights.push(`补齐了缺失的强化规则：${applied.join('、')}。`);
  else insights.push('当前技能已覆盖全部必备强化规则，本次仅做内容规整。');
  insights.push(`注入范围：${stageDef.label}（${stageDef.codes.join('、')}）。`);

  const version = await skillLearningManager.createVersion({
    skillId,
    systemPrompt: text,
    userPrompt: skill.userPrompt || '',
    note: `第 ${usageCount} 次调用后${source === 'auto' ? '自动' : '手动'}优化｜补齐：${applied.length ? applied.join('、') : '无'}`,
    source,
    status: 'draft',
  });

  return { skillId, stage, usageCount, version, insights, appliedRules: applied };
}

async function maybeAutoOptimize(stage: SkillStage): Promise<void> {
  try {
    const skills = (await skillManager.listByUser(SYSTEM_SKILL_USER)).filter((s) => s.category === stage);
    for (const skill of skills) {
      const params = skill.parameters || {};
      if (!params.autoOptimize) continue;
      const threshold = Number(params.optimizeThreshold) > 0 ? Number(params.optimizeThreshold) : 20;
      const usage = await skillLearningManager.usageCount(skill.id);
      const versions = await skillLearningManager.listVersions(skill.id);
      const lastVersionAt = versions[0]?.createdAt ? Date.parse(versions[0].createdAt) : 0;
      const since = await skillLearningManager.recentUsage(skill.id, 1000);
      const sinceCount = since.filter((r) => Date.parse(r.createdAt) > lastVersionAt).length;
      if (sinceCount >= threshold) await optimizeSkill(skill.id, 'auto');
    }
  } catch {
    /* 自动优化失败不影响生成 */
  }
}
