/** 入口配置：前台所有菜单导航统一从这里读取，保证各页面菜单完全一致 */
export interface NavEntry {
  key: string;
  label: string;
  href: string;
  icon: string;
  accent: string;
  adminOnly?: boolean;
}

/**
 * 后台可管理的部分。
 * - 默认入口：只需保存名称 / 地址 / 是否显示（图标、颜色、仅管理员沿用代码里的定义）
 * - 自定义入口：额外保存图标，并可设为仅管理员可见
 */
export interface NavItemSetting {
  key: string;
  label: string;
  href: string;
  visible: boolean;
  icon?: string;
  adminOnly?: boolean;
}

export const FRONTEND_NAV: NavEntry[] = [
  { key: 'home', label: '首页', href: '/', icon: '🏠', accent: 'text-gray-200' },
  { key: 'my-novels', label: '我的小说', href: '/my-novels', icon: '📚', accent: 'text-cyan-300' },
  { key: 'novel-generator', label: '创作中心', href: '/novel-generator', icon: '🎨', accent: 'text-purple-300' },
  { key: 'studio', label: '创作工作区', href: '/studio', icon: '🖋', accent: 'text-fuchsia-300' },
  { key: 'scripts', label: '我的剧本', href: '/scripts', icon: '🎬', accent: 'text-amber-300' },
  { key: 'short-dramas', label: '短剧制作', href: '/short-dramas', icon: '🎥', accent: 'text-sky-300' },
  { key: 'creative-hub', label: '创意中心', href: '/creative-hub', icon: '✨', accent: 'text-pink-300' },
  { key: 'agents', label: '智能体', href: '/agents', icon: '🤖', accent: 'text-emerald-300' },
  { key: 'books', label: '开放书城', href: '/books', icon: '🏛', accent: 'text-teal-300' },
  { key: 'books-rankings', label: '书城榜单', href: '/books/rankings', icon: '🏆', accent: 'text-yellow-300' },
  { key: 'community', label: '社区广场', href: '/community', icon: '💬', accent: 'text-indigo-300' },
  { key: 'messages', label: '私信', href: '/messages', icon: '✉️', accent: 'text-blue-300' },
  { key: 'workspace', label: '小说工作台', href: '/workspace', icon: '🧩', accent: 'text-violet-300' },
  { key: 'ai-settings', label: 'AI 设置', href: '/ai-settings', icon: '🎛', accent: 'text-lime-300' },
  { key: 'comfyui', label: 'ComfyUI 工作台', href: '/comfyui-workbench', icon: '🖼', accent: 'text-orange-300' },
  { key: 'member', label: '会员中心', href: '/member', icon: '👑', accent: 'text-amber-200' },
  { key: 'admin-members', label: '管理后台', href: '/admin/members', icon: '🛠', accent: 'text-red-300', adminOnly: true },
  { key: 'admin-console', label: '运营控制台', href: '/admin/console', icon: '📊', accent: 'text-red-300', adminOnly: true },
  { key: 'admin-settings', label: '系统配置', href: '/admin/settings', icon: '⚙️', accent: 'text-red-300', adminOnly: true },
];

/** 后台保存的默认值（全部显示、沿用代码里的顺序/名称/地址） */
export const defaultNavItems: NavItemSetting[] = FRONTEND_NAV.map((item) => ({
  key: item.key,
  label: item.label,
  href: item.href,
  visible: true,
}));

/** 是否为自定义入口（代码里没有定义的） */
export function isCustomNavKey(key: string): boolean {
  return !FRONTEND_NAV.some((item) => item.key === key);
}

/** 生成自定义入口的 key */
export function createCustomNavKey(): string {
  return 'custom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

/** 校验地址：允许站内路径（/ 开头）或完整 http(s) 链接 */
export function isValidNavHref(href: string): boolean {
  const v = String(href || '').trim();
  if (!v) return false;
  if (v.startsWith('/')) return true;
  if (v.indexOf('http://') === 0 || v.indexOf('https://') === 0) return true;
  return false;
}

/**
 * 归一化后台保存值：
 * - 保留后台保存的先后顺序（拖拽排序的结果）
 * - 保留自定义入口（代码里没有的），无效的丢弃
 * - 代码里新增、尚未保存过的默认入口，追加到末尾（保证新功能自动出现）
 */
export function normalizeNavItems(value: unknown): NavItemSetting[] {
  const raw = Array.isArray(value) ? (value as Partial<NavItemSetting>[]) : [];
  const out: NavItemSetting[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item) continue;
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const base = FRONTEND_NAV.find((f) => f.key === key);
    const rawHref = typeof item.href === 'string' ? item.href.trim() : '';
    const rawLabel = typeof item.label === 'string' ? item.label.trim() : '';
    const visible = item.visible === undefined ? true : Boolean(item.visible);

    if (base) {
      // 地址非法时回退默认值：既不破坏菜单，也不会让整份配置保存失败
      out.push({
        key,
        label: rawLabel || base.label,
        href: isValidNavHref(rawHref) ? rawHref : base.href,
        visible,
        // 仅管理员可见：后台未设置时沿用代码里的默认值
        adminOnly: item.adminOnly === undefined ? Boolean(base.adminOnly) : Boolean(item.adminOnly),
      });
      continue;
    }

    // 自定义入口：名称与地址必须有效
    if (!rawLabel || !isValidNavHref(rawHref)) continue;
    out.push({
      key,
      label: rawLabel,
      href: rawHref,
      visible,
      icon: typeof item.icon === 'string' && item.icon.trim() ? item.icon.trim().slice(0, 4) : '🔗',
      adminOnly: Boolean(item.adminOnly),
    });
  }

  for (const base of FRONTEND_NAV) {
    if (seen.has(base.key)) continue;
    out.push({ key: base.key, label: base.label, href: base.href, visible: true, adminOnly: Boolean(base.adminOnly) });
  }

  return out;
}

/** 最终菜单：按保存顺序输出，套用后台名称/地址/图标，并过滤掉隐藏的入口 */
export function resolveNavEntries(items: NavItemSetting[]): NavEntry[] {
  const list = Array.isArray(items) && items.length ? items : defaultNavItems;
  const out: NavEntry[] = [];
  for (const item of list) {
    if (!item || item.visible === false) continue;
    const base = FRONTEND_NAV.find((f) => f.key === item.key);
    const href = String(item.href || (base ? base.href : '')).trim();
    if (!isValidNavHref(href)) continue;
    out.push({
      key: item.key,
      label: String(item.label || (base ? base.label : item.key)).trim() || item.key,
      href,
      icon: (base ? base.icon : '') || item.icon || '🔗',
      accent: (base ? base.accent : '') || 'text-gray-200',
      adminOnly: item.adminOnly !== undefined ? Boolean(item.adminOnly) : Boolean(base && base.adminOnly),
    });
  }
  return out;
}

/** 按登录态过滤（仅管理员可见的入口对普通用户隐藏） */
export function visibleNav(entries: NavEntry[], isAdmin: boolean): NavEntry[] {
  const list = Array.isArray(entries) && entries.length ? entries : FRONTEND_NAV;
  return list.filter((item) => !item.adminOnly || isAdmin);
}

/** 当前路径命中的入口（取最长匹配，避免 /books 与 /books/rankings 同时高亮） */
export function findActiveHref(pathname: string, entries: NavEntry[] = FRONTEND_NAV): string | null {
  let best: string | null = null;
  for (const item of entries) {
    if (item.href === '/') continue;
    if (pathname === item.href || pathname.indexOf(item.href + '/') === 0) {
      if (!best || item.href.length > best.length) best = item.href;
    }
  }
  return best;
}
