'use client';

import { useCallback, useEffect, useState } from 'react';
import PostCard, { PostCardData } from '@/components/community/PostCard';
import { getToken } from '@/lib/get-token';

/**
 * 社区广场内容面板。
 * 页面 /community 与「导航 → 社区广场」弹窗共用同一个组件，保证两处行为一致。
 */
export default function CommunityPanel() {
  const [posts, setPosts] = useState<PostCardData[]>([]);
  const [topics, setTopics] = useState<{ key: string; count: number }[]>([]);
  const [topic, setTopic] = useState('');
  const [sort, setSort] = useState<'new' | 'hot'>('new');
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [topicKey, setTopicKey] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback((t: string, s: 'new' | 'hot') => {
    setLoading(true);
    const sp = new URLSearchParams({ sort: s });
    if (t) sp.set('topic', t);
    fetch('/api/community/posts?' + sp.toString())
      .then((r) => r.json())
      .then((j) => { if (j.success) { setPosts(j.data.items ?? []); if (topics.length === 0 && j.topics?.length) setTopics(j.topics); } })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(topic, sort); }, [load, topic, sort]);

  const submit = async () => {
    if (!title.trim() || !content.trim() || posting) return;
    setPosting(true);
    try {
      const r = await fetch('/api/community/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (getToken() ?? '') },
        body: JSON.stringify({ title, content, topicKey: topicKey.trim() || undefined }),
      });
      const j = await r.json();
      if (j.success) { setTitle(''); setContent(''); setTopicKey(''); setShowNew(false); load(topic, sort); }
    } catch { /* ignore */ }
    setPosting(false);
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* 发帖入口 */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-5">
        <div className="flex items-center gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题（必填，60字内）"
            className="flex-1 bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500/60"
            onFocus={() => setShowNew(true)}
          />
          <button onClick={() => setShowNew((v) => !v)} className="px-4 py-2 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors shrink-0">发布</button>
        </div>
        {showNew && (
          <div className="mt-3 space-y-2.5">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="写点什么…"
              rows={4}
              className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500/60 resize-none"
            />
            <div className="flex items-center gap-2">
              <input
                value={topicKey}
                onChange={(e) => setTopicKey(e.target.value)}
                placeholder="话题标签（可选，如：创作交流）"
                className="flex-1 bg-white/5 border border-white/15 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500/60"
              />
              <button onClick={submit} disabled={posting || !title.trim() || !content.trim()}
                className="px-4 py-1.5 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-lg disabled:opacity-40 transition-colors shrink-0">
                {posting ? '发布中…' : '确认发布'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 话题 + 排序 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={() => setTopic('')}
          className={'px-3 py-1.5 text-xs rounded-full border transition-colors ' + (!topic ? 'bg-sky-500/25 border-sky-500/50 text-sky-200' : 'border-white/10 text-gray-400 hover:text-white')}>
          全部
        </button>
        {topics.map((t) => (
          <button key={t.key} onClick={() => setTopic(t.key)}
            className={'px-3 py-1.5 text-xs rounded-full border transition-colors ' + (topic === t.key ? 'bg-sky-500/25 border-sky-500/50 text-sky-200' : 'border-white/10 text-gray-400 hover:text-white')}>
            #{t.key} {t.count}
          </button>
        ))}
        <div className="ml-auto flex gap-1.5">
          {([['new', '最新'], ['hot', '热门']] as ['new' | 'hot', string][]).map(([s, label]) => (
            <button key={s} onClick={() => setSort(s)}
              className={'px-3 py-1.5 text-xs rounded-lg transition-colors ' + (sort === s ? 'bg-white/10 text-white border border-white/20' : 'text-gray-400 hover:text-white border border-transparent')}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-32 rounded-xl bg-white/[0.03] animate-pulse" />)}</div>
      ) : posts.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-20">还没有帖子，来发第一帖吧</div>
      ) : (
        <div className="space-y-3">{posts.map((p) => <PostCard key={p.id} post={p} />)}</div>
      )}
    </div>
  );
}
