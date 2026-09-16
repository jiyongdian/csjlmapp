'use client';

import { formatChapterTitle } from '@/lib/chapter-title';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import BookTopBar from '@/components/books/BookTopBar';
import { GENDER_LABEL } from '@/components/books/BookCard';
import { describePerspective, describeGenre } from '@/lib/novel-config-maps';
import MessageDialog, { type MessageTarget } from '@/components/messages/MessageDialog';
import { getUserIdFromToken } from '@/lib/get-token';

interface ChapterMeta { index: number; title: string; chars: number; }
interface DetailData {
  brief: { id: string; title: string; description: string; category: string; genderTarget: string; coverImage: string | null; currentChapters: number; ownerName?: string; ownerId?: string };
  narrativePerspective: string;
  protagonist: string;
  chapters: ChapterMeta[];
}

export default function BookDetailPage() {
  const { novelId } = useParams<{ novelId: string }>();
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState<string | null>(null);
  const [msgTarget, setMsgTarget] = useState<MessageTarget | null>(null);

  useEffect(() => { setMyId(getUserIdFromToken()); }, []);

  useEffect(() => {
    if (!novelId) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/books/' + novelId);
        const j = await r.json();
        if (alive) { if (j.success) setDetail(j.data); else setError(j.error ?? '加载失败'); }
      } catch { if (alive) setError('网络错误'); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [novelId]);

  if (loading) {
    return (
      <div style={{ background: '#0b0a1f', minHeight: '100vh' }}>
        <BookTopBar />
        <div className="max-w-5xl mx-auto px-4 py-8 space-y-4 animate-pulse">
          <div className="h-80 rounded-2xl bg-white/[0.03]" /><div className="h-40 rounded-2xl bg-white/[0.03]" />
        </div>
      </div>
    );
  }
  if (error || !detail) {
    return (
      <div style={{ background: '#0b0a1f', minHeight: '100vh' }}>
        <BookTopBar />
        <div className="max-w-3xl mx-auto px-6 py-24 text-center text-gray-400">{error || '作品不存在或尚未发布'}</div>
      </div>
    );
  }
  const b = detail.brief;
  const totalChars = detail.chapters.reduce((s, c) => s + c.chars, 0);
  const first = detail.chapters[0];
  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(1000px 500px at 10% -10%, rgba(139,92,246,0.18), transparent), #0b0a1f' }}>
      <BookTopBar />
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex flex-col md:flex-row gap-6">
          <div className="w-44 aspect-[3/4] shrink-0 mx-auto md:mx-0 rounded-xl overflow-hidden flex items-center justify-center relative" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.4), rgba(79,70,229,0.3))' }}>
            {b.coverImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.coverImage} alt={b.title} className="w-full h-full object-cover" />
            ) : (
              <span className="text-5xl font-bold text-white/70">{b.title.charAt(0)}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-white">{b.title}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-2.5">
              {b.category && <span className="px-2 py-0.5 text-[11px] rounded bg-purple-500/15 border border-purple-500/30 text-purple-300">{describeGenre(b.category)}</span>}
              {b.genderTarget && GENDER_LABEL[b.genderTarget] && <span className="px-2 py-0.5 text-[11px] rounded bg-white/5 border border-white/15 text-gray-300">{GENDER_LABEL[b.genderTarget]}</span>}
              <span className="text-[11px] text-gray-500">{detail.chapters.length} 章 · 约 {totalChars > 10000 ? (totalChars / 10000).toFixed(1) + ' 万字' : totalChars + ' 字'}</span>
            </div>
            {b.ownerName && (
              <p className="text-xs text-gray-400 mt-2 flex items-center gap-2">
                <span>作者：{b.ownerName}</span>
                {b.ownerId && b.ownerId !== myId && (
                  <button
                    onClick={() => setMsgTarget({ id: b.ownerId as string, nickname: b.ownerName as string })}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border border-sky-500/30 text-sky-300 hover:bg-sky-500/15 transition-colors"
                  >💬 私信</button>
                )}
              </p>
            )}
            {detail.protagonist && <p className="text-xs text-gray-400 mt-2">主角：{detail.protagonist}</p>}
            {detail.narrativePerspective && <p className="text-xs text-gray-500 mt-1">视角：{describePerspective(detail.narrativePerspective).name}</p>}
            {first && (
              <div className="flex gap-3 mt-5">
                <Link href={'/books/' + b.id + '/read?chapter=' + first.index} className="px-5 py-2.5 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors">▶ 开始阅读</Link>
                <Link href={'/books/' + b.id + '/read?chapter=' + first.index + '&tts=1'} className="px-5 py-2.5 text-sm border border-purple-500/40 text-purple-300 hover:bg-purple-500/15 rounded-lg transition-colors">🔊 听书</Link>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] mt-5 p-6">
          <h2 className="text-sm font-semibold text-purple-300 mb-3">简介</h2>
          <p className="text-sm text-gray-300 leading-7 whitespace-pre-wrap">{b.description || '作者还没有留下简介。'}</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] mt-5 p-6">
          <h2 className="text-sm font-semibold text-purple-300 mb-4">目录（{detail.chapters.length} 章）</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {detail.chapters.map((c) => (
              <Link key={c.index} href={'/books/' + b.id + '/read?chapter=' + c.index}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-xs text-gray-400 hover:bg-white/5 hover:text-purple-200 transition-colors group">
                <span className="truncate">{formatChapterTitle(c.index, c.title)}</span>
                <span className="text-[10px] text-gray-600 group-hover:text-purple-400/70 shrink-0">{c.chars > 0 ? Math.round(c.chars / 1000 * 10) / 10 + 'k' : ''}</span>
              </Link>
            ))}
          </div>
        </div>
        <MessageDialog open={!!msgTarget} target={msgTarget} onClose={() => setMsgTarget(null)} />
      </main>
    </div>
  );
}
