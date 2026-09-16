import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";

/** 查找 ffprobe 可执行文件 */
function findFfprobeExecutable() {
  const candidates = [
    process.env.FFPROBE_PATH,
    // 与 ffmpeg 同目录
    (() => {
      const ffmpegPath = findFfmpegExecutable();
      if (ffmpegPath && ffmpegPath !== 'ffmpeg') {
        const dir = path.dirname(ffmpegPath);
        const base = path.basename(ffmpegPath);
        return path.join(dir, base.replace('ffmpeg', 'ffprobe'));
      }
      return null;
    })(),
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffprobe.exe'),
    path.join(process.cwd(), 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffprobe.exe'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return 'ffprobe';
}

/** 查找 ffmpeg 可执行文件 */
function findFfmpegExecutable() {
  const candidates = [
    process.env.FFMPEG_PATH,
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
    path.join(process.cwd(), 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return 'ffmpeg';
}

/** 带重试和增强容错的媒体文件下载 */
async function downloadMedia(
  url: string,
  destPath: string,
  timeoutMs: number = 60000,
  maxRetries: number = 3
): Promise<{ success: boolean; size: number; error?: string }> {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Encoding": "identity",
    "Cache-Control": "no-cache",
  };

  let lastError = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        // @ts-ignore - Node.js fetch specific option
        keepAlive: true,
      });

      if (!res.ok) {
        lastError = `HTTP ${res.status} ${res.statusText}`;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          // Client errors (except 429) are not retryable
          break;
        }
        continue;
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length === 0) {
        lastError = "下载内容为空 (0 bytes)";
        if (attempt < maxRetries) continue;
      }

      fs.writeFileSync(destPath, buffer);

      // 验证文件是否真正写入
      const stat = fs.statSync(destPath);
      if (stat.size === 0) {
        fs.unlinkSync(destPath);
        lastError = "写入文件为 0 bytes";
        if (attempt < maxRetries) continue;
        return { success: false, size: 0, error: lastError };
      }

      return { success: true, size: stat.length };
    } catch (e: any) {
      lastError = e.message || String(e);
      if (attempt < maxRetries) {
        // 指数退避：1s, 2s, 4s
        await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
      }
    }
  }

  // 清理可能的不完整文件
  try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
  return { success: false, size: 0, error: lastError };
}
function getMediaDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const executable = findFfprobeExecutable();
    const args = [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ];

    const child = spawn(executable, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', () => {
      resolve(0);
    });
    child.on('close', (code) => {
      if (code === 0 && stdout) {
        const dur = parseFloat(stdout.trim());
        resolve(isNaN(dur) ? 0 : Math.round(dur * 100) / 100);
      } else {
        resolve(0);
      }
    });
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: dramaId } = await params;
    const body = await request.json();
    const {
      draftPath,
      draftName,
      shots,
      canvasWidth = 1080,
      canvasHeight = 1920,
      canvasRatio = "9:16",
      mediaPreDownloaded = false,  // 前端已下载并上传到草稿箱
      exportTracks = { video: true, sceneText: true, dialogueText: true, audio: true },
    } = body;

    if (!shots || !Array.isArray(shots) || shots.length === 0) {
      return NextResponse.json({ success: false, error: "分镜数据为空" }, { status: 400 });
    }
    if (!draftPath || !draftName) {
      return NextResponse.json({ success: false, error: "缺少保存路径或草稿名称" }, { status: 400 });
    }

    // 安全校验：确保目标路径在剪映草稿目录范围内
    const realDraftPath = path.resolve(draftPath);
    const draftFolderPath = path.join(realDraftPath, draftName);

    // 获取 host 用于将相对 URL 转绝对 URL
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:5000";
    const protocol = request.headers.get("x-forwarded-proto") || "http";
    const baseUrl = `${protocol}://${host}`;

    // 检查父目录是否存在
    if (!fs.existsSync(realDraftPath)) {
      // 自动创建剪映草稿目录
      try {
        fs.mkdirSync(realDraftPath, { recursive: true });
      } catch (e: any) {
        return NextResponse.json({ success: false, error: `无法创建目录: ${e.message}` }, { status: 400 });
      }
    }

    // 检查目标文件夹是否已存在
    const alreadyExists = fs.existsSync(draftFolderPath);

    // 创建草稿文件夹
    fs.mkdirSync(draftFolderPath, { recursive: true });

    const logs: string[] = [];
    const addLog = (msg: string) => logs.push(msg);

    addLog(`📁 目标路径：${draftFolderPath}`);
    if (alreadyExists) {
      addLog(`⚠️ 草稿「${draftName}」已存在，将覆盖更新...`);
    }

    // 时间轴核心运算 (单位: 微秒 us)
    let currentTimeUs = 0;
    const materialsVideos: any[] = [];
    const materialsAudios: any[] = [];
    const materialsTexts: any[] = [];
    const materialsSpeeds: any[] = [];
    const materialsAudioFades: any[] = [];

    const videoSegments: any[] = [];
    const text1Segments: any[] = [];
    const text2Segments: any[] = [];
    const audioSegments: any[] = [];

    const cleanDraftPath = draftPath.replace(/\\/g, "/").replace(/\/+$/, "");

    // 统一 URL：将相对路径转为绝对 URL（服务端 fetch 需要）
    const normalizeUrl = (url: string): string => {
      if (!url) return url;
      if (url.startsWith("//")) return `${protocol}:${url}`;
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      return url;
    };
    // 从 shot.audioUrl 中提取实际可用的音频 URL
    // shot.audioUrl 可能是: 1) JSON字符串 [{audioUrl:"...", ...}]  2) 纯URL字符串
    const extractAudioUrl = (shotAudioUrl: any): string => {
      if (!shotAudioUrl) return '';
      const raw = String(shotAudioUrl);
      if (raw.trim().startsWith('[')) {
        try {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            const first = list.find((item: any) => item?.audioUrl);
            return first?.audioUrl || '';
          }
        } catch { return ''; }
      }
      if (raw.startsWith('http') || raw.startsWith('/')) return raw;
      return '';
    };

    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const index = i + 1;
      let durationSec = s.duration || 5;
      let durationCorrected = false;

      // --- 下载/定位媒体文件 ---
      const mediaUrl = s.videoUrl || s.imageUrl;
      let filename = "";
      let hasMedia = false;
      let downloadedMediaPath = "";

      if (mediaUrl) {
        const extension = s.videoUrl ? "mp4" : "png";
        filename = `shot_${index}_media.${extension}`;
        const mediaFilePath = path.join(draftFolderPath, filename);

        if (mediaPreDownloaded) {
          // 前端已上传媒体到草稿箱，检查文件是否存在
          if (fs.existsSync(mediaFilePath)) {
            const stat = fs.statSync(mediaFilePath);
            if (stat.size > 0) {
              addLog(`    ✓ 镜头#${index} 媒体已就绪 (${(stat.size / 1024 / 1024).toFixed(2)}MB)`);
              hasMedia = true;
              downloadedMediaPath = mediaFilePath;
            } else {
              addLog(`    ✗ 镜头#${index} 媒体文件为空 (0 bytes)`);
              filename = mediaUrl; // 兜底
            }
          } else {
            addLog(`    ✗ 镜头#${index} 媒体文件不存在: ${filename}`);
            filename = mediaUrl; // 兜底，剪映可能无法加载
          }
        } else {
          // 旧模式：服务端下载（可能因 CDN 防盗链失败）
          addLog(`    [下载] 镜头#${index} 媒体文件 (${mediaUrl.substring(0, 80)}${mediaUrl.length > 80 ? '...' : ''})`);
          const absoluteMediaUrl = normalizeUrl(mediaUrl);
          const dlResult = await downloadMedia(absoluteMediaUrl, mediaFilePath, 90000, 3);
          
          if (dlResult.success) {
            addLog(`    ✓ 镜头#${index} 下载成功 (${(dlResult.size / 1024 / 1024).toFixed(2)}MB)`);
            hasMedia = true;
            downloadedMediaPath = mediaFilePath;
          } else {
            addLog(`    ✗ 镜头#${index} 下载失败：${dlResult.error}`);
            filename = mediaUrl;
          }
        }
      }

      // --- 关键：用 ffprobe 获取真实视频时长 ---
      if (hasMedia && downloadedMediaPath && s.videoUrl) {
        addLog(`    [探测] 镜头#${index} 正在读取真实视频时长...`);
        const realDur = await getMediaDuration(downloadedMediaPath);
        if (realDur > 0) {
          durationSec = realDur;
          durationCorrected = true;
          addLog(`    ✓ 镜头#${index} 真实时长: ${realDur}秒（覆盖原 ${s.duration || 5}秒）`);
        } else {
          addLog(`    ⚠️ 镜头#${index} 无法探测真实时长，使用原值 ${durationSec}秒`);
        }
      } else if (hasMedia && downloadedMediaPath && s.imageUrl) {
        // 图片素材：保持原时长或使用 3 秒默认
        durationSec = s.duration || 3;
      }

      const durationUs = Math.round(durationSec * 1000000);
      addLog(`  → [镜头 #${index}] 最终时长: ${durationSec}秒${durationCorrected ? '（已校正为真实时长）' : ''}`);

      const videoMatId = `mat-video-${s.id}`;
      // JianYing materials path: 使用绝对路径 + Windows 反斜杠
      // JianYing 需要完整的绝对路径来定位素材文件
      const jianyingMediaPath = hasMedia && !filename.startsWith("http")
        ? path.join(draftFolderPath, filename).replace(/\//g, '\\')
        : filename || "";
        
      if (exportTracks.video) {
        materialsVideos.push({
          id: videoMatId,
          type: s.videoUrl ? "video" : "photo",
          path: jianyingMediaPath,
          duration: durationUs,
          width: canvasWidth,
          height: canvasHeight,
          fps: 30,
          local_material_id: videoMatId,
          extra_info: `镜头#${index}`,
        });

        const speedMatId = `speed-${s.id}`;
        materialsSpeeds.push({ id: speedMatId, type: "speed", speed: 1.0 });

        videoSegments.push({
          id: `seg-video-${s.id}`,
          material_id: videoMatId,
          target_timerange: { start: currentTimeUs, duration: durationUs },
          source_timerange: { start: 0, duration: durationUs },
          extra_material_refs: [speedMatId],
          speed: 1.0,
          volume: 1.0,
          visible: true,
        });
      }

      // --- 轨道 2: 场景画面描述文字 ---
      if (exportTracks.sceneText) {
        const promptText = s.sceneDescription || s.imagePrompt || "";
        const text1MatId = `mat-text1-${s.id}`;
        materialsTexts.push({
          id: text1MatId,
          type: "text",
          content: JSON.stringify({
            text: promptText,
            styles: [{
              range: [0, promptText.length],
              fill: { content: { solid: { color: [1.0, 1.0, 1.0] } } },
              size: 7.0,
              bold: false,
            }],
          }),
          font_name: "",
          font_size: 7.0,
          text_color: "#FFFFFFFF",
          border_color: "#000000FF",
          border_width: 3.0,
          has_shadow: false,
          text_alignment: 1,
          vertical: false,
        });

        text1Segments.push({
          id: `seg-text1-${s.id}`,
          material_id: text1MatId,
          target_timerange: { start: currentTimeUs, duration: durationUs },
          source_timerange: { start: 0, duration: durationUs },
          transform: { scale: { x: 1.0, y: 1.0 }, translation: { x: 0.0, y: -0.55 } },
        });
      }

      // --- 轨道 3: 对白字幕文字 ---
      if (exportTracks.dialogueText) {
        const dialogueText = s.voiceover || s.dialogue || "";
        const text2MatId = `mat-text2-${s.id}`;
        materialsTexts.push({
          id: text2MatId,
          type: "text",
          content: JSON.stringify({
            text: dialogueText,
            styles: [{
              range: [0, dialogueText.length],
              fill: { content: { solid: { color: [1.0, 0.84, 0.0] } } },
              size: 8.5,
              bold: true,
            }],
          }),
          font_name: "",
          font_size: 8.5,
          text_color: "#FFD700FF",
          border_color: "#000000FF",
          border_width: 3.5,
          has_shadow: false,
          text_alignment: 1,
          vertical: false,
        });

        text2Segments.push({
          id: `seg-text2-${s.id}`,
          material_id: text2MatId,
          target_timerange: { start: currentTimeUs, duration: durationUs },
          source_timerange: { start: 0, duration: durationUs },
          transform: { scale: { x: 1.0, y: 1.0 }, translation: { x: 0.0, y: -0.75 } },
        });
      }

      // --- 轨道 4: 配音音频 ---
      const audioUrl = extractAudioUrl(s.audioUrl);
      if (exportTracks.audio && audioUrl) {
        const audioFilename = `shot_${index}_audio.mp3`;
        const audioFilePath = path.join(draftFolderPath, audioFilename);
        let hasAudio = false;

        if (mediaPreDownloaded) {
          // 前端已上传
          if (fs.existsSync(audioFilePath)) {
            const stat = fs.statSync(audioFilePath);
            if (stat.size > 0) {
              addLog(`    ✓ 镜头#${index} 音频已就绪 (${(stat.size / 1024).toFixed(1)}KB)`);
              hasAudio = true;
            } else {
              addLog(`    ✗ 镜头#${index} 音频文件为空 (0 bytes)`);
            }
          } else {
            addLog(`    ✗ 镜头#${index} 音频文件不存在: ${audioFilename}`);
          }
        } else {
          addLog(`    [下载] 镜头#${index} 音频文件...`);
          const absoluteAudioUrl = normalizeUrl(audioUrl);
          const audioResult = await downloadMedia(absoluteAudioUrl, audioFilePath, 60000, 3);
          if (audioResult.success) {
            addLog(`    ✓ 镜头#${index} 音频下载成功 (${(audioResult.size / 1024).toFixed(1)}KB)`);
            hasAudio = true;
          } else {
            addLog(`    ✗ 镜头#${index} 音频下载失败：${audioResult.error}`);
          }
        }

        const audioMatId = `mat-audio-${s.id}`;
        materialsAudios.push({
          id: audioMatId,
          type: "audio",
          path: hasAudio
            ? path.join(draftFolderPath, audioFilename).replace(/\//g, '\\')
            : audioUrl,
          duration: durationUs,
          local_material_id: audioMatId,
        });

        const fadeMatId = `fade-${s.id}`;
        materialsAudioFades.push({
          id: fadeMatId,
          type: "audio_fade",
          fade_in_duration: 0,
          fade_out_duration: 0,
        });

        audioSegments.push({
          id: `seg-audio-${s.id}`,
          material_id: audioMatId,
          target_timerange: { start: currentTimeUs, duration: durationUs },
          source_timerange: { start: 0, duration: durationUs },
          extra_material_refs: [fadeMatId],
          volume: 1.0,
        });
      }

      currentTimeUs += durationUs;
    }

    // 组装 draft_content.json
    addLog(`🧱 正在组装 draft_content.json...`);
    const draftContent = {
      id: `jy-draft-${Date.now()}`,
      name: draftName,
      duration: currentTimeUs,
      fps: 30,
      canvas_config: {
        width: canvasWidth,
        height: canvasHeight,
        ratio: canvasRatio,
      },
      platform: {
        app_source: "lv",
        app_version: "9.0.0",
        os: os.platform(),
      },
      tracks: [
        { id: "track-video-storyboards", type: "video", segments: videoSegments },
        { id: "track-text-prompts", type: "text", segments: text1Segments },
        { id: "track-text-dialogues", type: "text", segments: text2Segments },
        { id: "track-audio-voiceovers", type: "audio", segments: audioSegments },
      ].filter((t) => t.segments.length > 0),
      materials: {
        videos: materialsVideos,
        audios: materialsAudios,
        texts: materialsTexts,
        speeds: materialsSpeeds,
        audio_fades: materialsAudioFades,
      },
    };

    // 组装 draft_meta_info.json（使用 Windows 反斜杠路径）
    const draftMetaPath = draftFolderPath.replace(/\//g, '\\');
    const draftMaterials = [
      ...materialsVideos.map(m => ({
        path: m.path,
        type: m.type,
        id: m.id,
        material_id: m.local_material_id,
      })),
      ...materialsAudios.map(m => ({
        path: m.path,
        type: m.type,
        id: m.id,
        material_id: m.local_material_id,
      })),
    ];
    const draftMeta = {
      id: draftContent.id,
      draft_name: draftName,
      draft_fold_path: draftMetaPath,
      draft_type: "strong",
      create_time: Date.now(),
      update_time: Date.now(),
      draft_materials: draftMaterials,
      draft_remore_material: [],
    };

    // 写入 JSON 文件
    fs.writeFileSync(
      path.join(draftFolderPath, "draft_content.json"),
      JSON.stringify(draftContent, null, 2),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(draftFolderPath, "draft_meta_info.json"),
      JSON.stringify(draftMeta, null, 2),
      "utf-8"
    );

    addLog(`✓ draft_content.json 和 draft_meta_info.json 已写入`);
    addLog(`🎉 草稿「${draftName}」已成功存到：${draftFolderPath}`);

    return NextResponse.json({
      success: true,
      data: {
        draftPath: draftFolderPath,
        draftName,
        totalShots: shots.length,
        totalDuration: `${(currentTimeUs / 1000000).toFixed(1)}秒`,
        logs,
      },
    });
  } catch (error: any) {
    console.error("剪映直接导出失败:", error);
    return NextResponse.json(
      { success: false, error: error.message || "导出失败" },
      { status: 500 }
    );
  }
}
