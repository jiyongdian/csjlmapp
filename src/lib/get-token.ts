/**
 * 从 localStorage 获取最新的 accessToken
 * 优先从 auth-storage（zustand persist）获取，因为 token 刷新后该处是最新的
 * 回退到 accessToken key
 */
/** 从本地 token 解析当前用户 id（仅客户端；解析失败返回 null） */
export function getUserIdFromToken(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const seg = token.split('.')[1] || '';
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return payload && payload.userId ? String(payload.userId) : null;
  } catch {
    return null;
  }
}
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const authStorage = localStorage.getItem('auth-storage');
    if (authStorage) {
      const parsed = JSON.parse(authStorage);
      if (parsed?.state?.token) return parsed.state.token;
    }
  } catch {}
  return localStorage.getItem('accessToken') || localStorage.getItem('token') || null;
}
