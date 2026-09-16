import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import {
  deleteAgentSession, getAgentSession, listAgentMessages, touchAgentSession,
} from '@/lib/agent/agent-store';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id } = await params;
    const session = getAgentSession(id);
    if (!session || session.userId !== payload.userId) {
      console.warn('[Agent DEBUG] sessions/[id] 404 ->', JSON.stringify({ id, payloadUserId: payload.userId, session: session ? { id: session.id, userId: session.userId } : null }));
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }
    // 更新会话标题：以第一条用户消息开头几个字命名（若仍是默认标题）
    if (session.title === '新对话') {
      const msgs = listAgentMessages(id);
      const firstUser = msgs.find((m) => m.role === 'user');
      if (firstUser) {
        const t = firstUser.content.replace(/\s+/g, ' ').slice(0, 60);
        if (t) touchAgentSession(id, t);
      }
    }
    const messages = listAgentMessages(id);
    return NextResponse.json({ success: true, data: { session, messages } });
  } catch (e) {
    console.error('[Agent] read session failed:', e);
    return NextResponse.json({ error: '读取会话失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id } = await params;
    const session = getAgentSession(id);
    if (!session || session.userId !== payload.userId) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }
    deleteAgentSession(id);
    return NextResponse.json({ success: true, message: '会话已删除' });
  } catch (e) {
    console.error('[Agent] delete session failed:', e);
    return NextResponse.json({ error: '删除会话失败' }, { status: 500 });
  }
}
