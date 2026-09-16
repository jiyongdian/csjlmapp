import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';

import { createPost, listPosts, listTopics } from '@/lib/community/community-store';

export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    const sp = request.nextUrl.searchParams;
    const result = listPosts({
      topicKey: sp.get('topic') || undefined,
      q: sp.get('q') || undefined,
      sort: (sp.get('sort') || 'new') as 'new' | 'hot',
      viewerId: payload?.userId,
      page: Math.max(1, parseInt(sp.get('page') || '1', 10)),
    });
    return NextResponse.json({ success: true, data: result, topics: listTopics() });
  } catch (e) {
    console.error('[Community] list posts failed:', e);
    return NextResponse.json({ error: '获取帖子失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const body = await request.json() as { title?: string; content?: string; images?: string[]; topicKey?: string };
    const title = (body.title ?? '').trim();
    const content = (body.content ?? '').trim();
    if (!title || !content) return NextResponse.json({ error: '标题和内容不能为空' }, { status: 400 });
    if (title.length > 60) return NextResponse.json({ error: '标题过长' }, { status: 400 });
    const post = createPost(payload.userId, { title, content, images: body.images ?? [], topicKey: body.topicKey });
    return NextResponse.json({ success: true, data: post });
  } catch (e) {
    console.error('[Community] create post failed:', e);
    return NextResponse.json({ error: '发帖失败' }, { status: 500 });
  }
}
