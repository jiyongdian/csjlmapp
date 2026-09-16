/**
 * ComfyUI API 客户端
 * 支持 ComfyUI 工作流提交、轮询、下载等完整流程
 */

import { COMFYUI_SIZE_PRESETS, getComfyUISize } from './comfyui-presets';

export interface ComfyUIConfig {
  baseUrl: string;
  clientId?: string;
  wsConnectTimeout?: number;
}

export interface ComfyUIWorkflow {
  [nodeId: string]: {
    inputs: Record<string, any>;
    class_type: string;
    _meta?: Record<string, any>;
  };
}

export interface ComfyUIQueuePromptResponse {
  prompt_id: string;
  number: number;
  error?: any;
}

export interface ComfyUIHistoryEntry {
  prompt: {
    prompt_id: string;
    workflow: ComfyUIWorkflow;
    [key: string]: any;
  };
  outputs: Record<string, {
    class_type: string;
    outputs: Array<{
      name: string;
      type: string;
      value: any;
    }>;
  }>;
  status?: {
    status_str: string;
    completed: boolean;
    messages: Array<[string, any]>;
  };
}

export interface ComfyUIQueueResponse {
  queue_running: Array<any>;
  queue_pending: Array<any>;
}

function genClientId(): string {
  return 'web_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
}

/** 移除 ComfyUI 工作流中的 _meta 字段 */
function stripMeta(workflow: ComfyUIWorkflow): ComfyUIWorkflow {
  const result: ComfyUIWorkflow = {};
  for (const [key, node] of Object.entries(workflow)) {
    const { _meta, ...rest } = node;
    result[key] = rest;
  }
  return result;
}

/**
 * ComfyUI 客户端
 */
export class ComfyUIClient {
  private baseUrl: string;
  private clientId: string;

  constructor(config: ComfyUIConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.clientId = config.clientId || genClientId();
  }

