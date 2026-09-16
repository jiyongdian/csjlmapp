import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { novelManager, novelDetailManager } from '@/storage/database';
import { syncNovelDetails } from '@/lib/novel-detail-sync';

/**
 * POST /api/admin/novels/[id]/resync-details
 * 强制重新解析小说 idea/structure 同步到所有子表（角色、关系、场景、物品等）
 * 用于修复历史数据不同步问题
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = request.headers.get('authorization');
  const payload = getUserFromToken(authHeader);
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ success: false, message: '无权限' }, { status: 403 });
  }

  const { id } = await params;
  const novel = await novelManager.getById(id);
  if (!novel) {
    return NextResponse.json({ success: false, message: '小说不存在' }, { status: 404 });
  }

  // 强制清除所有现有详情数据
  await novelDetailManager.deleteCharactersByNovelId(id);
  await novelDetailManager.deleteRelationshipsByNovelId(id);
  await novelDetailManager.deleteConflictsByNovelId(id);
  await novelDetailManager.deleteScenesByNovelId(id);
  await novelDetailManager.deleteItemsByNovelId(id);
  await novelDetailManager.deletePlotByNovelId(id);
  await novelDetailManager.deleteHooksByNovelId(id);

  // 用当前 idea/structure 重新同步
  const body: any = { idea: novel.idea, structure: novel.structure, protagonist: novel.protagonist };
  await syncNovelDetails(id, novel.userId, body);

  const [chars, rels, conflicts, scenes, items, hooks] = await Promise.all([
    novelDetailManager.getCharactersByNovelId(id),
    novelDetailManager.getRelationshipsByNovelId(id),
    novelDetailManager.getConflictsByNovelId(id),
    novelDetailManager.getScenesByNovelId(id),
    novelDetailManager.getItemsByNovelId(id),
    novelDetailManager.getHooksByNovelId(id),
  ]);

  return NextResponse.json({
    success: true,
    message: '重新同步完成',
    counts: {
      characters: chars.length,
      relationships: rels.length,
      conflicts: conflicts.length,
      scenes: scenes.length,
      items: items.length,
      hooks: hooks.length,
    },
  });
}
