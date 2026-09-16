import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { shortDramaManager, dramaWorkflowManager } from '@/storage/database';
import { deleteLocalFileByUrl } from '@/lib/system-settings';

function serializeJsonField(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// 将新图片添加到画廊开头（避免重复，包含当前主图）
function prependToGallery(galleryJson: string | null | undefined, newImage: { url: string; prompt?: string; createdAt?: string }): any[] {
  let gallery: any[] = [];
  if (galleryJson) {
    try { gallery = JSON.parse(galleryJson); } catch { gallery = []; }
  }
  if (!newImage.url) return gallery;
  const filtered = gallery.filter((g: any) => g.url !== newImage.url);
  return [{ ...newImage, createdAt: newImage.createdAt || new Date().toISOString() }, ...filtered].slice(0, 50);
}

// 获取当前完整图库（合并主图+旧gallery，去重）
function getFullGallery(imageUrl: string | null | undefined, imagePrompt: string | null | undefined, galleryJson: string | null | undefined): any[] {
  let gallery: any[] = [];
  if (galleryJson) {
    try { gallery = JSON.parse(galleryJson); } catch { gallery = []; }
  }
  if (imageUrl && !gallery.some((g: any) => g.url === imageUrl)) {
    gallery = [{ url: imageUrl, prompt: imagePrompt || '', createdAt: new Date().toISOString() }, ...gallery];
  }
  return gallery.slice(0, 50);
}

export async function GET(
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
    const scenes = await dramaWorkflowManager.getScenesByDramaId(id);
    return NextResponse.json({ success: true, data: scenes });
  } catch (error) {
    console.error('获取场景失败:', error);
    return NextResponse.json({ error: '获取场景失败' }, { status: 500 });
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
    const scene = await dramaWorkflowManager.createScene({
      dramaId: id,
      userId: payload.userId,
      name: body.name,
      description: body.description || null,
      atmosphere: body.atmosphere || null,
      imageUrl: body.imageUrl || null,
      imagePrompt: body.imagePrompt || null,
      sortOrder: body.sortOrder || 0,
    });
    return NextResponse.json({ success: true, data: scene });
  } catch (error) {
    console.error('创建场景失败:', error);
    return NextResponse.json({ error: '创建场景失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const body = await request.json();
    if (!body.sceneId) return NextResponse.json({ error: '缺少场景ID' }, { status: 400 });

    const oldScene = await dramaWorkflowManager.getSceneById(body.sceneId);
    if (!oldScene || (oldScene.userId !== payload.userId && payload.role !== 'admin')) {
      return NextResponse.json({ error: '无权操作此场景' }, { status: 403 });
    }

    const updateData = { ...body };
    delete updateData.sceneId;
    if ('imageGallery' in updateData) updateData.imageGallery = serializeJsonField(updateData.imageGallery);

    // 获取完整图库（包含主图）
    let fullGallery = getFullGallery(oldScene.imageUrl, oldScene.imagePrompt, oldScene.imageGallery);

    // 处理从画廊选择当前图片（只更新imageUrl，不修改gallery）
    if ('selectGalleryIndex' in body && typeof body.selectGalleryIndex === 'number') {
      const idx = body.selectGalleryIndex;
      if (idx >= 0 && idx < fullGallery.length) {
        updateData.imageUrl = fullGallery[idx].url;
        updateData.imageGallery = JSON.stringify(fullGallery);
      }
      delete updateData.selectGalleryIndex;
    }
    // 处理设置新图片URL
    else if ('imageUrl' in body) {
      const newImageUrl = body.imageUrl;

      if (!newImageUrl) {
        // 删除当前主图
        const currentUrl = oldScene.imageUrl;
        if (currentUrl) {
          await deleteLocalFileByUrl(currentUrl);
        }
        const newGallery = fullGallery.filter((g: any) => g.url !== currentUrl);
        if (newGallery.length > 0) {
          updateData.imageUrl = newGallery[0].url;
          updateData.imageGallery = JSON.stringify(newGallery);
        } else {
          updateData.imageUrl = null;
          updateData.imageGallery = JSON.stringify([]);
        }
      }
      else if (newImageUrl !== oldScene.imageUrl) {
        // 新图片加入画廊开头
        const newGallery = prependToGallery(JSON.stringify(fullGallery), {
          url: newImageUrl,
          prompt: body.imagePrompt || oldScene.imagePrompt || '',
        });
        updateData.imageUrl = newImageUrl;
        updateData.imageGallery = JSON.stringify(newGallery);
      }
    }

    // 处理图库删除操作
    if ('deleteGalleryIndex' in body && typeof body.deleteGalleryIndex === 'number') {
      const idx = body.deleteGalleryIndex;
      if (idx >= 0 && idx < fullGallery.length) {
        const deletedImg = fullGallery[idx];
        await deleteLocalFileByUrl(deletedImg.url);
        const newGallery = fullGallery.filter((_: any, i: number) => i !== idx);
        if (deletedImg.url === oldScene.imageUrl) {
          if (newGallery.length > 0) {
            updateData.imageUrl = newGallery[0].url;
          } else {
            updateData.imageUrl = null;
          }
        }
        updateData.imageGallery = JSON.stringify(newGallery);
      }
      delete updateData.deleteGalleryIndex;
    }

    const updated = await dramaWorkflowManager.updateScene(body.sceneId, updateData);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('更新场景失败:', error);
    return NextResponse.json({ error: '更新场景失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id: dramaId } = await params;
    const body = await request.json();
    if (body.clearAll) {
      const drama = await shortDramaManager.getById(dramaId);
      if (!drama || (drama.userId !== payload.userId && payload.role !== 'admin')) {
        return NextResponse.json({ error: '无权限' }, { status: 403 });
      }

      const scenes = await dramaWorkflowManager.getScenesByDramaId(dramaId);
      for (const scene of scenes) {
        await deleteLocalFileByUrl(scene.imageUrl);
        if (scene.imageGallery) {
          try {
            const gallery = JSON.parse(scene.imageGallery);
            for (const g of gallery) {
              await deleteLocalFileByUrl(g.url);
            }
          } catch {}
        }
      }

      await dramaWorkflowManager.deleteScenesByDramaId(dramaId);
      return NextResponse.json({ success: true, message: '已清除全部场景' });
    }
    if (!body.sceneId) return NextResponse.json({ error: '缺少场景ID' }, { status: 400 });

    const scene = await dramaWorkflowManager.getSceneById(body.sceneId);
    if (scene) {
      await deleteLocalFileByUrl(scene.imageUrl);
      if (scene.imageGallery) {
        try {
          const gallery = JSON.parse(scene.imageGallery);
          for (const g of gallery) {
            await deleteLocalFileByUrl(g.url);
          }
        } catch {}
      }
    }

    await dramaWorkflowManager.deleteScene(body.sceneId);
    return NextResponse.json({ success: true, message: '场景已删除' });
  } catch (error) {
    console.error('删除场景失败:', error);
    return NextResponse.json({ error: '删除场景失败' }, { status: 500 });
  }
}
