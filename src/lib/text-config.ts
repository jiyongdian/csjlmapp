import { aiConfigManager } from '@/storage/database/aiConfigManager';
import { getModelName, getRawAIConfig } from '@/lib/ai-config';

/**
 * 未指定文字模型时，自动取「用户默认 → 系统默认」的文字模型配置。
 *
 * 不这样做的话，底层 getRawAIConfig 会回退到环境变量里的默认端点（通常没有 Key），
 * 导致 AI 调用静默失败、悄悄降级成本地规则提取。
 */
export async function resolveTextConfigId(userId: string, explicit?: unknown): Promise<string | null> {
  const given = explicit ? String(explicit).trim() : '';
  if (given) return given;

  try {
    const userTexts = await aiConfigManager.getUserConfigsByModelType(userId, 'text');
    const activeUser = (userTexts || []).filter((c: any) => c.isActive && c.apiKey);
    if (activeUser.length > 0) return String(activeUser[0].id);
  } catch (error) {
    console.warn('[text-config] 读取用户文字模型失败:', error);
  }

  try {
    const sysTexts = await aiConfigManager.getSystemConfigsByModelType('text');
    const activeSys = (sysTexts || []).filter((c: any) => c.isActive && c.apiKey);
    if (activeSys.length > 0) return String(activeSys[0].id);
  } catch (error) {
    console.warn('[text-config] 读取系统文字模型失败:', error);
  }

  return null;
}

/** 取文字模型的连接信息，用于需要直接 fetch 的场景 */
export async function getTextModelRuntime(
  configId?: string | null,
): Promise<{ apiUrl: string; apiKey: string; model: string } | null> {
  const { apiUrl, apiKey } = await getRawAIConfig(configId);
  if (!apiKey) return null;
  const model = await getModelName(configId, process.env.AI_MODEL || 'deepseek-v4-flash');
  return { apiUrl, apiKey, model };
}

/** 拼接 chat/completions 端点 */
export function buildChatEndpoint(apiUrl: string): string {
  return apiUrl.endsWith('/chat/completions') ? apiUrl : `${apiUrl.replace(/\/+$/, '')}/chat/completions`;
}
