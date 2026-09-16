'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/get-token';
import { FRONTEND_NAV, type NavEntry } from '@/lib/nav-config';

let cache: NavEntry[] | null = null;
let cacheRole: boolean | null = null;

/** 后台改了菜单 / 登录态变化后调用，让前台下次渲染重新拉取 */
export function invalidateFrontendNav(): void {
  cache = null;
  cacheRole = null;
}

export async function loadFrontendNav(): Promise<NavEntry[]> {
  const isAdmin = isAdminFromToken();
  if (cache && cacheRole === isAdmin) return cache;

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  try {
    const res = await fetch('/api/nav-config', { headers, cache: 'no-store' });
    const json = await res.json();
    const items = json && json.success && json.data && Array.isArray(json.data.items) && json.data.items.length
      ? (json.data.items as NavEntry[])
      : FRONTEND_NAV;
    cache = items;
    cacheRole = isAdmin;
    return items;
  } catch {
    return FRONTEND_NAV;
  }
}

/** 统一的菜单数据：先用默认值渲染，拿到后台配置后自动替换 */
export function useFrontendNav(): NavEntry[] {
  const [items, setItems] = useState<NavEntry[]>(FRONTEND_NAV);
  useEffect(() => {
    let alive = true;
    loadFrontendNav().then((next) => { if (alive) setItems(next); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return items;
}

/** 从本地 token 解析角色（仅在客户端、组件挂载后调用，避免 SSR 水合不一致） */
export function isAdminFromToken(): boolean {
  try {
    const token = getToken();
    if (!token) return false;
    const seg = token.split('.')[1] || '';
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return String(payload && payload.role) === 'admin';
  } catch {
    return false;
  }
}
