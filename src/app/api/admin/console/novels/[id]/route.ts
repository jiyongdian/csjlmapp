import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';

import { addAuditLog, setNovelStatus } from '@/lib/admin/admin-store';

function requireAdmin(request: NextRequest): { userId: string } | { error: Response } {
  const payload = getUserFromToken(request.headers.get('authorization'));
  if (!payload || payload.role !== 'admin') {
    return { error: NextResponse.json({ error: '需要管理员权限' }, { status: 403 }) };
  }
  return { userId: payload.userId };
}

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const guard = requireAdmin(request);
  if ('error' in guard) return guard.error;
  try {
    const { id } = await params;
    const body = await request.json() as { status?: string };
    if (!body.status) return NextResponse.json({ error: 'status 必填' }, { status: 400 });
    const ok = setNovelStatus(id, body.status);
    if (!ok) return NextResponse.json({ error: '作品不存在' }, { status: 404 });
    addAuditLog(guard.userId, 'set_novel_status', 'novel', id, body.status);
    return NextResponse.json({ success: true, message: '已更新' });
  } catch (e) {
    console.error('[Admin] novel update failed:', e);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}
