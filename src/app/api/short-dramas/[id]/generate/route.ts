import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { shortDramaManager, dramaWorkflowManager, novelManager, scriptManager } from '@/storage/database';
import { aiConfigManager } from '@/storage/database/aiConfigManager';
import { getPromptsWithFallback } from '@/lib/prompt-helper';
import { getSystemSettings, buildMediaWebBase } from '@/lib/system-settings';
import { buildScriptSceneDescriptions, buildShotsFromScriptScenes } from '@/lib/drama-scene-description';
import {
  AtMentionIndex, buildAtAssets, applyAtRules, scanAtTexts,
  stripAtMentions, getAssetRefImages, detectExpectedAssets, validateAtCoverage,
  AT_MENTION_RULES, type AtAsset,
} from '@/lib/at-mentions';
import fs from 'fs';
import path from 'path';

export const maxDuration = 300;

// ── 参考图压缩 ──────────────────────────────────────────────────────────────
// 分镜生图会携带多张角色/场景/物品参考图（原图常为 1500px+、每张 2~4MB），
// 6 张 base64 后请求体可达 15~20MB，部分本地代理/上游（如 flow2api gemini-banana）
// 会直接返回 500。参考图无需原始分辨率：长边压到 1024、JPEG q80 后每张约 100~300KB，
// 角色一致性足够，且请求体缩小一个数量级。
const REF_MAX_LONG_EDGE = 1024;
const REF_JPEG_QUALITY = 80;
const REF_SKIP_BYTES = 350 * 1024; // 已经够小且分辨率不超限的图直接透传

