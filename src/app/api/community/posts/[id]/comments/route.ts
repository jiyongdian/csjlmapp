import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';

import { addComment, listComments } from '@/lib/community/community-store';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    return NextResponse.json({ success: true, data: listComments(id) });
  } catch (e) {
    console.error('[Community] comments failed:', e);
    return NextResponse.json({ error: '获取评论失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const { id } = await params;
    const body = await request.json() as { content?: string };
    const content = (body.content ?? '').trim();
    if (!content) return NextResponse.json({ error: '评论不能为空' }, { status: 400 });
    const comments = addComment(id, payload.userId, content);
    return NextResponse.json({ success: true, data: comments });
  } catch (e) {
    console.error('[Community] add comment failed:', e);
    return NextResponse.json({ error: '评论失败' }, { status: 500 });
  }
}
