'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import ReaderBody from '@/components/books/ReaderBody';

export default function ReadPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">加载中...</p></div>}>
      <ReadPageContent />
    </Suspense>
  );
}

function ReadPageContent() {
  const { novelId } = useParams<{ novelId: string }>();
  const sp = useSearchParams();
  const [meta, setMeta] = useState<{ title: string; chapters: { index: number; title: string }[]; initial: number } | null>(null);

  useEffect(() => {
    if (!novelId) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/books/' + novelId);
        const j = await r.json();
        if (alive && j.success) {
          const chapters = (j.data.chapters ?? []).map((c: any) => ({ index: c.index, title: c.title }));
          const want = parseInt(sp.get('chapter') ?? '', 10);
          const initial = Number.isInteger(want) && want >= 1 ? want : (chapters[0]?.index ?? 1);
          setMeta({ title: j.data.brief?.title ?? '', chapters, initial });
        }
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId]);

  return (
    <div className="h-screen flex flex-col bg-[#0b0a1f]">
      <header className="shrink-0 border-b border-white/10 flex items-center justify-between px-4 py-2.5" style={{ background: 'rgba(15,12,41,0.92)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">📖</span>
          <span className="text-sm font-semibold text-white truncate">{meta?.title || '阅读'}</span>
        </div>
        <a href={'/books/' + novelId} className="text-xs text-purple-300 hover:text-purple-200 transition-colors shrink-0">作品详情 →</a>
      </header>
      <div className="flex-1 min-h-0">
        {meta && <ReaderBody novelId={novelId as string} novelTitle={meta.title} chapters={meta.chapters} initialChapter={meta.initial} />}
      </div>
    </div>
  );
}