  /** 获取服务器状态 */
  async getSystemStats(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/system_stats`);
    if (!res.ok) throw new Error(`ComfyUI 服务器错误: ${res.status}`);
    return res.json();
  }

  /** 获取节点信息 */
  async getObjectInfo(nodeClass: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/object_info/${encodeURIComponent(nodeClass)}`);
    if (!res.ok) throw new Error(`获取节点信息失败: ${res.status}`);
    return res.json();
  }

  /**
   * 上传图片到 ComfyUI 服务器
   * 返回文件名（供 LoadImage 节点使用）
   */
  async uploadImage(
    imageData: string, // base64 或 URL
    filename?: string,
    overwrite = true,
    localBaseUrl?: string  // 用于解析本地相对路径
  ): Promise<{ name: string; subfolder: string; type: string }> {
    let buffer: Buffer;
    let mimeType = 'image/png';
    let ext = 'png';

    if (!imageData || !imageData.trim()) {
      throw new Error('图片数据为空');
    }

    // data URI (base64 带前缀)
    if (imageData.startsWith('data:')) {
      const parts = imageData.split(',');
      const mimePart = parts[0];
      mimeType = mimePart.split(';')[0].replace('data:', '');
      ext = mimeType.split('/')[1] || 'png';
      buffer = Buffer.from(parts[1], 'base64');
    } else if (/^blob:/i.test(imageData)) {
      throw new Error('blob URL 无法在服务端解析，请先在前端转换为 data URI');
    } else if (/^\/\//.test(imageData) || /^https?:\/\//i.test(imageData)) {
      // URL - 先下载
      const url = imageData.startsWith('//') ? 'https:' + imageData : imageData;
      console.log(`[ComfyUI upload] 下载URL: ${url.slice(0, 120)}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`下载图片失败: ${res.status} ${url.slice(0, 100)}`);
      const contentType = res.headers.get('content-type') || 'image/png';
      mimeType = contentType.split(';')[0];
      ext = mimeType.split('/')[1] || 'png';
      const arrBuffer = await res.arrayBuffer();
      buffer = Buffer.from(arrBuffer);
      console.log(`[ComfyUI upload] URL下载完成: size=${buffer.length}bytes, type=${contentType}`);
    } else if (/^[A-Za-z0-9+/]+={0,2}$/.test(imageData) && imageData.length > 128) {
      // 纯 base64
      buffer = Buffer.from(imageData, 'base64');
    } else if (/^[\/\.]/.test(imageData) && localBaseUrl) {
      // 本地相对路径 - 用本地服务器地址解析
      const url = new URL(imageData, localBaseUrl).toString();
      console.log(`[ComfyUI upload] 下载本地路径: ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`下载本地图片失败: ${res.status} ${url}`);
      const contentType = res.headers.get('content-type') || 'image/png';
      mimeType = contentType.split(';')[0];
      ext = mimeType.split('/')[1] || 'png';
      const arrBuffer = await res.arrayBuffer();
      buffer = Buffer.from(arrBuffer);
      console.log(`[ComfyUI upload] 本地下载完成: size=${buffer.length}bytes, type=${contentType}`);
    } else {
      throw new Error(`不支持的图片数据格式: ${imageData.slice(0, 50)}...`);
    }

    const uploadName = filename || `upload_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    console.log(`[ComfyUI upload] 准备上传: ${uploadName}, size=${buffer.length}bytes, type=${mimeType}`);

    const formData = new FormData();
    formData.append('image', new Blob([new Uint8Array(buffer)], { type: mimeType }), uploadName);
    formData.append('type', 'input');
    formData.append('overwrite', overwrite ? 'true' : 'false');

    const res = await fetch(`${this.baseUrl}/upload/image`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error(`图片上传失败 (${res.status})`);
    const result = await res.json();
    console.log(`[ComfyUI upload] 上传成功: ${JSON.stringify(result)}`);
    return {
      name: result.name || uploadName,
      subfolder: result.subfolder || '',
      type: result.type || 'input',
    };
  }

  /**
   * 上传音频到 ComfyUI 服务器
   */
  async uploadAudio(
    audioData: string,
    filename?: string,
    overwrite = true
  ): Promise<{ name: string; subfolder: string; type: string }> {
    let buffer: Buffer;
    let mimeType = 'audio/mp4';
    let ext = 'mp4';

    if (audioData.startsWith('data:')) {
      const parts = audioData.split(',');
      const mimePart = parts[0];
      mimeType = mimePart.split(';')[0].replace('data:', '');
      ext = mimeType.split('/')[1] || 'mp4';
      buffer = Buffer.from(parts[1], 'base64');
    } else if (/^https?:\/\//i.test(audioData)) {
      const res = await fetch(audioData);
      const contentType = res.headers.get('content-type') || 'audio/mp4';
      mimeType = contentType.split(';')[0];
      ext = mimeType.split('/')[1] || 'mp4';
      const arrBuffer = await res.arrayBuffer();
      buffer = Buffer.from(arrBuffer);
    } else {
      throw new Error('不支持的音频数据格式');
    }

    const uploadName = filename || `audio_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;

    const formData = new FormData();
    formData.append('audio', new Blob([new Uint8Array(buffer)], { type: mimeType }), uploadName);
    formData.append('overwrite', overwrite ? 'true' : 'false');

    const res = await fetch(`${this.baseUrl}/upload/audio`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error(`音频上传失败 (${res.status})`);
    const result = await res.json();
    return {
      name: result.name || uploadName,
      subfolder: result.subfolder || '',
      type: result.type || 'input',
    };
  }

  /**
   * 提交工作流到队列
   */
  async queuePrompt(workflow: ComfyUIWorkflow): Promise<ComfyUIQueuePromptResponse> {
    const cleaned = stripMeta(workflow);
    
    // 调试：保存最终提交的 payload
    try {
      const directorNode = cleaned['12'] || cleaned['MiniMaxH3Director'];
      if (directorNode?.inputs?.timeline_data) {
        const td = typeof directorNode.inputs.timeline_data === 'string' 
          ? JSON.parse(directorNode.inputs.timeline_data) 
          : directorNode.inputs.timeline_data;
        console.log(`[ComfyUI Submit] task_type=${directorNode.inputs.task_type}`);
        console.log(`[ComfyUI Submit] global_prompt前100字: ${(directorNode.inputs.global_prompt||'').slice(0,100)}`);
        console.log(`[ComfyUI Submit] timelineMode=${td.timelineMode}`);
        console.log(`[ComfyUI Submit] global.refs=${(td.global?.refs||[]).map((r:any)=>r.imageFile)}`);
        console.log(`[ComfyUI Submit] global.genImage=${td.global?.genImage?.imageFile||'(空)'}`);
        // 保存到文件供人工检查
        const fs = await import('fs');
        const path = require('path');
        try {
          const debugDir = path.join(process.cwd(), 'debug');
          fs.mkdirSync(debugDir, { recursive: true });
          fs.writeFileSync(path.join(debugDir, 'workflow_payload.json'), JSON.stringify(cleaned, null, 2));
          console.log(`[ComfyUI Submit] 最终payload已保存到 debug/workflow_payload.json`);
        } catch {}
      }
    } catch(e) { console.warn('[ComfyUI Submit] 调试日志失败:', e); }
    
    const res = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: cleaned,
        client_id: this.clientId,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`ComfyUI 提交失败 (${res.status}): ${errText.slice(0, 500)}`);
    }
    return res.json();
  }

  /**
   * 查询历史记录
   */
  async getHistory(promptId: string): Promise<ComfyUIHistoryEntry | null> {
    const res = await fetch(`${this.baseUrl}/history/${promptId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const history = data[promptId];
    return history || null;
  }

  /**
   * 下载文件
   */
  async viewFile(
    filename: string,
    subfolder = '',
    type = 'output'
  ): Promise<ArrayBuffer> {
    const params = new URLSearchParams({ filename, subfolder, type });
    const res = await fetch(`${this.baseUrl}/view?${params.toString()}`);
    if (!res.ok) throw new Error(`文件下载失败 (${res.status})`);
    return res.arrayBuffer();
  }

  /**
   * 轮询任务完成
   * @param promptId 任务ID
   * @param intervalMs 轮询间隔
   * @param maxAttempts 最大轮询次数
   * @param onStatus 状态回调
   */
  async waitForCompletion(
    promptId: string,
    intervalMs = 3000,
    maxAttempts = 7200,
    onStatus?: (status: string, attempt: number) => void
  ): Promise<{ outputs: any; files: Array<{ filename: string; subfolder: string; type: string }> }> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, intervalMs));
      const history = await this.getHistory(promptId);

      if (!history) {
        onStatus?.(`等待任务入队... (${i + 1})`, i + 1);
        continue;
      }

      const status = history.status?.status_str || 'unknown';
      onStatus?.(`状态: ${status} (${i + 1})`, i + 1);

      // 检查是否完成
      if (history.status?.completed || status === 'success' || status === 'completed') {
        // 收集输出文件（兼容多种格式）
        const files: Array<{ filename: string; subfolder: string; type: string }> = [];
        for (const [nodeId, output] of Object.entries(history.outputs)) {
          if (!output || typeof output !== 'object') continue;
          const outAny = output as any;
          
          // 格式1: 标准节点 output.outputs
          if (outAny.outputs && Array.isArray(outAny.outputs)) {
            for (const out of outAny.outputs) {
              if (out?.value?.filename) {
                files.push({
                  filename: out.value.filename,
                  subfolder: out.value.subfolder || '',
                  type: out.value.type || 'output',
                });
              }
            }
          }
          // 格式2: VHS_VideoCombine gifs
          if (outAny.gifs && Array.isArray(outAny.gifs)) {
            for (const g of outAny.gifs) {
              if (g?.filename) {
                files.push({ filename: g.filename, subfolder: g.subfolder || '', type: g.type || 'output' });
              }
            }
          }
          // 格式3: SaveVideo videos
          if (outAny.videos && Array.isArray(outAny.videos)) {
            for (const v of outAny.videos) {
              if (v?.filename) {
                files.push({ filename: v.filename, subfolder: v.subfolder || '', type: v.type || 'output' });
              }
            }
          }
          // 格式4: images
          if (outAny.images && Array.isArray(outAny.images)) {
            for (const img of outAny.images) {
              if (img?.filename) {
                files.push({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
              }
            }
          }
        }

        console.log(`[ComfyUI] 任务完成，找到 ${files.length} 个输出文件`);
        return { outputs: history.outputs, files };
      }

      // 检查失败
      if (status === 'error' || status === 'failed') {
        const errorMsg = history.status?.messages
          ?.filter((m: any[]) => m[0] === 'execution_error' || m[0] === 'execution_start')
          ?.map((m: any[]) => JSON.stringify(m[1]))
          ?.join('\n') || '未知错误';
        throw new Error(`ComfyUI 任务失败: ${errorMsg}`);
      }
    }

    throw new Error(`ComfyUI 任务超时 (${maxAttempts} × ${intervalMs}ms)`);
  }

  /**
   * 下载输出视频并返回 Buffer
   * 支持多种 ComfyUI 输出格式：
   * - 标准节点: { outputs: [{ type, value: { filename, subfolder, type } }] }
   * - VHS_VideoCombine: { gifs: [{ filename, subfolder, type }] }
   * - SaveVideo: { videos: [{ filename, subfolder, type }] }
   */
  async downloadOutput(
    outputs: any,
    preferredType: 'video' | 'image' | 'audio' | 'gif' = 'video'
  ): Promise<{ buffer: ArrayBuffer; filename: string; mimeType: string; url: string } | null> {
    const mimeMap: Record<string, string> = {
      mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', gif: 'image/gif',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
      mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
    };

    // 从文件信息下载并返回
    const downloadFile = async (file: { filename: string; subfolder?: string; type?: string }) => {
      if (!file.filename) return null;
      const ft = file.type || 'output';
      const sf = file.subfolder || '';
      const buffer = await this.viewFile(file.filename, sf, ft);
      const ext = file.filename.split('.').pop()?.toLowerCase() || '';
      const mime = mimeMap[ext] || 'application/octet-stream';
      const url = `${this.baseUrl}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(sf)}&type=${encodeURIComponent(ft)}`;
      return { buffer, filename: file.filename, mimeType: mime, url };
    };

    // 收集所有文件信息（兼容多种输出格式）
    const allFiles: Array<{ filename: string; subfolder?: string; type?: string; ext: string }> = [];
    
    for (const [nodeId, output] of Object.entries(outputs)) {
      if (!output || typeof output !== 'object') continue;
      const outAny = output as any;

      // 格式1: 标准ComfyUI节点 - output.outputs 数组
      if (outAny.outputs && Array.isArray(outAny.outputs)) {
        for (const out of outAny.outputs) {
          if (out?.value && typeof out.value === 'object') {
            const file = out.value;
            const ext = (file.filename || '').split('.').pop()?.toLowerCase() || '';
            allFiles.push({ filename: file.filename, subfolder: file.subfolder, type: 'output', ext });
          }
        }
      }

      // 格式2: VHS_VideoCombine - output.gifs 数组
      if (outAny.gifs && Array.isArray(outAny.gifs)) {
        for (const file of outAny.gifs) {
          if (file?.filename) {
            const ext = file.filename.split('.').pop()?.toLowerCase() || '';
            allFiles.push({ filename: file.filename, subfolder: file.subfolder, type: file.type || 'output', ext });
          }
        }
      }

      // 格式3: SaveVideo - output.videos 数组
      if (outAny.videos && Array.isArray(outAny.videos)) {
        for (const file of outAny.videos) {
          if (file?.filename) {
            const ext = file.filename.split('.').pop()?.toLowerCase() || '';
            allFiles.push({ filename: file.filename, subfolder: file.subfolder, type: file.type || 'output', ext });
          }
        }
      }

      // 格式4: 直接是 images 数组（SaveImage等）
      if (outAny.images && Array.isArray(outAny.images)) {
        for (const file of outAny.images) {
          if (file?.filename) {
            const ext = file.filename.split('.').pop()?.toLowerCase() || '';
            allFiles.push({ filename: file.filename, subfolder: file.subfolder, type: file.type || 'output', ext });
          }
        }
      }
    }

    if (allFiles.length === 0) {
      console.log('[ComfyUI] downloadOutput: 未找到任何输出文件，outputs keys:', Object.keys(outputs));
      // 打印每个output的结构用于调试
      for (const [nodeId, output] of Object.entries(outputs)) {
        console.log(`[ComfyUI] 节点 ${nodeId} 结构:`, JSON.stringify(Object.keys(output || {})));
      }
      return null;
    }

    // 优先查找匹配类型的文件
    const extMatch: Record<string, string[]> = {
      video: ['mp4', 'mov', 'webm'],
      image: ['png', 'jpg', 'jpeg', 'webp'],
      audio: ['mp3', 'wav', 'm4a'],
      gif: ['gif', 'mp4', 'webm', 'mov'], // gif 类型通常包含视频
    };
    const allowedExts = extMatch[preferredType] || extMatch.video;
    
    const preferred = allFiles.find(f => allowedExts.includes(f.ext));
    if (preferred) {
      console.log(`[ComfyUI] 找到${preferredType}文件: ${preferred.filename}`);
      return downloadFile(preferred);
    }

    // 返回第一个文件（任何类型）
    const first = allFiles[0];
    console.log(`[ComfyUI] 返回首个文件: ${first.filename} (${first.ext})`);
    return downloadFile(first);
  }
}

/**
 * 通过 _meta.title 查找节点（支持中英文标题匹配）
 */
function findNodeByTitle(
  nodes: [string, any][],
  titles: string[]
): { _id: string; class_type: string; inputs: any; _meta?: any } | null {
  for (const [nodeId, node] of nodes) {
    const title = node._meta?.title || '';
    if (titles.some(t => title.includes(t) || title.toLowerCase().includes(t.toLowerCase()))) {
      return { _id: nodeId, ...node };
    }
  }
  return null;
}

/**
 * 通用工作流参数注入器
 * 支持任意 ComfyUI 工作流，自动按 class_type 查找节点并注入参数
 * 
 * 支持的节点类型映射：
 * - 文本提示：CLIPTextEncode, PromptNode, TextConcatenate
 * - 参考图：LoadImage, LoadImageMask, IPAdapter, CLIPVisionLoader
 * - 参考音频：LoadAudio
 * - 尺寸/分辨率：EmptyLatentImage, Note (含 width/height 输入)
 * - 种子：KSampler, CheckpointSampler, RandomNoise (含 seed/noise_seed 输入)
 * - 时长/运动：含 duration/motion/motion_duration 输入的节点
 */
export function injectParamsIntoWorkflow(
  workflow: ComfyUIWorkflow,
  params: {
    prompt: string;
    width?: number;
    height?: number;
    aspectRatio?: string;
    sizePresetIndex?: number;
    duration?: number;
    referenceImages?: Array<{ name: string; subfolder?: string; type?: string }>;
    referenceAudios?: Array<{ name: string; subfolder?: string; type?: string }>;
    seed?: number;
  }
): { workflow: ComfyUIWorkflow; injected: string[] } {
  const wf = JSON.parse(JSON.stringify(workflow));
  const injected: string[] = [];
  
  // 收集所有节点
  const nodes = Object.entries(wf) as [string, any][];
  
  // 1. 注入提示词（查找文本节点）
  const promptClasses = ['CLIPTextEncode', 'PromptNode', 'TextConcatenate', 'SDXLCLIPTextEncode', 'PrimitiveStringMultiline', 'PrimitiveString'];
  let promptInjected = false;
  for (const [nodeId, node] of nodes) {
    if (promptClasses.includes(node.class_type)) {
      // 支持 CLIPTextEncode.text / PrimitiveStringMultiline.value 等
      if (node.inputs?.text !== undefined) {
        node.inputs.text = params.prompt;
        promptInjected = true;
        injected.push(`节点${nodeId}(${node.class_type})→提示词(text)`);
        break;
      } else if (node.inputs?.value !== undefined && typeof node.inputs.value === 'string') {
        node.inputs.value = params.prompt;
        promptInjected = true;
        injected.push(`节点${nodeId}(${node.class_type})→提示词(value)`);
        break;
      }
    }
  }
  if (!promptInjected) {
    // 兜底：查找任何有 text 输入的节点
    for (const [nodeId, node] of nodes) {
      if (node.inputs?.text !== undefined && typeof node.inputs.text === 'string') {
        node.inputs.text = params.prompt;
        promptInjected = true;
        injected.push(`节点${nodeId}(兜底)→提示词`);
        break;
      }
      // 也检查 value 字段的字符串节点
      if (node.inputs?.value !== undefined && typeof node.inputs.value === 'string' && node.class_type?.startsWith('PrimitiveString')) {
        node.inputs.value = params.prompt;
        promptInjected = true;
        injected.push(`节点${nodeId}(兜底)→提示词(value)`);
        break;
      }
    }
  }

  // 2. 注入参考图（查找 LoadImage/IPAdapter 节点）
  const imageClasses = ['LoadImage', 'LoadImageMask', 'IPAdapter', 'CLIPVisionLoader', 'LoadImageBatch'];
  const refImages = params.referenceImages || [];
  let imgIdx = 0;
  for (const [nodeId, node] of nodes) {
    if (imageClasses.includes(node.class_type) && node.inputs?.image !== undefined) {
      if (imgIdx < refImages.length) {
        node.inputs.image = refImages[imgIdx].name;
        if (refImages[imgIdx].subfolder) node.inputs.subfolder = refImages[imgIdx].subfolder;
        if (refImages[imgIdx].type) node.inputs.type = refImages[imgIdx].type;
        injected.push(`节点${nodeId}(${node.class_type})→参考图${imgIdx + 1}`);
        imgIdx++;
      } else {
        // 清空多余的参考图节点（使用空字符串而非硬编码图）
        if (node.inputs.image && node.inputs.image !== 'example.png') {
          node.inputs.image = 'example.png';
          injected.push(`节点${nodeId}(${node.class_type})→清空多余参考图`);
        }
      }
    }
  }
  
  // 也处理 IPAdapter 权重
  let ipIdx = 0;
  for (const [nodeId, node] of nodes) {
    if (node.class_type === 'IPAdapter' && node.inputs?.weight !== undefined) {
      if (ipIdx < refImages.length) {
        injected.push(`节点${nodeId}(IPAdapter)→权重`);
        ipIdx++;
      }
    }
  }

  // 3. 注入参考音频
  const audioClasses = ['LoadAudio', 'LoadAudioUpload'];
  const refAudios = params.referenceAudios || [];
  let audioIdx = 0;
  for (const [nodeId, node] of nodes) {
    if (audioClasses.includes(node.class_type) && node.inputs?.audio !== undefined) {
      if (audioIdx < refAudios.length) {
        node.inputs.audio = refAudios[audioIdx].name;
        if (refAudios[audioIdx].subfolder) node.inputs.subfolder = refAudios[audioIdx].subfolder;
        if (refAudios[audioIdx].type) node.inputs.type = refAudios[audioIdx].type;
        injected.push(`节点${nodeId}(${node.class_type})→参考音频${audioIdx + 1}`);
        audioIdx++;
      }
    }
  }

  // 4. 注入尺寸（支持 ResolutionSelector / EmptyLatentImage / Note / PrimitiveInt）
  const aspectRatioMap: Record<string, string> = {
    '16:9': '16:9 (Widescreen)',
    '9:16': '9:16 (Portrait)',
    '1:1': '1:1 (Square)',
    '4:3': '4:3',
    '3:4': '3:4',
    '21:9': '21:9 (Cinema)',
  };

  // 4a. 优先处理 ResolutionSelector 节点（MiniMax H3 工作流专用）
  const resolutionNode = nodes.find(([_, n]) => n.class_type === 'ResolutionSelector');
  if (resolutionNode) {
    const [nodeId, node] = resolutionNode;
    if (params.aspectRatio && node.inputs?.aspect_ratio !== undefined) {
      const mapped = aspectRatioMap[params.aspectRatio] || params.aspectRatio;
      node.inputs.aspect_ratio = mapped;
      injected.push(`节点${nodeId}(ResolutionSelector)→宽高比: ${mapped}`);
    }
    if (params.sizePresetIndex !== undefined && node.inputs?.megapixels !== undefined) {
      const preset = COMFYUI_SIZE_PRESETS[params.sizePresetIndex] || COMFYUI_SIZE_PRESETS[2];
      node.inputs.megapixels = preset.megapixels;
      injected.push(`节点${nodeId}(ResolutionSelector)→像素: ${preset.label} (${preset.megapixels}MP)`);
    }
  }
  
  // 4b. 传统宽高注入（如果没有 ResolutionSelector）
  if (!resolutionNode) {
    if (params.width) {
      for (const [nodeId, node] of nodes) {
        if ((node.class_type === 'EmptyLatentImage' || node.class_type === 'Note') && 
            node.inputs?.width !== undefined) {
          node.inputs.width = params.width;
          injected.push(`节点${nodeId}(${node.class_type})→宽度${params.width}`);
          break;
        }
      }
      const widthNode = findNodeByTitle(nodes, ['宽度', 'width', 'Width', 'WIDTH']);
      if (widthNode && (widthNode.class_type === 'PrimitiveInt' || widthNode.class_type === 'PrimitiveFloat')) {
        widthNode.inputs.value = params.width;
        injected.push(`节点${widthNode._id}(${widthNode.class_type})→宽度${params.width}(Primitive)`);
      }
      for (const [nodeId, node] of nodes) {
        if (node.inputs?.width !== undefined && 
            (typeof node.inputs.width === 'number' || node.inputs.width?.toString()?.match(/^\d+$/))) {
          node.inputs.width = params.width;
          injected.push(`节点${nodeId}(兜底)→宽度`);
          break;
        }
      }
    }
    if (params.height) {
      for (const [nodeId, node] of nodes) {
        if ((node.class_type === 'EmptyLatentImage' || node.class_type === 'Note') && 
            node.inputs?.height !== undefined) {
          node.inputs.height = params.height;
          injected.push(`节点${nodeId}(${node.class_type})→高度${params.height}`);
          break;
        }
      }
      const heightNode = findNodeByTitle(nodes, ['高度', 'height', 'Height', 'HEIGHT']);
      if (heightNode && (heightNode.class_type === 'PrimitiveInt' || heightNode.class_type === 'PrimitiveFloat')) {
        heightNode.inputs.value = params.height;
        injected.push(`节点${heightNode._id}(${heightNode.class_type})→高度${params.height}(Primitive)`);
      }
      for (const [nodeId, node] of nodes) {
        if (node.inputs?.height !== undefined &&
            (typeof node.inputs.height === 'number' || node.inputs.height?.toString()?.match(/^\d+$/))) {
          node.inputs.height = params.height;
          injected.push(`节点${nodeId}(兜底)→高度`);
          break;
        }
      }
    }
  }

  // 4.1 注入时长
  if (params.duration) {
    // 查找 PrimitiveFloat/PrimitiveInt 节点（通过 _meta.title 识别时长）
    const durationNode = findNodeByTitle(nodes, ['时长', 'duration', 'Duration', 'DURATION', 'Float (Duration)', 'Duration Float']);
    if (durationNode && (durationNode.class_type === 'PrimitiveInt' || durationNode.class_type === 'PrimitiveFloat')) {
      durationNode.inputs.value = params.duration;
      injected.push(`节点${durationNode._id}(${durationNode.class_type})→时长${params.duration}s(Primitive)`);
    }
    
    // 也处理 Vid2Vid/ModelSampler 等视频节点
    const durationClasses = ['Vid2Vid', 'ModelSampler', 'VideoHelper'];
    for (const [nodeId, node] of nodes) {
      if (durationClasses.includes(node.class_type) && node.inputs?.duration !== undefined) {
        node.inputs.duration = params.duration;
        injected.push(`节点${nodeId}(${node.class_type})→时长${params.duration}s`);
        break;
      }
    }
    // 兜底：查找任何有 duration 输入的节点
    for (const [nodeId, node] of nodes) {
      if (node.inputs?.duration !== undefined && 
          (typeof node.inputs.duration === 'number' || 
           (typeof node.inputs.duration === 'string' && node.inputs.duration.match(/^\d+$/)))) {
        node.inputs.duration = params.duration;
        injected.push(`节点${nodeId}(兜底)→时长${params.duration}s`);
        break;
      }
    }
    // 查找 motion 相关
    for (const [nodeId, node] of nodes) {
      if (node.inputs?.motion_duration !== undefined) {
        node.inputs.motion_duration = params.duration;
        injected.push(`节点${nodeId}→运动时长`);
        break;
      }
      if (node.inputs?.motion !== undefined && typeof node.inputs.motion === 'number') {
        node.inputs.motion = params.duration;
        injected.push(`节点${nodeId}→运动`);
        break;
      }
    }
  }

  // 5. 注入种子
  if (params.seed) {
    const seedClasses = ['KSampler', 'CheckpointSampler', 'RandomNoise', 'KSamplerWithRef', 'KSamplerAdvanced'];
    for (const [nodeId, node] of nodes) {
      if (seedClasses.includes(node.class_type)) {
        if (node.inputs?.seed !== undefined) {
          node.inputs.seed = params.seed;
          injected.push(`节点${nodeId}(${node.class_type})→种子`);
          break;
        } else if (node.inputs?.noise_seed !== undefined) {
          node.inputs.noise_seed = params.seed;
          injected.push(`节点${nodeId}(${node.class_type})→种子`);
          break;
        }
      }
    }
    // 兜底
    for (const [nodeId, node] of nodes) {
      if (node.inputs?.seed !== undefined && typeof node.inputs.seed === 'number') {
        node.inputs.seed = params.seed;
        injected.push(`节点${nodeId}(兜底)→种子`);
        break;
      }
      if (node.inputs?.noise_seed !== undefined && typeof node.inputs.noise_seed === 'number') {
        node.inputs.noise_seed = params.seed;
        injected.push(`节点${nodeId}(兜底)→种子`);
        break;
      }
    }
  }

  // 6. 视频专用节点标记
  const videoClasses = ['MotionBrush', 'AnimateDiff', 'Vid2Vid', 'VideoHelper'];
  for (const [nodeId, node] of nodes) {
    if (videoClasses.includes(node.class_type)) {
      injected.push(`节点${nodeId}(${node.class_type})→视频节点`);
    }
  }

  // 7. MiniMaxH3Director 节点处理（全新 Director 模式工作流）
  const directorNode = nodes.find(([_, n]) => n.class_type === 'MiniMaxH3Director');
  if (directorNode) {
    const [nodeId, node] = directorNode;
    const refImages = params.referenceImages || [];
    const hasRefImages = refImages.length > 0;
    const effectiveWidth = params.width || 864;
    const effectiveHeight = params.height || 480;
    const effectiveDuration = (params.duration != null) ? params.duration : 5;
    const effectiveFrameRate = 24;
    const effectiveTotalFrames = Math.max(124, Math.round(effectiveDuration * effectiveFrameRate));
    console.log(`[H3 Duration] params.duration=${params.duration}, effectiveDuration=${effectiveDuration}, effectiveTotalFrames=${effectiveTotalFrames}`);
    // MiniMax H3 17k+5 网格吸附：有效值 = 17*k + 5
    // 支持向上/向下吸附，确保结果不超过预算
    const snapToGrid = (frames: number, minFrames = 124) => {
      const k = Math.max(7, Math.round((frames - 5) / 17));
      let result = 17 * k + 5;
      // 如果吸附后超过了原始值太多，尝试向下吸附
      if (result > frames && frames >= minFrames + 17) {
        const kDown = Math.max(7, Math.round((frames - 5) / 17) - 1);
        const downResult = 17 * kDown + 5;
        if (Math.abs(downResult - frames) <= Math.abs(result - frames)) {
          result = downResult;
        }
      }
      // 确保不低于最小帧
      if (result < minFrames) result = minFrames;
      return result;
    };
    const actualTotalFrames = snapToGrid(effectiveTotalFrames);
    const actualDuration = actualTotalFrames / effectiveFrameRate;
    console.log(`[H3 Duration] snapToGrid(${effectiveTotalFrames})=${actualTotalFrames}, actualDuration=${actualDuration}s`);
    
    // 每段固定 124 帧（5秒 @24fps），计算需要的段数
    const segmentFrameCount = 124;
    const numSegments = Math.max(1, Math.round(actualTotalFrames / segmentFrameCount));
    
    // 根据 h3Mode 决定任务模式（优先于参考图自动检测）
    // 确切值来自 ComfyUI /object_info (MiniMaxH3Director.task_type COMBO)
    // T2VA → 强制 t2v, Ref2VA/I2VA/FL2VA/L2VA → 强制 r2v, auto → 根据参考图自动判断
    const h3Mode = (params as any).h3Mode || 'auto';
    let forceMode: 't2v' | 'r2v' | null = null;
    if (h3Mode === 'T2VA') {
      forceMode = 't2v';
    } else if (['Ref2VA', 'I2VA', 'FL2VA', 'L2VA'].includes(h3Mode)) {
      forceMode = 'r2v';
    }
    const useR2V = forceMode ? (forceMode === 'r2v') : hasRefImages;
    const targetTaskType = useR2V
      ? 'r2v — 参考主体生视频(Reference to Video)' 
      : 't2v — 文生视频(Text to Video)';
    const targetWsKey = useR2V ? 'r2v' : 't2v';
    console.log(`[H3 Director] h3Mode=${h3Mode}, forceMode=${forceMode}, hasRefImages=${hasRefImages}, taskType=${targetWsKey}`);
    
    // 注入 task_type 到节点输入（COMBO 类型必须是纯字符串）
    if (node.inputs?.task_type !== undefined) {
      node.inputs.task_type = targetTaskType;
      injected.push(`节点${nodeId}(MiniMaxH3Director)→task_type: ${targetTaskType}`);
    }
    
    // 注入提示词
    if (node.inputs?.global_prompt !== undefined) {
      node.inputs.global_prompt = params.prompt;
      injected.push(`节点${nodeId}(MiniMaxH3Director)→global_prompt`);
    }
    
    // 注入种子
    if (params.seed !== undefined && node.inputs?.seed !== undefined) {
      node.inputs.seed = params.seed;
      injected.push(`节点${nodeId}(MiniMaxH3Director)→seed:${params.seed}`);
    }
    
    // 注入尺寸（节点级别）
    if (node.inputs?.width !== undefined) {
      node.inputs.width = effectiveWidth;
      injected.push(`节点${nodeId}(MiniMaxH3Director)→width:${effectiveWidth}`);
    }
    if (node.inputs?.height !== undefined) {
      node.inputs.height = effectiveHeight;
      injected.push(`节点${nodeId}(MiniMaxH3Director)→height:${effectiveHeight}`);
    }
    if (node.inputs?.total_frames !== undefined) {
      node.inputs.total_frames = actualTotalFrames;
      injected.push(`节点${nodeId}(MiniMaxH3Director)→total_frames:${actualTotalFrames} (${numSegments}段×${segmentFrameCount}帧)`);
    }
    if (node.inputs?.frame_rate !== undefined) {
      node.inputs.frame_rate = effectiveFrameRate;
    }
    
    // 注入参考图到 timeline_data（核心逻辑）
    if (node.inputs?.timeline_data !== undefined) {
      try {
        // 根据任务模式构建不同的 timeline_data 结构
        let td: any;
        
        if (!hasRefImages) {
          // t2v 模式：基于原始结构，移除视频相关部分
          td = typeof node.inputs.timeline_data === 'string' 
            ? JSON.parse(node.inputs.timeline_data) 
            : node.inputs.timeline_data;
          
          // 更新全局尺寸和帧数
          td.width = effectiveWidth;
          td.height = effectiveHeight;
          td.totalFrames = actualTotalFrames;
          td.frameRate = effectiveFrameRate;
          td.durationSec = actualDuration;
          
          // 更新 global 对象
          if (td.global) {
            td.global.taskType = targetTaskType;
            td.global.prompt = params.prompt;
            td.global.refs = [];
            td.global.referenceVideo = {};
            td.global.refVideos = [];
            td.global.sourceWidth = effectiveWidth;
            td.global.sourceHeight = effectiveHeight;
          }
          
          // 更新 video 对象（保持结构但清空帧）
          if (td.video) {
            td.video.frames = [];
            td.video.frameMap = [];
            td.video.fileName = '';
            td.video.videoFile = '';
            td.video.sourceFrameCount = actualTotalFrames;
            td.video.width = effectiveWidth;
            td.video.height = effectiveHeight;
            td.video.storageWidth = effectiveWidth;
            td.video.storageHeight = effectiveHeight;
          }
          
          // 更新 gen.defaultFrameCount
          // 对于 t2v 模式：Director 只生成 1 segment，所以 defaultFrameCount = 总帧数
          // 对于 r2v 模式：Director 基于 keyframes/shots 生成多段，每段 124 帧
          if (td.gen) {
            td.gen.defaultFrameCount = hasRefImages ? segmentFrameCount : actualTotalFrames;
          }
          
          // 更新 output 对象
          if (td.output) {
            td.output.width = effectiveWidth;
            td.output.height = effectiveHeight;
            td.output.storageWidth = effectiveWidth;
            td.output.storageHeight = effectiveHeight;
          }
          
          // t2v 模式清空 keyframes/shots（Director t2v 只用 gen.defaultFrameCount）
          td.keyframes = [];
          td.shots = [];
          td.segments = [];
          
          // t2v 模式始终使用 solo 模式（单段生成，Director t2v 不支持多段）
          td.batchDetailMode = 'solo';
          
          // timelineMode 保持模板原始值 'prompt_batch'，不要改为 'global'
          // MiniMaxH3Director 插件期望 prompt_batch 模式，这样才会读取 batchWorkspaces 中的 per-segment refs 和 prompt
          
          console.log(`[H3 t2v模式] duration=${effectiveDuration}s, total_frames=${actualTotalFrames}, gen.defaultFrameCount=${td.gen?.defaultFrameCount}, batchDetailMode=solo`);
          
          // 更新 batchWorkspaces（t2v 模式下 Director 只用 gen.defaultFrameCount，不需要多段）
          if (td.batchWorkspaces) {
            const newBatchWorkspaces: Record<string, any> = {};
            for (const [wsKey, wsValue] of Object.entries(td.batchWorkspaces)) {
              const ws = wsValue as any;
              const newKey = targetWsKey;
              
              // 更新 globalCommon
              if (ws.globalCommon) {
                ws.globalCommon.prompt = params.prompt;
                ws.globalCommon.refs = [];
                ws.globalCommon.refVideos = [];
                ws.globalCommon.commonEnabled = true;
                ws.globalCommon.commonCollapsed = true;
              }
              
              // t2v 模式只创建 1 个 segment（Director t2v 用 gen.defaultFrameCount，多段无效）
              ws.segments = [{
                id: `seg_${Date.now()}_0`,
                start: 0,
                length: actualTotalFrames,
                frameCount: actualTotalFrames,
                durationSec: actualTotalFrames / effectiveFrameRate,
                prompt: params.prompt,
                negativePrompt: '',
                taskType: targetTaskType,
                refs: [],
                refAudios: [],
                refVideos: [],
                genImage: { imageFile: '', fileName: '' },
                continuityFromPrev: false,
                refImageSize: 'match',
                referenceVideo: { videoFile: '', fileName: '', type: 'input', subfolder: '' },
                _videoFrameCount: actualTotalFrames,
                previewFps: effectiveFrameRate,
                previewLive: false,
                previewStep: 3,
                previewTotalSteps: 3,
              }];
              ws.selectedIndex = 0;
              
              newBatchWorkspaces[newKey] = ws;
              break;
            }
            td.batchWorkspaces = newBatchWorkspaces;
          }
          
          // 更新 videoWorkspaces
          if (td.videoWorkspaces) {
            const newVideoWorkspaces: Record<string, any> = {};
            for (const [wsKey, wsValue] of Object.entries(td.videoWorkspaces)) {
              const ws = wsValue as any;
              const newKey = targetWsKey;
              
              ws.totalFrames = actualTotalFrames;
              ws.frameRate = effectiveFrameRate;
              ws.storageWidth = effectiveWidth;
              ws.storageHeight = effectiveHeight;
              ws.segments = [];
              
              if (ws.video) {
                ws.video.frames = [];
                ws.video.frameMap = [];
                ws.video.fileName = '';
                ws.video.videoFile = '';
                ws.video.sourceFrameCount = 0;
                ws.video.width = effectiveWidth;
                ws.video.height = effectiveHeight;
                ws.video.storageWidth = effectiveWidth;
                ws.video.storageHeight = effectiveHeight;
              }
              
              if (ws.globalCommon) {
                ws.globalCommon.prompt = params.prompt;
                ws.globalCommon.refs = [];
                ws.globalCommon.refVideos = [];
              }
              
              newVideoWorkspaces[newKey] = ws;
              break; // 只保留一个 workspace
            }
            td.videoWorkspaces = newVideoWorkspaces;
          }
          
          injected.push(`节点${nodeId}(MiniMaxH3Director)→t2v 基于原始结构修改完成`);
        } else {
          // r2v 模式：基于原始工作流结构，替换所有占位图
          td = typeof node.inputs.timeline_data === 'string' 
            ? JSON.parse(node.inputs.timeline_data) 
            : node.inputs.timeline_data;
          
          // 0. 更新全局尺寸（先保存原始值用于后续缩放）
          const originalTotalFrames = td.totalFrames || 367;
          td.width = effectiveWidth;
          td.height = effectiveHeight;
          td.totalFrames = actualTotalFrames;
          td.frameRate = effectiveFrameRate;
          
          // 关键：r2v 模式保持模板的 timelineMode 为 'prompt_batch'
          // MiniMaxH3Director 插件期望 prompt_batch 模式来读取 batchWorkspaces
          td.durationSec = actualDuration;
          
          // 关键修复：更新 gen.defaultFrameCount 为实际总帧数
          // r2v 模式下 Director 插件会读取此值来决定生成时长
          // 模板默认值 124 ≈ 5秒，必须改为实际帧数
          if (td.gen) {
            td.gen.defaultFrameCount = actualTotalFrames;
          }
          
          console.log(`[H3 r2v] 开始注入: refImages=${refImages.length}张, 尺寸=${effectiveWidth}x${effectiveHeight}, duration=${effectiveDuration}s, totalFrames=${actualTotalFrames}, defaultFrameCount=${td.gen?.defaultFrameCount}`);
          console.log(`[H3 r2v] refImages: ${refImages.map(r => r.name).join(', ')}`);
          console.log(`[H3 r2v] prompt (前200字): ${(params.prompt || '').slice(0, 200)}`);
          
          // 1. 更新 global 对象
          if (td.global) {
            td.global.taskType = targetTaskType;
            td.global.prompt = params.prompt;
            td.global.sourceWidth = effectiveWidth;
            td.global.sourceHeight = effectiveHeight;
            td.global.refs = refImages.map((img, idx) => ({
              index: idx,
              imageFile: img.name,
              fileName: '',
              type: img.type || 'input',
              subfolder: img.subfolder || '',
            }));
            td.global.referenceVideo = {};
            td.global.refVideos = [];
            td.global.genImage = { imageFile: refImages[0]?.name || '' };
            console.log(`[H3 r2v] global.refs[0..${refImages.length-1}]: ${refImages.map((r,i)=>`[${i}]=${r.name}`).join(', ')}`);
            console.log(`[H3 r2v] global.genImage: ${td.global.genImage.imageFile || '(空)'}`);
            injected.push(`节点${nodeId}(MiniMaxH3Director)→参考图已注入:${refImages.length}张 [${refImages.map(r=>r.name).join(',')}]`);
          }
          
          // 2. 更新 video 对象（r2v 不需要源视频，清空帧）
          if (td.video) {
            td.video.frames = [];
            td.video.frameMap = [];
            td.video.deletedSourceRanges = [];
            td.video.width = effectiveWidth;
            td.video.height = effectiveHeight;
            td.video.storageWidth = effectiveWidth;
            td.video.storageHeight = effectiveHeight;
            td.video.fileName = '';
            td.video.videoFile = '';
            td.video.sourceFrameCount = 0;
          }
          
          // 3. 更新 output 对象
          if (td.output) {
            td.output.width = effectiveWidth;
            td.output.height = effectiveHeight;
            td.output.storageWidth = effectiveWidth;
            td.output.storageHeight = effectiveHeight;
          }
          
          // 4. 缩放 keyframes 帧位置 + 替换占位图
          const scaleRatio = actualTotalFrames / originalTotalFrames;
          if (td.keyframes && Array.isArray(td.keyframes)) {
            let replacedCount = 0;
            for (let i = 0; i < td.keyframes.length; i++) {
              const kf = td.keyframes[i];
              const isEndFrame = kf.id && kf.id.endsWith('_e');
              const imgIdx = isEndFrame 
                ? Math.min(i, refImages.length - 1)
                : Math.floor(i / 2) % refImages.length;
              if (refImages[imgIdx]) {
                kf.imageFile = refImages[imgIdx].name;
                replacedCount++;
              }
              kf.width = effectiveWidth;
              kf.height = effectiveHeight;
              if (kf.start !== undefined) kf.start = Math.min(actualTotalFrames, Math.round(kf.start * scaleRatio));
              if (kf.length !== undefined) kf.length = Math.round(kf.length * scaleRatio);
              if (kf.frameCount !== undefined) kf.frameCount = Math.min(actualTotalFrames, Math.round(kf.frameCount * scaleRatio));
              if (kf.durationSec !== undefined) kf.durationSec = Math.round(kf.durationSec * actualDuration / (originalTotalFrames / 24) * 10) / 10;
            }
            injected.push(`节点${nodeId}(MiniMaxH3Director)→keyframes:${td.keyframes.length}个, 已替换${replacedCount}张参考图`);
          }
          
          // 5. 缩放 shots + 替换占位图
          if (td.shots && Array.isArray(td.shots)) {
            const origDurationSec = originalTotalFrames / effectiveFrameRate;
            let shotRefReplaced = 0;
            for (let i = 0; i < td.shots.length; i++) {
              const shot = td.shots[i];
              const startImgIdx = i % refImages.length;
              const endImgIdx = Math.min(i + 1, refImages.length - 1);
              if (shot.startImage && refImages[startImgIdx]) {
                shot.startImage.imageFile = refImages[startImgIdx].name;
                shot.startImage.width = effectiveWidth;
                shot.startImage.height = effectiveHeight;
                shotRefReplaced++;
              }
              if (shot.endImage && refImages[endImgIdx]) {
                shot.endImage.imageFile = refImages[endImgIdx].name;
                shot.endImage.width = effectiveWidth;
                shot.endImage.height = effectiveHeight;
                shotRefReplaced++;
              }
              if (shot.start !== undefined) shot.start = Math.min(actualTotalFrames, Math.round(shot.start * scaleRatio));
              if (shot.length !== undefined) shot.length = Math.round(shot.length * scaleRatio);
              if (shot.frameCount !== undefined) shot.frameCount = Math.min(actualTotalFrames, Math.round(shot.frameCount * scaleRatio));
              if (shot.durationSec !== undefined) {
                shot.durationSec = Math.round(shot.durationSec * actualDuration / origDurationSec * 10) / 10;
              }
            }
            injected.push(`节点${nodeId}(MiniMaxH3Director)→shots:${td.shots.length}个, 已替换${shotRefReplaced}张参考图`);
          }
          
          // 6. 修正 batchWorkspaces 键名
          if (td.batchWorkspaces) {
            const newBatchWorkspaces: Record<string, any> = {};
            for (const [wsKey, wsValue] of Object.entries(td.batchWorkspaces)) {
              const ws = wsValue as any;
              if (ws.globalCommon) {
                ws.globalCommon.refs = refImages.map((img, idx) => ({
                  index: idx,
                  imageFile: img.name,
                  fileName: '',
                  type: img.type || 'input',
                  subfolder: img.subfolder || '',
                }));
                ws.globalCommon.refVideos = [];
                if (params.prompt && ws.globalCommon.prompt) {
                  ws.globalCommon.prompt = params.prompt;
                }
              }
              if (ws.segments && Array.isArray(ws.segments)) {
                // 收集原始 segment frameCount
                const segFrames: number[] = [];
                for (const seg of ws.segments) {
                  segFrames.push(seg.frameCount || seg.length || segmentFrameCount);
                }
                const totalOrigSegFrames = segFrames.reduce((a, b) => a + b, 0);
                
                // 动态确定段数：每个段最少 124 帧
                const minPerSeg = 124;
                let segCount = segFrames.length;
                while (segCount > 1 && segCount * minPerSeg > actualTotalFrames) {
                  segCount--;
                }
                
                // 按原始比例分配 actualTotalFrames 到 segCount 个段
                const origWeights = segFrames.slice(0, segCount);
                const totalWeight = origWeights.reduce((a, b) => a + b, 0) || segCount;
                
                const snappedFrames: number[] = [];
                let allocated = 0;
                for (let i = 0; i < segCount; i++) {
                  const ratio = segFrames[i] / totalWeight;
                  let target = Math.round(ratio * actualTotalFrames);
                  target = snapToGrid(target);
                  // 确保不超过剩余可用帧数
                  const remainingBudget = actualTotalFrames - allocated - (segCount - i - 1) * minPerSeg;
                  if (target > remainingBudget) {
                    target = snapToGrid(Math.max(minPerSeg, remainingBudget));
                  }
                  snappedFrames.push(target);
                  allocated += target;
                }
                // 如果还有剩余预算，加到最后一段
                let totalSnapped = snappedFrames.reduce((a,b) => a+b, 0);
                const remaining = actualTotalFrames - totalSnapped;
                if (snappedFrames.length > 0 && remaining !== 0) {
                  const lastIdx = snappedFrames.length - 1;
                  let lastTarget = snappedFrames[lastIdx] + remaining;
                  // 约束 lastTarget 不超过剩余预算（即 actualTotalFrames - 已分配其他段）
                  const maxLastTarget = actualTotalFrames - snappedFrames.slice(0, -1).reduce((a,b)=>a+b, 0);
                  lastTarget = Math.min(lastTarget, maxLastTarget);
                  // snap 到最近有效值
                  snappedFrames[lastIdx] = snapToGrid(lastTarget);
                  // 如果仍然超出，强制向下 snap
                  totalSnapped = snappedFrames.reduce((a,b) => a+b, 0);
                  if (totalSnapped > actualTotalFrames) {
                    const excess = totalSnapped - actualTotalFrames;
                    snappedFrames[lastIdx] = Math.max(124, snappedFrames[lastIdx] - Math.ceil(excess / 17) * 17);
                  }
                }
                // 最终校验
                totalSnapped = snappedFrames.reduce((a,b) => a+b, 0);
                
                console.log(`[H3 r2v] segment 分配: segCount=${segCount}, snappedFrames=${JSON.stringify(snappedFrames)}, total=${snappedFrames.reduce((a,b)=>a+b,0)}`);
                
                // 截断到 segCount 个 segment
                while (ws.segments.length > segCount) {
                  ws.segments.pop();
                }
                
                let cumulativeStart = 0;
                for (let i = 0; i < ws.segments.length; i++) {
                  const seg = ws.segments[i];
                  const segFrame = snappedFrames[i];
                  seg.refs = refImages.map((img, idx) => ({
                    index: idx,
                    imageFile: img.name,
                    fileName: '',
                    type: img.type || 'input',
                    subfolder: img.subfolder || '',
                  }));
                  // 设置 genImage: 第一个 segment 用第一个角色参考图，后续 segment 用第一个参考图延续
                  seg.genImage = { imageFile: refImages[0]?.name || '', fileName: '' };
                  seg.referenceVideo = { videoFile: '', fileName: '', type: 'input', subfolder: '' };
                  seg.refVideos = [];
                  if (params.prompt && seg.prompt) {
                    seg.prompt = params.prompt;
                  }
                  seg.taskType = targetTaskType;
                  seg.refImageSize = 'match';
                  seg.start = cumulativeStart;
                  seg.length = segFrame;
                  seg.frameCount = segFrame;
                  if (seg._videoFrameCount !== undefined) {
                    seg._videoFrameCount = segFrame;
                  }
                  seg.durationSec = Math.round((segFrame / effectiveFrameRate) * 10) / 10;
                  if (!seg.prompt || seg.prompt.trim() === '') {
                    seg.prompt = params.prompt;
                  }
                  cumulativeStart += segFrame;
                  injected.push(`节点${nodeId}(MiniMaxH3Director)→segment[${i}]: start=${seg.start}, frames=${segFrame}(${seg.durationSec}s)`);
                }
              }
              const newKey = wsKey === 'r2v' || wsKey === 'rv2v' ? targetWsKey : wsKey;
              newBatchWorkspaces[newKey] = ws;
            }
            if (!newBatchWorkspaces[targetWsKey]) {
              newBatchWorkspaces[targetWsKey] = {
                selectedIndex: 0,
                editMode: 'segment',
                runSelectEnabled: false,
                runSelection: [],
                segments: [],
                globalCommon: {
                  commonEnabled: true,
                  commonCollapsed: true,
                  prompt: params.prompt,
                  refs: refImages.map((img, idx) => ({
                    index: idx,
                    imageFile: img.name,
                    fileName: '',
                    type: img.type || 'input',
                    subfolder: img.subfolder || '',
                  })),
                  refAudios: [],
                  refVideos: [],
                },
              };
            }
            td.batchWorkspaces = newBatchWorkspaces;
            injected.push(`节点${nodeId}(MiniMaxH3Director)→batchWorkspaces.${targetWsKey}: ${td.batchWorkspaces[targetWsKey]?.segments?.length || 0}段, ${td.batchWorkspaces[targetWsKey]?.globalCommon?.refs?.length || 0}张refs`);
          }
          
          // 7. 更新顶层 td.segments（关键！Director 插件可能读取此数组决定时长）
          if (td.segments && Array.isArray(td.segments)) {
            const wsSegments = td.batchWorkspaces?.[targetWsKey]?.segments || [];
            // 将 batchWorkspaces 的 segments 同步到顶层 segments
            if (wsSegments.length > 0) {
              td.segments = wsSegments.map((seg: any) => ({
                ...seg,
                start: seg.start || 0,
                length: seg.frameCount || seg.length || actualTotalFrames,
                frameCount: seg.frameCount || actualTotalFrames,
                durationSec: Math.round(((seg.frameCount || actualTotalFrames) / effectiveFrameRate) * 10) / 10,
              }));
              console.log(`[H3 r2v] 顶层 segments 已同步: ${td.segments.length}段, frameCount[0]=${td.segments[0]?.frameCount}, durationSec[0]=${td.segments[0]?.durationSec}`);
            } else if (td.segments.length > 0) {
              // 没有 workspace segments 时，更新现有 segment 的帧数
              for (const seg of td.segments) {
                seg.frameCount = actualTotalFrames;
                seg.length = actualTotalFrames;
                seg.durationSec = Math.round((actualTotalFrames / effectiveFrameRate) * 10) / 10;
              }
              console.log(`[H3 r2v] 顶层 segments 已更新: frameCount=${actualTotalFrames}, durationSec=${(actualTotalFrames / effectiveFrameRate).toFixed(2)}s`);
            }
          }
          
          // 设置 batchDetailMode 和 gen.defaultFrameCount
          const r2vSegments = td.batchWorkspaces?.[targetWsKey]?.segments?.length || 0;
          td.batchDetailMode = r2vSegments > 1 ? 'batch' : 'solo';
          
          if (td.gen) {
            // r2v 模式: 使用第一个 segment 的 frameCount 作为默认值
            const firstSegFrame = td.batchWorkspaces?.[targetWsKey]?.segments?.[0]?.frameCount || actualTotalFrames;
            td.gen.defaultFrameCount = firstSegFrame;
          }
          
          console.log(`[H3 r2v模式] duration=${effectiveDuration}s, total_frames=${actualTotalFrames}, gen.defaultFrameCount=${td.gen?.defaultFrameCount}, segments=${r2vSegments}, refs=${refImages.length}`);
          
          // 8. 修正 videoWorkspaces（不再跳过 rv2v，确保所有 workspace 的 prompt 和 refs 都被更新）
          if (td.videoWorkspaces) {
            const newVideoWorkspaces: Record<string, any> = {};
            for (const [wsKey, wsValue] of Object.entries(td.videoWorkspaces)) {
              const ws = wsValue as any;
              // 不再跳过 rv2v —— 所有 workspace 都需要更新 prompt 和 refs
              ws.storageWidth = effectiveWidth;
              ws.storageHeight = effectiveHeight;
              ws.totalFrames = actualTotalFrames;
              if (ws.video) {
                ws.video.frames = [];
                ws.video.frameMap = [];
                ws.video.deletedSourceRanges = [];
                ws.video.width = effectiveWidth;
                ws.video.height = effectiveHeight;
                ws.video.storageWidth = effectiveWidth;
                ws.video.storageHeight = effectiveHeight;
                ws.video.fileName = '';
                ws.video.videoFile = '';
                ws.video.sourceFrameCount = 0;
              }
              if (ws.globalCommon) {
                ws.globalCommon.prompt = params.prompt;
                ws.globalCommon.refs = refImages.map((img, idx) => ({
                  index: idx,
                  imageFile: img.name,
                  fileName: '',
                  type: img.type || 'input',
                  subfolder: img.subfolder || '',
                }));
                ws.globalCommon.refVideos = [];
              }
              const newKey = wsKey === 'r2v' || wsKey === 'rv2v' ? targetWsKey : wsKey;
              newVideoWorkspaces[newKey] = ws;
            }
            if (!newVideoWorkspaces[targetWsKey]) {
              newVideoWorkspaces[targetWsKey] = {
                selectedIndex: 0,
                currentFrame: 0,
                editMode: 'global',
                runSelectEnabled: false,
                runSelection: [],
                totalFrames: effectiveTotalFrames,
                frameRate: effectiveFrameRate,
                storageWidth: effectiveWidth,
                storageHeight: effectiveHeight,
                segments: [],
                video: {
                  fileName: '',
                  videoFile: '',
                  subfolder: '',
                  type: 'input',
                  frames: [],
                  frameMap: [],
                  deletedSourceRanges: [],
                  sourceFrameCount: 0,
                  width: effectiveWidth,
                  height: effectiveHeight,
                  storageWidth: effectiveWidth,
                  storageHeight: effectiveHeight,
                },
                videoClips: [],
                globalCommon: {
                  commonEnabled: false,
                  commonCollapsed: false,
                  prompt: params.prompt,
                  refs: refImages.map((img, idx) => ({
                    index: idx,
                    imageFile: img.name,
                    fileName: '',
                    type: img.type || 'input',
                    subfolder: img.subfolder || '',
                  })),
                  refAudios: [],
                  refVideos: [],
                },
              };
            }
            td.videoWorkspaces = newVideoWorkspaces;
          }
          
          // 最终验证：输出参考图注入详情
          const finalKeyframesWithRefs = (td.keyframes || []).filter((kf: any) => kf.imageFile && kf.imageFile !== '').length;
          const finalShotsWithRefs = (td.shots || []).filter((s: any) => 
            (s.startImage?.imageFile && s.startImage.imageFile !== '') || 
            (s.endImage?.imageFile && s.endImage.imageFile !== '')
          ).length;
          const batchWsRefs = td.batchWorkspaces?.[targetWsKey]?.globalCommon?.refs?.length || 0;
          const globalRefs = td.global?.refs?.length || 0;
          console.log(`[H3 r2v] 最终验证: global.refs=${globalRefs}, keyframes有图=${finalKeyframesWithRefs}/${td.keyframes?.length||0}, shots有图=${finalShotsWithRefs}/${td.shots?.length||0}, batchWs.refs=${batchWsRefs}`);
          console.log(`[H3 r2v] 参考图文件名: ${refImages.map(r=>r.name).join(', ')}`);
          
          injected.push(`节点${nodeId}(MiniMaxH3Director)→r2v 结构已构建`);
        }
        
        // 重新序列化
        node.inputs.timeline_data = JSON.stringify(td);
        
        // === 最终 payload 验证日志 ===
        const wfKey = targetWsKey;
        const debugInfo = {
          timelineMode: td.timelineMode,
          totalFrames: td.totalFrames,
          gen: { defaultFrameCount: td.gen?.defaultFrameCount },
          durationSec: td.durationSec,
          topSegments: (td.segments || []).map((s: any) => ({
            frameCount: s.frameCount,
            durationSec: s.durationSec,
            length: s.length,
          })),
          global: {
            taskType: td.global?.taskType,
            prompt: (td.global?.prompt || '').slice(0, 150),
            refs: (td.global?.refs || []).map((r: any) => r.imageFile),
            genImage: td.global?.genImage?.imageFile || '',
          },
          batchWorkspaces: {},
          videoWorkspaces: {},
        };
        // 计算 segment frameCount 总和
        const wsSegs = td.batchWorkspaces?.[wfKey]?.segments || [];
        const segFrameTotal = wsSegs.reduce((sum: number, s: any) => sum + (s.frameCount || 0), 0);
        debugInfo._segmentFrameTotal = segFrameTotal;
        debugInfo._expectedTotal = actualTotalFrames;
        if (td.batchWorkspaces?.[wfKey]) {
          const ws = td.batchWorkspaces[wfKey];
          debugInfo.batchWorkspaces[wfKey] = {
            globalCommon: {
              prompt: (ws.globalCommon?.prompt || '').slice(0, 100),
              refs: (ws.globalCommon?.refs || []).map((r: any) => r.imageFile),
            },
            segments: (ws.segments || []).map((seg: any) => ({
              start: seg.start,
              length: seg.length,
              frameCount: seg.frameCount,
              refs: (seg.refs || []).map((r: any) => r.imageFile),
              genImage: seg.genImage?.imageFile || '',
              taskType: seg.taskType,
            })),
          };
        }
        if (td.videoWorkspaces?.[wfKey]) {
          const ws = td.videoWorkspaces[wfKey];
          debugInfo.videoWorkspaces[wfKey] = {
            globalCommon: {
              prompt: (ws.globalCommon?.prompt || '').slice(0, 100),
              refs: (ws.globalCommon?.refs || []).map((r: any) => r.imageFile),
            },
          };
        }
        console.log(`[H3 最终验证] ${JSON.stringify(debugInfo, null, 2)}`);
        injected.push(`节点${nodeId}(MiniMaxH3Director)→timeline_data 已更新 (task_type=${targetTaskType}, refs=${td.global?.refs?.length || 0})`);
      } catch (err) {
        console.warn('[ComfyUI] timeline_data 解析失败:', err);
        injected.push(`节点${nodeId}(MiniMaxH3Director)→timeline_data 解析失败:${(err as Error).message}`);
      }
    }
    
    // 注入音频参考
    const refAudios = params.referenceAudios || [];
    if (refAudios.length > 0 && node.inputs?.timeline_data) {
      try {
        const td = typeof node.inputs.timeline_data === 'string' 
          ? JSON.parse(node.inputs.timeline_data) 
          : node.inputs.timeline_data;
        
        // 更新所有 globalCommon 中的 refAudios
        const updateRefAudios = (obj: any) => {
          if (obj?.refAudios) {
            obj.refAudios = refAudios.map((aud, idx) => ({
              index: idx,
              audioFile: aud.name,
              fileName: '',
              type: aud.type || 'input',
              subfolder: aud.subfolder || '',
            }));
          }
        };
        
        updateRefAudios(td.global);
        updateRefAudios(td.globalCommon);
        if (td.batchWorkspaces) {
          for (const ws of Object.values(td.batchWorkspaces) as any[]) {
            updateRefAudios(ws?.globalCommon);
          }
        }
        if (td.videoWorkspaces) {
          for (const ws of Object.values(td.videoWorkspaces) as any[]) {
            updateRefAudios(ws?.globalCommon);
          }
        }
        
        node.inputs.timeline_data = JSON.stringify(td);
        injected.push(`节点${nodeId}(MiniMaxH3Director)→refAudios:${refAudios.length}段`);
      } catch {}
    }
    
    injected.push(`节点${nodeId}(MiniMaxH3Director)→Director ${targetTaskType} 模式工作流已构建`);
  }

  return { workflow: wf, injected };
}

/**
 * 将 MiniMax H3 工作流模板实例化为可提交的工作流（保留以兼容旧工作流）
 * @param template 工作流模板
 * @param params 动态参数
 */
export function buildMiniMaxH3Workflow(
  template: ComfyUIWorkflow,
  params: {
    prompt: string;
    width?: number;
    height?: number;
    duration?: number;
    referenceImages?: Array<{ name: string; subfolder?: string; type?: string }>;
    referenceAudios?: Array<{ name: string; subfolder?: string; type?: string }>;
    seed?: number;
  }
): ComfyUIWorkflow {
  const workflow = JSON.parse(JSON.stringify(template));

  // 更新提示词（节点 "4" = Text）
  if (workflow['4']) {
    workflow['4'].inputs.text = params.prompt;
  }

  // 更新宽度（节点 "1"）
  if (params.width && workflow['1']) {
    workflow['1'].inputs.value = params.width;
  }

  // 更新高度（节点 "2"）
  if (params.height && workflow['2']) {
    workflow['2'].inputs.value = params.height;
  }

  // 更新时长（节点 "3"）
  if (params.duration && workflow['3']) {
    workflow['3'].inputs.value = params.duration;
  }

  // 更新种子（节点 "26" = RandomNoise）
  if (params.seed && workflow['26']) {
    workflow['26'].inputs.noise_seed = params.seed;
  }

  // 更新参考图片（节点 "6"-"14" = LoadImage）
  const imageNodes = ['6', '7', '8', '9', '10', '11', '12', '13', '14'];
  const refImages = params.referenceImages || [];
  imageNodes.forEach((nodeId, idx) => {
    if (workflow[nodeId]) {
      if (refImages[idx]) {
        workflow[nodeId].inputs.image = refImages[idx].name;
        if (refImages[idx].subfolder) {
          workflow[nodeId].inputs.subfolder = refImages[idx].subfolder;
        }
        if (refImages[idx].type) {
          workflow[nodeId].inputs.type = refImages[idx].type;
        }
      } else {
        // 清空多余的参考图
        workflow[nodeId].inputs.image = 'example.png';
      }
    }
  });

  // 更新参考音频（节点 "15"-"17" = LoadAudio）
  const audioNodes = ['15', '16', '17'];
  const refAudios = params.referenceAudios || [];
  audioNodes.forEach((nodeId, idx) => {
    if (workflow[nodeId]) {
      if (refAudios[idx]) {
        workflow[nodeId].inputs.audio = refAudios[idx].name;
        if (refAudios[idx].subfolder) {
          workflow[nodeId].inputs.subfolder = refAudios[idx].subfolder;
        }
        if (refAudios[idx].type) {
          workflow[nodeId].inputs.type = refAudios[idx].type;
        }
      } else {
        workflow[nodeId].inputs.audio = 'ComfyUI_00015_.mp4';
      }
    }
  });

  return workflow;
}

export { COMFYUI_SIZE_PRESETS, getComfyUISize } from './comfyui-presets';

/**
 * 获取默认的 MiniMax H3 多参工作流模板
 * 这是一个精简版模板，包含所有关键节点
 */
export function getDefaultMiniMaxH3Workflow(): ComfyUIWorkflow {
  return {
    "1": {
      "inputs": { "value": 864 },
      "class_type": "PrimitiveInt",
      "_meta": { "title": "宽度" }
    },
    "2": {
      "inputs": { "value": 480 },
      "class_type": "PrimitiveInt",
      "_meta": { "title": "高度" }
    },
    "3": {
      "inputs": { "value": 10 },
      "class_type": "PrimitiveFloat",
      "_meta": { "title": "时长" }
    },
    "4": {
      "inputs": { "text": "" },
      "class_type": "Text",
      "_meta": { "title": "分镜提示词" }
    },
    "5": {
      "inputs": {
        "expression": "max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17",
        "values.a": ["3", 0]
      },
      "class_type": "ComfyMathExpression",
      "_meta": { "title": "数学表达式" }
    },
    "6": {
      "inputs": { "image": "example.png" },
      "class_type": "LoadImage",
      "_meta": { "title": "加载图像1" }
    },
    "7": {
      "inputs": { "image": "example.png" },
      "class_type": "LoadImage",
      "_meta": { "title": "加载图像2" }
    },
    "8": {
      "inputs": { "image": "example.png" },
      "class_type": "LoadImage",
      "_meta": { "title": "加载图像3" }
    },
    "9": {
      "inputs": { "image": "example.png" },
      "class_type": "LoadImage",
      "_meta": { "title": "加载图像4" }
    },
    "10": {
      "inputs": { "image": "example.png" },
      "class_type": "LoadImage",
      "_meta": { "title": "加载图像5" }
    },
    "11": {
      "inputs": { "image": "example.png" },
      "class_type": "LoadImage",
      "_meta": { "title": "加载图像6" }
    },
    "12": {
      "inputs": { "image": "example.png" },
      "class_type": "LoadImage",
      "_meta": { "title": "加载图像7" }
    },
    "13": {
      "inputs": { "image": "example.png" },
      "class_type": "LoadImage",
      "_meta": { "title": "加载图像8" }
    },
    "14": {
      "inputs": { "image": "example.png" },
      "class_type": "LoadImage",
      "_meta": { "title": "加载图像9" }
    },
    "15": {
      "inputs": { "audio": "ComfyUI_00015_.mp4" },
      "class_type": "LoadAudio",
      "_meta": { "title": "加载音频1" }
    },
    "16": {
      "inputs": { "audio": "ComfyUI_00015_.mp4" },
      "class_type": "LoadAudio",
      "_meta": { "title": "加载音频2" }
    },
    "17": {
      "inputs": { "audio": "ComfyUI_00015_.mp4" },
      "class_type": "LoadAudio",
      "_meta": { "title": "加载音频3" }
    },
    "21": {
      "inputs": {
        "clip_name": "clip_mini_max_h3.safetensors"
      },
      "class_type": "CLIPLoader",
      "_meta": { "title": "CLIP加载器" }
    },
    "22": {
      "inputs": {
        "unet_name": "MiniMax-H3-Wan2.2.safetensors",
        "weight_dtype": "default"
      },
      "class_type": "UNETLoader",
      "_meta": { "title": "UNET加载器" }
    },
    "23": {
      "inputs": {
        "vae_name": "vae_mini_max_h3.safetensors"
      },
      "class_type": "VAELoader",
      "_meta": { "title": "VAE加载器" }
    },
    "24": {
      "inputs": {
        "vae_name": "vae_mini_max_h3_fp16.safetensors"
      },
      "class_type": "VAELoader",
      "_meta": { "title": "VAE加载器FP16" }
    },
    "26": {
      "inputs": { "noise_seed": 42 },
      "class_type": "RandomNoise",
      "_meta": { "title": "随机种子" }
    },
    "29": {
      "inputs": {
        "reference_images": [
          ["6", 0], ["7", 0], ["8", 0], ["9", 0], ["10", 0], ["11", 0], ["12", 0], ["13", 0], ["14", 0]
        ],
        "reference_audios": [
          ["15", 0], ["16", 0], ["17", 0]
        ],
        "ref_strength": 0.8,
        "ref_image_weight": 0.5,
        "ref_audio_weight": 0.5,
        "prompt": ["4", 0],
        "width": ["1", 0],
        "height": ["2", 0],
        "duration": ["3", 0]
      },
      "class_type": "MiniMaxH3ReferenceToVideo",
      "_meta": { "title": "MiniMaxH3参考转视频" }
    },
    "36": {
      "inputs": {
        "model": ["22", 0],
        "positive": ["29", 0],
        "negative": ["29", 1],
        "samples": ["29", 2],
        "vae": ["24", 0],
        "clips": ["21", 0],
        "seed": ["26", 0],
        "steps": 20,
        "cfg": 6.5,
        "sampler_name": "dpmpp_2m",
        "scheduler": "sgm_uniform",
        "denoise": 1.0,
        "max_iterations": 150
      },
      "class_type": "SamplerCustomAdvanced",
      "_meta": { "title": "高级采样器" }
    },
    "39": {
      "inputs": {
        "images": ["36", 0],
        "fps": 24,
        "format": "video/h264-mp4",
        "pix_fmt": "yuv420p",
        "crf": 19,
        "audio_path": "",
        "audio_start_sec": 0,
        "file_name_prefix": "minimax_h3_output",
        "save_output": true
      },
      "class_type": "VHS_VideoCombine",
      "_meta": { "title": "视频合成" }
    }
  };
}
