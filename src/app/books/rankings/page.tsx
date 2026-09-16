'use client';

import { useEffect, useState } from 'react';
import BookTopBar from '@/components/books/BookTopBar';
import Link from 'next/link';
import type { BookBrief } from '@/lib/books/book-store';
import { describeGenre } from '@/lib/novel-config-maps';

type Tab = 'hot' | 'fresh' | 'finished';
const LABELS: Record<Tab, string> = { hot: '🔥 人气热读', fresh: '🆕 最新新书', finished: '🏁 完结佳作' };

export default function RankingsPage() {
  const [tab, setTab] = useState<Tab>('hot');
  const [hot, setHot] = useState<BookBrief[]>([]);
  const [fresh, setFresh] = useState<BookBrief[]>([]);
  const [finished, setFinished] = useState<BookBrief[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r1, r2, r3] = await Promise.all([
          fetch('/api/books?sort=hot&pageSize=20').then((r) => r.json()),
          fetch('/api/books?sort=new&pageSize=20').then((r) => r.json()),
          fetch('/api/books?pageSize=100').then((r) => r.json()),
        ]);
        if (!alive) return;
        if (r1.success) { setHot(r1.data.items ?? []); if (r1.categories) setCategories(r1.categories); }
        if (r2.success) setFresh(r2.data.items ?? []);
        if (r3.success) setFinished((r3.data.items ?? []).filter((b: BookBrief) => b.totalChapters > 0 && b.currentChapters >= b.totalChapters));
      } catch { /* ignore */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const data: Record<Tab, BookBrief[]> = { hot, fresh, finished };
  const list = data[tab];
  const rankColor = (i: number) => i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-orange-400' : 'text-gray-500';

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(139,92,246,0.15), transparent), #0b0a1f' }}>
      <BookTopBar />
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* 分类 */}
        <div className="flex flex-wrap gap-2 mb-4">
          {categories.map((c) => (
            <Link key={c} href={'/books?category=' + encodeURIComponent(c)}
              className="px-3 py-1.5 text-[11px] rounded-full border border-white/10 text-gray-400 hover:text-purple-300 hover:border-purple-500/40 transition-colors">{describeGenre(c)}</Link>
          ))}
        </div>
        {/* Tabs */}
        <div className="flex gap-1.5 mb-5">
          {(['hot', 'fresh', 'finished'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={'px-3.5 py-1.5 text-xs rounded-lg border transition-colors ' + (tab === t ? 'bg-purple-500/25 border-purple-500/50 text-purple-200' : 'border-white/10 text-gray-400 hover:text-white')}>
              {LABELS[t]}（{data[t].length}）
            </button>
          ))}
        </div>
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-white/[0.03] animate-pulse" />)}</div>
        ) : list.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-16">暂无内容</div>
        ) : (
          <div className="space-y-2">
            {list.map((b, i) => (
              <Link key={b.id} href={'/books/' + b.id}
                className="flex items-center gap-3.5 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-purple-500/40 transition-all px-4 py-3">
                <span className={'w-7 text-center text-lg font-bold shrink-0 ' + rankColor(i)}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{b.title}</p>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                    {b.category && <span className="text-purple-300/80">{describeGenre(b.category)}</span>}
                    {b.genderTarget === 'male' && <span>男频</span>}
                    {b.genderTarget === 'female' && <span>女频</span>}
                    <span>· {b.currentChapters} 章</span>
                    {tab === 'finished' && b.totalChapters > 0 && <span className="text-amber-400/80">已完结</span>}
                  </div>
                </div>
                <span className="text-[11px] text-gray-500 shrink-0">{b.currentChapters}/{b.totalChapters || '?'}</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
