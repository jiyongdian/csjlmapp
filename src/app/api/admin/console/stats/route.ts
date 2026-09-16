import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';

import { getStats } from '@/lib/admin/admin-store';

function requireAdmin(request: NextRequest): { userId: string } | { error: Response } {
  const payload = getUserFromToken(request.headers.get('authorization'));
  if (!payload || payload.role !== 'admin') {
    return { error: NextResponse.json({ error: '需要管理员权限' }, { status: 403 }) };
  }
  return { userId: payload.userId };
}

export async function GET(request: NextRequest) {
  const guard = requireAdmin(request);
  if ('error' in guard) return guard.error;
  try {
    const stats = getStats();
    return NextResponse.json({ success: true, data: stats });
  } catch (e) {
    console.error('[Admin] stats failed:', e);
    return NextResponse.json({ error: '获取统计失败' }, { status: 500 });
  }
}
