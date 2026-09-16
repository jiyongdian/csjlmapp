'use client';

import Link from 'next/link';
import { describeGenre } from '@/lib/novel-config-maps';

export interface BookCardBrief {
  id: string;
  title: string;
  description: string;
  category: string;
  genderTarget: string;
  currentChapters: number;
  totalChapters: number;
  coverImage: string | null;
  updatedAt: string;
}

function timeAgo(t: string): string {
  if (!t) return '';
  const d = new Date(t).getTime();
  if (Number.isNaN(d)) return '';
  const diff = Date.now() - d;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚更新';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  const day = Math.floor(h / 24);
  if (day < 30) return day + ' 天前';
  const mon = Math.floor(day / 30);
  return mon + ' 个月前';
}

export const GENDER_LABEL: Record<string, string> = { male: '男频', female: '女频' };

export default function BookCard({ book }: { book: BookCardBrief }) {
  const coverColor = 'linear-gradient(135deg, rgba(139,92,246,0.35), rgba(79,70,229,0.25))';
  return (
    <Link href={'/books/' + book.id} className="group flex gap-3.5 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-purple-500/40 transition-all duration-200 p-3">
      {/* 封面 */}
      <div className="w-20 aspect-[3/4] shrink-0 rounded-lg overflow-hidden relative flex items-center justify-center" style={{ background: coverColor }}>
        {book.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={book.coverImage} alt={book.title} className="w-full h-full object-cover" />
        ) : (
          <span className="text-2xl font-bold text-purple-100/80">{book.title.charAt(0)}</span>
        )}
        {book.genderTarget && (
          <span className="absolute top-1 right-1 text-[9px] px-1 py-0.5 rounded bg-black/50 text-purple-200">{GENDER_LABEL[book.genderTarget] ?? ''}</span>
        )}
      </div>
      {/* 信息 */}
      <div className="min-w-0 flex-1 flex flex-col">
        <h3 className="text-sm font-semibold text-white truncate group-hover:text-purple-300 transition-colors">{book.title}</h3>
        {book.category && <span className="text-[10px] text-purple-300/80 mt-0.5">{describeGenre(book.category)}</span>}
        <p className="text-[11px] text-gray-400 line-clamp-2 mt-1.5 leading-relaxed">{book.description || '暂无简介'}</p>
        <div className="mt-auto flex items-center justify-between text-[10px] text-gray-500 pt-1.5">
          <span>{book.currentChapters} 章</span>
          <span>{timeAgo(book.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}