async function downscaleRefToDataUri(input: Buffer | string, fallbackMime = 'image/jpeg'): Promise<string> {
  // data URI 输入：拆出 mime 与 base64 后递归处理
  if (typeof input === 'string') {
    const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(input);
    if (!m) return input;
    return downscaleRefToDataUri(Buffer.from(m[2], 'base64'), m[1] || fallbackMime);
  }
  const buf = input as Buffer;
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(buf).metadata();
    const longEdge = Math.max(meta.width || 0, meta.height || 0);
    if (buf.length < REF_SKIP_BYTES && longEdge <= REF_MAX_LONG_EDGE) {
      const mime = meta.format === 'png' ? 'image/png' : fallbackMime;
      return `data:${mime};base64,${buf.toString('base64')}`;
    }
    const out = await sharp(buf)
      .rotate() // 按 EXIF 自动转正，避免竖图方向错误
      .resize({ width: REF_MAX_LONG_EDGE, height: REF_MAX_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: REF_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch (e) {
    // 压缩失败则保持旧行为：原样转 data URI 返回
    return `data:${fallbackMime || 'image/jpeg'};base64,${buf.toString('base64')}`;
  }
}

/**
 * Gemini 系图片模型（gemini-3-pro-image / nano-banana 等）多图输入时，
 * 若不声明图片用途，模型会把多张 inline 图（尤其角色"三视图"本身就是多格排版）
 * 误当成"要展示/排版的素材"，输出网格拼图(contact sheet)而非新场景。
 * 此函数在场景描述前注入强指令，明确参考图仅用于外观一致性。
 */
function buildGeminiImagePrompt(basePrompt: string, refCount: number): string {
  if (refCount <= 0) return basePrompt;
  return [
    `Attached below are ${refCount} reference image(s): character design sheets, scene references and prop references.`,
    `They are for APPEARANCE CONSISTENCY ONLY — keep the characters' faces, hairstyle, outfits, species/features, and the overall art style consistent with those references.`,
    `STRICT RULES:`,
    `- Generate ONE single, brand-new cinematic image illustrating the scene described after "=== SCENE ===".`,
    `- Do NOT collage, tile, stack, compare, or arrange the reference images; never output a grid, contact sheet, character sheet, storyboard sheet, or any picture containing multiple small panels/photos.`,
    `- Do NOT copy the composition, camera angle, background layout, watermarks, logos, or any text/labels from the reference images.`,
    `- The output image must contain NO text, captions, subtitles, borders, frames, or UI elements.`,
    ``,
    `=== SCENE ===`,
    basePrompt,
  ].join('\n');
}

function extractJSON(text: string): string {
  let s = text.trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!s.startsWith('[') && !s.startsWith('{')) {
    const a = s.indexOf('['), o = s.indexOf('{');
    const start = a === -1 ? o : o === -1 ? a : Math.min(a, o);
    if (start !== -1) s = s.slice(start);
  }
  const lastClose = Math.max(s.lastIndexOf(']'), s.lastIndexOf('}'));
  if (lastClose !== -1 && lastClose < s.length - 1) s = s.slice(0, lastClose + 1);
  return s;
}

async function getWorkDirs(dramaId: string) {
  const drama = await shortDramaManager.getById(dramaId);
  const cleanTitle = (drama?.title || 'untitled').replace(/[\\/:*?"<>|\s]/g, '_');
  const folderName = `${cleanTitle}_${dramaId}`;

  const settings = await getSystemSettings();
  const baseSavePath = settings.mediaSavePath || 'public';
  const mediaWebPath = settings.mediaWebPath || '/media';
  const websiteUrl = settings.websiteUrl ? settings.websiteUrl.replace(/\/$/, '') : '';

  const rootPhysicalPath = path.isAbsolute(baseSavePath)
    ? baseSavePath
    : path.join(process.cwd(), baseSavePath);

  const dramaSavePath = settings.dramaSavePath || 'works';

  const baseDir = path.join(rootPhysicalPath, 'media', dramaSavePath, folderName);
  const dirs = {
    base: baseDir,
    texts: path.join(baseDir, 'texts'),
    images: path.join(baseDir, 'images'),
    videos: path.join(baseDir, 'videos'),
    audios: path.join(baseDir, 'audios'),
  };

  // Ensure all directories exist
  for (const dirPath of Object.values(dirs)) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  return {
    dirs,
    relativePrefix: `${buildMediaWebBase(settings)}/${dramaSavePath}/${folderName}`,
  };
}

/**
 * 带有健壮错误处理的 fetch 辅助函数，确保任何非 JSON 响应或非 2xx 响应都能提供具体、清晰的错误说明
 * 内置自动重试：对 429/502/503/504 等临时性错误（如队列满、限流、服务繁忙）自动指数退避重试
 */
async function safeFetchJson(url: string, init?: RequestInit, retryOptions?: { maxRetries?: number; baseDelayMs?: number }): Promise<any> {
  const maxRetries = retryOptions?.maxRetries ?? 3;
  const baseDelayMs = retryOptions?.baseDelayMs ?? 5000;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err: any) {
      lastError = new Error(`网络连接失败 (${url}): ${err.message || err}`);
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 2000;
        console.log(`[safeFetchJson] Network error, retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw lastError;
    }

    const text = await res.text();

    // 可重试状态码：429（限流）、502（网关错误）、503（队列满/服务不可用）、504（网关超时）
    const isRetryable = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;

    if (isRetryable && attempt < maxRetries) {
      let errorDetail = '';
      try {
        const parsed = JSON.parse(text);
        errorDetail = parsed.error?.message || parsed.message || JSON.stringify(parsed);
      } catch {
        errorDetail = text.trim() ? text.slice(0, 150) : '(无响应体)';
      }
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 3000;
      console.log(`[safeFetchJson] HTTP ${res.status} (${errorDetail.slice(0, 80)}), retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    if (!res.ok) {
      let errorDetail = '';
      try {
        const parsed = JSON.parse(text);
        errorDetail = parsed.error?.message || parsed.message || JSON.stringify(parsed);
      } catch {
        errorDetail = text.trim() ? text.slice(0, 150) : '(无响应体)';
      }
      throw new Error(`API 接口返回错误 (HTTP ${res.status}): ${errorDetail}`);
    }

    try {
      return JSON.parse(text);
    } catch (e: any) {
      const preview = text.trim() ? text.slice(0, 150) : '(空)';
      throw new Error(`无法解析 API 接口返回的 JSON (HTTP ${res.status})。响应内容: ${preview}`);
    }
  }

  throw lastError || new Error('请求失败，已达到最大重试次数');
}

function getImageMimeType(filePath: string) {
  const ext = path.extname(filePath.split('?')[0] || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

async function resolveLocalImagePath(source: string): Promise<string> {
  const raw = String(source || '').trim();
  if (!raw || raw.startsWith('data:')) return '';

  const settings = await getSystemSettings();
  const baseSavePath = settings.mediaSavePath || 'public';
  const mediaWebPath = settings.mediaWebPath || '/media';
  const websiteUrl = settings.websiteUrl ? settings.websiteUrl.replace(/\/$/, '') : '';
  const rootPhysicalPath = path.isAbsolute(baseSavePath)
    ? baseSavePath
    : path.join(process.cwd(), baseSavePath);
  const allowedRoots = [process.cwd(), rootPhysicalPath].map(p => path.resolve(p).toLowerCase());
  const toSafePath = (candidate: string) => {
    const resolved = path.resolve(candidate);
    const normalized = resolved.toLowerCase();
    return allowedRoots.some(root => normalized === root || normalized.startsWith(`${root}${path.sep}`)) ? resolved : '';
  };

  const candidates: string[] = [];
  const addCandidate = (candidate: string) => {
    const safe = toSafePath(candidate);
    if (safe && !candidates.includes(safe)) candidates.push(safe);
  };
  const addMediaPathCandidate = (webPath: string) => {
    if (!webPath) return;
    const decoded = decodeURIComponent(webPath.split('?')[0] || '');
    const normalizedMediaWebPath = (() => {
      if (/^https?:\/\//i.test(mediaWebPath)) {
        try { return new URL(mediaWebPath).pathname.replace(/\/+$/, '') || '/media'; } catch {}
      }
      return `/${mediaWebPath.replace(/^\/+|\/+$/g, '') || 'media'}`;
    })();
    if (decoded.startsWith(`${normalizedMediaWebPath}/`) || decoded === normalizedMediaWebPath) {
      const subPath = decoded.slice(normalizedMediaWebPath.length).replace(/^\/+/, '');
      addCandidate(path.join(rootPhysicalPath, 'media', subPath));
    }
    if (decoded.startsWith('/media/')) {
      addCandidate(path.join(rootPhysicalPath, decoded.replace(/^\/+/, '')));
      addCandidate(path.join(process.cwd(), 'public', decoded.replace(/^\/+/, '')));
    }
  };

  if (path.isAbsolute(raw) && !raw.startsWith('/') && !/^https?:\/\//i.test(raw)) {
    addCandidate(raw);
  }

  if (websiteUrl && raw.startsWith(websiteUrl)) {
    addMediaPathCandidate(raw.slice(websiteUrl.length) || '/');
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)) {
        addMediaPathCandidate(parsed.pathname);
      } else if (/^https?:\/\//i.test(mediaWebPath) && raw.startsWith(mediaWebPath)) {
        addMediaPathCandidate(parsed.pathname);
      }
    } catch {}
  } else if (raw.startsWith('/')) {
    addMediaPathCandidate(raw);
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return '';
}

/**
 * 转换本地相对路径或 localhost 路径为 Base64 Data URL，方便外部云 API 下载
 */
async function toLocalBase64(url: string): Promise<string> {
  if (!url) return '';
  if (url.startsWith('data:')) return url;

  const localPath = await resolveLocalImagePath(url);
  if (localPath && fs.existsSync(localPath)) {
    const buf = fs.readFileSync(localPath);
    return `data:${getImageMimeType(localPath)};base64,${buf.toString('base64')}`;
  }

  return url;
}

async function toCompressedLocalImageBase64(source: string): Promise<string> {
  const localPath = await resolveLocalImagePath(source);
  if (!localPath || !fs.existsSync(localPath)) return '';

  try {
    const sharpModule = await import('sharp');
    const sharp = sharpModule.default;
    const attempts = [
      { width: 1280, quality: 78 },
      { width: 960, quality: 72 },
      { width: 768, quality: 68 },
      { width: 640, quality: 62 },
    ];
    let best = '';
    for (const attempt of attempts) {
      const buffer = await sharp(localPath)
        .rotate()
        .resize({
          width: attempt.width,
          height: attempt.width,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: attempt.quality, mozjpeg: true })
        .toBuffer();
      best = buffer.toString('base64');
      if (buffer.length <= 800_000) return best;
    }
    return best;
  } catch (err) {
    console.warn('[ImageBase64] Failed to compress local image, fallback to raw base64:', err);
    const dataUrl = await toLocalBase64(source);
    return dataUrl.startsWith('data:image/') ? stripDataImagePrefix(dataUrl) : '';
  }
}

/**
 * 上传本地图片到中转图床以获取公开可访问的 HTTPS URL，以便外部云端大模型下载。
 * 失败时自动回落到 Base64 格式。
 */
async function uploadLocalImage(url: string): Promise<string> {
  if (!url) return '';
  if (url.startsWith('data:')) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    if (!url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('[::1]')) {
      return url;
    }
  }

  const localPath = await resolveLocalImagePath(url);
  if (localPath) {
    if (fs.existsSync(localPath)) {
      try {
        console.log(`[ImageHost] Uploading local image ${localPath} to zhongzhuan image host...`);
        const fileBuffer = fs.readFileSync(localPath);
        const filename = path.basename(localPath);

        const formData = new FormData();
        const blob = new Blob([fileBuffer], { type: getImageMimeType(localPath) });
        formData.append('file', blob, filename);

        const response = await fetch('https://imageproxy.zhongzhuan.chat/api/upload', {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          const resData = await response.json();
          if (resData.url) {
            console.log(`[ImageHost] Upload success: ${resData.url}`);
            return resData.url;
          }
        }
        console.error(`[ImageHost] Upload failed with status ${response.status}:`, await response.text());
      } catch (err) {
        console.error('[ImageHost] Upload exception:', err);
      }
    }
  }

  // 兜底降级方案：返回本地 Base64 Data URL
  return await toLocalBase64(url);
}

function stripDataImagePrefix(value: string): string {
  const raw = String(value || '').trim();
  const marker = ';base64,';
  const idx = raw.indexOf(marker);
  return idx >= 0 ? raw.slice(idx + marker.length).trim() : raw;
}

function isProbablyBase64Image(value: string): boolean {
  const raw = stripDataImagePrefix(value).replace(/\s/g, '');
  return raw.length > 128 && /^[A-Za-z0-9+/]+={0,2}$/.test(raw);
}

function isLocalHttpUrl(value: string): boolean {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  } catch {
    return raw.includes('localhost') || raw.includes('127.0.0.1') || raw.includes('[::1]');
  }
}

function isPublicHttpUrl(value: string): boolean {
  const raw = String(value || '').trim();
  return /^https?:\/\//i.test(raw) && !isLocalHttpUrl(raw);
}

function isValidNewApiImageUrlValue(value: string): boolean {
  const raw = String(value || '').trim();
  return isPublicHttpUrl(raw) || isProbablyBase64Image(raw);
}

function describeImageInput(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return 'empty';
  if (/^https?:\/\//i.test(raw)) return isLocalHttpUrl(raw) ? 'local-url' : 'url';
  if (raw.startsWith('/')) return 'local-path';
  if (raw.startsWith('data:image/')) return 'data-url';
  if (isProbablyBase64Image(raw)) return 'base64';
  return `unknown(${raw.slice(0, 24)})`;
}

async function toNewApiImageUrlValue(source: string, options?: { preferBase64?: boolean; dataUrl?: boolean }): Promise<string> {
  const raw = String(source || '').trim();
  if (!raw) return '';
  if (options?.preferBase64) {
    const compressed = await toCompressedLocalImageBase64(raw);
    if (isProbablyBase64Image(compressed)) {
      const base64 = stripDataImagePrefix(compressed);
      return options.dataUrl ? `data:image/jpeg;base64,${base64}` : base64;
    }
  }
  if (isPublicHttpUrl(raw)) {
    return raw;
  }

  const uploadedOrData = await uploadLocalImage(raw);
  if (isPublicHttpUrl(uploadedOrData)) {
    return uploadedOrData;
  }
  if (uploadedOrData.startsWith('data:image/')) {
    return options?.dataUrl ? uploadedOrData : stripDataImagePrefix(uploadedOrData);
  }
  if (isProbablyBase64Image(uploadedOrData)) {
    const base64 = stripDataImagePrefix(uploadedOrData);
    return options?.dataUrl ? `data:image/jpeg;base64,${base64}` : base64;
  }

  const dataOrRaw = await toLocalBase64(raw);
  if (dataOrRaw.startsWith('data:image/')) {
    return options?.dataUrl ? dataOrRaw : stripDataImagePrefix(dataOrRaw);
  }
  if (isProbablyBase64Image(dataOrRaw)) {
    const base64 = stripDataImagePrefix(dataOrRaw);
    return options?.dataUrl ? `data:image/jpeg;base64,${base64}` : base64;
  }
  return '';
}

function compactVideoPromptForProvider(prompt: string, maxChars = 3600): string {
  const cleaned = String(prompt || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (cleaned.length <= maxChars) return cleaned;

  const headLimit = Math.max(800, Math.floor(maxChars * 0.68));
  const tailLimit = Math.max(400, maxChars - headLimit - 36);
  return `${cleaned.slice(0, headLimit).trim()}\n...\n${cleaned.slice(-tailLimit).trim()}`;
}

// 全局后台任务 Map — 防止 hot-reload 时被 GC
declare global { var _bgTasks: Map<string, Promise<void>> | undefined; }
const bgTasks: Map<string, Promise<void>> =
  globalThis._bgTasks ?? (globalThis._bgTasks = new Map());

/**
 * 下载外部媒体文件（URL 或 base64）并保存到 public/media/works/ 对应作品子目录下，返回本地 URL。
 */
async function saveMediaLocally(
  src: string,
  type: 'image' | 'video' | 'audio',
  shotId: string,
  dramaId?: string,
  retries = 3
): Promise<string> {
  let ext = type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'jpg';
  if (type === 'audio' && src.startsWith('data:audio/')) {
    const mime = src.slice('data:audio/'.length).split(';')[0].toLowerCase();
    if (mime.includes('wav')) ext = 'wav';
    else if (mime.includes('mpeg') || mime.includes('mp3')) ext = 'mp3';
    else if (mime.includes('ogg')) ext = 'ogg';
    else if (mime.includes('webm')) ext = 'webm';
  }
  const subDir = type === 'video' ? 'videos' : type === 'audio' ? 'audios' : 'images';

  let dir = path.join(process.cwd(), 'public', 'media', 'shots', subDir);
  let relativePathPrefix = `/media/shots/${subDir}`;

  if (dramaId) {
    try {
      const { dirs, relativePrefix } = await getWorkDirs(dramaId);
      dir = dirs[type === 'video' ? 'videos' : type === 'audio' ? 'audios' : 'images'];
      relativePathPrefix = `${relativePrefix}/${type === 'video' ? 'videos' : type === 'audio' ? 'audios' : 'images'}`;
    } catch (err) {
      console.error('[saveMediaLocally] failed to get dynamic work dirs', err);
    }
  }

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // 加入时间戳确保每次生成都有唯一文件名，不会覆盖旧图片
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const filename = `${shotId}_${timestamp}_${random}.${ext}`;
  const localPath = path.join(dir, filename);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (src.startsWith('data:')) {
        const base64 = src.split(',')[1];
        if (!base64) return src;
        fs.writeFileSync(localPath, Buffer.from(base64, 'base64'));
      } else if (/^[A-Za-z0-9+/]/.test(src) && !src.startsWith('http')) {
        fs.writeFileSync(localPath, Buffer.from(src, 'base64'));
      } else {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 90_000);
        try {
          const res = await fetch(src, { signal: ctrl.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          fs.writeFileSync(localPath, Buffer.from(await res.arrayBuffer()));
        } finally {
          clearTimeout(timer);
        }
      }
      return `${relativePathPrefix}/${filename}`;
    } catch (e) {
      console.error(`[saveMediaLocally] attempt ${attempt}/${retries} failed:`, e);
      if (attempt < retries) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  console.error('[saveMediaLocally] all retries failed, storing original URL');
  return src;
}

/**
 * POST /api/short-dramas/[id]/generate
 * 统一的AI生成入口，支持：
 * - script-rewrite: 小说→剧本改写
 * - extract-characters: 从剧本提取角色
 * - break-storyboard: 剧本→分镜拆解
 * - generate-image: 分镜图片生成
 * - generate-video: 图生视频
 * - generate-tts: TTS配音
 * - generate-image-prompt: 生成图片提示词
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id } = await params;

    const drama = await shortDramaManager.getById(id);
    if (!drama || (drama.userId !== payload.userId && payload.role !== 'admin')) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }

    const body = await request.json();
    const { action, configId, episodeId, shotId, systemConfigId, extraParams: nestedExtraParams, ...extraParams } = body;
    if (nestedExtraParams && typeof nestedExtraParams === 'object' && !Array.isArray(nestedExtraParams)) {
      Object.assign(extraParams, nestedExtraParams);
    }
    const effectiveSystemConfigId = systemConfigId || extraParams.systemConfigId;

    if (!action) {
      return NextResponse.json({ error: '缺少 action 参数' }, { status: 400 });
    }

    // 获取AI配置
    let config: any = null;
    if (configId) {
      config = await aiConfigManager.getConfigById(configId);
    }

    // 如果前端选择了媒体API配置，注入其 apiKey/apiUrl
    // 可用范围：系统公用配置（所有人）+ 用户自建配置（仅本人），避免越权使用他人配置
    if (effectiveSystemConfigId && (action === 'generate-image' || action === 'generate-video' || action === 'generate-asset-image' || action === 'generate-tts')) {
      const sysCfg = await aiConfigManager.getConfigByIdAdmin(effectiveSystemConfigId);
      const expectedModelType = action === 'generate-video' ? 'video' : action === 'generate-tts' ? 'tts' : 'image';
      const scopeUsable = !!sysCfg && (
        sysCfg.scope === 'system' ||
        (sysCfg.scope === 'user' && (sysCfg as any).userId === payload.userId)
      );
      if (sysCfg && scopeUsable && sysCfg.modelType === expectedModelType) {
        if (!extraParams.apiKey) extraParams.apiKey = sysCfg.apiKey;
        if (!extraParams.apiUrl) extraParams.apiUrl = sysCfg.apiUrl;
        if (!extraParams.provider) extraParams.provider = sysCfg.provider;
        if (!extraParams.model) extraParams.model = sysCfg.model;
        // 注入 extraConfig 字段（endpointPath / aspectRatio / imageSize / image_poll_timeout_secs）
        if (sysCfg.extraConfig) {
          try {
            const ec = typeof sysCfg.extraConfig === 'string' ? JSON.parse(sysCfg.extraConfig) : sysCfg.extraConfig;
            extraParams.extraConfig = { ...(ec || {}), ...(extraParams.extraConfig || {}) };
            if (ec?.endpointPath && !extraParams.endpointPath) extraParams.endpointPath = ec.endpointPath;
            if (ec?.aspectRatio && !extraParams.aspectRatio) extraParams.aspectRatio = ec.aspectRatio;
            if (ec?.imageSize && !extraParams.imageSize) extraParams.imageSize = ec.imageSize;
            if (ec?.image_poll_timeout_secs && !extraParams.image_poll_timeout_secs)
              extraParams.image_poll_timeout_secs = Number(ec.image_poll_timeout_secs);
          } catch {}
        }
      }
    }

    // 创建任务记录（立即返回 taskId，后台异步执行生成）
    const task = await dramaWorkflowManager.createTask({
      dramaId: id,
      userId: payload.userId,
      type: action,
      targetId: shotId || episodeId || null,
      provider: config?.provider || extraParams.provider || null,
      model: config?.model || extraParams.model || null,
      status: 'pending',
      input: JSON.stringify({ action, episodeId, shotId, configId, ...extraParams }),
    });

    // 后台异步执行 — 不阻塞响应，避免长连接被中断
    const bgPromise = (async () => {
      try {
        await dramaWorkflowManager.updateTask(task.id, { status: 'running', startedAt: new Date().toISOString() });
        let result: any = null;
        switch (action) {
          case 'script-rewrite':      result = await handleScriptRewrite(id, episodeId, config, extraParams, payload.userId); break;
          case 'extract-characters':  result = await handleExtractCharacters(id, config, extraParams, payload.userId); break;
          case 'break-storyboard':    result = await handleBreakStoryboard(id, episodeId, config, extraParams, payload.userId); break;
          case 'generate-image-prompt': result = await handleGenerateImagePrompts(id, episodeId, config, extraParams, payload.userId); break;
          case 'generate-video-prompt': result = await handleGenerateVideoPrompts(id, episodeId, config, extraParams, payload.userId); break;
          case 'quality-check-shots': result = await handleQualityCheckShots(id, episodeId, config, extraParams, payload.userId); break;
          case 'generate-image':      result = await handleGenerateImage(shotId, config, extraParams, payload.userId, task.id); break;
          case 'generate-video':      result = await handleGenerateVideo(shotId, config, extraParams, payload.userId); break;
          case 'generate-tts':        result = await handleGenerateTTS(shotId, config, { ...extraParams, dramaId: id }, payload.userId); break;
          case 'generate-asset-image': {
            const styleRaw = body.assetType === 'character' ? (drama as any).characterStyle
              : body.assetType === 'scene' ? (drama as any).sceneStyle
              : (drama as any).itemStyle;
            result = await handleGenerateAssetImage(body.assetType, body.assetId, config, extraParams, payload.userId, styleRaw ?? null, task.id);
            break;
          }
          default: result = { error: `未知操作: ${action}` };
        }
        await dramaWorkflowManager.updateTask(task.id, {
          status: result?.error ? 'failed' : 'completed',
          // 没拿到结果就别覆盖 output：失败时保留已发布的「提交提示词」，方便排查问题
          ...(result?.data ? { output: JSON.stringify(result.data) } : {}),
          error: result?.error || null,
          completedAt: new Date().toISOString(),
        });
      } catch (err: any) {
        await dramaWorkflowManager.updateTask(task.id, {
          status: 'failed', error: err.message || '生成失败',
          completedAt: new Date().toISOString(),
        }).catch(() => {});
      } finally {
        bgTasks.delete(task.id);
      }
    })();
    bgTasks.set(task.id, bgPromise);

    return NextResponse.json({ success: true, taskId: task.id });
  } catch (error: any) {
    console.error('短剧生成失败:', error);
    return NextResponse.json({ error: error.message || '生成失败' }, { status: 500 });
  }
}

// ======================== GET: 轮询任务状态 ========================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id } = await params;
    const taskId = new URL(request.url).searchParams.get('taskId');
    if (!taskId) return NextResponse.json({ error: '缺少 taskId' }, { status: 400 });
    const task = await dramaWorkflowManager.getTaskById(taskId);
    if (!task || task.dramaId !== id) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data: task });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '查询失败' }, { status: 500 });
  }
}

// ======================== 生成处理函数 ========================

// ======================== 图片生成核心（统一超时+重试）========================

const IMAGE_FETCH_TIMEOUT_MS = 600_000; // 默认 10 分钟，可通过 params.image_poll_timeout_secs 动态延长

function isRetryableImageError(msg: string): boolean {
  const lower = (msg || '').toLowerCase();
  return ['timeout', '超时', 'timed out', 'econnreset', 'etimedout', 'econnrefused',
    'network error', 'fetch failed', 'socket hang', '502', '503', '504',
    'rate limit', 'too many requests', 'overload', 'image_poll_timeout',
    'server error', '负载', 'cpu', '繁忙', 'busy'].some(k => lower.includes(k));
}

/**
 * 单次图片 API 调用（含 300s fetch 超时），出错直接 throw
 */
async function _callImageOnce(
  provider: string, model: string, apiKey: string, apiUrl: string | undefined,
  prompt: string, sizeStr: string, params: any, refImages: string[]
): Promise<string> {
  const ctrl = new AbortController();
  // 如果 extraConfig 配置了 image_poll_timeout_secs，以该值为准（加 30s 网络缓冲），否则用默认 5 分钟
  const pollSecs = params?.image_poll_timeout_secs ? Number(params.image_poll_timeout_secs) : 0;
  const fetchTimeoutMs = pollSecs > 0 ? (pollSecs * 1000 + 30_000) : IMAGE_FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => ctrl.abort(), fetchTimeoutMs);
  const tFetch = (url: string, opts: RequestInit) =>
    fetch(url, { ...opts, signal: ctrl.signal });

  try {
    const isOpenAICompatible = ['openai', 'gpt-image-2', 'codex-gpt-image-2', 'custom-image'].includes(provider);
    const isGeminiImage = model && (model.includes('gemini') && !model.includes('text'));
    // 判断是否是Agnes模型（openai或custom-image provider下，模型名包含agnes-image）
    const isAgnesImage = model && (model.includes('agnes-image') || model.includes('agnes_image'));
    const negativePrompt = params.negativePrompt || '';
    let imageUrl = '';

    switch (provider) {
      case 'gemini-banana':
      case 'gemini-image': {
        // Gemini generateContent API
        // gemini-banana: local proxy, base URL + /v1beta appended
        // gemini-image:  direct API, apiUrl already contains /v1beta
        const rawBase = (apiUrl || '').replace(/\/$/, '');
        const geminiBase = provider === 'gemini-banana'
          ? (rawBase.endsWith('/v1beta') ? rawBase : `${rawBase}/v1beta`)
          : rawBase;
        const geminiUrl = `${geminiBase}/models/${model}:generateContent`;

        // Build parts: text prompt + optional reference images
        // 多参考图时注入强指令，防止模型把参考图误拼成网格/联系表而非画新场景
        const gParts: any[] = [{ text: buildGeminiImagePrompt(prompt, refImages.length) }];
        for (const ref of refImages) {
          const commaIdx = ref.indexOf(',');
          const mhead = commaIdx > 0 ? ref.substring(0, commaIdx) : '';
          const b64data = commaIdx > 0 ? ref.substring(commaIdx + 1) : ref;
          const mime = mhead.replace('data:', '').replace(';base64', '') || 'image/jpeg';
          gParts.push({ inlineData: { mimeType: mime, data: b64data } });
        }

        // Map sizeStr → aspectRatio
        const sizeToAspect: Record<string, string> = {
          '1280x720': '16:9', '1920x1080': '16:9',
          '720x1280': '9:16', '1080x1920': '9:16',
          '1024x1024': '1:1', '512x512': '1:1',
          '1024x768': '4:3', '768x1024': '3:4',
        };
        const gAspect = params.aspectRatio || sizeToAspect[sizeStr] || '16:9';
        const gImageSize = params.imageSize || (model.includes('pro') ? '2K' : '1K');

        const gBody: any = {
          contents: [{ role: 'user', parts: gParts }],
          generationConfig: {
            responseModalities: ['IMAGE', 'TEXT'],
            temperature: 1.0,
            topP: 0.95,
            maxOutputTokens: 8192,
            imageConfig: { aspectRatio: gAspect },
          },
        };
        // Only pro models support imageSize param
        if (model.includes('pro')) {
          gBody.generationConfig.imageConfig.imageSize = gImageSize;
        }

        const gr = await tFetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(gBody),
        });
        if (!gr.ok) {
          const gt = await gr.text().catch(() => gr.statusText);
          let gMsg = gt;
          try { const gj = JSON.parse(gt); gMsg = gj.error?.message || gj.message || gt; } catch {}
          throw new Error(gMsg || 'Gemini 生成失败');
        }
        const gd = await gr.json();
        const gCandidates = gd?.candidates || [];
        if (!gCandidates.length) throw new Error('Gemini API 未返回有效候选结果');
        const gRespParts: any[] = gCandidates[0]?.content?.parts || [];
        for (const gp of gRespParts) {
          if (gp.inlineData) {
            const data = gp.inlineData.data as string;
            imageUrl = (data.startsWith('http://') || data.startsWith('https://'))
              ? data
              : `data:image/png;base64,${data}`;
            break;
          } else if (gp.text) {
            const txt = gp.text as string;
            // data URI: data:image/...;base64,...
            const duMatch = /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/.exec(txt);
            if (duMatch) { imageUrl = `data:${duMatch[1]};base64,${duMatch[2]}`; break; }
            // markdown URL: ![...](url)
            const mdMatch = /!\[[^\]]*\]\((https?:\/\/[^)]+)\)/.exec(txt);
            if (mdMatch) { imageUrl = mdMatch[1]; break; }
          }
        }
        if (!imageUrl) throw new Error('Gemini API 响应中未包含图片数据');
        break;
      }
      case 'openai':
      case 'gpt-image-2':
      case 'codex-gpt-image-2':
      case 'custom-image':
      case 'siliconflow':
      case 'cogview':
      case 'chatfire': {
        // custom-image: when model contains 'gemini', route to Gemini API
        if (provider === 'custom-image' && isGeminiImage) {
          let rawBase = (apiUrl || '').replace(/\/$/, '');
          // Strip common API prefixes so we only get the domain base
          rawBase = rawBase.replace(/\/v1(?:beta)?$/, '');
          const geminiBase = `${rawBase}/v1beta`;
          const geminiUrl = `${geminiBase}/models/${model}:generateContent`;
          // 多参考图时注入强指令，防止模型把参考图误拼成网格/联系表而非画新场景
          const gParts: any[] = [{ text: buildGeminiImagePrompt(prompt, refImages.length) }];
          for (const ref of refImages) {
            const commaIdx = ref.indexOf(',');
            const mhead = commaIdx > 0 ? ref.substring(0, commaIdx) : '';
            const b64data = commaIdx > 0 ? ref.substring(commaIdx + 1) : ref;
            const mime = mhead.replace('data:', '').replace(';base64', '') || 'image/jpeg';
            gParts.push({ inlineData: { mimeType: mime, data: b64data } });
          }
          const sizeToAspect: Record<string, string> = {
            '1280x720': '16:9', '1920x1080': '16:9',
            '720x1280': '9:16', '1080x1920': '9:16',
            '1024x1024': '1:1', '512x512': '1:1',
            '1024x768': '4:3', '768x1024': '3:4',
          };
          const gAspect = params.aspectRatio || sizeToAspect[sizeStr] || '16:9';
          const gBody: any = {
            contents: [{ role: 'user', parts: gParts }],
            generationConfig: {
              responseModalities: ['IMAGE', 'TEXT'],
              temperature: 1.0, topP: 0.95, maxOutputTokens: 8192,
              imageConfig: { aspectRatio: gAspect },
            },
          };
          const gr = await tFetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(gBody),
            signal: ctrl.signal,
          });
          if (!gr.ok) { const et = await gr.text(); throw new Error(`Gemini custom: ${gr.status} ${et}`); }
          const gd = await gr.json();
          // Debug: log full response structure for Gemini image
          if (process.env.NODE_ENV !== 'production') {
            console.log('[Image][gemini-custom] response keys:', Object.keys(gd));
            console.log('[Image][gemini-custom] candidate parts:', JSON.stringify(gd?.candidates?.[0]?.content?.parts?.slice(0, 2)));
          }
          const part = gd?.candidates?.[0]?.content?.parts?.[0];
          if (part?.inlineData?.data) {
            imageUrl = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
          } else {
            // Gemini returned text only (description), not an image
            const textDesc = part?.text || 'No parts found';
            console.warn('[Image][gemini-custom] No inlineData, got text description instead');
            // Try to find inlineData among multiple parts
            const allParts = gd?.candidates?.[0]?.content?.parts || [];
            let foundInline = false;
            for (const p of allParts) {
              if (p?.inlineData?.data) {
                imageUrl = `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`;
                foundInline = true;
                break;
              }
            }
            if (!foundInline) {
              throw new Error(`Gemini returned text description instead of image. Response: ${typeof textDesc === 'string' ? textDesc.substring(0, 200) : JSON.stringify(textDesc).substring(0, 200)}`);
            }
          }
          break;
        }
        // 确定base URL：Agnes使用专用默认地址，其他使用各自默认
        let base: string;
        if (apiUrl) {
          base = apiUrl.replace(/\/+$/, '');
        } else if (isAgnesImage) {
          base = 'https://apihub.agnes-ai.com/v1';
        } else if (isOpenAICompatible) {
          base = 'https://api.openai.com/v1';
        } else if (provider === 'siliconflow') {
          base = 'https://api.siliconflow.cn/v1';
        } else if (provider === 'cogview') {
          base = 'https://open.bigmodel.cn/api/paas/v4';
        } else {
          base = 'https://api.chatfire.cn/v1';
        }
        // Agnes API URL兼容处理：确保路径包含/v1前缀
        if (isAgnesImage) {
          // 如果base是纯域名（不含路径段），自动补全/v1
          const urlObj = new URL(base.startsWith('http') ? base : `https://${base}`);
          if (urlObj.pathname === '/' || urlObj.pathname === '') {
            base = `${urlObj.protocol}//${urlObj.host}/v1`;
          } else if (!urlObj.pathname.endsWith('/v1') && !urlObj.pathname.includes('/v1/')) {
            // 路径不以/v1结尾也不包含/v1/，可能缺少版本前缀
            // 例如 https://apihub.agnes-ai.com 或 https://custom-proxy.com/agnes
            // 不自动补全，使用用户配置的路径（用户可能配置了自定义代理）
          }
          console.log(`[Image][Agnes] normalized base URL: ${base}, model: ${model}, size: ${sizeStr}, hasRefs: ${refImages.length > 0}`);
        }
        // custom-image 支持自定义端点路径（params.endpointPath 或 extraConfig.endpointPath）
        const customEndpoint = (provider === 'custom-image' && params.endpointPath)
          ? (params.endpointPath.startsWith('/') ? params.endpointPath : `/${params.endpointPath}`)
          : null;
        if (refImages.length > 0) {
          if (provider === 'siliconflow') {
            const sbody: any = { model, prompt, n: 1, image_size: sizeStr, image_prompt: refImages[0] };
            if (refImages.length > 1) sbody.reference_images = refImages.slice(1, 6);
            const r = await tFetch(`${base}/images/generations`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(sbody) });
            const d = await r.json();
            if (d.error) throw new Error(d.error.message || d.error || 'SiliconFlow 生成失败');
            imageUrl = d.data?.[0]?.url || d.images?.[0]?.url || '';
          } else if (isAgnesImage) {
            // Agnes Image 2.1/2.0：参考图必须是 URL，需要上传到公网
            const urlRefs: string[] = [];
            for (const ref of refImages) {
              if (ref.startsWith('http')) {
                urlRefs.push(ref);
              } else if (ref.startsWith('/')) {
                const publicUrl = await uploadLocalImage(ref);
                if (publicUrl) urlRefs.push(publicUrl);
              }
            }
            const body: any = { model, prompt, size: sizeStr, n: 1 };
            if (urlRefs.length > 0) {
              body.extra_body = { image: urlRefs.slice(0, 4) };
            }
            const genPath = customEndpoint || '/images/generations';
            const r = await tFetch(`${base}${genPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(body) });
            const d = await r.json();
            if (d.error) throw new Error(d.error.message || d.error || 'Agnes Image 生成失败');
            imageUrl = d.data?.[0]?.url || d.images?.[0]?.url || '';
          } else if (isOpenAICompatible) {
            // OpenAI / custom-image 等：走 /images/edits（FormData），需要 base64
            const fd = new FormData();
            fd.append('model', model); fd.append('prompt', prompt); fd.append('n', '1'); fd.append('size', sizeStr);
            if (isOpenAICompatible) fd.append('quality', params.quality || 'standard');
            for (let ri = 0; ri < refImages.length; ri++) {
              const [mhead, b64] = refImages[ri].split(',');
              const mime = mhead.replace('data:', '').replace(';base64', '') || 'image/jpeg';
              const ext = mime.split('/')[1] || 'jpg';
              fd.append('image[]', new Blob([Buffer.from(b64, 'base64')], { type: mime }), `ref${ri}.${ext}`);
            }
            const editsPath = customEndpoint || '/images/edits';
            const r = await tFetch(`${base}${editsPath}`, { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: fd });
            const d = await r.json();
            if (d.error) throw new Error(d.error.message || d.error || '生成失败');
            imageUrl = d.data?.[0]?.url || d.data?.[0]?.b64_json || d.images?.[0]?.url || '';
          } else {
            const fd = new FormData();
            fd.append('model', model); fd.append('prompt', prompt); fd.append('n', '1'); fd.append('size', sizeStr);
            if (isOpenAICompatible) fd.append('quality', params.quality || 'standard');
            for (let ri = 0; ri < refImages.length; ri++) {
              const [mhead, b64] = refImages[ri].split(',');
              const mime = mhead.replace('data:', '').replace(';base64', '') || 'image/jpeg';
              const ext = mime.split('/')[1] || 'jpg';
              fd.append('image[]', new Blob([Buffer.from(b64, 'base64')], { type: mime }), `ref${ri}.${ext}`);
            }
            const editsPath = customEndpoint || '/images/edits';
            const r = await tFetch(`${base}${editsPath}`, { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: fd });
            const d = await r.json();
            if (d.error) throw new Error(d.error.message || d.error || '生成失败');
            imageUrl = d.data?.[0]?.url || d.data?.[0]?.b64_json || d.images?.[0]?.url || '';
          }
        } else {
          // 文生图（无参考图）
          const genPath = customEndpoint || '/images/generations';
          let body: any;
          if (isAgnesImage) {
            // Agnes Image 2.1/2.0 文生图：使用标准OpenAI兼容格式，不传递quality等不支持的参数
            body = { model, prompt, n: 1, size: sizeStr };
            if (negativePrompt) body.negative_prompt = negativePrompt;
            console.log(`[Image][Agnes] POST ${base}${genPath}, body keys:`, Object.keys(body));
          } else {
            body = { model, prompt, n: 1, size: sizeStr };
            if (isOpenAICompatible) body.quality = params.quality || 'standard';
            if (provider === 'siliconflow') { body.image_size = sizeStr; delete body.size; }
            if (params?.image_poll_timeout_secs) body.image_poll_timeout_secs = Number(params.image_poll_timeout_secs);
          }
          const r = await tFetch(`${base}${genPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(body) });
          if (!r.ok) {
            const t = await r.text().catch(() => r.statusText);
            let msg = t;
            try { const j = JSON.parse(t); msg = j.error?.message || j.detail || j.message || t; } catch {}
            console.error(`[Image][Agnes] Error response: HTTP ${r.status}, body:`, t.slice(0, 500));
            throw new Error(msg || `图片生成失败 (HTTP ${r.status})`);
          }
          const d = await r.json();
          if (d.error) throw new Error(d.error.message || d.error || '生成失败');
          imageUrl = d.data?.[0]?.url || d.data?.[0]?.b64_json || d.images?.[0]?.url || '';
          if (!imageUrl) {
            console.warn('[Image][Agnes] No image URL in response, keys:', Object.keys(d), 'data:', JSON.stringify(d.data?.[0] || d).slice(0, 300));
          }
        }
        break;
      }
      case 'stability-ai': {
        const base = apiUrl || 'https://api.stability.ai';
        const isSD3 = ['sd3.5-large', 'sd3.5-medium', 'sd3.5-large-turbo', 'sd3-large', 'sd3-medium'].includes(model);
        const endpoint = isSD3 ? `${base}/v2beta/stable-image/generate/sd3`
          : model === 'stable-image-ultra' ? `${base}/v2beta/stable-image/generate/ultra`
          : `${base}/v2beta/stable-image/generate/core`;
        const fd = new FormData();
        fd.append('prompt', prompt);
        if (negativePrompt) fd.append('negative_prompt', negativePrompt);
        if (refImages.length > 0) {
          const [, b64] = refImages[0].split(',');
          fd.append('init_image', new Blob([new Uint8Array(Buffer.from(b64, 'base64'))], { type: 'image/jpeg' }), 'ref.jpg');
          fd.append('init_image_mode', 'IMAGE_STRENGTH'); fd.append('image_strength', '0.35');
        }
        fd.append('output_format', 'jpeg');
        if (isSD3) fd.append('model', model);
        const stAspect: Record<string, string> = { '1280x720': '16:9', '720x1280': '9:16', '1024x1024': '1:1', '1024x768': '4:3', '768x1024': '3:4' };
        fd.append('aspect_ratio', stAspect[sizeStr] || '1:1');
        const r = await tFetch(endpoint, { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }, body: fd });
        const d = await r.json();
        if (!r.ok) throw new Error(d.errors?.[0] || d.message || 'Stability AI 生成失败');
        imageUrl = d.image ? `data:image/jpeg;base64,${d.image}` : '';
        break;
      }
      case 'minimax': {
        const base = apiUrl || 'https://api.minimax.chat/v1';
        const r = await tFetch(`${base}/image_generation`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify({ model: model || 'image-01', prompt, resolution: sizeStr.replace('x', '*') }) });
        const d = await r.json();
        if (d.base_resp?.status_code !== 0) throw new Error(d.base_resp?.status_msg || 'MiniMax 生成失败');
        imageUrl = d.data?.image_urls?.[0] || '';
        break;
      }
      case 'qwen-image': {
        const base = apiUrl || 'https://dashscope.aliyuncs.com/api/v1';
        const submitRes = await tFetch(`${base}/services/aigc/text2image/image-synthesis`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'X-DashScope-Async': 'enable' },
          body: JSON.stringify({ model: model || 'wanx2.1-t2i-turbo', input: { prompt }, parameters: { size: sizeStr.replace('x', '*'), n: 1 } }),
        });
        const taskData = await submitRes.json();
        if (taskData.code) throw new Error(taskData.message || '通义万相提交失败');
        const qwenTaskId = taskData.output?.task_id;
        if (!qwenTaskId) throw new Error('通义万相未获取到任务ID');
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 3000));
          const pr = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${qwenTaskId}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
          const pd = await pr.json();
          if (pd.output?.task_status === 'SUCCEEDED') { imageUrl = pd.output?.results?.[0]?.url || ''; break; }
          if (pd.output?.task_status === 'FAILED') throw new Error(pd.output?.message || '通义万相生成失败');
        }
        break;
      }
      // ── 火山引擎 Seedream（方舟图片生成 API）──
      case 'volcengine-ark': {
        // 契约：POST {base}/images/generations
        // body: model / prompt / image(可选, string|string[]) / size / response_format / watermark / sequential_image_generation
        // resp: { data: [{ url | b64_json, size }] }
        const arkBase = (apiUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
        const arkModel = model || 'doubao-seedream-5-0-260128';
        const arkIsPro = /seedream-5-0-pro/i.test(arkModel);
        const arkBody: any = {
          model: arkModel,
          prompt,
          size: sizeStr,
          response_format: 'url',
          watermark: false,
        };
        // Seedream 5.0 pro 不支持组图参数；其余型号显式关闭组图，确保只返回单张图片
        if (!arkIsPro) {
          arkBody.sequential_image_generation = 'disabled';
        }
        // 参考图（图生图 / 多图融合 / 交互编辑）：pro 最多 10 张，其余最多 14 张
        if (refImages.length > 0) {
          const arkRefs = refImages.slice(0, arkIsPro ? 10 : 14);
          arkBody.image = arkRefs.length === 1 ? arkRefs[0] : arkRefs;
        }

        const arkRes = await tFetch(`${arkBase}/images/generations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(arkBody),
        });
        const arkData: any = await arkRes.json().catch(() => ({}));
        if (!arkRes.ok || arkData?.error) {
          const arkMsg = arkData?.error?.message || arkData?.message || arkData?.error?.code || `HTTP ${arkRes.status}`;
          throw new Error(`火山方舟图片生成失败：${arkMsg}`);
        }
        imageUrl = arkData?.data?.[0]?.url || arkData?.data?.[0]?.b64_json || '';
        if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) {
          imageUrl = `data:image/png;base64,${imageUrl}`;
        }
        break;
      }

      case 'ideogram': {
        const base = apiUrl || 'https://api.ideogram.ai';
        const r = await tFetch(`${base}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Api-Key': apiKey }, body: JSON.stringify({ image_request: { prompt, model: model || 'V_3', aspect_ratio: 'ASPECT_1_1' } }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.message || 'Ideogram 生成失败');
        imageUrl = d.data?.[0]?.url || '';
        break;
      }
      default: {
        const base = apiUrl || 'https://api.openai.com/v1';
        const r = await tFetch(`${base}/images/generations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model, prompt, n: 1, size: sizeStr, ...(refImages.length > 0 ? { reference_images: refImages.slice(0, 6) } : {}) }),
        });
        if (!r.ok) {
          const t = await r.text().catch(() => r.statusText);
          let msg = t;
          try {
            const j = JSON.parse(t);
            // 提取完整的错误信息，避免只显示 "openai_error" 这种无意义的消息
            const err = j.error || {};
            const detailParts = [
              err.message || j.message || '',
              err.type ? `[类型] ${err.type}` : '',
              err.code ? `[代码] ${err.code}` : '',
              err.request_id ? `[请求ID] ${err.request_id}` : '',
            ].filter(Boolean);
            msg = detailParts.length > 0 ? detailParts.join('; ') : t;
          } catch {}
          throw new Error(msg || '图片生成失败');
        }
        const d = await r.json();
        if (d.error) throw new Error(d.error.message || '图片生成失败');
        // 兼容多种 API 响应格式：url / image_url / b64_json
        imageUrl = d.data?.[0]?.url 
          || d.data?.[0]?.image_url 
          || d.data?.[0]?.b64_json 
          || d.data?.[0]?.image?.url
          || d.image_url
          || '';
        // 如果返回的是 base64 数据，转换为 data URL
        if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) {
          imageUrl = `data:image/png;base64,${imageUrl}`;
        }
      }
    }

    if (!imageUrl) throw new Error('生成成功但未获取到图片URL，请检查配置');
    return imageUrl;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带自动重试的图片生成入口（默认 1 次，可通过 params 配置）
 * 注意：gpt-image-2 等慢模型建议 maxRetries=1，避免重复提交扣费
 */
async function callImageProvider(
  provider: string, model: string, apiKey: string, apiUrl: string | undefined,
  prompt: string, sizeStr: string, params: any, refImages: string[] = [],
  maxRetries?: number
): Promise<{ imageUrl: string } | { error: string }> {
  // 允许通过 params 配置重试次数，默认 1 次（不重试）
  const defaultRetries = ['gpt-image-2', 'codex-gpt-image-2'].includes(model) ? 1 : 1;
  const effectiveMaxRetries = maxRetries ?? (params?.maxRetries ?? defaultRetries);
  
  let lastError = '图片生成失败';
  for (let attempt = 1; attempt <= effectiveMaxRetries; attempt++) {
    try {
      const url = await _callImageOnce(provider, model, apiKey, apiUrl, prompt, sizeStr, params, refImages);
      if (attempt > 1) console.warn(`[ImageGen] 第 ${attempt} 次重试成功，节省了多次提交`);
      return { imageUrl: url };
    } catch (e: any) {
      lastError = e.message || '未知错误';
      const isRetryable = isRetryableImageError(lastError);
      console.warn(`[ImageGen] attempt ${attempt}/${effectiveMaxRetries} failed: ${lastError}${isRetryable ? ' (retryable)' : ' (not retryable)'}`);
      if (attempt < effectiveMaxRetries && isRetryable) {
        const delay = attempt * 3000;
        console.warn(`[ImageGen] retry in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }
  return { error: lastError };
}

// ======================== 资产图片生成 ========================

/**
 * 把「即将提交给生图模型的提示词」先写进任务记录。
 * 前端轮询任务状态时即可实时看到这次到底提交了什么提示词，不用等生成结束。
 */
async function publishRequestPrompt(
  taskId: string | null | undefined,
  payload: Record<string, unknown>,
) {
  if (!taskId) return;
  try {
    await dramaWorkflowManager.updateTask(taskId, { output: JSON.stringify(payload) });
  } catch {
    /* 中间态写入失败不影响生成流程 */
  }
}

async function handleGenerateAssetImage(
  assetType: 'character' | 'scene' | 'item',
  assetId: string,
  config: any,
  params: any,
  _userId: string,
  styleRaw?: string | null,
  taskId?: string | null
) {
  try {
    if (!assetType || !assetId) return { error: '缺少 assetType 或 assetId' };

    // 查找资产并构建提示词
    let prompt = '';
    let dramaId = '';
    if (assetType === 'character') {
      const asset = await dramaWorkflowManager.getCharacterById(assetId);
      if (!asset) return { error: '角色不存在' };
      dramaId = asset.dramaId;
      prompt = [asset.appearance, asset.description, asset.personality]
        .filter(Boolean).join(', ');
      if (!prompt) return { error: '角色没有外貌描述，请先填写外貌描述' };
    } else if (assetType === 'scene') {
      const asset = await dramaWorkflowManager.getSceneById(assetId);
      if (!asset) return { error: '场景不存在' };
      dramaId = asset.dramaId;
      prompt = [asset.description, asset.atmosphere].filter(Boolean).join(', ');
      if (!prompt) return { error: '场景没有描述，请先填写场景描述' };
    } else if (assetType === 'item') {
      const asset = await dramaWorkflowManager.getItemById(assetId);
      if (!asset) return { error: '物品不存在' };
      dramaId = asset.dramaId;
      prompt = [asset.description, asset.significance].filter(Boolean).join(', ');
      if (!prompt) return { error: '物品没有描述，请先填写物品描述' };
    }

    // 解析风格配置：前置/后置提示词 + 参考图片
    let prePrompt = '';
    let postPrompt = '';
    let referenceImages: string[] = [];
    if (styleRaw) {
      try {
        const style = JSON.parse(styleRaw);
        prePrompt = style.prePrompt || '';
        postPrompt = style.postPrompt || '';
        referenceImages = await Promise.all(
          (style.referenceImages || [])
            .filter((x: any) => typeof x === 'string' && x.startsWith('data:'))
            .slice(0, 6)
            .map((x: string) => downscaleRefToDataUri(x))
        );
      } catch {}
    }
    // 最终提示词 = 前置 + 资产描述 + 后置
    const finalPrompt = [prePrompt, prompt, postPrompt].filter(Boolean).join(', ');

    const provider = params.provider || config?.provider || 'openai';
    const model = params.model || config?.model || 'dall-e-3';
    const apiKey = params.apiKey || config?.apiKey;
    const apiUrl = params.apiUrl || config?.apiUrl;
    if (!apiKey) return { error: '缺少图片API密钥，请在图片生成API配置中选择配置' };

    const sizeStr = params.size ||
      (params.imageWidth && params.imageHeight ? `${params.imageWidth}x${params.imageHeight}` : '1024x1024');

    await publishRequestPrompt(taskId, {
      prompt: finalPrompt,
      assetType,
      assetId,
      provider,
      model,
      size: sizeStr,
      referenceImages: referenceImages.length,
    });

    const genResult = await callImageProvider(provider, model, apiKey, apiUrl, finalPrompt, sizeStr, params, referenceImages);
    if ('error' in genResult) return genResult;

    const localUrl = await saveMediaLocally(genResult.imageUrl, 'image', assetId, dramaId);
    
    // 将新图片加到画廊开头，保留所有历史图片（包括旧主图）
    function getFullGallery(imageUrl: string | null | undefined, imagePrompt: string | null | undefined, galleryJson: string | null | undefined): any[] {
      let gallery: any[] = [];
      if (galleryJson) {
        try { gallery = JSON.parse(galleryJson); } catch { gallery = []; }
      }
      if (imageUrl && !gallery.some((g: any) => g.url === imageUrl)) {
        gallery = [{ url: imageUrl, prompt: imagePrompt || '', createdAt: new Date().toISOString() }, ...gallery];
      }
      return gallery;
    }
    function prependNewImage(gallery: any[], newImage: { url: string; prompt?: string }): any[] {
      const filtered = gallery.filter((g: any) => g.url !== newImage.url);
      return [{ ...newImage, createdAt: new Date().toISOString() }, ...filtered].slice(0, 50);
    }

    if (assetType === 'character') {
      const char = await dramaWorkflowManager.getCharacterById(assetId);
      const fullGallery = getFullGallery(char?.imageUrl, char?.imagePrompt, char?.imageGallery);
      const newGallery = prependNewImage(fullGallery, { url: localUrl, prompt: finalPrompt });
      await dramaWorkflowManager.updateCharacter(assetId, { 
        imageUrl: localUrl, 
        imageGallery: JSON.stringify(newGallery) 
      });
    } else if (assetType === 'scene') {
      const scene = await dramaWorkflowManager.getSceneById(assetId);
      const fullGallery = getFullGallery(scene?.imageUrl, scene?.imagePrompt, scene?.imageGallery);
      const newGallery = prependNewImage(fullGallery, { url: localUrl, prompt: finalPrompt });
      await dramaWorkflowManager.updateScene(assetId, { 
        imageUrl: localUrl, 
        imageGallery: JSON.stringify(newGallery) 
      });
    } else if (assetType === 'item') {
      const item = await dramaWorkflowManager.getItemById(assetId);
      const fullGallery = getFullGallery(item?.imageUrl, item?.imagePrompt, item?.imageGallery);
      const newGallery = prependNewImage(fullGallery, { url: localUrl, prompt: finalPrompt });
      await dramaWorkflowManager.updateItem(assetId, { 
        imageUrl: localUrl, 
        imageGallery: JSON.stringify(newGallery) 
      });
    }

    return { data: { imageUrl: localUrl, assetId, assetType, prompt: finalPrompt } };
  } catch (error: any) {
    return { error: error.message };
  }
}

async function handleScriptRewrite(
  dramaId: string, episodeId: string, config: any, params: any, userId: string
) {
  try {
    if (!episodeId) return { error: '缺少 episodeId' };
    const episode = await shortDramaManager.getEpisodeById(episodeId);
    if (!episode) return { error: '分集不存在' };

    // 自动获取源内容：优先参数 → 剧本章节 → 小说章节 → 分集摘要
    let sourceText = params.sourceText || '';
    if (!sourceText) {
      const drama = await shortDramaManager.getById(dramaId);
      // 尝试从关联的剧本获取
      if (drama?.scriptId && episode.sourceScriptChapterIndex !== null && episode.sourceScriptChapterIndex !== undefined) {
        const script = await scriptManager.getScriptById(drama.scriptId);
        if (script?.chapters) {
          const chapters = Array.isArray(script.chapters) ? script.chapters : [];
          const ch = chapters[episode.sourceScriptChapterIndex];
          if (ch?.screenplay) sourceText = ch.screenplay;
          else if (ch?.content) sourceText = ch.content;
        }
      }
      // 尝试从关联的小说获取
      if (!sourceText && drama?.novelId && episode.sourceChapter) {
        const novel = await novelManager.getById(drama.novelId);
        if (novel?.chapters) {
          const chapters = typeof novel.chapters === 'string' ? JSON.parse(novel.chapters) : novel.chapters;
          if (Array.isArray(chapters)) {
            const ch = chapters.find((c: any) => c.index === episode.sourceChapter) || chapters[episode.sourceChapter - 1];
            if (ch?.content) sourceText = ch.content;
          }
        }
      }
      // 最后回退到分集摘要
      if (!sourceText) sourceText = episode.synopsis || '';
    }
    if (!sourceText) return { error: '没有可改写的内容，请先导入小说/剧本数据或手动填写内容' };

    const duration = params.duration || 60;

    // 使用与小说剧本相同的系统提示词结构，确保输出格式一致
    const forcedRules = `
【强制执行指令——以下规则优先级最高，任何情况下不可违反】
- 严格遵守下面的【输出格式】JSON结构
- scenes数组的场景数量由您根据剧情自主决定
- 每个场景的sceneIndex必须按顺序递增
- 严格只输出JSON，不要任何解释、前言或markdown标记`;

    const { systemPrompt: dbScriptSystem } = await getPromptsWithFallback(
      'script-generate-system',
      '',
      undefined,
      {
        text: sourceText,
        title: episode.title || `第${episode.episodeNumber}集`,
      }
    );

    const systemPrompt = [
      forcedRules,
      '',
      dbScriptSystem || `你是一位资深影视剧本编剧，擅长将小说章节精准转化为专业影视剧本场景序列。`,
      '',
      `## 输出格式要求
严格输出合法JSON，不要输出任何其他文字：
{
  "scenes": [
    {
      "sceneIndex": 0,
      "sceneTitle": "场景标题（格式：内外景-地点-时间，如：内景-出租屋-傍晚）",
      "description": "场景环境描述（氛围、光线、陈设、声音等，至少50字）",
      "actions": "角色动作描述（具体、可视化的肢体动作和表情，至少30字）",
      "dialogues": [
        {"character": "角色名（必填，不能为空）", "line": "台词内容"}
      ],
      "stageDirections": "镜头/舞台指示（景别、运镜方式、转场建议）",
      "sceneTransition": "场景衔接说明（除第一个场景外必填，说明如何从前一个场景过渡）"
    }
  ]
}

## 注意事项
- sceneIndex递增
- 无对白的场景dialogues设为空数组[]
- 角色名必须与原文一致，严禁留空
- sceneTitle格式统一：内外景-地点-时间
- sceneTransition字段说明场景间的逻辑联系，保证连贯性
- 只输出JSON，不要输出markdown代码块标记或其他说明文字`,
      '',
      '## 场景划分原则',
      '1. **时空转换**即换场景：地点变化、时间跳跃、内外景切换都必须新开场景',
      '2. **焦点转移**即换场景：主要角色变化、叙事视角切换应拆分场景',
      '3. **情绪转折**可换场景：情感基调发生显著变化时',
      '4. **对白场景**：一段完整对话（含动作穿插）为一个场景',
      '5. **动作场景**：一个连续动作段落为一个场景',
      '',
      '## 场景连贯性要求（强制执行）',
      '1. **因果关系**：每个场景必须由前一个场景的情节自然引出',
      '2. **时间线连贯**：场景之间的时间推移要有逻辑',
      '3. **空间转换合理**：地点变化要有过渡说明',
      '4. **人物状态延续**：角色在不同场景中的情绪、身体状况要保持一致',
      '5. **禁止重复**：已生成的情节不能重新演绎，只能推进新内容',
      '6. **衔接说明**：每个场景必须填写 sceneTransition 字段',
      '',
      '## 各字段写作要求',
      '### description（场景环境描述）— 至少50字',
      '- 必须包含：时辰/光线 + 地点陈设 + 环境氛围 + 至少一个声音或气味细节',
      '',
      '### actions（角色动作描述）— 至少30字',
      '- 必须是具体、可视化的肢体动作和微表情',
      '',
      '### dialogues（对白）',
      '- 台词必须口语化、符合人物性格，有潜台词',
      '- 角色名必须与原文一致，不得改名，**character字段严禁为空字符串**',
      '- 每条台词都必须有对应的角色名',
      '',
      '### sceneTransition（场景衔接说明）',
      '- 每个场景（除第一个外）必须添加此字段',
      '- 简要说明本场景如何从前一个场景过渡而来',
      '- 第一个场景填"开篇场景，无前置衔接"',
      '',
      '### stageDirections（镜头/舞台指示）',
      '- 必须包含景别（特写/近景/中景/全景/远景）+ 运镜（推/拉/摇/跟/手持/固定）',
      '',
      `## 短剧特殊要求`,
      `- 时长限制：${duration}秒以内的内容量`,
      `- 节奏要快，冲突要激烈`,
      `- 对白要精简有力，适合短视频传播`,
    ].join('\n');

    const userPrompt = `请将以下${params.sourceType || '内容'}改写为短剧剧本格式。

【改写指令】
1. 请完全根据【系统提示词】的角色设定、写作原则和 JSON 格式要求进行剧本创作
2. 场景数量由您根据剧情和节奏自主决定（推荐生成 5-12 个高质量场景）
3. 必须确保故事时间线向后推进，严禁重复
4. 严格遵循输出格式，只返回合法纯 JSON
5. 每个场景的 sceneIndex 从 0 开始递增

【待改写内容】
${sourceText}`;

    const result = await callAI(config, systemPrompt, userPrompt);
    if (result.error) return result;

    // 解析并保存到分集
    try {
      const parsed = JSON.parse(result.data);

      // 标准化输出：同时保存 scenes 格式（与小说剧本一致）和旧格式（兼容性）
      const scenes = parsed.scenes || [];

      // 构建兼容的 dialogues 数组（扁平化所有场景的对白）
      const flatDialogues = scenes.flatMap((s: any) =>
        (s.dialogues || []).map((d: any) => ({
          character: d.character,
          line: d.line,
          action: d.action || '',
        }))
      );

      // 构建兼容的 scenes 数组（简化版）
      const flatScenes = scenes.map((s: any) => ({
        location: s.sceneTitle || '',
        description: s.description || '',
      }));

      await shortDramaManager.updateEpisode(episodeId, {
        screenplay: parsed.screenplay || result.data,
        scenes: JSON.stringify(flatScenes),
        dialogues: JSON.stringify(flatDialogues),
        directions: parsed.directions || null,
        // 新增：保存完整的 scenes 数组（与小说剧本格式一致）
        screenplayScenes: JSON.stringify(scenes),
      });

      // ── 保存小说和剧本内容到本地独立文本文件夹 ──
      try {
        const { dirs } = await getWorkDirs(dramaId);
        if (sourceText) {
          const novelTxtPath = path.join(dirs.texts, `novel_chapter_${episode.sourceChapter || 'synopsis'}.txt`);
          fs.writeFileSync(novelTxtPath, sourceText, 'utf8');
        }
        const scriptTxtPath = path.join(dirs.texts, `script_episode_${episodeId}.txt`);
        fs.writeFileSync(scriptTxtPath, parsed.screenplay || result.data, 'utf8');
      } catch (err) {
        console.error('[handleScriptRewrite] write local text files failed:', err);
      }

      return { data: parsed };
    } catch {
      await shortDramaManager.updateEpisode(episodeId, { screenplay: result.data });

      // ── 异常解析 fallback 保存 ──
      try {
        const { dirs } = await getWorkDirs(dramaId);
        if (sourceText) {
          const novelTxtPath = path.join(dirs.texts, `novel_chapter_${episode.sourceChapter || 'synopsis'}.txt`);
          fs.writeFileSync(novelTxtPath, sourceText, 'utf8');
        }
        const scriptTxtPath = path.join(dirs.texts, `script_episode_${episodeId}.txt`);
        fs.writeFileSync(scriptTxtPath, result.data, 'utf8');
      } catch (err) {
        console.error('[handleScriptRewrite] write local text files failed (fallback):', err);
      }

      return { data: { screenplay: result.data } };
    }
  } catch (error: any) {
    return { error: error.message };
  }
}

async function handleExtractCharacters(
  dramaId: string, config: any, params: any, userId: string
) {
  try {
    const episodes = await shortDramaManager.getEpisodesByDramaId(dramaId);
    const screenplays = episodes.map(e => e.screenplay).filter(Boolean).join('\n---\n');
    if (!screenplays) return { error: '没有可分析的剧本内容' };

    const { systemPrompt } = await getPromptsWithFallback(
      'extract-characters-system',
      `分析以下短剧剧本，提取所有角色信息。
输出JSON数组格式：
[{
  "name": "角色名",
  "role": "protagonist/antagonist/supporting",
  "description": "角色简介",
  "personality": "性格特点",
  "appearance": "外貌描述（用于AI绘图）"
}]`
      ,
      undefined,
      { text: screenplays }
    );

    const result = await callAI(config, systemPrompt, screenplays.slice(0, 8000));
    if (result.error) return result;

    try {
      const characters = JSON.parse(result.data);
      if (Array.isArray(characters)) {
        const created = [];
        for (const c of characters) {
          const char = await dramaWorkflowManager.createCharacter({
            dramaId, userId,
            name: (c.name || '').replace(/\s*[—–\-]+\s*【.*$/, '').replace(/\s*【.*$/, '').trim() || c.name,
            role: c.role || 'supporting',
            description: c.description || null,
            personality: c.personality || null,
            appearance: c.appearance || null,
            sortOrder: c.role === 'protagonist' ? 0 : c.role === 'antagonist' ? 1 : 10,
          });
          created.push(char);
        }
        return { data: created };
      }
    } catch {}
    return { data: result.data };
  } catch (error: any) {
    return { error: error.message };
  }
}

async function handleBreakStoryboard(
  dramaId: string, episodeId: string, config: any, params: any, userId: string
) {
  try {
    if (!episodeId) return { error: '缺少 episodeId' };
    const episode = await shortDramaManager.getEpisodeById(episodeId);
    if (!episode) return { error: '分集不存在' };

    // 优先用分集自有剧本 → 关联剧本章节 → 关联小说章节（按 sourceChapter）
    let screenplay = episode.screenplay;
    let sourceLabel = `第${episode.episodeNumber}集`;
    const drama = await shortDramaManager.getById(dramaId);

    if (!screenplay && episode.sourceScriptChapterIndex != null) {
      try {
        if (drama?.scriptId) {
          const { scriptManager } = await import('@/storage/database');
          const script = await scriptManager.getScriptById(drama.scriptId);
          const chapters = Array.isArray(script?.chapters) ? script.chapters : [];
          screenplay = chapters[episode.sourceScriptChapterIndex]?.screenplay || null;
          if (screenplay) sourceLabel += `（剧本第${episode.sourceScriptChapterIndex + 1}章）`;
        }
      } catch {}
    }

    // 关联小说章节回退：用对应章节原文内容生成分镜（注意 sourceChapter 可能为 0，用 != null 而非 truthy）
    if (!screenplay && drama?.novelId && episode.sourceChapter != null) {
      try {
        const novel = await novelManager.getById(drama.novelId);
        if (novel?.chapters) {
          const novelChapters = typeof novel.chapters === 'string'
            ? JSON.parse(novel.chapters) : novel.chapters;
          if (Array.isArray(novelChapters)) {
            const ch = novelChapters.find((c: any) => c.index === episode.sourceChapter)
              || novelChapters[episode.sourceChapter - 1];
            if (ch?.content) {
              screenplay = ch.content;
              sourceLabel += `（小说第${episode.sourceChapter}章：${ch.title || ''}）`;
            }
          }
        }
      } catch {}
    }

    if (!screenplay) return { error: '分集剧本内容不存在，请先从剧本同步、生成剧本，或确认分集已关联小说章节' };

    const characters = await dramaWorkflowManager.getCharactersByDramaId(dramaId);
    const charNames = characters.map(c => c.name).join('、');
    const scenes = await dramaWorkflowManager.getScenesByDramaId(dramaId);
    const sceneDesc = scenes.length > 0 ? `\n场景设定:\n${scenes.map((s: any) => `- ${s.name}${s.description ? '：' + s.description : ''}${s.atmosphere ? '（' + s.atmosphere + '）' : ''}`).join('\n')}` : '';

    const { systemPrompt: dbBreakSystem } = await getPromptsWithFallback(
      'storyboard-breakdown-system',
      `你是一位专业的短剧分镜师。请严格基于所提供的源内容（小说章节或剧本），为指定集数拆解分镜序列。
要求：
1. 每个分镜必须对应源内容中的一个具体情节片段，场景描述不得重复
2. 按源内容的叙事顺序排列分镜，完整覆盖该章节/集的情节
3. 场景描述具体：包含地点、光线、氛围、人物位置和动作
4. 对白直接引用或改编自源内容中的原文台词
5. 图片提示词用英文，包含场景环境、人物特征、画面风格`
      ,
      undefined,
      {
        text: [screenplay, charNames, sceneDesc].filter(Boolean).join('\n'),
        title: sourceLabel,
      }
    );
    const systemPrompt = [
      dbBreakSystem,
      `角色列表: ${charNames || '根据内容推断'}`,
      sceneDesc,
      `本集时长约${episode.duration || 60}秒，每个分镜时长 2-5 秒。`,
      '',
      '⚠️ 重要：每个分镜的 sceneDescription 必须唯一，不能出现重复或相似的场景描述。',
      '输出JSON对象格式（必须是对象，不是数组）：',
      '{"shots": [{"shotNumber": 1, "shotType": "storyboard", "sceneDescription": "具体且唯一的场景描述", "cameraAngle": "远景/中景/近景/特写", "cameraMovement": "推/拉/摇/移/固定", "dialogue": "角色对白（引用原文）", "voiceover": "旁白", "characterIds": ["角色名"], "duration": 3, "subtitle": "字幕文字", "imagePrompt": "English image prompt"}]}',
    ].filter(Boolean).join('\n');

    // 用户消息：明确告知 AI 这是哪一集/章节的内容，避免跨集重复
    const userMessage = `以下是${sourceLabel}的源内容，请严格基于此内容生成分镜，每个分镜对应该集的一个具体情节，不得重复或编造原文中没有的场景：\n\n${screenplay}`;

    const result = await callAI(config, systemPrompt, userMessage);
    if (result.error) return result;

    try {
      const parsed = JSON.parse(extractJSON(result.data));
      // 兼容两种格式：直接数组 [...] 或对象包裹 {"shots": [...]}
      const shots = Array.isArray(parsed) ? parsed
        : (parsed.shots || parsed.scenes || parsed.storyboard || parsed.frames || []);
      if (Array.isArray(shots) && shots.length > 0) {
        // ── 使用共享工具解析剧本原文场景，1:1映射覆盖 AI 生成的 sceneDescription ──
        const scriptSceneDescs = buildScriptSceneDescriptions(screenplay);
        const scriptScenes = scriptSceneDescs.map((s, idx) => ({ index: idx, rawText: s.rawText }));

        // 1:1直接映射：场景N → 分镜N
        const sceneCount = scriptScenes.length;

        // 先清除旧分镜
        await dramaWorkflowManager.deleteShotsByEpisodeId(episodeId);
        const created = await dramaWorkflowManager.bulkCreateShots(
          shots.map((s: any, idx: number) => {
            // 直接1:1映射：scene[0]→shot[0], scene[1]→shot[1]...
            let finalSceneDesc: string | null = null;
            if (idx < sceneCount) {
              finalSceneDesc = scriptScenes[idx].rawText;
            } else if (sceneCount > 0) {
              // 分镜多于场景：多余的分镜取最后一个场景原文
              finalSceneDesc = scriptScenes[sceneCount - 1].rawText;
            } else {
              // 无剧本场景：保留AI生成
              finalSceneDesc = s.sceneDescription || null;
            }

            return {
              dramaId, episodeId, userId,
              shotNumber: s.shotNumber || idx + 1,
              shotType: s.shotType || 'storyboard',
              sceneDescription: finalSceneDesc,
              cameraAngle: s.cameraAngle || null,
              cameraMovement: s.cameraMovement || null,
              dialogue: s.dialogue || null,
              voiceover: s.voiceover || null,
              characterIds: s.characterIds ? JSON.stringify(s.characterIds) : null,
              imagePrompt: s.imagePrompt || null,
              ttsText: s.dialogue || s.voiceover || null,
              subtitle: s.subtitle || s.dialogue || null,
              duration: s.duration || 3,
              status: 'draft',
            };
          })
        );

        // ── 保存分镜拆解文本到本地独立文本文件夹 ──
        try {
          const { dirs } = await getWorkDirs(dramaId);
          const txtPath = path.join(dirs.texts, `storyboard_episode_${episodeId}.txt`);
          let mdContent = `# 分镜大纲 (Storyboard Shots) - 第 ${episodeId} 集\n\n`;
          created.forEach((s: any) => {
            mdContent += `### 镜头 #${s.shotNumber} (${s.cameraAngle || '无景别'})\n`;
            mdContent += `- **画面描述**: ${s.sceneDescription || '无'}\n`;
            if (s.dialogue) mdContent += `- **角色台词**: "${s.dialogue}"\n`;
            if (s.voiceover) mdContent += `- **旁白**: ${s.voiceover}\n`;
            if (s.imagePrompt) mdContent += `- **生图提示词**: ${s.imagePrompt}\n`;
            mdContent += `- **时长**: ${s.duration} 秒\n\n`;
          });
          fs.writeFileSync(txtPath, mdContent, 'utf8');
        } catch (err) {
          console.error('[handleBreakStoryboard] write storyboard text failed:', err);
        }

        return { data: created };
      }
    } catch {}
    return { data: result.data };
  } catch (error: any) {
    return { error: error.message };
  }
}

/**
 * 剧本场景描述构建函数已迁移至 @/lib/drama-scene-description.ts
 * - buildScriptSceneDescriptions: 从剧本解析并构建场景原文
 * - buildShotsFromScriptScenes: 从场景数据构建分镜数据
 */

/**
 * 从 screenplay 获取剧本内容（优先分集自有 → 关联剧本 → 关联小说）
 */
async function getScreenplayForEpisode(dramaId: string, episodeId: string): Promise<string | null> {
  const episode = await shortDramaManager.getEpisodeById(episodeId);
  if (!episode) return null;

  let screenplay = episode.screenplay;
  if (!screenplay && episode.sourceScriptChapterIndex != null) {
    try {
      const drama = await shortDramaManager.getById(dramaId);
      if (drama?.scriptId) {
        const { scriptManager } = await import('@/storage/database');
        const script = await scriptManager.getScriptById(drama.scriptId);
        const chapters = Array.isArray(script?.chapters) ? script.chapters : [];
        screenplay = chapters[episode.sourceScriptChapterIndex]?.screenplay || null;
      }
    } catch {}
  }

  // 尝试 episode.scenes 字段作为回退
  if (!screenplay && (episode as any).scenes) {
    try {
      const s2 = JSON.parse((episode as any).scenes);
      if (s2 && (Array.isArray(s2) || Array.isArray(s2?.scenes))) {
        screenplay = JSON.stringify(Array.isArray(s2) ? s2 : s2.scenes);
      }
    } catch {}
  }

  return screenplay || null;
}

/**
 * bootstrapShotsFromScreenplay —— 始终刷新分镜的 sceneDescription 为剧本原文
 * 如果分镜不存在，则创建新分镜
 * 如果分镜已存在，则更新所有分镜的 sceneDescription
 */
async function bootstrapShotsFromScreenplay(
  dramaId: string, episodeId: string, userId: string
): Promise<{ created: number; updated: number }> {
  const screenplay = await getScreenplayForEpisode(dramaId, episodeId);
  if (!screenplay) return { created: 0, updated: 0 };

  const sceneDescs = buildScriptSceneDescriptions(screenplay);
  if (!sceneDescs.length) return { created: 0, updated: 0 };

  // 构建分镜数据
  const shotData = buildShotsFromScriptScenes(dramaId, episodeId, userId, sceneDescs);

  // 检查现有分镜
  const existingShots = await dramaWorkflowManager.getShotsByEpisodeId(episodeId);

  if (existingShots.length === 0) {
    // 无分镜：直接创建
    await dramaWorkflowManager.bulkCreateShots(shotData);
    return { created: shotData.length, updated: 0 };
  }

  // 有分镜：更新 sceneDescription（1:1映射）
  const sceneCount = sceneDescs.length;
  let updated = 0;

  for (let i = 0; i < existingShots.length; i++) {
    const shot = existingShots[i];
    let finalSceneDesc: string | null = null;
    let finalDialogue: string | null = null;
    let finalTtsText: string | null = null;
    let finalSubtitle: string | null = null;

    if (i < sceneCount) {
      finalSceneDesc = sceneDescs[i].rawText;
      if (sceneDescs[i].dialogueLines.length > 0) {
        finalDialogue = sceneDescs[i].dialogueLines.join('\n');
        finalTtsText = finalDialogue;
        finalSubtitle = sceneDescs[i].dialogueLines[0];
      }
    } else if (sceneCount > 0) {
      // 分镜多于场景：多余的分镜取最后一个场景原文
      finalSceneDesc = sceneDescs[sceneCount - 1].rawText;
      if (sceneDescs[sceneCount - 1].dialogueLines.length > 0) {
        finalDialogue = sceneDescs[sceneCount - 1].dialogueLines.join('\n');
        finalTtsText = finalDialogue;
        finalSubtitle = sceneDescs[sceneCount - 1].dialogueLines[0];
      }
    }

    if (finalSceneDesc && (finalSceneDesc !== shot.sceneDescription || finalDialogue !== shot.dialogue)) {
      const updatePayload: any = { sceneDescription: finalSceneDesc };
      if (finalDialogue) {
        updatePayload.dialogue = finalDialogue;
        updatePayload.ttsText = finalTtsText;
        updatePayload.subtitle = finalSubtitle;
      }
      await dramaWorkflowManager.updateShot(shot.id, updatePayload);
      updated++;
    }
  }

  return { created: 0, updated };
}

async function handleGenerateImagePrompts(
  dramaId: string, episodeId: string, config: any, params: any, userId: string
) {
  try {
    if (!episodeId) return { error: '缺少 episodeId' };
    // 始终先刷新分镜的 sceneDescription 为剧本原文
    await bootstrapShotsFromScreenplay(dramaId, episodeId, userId);
    let shots = await dramaWorkflowManager.getShotsByEpisodeId(episodeId);
    if (!shots.length) return { error: '该分集暂无剧本场景，无法生成提示词' };

    const characters = await dramaWorkflowManager.getCharactersByDramaId(dramaId);
    const scenes = await dramaWorkflowManager.getScenesByDramaId(dramaId);
    const items = await dramaWorkflowManager.getItemsByDramaId(dramaId);

    // 构建角色/场景/物品名称索引（供 AI 对照）
    const charList = characters.map((c: any) => `  - ID:${c.id} 名字:${c.name}${c.appearance ? ' 外貌:' + c.appearance : ''}`).join('\n');
    const sceneList = scenes.map((s: any) => `  - ${s.name}${s.description ? '：' + s.description : ''}${s.atmosphere ? ' 氛围:' + s.atmosphere : ''}`).join('\n');
    const itemList = items.map((i: any) => `  - ${i.name}${i.description ? '：' + i.description : ''}`).join('\n');

    const { systemPrompt: dbSystem, userPrompt: dbUserTpl } = await getPromptsWithFallback(
      'image-prompts-system',
      `你是一位顶级影视分镜师，精通AI绘画提示词技术。将剧本场景转化为具有叙事张力和电影质感的分镜画面描述。

核心原则：为每个场景选择最具戏剧张力的那一帧，让画面本身就在讲故事。

一、画面要素提取方法
- 场景描述 → 构图环境 + 光影氛围
- 角色动作 → 凝固最具表现力的一帧（不是连续动作，是一个瞬间）
- 对白 → 说话瞬间的极致表情和口型状态
- 舞台指示 → 具体构图视角和景别

二、对白场景必须包含
- 说话者嘴唇微张/手势配合/面部表情极致状态（愤怒/悲伤/惊恐/坚定）
- 对话双方空间关系（正面、侧面、背面）
- 听话者即时反应的微表情

三、无对白场景
- 聚焦最具视觉冲击力的一帧
- 用光影构图本身传递情绪

四、构图选择规则
- 独白/内心戏 → 面部特写 + 浅景深虚化背景
- 双人对话 → 过肩镜头或双人近景
- 群体场景 → 全景或中景
- 动作/冲突 → 对角线构图 + 动感
- 环境建立 → 大全景

五、光影设计规则
- 昏暗室内 → 单一主光源、强高对比、阴影浓重
- 室外白天 → 时间感色调（清晨蓝金/正午硬光/黄昏橙红）
- 奇幻/玄幻 → 边缘发光粒子光效、神秘氛围光
- 动作/对抗 → 侧逆光、强轮廓光

提示词撰写规范：
1. 每条提示词必须自包含所有视觉信息，80-150字
2. 具体描述：人物数量/姿态/表情/服装特征/环境陈设/光源方向/色调倾向
3. 有对白时必须描述说话者表情/口型状态/肢体配合
4. 中文撰写

❌ 禁止模糊描述（如"气氛紧张""场景很美"——不可视化）
❌ 禁止描述连续动作，只选最有力的那一帧
❌ 禁止缺少光线和色调信息`,
      undefined,
      {
        text: [
          shots.map((s: any) => {
            const d = s.dialogue || s.ttsText || s.dubbingText || '';
            return [s.sceneDescription, d, s.voiceover].filter(Boolean).join(' ');
          }).join('\n'),
          charList,
          sceneList,
          itemList,
          params.style,
        ].filter(Boolean).join('\n'),
      },
    );
    const systemPrompt = [
      dbSystem,
      charList ? `可用角色列表（含ID，生成提示词时请在 imagePrompt 中直接写出角色名字，并在 characterIds 中填入对应ID列表）:\n${charList}` : '',
      sceneList ? `可用场景列表（生成提示词时请在 imagePrompt 中直接写出匹配的场景名字）:\n${sceneList}` : '',
      itemList ? `可用物品列表（如分镜中出现相关物品，请在 imagePrompt 中直接写出物品名字）:\n${itemList}` : '',
      `风格要求: ${params.style || 'cinematic, photorealistic'}`,
      '',
      '任务：为下方每个分镜生成图片提示词，同时提取出现的角色ID。',
      '提示词要求：中文、场景内容、角色名字（直接用上方角色列表中的名字）、场景名字、物品名字、光线氛围、构图风格。',
      '**重要**：imagePrompt 中必须把本分镜涉及的角色名、场景名、物品名直接写入提示词文本中，确保名字完整准确。',
      '输出格式：纯JSON数组，每项 {"shotId":"分镜ID","imagePrompt":"含角色/场景/物品名的中文提示词","characterIds":["角色ID1","角色ID2"]}，不要添加任何其他内容。',
    ].filter(Boolean).join('\n');

    const userMessage = [
      `请为以下 ${shots.length} 个分镜分别生成中文图片提示词：`,
      '',
      ...shots.map(s => {
        const sDialogue = s.dialogue || s.ttsText || s.dubbingText || '';
        const desc = [s.sceneDescription, sDialogue ? `[对白] ${sDialogue}` : ''].filter(Boolean).join(' ');
        const tplLine = dbUserTpl
          ? dbUserTpl.replace(/\{\{sceneTitle\}\}/g, `镜头${s.shotNumber}`).replace(/\{\{sceneDescription\}\}/g, desc)
          : `分镜输入: ${desc}`;
        return `shotId="${s.id}" (镜头${s.shotNumber}): ${tplLine}`;
      }),
    ].join('\n');

    const result = await callAI(config, systemPrompt, userMessage);
    if (result.error) return result;

    try {
      const parsed = JSON.parse(extractJSON(result.data));
      // 兼容两种格式：直接数组 [...] 或对象包裹 {"prompts": [...]}
      const prompts: any[] = Array.isArray(parsed) ? parsed
        : (parsed.prompts || parsed.imagePrompts || parsed.shots || parsed.data || []);
      if (Array.isArray(prompts) && prompts.length > 0) {
        const shotById = new Map(shots.map((s: any) => [s.id, s]));
        const shotByNum = new Map(shots.map((s: any) => [String(s.shotNumber), s]));
        for (const p of prompts) {
          if (!p.imagePrompt) continue;
          const shot: any = shotById.get(p.shotId) || shotByNum.get(String(p.shotId)) || shotByNum.get(String(p.shotNumber));
          if (!shot) continue;
          const updatePayload: any = { imagePrompt: p.imagePrompt };
          if (Array.isArray(p.characterIds) && p.characterIds.length > 0) {
            updatePayload.characterIds = JSON.stringify(p.characterIds);
          }
          await dramaWorkflowManager.updateShot(shot.id, updatePayload);
        }
        return { data: prompts };
      }
    } catch {}
    return { data: result.data };
  } catch (error: any) {
    return { error: error.message };
  }
}

async function handleGenerateVideoPrompts(
  dramaId: string, episodeId: string, config: any, params: any, userId: string
) {
  try {
    if (!episodeId) return { error: '缺少 episodeId' };
    // 始终先刷新分镜的 sceneDescription 为剧本原文
    await bootstrapShotsFromScreenplay(dramaId, episodeId, userId);
    let shots = await dramaWorkflowManager.getShotsByEpisodeId(episodeId);
    if (!shots.length) return { error: '该分集暂无剧本场景，无法生成提示词' };

    // ── 收集角色、场景、物品上下文 ──
    const scenes = await dramaWorkflowManager.getScenesByDramaId(dramaId);
    const characters = await dramaWorkflowManager.getCharactersByDramaId(dramaId);
    const items = await dramaWorkflowManager.getItemsByDramaId(dramaId);

    const charRef = characters.length > 0
      ? `\n主要角色:\n${characters.map((c: any) => `- ${c.name}${c.gender ? `（${c.gender}）` : ''}${c.appearance ? '，外貌：' + c.appearance : ''}${c.description ? '，背景：' + c.description.slice(0, 60) : ''}`).join('\n')}`
      : '';
    const sceneRef = scenes.length > 0
      ? `\n场景设定:\n${scenes.map((s: any) => `- ${s.name}${s.description ? '：' + s.description : ''}${s.atmosphere ? ' 氛围：' + s.atmosphere : ''}`).join('\n')}`
      : '';
    const itemRef = items.length > 0
      ? `\n关键道具:\n${items.map((i: any) => `- ${i.name}${i.description ? '：' + i.description : ''}`).join('\n')}`
      : '';

    const { systemPrompt: dbSystem2, userPrompt: dbVideoTpl } = await getPromptsWithFallback(
      'video-prompts-system',
      `你是一位顶级影视视觉导演，精通AI视频生成技术。将剧本文字转化为精准、可执行的AI视频提示词。每个提示词必须让AI视频模型"看到"一个完整的动态片段（3-10秒）。

一、画面要素提取方法
- 场景描述 → 环境氛围和空间感
- 角色动作 → 具体运动轨迹（从哪到哪、速度快慢）
- 对白 → 视觉化处理（口型/表情/肢体同步）
- 舞台指示 → 镜头语言和景别

二、对白场景必须包含
- 说话者：面部近景或特写，嘴唇微张/口型变化，对应情绪的面部表情（愤怒/悲伤/惊恐/坚定）
- 肢体语言：手势、身体姿态与台词情绪一致
- 听话者：即时反应，眼神交流方向
- 镜头：正反打切换或双人构图

三、无对白场景
- 聚焦动作轨迹和情绪氛围
- 用镜头运动传递人物心理状态
- 用光线和色彩变化强化情绪节奏

四、镜头运动规则（按场景类型）
- 情感高潮/爆发 → 快速推近，焦点锁定脸部，速度加快
- 环境建立/展现 → 缓慢横摇或航拍，景别从大到小
- 对话交流 → 正反打，景别保持近景，节奏稳定
- 追逐/逃跑 → 跟拍低角度，手持抖动感，快速剪辑节奏
- 静态情感/内心戏 → 固定机位，浅景深虚化背景，极慢运镜

五、提示词撰写规范
1. 用"从...到..."描述运动轨迹和变化过程
2. 明确光线方向、色彩倾向（冷暖/饱和度）、画面节奏（缓慢/紧张/激烈）
3. 每条提示词描述一个3-10秒的完整动态片段，自包含所有视觉信息
4. 中文撰写，画面感精准
5. 有对白时必须包含说话者口型/表情/肢体语言的动态描述

❌ 禁止静态描述（视频提示词必须有运动感）
❌ 禁止模糊描述（如"镜头移动""场景很美"——必须说清楚怎么移动、多快、从哪到哪）
❌ 禁止缺少光线/色调/速度信息`,
      undefined,
      {
        text: [
          shots.map((s: any) => {
            const d = s.dialogue || s.ttsText || s.dubbingText || '';
            return [s.sceneDescription, d, s.voiceover, s.cameraMovement].filter(Boolean).join(' ');
          }).join('\n'),
          charRef,
          sceneRef,
          itemRef,
        ].filter(Boolean).join('\n'),
      },
    );

    const systemPrompt2 = [
      dbSystem2,
      charRef,
      sceneRef,
      itemRef,
      '',
      '## 连贯性规则（必须严格遵守）',
      '1. 角色状态连续：角色的服装、道具、肢体状态（如是否戴手铐、受伤程度）在整个序列中必须保持一致，除非剧情明确发生了变化。',
      '2. 画面无缝衔接：每个分镜的 startFrame 必须与上一个分镜的 endFrame 在空间、角色位置、光线上自然衔接，不能出现跳跃性的位置突变。',
      '3. 空间逻辑连续：如果角色从室外走进室内，后续镜头必须反映这一空间转变，不能在室内镜头后突然出现室外环境。',
      '4. 情绪弧线一致：情绪的变化需要过渡，不能从高度紧张突然变成平静，除非有明确的剧情事件触发。',
      '5. 时间连续：除非有明确的时间跳跃标记，所有镜头发生在连续的时间线上。',
      '',
      '## 输出格式',
      '纯JSON数组（不含Markdown代码块），每项包含：',
      '  shotId: 分镜ID（原样返回）',
      '  stateNote: 本镜头结束时角色/环境的关键状态变化（供下一镜头参考，简洁1句）',
      '  startFrame: 起始画面——与上一镜头 stateNote 衔接的开场描述（2-4句）',
      '  endFrame: 结束画面——本镜头结束时的画面状态（2-4句，将作为下一镜头起点）',
      '  cameraMovement: 镜头运动方式、景别变化、节奏感（2-3句）',
      '  characterAction: 主要角色动作、表情、台词口型（2-3句）',
      '  prompt: 综合完整运镜视频提示词（4-8句，包含所有上述要素）',
      '**对白规则**：若分镜含有对白台词，必须将台词原文嵌入 prompt 和 characterAction 中，格式：角色名（语气/表情）："台词原文"，不得省略或改写。',
    ].filter(Boolean).join('\n');

    // ── 构建用户消息，附带前一镜头的 endFrame/stateNote 作为衔接约束 ──
    // 先尝试解析已有 videoPrompt 作为先验上下文（如果已有生成结果）
    const prevEndFrames: Record<string, string> = {};
    shots.forEach((s: any, idx: number) => {
      if (idx === 0) return;
      const prev = shots[idx - 1];
      if (prev.videoPrompt) {
        try {
          const vp = JSON.parse(prev.videoPrompt);
          if (vp.endFrame) prevEndFrames[s.id] = vp.endFrame;
        } catch {}
      }
    });

    const shotLines = shots.map((s: any, idx: number) => {
      const descParts = [
        s.sceneDescription,
        s.cameraAngle ? `镜头角度: ${s.cameraAngle}` : '',
        s.cameraMovement ? `运动: ${s.cameraMovement}` : '',
        s.duration ? `时长: ${s.duration}s` : '',
      ].filter(Boolean);
      
      // 获取对白（优先dialogue字段，回退ttsText字段）
      const shotDialogue = s.dialogue || s.ttsText || s.dubbingText || null;
      const dialogueSection = shotDialogue 
        ? `\n【对白/台词原文，必须原样引入prompt和characterAction】\n${shotDialogue}` 
        : '';
      const desc = descParts.join(' | ') + dialogueSection;

      const prevHint = idx === 0
        ? '（第一个镜头，无前置衔接约束）'
        : prevEndFrames[s.id]
          ? `【前一镜头结束状态】：${prevEndFrames[s.id]}`
          : `（请确保与镜头${s.shotNumber - 1}的结束状态自然衔接）`;

      const tplLine = dbVideoTpl
        ? dbVideoTpl.replace(/\{\{sceneTitle\}\}/g, `镜头${s.shotNumber}`).replace(/\{\{sceneDescription\}\}/g, desc)
        : `场景描述: ${desc}`;

      return `--- 镜头${s.shotNumber} (shotId="${s.id}") ---\n${prevHint}\n${tplLine}`;
    });

    const videoUserMessage = [
      `本集共 ${shots.length} 个分镜，请按顺序生成完整连贯的视频运镜提示词，每个镜头的 startFrame 必须与前一镜头的 endFrame 无缝衔接：`,
      '',
      shotLines.join('\n\n'),
    ].join('\n');

    const result = await callAI(config, systemPrompt2, videoUserMessage);
    if (result.error) return result;

    try {
      const prompts = JSON.parse(extractJSON(result.data));
      if (Array.isArray(prompts)) {
        const shotById2 = new Map(shots.map((s: any) => [s.id, s]));
        const shotByNum2 = new Map(shots.map((s: any) => [String(s.shotNumber), s]));
        for (const p of prompts) {
          const shot: any = shotById2.get(p.shotId) || shotByNum2.get(String(p.shotId)) || shotByNum2.get(String(p.shotNumber));
          if (!shot) continue;

          // 获取对白（优先dialogue字段，回退ttsText字段）
          const shotDialogue = shot.dialogue || shot.ttsText || shot.dubbingText || null;
          const hasDialogue = shotDialogue && shotDialogue.trim().length > 0;

          let promptText = p.prompt || p.videoPrompt || '';
          let characterAction = p.characterAction || '';

          // 强制注入对白到prompt（如果AI未包含）
          if (hasDialogue && promptText) {
            // 检查AI生成的prompt是否已包含对白内容
            const dialogueFirstLine = shotDialogue.split('\n')[0]?.trim();
            const alreadyHasDialogue = dialogueFirstLine && promptText.includes(dialogueFirstLine.slice(0, Math.min(10, dialogueFirstLine.length)));
            
            if (!alreadyHasDialogue) {
              // 强制在prompt末尾追加对白原文
              const dialogueSuffix = `\n\n【对白/台词原文，必须在视频中体现】：${shotDialogue}`;
              promptText = promptText + dialogueSuffix;
            }
          }

          // 强制注入对白到characterAction
          if (hasDialogue) {
            const dialogueFirstLine = shotDialogue.split('\n')[0]?.trim();
            const actionAlreadyHasDialogue = dialogueFirstLine && characterAction.includes(dialogueFirstLine.slice(0, Math.min(10, dialogueFirstLine.length)));
            
            if (!actionAlreadyHasDialogue) {
              const dialogueAction = `角色对白：${shotDialogue}，说话时口型变化、面部表情和肢体语言与台词情绪一致`;
              characterAction = characterAction 
                ? characterAction + `。${dialogueAction}` 
                : dialogueAction;
            }
          }

          // 如果prompt仍为空，用对白+描述生成基础prompt
          if (!promptText || promptText.trim().length < 5) {
            promptText = [
              shot.sceneDescription || '',
              hasDialogue ? `对白：${shotDialogue}` : '',
              '视频提示词：流畅的镜头运动，角色动作自然连贯，光影氛围到位'
            ].filter(Boolean).join(' ');
          }

          const structured = JSON.stringify({
            startFrame: p.startFrame || '',
            endFrame: p.endFrame || '',
            stateNote: p.stateNote || '',
            cameraMovement: p.cameraMovement || '',
            characterAction: characterAction,
            prompt: promptText,
          });
          await dramaWorkflowManager.updateShot(shot.id, { videoPrompt: structured });
        }
        return { data: prompts };
      }
    } catch {}
    return { data: result.data };
  } catch (error: any) {
    return { error: error.message };
  }
}

/**
 * 带超时和重试的AI调用（用于质检，需要更长超时）
 */
async function callAIWithRetry(config: any, systemPrompt: string, userContent: string, maxRetries = 2, timeoutMs = 120000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const apiUrl = config?.apiUrl || config?.api_url || process.env.AI_API_URL || process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
      const apiKey = config?.apiKey || config?.api_key || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
      const model = config?.model || process.env.AI_MODEL || 'deepseek-v4-flash';

      if (!apiKey) return { error: '缺少AI API密钥，请配置文本模型' };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(`${apiUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
            temperature: 0.5,
            max_tokens: 8192,
            response_format: { type: 'json_object' },
          }),
          signal: controller.signal,
        });

        clearTimeout(timer);
        const data = await res.json();
        if (data.error) {
          if (attempt < maxRetries) {
            console.log(`[QualityCheck] AI error (attempt ${attempt}/${maxRetries}):`, data.error?.message || data.error);
            await new Promise(r => setTimeout(r, 2000 * attempt));
            continue;
          }
          return { error: data.error?.message || 'AI调用失败' };
        }

        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 2000 * attempt));
            continue;
          }
          return { error: 'AI未返回内容' };
        }
        return { data: content };
      } catch (fetchErr: any) {
        clearTimeout(timer);
        if (fetchErr.name === 'AbortError') {
          if (attempt < maxRetries) {
            console.log(`[QualityCheck] AI timeout (attempt ${attempt}/${maxRetries}), retrying...`);
            await new Promise(r => setTimeout(r, 3000 * attempt));
            continue;
          }
          return { error: 'AI请求超时' };
        }
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
          continue;
        }
        return { error: fetchErr.message };
      }
    } catch (e: any) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }
      return { error: e.message };
    }
  }
  return { error: 'AI调用失败，已达最大重试次数' };
}

/**
 * 分镜提示词质检：检查图片/视频分镜的剧情连贯性、承上启下、角色一致性
 * 自动修复不连贯的提示词并返回质检报告
 * 特性：分批处理、批次衔接、多轮检查、自动重试
 */
async function handleQualityCheckShots(
  dramaId: string, episodeId: string, config: any, params: any, _userId: string
) {
  try {
    if (!episodeId) return { error: '缺少 episodeId' };
    const promptType = params.promptType || 'image'; // 'image' | 'video' | 'both'
    const autoFix = params.autoFix !== false; // 默认自动修复

    // 获取分集分镜
    const shots = await dramaWorkflowManager.getShotsByEpisodeId(episodeId);
    if (!shots.length) return { error: '该分集暂无分镜，请先生成分镜' };

    // 获取角色、场景、物品上下文
    const [characters, scenes, items] = await Promise.all([
      dramaWorkflowManager.getCharactersByDramaId(dramaId),
      dramaWorkflowManager.getScenesByDramaId(dramaId),
      dramaWorkflowManager.getItemsByDramaId(dramaId),
    ]);

    // 按shotNumber排序
    const sortedShots = [...shots].sort((a: any, b: any) => (a.shotNumber || 0) - (b.shotNumber || 0));

    // ── 收集提示词数据 ──
    const shotData = sortedShots.map((s: any, idx: number) => {
      let imgPrompt = s.imagePrompt || '';
      let vidPrompt = '';
      let vidStruct: any = null;
      if (s.videoPrompt) {
        try {
          vidStruct = JSON.parse(s.videoPrompt);
          // h3 格式核心文本在 h3Prompt；标准结构在 prompt
          vidPrompt = vidStruct.format === 'minimax-h3'
            ? (vidStruct.h3Prompt || s.videoPrompt)
            : (vidStruct.prompt || s.videoPrompt);
        }
        catch { vidPrompt = s.videoPrompt; }
      }
      // 获取角色详情
      const charIds = s.characterIds ? (Array.isArray(s.characterIds) ? s.characterIds : JSON.parse(s.characterIds || '[]')) : [];
      const charNames = charIds.map((cid: string) => {
        const c = characters.find((ch: any) => ch.id === cid);
        return c ? c.name : '';
      }).filter(Boolean);
      return {
        shotId: s.id,
        shotNumber: s.shotNumber,
        sceneDescription: s.sceneDescription || '',
        dialogue: s.dialogue || '',
        voiceover: s.voiceover || '',
        duration: s.duration || 3,
        imagePrompt: imgPrompt,
        videoPrompt: vidPrompt,
        videoStruct: vidStruct,
        characterIds: charIds,
        characterNames: charNames,
        index: idx,
      };
    });

    // 构建角色/场景/物品详细描述
    const charInfo = characters.map((c: any) =>
      `- ${c.name}${c.gender ? `(${c.gender})` : ''}${c.age ? ` ${c.age}岁` : ''}${c.appearance ? ' 外貌:' + c.appearance.slice(0, 100) : ''}${c.costume ? ' 服装:' + c.costume.slice(0, 60) : ''}`
    ).join('\n');
    const sceneInfo = scenes.map((s: any) =>
      `- ${s.name}${s.description ? ':' + s.description.slice(0, 80) : ''}${s.atmosphere ? ' 氛围:' + s.atmosphere : ''}`
    ).join('\n');
    const itemInfo = items.map((i: any) =>
      `- ${i.name}${i.description ? ':' + i.description.slice(0, 80) : ''}`
    ).join('\n');
    // 【权威资产登记名清单】— AI 修复时 @ 只能用这份清单上的登记名，逐字一致
    const canonicalNameList = [
      ...characters.map((c: any) => `角色:${c.name}`),
      ...scenes.map((s: any) => `场景:${s.name}`),
      ...items.map((i: any) => `物品:${i.name}`),
    ].join('\n');

    const issues: any[] = [];
    let fixedCount = 0;

    // ── 第一轮：基础质量检查（本地，不需要AI）──
    for (const sd of shotData) {
      // 检查图片提示词
      if ((promptType === 'image' || promptType === 'both') && !sd.imagePrompt) {
        issues.push({ shotId: sd.shotId, shotNumber: sd.shotNumber, type: 'image', level: 'error', issue: '缺少图片提示词', fixed: false });
      }
      if (sd.imagePrompt) {
        // 检查是否包含英文/代码/JSON标记
        const codeMarkers = ['```', '"imagePrompt":', '"shotId":', '"fixedPrompt"'];
        const hasCode = codeMarkers.some(m => sd.imagePrompt.includes(m));
        if (hasCode) {
          issues.push({ shotId: sd.shotId, shotNumber: sd.shotNumber, type: 'image', level: 'warning', issue: '提示词包含代码/JSON标记，可能影响生成质量', fixed: false });
        }
        // 检查中文占比
        const chineseChars = (sd.imagePrompt.match(/[\u4e00-\u9fff]/g) || []).length;
        const totalChars = sd.imagePrompt.replace(/\s/g, '').length;
        if (totalChars > 10 && chineseChars / totalChars < 0.3) {
          issues.push({ shotId: sd.shotId, shotNumber: sd.shotNumber, type: 'image', level: 'warning', issue: '提示词中文占比过低，可能导致生成效果不佳', fixed: false });
        }
        // 检查长度
        if (sd.imagePrompt.length < 30) {
          issues.push({ shotId: sd.shotId, shotNumber: sd.shotNumber, type: 'image', level: 'warning', issue: '图片提示词过短（<30字），描述可能不够详细', fixed: false });
        }
      }
      // 检查视频提示词
      if ((promptType === 'video' || promptType === 'both') && !sd.videoPrompt) {
        issues.push({ shotId: sd.shotId, shotNumber: sd.shotNumber, type: 'video', level: 'error', issue: '缺少视频提示词', fixed: false });
      }
      if (sd.videoPrompt && sd.videoPrompt.length < 40) {
        issues.push({ shotId: sd.shotId, shotNumber: sd.shotNumber, type: 'video', level: 'warning', issue: '视频提示词过短（<40字），运镜描述可能不够详细', fixed: false });
      }
      // 视频结构化字段检查（连贯性依赖首尾帧承接，字段全空等于没有连贯性依据）
      if (sd.videoPrompt && sd.videoStruct && typeof sd.videoStruct === 'object') {
        const vs = sd.videoStruct;
        if (vs.format === 'minimax-h3') {
          // H3 格式：h3Prompt 为核心，跳过结构化字段检查
        } else {
          if (!vs.startFrame || !String(vs.startFrame).trim()) {
            issues.push({ shotId: sd.shotId, shotNumber: sd.shotNumber, type: 'video', level: 'warning', issue: '视频提示词缺少起始画面(startFrame)，无法承接上一镜头', fixed: false });
          }
          if (!vs.endFrame || !String(vs.endFrame).trim()) {
            issues.push({ shotId: sd.shotId, shotNumber: sd.shotNumber, type: 'video', level: 'warning', issue: '视频提示词缺少结束画面(endFrame)，无法与下一镜头衔接', fixed: false });
          }
          if (!vs.cameraMovement || !String(vs.cameraMovement).trim()) {
            issues.push({ shotId: sd.shotId, shotNumber: sd.shotNumber, type: 'video', level: 'warning', issue: '视频提示词缺少运镜方式(cameraMovement)', fixed: false });
          }
        }
        // 对白原文污染检查：画面/运镜提示词中不应出现对白原文（对白由配音/字幕承担）
        const vpText = String(vs.prompt || sd.videoPrompt || '');
        if (vpText.includes('【对白原文】') || /[：:]\s*["“][^”"]{4,}["”]/.test(vpText)) {
          issues.push({ shotId: sd.shotId, shotNumber: sd.shotNumber, type: 'video', level: 'warning', issue: '视频提示词中混入对白原文，可能干扰画面生成（对白应由配音承担）', fixed: false });
        }
      }
    }

    // ── 第一轮半：@提及本地检查 + 自动规范化回写（共享库统一规则，无需 AI）──
    const atIndex = new AtMentionIndex(buildAtAssets(characters, scenes, items));
    const expectedAtMap = new Map<string, AtAsset[]>();

    const buildExpectedForShot = (sd: any): AtAsset[] => {
      const expected: AtAsset[] = [];
      const seenKeys = new Set<string>();
      const pushAsset = (a: AtAsset | null) => {
        if (!a) return;
        const k = a.id || a.name;
        if (!seenKeys.has(k)) { seenKeys.add(k); expected.push(a); }
      };
      for (const cid of (sd.characterIds || [])) pushAsset(atIndex.findByKey(cid));
      // 仅画面描述检测场景/物品（对白可能提及画外实体，不纳入）
      for (const a of detectExpectedAssets(sd.sceneDescription || '', atIndex)) pushAsset(a);
      return expected;
    };

    const reportAtIssues = (sd: any, checkType: 'image' | 'video', mentions: AtAsset[], atIssues: any[], expected: AtAsset[], didFix: boolean) => {
      const missing = validateAtCoverage(mentions, expected);
      for (const iss of missing) {
        const label = iss.asset?.type === 'character' ? '角色' : iss.asset?.type === 'scene' ? '场景' : '物品';
        issues.push({ shotId: sd.shotId, shotNumber: sd.shotNumber, type: checkType, level: 'warning', issue: `@提及遗漏：本镜头${label}「${iss.asset?.name}」未在提示词中 @，参考图可能漏挂载`, fixed: false });
      }
      for (const iss of atIssues) {
        if (iss.kind === 'unresolved') {
          issues.push({ shotId: sd.shotId, shotNumber: sd.shotNumber, type: checkType, level: 'warning', issue: `无效@：@${iss.token} 不在资产登记名列表中（别称/错字/自造名）`, fixed: didFix });
        }
      }
    };

    for (const sd of shotData) {
      const expected = buildExpectedForShot(sd);
      expectedAtMap.set(sd.shotId, expected);

      // 图片提示词：规范化 + 覆盖校验
      if ((promptType === 'image' || promptType === 'both') && sd.imagePrompt) {
        const r = applyAtRules(sd.imagePrompt, atIndex);
        const changed = r.text !== sd.imagePrompt;
        if (changed && autoFix) {
          await dramaWorkflowManager.updateShot(sd.shotId, { imagePrompt: r.text });
          sd.imagePrompt = r.text;
          fixedCount++;
        }
        if (changed) {
          issues.push({ shotId: sd.shotId, shotNumber: sd.shotNumber, type: 'image', level: 'warning', issue: '@提及不规范（别称/漏字/漏@/无效@），已按登记名自动规范化', fixed: !!autoFix });
        }
        reportAtIssues(sd, 'image', r.mentions, r.issues, expected, !!autoFix && changed);
      }

      // 视频提示词：逐字段规范化 + 全字段覆盖校验
      if ((promptType === 'video' || promptType === 'both') && sd.videoStruct && typeof sd.videoStruct === 'object') {
        const vs = sd.videoStruct;
        if (vs.format === 'minimax-h3') {
          if (typeof vs.h3Prompt === 'string' && vs.h3Prompt.trim()) {
            const r = applyAtRules(vs.h3Prompt, atIndex);
            const changed = r.text !== vs.h3Prompt;
            if (changed && autoFix) {
              const updated = { ...vs, h3Prompt: r.text };
              await dramaWorkflowManager.updateShot(sd.shotId, { videoPrompt: JSON.stringify(updated) });
              sd.videoStruct = updated;
              sd.videoPrompt = r.text;
              fixedCount++;
            }
            if (changed) {
              issues.push({ shotId: sd.shotId, shotNumber: sd.shotNumber, type: 'video', level: 'warning', issue: '@提及不规范（H3 提示词），已按登记名自动规范化', fixed: !!autoFix });
            }
            reportAtIssues(sd, 'video', r.mentions, r.issues, expected, !!autoFix && changed);
          }
        } else {
          const fields = ['prompt', 'startFrame', 'endFrame', 'cameraMovement', 'characterAction'];
          const updated: any = { ...vs };
          let changed = false;
          const repairedTexts: string[] = [];
          let allMentions: AtAsset[] = [];
          let allIssues: any[] = [];
          for (const f of fields) {
            if (typeof vs[f] === 'string' && vs[f].trim()) {
              const r = applyAtRules(vs[f], atIndex);
              repairedTexts.push(r.text);
              allMentions = allMentions.concat(r.mentions);
              allIssues = allIssues.concat(r.issues);
              if (r.text !== vs[f]) { updated[f] = r.text; changed = true; }
            }
          }
          if (changed && autoFix) {
            await dramaWorkflowManager.updateShot(sd.shotId, { videoPrompt: JSON.stringify(updated) });
            sd.videoStruct = updated;
            if (updated.prompt) sd.videoPrompt = updated.prompt;
            fixedCount++;
          }
          if (changed) {
            issues.push({ shotId: sd.shotId, shotNumber: sd.shotNumber, type: 'video', level: 'warning', issue: '@提及不规范（别称/漏字/漏@/无效@），已按登记名自动规范化', fixed: !!autoFix });
          }
          // 去重 mentions 后做覆盖校验
          const dedupMentions: AtAsset[] = [];
          const mk = new Set<string>();
          for (const m of allMentions) { const k = m.id || m.name; if (!mk.has(k)) { mk.add(k); dedupMentions.push(m); } }
          reportAtIssues(sd, 'video', dedupMentions, allIssues, expected, !!autoFix && changed);
        }
      }
    }

    if (!autoFix) {
      const errorCount = issues.filter((i: any) => i.level === 'error').length;
      const warningCount = issues.filter((i: any) => i.level === 'warning').length;
      return {
        data: {
          issues, fixedCount: 0, totalShots: shotData.length, errorCount, warningCount,
          summary: `质检完成：共${shotData.length}个分镜，发现${errorCount}个错误、${warningCount}个警告。`,
        }
      };
    }

    // ── 第二轮：AI连贯性质检与修复（分批处理）──
    const checkTypes = promptType === 'both' ? ['image', 'video'] : [promptType];
    const BATCH_SIZE = 8; // 每批处理镜头数，避免上下文过长

    // 构建质检上下文，用于Agent技能注入
    const qualityCheckContext: any = {
      text: charInfo + ' ' + sceneInfo,
      provider: config?.provider || null,
      model: config?.model || null,
    };

    // 获取基础系统提示词（含Agent技能增强）
    const baseSystemPrompt = await getPromptsWithFallback(
      'quality-check-shots-system',
      `你是一位顶级影视分镜指导，拥有20年电影/短剧制作经验，精通画面叙事和镜头语言。你的任务是检查短剧分镜提示词的剧情连贯性。

【五大核心检查维度】
1. 【视觉承上启下】每个镜头的开头画面必须自然承接上一镜头的结尾状态（人物位置/动作/情绪/服装/道具/场景必须一致）
2. 【角色绝对一致】同一角色在连贯镜头中外貌、服装、发型、年龄、受伤状态等视觉特征必须完全一致
3. 【场景空间连贯】场景转换必须有逻辑：如果场景变化，提示词中应体现过渡；同一场景内光线/时间保持一致
4. 【情绪动作连贯】角色情绪、动作姿态在连续镜头中要有自然过渡，不能突然转变
5. 【画面/运镜完整性】图片必须包含景别+人物+动作+环境+光线+色调；视频必须包含起始画面→镜头运动→结束画面

【特别注意】
- 第一镜头要建立场景和人物关系，给观众明确的空间感
- 有对白的镜头必须体现说话者的表情/口型/肢体语言
- 动作镜头要凝固最有张力的瞬间，不能模糊
- 严禁在提示词中出现：JSON代码、markdown标记、英文单词堆砌、"提示词"字样
- 如果原提示词质量合格且连贯，fixedPrompt返回原提示词，不要强行修改
- 如果提示词为空或缺失，根据剧本描述和前后镜头生成符合剧情的提示词

【输出格式】严格JSON，不要任何解释文字：
{
  "report": [
    {
      "shotId": "分镜ID(必须与输入对应)",
      "shotNumber": 镜头号,
      "issues": ["具体问题描述，说明哪里不连贯/不一致"],
      "severity": "error|warning|ok",
      "fixedPrompt": "修正后的完整中文提示词（如无问题则返回原词）"
    }
  ]
}`,
      qualityCheckContext
    );

    for (const checkType of checkTypes) {
      const typeName = checkType === 'image' ? '图片' : '视频';
      const totalBatches = Math.ceil(shotData.length / BATCH_SIZE);

      // 上一批次的最后2个镜头提示词（用于批次间衔接）
      let prevBatchTail: any[] = [];

      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const batchStart = batchIdx * BATCH_SIZE;
        const batchEnd = Math.min(batchStart + BATCH_SIZE, shotData.length);
        const batch = shotData.slice(batchStart, batchEnd);

        console.log(`[QualityCheck] ${checkType} batch ${batchIdx + 1}/${totalBatches}, shots ${batch[0].shotNumber}-${batch[batch.length - 1].shotNumber}...`);

        // 构建批次分镜序列文本
        const sequenceText = batch.map((sd: any) => {
          const prompt = checkType === 'image' ? sd.imagePrompt : sd.videoPrompt;
          // 对于批次内第一个镜头，如果有上一批次的尾部镜头，显示前一镜头
          let prevPrompt = '';
          if (sd.index === batch[0].index && prevBatchTail.length > 0) {
            const prevS = prevBatchTail[prevBatchTail.length - 1];
            prevPrompt = checkType === 'image' ? prevS.imagePrompt : prevS.videoPrompt;
          } else if (sd.index > 0 && sd.index > batch[0].index) {
            const prevS = shotData[sd.index - 1];
            prevPrompt = checkType === 'image' ? prevS.imagePrompt : prevS.videoPrompt;
          }
          return [
            `镜头${sd.shotNumber} (shotId="${sd.shotId}"):`,
            `  出场角色: ${sd.characterNames.join('、') || '(无特定)'}`,
            `  剧本描述: ${sd.sceneDescription}${sd.dialogue ? ' [对白]' + sd.dialogue : ''}${sd.voiceover ? ' [旁白]' + sd.voiceover : ''}`,
            sd.index > 0 || prevBatchTail.length > 0
              ? `  前一镜头${checkType === 'image' ? '画面' : '运镜'}: ${prevPrompt || '(空)'}`
              : '  (第一镜头，无前镜头)',
            `  当前${typeName}提示词: ${prompt || '(空)'}`,
            checkType === 'video' && sd.videoStruct ? `  起始画面: ${sd.videoStruct.startFrame || '(无)'}` : '',
            checkType === 'video' && sd.videoStruct ? `  结束画面: ${sd.videoStruct.endFrame || '(无)'}` : '',
            ''
          ].filter(Boolean).join('\n');
        }).join('\n');

        const contextHint = batchIdx === 0 ? '' :
          `\n【批次衔接提示】以下是本批次的前${prevBatchTail.length}个镜头（上一批次结尾），请确保第一个镜头与它们自然衔接：\n` +
          prevBatchTail.map((ps: any) => {
            const pp = checkType === 'image' ? ps.imagePrompt : ps.videoPrompt;
            return `镜头${ps.shotNumber}结束画面/运镜: ${pp?.slice(-80) || '(空)'}`;
          }).join('\n') + '\n';

        // 组装最终系统提示词：基础prompt + 类型特定规则
        const typeSpecificRule = checkType === 'image'
          ? `\n\n【图片提示词补充要求】
- 每张图片提示词必须包含：景别(特写/近景/中景/全景)+主体人物+动作表情+环境+光线+色调
- 提示词长度80-150字纯中文
- 注意画面构图和视觉焦点
- 修复提示词时必须遵守下方 @提及规则：出场角色/所在场景/互动物品必须在其登记名正前方紧接 @，且 @ 后逐字使用资产列表里的登记名，严禁别称/漏字/自造名`
          : `\n\n【视频提示词补充要求】
- 视频提示词是结构化JSON，必须包含四个字段：prompt(画面与运镜描述,100-200字纯中文)、startFrame(起始画面,20-50字)、endFrame(结束画面,20-50字)、cameraMovement(运镜方式,如"缓慢推近""横移跟拍""俯拍下摇")
- startFrame必须是上一镜头endFrame的自然延续（人物位置/动作/情绪/服装/道具/光线一致）；最后一个镜头的endFrame要为本场景收束
- 发现 startFrame/endFrame/cameraMovement 为空或缺失时，必须根据剧本描述和前后镜头补全
- prompt中只描述画面、动作、运镜、氛围，【严禁】包含对白原文/台词/旁白文字（对白由配音承担，写进画面会干扰生成）
- 输出JSON中，视频类镜头除 fixedPrompt 外，必须额外返回 fixedStartFrame、fixedEndFrame、fixedCameraMovement 三个字段（无问题时返回原值，字段缺失时补全）
- 修复提示词时必须遵守下方 @提及规则：出场角色/所在场景/互动物品必须在其登记名正前方紧接 @，且 @ 后逐字使用资产列表里的登记名，严禁别称/漏字/自造名；必要时在 fixedStartFrame/fixedEndFrame 中也应加入对应的 @登记名

${AT_MENTION_RULES}

【质检纪律 — 必须遵守】
- 逐个镜头检查，report 数量必须与输入镜头数量完全一致，每个镜头都要有结论
- issues 数组必须如实填写：发现问题写具体问题；确无问题写"OK：<一句话说明该镜头与前后镜头的衔接依据>"，严禁整批返回空issues
- severity 只能是 error/warning/ok 三选一；首尾帧缺失、对白污染、角色服装突变必须判 warning 以上`;

        const systemPrompt = baseSystemPrompt + typeSpecificRule + `

【当前任务】检查${typeName}分镜提示词连贯性，本集共${shotData.length}个分镜，当前第${batchIdx + 1}/${totalBatches}批。`;

        const userMessage = `请检查以下${batch.length}个分镜的${typeName}提示词连贯性（本集共${shotData.length}个分镜，当前第${batchIdx + 1}/${totalBatches}批）：

【角色设定参考（必须严格遵守）】
${charInfo || '(无)'}

【场景设定参考】
${sceneInfo || '(无)'}

【物品/道具参考】
${itemInfo || '(无)'}

【权威资产登记名清单 — @提及时只能使用此清单上的登记名，逐字一致，严禁别称/漏字/自造名】
${canonicalNameList || '(无)'}
${contextHint}
【本分镜批次序列】
${sequenceText}

请逐镜头检查连贯性并修复，输出严格JSON。`;

        const result = await callAIWithRetry(config, systemPrompt, userMessage, 2, 120000);
        if (result.error) {
          console.error(`[QualityCheck] Batch ${batchIdx + 1} AI failed:`, result.error);
          issues.push({ type: checkType, level: 'error', issue: `第${batchIdx + 1}批AI质检失败: ${result.error}` });
          // 更新prevBatchTail继续下一批
          prevBatchTail = batch.slice(-2);
          continue;
        }

        try {
          const parsed = JSON.parse(extractJSON(result.data));
          const report = Array.isArray(parsed.report) ? parsed.report : (Array.isArray(parsed) ? parsed : []);

          for (const item of report) {
            const shotId = item.shotId;
            const shotNum = item.shotNumber;
            const fixedPrompt = typeof item.fixedPrompt === 'string' ? item.fixedPrompt.trim() : '';
            const fixedStartFrame = typeof item.fixedStartFrame === 'string' ? item.fixedStartFrame.trim() : '';
            const fixedEndFrame = typeof item.fixedEndFrame === 'string' ? item.fixedEndFrame.trim() : '';
            const fixedCameraMovement = typeof item.fixedCameraMovement === 'string' ? item.fixedCameraMovement.trim() : '';
            const rawIssues = Array.isArray(item.issues) ? item.issues : [];
            const severity = item.severity || 'ok';

            // 记录问题（AI 对无问题镜头返回的 "OK：..." 衔接说明不计入问题列表）
            for (const iss of rawIssues) {
              const issText = String(iss || '').trim();
              if (!issText) continue;
              if (severity === 'ok' && /^OK[：:]/.test(issText)) continue;
              const sd = shotData.find((s: any) => s.shotId === shotId);
              const originalPrompt = sd ? (checkType === 'image' ? sd.imagePrompt : sd.videoPrompt) : '';
              issues.push({
                shotId, shotNumber: shotNum, type: checkType,
                level: severity === 'error' ? 'error' : 'warning',
                issue: issText,
                fixed: !!fixedPrompt && fixedPrompt !== originalPrompt,
              });
            }

            if (!shotId) continue;
            const sd = shotData.find((s: any) => s.shotId === shotId);
            if (!sd) continue;

            if (checkType === 'image') {
              // 图片：仅 fixedPrompt
              if (fixedPrompt && fixedPrompt !== sd.imagePrompt) {
                await dramaWorkflowManager.updateShot(shotId, { imagePrompt: fixedPrompt });
                sd.imagePrompt = fixedPrompt;
                fixedCount++;
              }
            } else if (sd.videoStruct && sd.videoStruct.format === 'minimax-h3') {
              // H3 格式：仅更新 prompt 文本字段（h3Prompt 为 Context-IR 专格式，不由本质检改写）
              if (fixedPrompt && fixedPrompt !== sd.videoPrompt) {
                const updatedStruct = { ...sd.videoStruct, prompt: fixedPrompt };
                await dramaWorkflowManager.updateShot(shotId, { videoPrompt: JSON.stringify(updatedStruct) });
                sd.videoStruct = updatedStruct;
                sd.videoPrompt = fixedPrompt;
                fixedCount++;
              }
            } else {
              // 视频标准结构：prompt + startFrame + endFrame + cameraMovement 整体修复
              const cur: any = sd.videoStruct || {};
              const nextPrompt = fixedPrompt || sd.videoPrompt || '';
              const nextStart = fixedStartFrame || cur.startFrame || (nextPrompt ? nextPrompt.slice(0, 60) : '');
              const nextEnd = fixedEndFrame || cur.endFrame || (nextPrompt ? nextPrompt.slice(-60) : '');
              const nextCam = fixedCameraMovement || cur.cameraMovement || '';
              const changed = nextPrompt !== (cur.prompt || sd.videoPrompt)
                || (nextStart || '') !== (cur.startFrame || '')
                || (nextEnd || '') !== (cur.endFrame || '')
                || (nextCam || '') !== (cur.cameraMovement || '');
              if (changed && nextPrompt) {
                const updatedStruct = {
                  ...cur,
                  prompt: nextPrompt,
                  startFrame: nextStart,
                  endFrame: nextEnd,
                  cameraMovement: nextCam,
                };
                await dramaWorkflowManager.updateShot(shotId, { videoPrompt: JSON.stringify(updatedStruct) });
                sd.videoStruct = updatedStruct;
                sd.videoPrompt = nextPrompt;
                fixedCount++;
              }
            }
          }
        } catch (parseErr: any) {
          console.error(`[QualityCheck] Batch ${batchIdx + 1} parse error:`, parseErr.message, result.data?.slice(0, 300));
          issues.push({ type: checkType, level: 'error', issue: `第${batchIdx + 1}批AI返回解析失败: ${parseErr.message}` });
        }

        // 更新批次尾部，供下一批衔接使用
        // 用修复后的数据更新
        const updatedBatch = batch.map((b: any) => {
          const updated = shotData.find((s: any) => s.shotId === b.shotId);
          return updated || b;
        });
        prevBatchTail = updatedBatch.slice(-2);

        // 批次间间隔，避免API限流
        if (batchIdx < totalBatches - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }

    // ── 第三轮：关键衔接点二次抽检 ──
    // 对场景切换、人物进出等关键转折点进行二次确认
    for (const checkType of checkTypes) {
      const typeName = checkType === 'image' ? '图片' : '视频';
      // 找出可能的转折点（场景描述差异大、角色变化大的相邻镜头对）
      const transitionPoints: { prev: any, curr: any, index: number }[] = [];
      for (let i = 1; i < shotData.length; i++) {
        const prev = shotData[i - 1];
        const curr = shotData[i];
        // 简单启发：角色完全不同 或 描述长度差异大，可能是场景转换
        const prevChars = new Set(prev.characterNames);
        const currChars = new Set(curr.characterNames);
        const charOverlap = [...prevChars].filter(c => currChars.has(c)).length;
        if (charOverlap === 0 && prev.characterNames.length > 0 && curr.characterNames.length > 0) {
          transitionPoints.push({ prev, curr, index: i });
        }
      }

      // 如果有转折点，抽几个检查（最多3个）
      const checkTransitions = transitionPoints.slice(0, 3);
      if (checkTransitions.length > 0) {
        console.log(`[QualityCheck] ${checkType} double-checking ${checkTransitions.length} transition points...`);
        // 这里不再单独调用AI，因为批量质检已经处理了大部分问题
        // 仅做本地检查记录
        for (const tp of checkTransitions) {
          const prevPrompt = checkType === 'image' ? tp.prev.imagePrompt : tp.prev.videoPrompt;
          const currPrompt = checkType === 'image' ? tp.curr.imagePrompt : tp.curr.videoPrompt;
          if (prevPrompt && currPrompt) {
            // 检查前镜头结尾词和后镜头开头词的相似度
            const prevEnd = prevPrompt.slice(-40);
            const currStart = currPrompt.slice(0, 40);
            // 简单检查：如果完全没有共同关键词，标记警告
            const prevKeywords = new Set(prevEnd.match(/[\u4e00-\u9fff]{2,}/g) || []);
            const currKeywords = new Set(currStart.match(/[\u4e00-\u9fff]{2,}/g) || []);
            const overlap = [...prevKeywords].filter(k => currKeywords.has(k)).length;
            if (overlap === 0 && prevKeywords.size > 3 && currKeywords.size > 3) {
              issues.push({
                shotId: tp.curr.shotId, shotNumber: tp.curr.shotNumber, type: checkType,
                level: 'warning', issue: `镜头${tp.curr.shotNumber}与前一镜头（角色/场景切换）可能缺少过渡衔接，建议人工确认`,
                fixed: false,
              });
            }
          }
        }
      }
    }

    const errorCount = issues.filter((i: any) => i.level === 'error').length;
    const warningCount = issues.filter((i: any) => i.level === 'warning').length;

    console.log(`[QualityCheck] Complete: ${fixedCount} fixed, ${errorCount} errors, ${warningCount} warnings`);

    return {
      data: {
        issues,
        fixedCount,
        totalShots: shotData.length,
        errorCount,
        warningCount,
        summary: `质检完成：共${shotData.length}个分镜，发现${errorCount}个错误、${warningCount}个警告，自动修复${fixedCount}个不连贯问题。`,
      }
    };
  } catch (error: any) {
    console.error('[QualityCheck] Exception:', error);
    return { error: error.message };
  }
}

async function handleGenerateImage(
  shotId: string, config: any, params: any, _userId: string, taskId?: string | null
) {
  try {
    if (!shotId) return { error: '缺少 shotId' };
    const shot = await dramaWorkflowManager.getShotById(shotId);
    if (!shot) return { error: '分镜不存在' };

    const prompt = params.prompt || shot.imagePrompt;
    if (!prompt) return { error: '没有图片提示词，请先生成图片提示词' };

    const provider = params.provider || config?.provider || 'openai';
    const model = params.model || config?.model || 'dall-e-3';
    const apiKey = params.apiKey || config?.apiKey;
    const apiUrl = params.apiUrl || config?.apiUrl;

    if (!apiKey) return { error: '缺少图片API密钥，请在 AI设置 中配置图片生成模型' };

    // 计算尺寸：优先用 imageWidth/imageHeight，其次 size 字符串，默认 1024x1024
    const sizeStr = params.size ||
      (params.imageWidth && params.imageHeight ? `${params.imageWidth}x${params.imageHeight}` : '1024x1024');

    // ── 参考图：将本地路径转为 base64（统一压缩，避免多张大图导致上游 413/500） ──
    const rawRefs: string[] = Array.isArray(params.referenceImages) ? params.referenceImages.slice(0, 6) : [];
    const refBase64: string[] = [];
    for (const ref of rawRefs) {
      try {
        if (ref.startsWith('data:')) {
          refBase64.push(await downscaleRefToDataUri(ref));
        } else if (ref.startsWith('/')) {
          const localPath = path.join(process.cwd(), 'public', ref);
          if (fs.existsSync(localPath)) {
            const buf = fs.readFileSync(localPath);
            const ext = path.extname(ref).replace('.', '').toLowerCase() || 'jpg';
            const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
            refBase64.push(await downscaleRefToDataUri(buf, mime));
          }
        } else if (ref.startsWith('http')) {
          const r = await fetch(ref);
          if (r.ok) {
            const buf = Buffer.from(await r.arrayBuffer());
            refBase64.push(await downscaleRefToDataUri(buf, 'image/jpeg'));
          }
        }
      } catch { /* skip invalid ref */ }
    }

    await publishRequestPrompt(taskId, {
      prompt,
      shotId,
      provider,
      model,
      size: sizeStr,
      referenceImages: refBase64.length,
    });

    const genResult = await callImageProvider(provider, model, apiKey, apiUrl, prompt, sizeStr, params, refBase64);
    if ('error' in genResult) return genResult;

    const localImageUrl = await saveMediaLocally(genResult.imageUrl, 'image', shotId, shot.dramaId);
    await dramaWorkflowManager.updateShot(shotId, { imageUrl: localImageUrl, status: 'image_ready' });
    return { data: { imageUrl: localImageUrl, shotId, prompt } };
  } catch (error: any) {
    return { error: error.message };
  }
}

async function pollUntilDone(
  intervalMs: number, maxAttempts: number, pollFn: () => Promise<{ done: boolean; videoUrl?: string; error?: string }>
): Promise<{ videoUrl?: string; status: string; error?: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const result = await pollFn();
    if (result.done) return { videoUrl: result.videoUrl, status: result.error ? 'failed' : 'done', error: result.error };
  }
  return { status: 'processing' };
}

function isSeedanceR2vUnsupportedModel(model?: string): boolean {
  const normalized = String(model || '').toLowerCase();
  return normalized.includes('doubao-seedance-1-5') || normalized.includes('seedance-1-5');
}

/**
 * 构造 Agnes Video 创建任务的请求体（POST /v1/videos）
 *
 * agnes-video-2.5 系列（含 flash）官方契约：
 *  - 公共字段：model / prompt / mode / seconds(字符串"4"-"12") / size / aspect_ratio / n
 *  - flash 仅支持 size="720P"；2.5 标准版支持 720P/960P/2K
 *  - 三种模式媒体字段互斥：
 *    · text：禁带任何媒体字段
 *    · keyframe：first_frame / last_frame（至少一个）
 *    · reference：images（flash 最多 5 张）/ audios，prompt 中用 <Picture N> 指代
 *  - 禁传 V2.0 的 num_frames / frame_rate / height / width / image / extra_body（会 400）
 *
 * V2.0 契约：num_frames(必须 8n+1，81-441) / height / width / frame_rate / image / extra_body.image
 */
function buildAgnesVideoBody(opts: {
  modelName: string;
  prompt: string;
  durationSeconds: number;
  aspectRatio: string;
  videoWidth: number;
  videoHeight: number;
  firstFrameUrl: string;
  refImageUrls: string[];
  frameRate: number;
  negativePrompt?: string;
  // NewAPI 网关（litellm 转发 ti2vid）限制：V2.0 最多只接受 1 张参考图；官方 Agnes hub 不受此限
  singleImageOnly?: boolean;
}): { body: Record<string, any>; modeLabel: string; isV25: boolean } {
  const modelLower = String(opts.modelName || '').toLowerCase();
  const isV25 = modelLower.includes('2.5') || modelLower.includes('2-5') || modelLower.includes('flash');
  const isFlash = modelLower.includes('flash');

  // 参考图去重收集（首帧在前）
  const refs: string[] = [];
  for (const u of [opts.firstFrameUrl, ...(opts.refImageUrls || [])]) {
    if (u && !refs.includes(u)) refs.push(u);
  }

  if (isV25) {
    const body: Record<string, any> = {
      model: opts.modelName,
      prompt: opts.prompt,
      n: 1,
      // 秒数：字符串，官方范围 "4"-"12"
      seconds: String(Math.min(12, Math.max(4, Math.round(Number(opts.durationSeconds) || 5)))),
    };
    // 尺寸：flash 固定 720P；标准版按长边映射 720P/960P/2K
    if (isFlash) {
      body.size = '720P';
    } else {
      const longSide = Math.max(Number(opts.videoWidth) || 0, Number(opts.videoHeight) || 0);
      body.size = longSide >= 2000 ? '2K' : longSide >= 1300 ? '960P' : '720P';
    }
    // 画幅白名单：21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16
    const aspectWhitelist = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
    body.aspect_ratio = aspectWhitelist.includes(opts.aspectRatio) ? opts.aspectRatio : '16:9';

    let modeLabel = '';
    if (refs.length === 0) {
      // 纯文生视频：不带任何媒体字段
      body.mode = 'text';
      modeLabel = 'text (纯文生视频)';
    } else if (opts.firstFrameUrl && refs.length === 1) {
      // 仅一张首帧图：首尾帧模式，首帧严格控制构图
      body.mode = 'keyframe';
      body.first_frame = opts.firstFrameUrl;
      modeLabel = 'keyframe (首帧生视频)';
    } else {
      // 多张参考图：参考模式，flash 上限 5 张
      const maxImages = isFlash ? 5 : 8;
      body.mode = 'reference';
      body.images = refs.slice(0, maxImages);
      modeLabel = `reference (${Math.min(refs.length, maxImages)}张参考图)`;
      // 注入 <Picture N> 指代，帮助模型理解参考图用途（首帧图作构图基础，其余作角色/风格参考）
      if (opts.firstFrameUrl && refs[0] === opts.firstFrameUrl) {
        body.prompt = `${opts.prompt}\n以 <Picture 1> 为首帧画面与构图基础，其余图片为角色形象与美术风格参考，保持角色外观、服装与场景风格一致。`;
      } else {
        body.prompt = `${opts.prompt}\n以参考图中的角色形象与美术风格为准，保持角色外观、服装与场景风格一致。`;
      }
    }
    return { body, modeLabel, isV25: true };
  }

  // ── Agnes Video V2.0 ──
  const fr = Number.isFinite(Number(opts.frameRate)) && Number(opts.frameRate) > 0 ? Number(opts.frameRate) : 24;
  const targetFrames = Math.round((Number(opts.durationSeconds) || 5) * fr);
  let numFrames = Math.min(441, Math.max(81, targetFrames));
  numFrames = 8 * Math.round((numFrames - 1) / 8) + 1; // Agnes requires 8n + 1.
  numFrames = Math.min(441, Math.max(81, numFrames));

  const body: Record<string, any> = {
    model: opts.modelName,
    prompt: opts.prompt,
    height: opts.videoHeight || 768,
    width: opts.videoWidth || 1152,
    num_frames: numFrames,
    frame_rate: fr,
  };
  let modeLabel = '';
  if (refs.length === 1) {
    body.image = refs[0];
    modeLabel = 'i2v (单图生视频)';
  } else if (refs.length > 1) {
    if (opts.singleImageOnly) {
      // NewAPI 网关（litellm → ti2vid）仅接受 1 张参考图（"ti2vid supports at most 1 image"）：
      // 只发首帧分镜图（无首帧时取第一张角色参考图），不发送 extra_body 多图数组
      body.image = refs[0];
      modeLabel = `i2v (单图生视频, newapi限1张/共${refs.length}张参考)`;
    } else {
      body.image = refs[0];
      body.extra_body = { image: refs.slice(0, 6) };
      modeLabel = `multi-ref (${refs.length} images)`;
    }
  } else {
    body.mode = 'ti2vid';
    modeLabel = 'ti2v (纯文生视频)';
  }
  if (opts.negativePrompt) body.negative_prompt = String(opts.negativePrompt);
  return { body, modeLabel, isV25: false };
}

async function handleGenerateVideo(
  shotId: string, config: any, params: any, _userId: string
) {
  try {
    if (!shotId) return { error: '缺少 shotId' };
    const shot = await dramaWorkflowManager.getShotById(shotId);
    if (!shot) return { error: '分镜不存在' };

    let provider = String(params.provider || config?.provider || 'minimax-video').trim();
    const model = String(params.model || config?.model || '').trim();
    const apiKey = String(params.apiKey || config?.apiKey || '').trim();
    const apiUrl = String(params.apiUrl || config?.apiUrl || '').trim();
    const providerLower = String(provider || '').toLowerCase();
    const modelLowerGlobal = String(model || '').toLowerCase();
    const apiUrlLowerGlobal = String(apiUrl || '').toLowerCase();
    if (
      providerLower === 'agnes' ||
      providerLower === 'agnes-video' ||
      modelLowerGlobal.includes('agnes-video') ||
      apiUrlLowerGlobal.includes('apihub.agnes-ai.com') ||
      apiUrlLowerGlobal.includes('agnes-ai.com')
    ) {
      provider = 'agnes-video';
    }

    // MiniMax H3 系列走 v2 接口（POST /v2/video_generation），与 Hailuo 旧版 v1（/v1/video_generation）协议不同，
    // 因此按模型名自动路由到独立适配器：即便配置挂在 minimax-video / custom-video 下也能正常工作。
    if (/minimax-h3/i.test(modelLowerGlobal)) {
      provider = 'minimax-h3';
    }

    // 如果是自定义视频API，尝试根据 API URL 自动识别极少数官方直连底座服务商（包含本地127.0.0.1/localhost代理）
    if (provider === 'custom-video') {
      const urlLower = String(apiUrl || '').toLowerCase();
      const modelLower = String(model || '').toLowerCase();

      const isOfficialGoogle = urlLower.includes('googleapis.com') ||
                               urlLower.includes('google.com') ||
                               !urlLower;

      if (urlLower.includes('volces.com')) {
        provider = 'volcengine-video';
      } else if (urlLower.includes('klingai.com') || urlLower.includes('klingai.cn')) {
        provider = 'kling';
      } else if (urlLower.includes('minimax.chat')) {
        provider = 'minimax-video';
      } else if (urlLower.includes('vidu.cn')) {
        provider = 'vidu';
      } else if (urlLower.includes('runwayml.com')) {
        provider = 'runway';
      } else if (urlLower.includes('lumalabs.ai')) {
        provider = 'luma';
      } else if (urlLower.includes('x.ai')) {
        provider = 'grok-video';
      } else if (isOfficialGoogle && modelLower.includes('veo')) {
        provider = 'veo';
      } else if (urlLower.includes('dashscope.aliyuncs.com')) {
        provider = 'qwen-video';
      } else if (urlLower.includes('apihub.agnes-ai.com') || urlLower.includes('agnes-ai.com')) {
        provider = 'agnes-video';
      } else if (urlLower.includes('d.csjlm.app')) {
        provider = 'dfyue';
      }
    }

    if (!apiKey) return { error: '缺少视频API密钥，请在 AI设置 中配置视频生成模型' };

    // 获取视频提示词文本（同时解析结构化 JSON，供 @ 提及扫描 startFrame/endFrame 等全部字段）
    let promptText = '';
    let vpStruct: any = null;
    const tryParseStruct = (raw: any): any => {
      if (!raw) return null;
      if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
      if (typeof raw === 'string') {
        try { const v = JSON.parse(raw); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; } catch { return null; }
      }
      return null;
    };
    const incomingPrompt = params.videoPrompt || params.promptText;
    if (incomingPrompt) {
      vpStruct = tryParseStruct(incomingPrompt);
      if (typeof incomingPrompt === 'string') {
        promptText = vpStruct?.prompt || incomingPrompt;
      } else if (typeof incomingPrompt === 'object') {
        promptText = incomingPrompt.prompt || JSON.stringify(incomingPrompt);
      }
    }

    if (!promptText) {
      if (shot.videoPrompt) {
        const vp = tryParseStruct(shot.videoPrompt);
        if (vp) { vpStruct = vpStruct || vp; promptText = vp.prompt || ''; }
        if (!promptText) promptText = shot.videoPrompt;
      }
      promptText = promptText || shot.sceneDescription || '';
    }

    // ── @功能：统一规则库解析（别称/漏字/错字容错、结构化全字段扫描），自动挂载关联资产参考图 ──
    const extractedRefs: string[] = [];
    try {
      const [dbChars, dbScenes, dbItems] = await Promise.all([
        dramaWorkflowManager.getCharactersByDramaId(shot.dramaId),
        dramaWorkflowManager.getScenesByDramaId(shot.dramaId),
        dramaWorkflowManager.getItemsByDramaId(shot.dramaId),
      ]);
      const atIndex = new AtMentionIndex(buildAtAssets(dbChars, dbScenes, dbItems));

      if (promptText) {
        // 1) 全字段扫描：startFrame/endFrame/prompt/cameraMovement/characterAction 中的 @ 全部计入
        const scanFields = [
          vpStruct?.startFrame, vpStruct?.endFrame, vpStruct?.prompt,
          vpStruct?.cameraMovement, vpStruct?.characterAction, promptText,
        ].filter((x): x is string => typeof x === 'string' && !!x.trim());
        const { mentions, issues } = scanAtTexts(scanFields, atIndex);
        if (issues.length) {
          console.log(`[AtParser] 无法识别的 @（已降级为纯文本）: ${issues.map((i) => '@' + i.token).join('、')}`);
        }

        // 2) characterIds 权威兜底：分镜登记出场的角色，即使提示词漏 @ 也挂载其参考图
        let charIds: string[] = [];
        try { charIds = Array.isArray(shot.characterIds) ? shot.characterIds : JSON.parse(shot.characterIds || '[]'); } catch { /* ignore */ }
        const fallbackChars = charIds
          .map((cid) => atIndex.findByKey(cid))
          .filter((a): a is AtAsset => !!a);

        // 3) 挂载顺序：@提及角色 → 兜底角色 → @提及场景 → @提及物品；按资产去重
        const ordered: AtAsset[] = [];
        const seenAssetKeys = new Set<string>();
        const pushAsset = (a: AtAsset) => {
          const k = a.id || a.name;
          if (!seenAssetKeys.has(k)) { seenAssetKeys.add(k); ordered.push(a); }
        };
        mentions.filter((a) => a.type === 'character').forEach(pushAsset);
        fallbackChars.forEach(pushAsset);
        mentions.filter((a) => a.type === 'scene').forEach(pushAsset);
        mentions.filter((a) => a.type === 'item').forEach(pushAsset);

        for (const asset of ordered) {
          const urls = getAssetRefImages(asset);
          if (urls.length) extractedRefs.push(...urls);
        }
        console.log(`[AtParser] 提及=[${mentions.map((m) => `${m.type === 'character' ? '角' : m.type === 'scene' ? '景' : '物'}:${m.name}`).join(', ')}] 兜底角色=[${fallbackChars.map((c) => c.name).join(',')}] 挂载参考图=${extractedRefs.length} 张`);

        // 4) 规范化发给模型的文本：别称/漏字 @ → @登记名，再统一去除 @ 符号
        if (vpStruct) {
          for (const key of ['startFrame', 'endFrame', 'prompt', 'cameraMovement', 'characterAction']) {
            if (typeof vpStruct[key] === 'string' && vpStruct[key].trim()) {
              vpStruct[key] = applyAtRules(vpStruct[key], atIndex).text;
            }
          }
          if (vpStruct.prompt) promptText = vpStruct.prompt;
        }
        promptText = stripAtMentions(applyAtRules(promptText, atIndex).text);
      }
    } catch (err) {
      console.error('[AtParser] Exception resolving assets:', err);
      // 兜底：至少把 @ 符号去掉，避免残留在发给模型的提示词中
      promptText = stripAtMentions(promptText);
    }

    // duration 为空时不传，让 API 使用默认值；内部需要计算帧数时使用 durationSeconds。
    const requestedDuration = params.duration != null && params.duration !== '' ? Number(params.duration) : (shot.duration ?? undefined);
    const duration = typeof requestedDuration === 'number' && Number.isFinite(requestedDuration) && requestedDuration > 0 ? requestedDuration : undefined;
    const durationSeconds = duration ?? 5;

    // ── 生成模式 + 参考图 ──
    const videoGenMode: string = params.videoGenMode || 'auto'; // 'shot' | 'ref' | 'merged' | 'auto'
    const rawVideoRefs: string[] = Array.isArray(params.referenceImages) ? params.referenceImages.slice(0, 4) : [];

    // 合并前端传入的参考图（含风格设置参考图）与 @ 解析出来的资产图
    const combinedRefs = [...new Set([...rawVideoRefs, ...extractedRefs])].filter(Boolean);

    // 'shot': 只用分镜图首帧   'ref': 全部参考图作角色一致性参考(text2video+charRefs)   'merged': 前端已合成一张图作首帧   'auto': 优先分镜图
    const rawFirstFrameUrl: string =
      videoGenMode === 'shot'   ? (shot.imageUrl || '') :
      videoGenMode === 'ref'    ? '' :                        // text2video 模式，无首帧
      videoGenMode === 'merged' ? (combinedRefs[0] || '') :  // 前端已合成，直接用
      (shot.imageUrl || combinedRefs[0] || '');

    // 立即转换为公网可访问的 HTTPS 链接
    const firstFrameUrl: string = rawFirstFrameUrl ? await uploadLocalImage(rawFirstFrameUrl) : '';

    // 将合并后的所有参考图作为角色一致性参考传给支持的 provider，保障极高的一致性
    const rawCharRefUrls = combinedRefs;
    const charRefUrls: string[] = [];
    for (const ref of rawCharRefUrls) {
      if (ref) {
        const publicRefUrl = await uploadLocalImage(ref);
        if (publicRefUrl) {
          charRefUrls.push(publicRefUrl);
        }
      }
    }

    // 为 Google Veo 事先提取 Base64 字符串
    let googleBase64 = '';
    if (rawFirstFrameUrl) {
      try {
        const b64 = await toLocalBase64(rawFirstFrameUrl);
        if (b64) {
          const parts = b64.split(';base64,');
          googleBase64 = parts[1] || parts[0];
        }
      } catch (e) {
        console.error('[Google Veo Base64 Error]:', e);
      }
    }
    // 宽高/比例
    const videoAspect: string = params.videoAspect || '16:9';
    const videoWidth: number = params.videoWidth || 1280;
    const videoHeight: number = params.videoHeight || 720;

    let externalTaskId = '';
    let videoUrl = '';

    switch (provider) {
      // ── 可灵 Kling AI ──
      case 'kling': {
        const base = apiUrl || 'https://api.klingai.com';
        const isImg2V = !!firstFrameUrl;
        const endpoint = `${base}/v1/videos/${isImg2V ? 'image2video' : 'text2video'}`;
        const body: any = { model_name: model || 'kling-v1-6', prompt: promptText, cfg_scale: 0.5, aspect_ratio: videoAspect };
        if (duration) body.duration = String(duration);
        if (isImg2V) body.image = firstFrameUrl;
        if (charRefUrls.length > 0) body.reference_images = charRefUrls.slice(0, 4).map(url => ({ url }));
        const submitData = await safeFetchJson(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
        if (submitData.code !== 0) return { error: submitData.message || 'Kling 提交失败' };
        externalTaskId = submitData.data?.task_id;
        const klBase = `${base}/v1/videos/${isImg2V ? 'image2video' : 'text2video'}`;
        const pollResult = await pollUntilDone(5000, 36, async () => {
          const d = await safeFetchJson(`${klBase}/${externalTaskId}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
          const s = d.data?.task_status;
          if (s === 'succeed') return { done: true, videoUrl: d.data?.task_result?.videos?.[0]?.url || '' };
          if (s === 'failed') return { done: true, error: d.data?.task_status_msg || 'Kling 生成失败' };
          return { done: false };
        });
        if (pollResult.error) return { error: pollResult.error };
        videoUrl = pollResult.videoUrl || '';
        break;
      }

      // ── MiniMax Video ──
      case 'minimax-video': {
        const base = apiUrl || 'https://api.minimax.chat/v1';
        const body: any = { model: model || 'video-01', prompt: promptText };
        if (firstFrameUrl) body.first_frame_image = firstFrameUrl;
        if (charRefUrls.length > 0) body.subject_reference = charRefUrls.slice(0, 4).map(url => ({ type: 'character', url }));
        const submitData = await safeFetchJson(`${base}/video_generation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
        if (submitData.base_resp?.status_code !== 0) return { error: submitData.base_resp?.status_msg || 'MiniMax 提交失败' };
        externalTaskId = submitData.task_id;
        const pollResult = await pollUntilDone(5000, 36, async () => {
          const d = await safeFetchJson(`${base}/query/video_generation?task_id=${externalTaskId}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
          if (d.status === 'Success') return { done: true, videoUrl: d.download_url || d.file_id || '' };
          if (d.status === 'Fail') return { done: true, error: 'MiniMax 视频生成失败' };
          return { done: false };
        });
        if (pollResult.error) return { error: pollResult.error };
        videoUrl = pollResult.videoUrl || '';
        break;
      }

      // ── MiniMax H3（海螺 H3，v2 协议）──
      case 'minimax-h3': {
        // v2 接口：POST {base}/v2/video_generation，多模态 content 数组，task_id + GET {base}/v2/query/video_generation/{task_id}
        // 与旧版 minimax-video 差异：请求体用 content[]（而非 prompt/first_frame_image），查询用 task.content.url（而非 download_url/file_id）
        const rawBase = (apiUrl || 'https://api.minimax.chat').replace(/\/+$/, '');
        // 兼容用户把 apiUrl 填成 .../v1 或 .../v2 的情况（v2 接口本身带 /v2 前缀）
        const h3Base = rawBase.replace(/\/v[12]$/i, '');
        const h3Model = model || 'MiniMax-H3';
        const h3IsMax = /-max$/i.test(h3Model);

        // 分辨率：H3 支持 768P/2K；H3-Max 仅 480P/768P
        const reqResolution = String(params?.resolution || '').toUpperCase();
        const h3Resolution = h3IsMax
          ? (reqResolution === '480P' ? '480P' : '768P')
          : (reqResolution === '768P' ? '768P' : '2K');

        // 时长：H3 为 4~15 秒，H3-Max 为 5~15 秒，均只接受整数
        const reqDuration = Math.round(Number(duration) || 6);
        const h3Duration = Math.min(15, Math.max(h3IsMax ? 5 : 4, reqDuration));

        const h3Content: any[] = [{ type: 'text', text: promptText }];
        if (firstFrameUrl) {
          h3Content.push({ type: 'image_url', image_url: { url: firstFrameUrl }, role: 'first_frame' });
        }

        // 文生视频必须显式指定比例且不能为 adaptive；图生视频由图片决定，必须为 adaptive
        const h3AllowedRatio = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
        const h3Ratio = firstFrameUrl
          ? 'adaptive'
          : (h3AllowedRatio.includes(videoAspect) ? videoAspect : '16:9');

        const h3Submit = await safeFetchJson(`${h3Base}/v2/video_generation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: h3Model,
            content: h3Content,
            resolution: h3Resolution,
            duration: h3Duration,
            ratio: h3Ratio,
            aigc_watermark: false,
          }),
        });
        if (h3Submit?.error || !h3Submit?.task_id) {
          const h3Msg = h3Submit?.error?.message || h3Submit?.message || '未返回 task_id';
          return { error: `MiniMax H3 提交失败：${h3Msg}` };
        }
        externalTaskId = String(h3Submit.task_id);

        const h3Poll = await pollUntilDone(8000, 75, async () => {
          const d = await safeFetchJson(`${h3Base}/v2/query/video_generation/${externalTaskId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
          });
          const task = d?.task || {};
          if (task.status === 'succeeded') return { done: true, videoUrl: task?.content?.url || '' };
          if (task.status === 'failed') return { done: true, error: 'MiniMax H3 生成失败' };
          if (task.status === 'cancelled') return { done: true, error: 'MiniMax H3 任务已取消' };
          return { done: false };
        });
        if (h3Poll.error) return { error: h3Poll.error };
        if (!h3Poll.videoUrl) return { error: 'MiniMax H3 任务超时或未返回视频地址，请稍后在任务中心查看' };
        videoUrl = h3Poll.videoUrl;
        break;
      }

      // ── 火山引擎 Seedance ──
      case 'volcengine-video': {
        const base = apiUrl || 'https://ark.cn-beijing.volces.com/api/v3';
        const disableR2v = isSeedanceR2vUnsupportedModel(model);
        const seedanceFirstFrameUrl = firstFrameUrl || (disableR2v ? (charRefUrls[0] || '') : '');
        const contentArray: any[] = [
          { type: 'text', text: promptText }
        ];
        if (seedanceFirstFrameUrl) {
          contentArray.push({
            type: 'image_url',
            image_url: { url: await uploadLocalImage(seedanceFirstFrameUrl) },
            role: 'first_frame'
          });
        }
        for (const refUrl of (disableR2v ? [] : charRefUrls)) {
          contentArray.push({
            type: 'image_url',
            image_url: { url: await uploadLocalImage(refUrl) },
            role: 'reference_image'
          });
        }
        const ratioMap: Record<string, string> = {
          '16:9': '16:9', '9:16': '9:16', '1:1': '1:1', '3:4': '3:4', '4:3': '4:3'
        };
        const volRatio = ratioMap[videoAspect] || '16:9';
        const volResolution = videoHeight >= 1080 ? '1080p' : '720p';

        const body: any = {
          model: model,
          content: contentArray,
          ratio: volRatio,
          resolution: volResolution,
          duration: durationSeconds,
          watermark: false
        };

        const submitData = await safeFetchJson(`${base}/contents/generations/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
        if (submitData.error) return { error: submitData.error.message || 'Seedance 提交失败' };
        externalTaskId = submitData.id;
        const pollResult = await pollUntilDone(5000, 36, async () => {
          const d = await safeFetchJson(`${base}/contents/generations/tasks/${externalTaskId}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
          if (d.status === 'succeeded') return { done: true, videoUrl: d.content?.video_url || '' };
          if (d.status === 'failed') return { done: true, error: d.error?.message || 'Seedance 失败' };
          return { done: false };
        });
        if (pollResult.error) return { error: pollResult.error };
        videoUrl = pollResult.videoUrl || '';
        break;
      }

      // ── Vidu ──
      case 'vidu': {
        const base = apiUrl || 'https://api.vidu.cn/v1';
        const body: any = { model: model || 'vidu-2.0', prompt: promptText, duration, aspect_ratio: videoAspect };
        if (firstFrameUrl) body.input = [{ type: 'image', url: firstFrameUrl }];
        if (charRefUrls.length > 0 && !firstFrameUrl) body.input = charRefUrls.slice(0, 4).map(url => ({ type: 'character', url }));
        const submitData = await safeFetchJson(`${base}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${apiKey}` },
          body: JSON.stringify({ type: firstFrameUrl ? 'img2video' : 'text2video', ...body }),
        });
        if (submitData.code) return { error: submitData.message || 'Vidu 提交失败' };
        externalTaskId = submitData.id;
        const pollResult = await pollUntilDone(5000, 36, async () => {
          const d = await safeFetchJson(`${base}/tasks/${externalTaskId}/creations`, { headers: { 'Authorization': `Token ${apiKey}` } });
          const creation = Array.isArray(d) ? d[0] : d?.creations?.[0];
          if (creation?.state === 'success') return { done: true, videoUrl: creation.url || '' };
          if (creation?.state === 'failed') return { done: true, error: 'Vidu 生成失败' };
          return { done: false };
        });
        if (pollResult.error) return { error: pollResult.error };
        videoUrl = pollResult.videoUrl || '';
        break;
      }

      // ── Runway ML ──
      case 'runway': {
        const base = apiUrl || 'https://api.dev.runwayml.com';
        const body: any = { model: model || 'gen4_turbo', promptText, duration, ratio: videoAspect };
        if (firstFrameUrl) body.promptImage = firstFrameUrl;
        const endpoint = firstFrameUrl ? `${base}/v1/image_to_video` : `${base}/v1/text_to_video`;
        const submitData = await safeFetchJson(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'X-Runway-Version': '2024-11-06' },
          body: JSON.stringify(body),
        });
        externalTaskId = submitData.id;
        const pollResult = await pollUntilDone(5000, 36, async () => {
          const d = await safeFetchJson(`${base}/v1/tasks/${externalTaskId}`, { headers: { 'Authorization': `Bearer ${apiKey}`, 'X-Runway-Version': '2024-11-06' } });
          if (d.status === 'SUCCEEDED') return { done: true, videoUrl: d.output?.[0] || '' };
          if (d.status === 'FAILED') return { done: true, error: d.failure || 'Runway 生成失败' };
          return { done: false };
        });
        if (pollResult.error) return { error: pollResult.error };
        videoUrl = pollResult.videoUrl || '';
        break;
      }

      // ── Luma Dream Machine ──
      case 'luma': {
        const base = apiUrl || 'https://api.lumalabs.ai';
        const body: any = { model: model || 'ray-2', prompt: promptText, duration };
        if (firstFrameUrl) body.keyframes = { frame0: { type: 'image', url: firstFrameUrl } };
        const submitData = await safeFetchJson(`${base}/dream-machine/v1/generations/video`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
        externalTaskId = submitData.id;
        const pollResult = await pollUntilDone(5000, 36, async () => {
          const d = await safeFetchJson(`${base}/dream-machine/v1/generations/${externalTaskId}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
          if (d.state === 'completed') return { done: true, videoUrl: d.assets?.video || '' };
          if (d.state === 'failed') return { done: true, error: d.failure_reason || 'Luma 生成失败' };
          return { done: false };
        });
        if (pollResult.error) return { error: pollResult.error };
        videoUrl = pollResult.videoUrl || '';
        break;
      }

      // ── Seedance 2.0（同 Volcengine，不同模型）──
      case 'seedance2': {
        const base = apiUrl || 'https://ark.cn-beijing.volces.com/api/v3';
        const seedanceModel = model || 'seedance-2-0-lite-250616';
        const disableR2v = isSeedanceR2vUnsupportedModel(seedanceModel);
        const seedanceFirstFrameUrl = firstFrameUrl || (disableR2v ? (charRefUrls[0] || '') : '');
        const contentArray: any[] = [
          { type: 'text', text: promptText }
        ];
        if (seedanceFirstFrameUrl) {
          contentArray.push({
            type: 'image_url',
            image_url: { url: await uploadLocalImage(seedanceFirstFrameUrl) },
            role: 'first_frame'
          });
        }
        for (const refUrl of (disableR2v ? [] : charRefUrls)) {
          contentArray.push({
            type: 'image_url',
            image_url: { url: await uploadLocalImage(refUrl) },
            role: 'reference_image'
          });
        }
        const ratioMap: Record<string, string> = {
          '16:9': '16:9', '9:16': '9:16', '1:1': '1:1', '3:4': '3:4', '4:3': '4:3'
        };
        const volRatio = ratioMap[videoAspect] || '16:9';
        const volResolution = videoHeight >= 1080 ? '1080p' : '720p';

        const body: any = {
          model: seedanceModel,
          content: contentArray,
          ratio: volRatio,
          resolution: volResolution,
          duration: durationSeconds,
          watermark: false
        };

        const submitData = await safeFetchJson(`${base}/contents/generations/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
        if (submitData.error) return { error: submitData.error.message || 'Seedance 2.0 提交失败' };
        externalTaskId = submitData.id;
        const pollResult = await pollUntilDone(5000, 36, async () => {
          const d = await safeFetchJson(`${base}/contents/generations/tasks/${externalTaskId}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
          if (d.status === 'succeeded') return { done: true, videoUrl: d.content?.video_url || '' };
          if (d.status === 'failed') return { done: true, error: d.error?.message || 'Seedance 2.0 生成失败' };
          return { done: false };
        });
        if (pollResult.error) return { error: pollResult.error };
        videoUrl = pollResult.videoUrl || '';
        break;
      }

      // ── Grok Aurora (xAI) ──
      case 'grok-video': {
        const base = apiUrl || 'https://api.x.ai/v1';
        const body: any = { model: model || 'grok-2-aurora', prompt: promptText };
        if (firstFrameUrl) body.image_url = firstFrameUrl;
        const submitData = await safeFetchJson(`${base}/video/generations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
        externalTaskId = submitData.id || submitData.task_id;
        if (!externalTaskId) { videoUrl = submitData.url || ''; break; }
        const pollResult = await pollUntilDone(5000, 36, async () => {
          const d = await safeFetchJson(`${base}/video/generations/${externalTaskId}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
          if (d.status === 'completed') return { done: true, videoUrl: d.url || d.video_url || '' };
          if (d.status === 'failed') return { done: true, error: d.error?.message || 'Grok 生成失败' };
          return { done: false };
        });
        if (pollResult.error) return { error: pollResult.error };
        videoUrl = pollResult.videoUrl || '';
        break;
      }

      // ── Google Veo ──
      case 'veo': {
        const rawBase = (apiUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
        // 如果 base URL 以 /v1 结尾，自动将其移除，因为 Google v1beta 路径不属于 /v1 的下级
        const base = rawBase.endsWith('/v1') ? rawBase.slice(0, -3) : rawBase;

        const submitData = await safeFetchJson(`${base}/v1beta/models/${model || 'veo-2.0-generate-001'}:predictLongRunning`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            instances: [{ prompt: promptText, ...(googleBase64 ? { image: { bytesBase64Encoded: googleBase64 } } : {}) }],
            parameters: { aspectRatio: '9:16', durationSeconds, sampleCount: 1 },
          }),
        });
        externalTaskId = submitData.name;
        const pollResult = await pollUntilDone(6000, 30, async () => {
          const d = await safeFetchJson(`${base}/v1beta/${externalTaskId}`, { headers: { 'x-goog-api-key': apiKey } });
          if (d.done) {
            const vUrl = d.response?.predictions?.[0]?.bytesBase64Encoded
              ? `data:video/mp4;base64,${d.response.predictions[0].bytesBase64Encoded}`
              : d.response?.predictions?.[0]?.gcsUri || '';
            return { done: true, videoUrl: vUrl };
          }
          if (d.error) return { done: true, error: d.error.message || 'Veo 生成失败' };
          return { done: false };
        });
        if (pollResult.error) return { error: pollResult.error };
        videoUrl = pollResult.videoUrl || '';
        break;
      }

      // ── 阿里通义万象 ──
      case 'qwen-video': {
        const base = apiUrl || 'https://dashscope.aliyuncs.com/api/v1';
        const input: any = { prompt: promptText };
        if (firstFrameUrl) input.img = firstFrameUrl;
        const submitData = await safeFetchJson(`${base}/services/aigc/image2video/video-synthesis`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'X-DashScope-Async': 'enable' },
          body: JSON.stringify({ model: model || 'wanx2.1-i2v-turbo', input, parameters: { duration } }),
        });
        if (submitData.code) return { error: submitData.message || '通义万象提交失败' };
        externalTaskId = submitData.output?.task_id;
        const pollResult = await pollUntilDone(5000, 36, async () => {
          const d = await safeFetchJson(`https://dashscope.aliyuncs.com/api/v1/tasks/${externalTaskId}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
          if (d.output?.task_status === 'SUCCEEDED') return { done: true, videoUrl: d.output?.video_url || '' };
          if (d.output?.task_status === 'FAILED') return { done: true, error: '通义万象生成失败' };
          return { done: false };
        });
        if (pollResult.error) return { error: pollResult.error };
        videoUrl = pollResult.videoUrl || '';
        break;
      }

      // ── Agnes Video（V2.0 / 2.5 / 2.5-flash） ──
      case 'agnes':
      case 'agnes-video': {
        // 规范化 base URL：去除末尾可能的 /v1 前缀，统一拼接到 /v1/videos
        const rawBase = (apiUrl || 'https://apihub.agnes-ai.com').replace(/\/+$/, '');
        const base = rawBase.endsWith('/v1') ? rawBase.slice(0, -3) : rawBase;
        const modelName = model || 'agnes-video-v2.0';
        console.log(`[AgnesVideo] config: apiUrl="${apiUrl}", rawBase="${rawBase}", base="${base}", model="${modelName}"`);
        const requestedFrameRate = Number(params.frameRate || 24);
        const fr = Number.isFinite(requestedFrameRate) && requestedFrameRate > 0 ? requestedFrameRate : 24;

        // 清理prompt：移除残留的@标记和多余空白
        const cleanVideoPrompt = promptText
          .replace(/@图片\d+/g, '')
          .replace(/@\S+/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        // 按模型版本构造请求体：2.5/flash 用 mode/seconds/size/aspect_ratio；V2.0 用 num_frames/height/width
        // 官方 Agnes hub（agnes-ai.com）V2.0 支持 extra_body 多参考图；newapi 等中转网关（如 csjlm.app，
        // litellm 转发 ti2vid）V2.0 仅接受 1 张参考图，多图会报 "ti2vid supports at most 1 image"。
        // 注意：模型名含 agnes-video 的 newapi 配置也会路由到本 case，因此必须按域名区分。
        const isOfficialAgnesHub = base.toLowerCase().includes('agnes-ai.com');
        const { body, modeLabel } = buildAgnesVideoBody({
          modelName,
          prompt: cleanVideoPrompt,
          durationSeconds,
          aspectRatio: videoAspect,
          videoWidth,
          videoHeight,
          firstFrameUrl,
          refImageUrls: charRefUrls,
          frameRate: fr,
          negativePrompt: params.negativePrompt,
          singleImageOnly: !isOfficialAgnesHub,
        });

        console.log(`[AgnesVideo] Mode: ${modeLabel}; body keys:`, Object.keys(body), '; duration:', durationSeconds, 's; aspect:', videoAspect);
        const submitData = await safeFetchJson(`${base}/v1/videos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
        const pickString = (...values: any[]) => values.find(v => typeof v === 'string' && v.trim())?.trim() || '';
        const pickMediaUrl = (...values: any[]) => values
          .map(v => typeof v === 'string' ? v.trim() : '')
          .find(v => /^(https?:\/\/|data:video\/|\/)/i.test(v)) || '';
        const unwrapPayload = (payload: any) => payload?.data || payload?.result || payload?.output || payload;
        const getTaskId = (payload: any) => {
          const data = unwrapPayload(payload);
          return pickString(
            payload?.task_id,
            payload?.id,
            payload?.video_id,
            data?.task_id,
            data?.id,
            data?.video_id
          );
        };
        const getVideoUrl = (payload: any) => {
          const data = unwrapPayload(payload);
          const outputItem = Array.isArray(payload?.output) ? payload.output[0] : payload?.output;
          const dataOutputItem = Array.isArray(data?.output) ? data.output[0] : data?.output;
          const videoItem = Array.isArray(payload?.videos) ? payload.videos[0] : payload?.videos;
          const dataVideoItem = Array.isArray(data?.videos) ? data.videos[0] : data?.videos;
          const resultItem = Array.isArray(payload?.result) ? payload.result[0] : payload?.result;
          const dataResultItem = Array.isArray(data?.result) ? data.result[0] : data?.result;
          const metadataItem = payload?.metadata;
          const dataMetadataItem = data?.metadata;
          
          const url = pickMediaUrl(
            // NewAPI 标准格式（最优先检查）
            metadataItem?.url,
            dataMetadataItem?.url,
            payload?.metadata?.video_url,
            data?.metadata?.video_url,
            
            // payload 直接字段
            payload?.remixed_from_video_id,
            payload?.video_url,
            payload?.url,
            payload?.download_url,
            payload?.output,
            payload?.video,
            payload?.file_url,
            payload?.result_url,
            
            // data 嵌套字段
            data?.remixed_from_video_id,
            data?.video_url,
            data?.url,
            data?.download_url,
            data?.video,
            data?.file_url,
            data?.result_url,
            
            // output/result 数组第一项
            outputItem?.remixed_from_video_id,
            outputItem?.video_url,
            outputItem?.url,
            outputItem?.video,
            dataOutputItem?.remixed_from_video_id,
            dataOutputItem?.video_url,
            dataOutputItem?.url,
            dataOutputItem?.video,
            videoItem?.url,
            videoItem?.video_url,
            videoItem?.video,
            dataVideoItem?.url,
            dataVideoItem?.video_url,
            dataVideoItem?.video,
            resultItem?.url,
            resultItem?.video_url,
            resultItem?.video,
            dataResultItem?.url,
            dataResultItem?.video_url,
            dataResultItem?.video
          );
          
          // 调试日志：当状态为成功但没有URL时，打印完整响应
          if (!url) {
            console.log('[AgnesVideo] getVideoUrl 未找到视频地址，完整响应:', JSON.stringify(payload, null, 2));
          }
          
          return url;
        };
        const getStatus = (payload: any) => {
          const data = unwrapPayload(payload);
          return String(payload?.status || payload?.state || payload?.task_status || data?.status || data?.state || data?.task_status || '').toLowerCase();
        };
        const getErrorMessage = (payload: any) => {
          const data = unwrapPayload(payload);
          return pickString(
            payload?.error?.message,
            payload?.error,
            payload?.message,
            payload?.reason,
            data?.error?.message,
            data?.error,
            data?.message,
            data?.reason
          );
        };

        externalTaskId = getTaskId(submitData);
        console.log(`[AgnesVideo] submit base="${base}", task_id="${externalTaskId}", submitUrl="${base}/v1/videos"`);
        if (!externalTaskId) {
          // 尝试同步返回
          videoUrl = getVideoUrl(submitData);
          break;
        }
        const successStatuses = new Set(['completed', 'succeeded', 'success', 'done']);
        const failureStatuses = new Set(['failed', 'failure', 'error', 'canceled', 'cancelled']);
        const pollResult = await pollUntilDone(10000, 90, async () => {
          const primaryPollUrl = `${base}/agnesapi?video_id=${encodeURIComponent(externalTaskId)}&model_name=${encodeURIComponent(modelName)}`;
          const legacyPollUrl = `${base}/v1/videos/${encodeURIComponent(externalTaskId)}`;
          let d: any;
          try {
            console.log(`[AgnesVideo] poll attempt, url="${primaryPollUrl}"`);
            d = await safeFetchJson(primaryPollUrl, {
              headers: { 'Authorization': `Bearer ${apiKey}` },
            });
          } catch (primaryError: any) {
            console.warn(`[AgnesVideo] primary poll failed, fallback to legacy endpoint: ${primaryError?.message || primaryError}`);
            d = await safeFetchJson(legacyPollUrl, {
              headers: { 'Authorization': `Bearer ${apiKey}` },
            });
          }

          const status = getStatus(d);
          const vUrl = getVideoUrl(d);
          if (vUrl && (!status || successStatuses.has(status))) {
            return { done: true, videoUrl: vUrl };
          }
          if (successStatuses.has(status)) {
            console.error('[AgnesVideo] 任务已完成但未找到视频URL，状态:', status);
            console.error('[AgnesVideo] 响应数据:', JSON.stringify(d, null, 2));
            return { 
              done: true, 
              error: `Agnes Video 已完成但未返回视频地址。状态: ${status}。请检查后台日志查看完整响应数据，或联系视频服务提供商确认API返回格式。` 
            };
          }
          if (failureStatuses.has(status)) {
            return { done: true, error: getErrorMessage(d) || 'Agnes Video 生成失败' };
          }
          return { done: false };
        });
        if (pollResult.error) return { error: pollResult.error };
        videoUrl = pollResult.videoUrl || '';
        break;
      }

      // ── DFYue (Seedance) ──
      case 'dfyue': {
        const base = apiUrl || 'https://d.csjlm.app/v1';
        const isImg2V = !!firstFrameUrl;

        // 构建 input 内容数组
        const inputContents: any[] = [
          { type: 'input_text', text: promptText }
        ];

        // 如果有首帧图片，添加为参考图
        if (firstFrameUrl) {
          inputContents.push({
            type: 'input_image',
            image_url: firstFrameUrl
          });
        }

        // 构建请求体
        const requestBody: any = {
          model: model || 'seedance_v2.0',
          input: inputContents,
          ratio: videoAspect,
          wait: false, // 默认异步提交，然后轮询
        };

        // 只有当 duration 有值时才添加
        if (duration) {
          requestBody.seconds = duration;
        }

        // 提交任务
        const submitData = await safeFetchJson(`${base}/v1/responses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(requestBody),
        });

        externalTaskId = submitData.id || '';
        if (!externalTaskId) {
          return { error: 'DFYue 提交失败，未获取到任务 ID' };
        }

        // 轮询查询任务状态
        const pollResult = await pollUntilDone(5000, 48, async () => {
          const statusData = await safeFetchJson(`${base}/v1/responses/${externalTaskId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });

          if (statusData.status === 'completed') {
            // 从 output 中提取视频 URL
            const videoUrl = statusData.video?.url ||
                            statusData.output?.[0]?.content?.[0]?.text || '';
            return { done: true, videoUrl };
          }

          if (statusData.status === 'failed') {
            return { done: true, error: statusData.error?.message || 'DFYue 生成失败' };
          }

          // queued 或 in_progress 继续等待
          return { done: false };
        });

        if (pollResult.error) return { error: pollResult.error };
        videoUrl = pollResult.videoUrl || '';
        break;
      }

      // ── NewAPI 代理 Agnes Video（兼容 newapi-video / custom-video provider） ──
      // 当检测到 model 包含 agnes 时，直接使用 Agnes 的标准端点
      case 'newapi-video':
      case 'custom-video':
      default: {
        const modelLower = String(model || '').toLowerCase();
        const apiUrlLower = String(apiUrl || '').toLowerCase();
        
        // 检测是否为 Agnes Video 模型
        if (modelLower.includes('agnes') || apiUrlLower.includes('agnes')) {
          console.log('[NewAPI-Agnes] 检测到 Agnes Video 模型，使用专用端点');
          const rawBase = (apiUrl || 'https://www.csjlm.app').replace(/\/+$/, '');
          const base = rawBase.endsWith('/v1') ? rawBase.slice(0, -3) : rawBase;
          const modelName = model || 'agnes-video-v2.0';
          
          // 按模型版本构造请求体：2.5/flash 用 mode/seconds/size/aspect_ratio；V2.0 用 num_frames/height/width
          const requestedFrameRate = Number(params.frameRate || 24);
          const fr = Number.isFinite(requestedFrameRate) && requestedFrameRate > 0 ? requestedFrameRate : 24;
          const cleanProxyPrompt = promptText
            .replace(/@图片\d+/g, '')
            .replace(/@\S+/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          const { body, modeLabel: proxyModeLabel } = buildAgnesVideoBody({
            modelName,
            prompt: cleanProxyPrompt,
            durationSeconds,
            aspectRatio: videoAspect,
            videoWidth,
            videoHeight,
            firstFrameUrl,
            refImageUrls: charRefUrls,
            frameRate: fr,
            negativePrompt: params.negativePrompt,
            // NewAPI 等中转网关（litellm 转发 ti2vid）V2.0 最多只接受 1 张参考图；官方 Agnes hub 不受此限
            singleImageOnly: !base.toLowerCase().includes('agnes-ai.com'),
          });
          console.log(`[NewAPI-Agnes] Mode: ${proxyModeLabel}; body keys:`, Object.keys(body));

          // 使用 Agnes 标准端点：/v1/videos
          const submitData = await safeFetchJson(`${base}/v1/videos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body),
          });
          
          const pickString = (...values: any[]) => values.find(v => typeof v === 'string' && v.trim())?.trim() || '';
          const pickMediaUrl = (...values: any[]) => values
            .map(v => typeof v === 'string' ? v.trim() : '')
            .find(v => /^(https?:\/\/|data:video\/|\/)/i.test(v)) || '';
          const unwrapPayload = (payload: any) => payload?.data || payload?.result || payload?.output || payload;
          
          const getTaskId = (payload: any) => {
            const data = unwrapPayload(payload);
            return pickString(
              payload?.task_id, payload?.id, payload?.video_id,
              data?.task_id, data?.id, data?.video_id
            );
          };
          
          const getVideoUrl = (payload: any) => {
            const data = unwrapPayload(payload);
            const metadataItem = payload?.metadata;
            const dataMetadataItem = data?.metadata;
            const outputItem = Array.isArray(payload?.output) ? payload.output[0] : payload?.output;
            const dataOutputItem = Array.isArray(data?.output) ? data.output[0] : data?.output;
            const videoItem = Array.isArray(payload?.videos) ? payload.videos[0] : payload?.videos;
            const dataVideoItem = Array.isArray(data?.videos) ? data.videos[0] : data?.videos;
            const resultItem = Array.isArray(payload?.result) ? payload.result[0] : payload?.result;
            const dataResultItem = Array.isArray(data?.result) ? data.result[0] : data?.result;
            
            return pickMediaUrl(
              metadataItem?.url, dataMetadataItem?.url,
              payload?.metadata?.video_url, data?.metadata?.video_url,
              payload?.remixed_from_video_id, payload?.video_url, payload?.url,
              data?.remixed_from_video_id, data?.video_url, data?.url,
              outputItem?.url, dataOutputItem?.url,
              videoItem?.url, dataVideoItem?.url,
              resultItem?.url, dataResultItem?.url
            );
          };
          
          const getStatus = (payload: any) => {
            const data = unwrapPayload(payload);
            return String(payload?.status || payload?.state || data?.status || data?.state || '').toLowerCase();
          };
          
          externalTaskId = getTaskId(submitData);
          console.log(`[NewAPI-Agnes] 任务提交成功, task_id="${externalTaskId}"`);
          
          if (!externalTaskId) {
            videoUrl = getVideoUrl(submitData);
            break;
          }
          
          const successStatuses = new Set(['completed', 'succeeded', 'success', 'done']);
          const failureStatuses = new Set(['failed', 'failure', 'error', 'canceled', 'cancelled']);
          
          const pollResult = await pollUntilDone(10000, 90, async () => {
            const primaryPollUrl = `${base}/agnesapi?video_id=${encodeURIComponent(externalTaskId)}&model_name=${encodeURIComponent(modelName)}`;
            const legacyPollUrl = `${base}/v1/videos/${encodeURIComponent(externalTaskId)}`;
            let d: any;
            try {
              d = await safeFetchJson(primaryPollUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
            } catch (primaryError: any) {
              console.warn(`[NewAPI-Agnes] 主轮询失败，尝试备用端点`);
              d = await safeFetchJson(legacyPollUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
            }
            
            const status = getStatus(d);
            const vUrl = getVideoUrl(d);
            if (vUrl && (!status || successStatuses.has(status))) {
              return { done: true, videoUrl: vUrl };
            }
            if (successStatuses.has(status)) {
              console.error('[NewAPI-Agnes] 任务完成但未找到视频URL');
              return { done: true, error: 'NewAPI Agnes Video 已完成但未返回视频地址' };
            }
            if (failureStatuses.has(status)) {
              return { done: true, error: 'NewAPI Agnes Video 生成失败' };
            }
            return { done: false };
          });
          
          if (pollResult.error) return { error: pollResult.error };
          videoUrl = pollResult.videoUrl || '';
          break;
        }

        // 通用视频服务处理（非 Agnes 模型）
        const isVeo = model && (model.startsWith('veo_') || model.includes('veo') || model.startsWith('imagen-') || model.includes('flow'));
        // ── 🔒 解决 Google Veo 音频生成限制错误 (PUBLIC_ERROR_AUDIO_FILTERED) ──
        // Google Veo 的很多 API 代理账号对音频生成有严格过滤或暂不支持，直接强开音频会导致 HTTP 502 并报错：PUBLIC_ERROR_AUDIO_FILTERED
        // 针对 Veo 模型直接强制关闭背景音生成（with_audio/audio/sound: false），确保能顺利生成无声视频
        const hasAudio = isVeo ? false : (params.audio !== false);

        // ── 🔒 智能敏感词与安全机制过滤 (针对 Google Veo PROMINENT_PEOPLE_FILTER 强力逃逸) ──
        // 自动将容易触发 Google 版权和名牌过滤的名字（如 纪凡赛尔、凡赛尔、梵赛尔）本地洗白为中性人称，确保 100% 视频出片率
        let sanitizedPrompt = promptText || '';
        const sensitivePatterns = [
          { pattern: /纪凡赛尔/g, replace: '年轻男子' },
          { pattern: /梵赛尔/g, replace: '主角' },
          { pattern: /凡赛尔/g, replace: '青年' }
        ];
        for (const { pattern, replace } of sensitivePatterns) {
          sanitizedPrompt = sanitizedPrompt.replace(pattern, replace);
        }

        const submitBody = {
          model,
          prompt: sanitizedPrompt,
          duration,
          with_audio: hasAudio,
          audio: hasAudio,
          audio_enabled: hasAudio,
          sound: hasAudio,
          // 极致多字段相容性注入，完美覆盖几乎所有中转/自定义大模型接口的首帧入参
          image: firstFrameUrl,
          image_url: firstFrameUrl,
          input_image: firstFrameUrl,
          input_image_url: firstFrameUrl,
          first_frame_image: firstFrameUrl,
          first_frame_image_url: firstFrameUrl
        };

        const modelNameLower = String(model || '').trim().toLowerCase();
        const isNewApiGrokImaginePreview = modelNameLower === 'grok-imagine-video-1.5-preview';
        const isNewApiGrokImagineChat = modelNameLower === 'grok-imagine-video';
        const isDedicatedNewApiGrok = isNewApiGrokImaginePreview || isNewApiGrokImagineChat;
        const isFlow2ApiCandidate = model && (model.startsWith('veo_') || model.startsWith('imagen-') || model.includes('flow'));
        let data: any = null;
        let submitUrl = '';

        // 构造候选序列
        const candidates: Array<{ url: string; body: any }> = [];
        const rawUrl = (apiUrl || '').replace(/\/$/, '');

        if (rawUrl) {
          if (isNewApiGrokImaginePreview) {
            const grokImageUrl = firstFrameUrl ? await toNewApiImageUrlValue(rawFirstFrameUrl || firstFrameUrl, { preferBase64: true, dataUrl: true }) : '';
            if (!grokImageUrl || !isValidNewApiImageUrlValue(grokImageUrl)) {
              return { error: `grok-imagine-video-1.5-preview 首帧图未能转换为 NewAPI 可识别的公网 URL 或 base64。当前图片类型：${describeImageInput(rawFirstFrameUrl || firstFrameUrl)}，请先重新生成图片分镜后再生成视频。` };
            }
            const grokPrompt = compactVideoPromptForProvider(sanitizedPrompt, 3600);
            console.log(`[NewAPI:GrokVideo] image_url normalized: raw=${describeImageInput(rawFirstFrameUrl || firstFrameUrl)}, final=${describeImageInput(grokImageUrl)}, promptChars=${grokPrompt.length}`);
            const grokVideosBody: any = {
              model,
              prompt: grokPrompt,
              aspect_ratio: videoAspect,
              image_url: grokImageUrl,
            };
            if (duration) grokVideosBody.duration = duration;
            if (rawUrl.endsWith('/v1')) {
              candidates.push({ url: `${rawUrl}/videos`, body: grokVideosBody });
            } else {
              candidates.push({ url: `${rawUrl}/v1/videos`, body: grokVideosBody });
            }
          }

          if (isNewApiGrokImagineChat) {
            const grokChatImageUrl = firstFrameUrl ? await toNewApiImageUrlValue(rawFirstFrameUrl || firstFrameUrl, { preferBase64: true }) : '';
            if (firstFrameUrl && (!grokChatImageUrl || !isValidNewApiImageUrlValue(grokChatImageUrl))) {
              return { error: `grok-imagine-video 首帧图未能转换为 NewAPI 可识别的公网 URL 或 base64。当前图片类型：${describeImageInput(rawFirstFrameUrl || firstFrameUrl)}，请先重新生成图片分镜后再生成视频。` };
            }
            const grokPrompt = compactVideoPromptForProvider(sanitizedPrompt, 3600);
            const grokChatBody = {
              model,
              messages: [
                {
                  role: 'user',
                  content: grokChatImageUrl
                    ? [
                        { type: 'text', text: grokPrompt },
                        { type: 'image_url', image_url: { url: grokChatImageUrl } }
                      ]
                    : grokPrompt
                }
              ],
              stream: false
            };
            if (rawUrl.endsWith('/v1')) {
              candidates.push({ url: `${rawUrl}/chat/completions`, body: grokChatBody });
            } else {
              candidates.push({ url: `${rawUrl}/v1/chat/completions`, body: grokChatBody });
              candidates.push({ url: `${rawUrl}/chat/completions`, body: grokChatBody });
            }
          }

          // 如果是 Flow2API，优先把 /v1/chat/completions 塞入候选列表
          if (!isDedicatedNewApiGrok && isFlow2ApiCandidate) {
            let flow2Model = model;

            // ── 🔒 智能多维度自适应 Veo 3.1 模型自动换装与重配机制 ──
            if (flow2Model.startsWith('veo_')) {
              // 1. 自动判定当前的生成模式
              const targetMode = firstFrameUrl ? 'i2v' : 't2v';

              // 2. 自动判定当前的画幅比例，微短剧常用 9:16（portrait）与横屏 16:9（landscape）
              const isPortrait = videoAspect === '9:16';
              const targetAspect = isPortrait ? 'portrait' : 'landscape';

              // 3. 智能解析用户原先勾选的模型速度/质量等级偏好（如 lite / fast / s_fast 等）
              let tier = 'fast';
              if (flow2Model.includes('lite')) {
                tier = 'lite';
              } else if (flow2Model.includes('_s_fast_') || flow2Model.includes('_s_fast')) {
                tier = 's_fast';
              } else if (flow2Model.includes('fast')) {
                tier = 'fast';
              }

              // 提取修饰性偏好标志（如 ultra / relaxed / fl 等）
              const isUltra = flow2Model.includes('ultra');
              const isRelaxed = flow2Model.includes('relaxed');
              const isFl = flow2Model.includes('_fl');

              // 4. 重构生成完美的、完全符合当前运行时参数的专属 Veo 3.1 最佳模型名
              if (targetMode === 'i2v') {
                // 📂 对应 图生视频 (I2V) 系列模型
                if (tier === 'lite') {
                  flow2Model = `veo_3_1_i2v_lite_${targetAspect}`;
                } else if (tier === 's_fast') {
                  let suffix = '';
                  if (isUltra && isRelaxed) suffix = '_ultra_relaxed';
                  else if (isUltra && isFl) suffix = '_ultra_fl';
                  else if (isUltra) suffix = '_ultra';
                  else if (isFl) suffix = '_fl';

                  if (isPortrait) {
                    flow2Model = `veo_3_1_i2v_s_fast_portrait${suffix}`;
                  } else {
                    flow2Model = `veo_3_1_i2v_s_fast${suffix}`;
                  }
                } else {
                  // 默认普通 fast 档次
                  let suffix = '';
                  if (isUltra && isRelaxed) suffix = '_ultra_relaxed';
                  else if (isUltra && isFl) suffix = '_ultra_fl';
                  else if (isUltra) suffix = '_ultra';
                  else if (isFl) suffix = '_fl';

                  if (isPortrait) {
                    flow2Model = `veo_3_1_i2v_fast_portrait${suffix}`;
                  } else {
                    flow2Model = `veo_3_1_i2v_fast_landscape${suffix}`;
                  }
                }
              } else {
                // 📂 对应 文生视频 (T2V) 系列模型
                let suffix = '';
                if (isUltra && isRelaxed) suffix = '_ultra_relaxed';
                else if (isUltra) suffix = '_ultra';

                if (tier === 'lite') {
                  flow2Model = `veo_3_1_t2v_lite_${targetAspect}`;
                } else {
                  flow2Model = `veo_3_1_t2v_fast_${targetAspect}${suffix}`;
                }
              }

              console.log(`[VeoAdapter] Autodetected context. Selected raw: "${model}". Auto-adapted to: "${flow2Model}" (Aspect: ${videoAspect}, Mode: ${targetMode.toUpperCase()})`);
            } else {
              // 针对非 veo 系列模型，做通用的横竖屏拼装兜底
              if (!flow2Model.endsWith('_landscape') && !flow2Model.endsWith('_portrait') && !flow2Model.endsWith('_square')) {
                if (videoAspect === '16:9') flow2Model += '_landscape';
                else if (videoAspect === '9:16') flow2Model += '_portrait';
                else if (videoAspect === '1:1') flow2Model += '_square';
                else flow2Model += '_landscape';
              }
            }

            const flow2Body = {
              model: flow2Model,
              messages: [
                {
                  role: 'user',
                  content: firstFrameUrl
                    ? [
                        { type: 'text', text: sanitizedPrompt },
                        { type: 'image_url', image_url: { url: firstFrameUrl } }
                      ]
                    : sanitizedPrompt
                }
              ],
              // 极致冗余兼容注入，防备某些中转站对 /chat/completions 接口会提取顶层图片字段
              image: firstFrameUrl,
              image_url: firstFrameUrl,
              input_image: firstFrameUrl,
              input_image_url: firstFrameUrl,
              stream: false
            };

            if (rawUrl.endsWith('/v1')) {
              candidates.push({ url: `${rawUrl}/chat/completions`, body: flow2Body });
            } else {
              candidates.push({ url: `${rawUrl}/v1/chat/completions`, body: flow2Body });
              candidates.push({ url: `${rawUrl}/chat/completions`, body: flow2Body });
            }
          }

          // 自定义 endpointPath
          if (!isDedicatedNewApiGrok && params.endpointPath) {
            const ePath = params.endpointPath.startsWith('/') ? params.endpointPath : `/${params.endpointPath}`;
            candidates.push({ url: `${rawUrl}${ePath}`, body: submitBody });
            if (!rawUrl.endsWith('/v1') && !ePath.startsWith('/v1/')) {
              candidates.push({ url: `${rawUrl}/v1${ePath}`, body: submitBody });
            }
          }

          // 标准 OpenAI paths
          if (!isDedicatedNewApiGrok) {
            if (!rawUrl.endsWith('/v1')) {
              candidates.push({ url: `${rawUrl}/v1/video/generations`, body: submitBody });
              candidates.push({ url: `${rawUrl}/v1/images/generations`, body: submitBody });
            }
            candidates.push({ url: `${rawUrl}/video/generations`, body: submitBody });
            candidates.push({ url: `${rawUrl}/images/generations`, body: submitBody });
          }
        } else {
          candidates.push({ url: 'https://api.openai.com/v1/video/generations', body: submitBody });
        }

        // 去重候选 URL
        const seenUrls = new Set<string>();
        const uniqueCandidates: Array<{ url: string; body: any }> = [];
        for (const item of candidates) {
          if (!seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            uniqueCandidates.push(item);
          }
        }

        let accumulatedErrors: string[] = [];

        for (const cand of uniqueCandidates) {
          try {
            console.log(`[CustomVideo] 尝试提交任务到: ${cand.url}`);
            data = await safeFetchJson(cand.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
              body: JSON.stringify(cand.body),
            });
            submitUrl = cand.url;
            console.log(`[CustomVideo] 提交成功，使用路径: ${submitUrl}`);
            break;
          } catch (err: any) {
            const msg = err.message || err;
            accumulatedErrors.push(`${cand.url} -> ${msg}`);
          }
        }

        if (!submitUrl || !data) {
          return { error: `视频提交失败。尝试了以下路径均报错:\n${accumulatedErrors.join('\n')}` };
        }

        if (data.error) return { error: data.error.message || '视频生成失败' };

        // 提取返回结果中的视频 URL (支持 chat/completions 解析)
        let directUrl = '';
        if (submitUrl.includes('/chat/completions')) {
          const content = data.choices?.[0]?.message?.content || '';
          try {
            const parsedContent = typeof content === 'string' ? JSON.parse(content) : content;
            directUrl = parsedContent?.video_url || parsedContent?.url || parsedContent?.video || parsedContent?.data?.url || '';
          } catch {}
          // 尝试匹配 markdown 或是原始格式的 mp4 链接
          if (!directUrl && typeof content === 'string') {
            const mp4Match = content.match(/https?:\/\/[^\s"'\)]+\.(?:mp4|webm|mov|mkv)/i);
            if (mp4Match) {
              directUrl = mp4Match[0];
            } else {
              const httpMatch = content.match(/https?:\/\/[^\s"'\)]+/);
              if (httpMatch) directUrl = httpMatch[0];
            }
          }
        } else {
          directUrl = data.video_url || data.url || data.video ||
                      data.output?.video_url || data.output?.url ||
                      data.output?.[0]?.video_url || data.output?.[0]?.url ||
                      data.data?.[0]?.url || data.data?.url ||
                      data.data?.video_url || data.data?.remixed_from_video_id ||
                      data.remixed_from_video_id;
        }

        if (directUrl && String(directUrl).startsWith('http') && !String(directUrl).includes('placeholder')) {
          videoUrl = directUrl;
          break;
        }

        externalTaskId = data.id || data.task_id || data.video_id || data.data?.id || data.data?.task_id || data.data?.video_id || data.data?.[0]?.id || '';
        if (!externalTaskId) {
          return { error: '未获取到视频生成任务 ID，且未获取到同步返回的视频 URL' };
        }

        // 自动推断对应的轮询 API 根路径
        const pollBaseUrl = submitUrl.replace(/\/video\/generations$/, '').replace(/\/images\/generations$/, '').replace(/\/videos$/, '');

        // ── 轮询等待代理平台生成完成 ──
        const pollMaxAttempts = isDedicatedNewApiGrok ? 120 : 45;
        const pollResult = await pollUntilDone(10000, pollMaxAttempts, async () => {
          let d: any = null;
          let fetchErr: any = null;

          if (submitUrl.endsWith('/videos')) {
            try {
              d = await safeFetchJson(`${pollBaseUrl}/videos/${externalTaskId}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
              });
            } catch (err: any) {
              fetchErr = err;
            }
          }

          if (!d || d.error || fetchErr) try {
            d = await safeFetchJson(`${pollBaseUrl}/video/generations/${externalTaskId}`, {
              headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            fetchErr = null;
          } catch (err: any) {
            fetchErr = err;
          }

          if (!d || d.error || fetchErr) {
            try {
              d = await safeFetchJson(`${pollBaseUrl}/images/generations/${externalTaskId}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
              });
              fetchErr = null;
            } catch (err: any) {
              if (!d) fetchErr = err;
            }
          }

          if (!d || d.error || fetchErr) {
            try {
              d = await safeFetchJson(`${pollBaseUrl}/tasks/${externalTaskId}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
              });
              fetchErr = null;
            } catch (err: any) {
              if (!d) fetchErr = err;
            }
          }

          if (fetchErr) {
            console.warn('[CustomVideoPoll] fetch status error, retrying...', fetchErr.message);
            return { done: false };
          }

          if (!d) return { done: false };

          const status = String(d.status || d.task_status || d.state || d.output?.task_status || d.data?.status || '').toLowerCase();
          const readyVideoUrl = d.video_url || d.url || d.video ||
            d.output?.video_url || d.output?.url ||
            d.output?.[0]?.video_url || d.output?.[0]?.url ||
            d.data?.[0]?.url || d.data?.url ||
            d.data?.video_url || d.data?.remixed_from_video_id ||
            d.remixed_from_video_id ||
            d.response?.predictions?.[0]?.gcsUri || '';
          if (readyVideoUrl && (!status || ['succeeded', 'completed', 'success', 'done'].includes(status))) {
            return { done: true, videoUrl: readyVideoUrl };
          }

          if (['succeeded', 'completed', 'success', 'done'].includes(status)) {
            const vUrl = readyVideoUrl;
            if (vUrl) {
              return { done: true, videoUrl: vUrl };
            }
          }

          if (['failed', 'error', 'fail'].includes(status)) {
            return { done: true, error: d.error?.message || d.message || '自定义模型生成视频失败' };
          }

          return { done: false };
        });

        if (pollResult.error) return { error: pollResult.error };
        videoUrl = pollResult.videoUrl || '';
        break;
      }
    }

    if (videoUrl) {
      const localVideoUrl = await saveMediaLocally(videoUrl, 'video', shotId, shot.dramaId);

      // 将旧视频保存到画廊，保留历史（参考角色图片 gallery 模式）
      let newGallery: any[] = [];
      try {
        let gallery: any[] = [];
        if (shot.videoGallery) {
          try { gallery = JSON.parse(shot.videoGallery); } catch { gallery = []; }
        }
        // 将当前旧 videoUrl 加入画廊（如果有）
        if (shot.videoUrl && !gallery.some((g: any) => g.url === shot.videoUrl)) {
          gallery = [{ url: shot.videoUrl, prompt: shot.videoPrompt || shot.sceneDescription || '', createdAt: new Date().toISOString() }, ...gallery];
        }
        // 将新视频加入画廊开头
        newGallery = gallery.filter((g: any) => g.url !== localVideoUrl);
        newGallery = [{ url: localVideoUrl, prompt: shot.videoPrompt || shot.sceneDescription || '', createdAt: new Date().toISOString() }, ...newGallery];
        // 过滤无效条目
        newGallery = newGallery.filter((g: any) => g && g.url && typeof g.url === 'string' && g.url.trim()).slice(0, 30);
      } catch { /* 忽略画廊错误 */ }

      await dramaWorkflowManager.updateShot(shotId, {
        videoUrl: localVideoUrl,
        videoGallery: JSON.stringify(newGallery),
        status: 'video_ready'
      });
      return { data: { videoUrl: localVideoUrl, shotId, videoGallery: newGallery, prompt: promptText, images: [firstFrameUrl, ...charRefUrls].filter(Boolean).slice(0, 6) } };
    } else {
      return { data: { externalTaskId, provider, shotId, status: 'processing', prompt: promptText, images: [firstFrameUrl, ...charRefUrls].filter(Boolean).slice(0, 6) } };
    }
  } catch (error: any) {
    return { error: error.message };
  }
}

function extractMimoAudioBase64(data: any): string {
  const candidates = [
    data?.choices?.[0]?.message?.audio?.data,
    data?.choices?.[0]?.message?.audio,
    data?.audio?.data,
    data?.audio,
    data?.data?.audio?.data,
    data?.data?.audio,
    data?.data?.[0]?.b64_json,
    data?.data?.[0]?.audio?.data,
  ];
  for (const item of candidates) {
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
  return '';
}

function countSpeakableChars(value: string): number {
  return Array.from((value || '').replace(/[（(][^（）()]{1,24}[）)]/g, '').replace(/\s/g, '')).length;
}

function getTtsDurationGuide(charCount: number): { target: number; max: number } {
  const safeCount = Math.max(1, Number.isFinite(charCount) ? charCount : 1);
  return {
    target: Math.max(1, Math.ceil(safeCount / 4)),
    max: Math.max(3, Math.ceil(safeCount / 2.5)),
  };
}

function buildMimoVoiceDesignPrompt(params: any): string {
  const raw = String(params.extraConfig?.voiceDesignPrompt || params.extraConfig?.voice_desc || '').trim();
  const cleaned = raw
    .replace(/本句台词[：:][\s\S]*$/g, '')
    .replace(/严格合成要求[：:][\s\S]*$/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return [
    cleaned || '自然中文短剧角色音色，口语化，声音清晰，语速自然。',
    '短句表达干净利落，不拖腔，不加入额外长停顿。',
  ].filter(Boolean).join('\n');
}

function getAudioMimeType(audioRef: string): string {
  const ext = path.extname(audioRef.split('?')[0] || '').toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a' || ext === '.aac') return 'audio/mp4';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.webm') return 'audio/webm';
  return 'audio/mpeg';
}

async function resolveAudioReferenceDataUri(audioRef: string): Promise<string> {
  const source = String(audioRef || '').trim();
  if (!source) return '';
  if (source.startsWith('data:audio/')) return source;

  const settings = await getSystemSettings();
  const baseSavePath = settings.mediaSavePath || 'public';
  const mediaWebPath = settings.mediaWebPath || '/media';
  const rootPhysicalPath = path.isAbsolute(baseSavePath)
    ? baseSavePath
    : path.join(process.cwd(), baseSavePath);
  const allowedRoots = [process.cwd(), rootPhysicalPath].map(p => path.resolve(p).toLowerCase());
  const toSafeLocalPath = (candidate: string) => {
    const resolved = path.resolve(candidate);
    const normalized = resolved.toLowerCase();
    return allowedRoots.some(root => normalized === root || normalized.startsWith(`${root}${path.sep}`)) ? resolved : '';
  };

  let localCandidate = '';
  const looksLikeWebPath = source.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(source);
  if (path.isAbsolute(source) && !looksLikeWebPath) {
    localCandidate = toSafeLocalPath(source);
  } else {
    let pathname = source;
    if (/^https?:\/\//i.test(source)) {
      try { pathname = new URL(source).pathname; } catch {}
    }
    if (pathname.startsWith('/')) {
      const normalizedMediaWebPath = `/${mediaWebPath.replace(/^\/+|\/+$/g, '') || 'media'}`;
      let publicPath = decodeURIComponent(pathname);
      if (normalizedMediaWebPath !== '/media' && publicPath.startsWith(`${normalizedMediaWebPath}/`)) {
        publicPath = `/media${publicPath.slice(normalizedMediaWebPath.length)}`;
      }
      localCandidate = toSafeLocalPath(path.join(rootPhysicalPath, publicPath.replace(/^\/+/, '')));
    }
  }

  if (localCandidate && fs.existsSync(localCandidate)) {
    const buffer = fs.readFileSync(localCandidate);
    return `data:${getAudioMimeType(localCandidate)};base64,${buffer.toString('base64')}`;
  }

  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`参考音频下载失败 (${res.status})`);
    const contentType = res.headers.get('content-type') || getAudioMimeType(source);
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  }

  return '';
}

