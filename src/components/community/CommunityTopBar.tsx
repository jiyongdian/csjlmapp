'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SideDockNav from '@/components/SideDockNav';
import { useUnreadMessages } from '@/lib/use-unread-messages';

/**
 * 社区页面顶栏。
 * 站点导航入口统一由左侧浮标抽屉（SideDockNav，读 /api/nav-config）提供；
 * 这里保留页面标题，并在右侧放置「社区 ↔ 私信」的互跳入口：
 * 在社区页显示「私信」，在私信页显示「社区广场」，避免和标题重复。
 */
export default function CommunityTopBar({ title = '社区广场', icon = '💬' }: { title?: string; icon?: string }) {
  const pathname = usePathname();
  const onMessages = pathname === '/messages' || pathname.indexOf('/messages/') === 0;
  const unread = useUnreadMessages();

  return (
    <>
      <SideDockNav title="导航" />
      <header className="sticky top-0 z-30 border-b border-white/5 backdrop-blur-xl" style={{ background: 'rgba(15,12,41,0.92)' }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-2.5">
          <span className="text-lg">{icon}</span>
          <span className="text-sm font-bold text-white">{title}</span>
          <Link
            href={onMessages ? '/community' : '/messages'}
            data-community-nav={onMessages ? 'community' : 'messages'}
            className={
              'ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ' +
              (onMessages
                ? 'border-indigo-500/30 text-indigo-200 hover:bg-indigo-500/15'
                : 'border-sky-500/30 text-sky-200 hover:bg-sky-500/15')
            }
          >
            {onMessages ? '💬 社区广场' : '✉️ 私信'}
            {!onMessages && unread > 0 && (
              <span className="min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>
        </div>
      </header>
    </>
  );
}
