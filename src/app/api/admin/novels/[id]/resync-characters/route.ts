import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { novelManager, novelDetailManager } from '@/storage/database';
import { syncNovelDetails } from '@/lib/novel-detail-sync';

/**
 * POST /api/admin/novels/[id]/resync-characters
 * 强制重新解析 idea.characters/supportingCharacters 同步到 novel_characters 子表
 * 用于修复历史脏数据（包括角色和关系）
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

  // 强制清除现有角色再重新解析
  await novelDetailManager.deleteCharactersByNovelId(id);

  // 用当前 idea 重新同步（body 模拟 PUT 请求体）
  const body: any = { idea: novel.idea, structure: novel.structure, protagonist: novel.protagonist };
  await syncNovelDetails(id, novel.userId, body);

  const chars = await novelDetailManager.getCharactersByNovelId(id);
  return NextResponse.json({
    success: true,
    message: `重新同步完成，共创建 ${chars.length} 个角色`,
    characters: chars.map((c: any) => ({ name: c.name, role: c.role })),
  });
}
