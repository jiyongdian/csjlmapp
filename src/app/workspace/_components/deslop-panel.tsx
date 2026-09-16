'use client';

import { useState } from 'react';

export default function DeslopPanel() {
  const [content, setContent] = useState('');
  const [configId, setConfigId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleTransform = async () => {
    if (content.trim().length < 50) {
      setError('请提供至少50字的内容');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/novel/deslop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, configId: configId || undefined }),
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">原始文本 *</label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="粘贴含有AI腔的文本..."
            rows={14}
            className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm font-mono focus:outline-none focus:border-emerald-500 resize-y"
          />
          <div className="text-xs text-slate-500 mt-1">
            当前: {content.length}字 {content.length >= 50 ? '✅' : '❌ 需≥50字'}
          </div>
          <button
            onClick={handleTransform}
            disabled={loading || content.trim().length < 50}
            className="mt-3 w-full py-2.5 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 rounded-lg font-semibold text-sm disabled:opacity-50 shadow-lg shadow-emerald-500/20"
          >
            {loading ? '改写中...' : '🎨 去AI味改写'}
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">改写结果</label>
          <div className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm font-mono min-h-[340px] max-h-[500px] overflow-y-auto">
            {result?.rewrittenContent ? (
              <div className="text-slate-300 whitespace-pre-wrap leading-relaxed">
                {result.rewrittenContent}
              </div>
            ) : (
              <div className="text-slate-500 text-center pt-20">
                {loading ? '✨ AI改写中...' : '改写后的文本将在这里显示'}
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
          ❌ {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* AI特征检测 */}
          {result.issues?.length > 0 && (
            <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
              <div className="text-sm font-semibold mb-3">🔍 检出的AI特征 ({result.issues.length}项)</div>
              <div className="space-y-2">
                {result.issues.map((d: any, i: number) => (
                  <div key={i} className="p-2 rounded text-xs bg-red-900/30 border border-red-700/50">
                    <div className="font-semibold text-red-300">{d.pattern} <span className="text-slate-500">({d.count}次, {d.severity})</span></div>
                    {d.example && <div className="text-slate-400 mt-1">例: {d.example}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 评分 */}
          {result.score !== undefined && (
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-slate-900/50 rounded-lg border border-emerald-700/30">
                <div className="text-xs text-slate-500">AI味评分</div>
                <div className={`text-3xl font-bold ${result.score >= 70 ? 'text-green-400' : 'text-orange-400'}`}>
                  {result.score}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {result.status === 'fixed' ? '已改写' : '无需修改'}
                </div>
              </div>
              <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/30">
                <div className="text-xs text-slate-500">状态</div>
                <div className={`text-xl font-bold ${result.status === 'fixed' ? 'text-amber-400' : 'text-green-400'}`}>
                  {result.status === 'fixed' ? '✨ 已改写' : '✅ 通过'}
                </div>
                <div className="text-xs text-slate-400 mt-1">{result.summary}</div>
              </div>
            </div>
          )}

          {/* 主要改动 */}
          {result.diffStats && result.diffStats.changes > 0 && (
            <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
              <div className="text-sm font-semibold mb-2">📝 改写统计</div>
              <div className="flex gap-4 text-sm">
                <div>原文: <span className="text-slate-300">{result.diffStats.originalLength}字</span></div>
                <div>改写: <span className="text-slate-300">{result.diffStats.revisedLength}字</span></div>
                <div>改动: <span className="text-emerald-400">{result.diffStats.changes}处</span></div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}