/**
 * 统一API响应格式和错误处理工具
 */

import { NextResponse } from 'next/server';
import { getUserFromToken, type JWTPayload } from '@/lib/auth';

/**
 * 成功响应
 */
export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

/**
 * 错误响应
 */
export function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

/**
 * 认证检查中间件
 * 从请求头提取并验证Token，返回用户信息
 * 支持游客模式（无需登录即可访问的接口）
 */
export function checkAuth(request: Request, options: { requireLogin?: boolean; allowGuest?: boolean } = {}): {
  success: boolean;
  user: JWTPayload | null;
  response?: NextResponse;
} {
  const authHeader = request.headers.get('authorization');
  const user = getUserFromToken(authHeader);

  // 游客模式：未登录不拦截
  if (options.allowGuest && !user) {
    return { success: true, user: null };
  }

  // 需要登录
  if (!user) {
    return {
      success: false,
      user: null,
      response: errorResponse('请先登录', 401),
    };
  }

  return { success: true, user };
}

/**
 * 带超时的fetch请求
 * 默认超时30秒，可配置
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 调用LLM API（直接fetch，不依赖SDK）
 * 统一处理超时、错误、解析、重试
 * 
 * 重要：apiUrl 和 apiKey 必须来自同一个提供商的配置！
 * 请使用 getRawAIConfig(configId) 获取配置，它已经处理好了跨提供商安全
 */
export async function callLLMApi(
  apiUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  options: {
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
    stream?: boolean;
    maxRetries?: number;
  } = {},
): Promise<{ content: string; success: boolean; error?: string }> {
  const { temperature = 0.7, maxTokens = 4096, timeout = 30000, stream = false, maxRetries = 2 } = options;

  if (!apiKey) {
    return { content: '', success: false, error: 'API密钥未配置' };
  }

  const url = `${apiUrl.replace(/\/$/, '')}/chat/completions`;
  console.log(`[LLM API] Calling ${url} with model ${model}`);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const waitTime = 1000 * attempt;
        console.log(`[LLM API] Retry ${attempt}/${maxRetries} after ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      const body = JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream,
      });

      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body,
        timeout,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error(`[LLM API] Error ${response.status} (attempt ${attempt + 1}):`, errorText.substring(0, 200));

        // 401 不重试（key 无效，重试也没用）
        if (response.status === 401) {
          return {
            content: '',
            success: false,
            error: 'AI接口认证失败：API密钥无效或已过期',
          };
        }
        // 404 不重试（URL 错误）
        if (response.status === 404) {
          return {
            content: '',
            success: false,
            error: 'AI接口地址错误：请检查API URL配置',
          };
        }
        // 其他错误，重试
        if (attempt < maxRetries) {
          continue;
        }
        return {
          content: '',
          success: false,
          error: `AI接口错误 ${response.status}: ${errorText.substring(0, 100)}`,
        };
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || '';

      if (!content.trim()) {
        if (attempt < maxRetries) {
          console.warn(`[LLM API] Empty content on attempt ${attempt + 1}, retrying...`);
          continue;
        }
        return { content: '', success: false, error: 'AI返回内容为空' };
      }

      return { content, success: true };
    } catch (error: any) {
      const isTimeout = error?.name === 'AbortError';
      const message = isTimeout ? `请求超时（${timeout / 1000}秒）` : error?.message || '未知错误';
      console.error(`[LLM API] Exception (attempt ${attempt + 1}):`, message);

      if (isTimeout || attempt < maxRetries) {
        if (attempt < maxRetries) continue;
        return { content: '', success: false, error: message };
      }
      return { content: '', success: false, error: message };
    }
  }

  return { content: '', success: false, error: 'AI调用失败，已达最大重试次数' };
}

/**
 * 从请求中提取configId
 */
export function extractConfigId(body: any): string | null {
  return body?.configId || null;
}

/**
 * 获取数据库中的AI配置（带缓存）
 */
import { aiConfigManager } from '@/storage/database/aiConfigManager';

const configCache = new Map<string, { config: any; expiry: number }>();
const CACHE_TTL = 60000; // 1分钟缓存

export async function getCachedAIConfig(configId: string | null): Promise<{
  apiUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
} | null> {
  // 无configId，返回null（使用env变量）
  if (!configId) {
    return null;
  }

  // 检查缓存
  const cached = configCache.get(configId);
  if (cached && cached.expiry > Date.now()) {
    return cached.config;
  }

  try {
    const aiConfig = await aiConfigManager.getConfigById(configId);
    if (!aiConfig || !aiConfig.isActive) {
      console.warn(`[AIConfig] 配置 ${configId} 不存在或已禁用`);
      return null;
    }

    const result = {
      apiUrl: aiConfig.apiUrl || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
      apiKey: aiConfig.apiKey || process.env.OPENAI_API_KEY || '',
      model: aiConfig.model || 'deepseek-v4-flash',
      temperature: (aiConfig.temperature ?? 70) / 100, // 0-100转0-1
    };

    // 写入缓存
    configCache.set(configId, { config: result, expiry: Date.now() + CACHE_TTL });

    return result;
  } catch (error) {
    console.error(`[AIConfig] 获取配置失败:`, error);
    return null;
  }
}

/**
 * 清除配置缓存（配置更新后调用）
 */
export function clearAIConfigCache() {
  configCache.clear();
}
