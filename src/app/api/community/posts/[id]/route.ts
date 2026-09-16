import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';

import { deletePost, getPost } from '@/lib/community/community-store';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    const { id } = await params;
    const post = getPost(id, payload?.userId);
    if (!post) return NextResponse.json({ error: '帖子不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data: post });
  } catch (e) {
    console.error('[Community] get post failed:', e);
    return NextResponse.json({ error: '获取帖子失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const { id } = await params;
    const ok = deletePost(id, payload.userId);
    if (!ok) return NextResponse.json({ error: '无权限删除该帖子' }, { status: 403 });
    return NextResponse.json({ success: true, message: '已删除' });
  } catch (e) {
    console.error('[Community] delete post failed:', e);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
