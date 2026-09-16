import { modelPromptManager } from '@/storage/database';
import { appendAgentSkillPrompt, type AgentSkillPromptContext } from '@/lib/agent-skills';
import { getSkillTextByPromptCode, recordStageUsage } from '@/lib/skill-service';
import { stageByPromptCode } from '@/lib/skill-stage';

async function applyStageSkill(code: string, prompt: string): Promise<string> {
  try {
    const stage = stageByPromptCode(code);
    if (!stage) return prompt;
    void recordStageUsage(stage, code);
    const skillText = await getSkillTextByPromptCode(code);
    if (!skillText) return prompt;
    return prompt ? prompt + '\n\n' + skillText : skillText;
  } catch {
    return prompt;
  }
}

/**
 * 从数据库获取提示词，如果数据库无记录则使用fallback
 * 
 * 注意：数据库中的提示词是静态指令文本，不包含动态变量。
 * 动态内容（如章节索引、批次信息等）由各路由在获取提示词后自行附加。
 * 
 * @param code 提示词代码（如 'idea', 'chapter-stream', 'video-prompts' 等）
 * @param fallback 数据库无记录时的默认提示词
 */
export async function getPromptWithFallback(
  code: string,
  fallback: string,
  context?: AgentSkillPromptContext,
): Promise<string> {
  try {
    const dbPrompt = await modelPromptManager.getPrompt(code, context);
    
    // 如果数据库有记录且有内容，使用数据库版本（同样追加项目内置 agent-skills 技能库增强）
    if (dbPrompt && dbPrompt.systemPrompt) {
      return applyStageSkill(code, appendAgentSkillPrompt(code, dbPrompt.systemPrompt, context));
    }
  } catch (error) {
    console.warn(`[PromptHelper] Failed to get prompt "${code}" from DB, using fallback:`, error);
  }
  
  return applyStageSkill(code, appendAgentSkillPrompt(code, fallback, context));
}

/**
 * 占位符替换：把 {{xxx}} 换成实际值。
 *
 * 背景：后台自定义提示词里常残留 {{perspectiveGuide}} / {{perspectiveRules}} 等占位符，
 * 而各路由的历史实现有的替换、有的没替换 —— 未替换时模型会看到裸变量，对应约束直接失效。
 * 未知占位符保持原样，避免误伤自定义文案。
 */
export function resolvePromptPlaceholders(
  prompt: string,
  vars: Record<string, string | undefined>,
): string {
  if (!prompt) return prompt;
  return String(prompt).replace(/\{\{\s*(\w+)\s*\}\}/g, (matched, key: string) => {
    const v = vars[key];
    return v === undefined || v === null || v === '' ? matched : String(v);
  });
}

/**
 * 护栏兜底：若提示词里不含 marker（说明后台版本把核心铁律改没了），强制追加一段不可省略的硬约束。
 *
 * 这样既保留后台自定义提示词的自由度，又保证关键约束不会被悄悄卸掉。
 */
export function appendGuardIfMissing(
  prompt: string,
  marker: string,
  guard: string,
): string {
  const base = prompt || '';
  return base.includes(marker) ? base : base + guard;
}

/**
 * 从数据库获取系统提示词和用户提示词
 * 
 * @param code 提示词代码
 * @param fallbackSystem 默认系统提示词
 * @param fallbackUser 默认用户提示词
 */
export async function getPromptsWithFallback(
  code: string,
  fallbackSystem: string,
  fallbackUser?: string,
  context?: AgentSkillPromptContext,
): Promise<{ systemPrompt: string; userPrompt: string | undefined }> {
  try {
    const dbPrompt = await modelPromptManager.getPrompt(code, context);
    
    if (dbPrompt && dbPrompt.systemPrompt) {
      return {
        systemPrompt: await applyStageSkill(code, appendAgentSkillPrompt(code, dbPrompt.systemPrompt, context)),
        userPrompt: dbPrompt.userPrompt || undefined,
      };
    }
  } catch (error) {
    console.warn(`[PromptHelper] Failed to get prompts "${code}" from DB, using fallback:`, error);
  }
  
  return {
    systemPrompt: await applyStageSkill(code, appendAgentSkillPrompt(code, fallbackSystem, context)),
    userPrompt: fallbackUser,
  };
}
