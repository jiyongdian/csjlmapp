import { EventEmitter } from 'events';

/**
 * 进程内实时事件总线（挂在 globalThis 上做单例，避免开发环境 HMR 重建模块后订阅丢失）。
 * 写入私信时 publishToUser(收件人)，SSE 接口按用户订阅并推送给浏览器。
 */
export interface RealtimeMessageEvent {
  type: 'message';
  threadId: string;
  messageId: string;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: string;
}

const BUS_KEY = '__cs_realtime_bus__';

function getBus(): EventEmitter {
  const holder = globalThis as unknown as Record<string, EventEmitter | undefined>;
  if (!holder[BUS_KEY]) {
    const emitter = new EventEmitter();
    // SSE 连接较多时不报警告
    emitter.setMaxListeners(0);
    holder[BUS_KEY] = emitter;
  }
  return holder[BUS_KEY] as EventEmitter;
}

function channel(userId: string): string {
  return 'user:' + userId;
}

/** 推送事件给指定用户（该用户当前所有在线连接都会收到） */
export function publishToUser(userId: string, event: RealtimeMessageEvent): void {
  try {
    getBus().emit(channel(userId), event);
  } catch (e) {
    console.error('[Realtime] publish failed:', e);
  }
}

/** 订阅指定用户的实时事件，返回取消订阅函数 */
export function subscribeUser(userId: string, handler: (event: RealtimeMessageEvent) => void): () => void {
  const emitter = getBus();
  const ch = channel(userId);
  emitter.on(ch, handler);
  return () => {
    emitter.off(ch, handler);
  };
}
