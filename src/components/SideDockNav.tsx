'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { visibleNav } from '@/lib/nav-config';
import { invalidateFrontendNav, isAdminFromToken, useFrontendNav } from '@/lib/nav-client';
import { getToken } from '@/lib/get-token';
import { useUnreadMessages } from '@/lib/use-unread-messages';
import AISettingsPanel from '@/components/AISettingsPanel';
import CommunityPanel from '@/components/community/CommunityPanel';

/**
 * 左侧浮标导航抽屉
 * 收起时是贴在左边中间的浮标按钮；点开后从左侧滑出竖排面板；点关闭/遮罩收回浮标。
 * 菜单项统一来自 /api/nav-config（后台「导航菜单」可改名称/地址/显示），保证全站一致。
 * 通过 Portal 挂到 document.body，避免被父级 backdrop-blur / transform 的包含块影响定位与层级。
 */
/** 导航弹窗外壳：点击遮罩或 ✕ 关闭，内容区可滚动 */
function NavDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[9600] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-4xl h-[86vh] rounded-2xl border border-white/10 overflow-hidden flex flex-col shadow-2xl" style={{ background: 'rgba(15,12,41,0.98)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
          <span className="text-sm font-bold text-white">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={'关闭' + title}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-white/15 text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
          >✕</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
export default function SideDockNav({ children, title = '导航', headerExtra }: { children?: ReactNode; title?: string; headerExtra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const nav = useFrontendNav();
  const [level, setLevel] = useState<string | null>(null);
  const unreadMessages = useUnreadMessages();
  const [dialogNav, setDialogNav] = useState<'ai-settings' | 'community' | null>(null);

  useEffect(() => {
    setMounted(true);
    setIsAdmin(isAdminFromToken());
    // 登录态可能变化，清掉菜单缓存避免拿到上一个角色的列表
    invalidateFrontendNav();
    // 读取当前会员等级（红框处展示）
    const token = getToken();
    if (token) {
      fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => { if (j && j.success && j.data && j.data.memberLevel) setLevel(j.data.memberLevel); })
        .catch(() => {});
    }
  }, []);

  if (!mounted) return null;

  const items = visibleNav(nav, isAdmin);
  const displayLevel = level ? level.replace('创世纪', '') : '';
  const isFreeLevel = !!level && level.indexOf('免费') >= 0;

  return createPortal(
    <>
      {/* 遮罩 */}
      <div
        className={'fixed inset-0 z-[7000] bg-black/50 transition-opacity ' + (open ? 'opacity-100' : 'opacity-0 pointer-events-none')}
        onClick={() => setOpen(false)}
      />

      {/* 浮标（收起态） */}
      <button
        onClick={() => setOpen(true)}
        aria-label="打开导航"
        title="打开导航"
        className={
          'group fixed left-0 top-3 z-[8000] flex flex-col items-center gap-1.5 pl-2 pr-2.5 py-3 rounded-r-2xl ' +
          'border border-l-0 border-white/15 bg-purple-500/25 text-purple-50 backdrop-blur-md ' +
          'shadow-[0_8px_24px_-6px_rgba(88,28,135,0.55)] ring-1 ring-inset ring-white/10 ' +
          'hover:bg-purple-500/45 hover:border-purple-200/40 hover:text-white hover:pr-3 ' +
          'hover:shadow-[0_10px_28px_-6px_rgba(139,92,246,0.65)] active:scale-95 ' +
          'transition-all duration-200 ease-out ' +
          (open ? 'opacity-0 pointer-events-none -translate-x-3' : 'opacity-100')
        }
      >
        <span className="pointer-events-none absolute inset-y-2.5 left-0 w-px bg-gradient-to-b from-transparent via-purple-100/70 to-transparent" />
        <svg className="w-4 h-4 drop-shadow-[0_0_6px_rgba(196,181,253,0.55)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <span className="text-[10px] font-medium tracking-[0.2em] opacity-80 group-hover:opacity-100" style={{ writingMode: 'vertical-rl' }}>菜单</span>
      </button>

      {/* 抽屉面板（展开态） */}
      <aside
        className={'fixed left-0 top-0 z-[8000] h-full w-64 transition-transform duration-300 ease-out ' + (open ? 'translate-x-0' : '-translate-x-full')}
        style={{ background: 'rgba(15,12,41,0.97)' }}
        aria-hidden={!open}
      >
        <div className="h-full flex flex-col border-r border-white/10 backdrop-blur-xl">
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/10">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-white text-[15px] font-bold tracking-wide shrink-0">🧭 {title}</span>
              {level ? (
                <span
                  className={
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold min-w-0 ' +
                    (isFreeLevel
                      ? 'border-white/15 bg-white/10 text-gray-300'
                      : 'border-amber-400/40 bg-amber-500/15 text-amber-200')
                  }
                  title={level}
                >
                  <span className="shrink-0">{isFreeLevel ? '👤' : '👑'}</span>
                  <span className="truncate max-w-[96px]">{displayLevel}</span>
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {headerExtra}
              <button
                onClick={() => setOpen(false)}
                aria-label="收起导航"
                className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg border border-white/15 text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
              >✕</button>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
            {items.map((item) => {
              const dialogKind = item.key === 'ai-settings' || item.href === '/ai-settings'
                ? 'ai-settings'
                : item.key === 'community' || item.href === '/community'
                  ? 'community'
                  : null;
              const navClass =
                'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[14px] font-semibold ' +
                'transition-all duration-200 hover:translate-x-1 hover:bg-white/10 ' + item.accent;
              const inner = (
                <>
                  <span className="w-6 shrink-0 text-center text-base leading-none">{item.icon}</span>
                  <span className="min-w-0 truncate">{item.label}</span>
                  {item.href === '/messages' && unreadMessages > 0 && (
                    <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                      {unreadMessages > 99 ? '99+' : unreadMessages}
                    </span>
                  )}
                </>
              );
              return dialogKind ? (
                <button
                  key={item.key}
                  type="button"
                  data-nav-key={dialogKind}
                  onClick={() => { setOpen(false); setDialogNav(dialogKind); }}
                  className={navClass + ' text-left'}
                >
                  {inner}
                </button>
              ) : (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={navClass}
                >
                  {inner}
                </Link>
              );
            })}

            {children ? (
              <>
                <div className="my-2 h-px bg-white/10" />
                {children}
              </>
            ) : null}
          </nav>
        </div>
      </aside>

      {dialogNav && createPortal(
        <NavDialog
          title={dialogNav === 'ai-settings' ? '🎛 AI 设置' : '💬 社区广场'}
          onClose={() => setDialogNav(null)}
        >
          {dialogNav === 'ai-settings' ? <AISettingsPanel /> : <CommunityPanel />}
        </NavDialog>,
        document.body
      )}
    </>,
    document.body
  );
}
