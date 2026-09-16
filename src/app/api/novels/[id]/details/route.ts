import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { novelDetailManager, novelManager } from '@/storage/database';
import { syncSingleCharacterToDrama } from '@/lib/auto-drama';

/**
 * PUT /api/novels/[id]/details
 * 普通用户更新小说的角色/场景/物品
 * body: { type: 'character'|'scene'|'item', entityId: string, data: {...} }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const { id: novelId } = await params;
    const { type, entityId, data } = await request.json();
    if (!type || !entityId || !data) return NextResponse.json({ error: '参数不完整' }, { status: 400 });

    // 验证小说所有权
    const novel = await novelManager.getById(novelId);
    if (!novel) return NextResponse.json({ error: '小说不存在' }, { status: 404 });
    if (novel.userId !== payload.userId && payload.role !== 'admin') {
      return NextResponse.json({ error: '无权操作此小说' }, { status: 403 });
    }

    let updated;
    if (type === 'character') {
      const oldChar = await novelDetailManager.getCharacterById(entityId);
      if (!oldChar || oldChar.novelId !== novelId) {
        return NextResponse.json({ error: '角色不存在' }, { status: 404 });
      }
      const oldName = oldChar.name;
      
      updated = await novelDetailManager.updateCharacter(entityId, data);
      
      // 同步更新到短剧角色表
      if (updated) {
        await syncSingleCharacterToDrama(novelId, payload.userId, oldName, updated);
      }
    } else if (type === 'scene') {
      const oldScene = await novelDetailManager.getSceneById(entityId);
      if (!oldScene || oldScene.novelId !== novelId) {
        return NextResponse.json({ error: '场景不存在' }, { status: 404 });
      }
      updated = await novelDetailManager.updateScene(entityId, data);
    } else if (type === 'item') {
      const oldItem = await novelDetailManager.getItemById(entityId);
      if (!oldItem || oldItem.novelId !== novelId) {
        return NextResponse.json({ error: '物品不存在' }, { status: 404 });
      }
      updated = await novelDetailManager.updateItem(entityId, data);
    } else {
      return NextResponse.json({ error: '无效的类型' }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('更新小说详情失败:', error);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}

/**
 * GET /api/novels/[id]/details
 * 普通用户获取小说的结构化数据
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const { id } = await params;
    const novel = await novelManager.getById(id);
    if (!novel) return NextResponse.json({ error: '小说不存在' }, { status: 404 });
    if (novel.userId !== payload.userId && payload.role !== 'admin') {
      return NextResponse.json({ error: '无权操作此小说' }, { status: 403 });
    }

    const details = await novelDetailManager.getNovelDetails(id);
    return NextResponse.json({ success: true, data: details });
  } catch (error) {
    console.error('获取小说详情失败:', error);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}
