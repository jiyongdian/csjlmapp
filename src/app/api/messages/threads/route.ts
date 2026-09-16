import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';

import { listThreads, sendMessage } from '@/lib/community/community-store';

export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const threads = listThreads(payload.userId);
    return NextResponse.json({ success: true, data: threads });
  } catch (e) {
    console.error('[Messages] threads failed:', e);
    return NextResponse.json({ error: '获取会话失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const body = await request.json() as { otherUserId?: string; content?: string };
    if (!body.otherUserId || body.otherUserId === payload.userId) return NextResponse.json({ error: '接收者无效' }, { status: 400 });
    const content = (body.content ?? '').trim();
    if (!content) return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    const result = sendMessage(payload.userId, body.otherUserId, content);
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    console.error('[Messages] send failed:', e);
    return NextResponse.json({ error: '发送失败' }, { status: 500 });
  }
}
