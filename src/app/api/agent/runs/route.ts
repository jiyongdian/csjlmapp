import { NextRequest } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { getAgentSession, setAgentSessionChapter } from '@/lib/agent/agent-store';
import { runAgentLoop } from '@/lib/agent/run-loop';
import type { AgentStreamEvent } from '@/lib/agent/types';

export async function POST(request: NextRequest) {
  const payload = getUserFromToken(request.headers.get('authorization'));
  if (!payload) return new Response('未授权', { status: 401 });

  const body = await request.json() as {
    sessionId?: string; novelId?: string; chapterIndex?: number; prompt?: string;
    narrativePerspective?: string; genderTarget?: string; category?: string; skipUserMessage?: boolean;
  };

  const prompt = (body.prompt ?? '').trim();
  if (!prompt) return new Response('prompt 不能为空', { status: 400 });
  const sessionId = body.sessionId;
  if (!sessionId) return new Response('sessionId 不能为空', { status: 400 });

  const session = getAgentSession(sessionId);
  // 回写本次操作的章节到会话（供会话列表显示"小说·第X章"）
  if (body.chapterIndex !== undefined && body.chapterIndex !== null) {
    setAgentSessionChapter(sessionId, Number(body.chapterIndex));
  } else if (session?.chapterIndex) {
    setAgentSessionChapter(sessionId, session.chapterIndex);
  }
  console.log('[Agent-Run] session=', sessionId, 'novelId=', body.novelId || session?.novelId, 'chapterIndex=', body.chapterIndex !== undefined ? body.chapterIndex : session?.chapterIndex, 'prompt=', prompt.slice(0, 60));
  if (!session || session.userId !== payload.userId) {
    console.warn('[Agent DEBUG] runs 404 ->', JSON.stringify({ sessionId, payloadUserId: payload.userId, session: session ? { id: session.id, userId: session.userId } : null }));
    return new Response('会话不存在', { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (data: string): boolean => {
        try { controller.enqueue(encoder.encode(data)); return true; }
        catch { return false; }
      };
      const push = (event: AgentStreamEvent) => {
        safeEnqueue('data: ' + JSON.stringify(event) + '\n\n');
      };
      try {
        await runAgentLoop({
          userId: payload.userId,
          sessionId,
          novelId: body.novelId || session.novelId || undefined,
          chapterIndex: body.chapterIndex !== undefined ? body.chapterIndex : (session.chapterIndex ?? undefined),
          prompt,
          narrativePerspective: body.narrativePerspective,
          genderTarget: body.genderTarget,
          category: body.category,
          skipUserMessage: !!body.skipUserMessage,
          push,
        });
      } catch (e) {
        push({ type: 'run_error', runId: '', message: e instanceof Error ? e.message : String(e) });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() { /* 客户端断开 */ },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