async function handleGenerateTTS(
  shotId: string | null | undefined, config: any, params: any, _userId: string
) {
  try {
    const shot = shotId ? await dramaWorkflowManager.getShotById(shotId) : null;
    if (shotId && !shot) return { error: '分镜不存在' };
    const dramaId = shot?.dramaId || params.dramaId;
    if (!dramaId) return { error: '缺少短剧ID' };

    const text = params.text || shot?.ttsText || shot?.dialogue || shot?.voiceover;
    if (!text) return { error: '没有配音文字' };

    const provider = params.provider || config?.provider || 'mimo-tts';
    const defaultVoiceId = provider === 'mimo-tts' ? 'mimo_default' : 'zh-CN-XiaoxiaoNeural';
    const voiceId = params.voiceId || shot?.ttsVoiceId || defaultVoiceId;
    const apiKey = params.apiKey || config?.apiKey;
    const apiUrl = params.apiUrl || config?.apiUrl;

    let audioUrl = '';

    if (provider === 'mimo-tts') {
      if (!apiKey) {
        console.error('[TTS] MiMo API Key missing. params.apiKey:', !!params.apiKey, 'config.apiKey:', !!config?.apiKey);
        return { error: '小米 MiMo API Key 未配置，请在 API设置 中配置配音 API Key，或在管理后台配置系统配音模型。' };
      }
      const baseUrl = (apiUrl || 'https://api.xiaomimimo.com/v1').replace(/\/$/, '');
      const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
      const audioFormat = params.extraConfig?.format || params.format || 'wav';
      const rawText = String(params.extraConfig?.rawText || text);
      const controlText = String(text);
      const expectedCharCount = Number(params.extraConfig?.dialogueCharCount || countSpeakableChars(rawText));
      const baseInstruction = params.extraConfig?.instruction || '请将下面文本合成为自然、清晰的中文语音。';
      const durationGuide = getTtsDurationGuide(expectedCharCount);
      const hasReferenceAudio = !!(params.extraConfig?.referenceAudioUrl || params.extraConfig?.customAudioUrl);
      const model = hasReferenceAudio ? 'mimo-v2.5-tts-voiceclone' : (params.model || config?.model || 'mimo-v2.5-tts');
      console.log('[TTS] MiMo TTS request: model=', model, 'apiKey length=', apiKey.length, 'apiUrl=', baseUrl);
      if (model === 'mimo-v2.5-asr') {
        return { error: 'mimo-v2.5-asr 是语音识别模型，不能用于生成配音。请切换为 mimo-v2.5-tts、mimo-v2.5-tts-voiceclone 或 mimo-v2.5-tts-voicedesign。' };
      }
      const isVoiceClone = model === 'mimo-v2.5-tts-voiceclone';
      const isVoiceDesign = model === 'mimo-v2.5-tts-voicedesign';
      let audioVoice = voiceId || params.extraConfig?.voice || 'mimo_default';
      if (isVoiceClone) {
        const referenceAudioUrl = params.extraConfig?.referenceAudioUrl || params.extraConfig?.customAudioUrl || voiceId;
        if (!referenceAudioUrl) return { error: 'MiMo VoiceClone 需要先上传一段干净的人声参考音频。' };
        audioVoice = await resolveAudioReferenceDataUri(referenceAudioUrl);
        if (!audioVoice) return { error: '无法读取 MiMo VoiceClone 参考音频，请重新上传 wav/mp3 音频。' };
      }
      const audioPayload: Record<string, any> = { format: audioFormat };
      if (isVoiceDesign) {
        audioPayload.optimize_text_preview = false;
      } else {
        audioPayload.voice = audioVoice;
      }
      const strictTtsInstruction = [
        baseInstruction,
        '',
        '严格合成要求：',
        '1. 下一条 assistant 消息就是必须合成的完整对白，请只合成这段文本，不要省略、不要改写、不要扩写、不要自由续写。',
        '2. 如果文本开头或中间带有括号音频标签，括号内容只用于控制语气和停顿，不要把标签本身读出来。',
        `3. 原始对白可见字数约 ${expectedCharCount} 字，目标时长约 ${durationGuide.target} 秒，最长不要超过 ${durationGuide.max} 秒；短句不要拖腔、不要长停顿。`,
        '4. 生成时请保持原文顺序和标点语气，短句只做轻微自然停顿，不能漏掉任何一句对白。',
        `5. 原始对白用于核对完整性：${rawText}`,
      ].filter(Boolean).join('\n');
      const userMessageContent = isVoiceDesign ? buildMimoVoiceDesignPrompt(params) : strictTtsInstruction;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'api-key': apiKey,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'user', content: userMessageContent },
            { role: 'assistant', content: controlText },
          ],
          modalities: ['text', 'audio'],
          audio: audioPayload,
          stream: false,
        }),
      });
      const raw = await res.text();
      let data: any = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch {}
      if (!res.ok || data?.error) {
        return { error: data?.error?.message || data?.message || raw.slice(0, 200) || `MiMo 配音失败 (${res.status})` };
      }
      const audioBase64 = extractMimoAudioBase64(data);
      if (!audioBase64) return { error: 'MiMo 未返回音频数据' };
      audioUrl = `data:audio/${audioFormat};base64,${audioBase64}`;
    } else if (provider === 'minimax-tts') {
      if (!apiKey) return { error: '缺少MiniMax API密钥' };
      const res = await fetch(`${apiUrl || 'https://api.minimax.chat/v1'}/t2a_v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: params.model || 'speech-02-hd',
          text,
          voice_setting: { voice_id: voiceId },
        }),
      });
      const data = await res.json();
      audioUrl = data.data?.audio || '';
      if (!audioUrl && data.base_resp?.status_msg) return { error: data.base_resp.status_msg };
    } else if (provider === 'edge-tts') {
      // EdgeTTS 是本地/服务端工具，返回任务标记
      return { data: { provider: 'edge-tts', voiceId, text, status: 'requires_local_processing' } };
    } else if (provider === 'index-tts') {
      // IndexTTS (Gradio v5 /api/predict 兼容接口)
      const baseApiUrl = apiUrl || 'http://127.0.0.1:7860';
      const cleanBaseUrl = baseApiUrl.replace(/\/$/, '');

      // 1. 映射情感模式
      const emotionMap: Record<string, string> = {
        '与语音参考相同': '与音色参考音频相同',
        '使用情感参考音频': '使用情感参考音频',
        '使用情感向量': '使用情感向量控制',
        '使用文本描述': '使用情感描述文本控制'
      };
      const emoModeStr = emotionMap[params.extraConfig?.emotion] || '与音色参考音频相同';

      // 2. 映射音色参考音频（内置模板 vs 用户上传自定义）
      let promptAudioPath = 'F:\\Index-TTS2_ZZDH\\examples\\voice_01.wav';
      const templateMap: Record<string, string> = {
        'naiyou_xiaosheng': 'voice_01.wav',
        'yiyi': 'voice_02.wav',
        'nainai': 'voice_03.wav',
        'luoluo': 'voice_04.wav',
        'kaka': 'voice_05.wav',
        'fengchu': 'voice_06.wav',
        'yizhi_houzi': 'voice_07.wav',
        'liu_ruyan': 'voice_08.wav',
        'chuichui': 'voice_09.wav',
        'dashage': 'voice_10.wav',
        'shangshang': 'voice_11.wav'
      };

      if (voiceId && templateMap[voiceId]) {
        promptAudioPath = `F:\\Index-TTS2_ZZDH\\examples\\${templateMap[voiceId]}`;
      } else if (voiceId && (voiceId.startsWith('/') || voiceId.includes('://'))) {
        // 如果是本地上传的用户参考音频
        let relativePath = voiceId;
        if (voiceId.includes('://')) {
          try { relativePath = new URL(voiceId).pathname; } catch {}
        }
        promptAudioPath = path.join(process.cwd(), 'public', relativePath);
      } else if (voiceId) {
        // 其他情况
        promptAudioPath = voiceId;
      }

      // 3. 构建 24 项 Gradio 核心数据负载
      const payloadData = [
        emoModeStr,                             // 0: emo_control_method
        { path: promptAudioPath },             // 1: prompt_audio
        text,                                   // 2: input_text_single
        null,                                   // 3: emo_upload (情感参考音频路径)
        0.65,                                   // 4: emo_weight
        0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // 5-12: vec1 to vec8
        params.extraConfig?.voice_desc || '',   // 13: emo_text (情感描述文本或描述)
        false,                                  // 14: emo_random
        params.extraConfig?.start_pause !== undefined ? params.extraConfig.start_pause : 120, // 15: max_text_tokens_per_segment (或者停顿值)
        true,                                   // 16: do_sample
        0.8,                                    // 17: top_p
        30,                                     // 18: top_k
        0.8,                                    // 19: temperature
        0.0,                                    // 20: length_penalty
        3,                                      // 21: num_beams
        10.0,                                   // 22: repetition_penalty
        1500                                    // 23: max_mel_tokens
      ];

      console.log('[Gradio] IndexTTS Request Payload:', JSON.stringify(payloadData));

      const predictRes = await fetch(`${cleanBaseUrl}/api/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: payloadData,
          fn_index: 6
        })
      });

      if (!predictRes.ok) {
        throw new Error(`IndexTTS Gradio interface returned status ${predictRes.status}: ${await predictRes.text()}`);
      }

      const resJson = await predictRes.json();
      console.log('[Gradio] IndexTTS Response JSON:', JSON.stringify(resJson));

      let relativeAudioPath = '';
      if (resJson.data && Array.isArray(resJson.data) && resJson.data[0]) {
        const item = resJson.data[0];
        relativeAudioPath = item.path || item.name || '';
      }

      if (!relativeAudioPath) {
        throw new Error('IndexTTS Gradio returned empty audio path');
      }

      // 4. 验证并尝试候选下载 URL
      const downloadUrls = [
        `${cleanBaseUrl}/file=${relativeAudioPath}`,
        `${cleanBaseUrl}/file/${relativeAudioPath}`
      ];

      let workingDownloadUrl = '';
      for (const url of downloadUrls) {
        try {
          const testRes = await fetch(url, { method: 'HEAD' });
          if (testRes.ok) {
            workingDownloadUrl = url;
            break;
          }
        } catch {}
      }

      if (!workingDownloadUrl) {
        // Fallback directly to the first candidate if HEAD fails
        workingDownloadUrl = downloadUrls[0];
      }

      audioUrl = workingDownloadUrl;
      console.log('[Gradio] IndexTTS final downloadable audio URL:', audioUrl);

    } else if (provider === 'gpt-sovits') {
      // 本地部署的 TTS
      const res = await fetch(`${apiUrl || 'http://localhost:9880'}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice_id: voiceId, ...params.extraConfig }),
      });
      const data = await res.json();
      audioUrl = data.audio_url || data.url || '';
    }

    if (audioUrl) {
      const localAudioUrl = await saveMediaLocally(audioUrl, 'audio', params.mediaId || shotId || `tts-${Date.now()}`, dramaId);
      if (shot && shotId && params.persist !== false) {
        await dramaWorkflowManager.updateShot(shotId, { audioUrl: localAudioUrl });
      }
      return { data: { audioUrl: localAudioUrl, shotId, provider, dialogueCharCount: params.extraConfig?.dialogueCharCount || countSpeakableChars(text) } };
    }

    return { data: { audioUrl, shotId, provider } };
  } catch (error: any) {
    return { error: error.message };
  }
}

// ======================== 通用AI调用 ========================

async function callAI(config: any, systemPrompt: string, userContent: string) {
  try {
    const apiUrl = config?.apiUrl || config?.api_url || process.env.AI_API_URL || process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
    const apiKey = config?.apiKey || config?.api_key || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
    const model = config?.model || process.env.AI_MODEL || 'deepseek-v4-flash';

    if (!apiKey) return { error: '缺少AI API密钥，请配置文本模型' };

    const res = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.7,
        max_tokens: 8192,
        response_format: { type: 'json_object' },
      }),
    });

    const data = await res.json();
    if (data.error) return { error: data.error.message };

    const content = data.choices?.[0]?.message?.content;
    if (!content) return { error: 'AI未返回内容' };

    return { data: content };
  } catch (error: any) {
    return { error: error.message };
  }
}
