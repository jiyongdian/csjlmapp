import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';

import { deleteComment } from '@/lib/community/community-store';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const { id } = await params;
    const ok = deleteComment(id, payload.userId);
    if (!ok) return NextResponse.json({ error: '无权限删除' }, { status: 403 });
    return NextResponse.json({ success: true, message: '已删除' });
  } catch (e) {
    console.error('[Community] delete comment failed:', e);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
