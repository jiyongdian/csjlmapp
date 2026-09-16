'use client';

import { useState } from 'react';

const MODES = [
  { value: 'quick', label: '快速审查', desc: '结构+可读性快速检查' },
  { value: 'standard', label: '标准审查', desc: '三视角+五维评分' },
  { value: 'deep', label: '深度审查', desc: '全部维度+题材专项' },
];

const GENRES = ['都市', '言情', '玄幻', '悬疑', '历史', '科幻', '军事', '游戏', '体育'];

export default function ReviewPanel() {
  const [content, setContent] = useState('');
  const [mode, setMode] = useState('standard');
  const [genre, setGenre] = useState('都市');
  const [configId, setConfigId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleReview = async () => {
    if (content.trim().length < 100) {
      setError('请提供至少100字的章节内容');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/novel/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, mode, genre, configId: configId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '审查失败');
      setResult(data);
    } catch (e: any) {
      setError(e.message || '审查失败');
    } finally {
      setLoading(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 85) return 'text-green-400';
    if (score >= 70) return 'text-yellow-400';
    if (score >= 50) return 'text-orange-400';
    return 'text-red-400';
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-3">
          <label className="block text-sm font-medium text-slate-300 mb-2">章节内容 *</label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="粘贴要审查的章节内容..."
            rows={12}
            className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm font-mono focus:outline-none focus:border-amber-500 resize-y"
          />
          <div className="text-xs text-slate-500 mt-1">
            当前: {content.length}字 {content.length >= 100 ? '✅' : '❌ 需≥100字'}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">审查模式</label>
            <div className="space-y-1">
              {MODES.map(m => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={`w-full p-2 text-left rounded-lg text-xs border transition-all ${
                    mode === m.value
                      ? 'bg-amber-600 border-amber-500'
                      : 'bg-slate-800/50 border-slate-700 hover:bg-slate-700/50'
                  }`}
                >
                  <div className="font-semibold">{m.label}</div>
                  <div className="text-slate-400">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">题材</label>
            <select
              value={genre}
              onChange={e => setGenre(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm"
            >
              {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <button
            onClick={handleReview}
            disabled={loading || content.trim().length < 100}
            className="w-full py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 rounded-lg font-semibold text-sm disabled:opacity-50 shadow-lg shadow-amber-500/20"
          >
            {loading ? '审查中...' : '⭐ 开始审查'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
          ❌ {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* 总分卡 */}
          <div className={`p-4 rounded-lg border ${
            result.pass
              ? 'bg-green-900/20 border-green-500/50'
              : 'bg-red-900/20 border-red-500/50'
          }`}>
            <div className="flex items-center gap-4">
              <div className="text-4xl font-bold">{result.overallScore}</div>
              <div>
                <div className="text-lg font-semibold">
                  {result.pass ? '✅ 通过审查' : '❌ 未通过审查'}
                </div>
                <div className="text-sm text-slate-400">
                  读者契约: <span className={result.contractStatus === 'safe' ? 'text-green-400' : 'text-red-400'}>{result.contractStatus}</span>
                  {' · '}
                  精修策略: <span className="text-amber-400">{result.revisionStrategy}</span>
                </div>
              </div>
            </div>
            {result.summary && (
              <p className="mt-3 text-sm text-slate-300">{result.summary}</p>
            )}
          </div>

          {/* 五维评分 */}
          {result.fiveDimensionScores && (
            <div className="grid grid-cols-5 gap-2">
              {[
                { k: 'consistency', label: '核心一致度' },
                { k: 'originality', label: '表层重写度' },
                { k: 'formatting', label: '格式一致度' },
                { k: 'readability', label: '可读性' },
                { k: 'logic', label: '逻辑连贯' },
              ].map(s => (
                <div key={s.k} className="p-3 bg-slate-900/50 rounded-lg border border-slate-700/50 text-center">
                  <div className={`text-2xl font-bold ${getScoreColor(result.fiveDimensionScores[s.k])}`}>
                    {result.fiveDimensionScores[s.k]}
                  </div>
                  <div className="text-xs text-slate-400">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* 三位审稿人 */}
          {result.perspectives?.length > 0 && (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-300">👥 三位审稿人评审</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {result.perspectives.map((p: any, i: number) => (
                  <div key={i} className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold text-sm">{p.name}</div>
                      <div className={`text-lg font-bold ${getScoreColor(p.overallScore)}`}>{p.overallScore}</div>
                    </div>
                    <p className="text-xs text-slate-400 mb-2 line-clamp-3">{p.summary}</p>
                    {p.dimensions?.map((d: any, j: number) => (
                      <div key={j} className="flex items-center gap-2 text-xs mb-1">
                        <span className="text-slate-500 w-20 truncate">{d.name}</span>
                        <div className="flex-1 bg-slate-800 rounded h-1.5">
                          <div
                            className="h-1.5 rounded bg-amber-500"
                            style={{ width: `${d.score}%` }}
                          />
                        </div>
                        <span className={`${getScoreColor(d.score)} w-8 text-right`}>{d.score}</span>
                      </div>
                    ))}
                    {p.keySuggestions?.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-700/50">
                        <div className="text-[10px] text-slate-500 mb-1">建议</div>
                        {p.keySuggestions.slice(0, 2).map((s: string, j: number) => (
                          <div key={j} className="text-xs text-amber-300">• {s}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}