import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';

import { listAdminNovels } from '@/lib/admin/admin-store';

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
    const sp = request.nextUrl.searchParams;
    const result = listAdminNovels({ q: sp.get('q') || undefined, page: Math.max(1, parseInt(sp.get('page') || '1', 10)) });
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    console.error('[Admin] novels failed:', e);
    return NextResponse.json({ error: '获取作品失败' }, { status: 500 });
  }
}
