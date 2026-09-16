import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';

import { getOtherUserIdOfThread, listThreadMessages, sendMessage } from '@/lib/community/community-store';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const payload = getUserFromToken(_req.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const { id } = await params;
    const msgs = listThreadMessages(payload.userId, id);
    if (!msgs) return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data: msgs });
  } catch (e) {
    console.error('[Messages] list failed:', e);
    return NextResponse.json({ error: '读取失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const { id } = await params;
    const other = getOtherUserIdOfThread(payload.userId, id);
    if (!other) return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    const body = await request.json() as { content?: string };
    const content = (body.content ?? '').trim();
    if (!content) return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    sendMessage(payload.userId, other, content);
    const msgs = listThreadMessages(payload.userId, id);
    return NextResponse.json({ success: true, data: msgs });
  } catch (e) {
    console.error('[Messages] send failed:', e);
    return NextResponse.json({ error: '发送失败' }, { status: 500 });
  }
}
