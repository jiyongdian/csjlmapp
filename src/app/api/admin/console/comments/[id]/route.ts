import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';

import { addAuditLog } from '@/lib/admin/admin-store';
import { deleteComment } from '@/lib/community/community-store';

function requireAdmin(request: NextRequest): { userId: string } | { error: Response } {
  const payload = getUserFromToken(request.headers.get('authorization'));
  if (!payload || payload.role !== 'admin') {
    return { error: NextResponse.json({ error: '需要管理员权限' }, { status: 403 }) };
  }
  return { userId: payload.userId };
}

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const guard = requireAdmin(request);
  if ('error' in guard) return guard.error;
  try {
    const { id } = await params;
    const ok = deleteComment(id, guard.userId);
    if (!ok) return NextResponse.json({ error: '评论不存在' }, { status: 404 });
    addAuditLog(guard.userId, 'delete_comment', 'comment', id);
    return NextResponse.json({ success: true, message: '已删除' });
  } catch (e) {
    console.error('[Admin] comment delete failed:', e);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
