import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { shortDramaManager, dramaWorkflowManager } from '@/storage/database';
import type { InsertDramaCharacter } from '@/storage/database/shared/schema';
import { deleteLocalFileByUrl } from '@/lib/system-settings';

function serializeJsonField(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// 将新图片添加到画廊开头（避免重复，包含当前主图）
// 设计：gallery 保存所有生成过的图片（包括当前主图），最新生成的在最前
function prependToGallery(galleryJson: string | null | undefined, newImage: { url: string; prompt?: string; createdAt?: string }): any[] {
  let gallery: any[] = [];
  if (galleryJson) {
    try { gallery = JSON.parse(galleryJson); } catch { gallery = []; }
  }
  if (!newImage.url) return gallery;
  // 移除已存在的相同URL，避免重复
  const filtered = gallery.filter((g: any) => g.url !== newImage.url);
  // 新图加在最前面
  return [{ ...newImage, createdAt: newImage.createdAt || new Date().toISOString() }, ...filtered].slice(0, 50); // 最多保留50张
}

// 获取当前完整图库（合并主图+旧gallery，去重），返回统一格式的完整数组
function getFullGallery(imageUrl: string | null | undefined, imagePrompt: string | null | undefined, galleryJson: string | null | undefined): any[] {
  let gallery: any[] = [];
  if (galleryJson) {
    try { gallery = JSON.parse(galleryJson); } catch { gallery = []; }
  }
  // 如果主图不在gallery中，把它加到最前面（兼容旧数据）
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
    const characters = await dramaWorkflowManager.getCharactersByDramaId(id);
    return NextResponse.json({ success: true, data: characters });
  } catch (error) {
    console.error('获取角色失败:', error);
    return NextResponse.json({ error: '获取角色失败' }, { status: 500 });
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
    const character = await dramaWorkflowManager.createCharacter({
      dramaId: id,
      userId: payload.userId,
      name: body.name,
      role: body.role || 'supporting',
      description: body.description || null,
      personality: body.personality || null,
      appearance: body.appearance || null,
      aliases: body.aliases || null,
      appearanceHairColor: body.appearanceHairColor || null,
      appearanceHairstyle: body.appearanceHairstyle || null,
      appearanceEyes: body.appearanceEyes || null,
      appearanceUpper: body.appearanceUpper || null,
      appearanceLower: body.appearanceLower || null,
      voiceId: body.voiceId || null,
      voiceProvider: body.voiceProvider || null,
      voiceConfig: serializeJsonField(body.voiceConfig) ?? null,
      imageUrl: body.imageUrl || null,
      imagePrompt: body.imagePrompt || null,
      referenceImages: serializeJsonField(body.referenceImages) ?? null,
      sortOrder: body.sortOrder || 0,
    } as unknown as InsertDramaCharacter);
    return NextResponse.json({ success: true, data: character });
  } catch (error) {
    console.error('创建角色失败:', error);
    return NextResponse.json({ error: '创建角色失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const body = await request.json();
    const updateData = { ...body };
    delete updateData.characterId;
    if ('voiceConfig' in updateData) updateData.voiceConfig = serializeJsonField(updateData.voiceConfig);
    if ('referenceImages' in updateData) updateData.referenceImages = serializeJsonField(updateData.referenceImages);
    if ('imageGallery' in updateData) updateData.imageGallery = serializeJsonField(updateData.imageGallery);
    if (!body.characterId) return NextResponse.json({ error: '缺少角色ID' }, { status: 400 });

    // 获取旧数据
    const oldChar = await dramaWorkflowManager.getCharacterById(body.characterId);
    if (!oldChar || (oldChar.userId !== payload.userId && payload.role !== 'admin')) {
      return NextResponse.json({ error: '无权操作此角色' }, { status: 403 });
    }

    // 获取完整图库（包含主图）
    let fullGallery = getFullGallery(oldChar.imageUrl, oldChar.imagePrompt, oldChar.imageGallery);

    // 处理从画廊选择当前图片（只更新imageUrl，不修改gallery）
    if ('selectGalleryIndex' in body && typeof body.selectGalleryIndex === 'number') {
      const idx = body.selectGalleryIndex;
      if (idx >= 0 && idx < fullGallery.length) {
        updateData.imageUrl = fullGallery[idx].url;
        // gallery 不做改动，所有图片都保留
        updateData.imageGallery = JSON.stringify(fullGallery);
      }
      delete updateData.selectGalleryIndex;
    }
    // 处理设置新图片URL（生成新图或上传）
    else if ('imageUrl' in body) {
      const newImageUrl = body.imageUrl;

      // 如果是清空图片（imageUrl为空字符串或null）—— 删除当前主图
      if (!newImageUrl) {
        const currentUrl = oldChar.imageUrl;
        // 物理删除当前主图文件
        if (currentUrl) {
          await deleteLocalFileByUrl(currentUrl);
        }
        // 从gallery中移除当前主图
        const newGallery = fullGallery.filter((g: any) => g.url !== currentUrl);
        // 选择第一张作为新主图
        if (newGallery.length > 0) {
          updateData.imageUrl = newGallery[0].url;
          updateData.imageGallery = JSON.stringify(newGallery);
        } else {
          updateData.imageUrl = null;
          updateData.imageGallery = JSON.stringify([]);
        }
      }
      // 如果是设置新图片URL（且和旧的不同）—— 新图加入画廊开头，设为主图
      else if (newImageUrl !== oldChar.imageUrl) {
        // 新图片加到画廊开头
        const newGallery = prependToGallery(JSON.stringify(fullGallery), {
          url: newImageUrl,
          prompt: body.imagePrompt || oldChar.imagePrompt || '',
        });
        updateData.imageUrl = newImageUrl;
        updateData.imageGallery = JSON.stringify(newGallery);
      }
    }

    // 处理图库删除操作（删除某张图片）
    if ('deleteGalleryIndex' in body && typeof body.deleteGalleryIndex === 'number') {
      const idx = body.deleteGalleryIndex;
      if (idx >= 0 && idx < fullGallery.length) {
        const deletedImg = fullGallery[idx];
        // 物理删除文件
        await deleteLocalFileByUrl(deletedImg.url);
        // 从gallery移除
        const newGallery = fullGallery.filter((_: any, i: number) => i !== idx);
        // 如果删除的是当前主图，自动选择第一张作为新主图
        if (deletedImg.url === oldChar.imageUrl) {
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

    const updated = await dramaWorkflowManager.updateCharacter(body.characterId, updateData);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('更新角色失败:', error);
    return NextResponse.json({ error: '更新角色失败' }, { status: 500 });
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

      // 遍历物理删除所有角色的图片（包括画廊）
      const chars = await dramaWorkflowManager.getCharactersByDramaId(dramaId);
      for (const char of chars) {
        await deleteLocalFileByUrl(char.imageUrl);
        if (char.imageGallery) {
          try {
            const gallery = JSON.parse(char.imageGallery);
            for (const g of gallery) {
              await deleteLocalFileByUrl(g.url);
            }
          } catch {}
        }
      }

      await dramaWorkflowManager.deleteCharactersByDramaId(dramaId);
      return NextResponse.json({ success: true, message: '已清除全部角色' });
    }
    if (!body.characterId) return NextResponse.json({ error: '缺少角色ID' }, { status: 400 });

    // 获取并物理删除角色的所有图片（包括画廊）
    const char = await dramaWorkflowManager.getCharacterById(body.characterId);
    if (!char || (char.userId !== payload.userId && payload.role !== 'admin')) {
      return NextResponse.json({ error: '无权删除此角色' }, { status: 403 });
    }
    if (char) {
      await deleteLocalFileByUrl(char.imageUrl);
      if (char.imageGallery) {
        try {
          const gallery = JSON.parse(char.imageGallery);
          for (const g of gallery) {
            await deleteLocalFileByUrl(g.url);
          }
        } catch {}
      }
    }

    await dramaWorkflowManager.deleteCharacter(body.characterId);
    return NextResponse.json({ success: true, message: '角色已删除' });
  } catch (error) {
    console.error('删除角色失败:', error);
    return NextResponse.json({ error: '删除角色失败' }, { status: 500 });
  }
}
