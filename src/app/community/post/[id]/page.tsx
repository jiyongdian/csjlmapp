'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import CommunityTopBar from '@/components/community/CommunityTopBar';
import { getToken } from '@/lib/get-token';

interface Cmt { id: string; author: { id: string; nickname: string }; content: string; createdAt: string; }

function timeAgo(t: string): string {
  const diff = Date.now() - new Date(t).getTime();
  if (Number.isNaN(diff)) return '';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  return Math.floor(h / 24) + ' 天前';
}

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const token = getToken();
  const [post, setPost] = useState<any>(null);
  const [comments, setComments] = useState<Cmt[]>([]);
  const [cmt, setCmt] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const loadComments = useCallback(async () => {
    const r = await fetch('/api/community/posts/' + id + '/comments');
    const j = await r.json();
    if (j.success) setComments(j.data ?? []);
  }, [id]);

  useEffect(() => {
    fetch('/api/community/posts/' + id).then((r) => r.json()).then((j) => j.success && setPost(j.data)).catch(() => setError('加载失败'));
    loadComments();
  }, [id, loadComments]);

  const doLike = async () => {
    const r = await fetch('/api/community/posts/' + id + '/like', { method: 'POST', headers: { Authorization: 'Bearer ' + (token ?? '') } });
    const j = await r.json();
    if (j.success) setPost((p: any) => ({ ...p, likes: j.data.likes, liked: j.data.liked }));
  };

  const doComment = async () => {
    if (!cmt.trim() || sending) return;
    setSending(true);
    try {
      const r = await fetch('/api/community/posts/' + id + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token ?? '') },
        body: JSON.stringify({ content: cmt }),
      });
      const j = await r.json();
      if (j.success) { setComments(j.data); setCmt(''); loadComments(); }
    } catch { /* ignore */ }
    setSending(false);
  };

  if (!post) return (
    <div className="min-h-screen" style={{ background: '#0b0a1f' }}>
      <CommunityTopBar />
      <div className="max-w-3xl mx-auto px-4 py-20 text-center text-gray-400">{error || '加载中…'}</div>
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(56,189,248,0.12), transparent), #0b0a1f' }}>
      <CommunityTopBar />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-6 h-6 rounded-full bg-purple-500/30 flex items-center justify-center text-[10px] text-purple-200">{post.author.nickname.charAt(0)}</span>
            <span className="text-gray-300">{post.author.nickname}</span>
            {post.topicKey && <span className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[11px]">#{post.topicKey}</span>}
            <span className="ml-auto">{timeAgo(post.createdAt)}</span>
          </div>
          <h1 className="text-lg font-bold text-white mt-3">{post.title}</h1>
          <p className="text-sm text-gray-300 mt-3 leading-7 whitespace-pre-wrap">{post.content}</p>
          {post.images?.length > 0 && (
            <div className="flex gap-2 mt-3 flex-wrap">{post.images.map((img: string, i: number) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={img} alt="" className="max-h-64 rounded-lg object-contain" />
            ))}</div>
          )}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/10">
            <button onClick={doLike} className={'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ' + (post.liked ? 'bg-rose-500/20 border-rose-500/40 text-rose-300' : 'border-white/15 text-gray-400 hover:text-rose-300 hover:border-rose-500/40')}>
              ❤ {post.likes}
            </button>
            <button onClick={() => { if (post.author?.id) window.location.href = '/messages?user=' + post.author.id; }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-white/15 text-gray-400 hover:text-sky-300 hover:border-sky-500/40 transition-colors">
              ✉ 私信作者
            </button>
            <Link href="/community" className="ml-auto text-xs text-gray-500 hover:text-white transition-colors">← 返回社区</Link>
          </div>
        </div>

        {/* 评论 */}
        <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-sm font-semibold text-gray-200 mb-3">评论（{comments.length}）</h2>
          <div className="space-y-3 mb-4">
            {comments.length === 0 && <p className="text-xs text-gray-500">还没有评论</p>}
            {comments.map((c) => (
              <div key={c.id} className="flex gap-2.5">
                <span className="w-6 h-6 rounded-full bg-purple-500/30 flex items-center justify-center text-[10px] text-purple-200 shrink-0">{c.author.nickname.charAt(0)}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-gray-300">{c.author.nickname}</span>
                    <span className="text-gray-600">{timeAgo(c.createdAt)}</span>
                  </div>
                  <p className="text-sm text-gray-300 mt-0.5 leading-6">{c.content}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={cmt} onChange={(e) => setCmt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doComment(); }}
              placeholder="写下你的评论…"
              className="flex-1 bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500/60"
            />
            <button onClick={doComment} disabled={sending || !cmt.trim()} className="px-4 py-2 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-lg disabled:opacity-40 transition-colors shrink-0">评论</button>
          </div>
        </div>
      </main>
    </div>
  );
}
