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
    const type = request.nextUrl.searchParams.get('type') || undefined;
    const tasks = await dramaWorkflowManager.getTasksByDramaId(id, type);
    return NextResponse.json({ success: true, data: tasks });
  } catch (error) {
    console.error('获取任务失败:', error);
    return NextResponse.json({ error: '获取任务失败' }, { status: 500 });
  }
}
