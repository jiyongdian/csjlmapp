import { NextRequest } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { subscribeUser } from '@/lib/realtime/event-bus';

export const dynamic = 'force-dynamic';

/**
 * 实时消息推送（SSE）。
 * EventSource 不能自定义请求头，因此 token 通过查询参数传入（也兼容 Authorization 头）。
 */
export async function GET(request: NextRequest) {
  const tokenParam = request.nextUrl.searchParams.get('token');
  const authHeader = request.headers.get('authorization') || (tokenParam ? 'Bearer ' + tokenParam : null);
  const payload = getUserFromToken(authHeader);
  if (!payload) {
    return new Response('unauthorized', { status: 401 });
  }

  const userId = payload.userId;
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    if (ping) {
      clearInterval(ping);
      ping = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // 连接已断开，忽略
        }
      };

      // 断线后 3 秒重连
      write('retry: 3000\n\n');
      write('data: ' + JSON.stringify({ type: 'ready' }) + '\n\n');

      unsubscribe = subscribeUser(userId, (event) => {
        write('data: ' + JSON.stringify(event) + '\n\n');
      });

      // 心跳，避免中间层因空闲断开连接
      ping = setInterval(() => {
        write(': ping\n\n');
      }, 25000);
    },
    cancel() {
      cleanup();
    },
  });

  request.signal.addEventListener('abort', cleanup);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
