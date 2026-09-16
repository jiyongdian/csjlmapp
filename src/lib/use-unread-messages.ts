'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/get-token';
import { subscribeRealtime } from '@/lib/realtime-client';

/**
 * 未读私信计数：全局共享一份状态 + 轮询，多个入口（社区顶栏、导航抽屉）共用，避免重复请求。
 * 登录态变化 / 阅读会话后调用 refreshUnreadMessages() 立即刷新。
 */
const POLL_MS = 30000;

let count = 0;
let started = false;
const subscribers = new Set<(n: number) => void>();

function publish(n: number): void {
  count = n;
  subscribers.forEach((fn) => fn(n));
}

export async function refreshUnreadMessages(): Promise<number> {
  const token = getToken();
  if (!token) {
    publish(0);
    return 0;
  }
  try {
    const res = await fetch('/api/messages/unread', {
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store',
    });
    const json = await res.json();
    const n = json && json.success ? Number(json.data) || 0 : 0;
    publish(n);
    return n;
  } catch {
    return count;
  }
}

function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  refreshUnreadMessages();
  setInterval(() => { refreshUnreadMessages(); }, POLL_MS);
  window.addEventListener('focus', () => { refreshUnreadMessages(); });
  // 收到实时消息后立即刷新未读计数
  subscribeRealtime(() => { refreshUnreadMessages(); });
}

export function useUnreadMessages(): number {
  const [n, setN] = useState(count);
  useEffect(() => {
    subscribers.add(setN);
    start();
    refreshUnreadMessages();
    return () => { subscribers.delete(setN); };
  }, []);
  return n;
}
