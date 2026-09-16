import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { dramaWorkflowManager, shortDramaManager } from '@/storage/database';
import { getSystemSettings, buildMediaWebBase } from '@/lib/system-settings';
import fs from 'fs';
import path from 'path';

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

async function downloadToLocal(
  src: string,
  type: 'image' | 'video' | 'audio',
  id: string,
  dramaId?: string,
  baseUrl?: string  // 用于解析相对 URL（如 /api/comfyui/proxy）
): Promise<string> {
  const ext = type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'jpg';
  const subDir = type === 'video' ? 'videos' : type === 'audio' ? 'audios' : 'images';
  
  const settings = await getSystemSettings();
  const baseSavePath = settings.mediaSavePath || 'public';
  const mediaWebPath = settings.mediaWebPath || '/media';
  const websiteUrl = settings.websiteUrl ? settings.websiteUrl.replace(/\/$/, '') : '';

  const rootPhysicalPath = path.isAbsolute(baseSavePath)
    ? baseSavePath
    : path.join(process.cwd(), baseSavePath);

  let dir = path.join(rootPhysicalPath, 'media', 'shots', subDir);
  let relativePathPrefix = `${buildMediaWebBase(settings)}/shots/${subDir}`;
  
  if (dramaId) {
    try {
      const { dirs, relativePrefix } = await getWorkDirs(dramaId);
      dir = dirs[type === 'video' ? 'videos' : type === 'audio' ? 'audios' : 'images'];
      relativePathPrefix = `${relativePrefix}/${type === 'video' ? 'videos' : type === 'audio' ? 'audios' : 'images'}`;
    } catch (err) {
      console.error('[downloadToLocal] failed to get dynamic work dirs', err);
    }
  }

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const filename = `${id}_${timestamp}_${random}.${ext}`;
  const localPath = path.join(dir, filename);
  const returnPrefix = dramaId ? relativePathPrefix : `/media/shots/${subDir}`;

  // 处理 data: URL（base64 编码）
  if (src.startsWith('data:')) {
    const commaIdx = src.indexOf(',');
    if (commaIdx < 0) return src;
    const base64Data = src.substring(commaIdx + 1);
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(localPath, buffer);
      return `${returnPrefix}/${filename}`;
    } catch (e) {
      console.error('[downloadToLocal] data URL decode failed:', e);
      return src;
    }
  }

  // 解析完整 URL
  let fetchUrl = src;
  if (src.startsWith('/') && baseUrl) {
    fetchUrl = `${baseUrl}${src}`;
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 120_000);
      try {
        const res = await fetch(fetchUrl, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(localPath, buf);
        console.log(`[downloadToLocal] Saved ${buf.length} bytes to ${localPath}`);
      } finally {
        clearTimeout(timer);
      }
      return `${returnPrefix}/${filename}`;
    } catch (e: any) {
      console.error(`[downloadToLocal] attempt ${attempt} failed:`, e?.message);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  return src;
}

/**
 * POST /api/short-dramas/[id]/localize-media
 * 将外部媒体 URL 下载保存到本地，并更新数据库记录。
 * Body: [{ assetType: 'character'|'scene'|'item'|'shot', assetId: string, url: string, mediaType?: 'image'|'video'|'audio' }]
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id: dramaId } = await params;

    const drama = await shortDramaManager.getById(dramaId);
    if (!drama || (drama.userId !== payload.userId && payload.role !== 'admin')) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }

    const items: Array<{ assetType: string; assetId: string; url: string; mediaType?: string }> =
      await request.json();

    const results: Array<{ assetId: string; localUrl: string }> = [];
    const baseUrl = process.env.NEXTAUTH_URL || `http://localhost:${process.env.PORT || 5000}`;

    for (const item of items) {
      const { assetType, assetId, url, mediaType = 'image' } = item;
      if (!url) continue;
      // 支持 http(s) URL、data: URL、以及相对路径（如 /api/comfyui/proxy）
      if (!url.startsWith('http') && !url.startsWith('data:') && !url.startsWith('/')) continue;

      const localUrl = await downloadToLocal(url, mediaType as 'image' | 'video' | 'audio', assetId, dramaId, baseUrl);
      if (localUrl === url) continue; // download failed, skip

      // 将新本地化的URL作为新主图，旧主图保留在画廊中
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
      function prependNewImage(gallery: any[], newUrl: string): any[] {
        const filtered = gallery.filter((g: any) => g.url !== newUrl);
        return [{ url: newUrl, createdAt: new Date().toISOString() }, ...filtered].slice(0, 50);
      }

      if (assetType === 'character') {
        const oldChar = await dramaWorkflowManager.getCharacterById(assetId);
        if (oldChar) {
          const fullGallery = getFullGallery(oldChar.imageUrl, oldChar.imagePrompt, oldChar.imageGallery);
          const newGallery = prependNewImage(fullGallery, localUrl);
          await dramaWorkflowManager.updateCharacter(assetId, { imageUrl: localUrl, imageGallery: JSON.stringify(newGallery) } as any);
        } else {
          await dramaWorkflowManager.updateCharacter(assetId, { imageUrl: localUrl } as any);
        }
      } else if (assetType === 'scene') {
        const oldScene = await dramaWorkflowManager.getSceneById(assetId);
        if (oldScene) {
          const fullGallery = getFullGallery(oldScene.imageUrl, oldScene.imagePrompt, oldScene.imageGallery);
          const newGallery = prependNewImage(fullGallery, localUrl);
          await dramaWorkflowManager.updateScene(assetId, { imageUrl: localUrl, imageGallery: JSON.stringify(newGallery) } as any);
        } else {
          await dramaWorkflowManager.updateScene(assetId, { imageUrl: localUrl } as any);
        }
      } else if (assetType === 'item') {
        const oldItem = await dramaWorkflowManager.getItemById(assetId);
        if (oldItem) {
          const fullGallery = getFullGallery(oldItem.imageUrl, oldItem.imagePrompt, oldItem.imageGallery);
          const newGallery = prependNewImage(fullGallery, localUrl);
          await dramaWorkflowManager.updateItem(assetId, { imageUrl: localUrl, imageGallery: JSON.stringify(newGallery) } as any);
        } else {
          await dramaWorkflowManager.updateItem(assetId, { imageUrl: localUrl } as any);
        }
      } else if (assetType === 'shot') {
        const field: any = mediaType === 'video' ? { videoUrl: localUrl } : mediaType === 'audio' ? { audioUrl: localUrl } : { imageUrl: localUrl };
        await dramaWorkflowManager.updateShot(assetId, field);
      }
      results.push({ assetId, localUrl });
    }

    return NextResponse.json({ success: true, data: results });
  } catch (error: any) {
    console.error('[localize-media]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
