import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { scriptManager, novelManager, userManager } from '@/storage/database';

// GET /api/admin/scripts/[id] - 获取剧本详情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    if (payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const script = await scriptManager.getScriptById(id);
    if (!script) {
      return NextResponse.json({ error: '剧本不存在' }, { status: 404 });
    }

    const novel = script.novelId ? await novelManager.getById(script.novelId as string) : null;
    const user = novel ? await userManager.getUserById(novel.userId as string) : null;

    return NextResponse.json({
      success: true,
      data: {
        ...script,
        novelTitle: (novel as Record<string, unknown>)?.title || '未知小说',
        userName: (user as Record<string, unknown>)?.nickname || (user as Record<string, unknown>)?.email || '未知用户',
      },
    });
  } catch (error) {
    console.error('Admin get script detail error:', error);
    return NextResponse.json({ error: '获取剧本详情失败' }, { status: 500 });
  }
}

// PUT /api/admin/scripts/[id] - 更新剧本状态
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    if (payload.role !== 'admin') return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });

    const body = await request.json();
    const { status } = body;
    const updated = await scriptManager.updateScript(id, { status });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('Admin update script error:', error);
    return NextResponse.json({ error: '更新剧本失败' }, { status: 500 });
  }
}

// DELETE /api/admin/scripts/[id] - 删除剧本
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    if (payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    await scriptManager.deleteScript(id);
    return NextResponse.json({ success: true, message: '剧本已删除' });
  } catch (error) {
    console.error('Admin delete script error:', error);
    return NextResponse.json({ error: '删除剧本失败' }, { status: 500 });
  }
}
