'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import CommunityTopBar from '@/components/community/CommunityTopBar';
import PostCard, { PostCardData } from '@/components/community/PostCard';

export default function TopicPage() {
  const { key } = useParams<{ key: string }>();
  const [posts, setPosts] = useState<PostCardData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!key) return;
    setLoading(true);
    fetch('/api/community/posts?topic=' + encodeURIComponent(key))
      .then((r) => r.json())
      .then((j) => { if (j.success) setPosts(j.data.items ?? []); })
      .finally(() => setLoading(false));
  }, [key]);

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(56,189,248,0.12), transparent), #0b0a1f' }}>
      <CommunityTopBar />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="text-lg font-bold text-white mb-5">话题 #<span className="text-sky-300">{key}</span></h1>
        {loading ? <div className="h-32 rounded-xl bg-white/[0.03] animate-pulse" /> :
          posts.length === 0 ? <div className="text-center text-gray-500 text-sm py-16">该话题下暂无帖子</div> :
          <div className="space-y-3">{posts.map((p) => <PostCard key={p.id} post={p} />)}</div>}
      </main>
    </div>
  );
}
