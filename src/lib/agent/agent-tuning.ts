import {
  getSystemSettings,
  resolveRoleTuning,
  defaultAgentMemory,
  type AgentMemorySettings,
  type SystemSettings,
} from '@/lib/system-settings';

/** 系统配置缓存（避免每次模型调用都读文件） */
const TTL_MS = 10_000;
let cache: { at: number; settings: SystemSettings } | null = null;

export async function getCachedSystemSettings(): Promise<SystemSettings> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.settings;
  const settings = await getSystemSettings();
  cache = { at: now, settings };
  return settings;
}

export function invalidateSystemSettingsCache() {
  cache = null;
}

/** 角色最终调参：null 字段表示跟随调用点默认值 */
export interface RoleTuning {
  configId: string | null;
  temperature: number | null;
  maxTokens: number | null;
}

export async function loadRoleTuning(roleId: string | undefined): Promise<RoleTuning | null> {
  if (!roleId) return null;
  try {
    const settings = await getCachedSystemSettings();
    return resolveRoleTuning(settings, roleId);
  } catch {
    return null;
  }
}

export async function loadAgentMemorySettings(): Promise<AgentMemorySettings> {
  try {
    const settings = await getCachedSystemSettings();
    return settings.agentMemory;
  } catch {
    return defaultAgentMemory;
  }
}
