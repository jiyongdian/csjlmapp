'use client';

import { useState } from 'react';

const EMOTIONS = [
  { value: 'sad_regret', label: '意难平', emoji: '💔' },
  { value: 'shock_reversal', label: '反转震撼', emoji: '😱' },
  { value: 'satisfying_revenge', label: '爽感释放', emoji: '⚡' },
  { value: 'healing_warm', label: '治愈温暖', emoji: '🌻' },
  { value: 'creepy_thought', label: '细思极恐', emoji: '👻' },
  { value: 'touched_moved', label: '共鸣感动', emoji: '🥺' },
];

const GENRES = [
  '追妻火葬场', '世情打脸', '复仇打脸', '总裁豪门',
  '宅斗宫斗', '民俗怪谈', '悬疑', '甜宠', '双男主', '沙雕脑洞',
];

export default function ShortStoryPanel() {
  const [emotion, setEmotion] = useState('sad_regret');
  const [genre, setGenre] = useState('追妻火葬场');
  const [title, setTitle] = useState('');
  const [keywords, setKeywords] = useState('');
  const [wordCount, setWordCount] = useState(3000);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/novel/short-story/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emotion, genre, title, keywords, wordCount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '生成失败');
      setResult(data);
    } catch (e: any) {
      setError(e.message || '生成失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">情绪目标 *</label>
          <div className="grid grid-cols-2 gap-2">
            {EMOTIONS.map(e => (
              <button
                key={e.value}
                onClick={() => setEmotion(e.value)}
                className={`p-2 rounded-lg text-sm border transition-all ${
                  emotion === e.value
                    ? 'bg-pink-600 border-pink-500 text-white'
                    : 'bg-slate-800/50 border-slate-700 text-slate-300 hover:bg-slate-700/50'
                }`}
              >
                {e.emoji} {e.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">题材 *</label>
          <select
            value={genre}
            onChange={e => setGenre(e.target.value)}
            className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-pink-500"
          >
            {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <div className="mt-3">
            <label className="block text-sm font-medium text-slate-300 mb-2">关键词/灵感</label>
            <input
              value={keywords}
              onChange={e => setKeywords(e.target.value)}
              placeholder="如：结婚七年老公把我锁在家里陪白月光"
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-pink-500"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            目标字数: {wordCount}字
          </label>
          <input
            type="range" min={1500} max={8000} step={500}
            value={wordCount}
            onChange={e => setWordCount(Number(e.target.value))}
            className="w-full accent-pink-500"
          />
          <div className="mt-3">
            <label className="block text-sm font-medium text-slate-300 mb-2">标题（可选）</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="留空由AI生成"
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-pink-500"
            />
          </div>
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading}
        className="w-full py-3 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 rounded-lg font-semibold transition-all disabled:opacity-50 shadow-lg shadow-pink-500/20"
      >
        {loading ? '创作中...' : '✍️ 创作短篇'}
      </button>

      {error && (
        <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
          ❌ {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="p-4 bg-gradient-to-r from-pink-600/10 to-rose-600/10 rounded-lg border border-pink-500/30">
            <h3 className="text-xl font-bold">{result.title}</h3>
            <p className="text-xs text-slate-400 mt-1">
              {result.emotion} · {result.genre} · {result.wordCount}字
            </p>
          </div>

          {result.outline?.synopsis && (
            <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
              <div className="text-xs text-slate-500 mb-1">黄金简介</div>
              <div className="text-sm text-slate-300 leading-relaxed">{result.outline.synopsis}</div>
            </div>
          )}

          {result.outline?.sections?.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {result.outline.sections.map((s: any) => (
                <div key={s.index} className="p-2 bg-slate-800/50 rounded border border-slate-700 text-xs">
                  <div className="font-semibold">###{s.index} {s.title}</div>
                  <div className="text-slate-400 line-clamp-2 mt-1">{s.summary}</div>
                  <div className="text-pink-400 mt-1">💡 {s.hook}</div>
                </div>
              ))}
            </div>
          )}

          {result.content && (
            <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50 max-h-[500px] overflow-y-auto">
              <div className="text-xs text-slate-500 mb-2">正文</div>
              <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{result.content}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}