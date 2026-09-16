import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';

import { toggleLike } from '@/lib/community/community-store';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const { id } = await params;
    const result = toggleLike(payload.userId, id);
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    console.error('[Community] like failed:', e);
    return NextResponse.json({ error: '操作失败' }, { status: 500 });
  }
}
