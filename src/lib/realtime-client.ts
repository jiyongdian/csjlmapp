'use client';

import { getToken } from '@/lib/get-token';

export interface RealtimeMessage {
  type: string;
  threadId: string;
  messageId: string;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: string;
}

type Listener = (msg: RealtimeMessage) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let tokenUsed: string | null = null;

function closeSource(): void {
  if (source) {
    source.close();
    source = null;
  }
  tokenUsed = null;
}

function ensureStarted(): void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
  const token = getToken();
  if (!token) {
    closeSource();
    return;
  }
  if (source && tokenUsed === token) return;
  closeSource();
  tokenUsed = token;

  const es = new EventSource('/api/messages/stream?token=' + encodeURIComponent(token));
  source = es;
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as RealtimeMessage;
      if (data && data.type === 'message') listeners.forEach((fn) => fn(data));
    } catch {
      // 忽略心跳 / 坏数据
    }
  };
  es.onerror = () => {
    // 未登录或 token 失效时不再重连，避免无意义的重试风暴
    if (!getToken()) closeSource();
  };
}

/** 订阅实时消息；返回取消订阅函数（组件卸载时调用） */
export function subscribeRealtime(fn: Listener): () => void {
  listeners.add(fn);
  ensureStarted();
  return () => {
    listeners.delete(fn);
  };
}

/** 登录态变化后重建 / 断开连接 */
export function resetRealtime(): void {
  closeSource();
  ensureStarted();
}
