'use client';

import { useState } from 'react';

// ===== 质量审查面板 =====
export function ChapterReviewPanel({
  chapter,
  genre,
  onClose,
  onApply,
  selectedConfigId,
}: {
  chapter: { index: number; title: string; content: string };
  genre: string;
  onClose: () => void;
  onApply?: (newContent: string) => void;
  selectedConfigId?: string;
}) {
  const [mode, setMode] = useState('standard');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleReview = async () => {
    if (chapter.content.trim().length < 100) {
      setError('章节内容不足100字');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/novel/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: chapter.content,
          mode,
          genre: genre || '都市',
          configId: selectedConfigId || undefined,
        }),
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
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl border border-amber-500/30 shadow-2xl"
        style={{ background: 'rgba(15,12,41,0.98)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-white/10 backdrop-blur-xl" style={{ background: 'rgba(15,12,41,0.95)' }}>
          <div>
            <h3 className="text-xl font-bold text-white">⭐ 章节质量审查</h3>
            <p className="text-xs text-gray-400 mt-0.5">第{chapter.index}章：{chapter.title} · {chapter.content.length}字</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Controls */}
          {!result && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-slate-300 mb-2">章节内容预览</label>
                <div className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-xs font-mono text-slate-400 max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {chapter.content}
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">审查模式</label>
                  <div className="space-y-1">
                    {[
                      { v: 'quick', l: '快速审查', d: '结构+可读性快速检查' },
                      { v: 'standard', l: '标准审查', d: '三视角+五维评分' },
                      { v: 'deep', l: '深度审查', d: '全部维度+题材专项' },
                    ].map(m => (
                      <button
                        key={m.v}
                        onClick={() => setMode(m.v)}
                        className={`w-full p-2 text-left rounded-lg text-xs border transition-all ${mode === m.v ? 'bg-amber-600 border-amber-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-300 hover:bg-slate-700/50'}`}
                      >
                        <div className="font-semibold">{m.l}</div>
                        <div className="text-slate-400 opacity-80">{m.d}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={handleReview}
                  disabled={loading}
                  className="w-full py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 rounded-lg font-semibold text-sm disabled:opacity-50 shadow-lg shadow-amber-500/20"
                >
                  {loading ? '审查中...' : '开始审查'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">❌ {error}</div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-4">
              {/* Score card */}
              <div className={`p-5 rounded-xl border ${result.pass ? 'bg-green-900/20 border-green-500/50' : 'bg-red-900/20 border-red-500/50'}`}>
                <div className="flex items-center gap-5">
                  <div className="text-5xl font-bold">{result.overallScore}</div>
                  <div className="flex-1">
                    <div className="text-xl font-semibold">{result.pass ? '✅ 通过审查' : '❌ 未通过审查'}</div>
                    <div className="text-sm text-slate-400 mt-1">
                      读者契约: <span className={result.contractStatus === 'safe' ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>{result.contractStatus}</span>
                      {' · '}精修策略: <span className="text-amber-400 font-medium">{result.revisionStrategy}</span>
                    </div>
                    {result.summary && <p className="mt-2 text-sm text-slate-300 leading-relaxed">{result.summary}</p>}
                  </div>
                </div>
              </div>

              {/* 5D scores */}
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
                      <div className="text-xs text-slate-400 mt-1">{s.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Perspectives */}
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
                        <p className="text-xs text-slate-400 mb-2 line-clamp-3 leading-relaxed">{p.summary}</p>
                        {p.dimensions?.map((d: any, j: number) => (
                          <div key={j} className="flex items-center gap-2 text-xs mb-1">
                            <span className="text-slate-500 w-20 truncate shrink-0">{d.name}</span>
                            <div className="flex-1 bg-slate-800 rounded h-1.5">
                              <div className="h-1.5 rounded bg-amber-500" style={{ width: `${d.score}%` }} />
                            </div>
                            <span className={`${getScoreColor(d.score)} w-8 text-right shrink-0`}>{d.score}</span>
                          </div>
                        ))}
                        {p.keySuggestions?.length > 0 && (
                          <div className="mt-3 pt-2 border-t border-slate-700/50 space-y-1">
                            <div className="text-[10px] text-slate-500">💡 建议</div>
                            {p.keySuggestions.slice(0, 3).map((s: string, j: number) => (
                              <div key={j} className="text-xs text-amber-300 leading-relaxed">• {s}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-4 border-t border-white/10">
                <button
                  onClick={() => { setResult(null); setError(''); }}
                  className="flex-1 py-2.5 bg-white/8 hover:bg-white/15 text-gray-300 font-medium rounded-xl transition-all"
                >
                  重新审查
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-medium rounded-xl transition-all"
                >
                  关闭
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== 去AI味面板 =====
export function ChapterDeslopPanel({
  chapter,
  onClose,
  onApply,
  selectedConfigId,
}: {
  chapter: { index: number; title: string; content: string };
  onClose: () => void;
  onApply: (newContent: string) => void;
  selectedConfigId?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);

  const handleTransform = async () => {
    if (chapter.content.trim().length < 50) {
      setError('内容不足50字');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/novel/deslop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: chapter.content,
          configId: selectedConfigId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '改写失败');
      setResult(data);
    } catch (e: any) {
      setError(e.message || '改写失败');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    const rewritten = result?.rewrittenContent || result?.revisedContent;
    if (!rewritten) return;
    setApplying(true);
    try {
      onApply(rewritten);
      onClose();
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-6xl max-h-[90vh] overflow-y-auto rounded-2xl border border-emerald-500/30 shadow-2xl"
        style={{ background: 'rgba(15,12,41,0.98)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-white/10 backdrop-blur-xl" style={{ background: 'rgba(15,12,41,0.95)' }}>
          <div>
            <h3 className="text-xl font-bold text-white">🎨 去AI味改写</h3>
            <p className="text-xs text-gray-400 mt-0.5">第{chapter.index}章：{chapter.title}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {!result && !loading && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">原文</label>
                <div className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-xs font-mono text-slate-400 min-h-[200px] max-h-[340px] overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {chapter.content}
                </div>
                <div className="text-xs text-slate-500 mt-1">{chapter.content.length}字</div>
                <button
                  onClick={handleTransform}
                  className="mt-3 w-full py-2.5 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 rounded-lg font-semibold text-sm shadow-lg shadow-emerald-500/20"
                >
                  开始改写
                </button>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">改写结果</label>
                <div className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg min-h-[200px] max-h-[340px] overflow-y-auto flex items-center justify-center">
                  <span className="text-slate-500 text-sm">点击「开始改写」生成结果</span>
                </div>
              </div>
            </div>
          )}

          {loading && (
            <div className="min-h-[300px] flex flex-col items-center justify-center gap-3">
              <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <div className="text-emerald-400 text-sm">AI 正在重写文本，去除AI腔...</div>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">❌ {error}</div>
          )}

          {result && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">原文</label>
                  <div className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-xs font-mono text-slate-400 max-h-[400px] overflow-y-auto whitespace-pre-wrap leading-relaxed">
                    {chapter.content}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{chapter.content.length}字</div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-emerald-400 mb-2">改写后</label>
                  <div className="w-full px-3 py-2 bg-emerald-500/5 border border-emerald-500/30 rounded-lg text-sm text-slate-300 max-h-[400px] overflow-y-auto whitespace-pre-wrap leading-relaxed font-mono">
                    {result.rewrittenContent || result.revisedContent}
                  </div>
                  <div className="text-xs text-emerald-400 mt-1">{(result.rewrittenContent || result.revisedContent)?.length || 0}字</div>
                </div>
              </div>

              {/* Issues */}
              {result.issues?.length > 0 && (
                <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
                  <div className="text-sm font-semibold mb-3">🔍 检出的AI特征 ({result.issues.length}项)</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {result.issues.map((d: any, i: number) => (
                      <div key={i} className="p-2.5 rounded text-xs bg-red-900/20 border border-red-700/30">
                        <div className="font-semibold text-red-300">{d.pattern} <span className="text-slate-500">({d.count}次, {d.severity})</span></div>
                        {d.example && <div className="text-slate-400 mt-1 truncate">例: {d.example}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-900/50 rounded-lg border border-emerald-700/30 text-center">
                  <div className="text-xs text-slate-500">AI味评分</div>
                  <div className={`text-2xl font-bold mt-1 ${result.score >= 70 ? 'text-green-400' : 'text-orange-400'}`}>{result.score}</div>
                </div>
                <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700/30 text-center">
                  <div className="text-xs text-slate-500">状态</div>
                  <div className={`text-lg font-bold mt-1 ${result.status === 'fixed' ? 'text-amber-400' : 'text-green-400'}`}>
                    {result.status === 'fixed' ? '已改写' : '通过'}
                  </div>
                </div>
                {result.diffStats && (
                  <>
                    <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700/30 text-center">
                      <div className="text-xs text-slate-500">原文</div>
                      <div className="text-lg font-bold mt-1 text-slate-300">{result.diffStats.originalLength}</div>
                    </div>
                    <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700/30 text-center">
                      <div className="text-xs text-slate-500">改动处</div>
                      <div className="text-lg font-bold mt-1 text-emerald-400">{result.diffStats.changes}</div>
                    </div>
                  </>
                )}
              </div>

              <div className="flex gap-3 pt-4 border-t border-white/10">
                <button
                  onClick={() => setResult(null)}
                  className="flex-1 py-2.5 bg-white/8 hover:bg-white/15 text-gray-300 font-medium rounded-xl transition-all"
                >
                  重新改写
                </button>
                <button
                  onClick={handleApply}
                  disabled={applying || !(result.rewrittenContent || result.revisedContent)}
                  className="flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-medium rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {applying ? (
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> 应用中...</>
                  ) : '✅ 应用改写结果'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
