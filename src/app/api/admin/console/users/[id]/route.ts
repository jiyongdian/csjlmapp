import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';

import { addAuditLog, setUserRole, toggleUserActive } from '@/lib/admin/admin-store';

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
    const body = await request.json() as { role?: string; isActive?: boolean };
    if (body.role !== undefined) {
      if (!['admin', 'user'].includes(body.role)) return NextResponse.json({ error: '角色无效' }, { status: 400 });
      if (id === guard.userId) return NextResponse.json({ error: '不能修改自己的角色' }, { status: 400 });
      setUserRole(id, body.role);
      addAuditLog(guard.userId, 'set_role', 'user', id, body.role);
    }
    if (body.isActive !== undefined) {
      if (id === guard.userId) return NextResponse.json({ error: '不能封禁自己' }, { status: 400 });
      toggleUserActive(id, body.isActive);
      addAuditLog(guard.userId, body.isActive ? 'unban_user' : 'ban_user', 'user', id);
    }
    return NextResponse.json({ success: true, message: '已更新' });
  } catch (e) {
    console.error('[Admin] user update failed:', e);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}
