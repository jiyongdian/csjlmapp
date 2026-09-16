import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { dramaWorkflowManager } from '@/storage/database';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }
    const { id } = await params;
    const characters = await dramaWorkflowManager.getCharactersByDramaId(id);
    return NextResponse.json({ success: true, data: characters });
  } catch (error) {
    console.error('获取角色失败:', error);
    return NextResponse.json({ error: '获取角色失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }
    const { characterId } = await request.json();
    if (!characterId) return NextResponse.json({ error: '缺少角色ID' }, { status: 400 });
    await dramaWorkflowManager.deleteCharacter(characterId);
    return NextResponse.json({ success: true, message: '角色已删除' });
  } catch (error) {
    console.error('删除角色失败:', error);
    return NextResponse.json({ error: '删除角色失败' }, { status: 500 });
  }
}
