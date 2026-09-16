import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { novelDetailManager, novelManager } from '@/storage/database';
import { syncNovelDetails } from '@/lib/novel-detail-sync';
import { syncSingleCharacterToDrama } from '@/lib/auto-drama';
import { expandCharacterRelationshipRows } from '@/lib/character-relationships';

/**
 * PUT /api/admin/novels/[id]/details
 * 更新小说的角色/场景/物品
 * body: { type: 'character'|'scene'|'item', entityId: string, data: {...} }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    if (payload.role !== 'admin') return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });

    const { id: novelId } = await params;
    const { type, entityId, data } = await request.json();
    if (!type || !entityId || !data) return NextResponse.json({ error: '参数不完整' }, { status: 400 });

    // 获取小说的 userId（用于短剧角色同步）
    const novel = await novelManager.getById(novelId);
    if (!novel) return NextResponse.json({ error: '小说不存在' }, { status: 404 });

    let updated;
    if (type === 'character') {
      const oldChar = await novelDetailManager.getCharacterById(entityId);
      const oldName = oldChar ? oldChar.name : '';
      
      updated = await novelDetailManager.updateCharacter(entityId, data);
      
      // 同步更新到短剧角色表（使用小说所有者的 userId）
      if (updated) {
        await syncSingleCharacterToDrama(novelId, novel.userId, oldName, updated);
      }
    } else if (type === 'relationship') {
      updated = await novelDetailManager.updateRelationship(entityId, data);
    } else if (type === 'scene') {
      updated = await novelDetailManager.updateScene(entityId, data);
    } else if (type === 'item') {
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
 * GET /api/admin/novels/[id]/details
 * 获取小说的结构化子表数据（剧情、钩子、角色、场景、物品）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    if (payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const { id } = await params;
    
    // 先获取现有详情
    let existingDetails = await novelDetailManager.getNovelDetails(id);
    
    // 如果需要同步角色或关系数据
    const needSyncChars = !existingDetails.characters || existingDetails.characters.length === 0;
    const relationshipRows = existingDetails.relationships || [];
    const expandedRelationships = expandCharacterRelationshipRows(relationshipRows);
    const needSyncRels = relationshipRows.length === 0 || expandedRelationships.length > relationshipRows.length;
    const needSyncConflicts = !existingDetails.conflicts || existingDetails.conflicts.length === 0;
    
    if ((needSyncChars || needSyncRels || needSyncConflicts) && id) {
      const novel = await novelManager.getById(id);
      if (novel && novel.idea) {
        try {
          console.log(`[Admin Details GET] Auto-syncing for novel ${id}, needChars=${needSyncChars}, needRels=${needSyncRels}, needConflicts=${needSyncConflicts}`);
          await syncNovelDetails(id, novel.userId, {
            idea: novel.idea,
            structure: novel.structure,
            protagonist: novel.protagonist,
          });
          // 重新获取同步后的数据
          existingDetails = await novelDetailManager.getNovelDetails(id);
        } catch (e) {
          console.warn('[Admin Details GET] Auto-sync failed:', e);
        }
      }
    }

    const finalRelationships = expandCharacterRelationshipRows(existingDetails.relationships || []);

    return NextResponse.json({
      success: true,
      data: {
        ...existingDetails,
        relationships: finalRelationships,
      },
    });
  } catch (error) {
    console.error('获取小说详情失败:', error);
    return NextResponse.json({ error: '获取小说详情失败' }, { status: 500 });
  }
}
