import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { createAgentSession, listAgentSessions } from '@/lib/agent/agent-store';

export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const novelId = request.nextUrl.searchParams.get('novelId') || undefined;
    const scope = request.nextUrl.searchParams.get('scope') || undefined;
    const chapterParam = request.nextUrl.searchParams.get('chapterIndex');
    const chapterIndex = chapterParam !== null && chapterParam !== '' ? Number(chapterParam) : undefined;
    const sessions = listAgentSessions(payload.userId, novelId, scope, chapterIndex);
    return NextResponse.json({ success: true, data: sessions });
  } catch (e) {
    console.error('[Agent] list sessions failed:', e);
    return NextResponse.json({ error: '获取会话列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const body = await request.json() as { novelId?: string; chapterIndex?: number; title?: string; scope?: string };
    const session = createAgentSession(payload.userId, {
      novelId: body.novelId, chapterIndex: body.chapterIndex, title: body.title, scope: body.scope,
    });
    return NextResponse.json({ success: true, data: session });
  } catch (e) {
    console.error('[Agent] create session failed:', e);
    return NextResponse.json({ error: '创建会话失败' }, { status: 500 });
  }
}
