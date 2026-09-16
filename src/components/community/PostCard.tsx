'use client';

import Link from 'next/link';

export interface PostCardData {
  id: string; title: string; content: string; images: string[];
  topicKey: string; createdAt: string;
  author: { id: string; nickname: string; username: string };
  likes: number; comments: number; liked: boolean;
}

function timeAgo(t: string): string {
  if (!t) return '';
  const diff = Date.now() - new Date(t).getTime();
  if (Number.isNaN(diff)) return '';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d < 30) return d + ' 天前';
  return Math.floor(d / 30) + ' 个月前';
}

export default function PostCard({ post }: { post: PostCardData }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors p-4">
      <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-2">
        <span className="w-5 h-5 rounded-full bg-purple-500/30 flex items-center justify-center text-[9px] text-purple-200">{post.author.nickname.charAt(0)}</span>
        <span className="text-gray-300">{post.author.nickname}</span>
        {post.topicKey && <span className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300">#{post.topicKey}</span>}
        <span className="ml-auto">{timeAgo(post.createdAt)}</span>
      </div>
      <Link href={'/community/post/' + post.id} className="block">
        <h3 className="text-sm font-semibold text-white hover:text-sky-300 transition-colors">{post.title}</h3>
        <p className="text-xs text-gray-400 mt-1.5 leading-relaxed line-clamp-3 whitespace-pre-wrap">{post.content}</p>
        {post.images.length > 0 && (
          <div className="flex gap-1.5 mt-2 overflow-x-auto">
            {post.images.slice(0, 4).map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={img} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" />
            ))}
          </div>
        )}
        <div className="flex items-center gap-4 mt-3 text-[11px] text-gray-500">
          <span className={'flex items-center gap-1 ' + (post.liked ? 'text-rose-400' : '')}>❤ {post.likes}</span>
          <span className="flex items-center gap-1">💬 {post.comments}</span>
        </div>
      </Link>
    </div>
  );
}
