import { aiConfigManager } from '@/storage/database/aiConfigManager';
import type { AiConfig } from '@/storage/database/shared/schema';

export interface MediaExtraConfig {
  endpointPath?: string;
  requestTemplate?: string;
  responseUrlPath?: string;
  pollEndpoint?: string;
  pollIdPath?: string;
  pollResultPath?: string;
  pollStatusPath?: string;
  pollSuccessValues?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export interface MediaGenInput {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  /** 额外占位符变量 */
  extra?: Record<string, string | number>;
}

export interface MediaGenResult {
  url: string;
  raw?: any;
}

/** 拼接 URL，避免 // 重复 */
function joinUrl(base: string, path: string): string {
  if (!path) return base;
  if (/^https?:\/\//i.test(path)) return path;
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

/** 沿用 dot.path[index] 的解析 */
function getByPath(obj: any, path: string): any {
  if (!path) return undefined;
  // 支持 a.b.0.c 与 a.b[0].c 两种语法
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** 替换 {{var}} 占位符（保留 JSON 结构）*/
function applyTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => {
    if (key in vars) {
      const v = vars[key];
      // 转义 JSON 字符串中的特殊字符
      return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    }
    return '';
  });
}

function parseExtra(config: AiConfig): MediaExtraConfig {
  if (!config.extraConfig) return {};
  try {
    const v = typeof config.extraConfig === 'string' ? JSON.parse(config.extraConfig) : config.extraConfig;
    return (v && typeof v === 'object') ? v : {};
  } catch {
    return {};
  }
}

/**
 * 根据 AI 配置调用图片/视频生成接口，自动处理同步与异步轮询。
 */
export async function generateMedia(configId: string, input: MediaGenInput): Promise<MediaGenResult> {
  const config = await aiConfigManager.getConfigById(configId);
  if (!config) throw new Error('AI 配置不存在或已禁用');
  if (config.modelType !== 'image' && config.modelType !== 'video') {
    throw new Error(`配置 ${config.name} 不是图片/视频类型`);
  }

  const extra = parseExtra(config);
  const endpoint = extra.endpointPath || (config.modelType === 'image' ? '/images/generations' : '/videos/generations');
  const requestTemplate = (extra.requestTemplate || '').trim() || (config.modelType === 'image'
    ? `{"model":"{{model}}","prompt":"{{prompt}}","n":1,"size":"1024x1024"}`
    : `{"model":"{{model}}","prompt":"{{prompt}}","duration":6,"aspect_ratio":"16:9"}`);
  const responseUrlPath = extra.responseUrlPath || (config.modelType === 'image' ? 'data.0.url' : 'id');

  const vars: Record<string, string | number> = {
    model: config.model || '',
    prompt: input.prompt || '',
    negativePrompt: input.negativePrompt || '',
    aspectRatio: input.aspectRatio || '',
    ...(input.extra || {}),
  };

  let body: any;
  try {
    body = JSON.parse(applyTemplate(requestTemplate, vars));
  } catch (e) {
    throw new Error(`请求体模板渲染后不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }

  const url = joinUrl(config.apiUrl, endpoint);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const respJson = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = (respJson && (respJson.error?.message || respJson.message || respJson.msg))
      || `HTTP ${res.status}`;
    throw new Error(`生成失败：${errMsg}`);
  }

  const initialValue = getByPath(respJson, responseUrlPath);
  if (initialValue == null) {
    throw new Error(`未在响应中找到 ${responseUrlPath} 字段。原始响应：${JSON.stringify(respJson).slice(0, 500)}`);
  }

  // 同步：返回的是 URL
  if (typeof initialValue === 'string' && /^https?:\/\//i.test(initialValue)) {
    return { url: initialValue, raw: respJson };
  }

  // 异步：需要轮询
  if (!extra.pollEndpoint) {
    // 无轮询配置，但返回的不是 URL —— 直接返回字符串当作 URL（部分平台可能返回纯文本路径）
    if (typeof initialValue === 'string') {
      return { url: initialValue, raw: respJson };
    }
    throw new Error(`响应字段 ${responseUrlPath} 不是 URL 字符串，且未配置轮询`);
  }

  const taskId = String(initialValue);
  const pollPath = extra.pollEndpoint.replace(/\{\{\s*taskId\s*\}\}/g, encodeURIComponent(taskId));
  const pollUrl = joinUrl(config.apiUrl, pollPath);
  const interval = Math.max(1000, Number(extra.pollIntervalMs) || 3000);
  const timeout = Math.max(10000, Number(extra.pollTimeoutMs) || 300000);
  const successValues = (extra.pollSuccessValues || 'success,succeeded,completed,SUCCESS,Succeeded')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const startTs = Date.now();

  while (Date.now() - startTs < timeout) {
    await new Promise(r => setTimeout(r, interval));
    let pollResp: any = null;
    try {
      const r = await fetch(pollUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      pollResp = await r.json().catch(() => ({}));
      if (!r.ok) {
        // 临时错误，继续轮询
        continue;
      }
    } catch {
      continue;
    }

    const status = extra.pollStatusPath ? getByPath(pollResp, extra.pollStatusPath) : null;
    const resultUrl = extra.pollResultPath ? getByPath(pollResp, extra.pollResultPath) : null;

    if (status != null && successValues.includes(String(status).toLowerCase())) {
      if (typeof resultUrl === 'string' && resultUrl) {
        return { url: resultUrl, raw: pollResp };
      }
      throw new Error(`任务已完成但未在 ${extra.pollResultPath} 找到 URL`);
    }

    // 部分平台直接返回 URL 即视为成功
    if (typeof resultUrl === 'string' && /^https?:\/\//i.test(resultUrl)) {
      return { url: resultUrl, raw: pollResp };
    }

    // 失败状态
    const failTokens = ['failed', 'error', 'cancelled', 'canceled', 'expired'];
    if (status != null && failTokens.includes(String(status).toLowerCase())) {
      throw new Error(`生成失败：任务状态 = ${status}`);
    }
  }

  throw new Error(`轮询超时（${timeout}ms 内未完成）`);
}

/** 列出可用于指定类型的配置（系统级 + 用户级），用于前端选择 */
export async function listMediaConfigs(userId: string, type: 'image' | 'video' | 'tts') {
  const { system, user } = await aiConfigManager.getAvailableConfigs(userId);
  const filter = (c: AiConfig) => c.modelType === type && c.isActive === 1;
  return {
    system: system.filter(filter).map(stripSecrets),
    user: user.filter(filter).map(stripSecrets),
  };
}

function stripSecrets<T extends AiConfig>(c: T): Omit<T, 'apiKey'> {
  const { apiKey: _omit, ...rest } = c;
  return rest;
}
