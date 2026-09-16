'use client';

import { formatChapterTitle } from '@/lib/chapter-title';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import TTSBar, { TTSPlayItem } from './TTSBar';

export interface ChapterMeta { index: number; title: string; }

export default function ReaderBody({ novelId, novelTitle, chapters, initialChapter }: {
  novelId: string;
  novelTitle: string;
  chapters: ChapterMeta[];
  initialChapter: number;
}) {
  const [cur, setCur] = useState<number>(initialChapter);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [fontSize, setFontSize] = useState(18);
  const [showToc, setShowToc] = useState(false);
  const [ttsItem, setTtsItem] = useState<TTSPlayItem | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const loadChapter = useCallback(async (index: number) => {
    setLoading(true);
    try {
      const r = await fetch('/api/books/' + novelId + '/chapter/' + index);
      const j = await r.json();
      if (j.success) { setContent(j.data.content ?? ''); setTtsItem({ id: String(index), title: formatChapterTitle(Number(index), j.data.title), content: j.data.content ?? '' }); }
      else setContent('（章节加载失败）');
    } catch { setContent('（网络错误）'); }
    setLoading(false);
    setShowToc(false);
  }, [novelId]);

  useEffect(() => { loadChapter(initialChapter); }, [initialChapter, loadChapter]);

  useEffect(() => { if (mainRef.current) mainRef.current.scrollTop = 0; }, [cur]);

  const curIdx = chapters.findIndex((c) => c.index === cur);
  const prev = curIdx > 0 ? chapters[curIdx - 1] : null;
  const next = curIdx >= 0 && curIdx < chapters.length - 1 ? chapters[curIdx + 1] : null;

  const handleSet = (index: number) => { setCur(index); loadChapter(index); };

  // 听书自动切章
  const handleTtsNext = useCallback(() => {
    if (next) handleSet(next.index);
  }, [next]);

  const curTitle = formatChapterTitle(cur, chapters.find((c) => c.index === cur)?.title);

  return (
    <div className="flex h-[calc(100vh-52px)]">
      {/* 目录抽屉 */}
      {showToc && (
        <div className="w-64 border-r border-white/10 overflow-y-auto bg-[#0f0c29]/90 shrink-0 animate-[tocIn_0.2s_ease-out]">
          <div className="p-3 text-xs font-semibold text-purple-200 border-b border-white/10">目录（{chapters.length} 章）</div>
          <div className="p-1.5">
            {chapters.map((c) => (
              <button key={c.index} onClick={() => handleSet(c.index)}
                className={'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ' + (c.index === cur ? 'bg-purple-500/25 text-purple-200' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200')}>
                {formatChapterTitle(c.index, c.title)}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* 正文区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 工具条 */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowToc((v) => !v)}
              className="px-2.5 py-1.5 text-xs border border-white/15 rounded-lg text-gray-300 hover:text-white hover:bg-white/5 transition-colors">☰ 目录</button>
            <Link href={'/books/' + novelId} className="text-xs text-purple-300 hover:text-purple-200 transition-colors">← 返回详情</Link>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-500">字号</span>
            <input type="range" min={14} max={24} value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} className="w-20 accent-purple-500" />
            <span className="text-[10px] text-gray-400 w-8">{fontSize}px</span>
          </div>
        </div>
        {/* 正文 */}
        <div ref={mainRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-10">
            <h1 className="text-center text-xl font-bold text-white mb-2">{curTitle}</h1>
            <p className="text-center text-[11px] text-gray-500 mb-8">《{novelTitle}》</p>
            {loading ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 bg-white/5 rounded w-3/4" /><div className="h-4 bg-white/5 rounded w-full" />
                <div className="h-4 bg-white/5 rounded w-5/6" /><div className="h-4 bg-white/5 rounded w-full" />
                <div className="h-4 bg-white/5 rounded w-2/3" />
              </div>
            ) : (
              <div className="text-gray-300 leading-8 whitespace-pre-wrap" style={{ fontSize: fontSize + 'px', textIndent: '2em' }}>
                {content}
              </div>
            )}
            {/* 章节切换 */}
            <div className="flex items-center justify-between mt-10 pt-6 border-t border-white/10">
              {prev ? (
                <button onClick={() => handleSet(prev.index)} className="px-4 py-2 text-sm border border-white/15 rounded-lg text-gray-300 hover:text-white hover:bg-white/5 transition-colors">← {prev.title || '上一章'}</button>
              ) : <span />}
              {next ? (
                <button onClick={() => handleSet(next.index)} className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors">下一章 →</button>
              ) : <span className="text-xs text-gray-500">全书完</span>}
            </div>
          </div>
        </div>
        {/* 听书条 */}
        <TTSBar item={ttsItem} onNext={handleTtsNext} />
      </div>
      <style jsx global>{'@keyframes tocIn{from{transform:translateX(-16px);opacity:0}to{transform:translateX(0);opacity:1}}'}</style>
    </div>
  );
}
