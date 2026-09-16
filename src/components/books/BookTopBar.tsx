'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SideDockNav from '@/components/SideDockNav';

/**
 * 书城页面顶栏。
 * 站点导航入口统一由左侧浮标抽屉（SideDockNav，读 /api/nav-config）提供；
 * 这里保留页面标题，并在右侧放置书城内的高频入口（书城榜单）。
 */
export default function BookTopBar({ title = '书籍书城', icon = '📚' }: { title?: string; icon?: string }) {
  const pathname = usePathname();
  const onRankings = pathname === '/books/rankings' || pathname.indexOf('/books/rankings/') === 0;

  return (
    <>
      <SideDockNav title="导航" />
      <header className="sticky top-0 z-30 border-b border-white/5 backdrop-blur-xl" style={{ background: 'rgba(15,12,41,0.92)' }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-2.5">
          <span className="text-lg">{icon}</span>
          <span className="text-sm font-bold text-white">{title}</span>
          <Link
            href="/books/rankings"
            data-book-nav="rankings"
            className={
              'ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ' +
              (onRankings
                ? 'bg-amber-500/25 border-amber-500/40 text-amber-200'
                : 'border-white/10 text-gray-300 hover:bg-white/5 hover:text-white')
            }
          >
            🏆 书城榜单
          </Link>
        </div>
      </header>
    </>
  );
}
