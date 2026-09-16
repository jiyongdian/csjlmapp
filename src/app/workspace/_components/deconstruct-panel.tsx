'use client';

import { useState } from 'react';

export default function DeconstructPanel() {
  const [content, setContent] = useState('');
  const [type, setType] = useState<'short' | 'long' | 'auto'>('auto');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleAnalyze = async () => {
    if (content.trim().length < 500) {
      setError('请提供至少500字的小说内容');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/novel/deconstruct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, type, title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '拆文失败');
      setResult(data);
    } catch (e: any) {
      setError(e.message || '分析失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-3">
          <label className="block text-sm font-medium text-slate-300 mb-2">小说内容 *</label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="粘贴要分析的小说内容（≥500字）..."
            rows={12}
            className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm font-mono focus:outline-none focus:border-cyan-500 resize-y"
          />
          <div className="text-xs text-slate-500 mt-1">
            当前: {content.length}字 {content.length >= 500 ? '✅' : '❌ 需≥500字'}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">拆文类型</label>
            <select
              value={type}
              onChange={e => setType(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm"
            >
              <option value="auto">自动判断</option>
              <option value="short">短篇 ({'<15k'})</option>
              <option value="long">长篇 ({'>20k'})</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">书名（可选）</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="用于报告"
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm"
            />
          </div>
          <button
            onClick={handleAnalyze}
            disabled={loading || content.trim().length < 500}
            className="w-full py-2.5 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 rounded-lg font-semibold text-sm disabled:opacity-50 shadow-lg shadow-cyan-500/20"
          >
            {loading ? '分析中...' : '🔍 开始拆文'}
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
          <div className="p-4 bg-gradient-to-r from-cyan-600/10 to-teal-600/10 rounded-lg border border-cyan-500/30">
            <h3 className="font-bold">{result.title} · {result.genreDetected}</h3>
            <div className="text-xs text-slate-400 mt-1">
              类型: {result.type} · {result.wordCount}字
            </div>
            <div className="mt-2 text-sm">
              <span className="text-slate-500">故事核: </span>
              <span className="text-cyan-300">{result.storyCore}</span>
            </div>
          </div>

          {/* 五维评分 */}
          {result.overallScores && (
            <div className="grid grid-cols-5 gap-2">
              {[
                { k: 'storyCore', label: '故事核' },
                { k: 'structure', label: '结构' },
                { k: 'emotion', label: '情感' },
                { k: 'reversal', label: '反转' },
                { k: 'character', label: '人物' },
              ].map(s => (
                <div key={s.k} className="p-3 bg-slate-900/50 rounded-lg border border-slate-700/50 text-center">
                  <div className="text-2xl font-bold text-cyan-400">{result.overallScores[s.k]}</div>
                  <div className="text-xs text-slate-400">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 结构分段 */}
            {result.structureSegments?.length > 0 && (
              <Card title="📊 结构分段">
                {result.structureSegments.map((seg: any, i: number) => (
                  <div key={i} className="mb-2 p-2 bg-slate-800/50 rounded text-xs">
                    <div className="font-semibold">{seg.phase}</div>
                    <div className="text-slate-400">{seg.summary}</div>
                  </div>
                ))}
              </Card>
            )}

            {/* 情节节点 */}
            {result.plotNodes?.length > 0 && (
              <Card title={`📍 情节节点 (${result.plotNodes.length}个)`}>
                <div className="max-h-48 overflow-y-auto space-y-1 text-xs">
                  {result.plotNodes.slice(0, 15).map((node: any) => (
                    <div key={node.index} className="flex gap-2">
                      <span className="text-cyan-400 font-mono">{node.index}.</span>
                      <span className="text-slate-400">{node.type}: {node.description}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* 情感曲线 */}
            {result.emotionCurve?.length > 0 && (
              <Card title={`💭 情感曲线 (${result.emotionCurve.length}个点)`}>
                <div className="flex items-end gap-1 h-20">
                  {result.emotionCurve.map((p: any, i: number) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className="w-full bg-gradient-to-t from-cyan-600 to-cyan-400 rounded-t"
                        style={{ height: `${(p.intensity || 5) * 10}%` }}
                        title={p.description}
                      />
                      <div className="text-[10px] text-slate-500">{p.point}</div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* 写作手法 */}
            {result.writingTechniques?.length > 0 && (
              <Card title={`✍️ 写作手法 (${result.writingTechniques.length}项)`}>
                <div className="space-y-1 text-xs">
                  {result.writingTechniques.map((t: any, i: number) => (
                    <div key={i} className="p-1.5 bg-slate-800/50 rounded">
                      <span className="text-cyan-400 font-semibold">{t.category}:</span> {t.technique}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>

          {/* 反转分析 */}
          {result.reversalAnalysis && (
            <Card title="🔄 反转分析">
              <div className="text-sm space-y-1">
                <div><span className="text-slate-500">类型: </span>{result.reversalAnalysis.type}</div>
                <div><span className="text-slate-500">机制: </span>{result.reversalAnalysis.mechanism}</div>
                {result.reversalAnalysis.setupClues?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {result.reversalAnalysis.setupClues.map((c: string, i: number) => (
                      <span key={i} className="px-1.5 py-0.5 bg-cyan-600/20 text-cyan-300 rounded text-xs">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* 可复用结构 */}
          {result.reusableStructures?.length > 0 && (
            <Card title={`♻️ 可复用结构 (${result.reusableStructures.length}条)`}>
              <ul className="space-y-1 text-sm">
                {result.reusableStructures.map((s: string, i: number) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-cyan-400">▸</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* 总结 */}
          {result.summary && (
            <Card title="📋 综合总结">
              <p className="text-sm text-slate-300 leading-relaxed">{result.summary}</p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 overflow-hidden">
      <div className="px-3 py-2 bg-slate-800/50 border-b border-slate-700/50 text-xs font-semibold">
        {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}