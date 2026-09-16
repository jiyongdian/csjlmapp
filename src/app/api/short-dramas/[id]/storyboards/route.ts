import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { shortDramaManager, dramaWorkflowManager } from '@/storage/database';
import { deleteLocalFileByUrl } from '@/lib/system-settings';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id } = await params;
    const episodeId = request.nextUrl.searchParams.get('episodeId');

    const drama = await shortDramaManager.getById(id);
    if (!drama || drama.userId !== payload.userId) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }

    const shots = episodeId
      ? await dramaWorkflowManager.getShotsByEpisodeId(episodeId)
      : await dramaWorkflowManager.getShotsByDramaId(id);

    return NextResponse.json({ success: true, data: shots });
  } catch (error) {
    console.error('获取分镜失败:', error);
    return NextResponse.json({ error: '获取分镜失败' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id } = await params;
    const drama = await shortDramaManager.getById(id);
    if (!drama || drama.userId !== payload.userId) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }

    const body = await request.json();

    // 支持批量创建
    if (Array.isArray(body.shots)) {
      const shots = await dramaWorkflowManager.bulkCreateShots(
        body.shots.map((s: any, idx: number) => ({
          dramaId: id,
          episodeId: body.episodeId,
          userId: payload.userId,
          shotNumber: s.shotNumber || idx + 1,
          shotType: s.shotType || 'storyboard',
          sceneDescription: s.sceneDescription || null,
          cameraAngle: s.cameraAngle || null,
          cameraMovement: s.cameraMovement || null,
          dialogue: s.dialogue || null,
          voiceover: s.voiceover || null,
          soundEffects: s.soundEffects || null,
          characterIds: s.characterIds ? JSON.stringify(s.characterIds) : null,
          imagePrompt: s.imagePrompt || null,
          videoPrompt: s.videoPrompt || null,
          ttsText: s.ttsText || null,
          subtitle: s.subtitle || null,
          duration: s.duration || 3,
          status: 'draft',
        }))
      );
      return NextResponse.json({ success: true, data: shots });
    }

    const shot = await dramaWorkflowManager.createShot({
      dramaId: id,
      episodeId: body.episodeId,
      userId: payload.userId,
      shotNumber: body.shotNumber || 1,
      shotType: body.shotType || 'storyboard',
      sceneDescription: body.sceneDescription || null,
      cameraAngle: body.cameraAngle || null,
      cameraMovement: body.cameraMovement || null,
      dialogue: body.dialogue || null,
      voiceover: body.voiceover || null,
      soundEffects: body.soundEffects || null,
      characterIds: body.characterIds ? JSON.stringify(body.characterIds) : null,
      imagePrompt: body.imagePrompt || null,
      videoPrompt: body.videoPrompt || null,
      ttsText: body.ttsText || null,
      subtitle: body.subtitle || null,
      duration: body.duration || 3,
      status: 'draft',
    });
    return NextResponse.json({ success: true, data: shot });
  } catch (error) {
    console.error('创建分镜失败:', error);
    return NextResponse.json({ error: '创建分镜失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const body = await request.json();
    if (!body.shotId) return NextResponse.json({ error: '缺少分镜ID' }, { status: 400 });

    // 获取旧的分镜数据，比对并物理删除旧文件（仅图片，视频保留在画廊中）
    const oldShot = await dramaWorkflowManager.getShotById(body.shotId);
    if (oldShot) {
      if ('imageUrl' in body && body.imageUrl !== oldShot.imageUrl) {
        await deleteLocalFileByUrl(oldShot.imageUrl);
      }
      // 视频不再自动删除，因为有画廊历史功能

      // 视频切换逻辑：当 videoUrl 变化时，更新画廊排序
      if ('videoUrl' in body && body.videoUrl !== oldShot.videoUrl) {
        let gallery: any[] = [];
        try {
          if (oldShot.videoGallery) {
            try { gallery = JSON.parse(oldShot.videoGallery); } catch { gallery = []; }
          }
          // 1. 将旧 videoUrl 加入画廊（如果不在其中）
          if (oldShot.videoUrl && !gallery.some((g: any) => g.url === oldShot.videoUrl)) {
            gallery = [{
              url: oldShot.videoUrl,
              prompt: oldShot.videoPrompt || oldShot.sceneDescription || '',
              createdAt: new Date().toISOString()
            }, ...gallery];
          }
          // 2. 如果新 videoUrl 不为空，将其移到画廊开头
          if (body.videoUrl) {
            gallery = gallery.filter((g: any) => g.url !== body.videoUrl);
            // 清除所有条目的 isNew 标记（用户已选择此版本）
            gallery = gallery.map((g: any) => { const { isNew: _, ...rest } = g; return rest; });
            gallery = [{
              url: body.videoUrl,
              prompt: body.videoPrompt || oldShot.videoPrompt || oldShot.sceneDescription || '',
              createdAt: new Date().toISOString()
            }, ...gallery];
          }
          // 3. 更新 body 中的 videoGallery（仅当请求未显式提供 videoGallery 时才自动计算）
          if (!('videoGallery' in body)) {
            // 过滤无效条目
            gallery = gallery.filter((g: any) => g && g.url && typeof g.url === 'string' && g.url.trim());
            body.videoGallery = JSON.stringify(gallery.slice(0, 30));
          } else {
            // 显式提供的 videoGallery 也需要过滤无效条目
            try {
              const parsed = typeof body.videoGallery === 'string' ? JSON.parse(body.videoGallery) : body.videoGallery;
              if (Array.isArray(parsed)) {
                const filtered = parsed.filter((g: any) => g && g.url && typeof g.url === 'string' && g.url.trim());
                body.videoGallery = JSON.stringify(filtered.slice(0, 30));
              }
            } catch { /* 忽略 */ }
          }
        } catch { /* 忽略画廊错误 */ }
      } else if ('videoGallery' in body) {
        // 仅更新画廊（不替换主视频 videoUrl）—— 用于 ComfyUI 生成新视频时保留旧主视频
        // 前端已构建完整画廊列表，直接替换即可
        try {
          const parsed = typeof body.videoGallery === 'string' ? JSON.parse(body.videoGallery) : body.videoGallery;
          if (Array.isArray(parsed)) {
            const filtered = parsed.filter((g: any) => g && g.url && typeof g.url === 'string' && g.url.trim());
            body.videoGallery = JSON.stringify(filtered.slice(0, 30));
            // 关键：不设置 body.videoUrl，保留旧的主视频
            delete body.videoUrl;
            console.log(`[Storyboard] 仅更新画廊：shot=${body.shotId}, 画廊=${filtered.length}项, 主视频保留=${oldShot.videoUrl || '无'}`);
          }
        } catch { /* 忽略 */ }
      }
    }

    const updated = await dramaWorkflowManager.updateShot(body.shotId, body);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('更新分镜失败:', error);
    return NextResponse.json({ error: '更新分镜失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id } = await params;
    const body = await request.json();

    if (body.episodeId) {
      const drama = await shortDramaManager.getById(id);
      if (!drama || drama.userId !== payload.userId) {
        return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
      }

      // 获取当前集的所有分镜，遍历物理删除文件
      const shotsToDelete = await dramaWorkflowManager.getShotsByEpisodeId(body.episodeId);
      for (const shot of shotsToDelete) {
        await deleteLocalFileByUrl(shot.imageUrl);
        await deleteLocalFileByUrl(shot.videoUrl);
      }

      await dramaWorkflowManager.deleteShotsByEpisodeId(body.episodeId);
      return NextResponse.json({ success: true, message: '分集分镜已清空' });
    }

    if (!body.shotId) return NextResponse.json({ error: '缺少分镜ID' }, { status: 400 });

    // 获取该分镜，物理删除关联文件后再从数据库删除记录
    const shotToDelete = await dramaWorkflowManager.getShotById(body.shotId);
    if (shotToDelete) {
      await deleteLocalFileByUrl(shotToDelete.imageUrl);
      await deleteLocalFileByUrl(shotToDelete.videoUrl);
    }

    await dramaWorkflowManager.deleteShot(body.shotId);
    return NextResponse.json({ success: true, message: '分镜已删除' });
  } catch (error) {
    console.error('删除分镜失败:', error);
    return NextResponse.json({ error: '删除分镜失败' }, { status: 500 });
  }
}
