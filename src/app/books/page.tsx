'use client';

import { useEffect, useState } from 'react';
import BookTopBar from '@/components/books/BookTopBar';
import BookCard, { BookCardBrief } from '@/components/books/BookCard';
import { describeGenre } from '@/lib/novel-config-maps';

type Sort = 'updated' | 'new' | 'hot';

export default function BooksPage() {
  const [items, setItems] = useState<BookCardBrief[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<Sort>('updated');
  const [q, setQ] = useState('');
  const [kw, setKw] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const pageSize = 24;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const sp = new URLSearchParams();
      if (category) sp.set('category', category);
      if (kw) sp.set('q', kw);
      sp.set('sort', sort);
      sp.set('page', String(page));
      sp.set('pageSize', String(pageSize));
      try {
        const r = await fetch('/api/books?' + sp.toString());
        const j = await r.json();
        if (alive && j.success) {
          setItems(j.data.items ?? []);
          setTotal(j.data.total ?? 0);
          if (j.categories?.length) setCategories(j.categories);
        }
      } catch { /* ignore */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [category, kw, sort, page]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(139,92,246,0.15), transparent), radial-gradient(900px 500px at 100% 0%, rgba(79,70,229,0.12), transparent), #0b0a1f' }}>
      <BookTopBar />
      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Hero */}
        <div className="rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-900/30 to-indigo-900/20 p-8 mb-6 relative overflow-hidden">
          <div className="absolute top-0 right-10 text-[120px] leading-none opacity-10 select-none">📚</div>
          <h1 className="text-2xl font-bold text-white">书籍书城</h1>
          <p className="text-sm text-gray-400 mt-1.5">发现、阅读、听书 —— 作者们在这里发布他们创作的每一部作品</p>
          {/* 搜索 */}
          <form onSubmit={(e) => { e.preventDefault(); setKw(q); setPage(1); }}
            className="mt-5 flex max-w-xl gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索书名 / 简介…"
              className="flex-1 bg-white/5 border border-white/15 rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/60"
            />
            <button type="submit" className="px-5 py-2.5 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors">搜索</button>
          </form>
        </div>

        {/* 分类 */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => { setCategory(''); setPage(1); }}
            className={'px-3 py-1.5 text-xs rounded-full border transition-colors ' + (!category ? 'bg-purple-500/25 border-purple-500/50 text-purple-200' : 'border-white/10 text-gray-400 hover:text-white')}>
            全部
          </button>
          {categories.map((c) => (
            <button key={c} onClick={() => { setCategory(c); setPage(1); }}
              className={'px-3 py-1.5 text-xs rounded-full border transition-colors ' + (category === c ? 'bg-purple-500/25 border-purple-500/50 text-purple-200' : 'border-white/10 text-gray-400 hover:text-white')}>
              {describeGenre(c)}
            </button>
          ))}
        </div>

        {/* 排序 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-1.5">
            {([['updated', '最近更新'], ['new', '最新发布'], ['hot', '人气热读']] as [Sort, string][]).map(([s, label]) => (
              <button key={s} onClick={() => { setSort(s); setPage(1); }}
                className={'px-3 py-1.5 text-xs rounded-lg transition-colors ' + (sort === s ? 'bg-white/10 text-white border border-white/20' : 'text-gray-400 hover:text-white border border-transparent')}>
                {label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-gray-500">共 {total} 部作品</span>
        </div>

        {/* 列表 */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-28 rounded-xl bg-white/[0.03] animate-pulse" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 text-gray-500 text-sm">暂无作品，换个筛选条件试试</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((b) => <BookCard key={b.id} book={b} />)}
          </div>
        )}

        {/* 分页 */}
        {pages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 text-xs border border-white/15 rounded-lg text-gray-300 hover:text-white disabled:opacity-30 transition-colors">上一页</button>
            <span className="text-xs text-gray-400">{page} / {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 text-xs border border-white/15 rounded-lg text-gray-300 hover:text-white disabled:opacity-30 transition-colors">下一页</button>
          </div>
        )}
      </main>
    </div>
  );
}
