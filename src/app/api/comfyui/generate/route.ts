import { NextRequest, NextResponse } from 'next/server';
import { ComfyUIClient, buildMiniMaxH3Workflow, injectParamsIntoWorkflow, getDefaultMiniMaxH3Workflow, getComfyUISize, type ComfyUIWorkflow } from '@/lib/comfyui';
import { ComfyWorkflowManager } from '@/storage/database/comfyWorkflowManager';
import fs from 'fs';
import path from 'path';

export const maxDuration = 600;

// SSE 事件类型定义
type SSEEvent = {
  stage: string;
  message: string;
  [key: string]: any;
};

// 辅助函数：创建 SSE 流式响应
function createSSEResponse(
  handler: (send: (event: SSEEvent) => void) => Promise<void>
): NextResponse {
  const encoder = new TextEncoder();
  let stream: ReadableStream<Uint8Array>;
  let writer: WritableStreamDefaultWriter<Uint8Array>;

  stream = new ReadableStream({
    async start(controller) {
      writer = controller as any;
      const send = (event: SSEEvent) => {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      };
      try {
        await handler(send);
        controller.close();
      } catch (err: any) {
        const errEvent: SSEEvent = { stage: 'error', message: err.message || '未知错误' };
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(errEvent)}\n\n`));
        } catch {}
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function POST(request: NextRequest) {
  // 检查是否请求 SSE 流式响应
  const acceptHeader = request.headers.get('accept') || '';
  let body: any;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const isStream = acceptHeader.includes('text/event-stream') || body.stream === true;

  const {
    serverUrl,
    prompt,
    width,
    height,
    aspectRatio,
    sizePresetIndex,
    duration,
    referenceImages = [],
    referenceAudios = [],
    seed,
    workflowTemplate,
    workflowId,  // 新增：从数据库加载工作流
    modelType = 'minimax-h3-reference',
    pollInterval = 5000,
    maxPolls = 7200,
    h3Mode,  // H3 模式: auto/T2VA/I2VA/FL2VA/L2VA/Ref2VA
  } = body;

  if (!serverUrl) {
    const errResp = { success: false, error: '缺少 ComfyUI 服务器地址' };
    if (isStream) {
      return createSSEResponse(async (send) => {
        send({ stage: 'error', message: '缺少 ComfyUI 服务器地址' });
      });
    }
    return NextResponse.json(errResp, { status: 400 });
  }

  if (!prompt || !prompt.trim()) {
    const errResp = { success: false, error: '缺少视频提示词' };
    if (isStream) {
      return createSSEResponse(async (send) => {
        send({ stage: 'error', message: '缺少视频提示词' });
      });
    }
    return NextResponse.json(errResp, { status: 400 });
  }

  const comfyBase = serverUrl.replace(/\/+$/, '');
  const client = new ComfyUIClient({ baseUrl: comfyBase });
  const localBaseUrl = request.headers.get('origin') || process.env.NEXTAUTH_URL || 'http://localhost:5000';

  if (!isStream) {
    // 原有逻辑：非流式响应
    return handleNonStream(comfyBase, client, localBaseUrl, {
      serverUrl, prompt, width, height, aspectRatio, sizePresetIndex, duration,
      referenceImages, referenceAudios, seed, workflowTemplate, modelType,
      pollInterval, maxPolls,
    });
  }

  // SSE 流式响应
  return createSSEResponse(async (send) => {
    try {
      send({ stage: 'init', message: `初始化 ComfyUI 连接: ${comfyBase}`, progress: 0 });

      // 阶段1：上传参考图片
      send({ stage: 'uploading_images', message: `准备上传 ${referenceImages.length} 张参考图...`, progress: 5 });
      const uploadedImages: Array<{ name: string; subfolder?: string; type?: string }> = [];
      const refImagesToUpload = referenceImages.slice(0, 9);
      console.log(`[ComfyUI] 开始上传 ${refImagesToUpload.length} 张参考图, localBaseUrl=${localBaseUrl}`);
      
      // 辅助函数：从 URL/path 中提取原始文件名
      const extractFileName = (url: string, index: number): string => {
        if (!url) return `ref_${index}.png`;
        // data URI: 从 mime 类型推断扩展名
        if (url.startsWith('data:')) {
          const match = url.match(/^data:([^;]+)/);
          const mime = match?.[1] || 'image/png';
          const ext = mime.split('/')[1] || 'png';
          return `ref_${index}.${ext}`;
        }
        // HTTP URL 或本地路径: 提取最后一个 / 后面的部分
        try {
          let pathPart = url;
          if (url.startsWith('http')) {
            try { pathPart = new URL(url).pathname; } catch { pathPart = url; }
          }
          // 去除查询参数
          pathPart = pathPart.split('?')[0].split('#')[0];
          const baseName = pathPart.split('/').pop() || '';
          // 只有当文件名包含有效扩展名时才使用
          if (baseName && /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(baseName)) {
            return baseName;
          }
        } catch {}
        return `ref_${index}.png`;
      };
      
      for (let i = 0; i < refImagesToUpload.length; i++) {
        const imgRaw = refImagesToUpload[i];
        // 支持字符串格式（data URI）和对象格式（{data, name, type}）
        const imgData = typeof imgRaw === 'string' ? imgRaw : (imgRaw?.data || '');
        // 对象格式优先使用 name，字符串格式从 URL 提取文件名
        const imgName = typeof imgRaw === 'object' 
          ? (imgRaw?.name || extractFileName(String(imgData), i)) 
          : extractFileName(String(imgData), i);
        // 调试：打印图片数据类型
        let dataType = 'empty';
        if (imgData) {
          if (imgData.startsWith('data:')) dataType = 'data-uri (base64)';
          else if (imgData.startsWith('http')) dataType = 'http-url';
          else if (imgData.startsWith('/')) dataType = 'local-path';
          else if (/^[A-Za-z0-9+/]+=/.test(imgData) && imgData.length > 128) dataType = 'raw-base64';
          else dataType = `unknown(${imgData.slice(0,30)})`;
        }
        console.log(`[ComfyUI] 参考图[${i}]: name=${imgName}, type=${dataType}, len=${imgData?.length || 0}, preview="${(imgData||'').slice(0,80)}"`);
        try {
          if (imgData && typeof imgData === 'string' && imgData.trim()) {
            const result = await client.uploadImage(imgData, imgName, true, localBaseUrl);
            uploadedImages.push(result);
            console.log(`[ComfyUI] 参考图[${i}] 上传成功: ${JSON.stringify(result)}`);
            const progress = 5 + Math.round((i + 1) / (refImagesToUpload.length + 1) * 25);
            send({
              stage: 'uploading_images',
              message: `参考图 ${i + 1}/${refImagesToUpload.length} 上传成功: ${result.name}${result.name !== imgName ? ` (原始: ${imgName})` : ''}`,
              progress,
              uploadedCount: i + 1,
              totalCount: refImagesToUpload.length,
            });
          }
        } catch (err: any) {
          console.error(`[ComfyUI] 参考图${i+1}上传失败:`, err);
          send({
            stage: 'uploading_images',
            message: `参考图 ${i + 1} 上传失败: ${err.message}`,
            progress: 5 + Math.round((i + 1) / (refImagesToUpload.length + 1) * 25),
            error: err.message,
          });
        }
      }
      send({ stage: 'uploading_images_done', message: `共上传 ${uploadedImages.length}/${refImagesToUpload.length} 张参考图`, progress: 30 });

      // 阶段2：上传参考音频
      const uploadedAudios: Array<{ name: string; subfolder?: string; type?: string }> = [];
      if (referenceAudios.length > 0) {
        send({ stage: 'uploading_audios', message: `准备上传 ${referenceAudios.length} 段参考音频...`, progress: 30 });
        for (let i = 0; i < referenceAudios.slice(0, 3).length; i++) {
          const audioData = referenceAudios[i];
          try {
            if (typeof audioData === 'string' && audioData.trim()) {
              const result = await client.uploadAudio(audioData);
              uploadedAudios.push(result);
              send({
                stage: 'uploading_audios',
                message: `音频 ${i + 1} 上传成功`,
                progress: 30 + Math.round((i + 1) / (referenceAudios.length + 1) * 10),
              });
            }
          } catch (err: any) {
            send({ stage: 'uploading_audios', message: `音频 ${i + 1} 上传失败: ${err.message}`, error: err.message });
          }
        }
      }

      // 阶段3：加载/构建工作流
      send({ stage: 'building_workflow', message: '加载工作流模板...', progress: 40 });
      let wf: ComfyUIWorkflow | undefined = undefined;
      
      // 优先级1：从数据库加载（通过 workflowId）
      if (workflowId) {
        try {
          const dbWf = await ComfyWorkflowManager.getById(workflowId);
          if (dbWf && dbWf.workflowJson) {
            wf = JSON.parse(dbWf.workflowJson);
            send({ stage: 'building_workflow', message: `加载工作流: ${dbWf.name}`, progress: 42 });
          } else {
            throw new Error('工作流不存在或内容为空');
          }
        } catch (err: any) {
          send({ stage: 'building_workflow', message: `数据库工作流加载失败: ${err.message}，尝试其他方式...`, progress: 41 });
          // 降级到下一种方式
        }
      }
      
      // 优先级2：使用传入的 workflowTemplate
      if (!wf && workflowTemplate) {
        try {
          wf = typeof workflowTemplate === 'string' ? JSON.parse(workflowTemplate) : workflowTemplate;
          send({ stage: 'building_workflow', message: '使用传入的工作流模板', progress: 42 });
        } catch {
          send({ stage: 'error', message: '工作流模板解析失败' });
          return;
        }
      }
      
      // 优先级3：从文件路径加载
      if (!wf) {
        const possiblePaths = [
          path.join(process.cwd(), '..', 'MINIMAX-H3工作流', 'minimax_h3_director_二采_加速.json'),
          path.join(process.cwd(), '..', 'MINIMAX-H3工作流', 'video_minimax_h3_r2v.json'),
          path.join(process.cwd(), '..', 'MINIMAX-H3工作流', '多参9+3+3.json'),
          path.join(process.cwd(), 'public', 'comfyui', 'minimax-h3.json'),
          'f:/MINIMAX-H3工作流/minimax_h3_director_二采_加速.json',
          'f:/MINIMAX-H3工作流/video_minimax_h3_r2v.json',
          'f:/MINIMAX-H3工作流/多参9+3+3.json',
        ];
        let resolvedPath = '';
        for (const p of possiblePaths) {
          if (fs.existsSync(p)) { resolvedPath = p; break; }
        }
        if (resolvedPath) {
          const wfContent = fs.readFileSync(resolvedPath, 'utf-8');
          wf = JSON.parse(wfContent);
          send({ stage: 'building_workflow', message: `从 ${resolvedPath} 加载工作流模板`, progress: 42 });
        } else {
          // 最后降级：使用内置默认
          wf = getDefaultMiniMaxH3Workflow();
          send({ stage: 'building_workflow', message: '使用默认工作流模板', progress: 42 });
        }
      }

      // 确保 wf 有值
      if (!wf) {
        wf = getDefaultMiniMaxH3Workflow();
      }
      const resolvedWf: ComfyUIWorkflow = wf;

      // 构建工作流参数
      const size = getComfyUISize(aspectRatio || '16:9', sizePresetIndex ?? 2);
      const finalWidth = width || size.width;
      const finalHeight = height || size.height;
      const workflowParams = {
        prompt: prompt.trim(),
        width: finalWidth,
        height: finalHeight,
        aspectRatio: aspectRatio || '16:9',
        sizePresetIndex: sizePresetIndex ?? 2,
        duration: duration ?? 10,
        referenceImages: uploadedImages,
        referenceAudios: uploadedAudios,
        seed: seed ?? Math.floor(Math.random() * 1_000_000_000),
        h3Mode: h3Mode || 'auto',
      };
      console.log(`[ComfyUI] workflowParams: duration=${workflowParams.duration}s, width=${finalWidth}, height=${finalHeight}, refs=${uploadedImages.length}`);
      console.log(`[ComfyUI] 原始body.duration=${duration}, typeof=${typeof duration}`);

      send({ stage: 'building_workflow', message: `构建工作流: ${finalWidth}×${finalHeight}, ${duration ?? 10}秒`, progress: 45 });
      
      // 判断是否为 MiniMax H3 工作流（通过检测关键节点类型）
      // 检测方式：查找 MiniMaxH3ReferenceToVideo 节点（新版）、MiniMaxH3Director 节点（Director模式），或检测旧版节点结构
      const wfEntries = Object.entries(resolvedWf);
      const hasMiniMaxH3Node = wfEntries.some(([_, n]) => 
        n.class_type === 'MiniMaxH3ReferenceToVideo' ||
        n.class_type === 'MiniMaxH3ReferenceToVideoAudio'
      );
      const hasDirectorNode = wfEntries.some(([_, n]) => 
        n.class_type === 'MiniMaxH3Director'
      );
      const isMiniMaxH3 = hasMiniMaxH3Node ||
        (resolvedWf['1']?.class_type === 'Note' && resolvedWf['4']?.class_type === 'CLIPTextEncode') ||
        (resolvedWf['1']?.class_type === 'PrimitiveInt' && resolvedWf['4']?.class_type === 'Text') ||
        (resolvedWf['1']?.class_type === 'PrimitiveInt' && resolvedWf['3']?.class_type === 'PrimitiveFloat');
      const isDirectorMode = hasDirectorNode; // Director 模式（时间线多镜头）
      
      let builtWorkflow: ComfyUIWorkflow;
      if (isDirectorMode) {
        // Director 模式工作流：使用专门的 MiniMaxH3Director 注入器
        const { workflow: wf2, injected } = injectParamsIntoWorkflow(resolvedWf, workflowParams);
        builtWorkflow = wf2;
        const imgCount = workflowParams.referenceImages?.length || 0;
        const audioCount = workflowParams.referenceAudios?.length || 0;
        const promptInjected = injected.some(i => i.includes('提示词') || i.includes('global_prompt'));
        const sizeInjected = injected.some(i => i.includes('width') || i.includes('height') || i.includes('尺寸'));
        const durationInfo = injected.find(i => i.includes('total_frames')) || '';
        send({ stage: 'building_workflow', message: `Director 模式工作流构建完成: ${injected.length}个节点已注入 (提示词:${promptInjected ? '✓' : '✗'}, 尺寸:${sizeInjected ? '✓' : '✗'}, 参考图:${imgCount}张, 音频:${audioCount}段)`, progress: 48 });
        console.log(`[ComfyUI] Director 模式注入详情:`, injected);
      } else if (isMiniMaxH3) {
        // MiniMax H3 工作流：使用通用注入器（支持新版 ResolutionSelector 和旧版 PrimitiveInt 格式）
        const { workflow: wf2, injected } = injectParamsIntoWorkflow(resolvedWf, workflowParams);
        builtWorkflow = wf2;
        const imgCount = injected.filter(i => i.includes('参考图')).length;
        const audioCount = injected.filter(i => i.includes('参考音频')).length;
        const promptInjected = injected.some(i => i.includes('提示词'));
        const sizeInjected = injected.some(i => i.includes('ResolutionSelector') || i.includes('宽度') || i.includes('高度'));
        send({ stage: 'building_workflow', message: `MiniMax H3 工作流构建完成: ${injected.length}个节点已注入 (提示词:${promptInjected ? '✓' : '✗'}, 尺寸:${sizeInjected ? '✓' : '✗'}, 参考图:${imgCount}张, 音频:${audioCount}段)`, progress: 48 });
        console.log(`[ComfyUI] MiniMax H3 注入详情:`, injected);
      } else {
        // 使用通用注入器支持任意工作流
        const { workflow: wf2, injected } = injectParamsIntoWorkflow(resolvedWf, workflowParams);
        builtWorkflow = wf2;
        const imageCount = injected.filter(i => i.includes('参考图')).length;
        const audioCount = injected.filter(i => i.includes('参考音频')).length;
        send({ stage: 'building_workflow', message: `通用工作流构建完成: ${injected.length}个参数节点已注入 (${imageCount}个参考图, ${audioCount}个音频)`, progress: 48 });
      }

      // 阶段4：提交工作流
      send({ stage: 'submitting', message: '提交工作流到 ComfyUI...', progress: 50 });
      const queueResult = await client.queuePrompt(builtWorkflow);
      const promptId = queueResult.prompt_id;
      send({ stage: 'submitting', message: `工作流已提交 (ID: ${promptId})`, progress: 55, promptId });

      // 阶段5：轮询完成
      send({ stage: 'waiting', message: '等待 ComfyUI 处理...', progress: 55 });
      const { outputs, files } = await client.waitForCompletion(
        promptId,
        pollInterval,
        maxPolls,
        (status, attempt) => {
          const progress = Math.min(90, 55 + Math.round(attempt / maxPolls * 35));
          send({
            stage: 'waiting',
            message: `状态: ${status} (第${attempt}次轮询)`,
            progress,
            attempt,
            maxAttempts: maxPolls,
          });
        }
      );
      send({ stage: 'waiting_done', message: 'ComfyUI 生成完成', progress: 90 });

      // 阶段6：下载输出
      send({ stage: 'downloading', message: '下载生成的视频...', progress: 92 });
      let videoResult = await client.downloadOutput(outputs, 'video');
      let videoType = 'video';
      if (!videoResult) {
        send({ stage: 'downloading', message: '尝试从 gif 格式下载...', progress: 93 });
        videoResult = await client.downloadOutput(outputs, 'gif');
        videoType = 'gif';
      }
      if (!videoResult) {
        send({ stage: 'downloading', message: '尝试从 image 格式下载...', progress: 94 });
        videoResult = await client.downloadOutput(outputs, 'image');
        videoType = 'image';
      }
      if (!videoResult) {
        send({ stage: 'downloading', message: '尝试获取任意类型输出...', progress: 95 });
        videoResult = await client.downloadOutput(outputs, 'video');
        videoType = 'video';
      }

      let videoData: string | null = null;
      let mimeType = 'video/mp4';
      let filename = '';
      let videoUrl = '';
      let proxyUrl = '';

      if (videoResult) {
        videoUrl = videoResult.url;
        mimeType = videoResult.mimeType;
        filename = videoResult.filename;
        const fileSizeMB = videoResult.buffer.byteLength / (1024 * 1024);
        send({ stage: 'downloading', message: `下载成功: ${filename} (${fileSizeMB.toFixed(2)}MB)`, progress: 97, fileSizeMB });

        try {
          const urlObj = new URL(videoUrl);
          const params = urlObj.searchParams;
          const proxyParams = new URLSearchParams({
            server: comfyBase,
            filename: params.get('filename') || filename,
            subfolder: params.get('subfolder') || '',
            type: params.get('type') || 'output',
          });
          proxyUrl = `/api/comfyui/proxy?${proxyParams.toString()}`;
        } catch {
          proxyUrl = '';
        }

        if (videoResult.buffer.byteLength < 20 * 1024 * 1024) {
          videoData = Buffer.from(videoResult.buffer).toString('base64');
        }
      }

      if (!videoUrl && !proxyUrl && !videoData) {
        send({ stage: 'error', message: 'ComfyUI 未生成输出文件' });
        return;
      }

      const clientVideoUrl = videoData
        ? `data:${mimeType};base64,${videoData}`
        : proxyUrl || videoUrl;

      send({
        stage: 'done',
        message: '视频生成完成！',
        progress: 100,
        success: true,
        data: {
          promptId,
          videoUrl: clientVideoUrl,
          videoDownloadUrl: proxyUrl || videoUrl,
          mimeType,
          filename,
          size: videoResult?.buffer.byteLength || 0,
          files,
          outputType: videoType,
        },
      });
    } catch (err: any) {
      console.error('[ComfyUI] 流式生成失败:', err);
      send({ stage: 'error', message: `生成失败: ${err.message}`, success: false });
    }
  });
}

// 非流式处理（原有逻辑）
async function handleNonStream(
  comfyBase: string,
  client: ComfyUIClient,
  localBaseUrl: string,
  params: any
): Promise<NextResponse> {
  const {
    serverUrl, prompt, width, height, aspectRatio, sizePresetIndex, duration,
    referenceImages, referenceAudios, seed, workflowTemplate, modelType,
    pollInterval, maxPolls, h3Mode,
  } = params;

  console.log(`[ComfyUI] 收到 ${referenceImages.length} 张参考图`);
  referenceImages.forEach((img: any, i: number) => {
    if (!img) { console.log(`[ComfyUI] 图${i}: 空`); return; }
    // 支持字符串和对象格式
    const imgStr = typeof img === 'string' ? img : (img?.data || JSON.stringify(img).slice(0, 100));
    if (!imgStr || typeof imgStr !== 'string') { console.log(`[ComfyUI] 图${i}: 无效格式`); return; }
    let type = 'unknown';
    if (imgStr.startsWith('data:')) type = 'data-uri';
    else if (imgStr.startsWith('http')) type = 'http-url';
    else if (imgStr.startsWith('blob:')) type = 'blob-⚠';
    else if (imgStr.startsWith('/')) type = 'local-path';
    else if (/^[A-Za-z0-9+/]+=/.test(imgStr) && imgStr.length > 128) type = 'base64';
    console.log(`[ComfyUI] 图${i}: ${type} (${imgStr.length}字符) ${imgStr.slice(0, 50)}...`);
  });

  try {
    let wf: ComfyUIWorkflow;
    if (workflowTemplate) {
      try {
        wf = typeof workflowTemplate === 'string' ? JSON.parse(workflowTemplate) : workflowTemplate;
      } catch {
        return NextResponse.json({ success: false, error: '工作流模板解析失败' }, { status: 400 });
      }
    } else {
      const possiblePaths = [
        path.join(process.cwd(), '..', 'MINIMAX-H3工作流', 'minimax_h3_director_二采_加速.json'),
        path.join(process.cwd(), '..', 'MINIMAX-H3工作流', 'video_minimax_h3_r2v.json'),
        path.join(process.cwd(), '..', 'MINIMAX-H3工作流', '多参9+3+3.json'),
        path.join(process.cwd(), 'public', 'comfyui', 'minimax-h3.json'),
        'f:/MINIMAX-H3工作流/minimax_h3_director_二采_加速.json',
        'f:/MINIMAX-H3工作流/video_minimax_h3_r2v.json',
        'f:/MINIMAX-H3工作流/多参9+3+3.json',
      ];
      let resolvedPath = '';
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) { resolvedPath = p; break; }
      }
      if (resolvedPath) {
        const wfContent = fs.readFileSync(resolvedPath, 'utf-8');
        wf = JSON.parse(wfContent);
      } else {
        wf = getDefaultMiniMaxH3Workflow();
      }
    }

    const uploadedImages: Array<{ name: string; subfolder?: string; type?: string }> = [];
    const refImagesToUpload = referenceImages.slice(0, 9);
    console.log(`[ComfyUI] 准备上传 ${refImagesToUpload.length} 张参考图`);
    // 辅助函数：从 URL/path 提取文件名（非流式路径）
    const extractFileName = (url: string, index: number): string => {
      if (!url) return `ref_${index}.png`;
      if (url.startsWith('data:')) {
        const match = url.match(/^data:([^;]+)/);
        const ext = (match?.[1] || 'image/png').split('/')[1] || 'png';
        return `ref_${index}.${ext}`;
      }
      try {
        let pathPart = url;
        if (url.startsWith('http')) { try { pathPart = new URL(url).pathname; } catch {} }
        pathPart = pathPart.split('?')[0].split('#')[0];
        const baseName = pathPart.split('/').pop() || '';
        if (baseName && /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(baseName)) return baseName;
      } catch {}
      return `ref_${index}.png`;
    };
    for (let i = 0; i < refImagesToUpload.length; i++) {
      const imgRaw = refImagesToUpload[i];
      const imgData = typeof imgRaw === 'string' ? imgRaw : (imgRaw?.data || '');
      const imgName = typeof imgRaw === 'object' 
        ? (imgRaw?.name || extractFileName(String(imgData), i)) 
        : extractFileName(String(imgData), i);
      try {
        if (imgData && typeof imgData === 'string' && imgData.trim()) {
          const result = await client.uploadImage(imgData, imgName, true, localBaseUrl);
          uploadedImages.push(result);
          console.log(`[ComfyUI] 参考图${i+1}上传成功: ${result.name}${result.name !== imgName ? ` (原始: ${imgName})` : ''}`);
        }
      } catch (err: any) {
        console.warn(`[ComfyUI] 参考图${i+1}上传失败: ${err.message || err}`);
      }
    }
    console.log(`[ComfyUI] 共上传 ${uploadedImages.length}/${refImagesToUpload.length} 张参考图`);

    const uploadedAudios: Array<{ name: string; subfolder?: string; type?: string }> = [];
    for (let i = 0; i < referenceAudios.slice(0, 3).length; i++) {
      const audioRaw = referenceAudios[i];
      const audioData = typeof audioRaw === 'string' ? audioRaw : (audioRaw?.data || '');
      try {
        if (audioData && typeof audioData === 'string' && audioData.trim()) {
          const result = await client.uploadAudio(audioData);
          uploadedAudios.push(result);
        }
      } catch (err: any) {
        console.warn(`[ComfyUI] 音频上传失败:`, err);
      }
    }

    const size = getComfyUISize(aspectRatio || '16:9', sizePresetIndex ?? 2);
    const finalWidth = width || size.width;
    const finalHeight = height || size.height;
    const workflowParams = {
      prompt: prompt.trim(),
      width: finalWidth,
      height: finalHeight,
      aspectRatio: aspectRatio || '16:9',
      sizePresetIndex: sizePresetIndex ?? 2,
      duration: (duration != null) ? duration : 10,
      referenceImages: uploadedImages,
      referenceAudios: uploadedAudios,
      seed: seed ?? Math.floor(Math.random() * 1_000_000_000),
      h3Mode: h3Mode || 'auto',
    };
    console.log(`[ComfyUI non-stream] workflowParams: duration=${workflowParams.duration}s (raw=${duration}, typeof=${typeof duration}), width=${finalWidth}, height=${finalHeight}, refs=${uploadedImages.length}`);

    // 检测工作流类型（与流式路径一致）
    const wfEntries = Object.entries(wf);
    const hasMiniMaxH3Node = wfEntries.some(([_, n]) => 
      n.class_type === 'MiniMaxH3ReferenceToVideo' ||
      n.class_type === 'MiniMaxH3ReferenceToVideoAudio'
    );
    const hasDirectorNode = wfEntries.some(([_, n]) => 
      n.class_type === 'MiniMaxH3Director'
    );
    const isMiniMaxH3 = hasMiniMaxH3Node ||
      (wf['1']?.class_type === 'Note' && wf['4']?.class_type === 'CLIPTextEncode') ||
      (wf['1']?.class_type === 'PrimitiveInt' && wf['4']?.class_type === 'Text') ||
      (wf['1']?.class_type === 'PrimitiveInt' && wf['3']?.class_type === 'PrimitiveFloat');
    const isDirectorMode = hasDirectorNode;

    const { workflow: builtWorkflow, injected } = injectParamsIntoWorkflow(wf, workflowParams);
    console.log(`[ComfyUI] 工作流注入完成: isMiniMaxH3=${isMiniMaxH3}, isDirectorMode=${isDirectorMode}, 注入详情:`, injected);

    const imgCount = workflowParams.referenceImages?.length || 0;
    for (const info of injected) {
      if (info.includes('参考图') || info.includes('refs') || info.includes('提示词') || info.includes('global_prompt') || info.includes('ResolutionSelector') || info.includes('宽度') || info.includes('高度') || info.includes('Director')) {
        console.log(`[ComfyUI] ${info}`);
      }
    }

    console.log(`[ComfyUI] 提交工作流到 ${comfyBase}, ${aspectRatio || '16:9'}, 尺寸: ${finalWidth}×${finalHeight}, 参考图:${imgCount}张`);
    const queueResult = await client.queuePrompt(builtWorkflow);
    const promptId = queueResult.prompt_id;
    console.log(`[ComfyUI] 工作流已提交, prompt_id: ${promptId}`);

    const { outputs, files } = await client.waitForCompletion(
      promptId, pollInterval, maxPolls,
      (status, attempt) => {
        if (attempt % 6 === 0) console.log(`[ComfyUI] 轮询状态: ${status} (第${attempt}次)`);
      }
    );

    let videoResult = await client.downloadOutput(outputs, 'video');
    let videoType = 'video';
    if (!videoResult) { videoResult = await client.downloadOutput(outputs, 'gif'); videoType = 'gif'; }
    if (!videoResult) { videoResult = await client.downloadOutput(outputs, 'image'); videoType = 'image'; }
    if (!videoResult) { videoResult = await client.downloadOutput(outputs, 'video'); videoType = 'video'; }

    let videoData: string | null = null;
    let mimeType = 'video/mp4';
    let filename = '';
    let videoUrl = '';
    let proxyUrl = '';

    if (videoResult) {
      videoUrl = videoResult.url;
      mimeType = videoResult.mimeType;
      filename = videoResult.filename;
      const fileSizeMB = videoResult.buffer.byteLength / (1024 * 1024);
      console.log(`[ComfyUI] 找到输出文件: ${filename}, ${fileSizeMB.toFixed(2)}MB`);
      try {
        const urlObj = new URL(videoUrl);
        const params = urlObj.searchParams;
        const proxyParams = new URLSearchParams({
          server: comfyBase,
          filename: params.get('filename') || filename,
          subfolder: params.get('subfolder') || '',
          type: params.get('type') || 'output',
        });
        proxyUrl = `/api/comfyui/proxy?${proxyParams.toString()}`;
      } catch { proxyUrl = ''; }
      if (videoResult.buffer.byteLength < 20 * 1024 * 1024) {
        videoData = Buffer.from(videoResult.buffer).toString('base64');
      }
    }

    if (!videoUrl && !proxyUrl && !videoData) {
      console.error('[ComfyUI] 所有下载方式均失败');
      return NextResponse.json({
        success: false, error: 'ComfyUI 未生成输出文件',
        data: { outputs: Object.keys(outputs), files },
      }, { status: 500 });
    }

    const clientVideoUrl = videoData
      ? `data:${mimeType};base64,${videoData}`
      : proxyUrl || videoUrl;

    return NextResponse.json({
      success: true,
      data: {
        promptId,
        videoUrl: clientVideoUrl,
        videoDownloadUrl: proxyUrl || videoUrl,
        mimeType,
        filename,
        size: videoResult?.buffer.byteLength || 0,
        files,
        outputType: videoType,
      },
    });
  } catch (err: any) {
    console.error('[ComfyUI] 生成失败:', err);
    return NextResponse.json(
      { success: false, error: `ComfyUI 生成失败: ${err.message}` },
      { status: 500 }
    );
  }
}