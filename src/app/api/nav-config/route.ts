import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { getSystemSettings } from '@/lib/system-settings';
import { defaultNavItems, resolveNavEntries, type NavEntry } from '@/lib/nav-config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nav-config —— 前台菜单（后台可改名称/地址/显示/是否仅管理员可见）
 *
 * 安全策略：只对管理员下发「仅管理员可见」的入口。
 * 未登录 / 普通会员拿到的列表里根本不包含这些项，
 * 这样即使客户端过滤失效（旧缓存、旧 bundle 等）也不会暴露后台入口。
 */
export async function GET(request: NextRequest) {
  let isAdmin = false;
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    isAdmin = !!payload && payload.role === 'admin';
  } catch {
    isAdmin = false;
  }

  let items: NavEntry[];
  try {
    const settings = await getSystemSettings();
    const list = settings.navItems && settings.navItems.length ? settings.navItems : defaultNavItems;
    items = resolveNavEntries(list);
  } catch (e) {
    console.warn('[NavConfig] 读取菜单配置失败，回退默认值:', e instanceof Error ? e.message : e);
    items = resolveNavEntries(defaultNavItems);
  }

  const visible = isAdmin ? items : items.filter((item) => !item.adminOnly);
  return NextResponse.json({ success: true, data: { items: visible, isAdmin } });
}
