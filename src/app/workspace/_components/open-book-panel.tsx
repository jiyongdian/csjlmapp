'use client';

import { useState } from 'react';

const GENRES = [
  { value: '打脸逆袭', label: '打脸逆袭', emoji: '⚡' },
  { value: '身份反转', label: '身份反转', emoji: '🎭' },
  { value: '感情拉扯', label: '感情拉扯', emoji: '💔' },
  { value: '升级打怪', label: '升级打怪', emoji: '⚔️' },
  { value: '悬疑惊悚', label: '悬疑惊悚', emoji: '🔮' },
  { value: '日常装逼', label: '日常装逼', emoji: '😎' },
  { value: '种田经营', label: '种田经营', emoji: '🌾' },
  { value: '竞技热血', label: '竞技热血', emoji: '🏆' },
  { value: '虐恋救赎', label: '虐恋救赎', emoji: '🌸' },
  { value: '沙雕搞笑', label: '沙雕搞笑', emoji: '🤪' },
];

export default function OpenBookPanel() {
  const [genre, setGenre] = useState('打脸逆袭');
  const [title, setTitle] = useState('');
  const [direction, setDirection] = useState('');
  const [keywords, setKeywords] = useState('');
  const [chapterCount, setChapterCount] = useState(20);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch('/api/novel/open-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genre, title, direction, keywords, chapterCount }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '开书失败');
      }
      setResult(data);
    } catch (e: any) {
      setError(e.message || '生成失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 输入表单 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">选择题材 *</label>
          <div className="grid grid-cols-2 gap-2">
            {GENRES.map(g => (
              <button
                key={g.value}
                onClick={() => setGenre(g.value)}
                className={`p-2.5 rounded-lg text-sm border transition-all ${
                  genre === g.value
                    ? 'bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-500/20'
                    : 'bg-slate-800/50 border-slate-700 text-slate-300 hover:bg-slate-700/50'
                }`}
              >
                {g.emoji} {g.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">书名（可选）</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="留空由AI生成"
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">方向说明</label>
            <input
              value={direction}
              onChange={e => setDirection(e.target.value)}
              placeholder="如：现代都市、底层逆袭、商战"
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">关键词/灵感</label>
            <input
              value={keywords}
              onChange={e => setKeywords(e.target.value)}
              placeholder="如：外卖员+隐藏身份+商业帝国"
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              规划章节数: {chapterCount}章
            </label>
            <input
              type="range"
              min={10}
              max={50}
              step={5}
              value={chapterCount}
              onChange={e => setChapterCount(Number(e.target.value))}
              className="w-full accent-violet-500"
            />
          </div>
        </div>
      </div>

      {/* 生成按钮 */}
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="w-full py-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-violet-500/20"
      >
        {loading ? '生成中...' : '📖 一键开书'}
      </button>

      {error && (
        <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
          ❌ {error}
        </div>
      )}

      {/* 结果展示 */}
      {result && (
        <div className="space-y-4 animate-in fade-in">
          {/* 标题区 */}
          <div className="p-4 bg-gradient-to-r from-violet-600/10 to-indigo-600/10 rounded-lg border border-violet-500/30">
            <h3 className="text-xl font-bold">{result.title}</h3>
            <p className="text-sm text-slate-400 mt-1">
              题材: {result.genre} · 核心情绪: {result.emotionCore}
            </p>
          </div>

          {/* 核心设定 */}
          {result.coreSetup && (
            <ResultCard title="🎯 核心设定">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <InfoRow label="世界观" value={result.coreSetup.worldBuilding} />
                <InfoRow label="力量体系" value={result.coreSetup.powerSystem} />
                <InfoRow label="金手指" value={result.coreSetup.goldenFinger} />
                <InfoRow label="结局规划" value={result.coreSetup.endingPlan} />
              </div>
              {result.coreSetup.protagonist && (
                <div className="mt-3 p-3 bg-slate-800/50 rounded-lg">
                  <div className="text-xs text-slate-500 mb-1">主角</div>
                  <div className="font-semibold">{result.coreSetup.protagonist.name}</div>
                  <div className="text-xs text-slate-400">
                    {result.coreSetup.protagonist.archetype} · 动机: {result.coreSetup.protagonist.motivation}
                  </div>
                </div>
              )}
              {result.coreSetup.characters?.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs text-slate-500 mb-2">核心配角 ({result.coreSetup.characters.length}人)</div>
                  <div className="flex flex-wrap gap-2">
                    {result.coreSetup.characters.map((c: any, i: number) => (
                      <span key={i} className="px-2 py-1 bg-slate-700/50 rounded text-xs">
                        {c.name} ({c.role})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </ResultCard>
          )}

          {/* 卷纲 */}
          {result.volumeOutline?.volumes?.length > 0 && (
            <ResultCard title={`📚 卷纲 (${result.volumeOutline.totalVolumes}卷)`}>
              <div className="space-y-2">
                {result.volumeOutline.volumes.map((v: any, i: number) => (
                  <div key={i} className="p-3 bg-slate-800/50 rounded-lg">
                    <div className="font-semibold text-sm">卷{v.index}: {v.title}</div>
                    <div className="text-xs text-slate-400 mt-1">{v.summary}</div>
                    {v.keyEvents?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {v.keyEvents.slice(0, 4).map((e: string, j: number) => (
                          <span key={j} className="px-1.5 py-0.5 bg-violet-600/20 text-violet-300 rounded text-xs">
                            {e}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ResultCard>
          )}

          {/* 章节细纲 */}
          {result.chapterDetails?.chapters?.length > 0 && (
            <ResultCard title={`📝 章节细纲 (${result.chapterDetails.chapters.length}章)`}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-96 overflow-y-auto">
                {result.chapterDetails.chapters.map((ch: any) => (
                  <div key={ch.index} className="p-2 bg-slate-800/50 rounded border border-slate-700 text-xs">
                    <div className="font-semibold text-slate-200">第{ch.index}章: {ch.title}</div>
                    <div className="text-slate-400 mt-0.5 line-clamp-2">{ch.event}</div>
                    <div className="text-violet-400 mt-0.5">💡 {ch.hook}</div>
                  </div>
                ))}
              </div>
            </ResultCard>
          )}

          {/* 读者契约 */}
          {result.readerContract && (
            <ResultCard title="📜 读者契约">
              <div className="space-y-1 text-sm">
                <div><span className="text-slate-500">核心承诺：</span>{result.readerContract.corePromise}</div>
                <div><span className="text-slate-500">兑现方式：</span>{result.readerContract.payoffType}</div>
                <div><span className="text-slate-500">升级路径：</span>{result.readerContract.escalationPath}</div>
              </div>
            </ResultCard>
          )}
        </div>
      )}
    </div>
  );
}

function ResultCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 overflow-hidden">
      <div className="px-4 py-2 bg-slate-800/50 border-b border-slate-700/50 text-sm font-semibold">
        {title}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-slate-300 line-clamp-2">{value}</div>
    </div>
  );
}