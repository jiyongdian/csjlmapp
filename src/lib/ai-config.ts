import { LLMClient, Config } from 'coze-coding-dev-sdk';
import { aiConfigManager } from '@/storage/database/aiConfigManager';

// SDK默认超时900秒太长，设置为30秒
const DEFAULT_TIMEOUT = 30000;

/**
 * 根据 configId 创建 LLMClient
 * 如果 configId 为空或查找失败，使用默认 Config()
 */
export async function createLLMClient(configId?: string | null): Promise<LLMClient> {
  // 设置全局环境变量，确保SDK能读取到凭证
  if (process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  }
  if (process.env.OPENAI_BASE_URL) {
    process.env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
  }

  if (!configId) {
    // 如果没有configId，使用默认配置或环境变量
    if (process.env.OPENAI_API_KEY) {
      const defaultConfig = new Config({
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
        modelBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
        apiKey: process.env.OPENAI_API_KEY,
        timeout: DEFAULT_TIMEOUT,
      });
      return new LLMClient(defaultConfig);
    }
    return new LLMClient(new Config({ timeout: DEFAULT_TIMEOUT }));
  }

  try {
    const aiConfig = await aiConfigManager.getConfigById(configId);
    if (!aiConfig || !aiConfig.isActive) {
      console.warn(`[AIConfig] Config ${configId} not found or inactive, using default`);
      if (process.env.OPENAI_API_KEY) {
        const defaultConfig = new Config({
          baseUrl: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
          modelBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
          apiKey: process.env.OPENAI_API_KEY,
          timeout: DEFAULT_TIMEOUT,
        });
        return new LLMClient(defaultConfig);
      }
      return new LLMClient(new Config({ timeout: DEFAULT_TIMEOUT }));
    }

    const customUrl = aiConfig.apiUrl || '';
    const customKey = aiConfig.apiKey || '';

    // 场景1: 有key → 使用自定义完整配置
    if (customKey) {
      const customConfig = new Config({
        baseUrl: customUrl || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
        modelBaseUrl: customUrl || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
        apiKey: customKey,
        timeout: DEFAULT_TIMEOUT,
      });
      return new LLMClient(customConfig);
    }

    // 场景2: 有URL但无key → 回退到默认（不混用不同提供商的key）
    if (customUrl && !customKey) {
      console.warn(`[AIConfig] Config ${configId} has URL but no key, falling back to default provider`);
      if (process.env.OPENAI_API_KEY) {
        const defaultConfig = new Config({
          baseUrl: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
          modelBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
          apiKey: process.env.OPENAI_API_KEY,
          timeout: DEFAULT_TIMEOUT,
        });
        return new LLMClient(defaultConfig);
      }
      return new LLMClient(new Config({ timeout: DEFAULT_TIMEOUT }));
    }

    // 都为空，使用默认
    if (process.env.OPENAI_API_KEY) {
      const defaultConfig = new Config({
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
        modelBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
        apiKey: process.env.OPENAI_API_KEY,
        timeout: DEFAULT_TIMEOUT,
      });
      return new LLMClient(defaultConfig);
    }
    return new LLMClient(new Config({ timeout: DEFAULT_TIMEOUT }));
  } catch (error) {
    console.error(`[AIConfig] Failed to create LLMClient for config ${configId}:`, error);
    if (process.env.OPENAI_API_KEY) {
      const defaultConfig = new Config({
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
        modelBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
        apiKey: process.env.OPENAI_API_KEY,
        timeout: DEFAULT_TIMEOUT,
      });
      return new LLMClient(defaultConfig);
    }
    return new LLMClient(new Config({ timeout: DEFAULT_TIMEOUT }));
  }
}

/**
 * 获取 configId 对应的模型名称
 * 如果 configId 为空或查找失败，返回默认模型
 */
export async function getModelName(configId?: string | null, defaultModel?: string): Promise<string> {
  // 优先使用环境变量配置的默认模型
  const envDefault = process.env.AI_MODEL || 'deepseek-v4-flash';
  const effectiveDefault = defaultModel || envDefault;
  
  if (!configId) {
    return effectiveDefault;
  }

  try {
    const aiConfig = await aiConfigManager.getConfigById(configId);
    if (aiConfig && aiConfig.model) {
      return aiConfig.model;
    }
    return effectiveDefault;
  } catch {
    return effectiveDefault;
  }
}

/**
 * 获取原始 AI 配置（apiUrl + apiKey），用于需要直接 fetch 的场景（如设置 max_tokens）
 * 
 * 跨提供商安全规则：
 * - 自定义配置有 key → 使用自定义 URL + 自定义 key
 * - 自定义配置无 key → 使用默认 URL + 默认 key（不混用不同提供商的 URL/Key）
 * - 自定义配置无 URL → 使用默认 URL + 自定义 key（如果有）
 */
export async function getRawAIConfig(configId?: string | null): Promise<{ apiUrl: string; apiKey: string; provider: string }> {
  const defaultUrl = process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1';
  const defaultKey = process.env.OPENAI_API_KEY || '';
  const defaultProvider = 'deepseek';

  if (!configId) {
    return { apiUrl: defaultUrl, apiKey: defaultKey, provider: defaultProvider };
  }

  try {
    const aiConfig = await aiConfigManager.getConfigById(configId);
    if (aiConfig && aiConfig.isActive) {
      const customUrl = aiConfig.apiUrl || '';
      const customKey = aiConfig.apiKey || '';
      const provider = aiConfig.provider || '';

      // 场景1: 自定义配置有key → 使用自定义URL + 自定义key（完整的自定义配置）
      if (customKey) {
        return { 
          apiUrl: customUrl || defaultUrl, 
          apiKey: customKey,
          provider: provider || 'custom'
        };
      }

      // 场景2: 自定义配置无key但有URL → 不混用，回退到默认配置（不同提供商的key不兼容）
      if (customUrl && !customKey) {
        console.warn(`[AIConfig] Config ${configId} has URL but no key, falling back to default provider`);
        return { apiUrl: defaultUrl, apiKey: defaultKey, provider: defaultProvider };
      }

      // 场景3: 自定义配置有key无URL
      if (!customUrl && customKey) {
        return { apiUrl: defaultUrl, apiKey: customKey, provider: provider || 'custom' };
      }

      // 场景4: 都为空，使用默认
      return { apiUrl: defaultUrl, apiKey: defaultKey, provider: defaultProvider };
    }
    return { apiUrl: defaultUrl, apiKey: defaultKey, provider: defaultProvider };
  } catch {
    return { apiUrl: defaultUrl, apiKey: defaultKey, provider: defaultProvider };
  }
}

/**
 * 获取 configId 对应的 temperature
 * 如果 configId 为空或查找失败，返回默认值
 */
export async function getTemperature(configId?: string | null, defaultTemp: number = 0.7): Promise<number> {
  if (!configId) {
    return defaultTemp;
  }

  try {
    const aiConfig = await aiConfigManager.getConfigById(configId);
    if (aiConfig && aiConfig.temperature !== null && aiConfig.temperature !== undefined) {
      // temperature 存储为 0-100 的整数，需要转换为 0-1 的小数
      return aiConfig.temperature / 100;
    }
    return defaultTemp;
  } catch {
    return defaultTemp;
  }
}