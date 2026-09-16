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
    const episodeId = request.nextUrl.searchParams.get('episodeId');
    const shots = episodeId
      ? await dramaWorkflowManager.getShotsByEpisodeId(episodeId)
      : await dramaWorkflowManager.getShotsByDramaId(id);
    return NextResponse.json({ success: true, data: shots });
  } catch (error) {
    console.error('获取分镜失败:', error);
    return NextResponse.json({ error: '获取分镜失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }
    const { shotId } = await request.json();
    if (!shotId) return NextResponse.json({ error: '缺少分镜ID' }, { status: 400 });
    await dramaWorkflowManager.deleteShot(shotId);
    return NextResponse.json({ success: true, message: '分镜已删除' });
  } catch (error) {
    console.error('删除分镜失败:', error);
    return NextResponse.json({ error: '删除分镜失败' }, { status: 500 });
  }
}
