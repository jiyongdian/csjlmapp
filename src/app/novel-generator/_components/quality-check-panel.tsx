'use client';

import { useState } from 'react';

export function QualityCheckPanel({ novelId, token, chapterContent, chapterNumber }: {
  novelId: string; token: string; chapterContent?: string; chapterNumber?: number;
}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<any>(null);

  const runCheck = async () => {
    if (!chapterContent) {
      alert('请先生成或选择一个章节');
      return;
    }
    setChecking(true);
    try {
      const res = await fetch(`/api/novels/${novelId}/quality`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'quick-check', content: chapterContent, chapterNumber }),
      });
      const data = await res.json();
      if (data.success) setResult(data.data);
    } catch (e) { console.error(e); }
    finally { setChecking(false); }
  };

  const scoreColor = (score: number) => score >= 80 ? '#22c55e' : score >= 60 ? '#eab308' : score >= 40 ? '#f97316' : '#ef4444';

  const ScoreBar = ({ label, score }: { label: string; score: number }) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
        <span style={{ color: '#94a3b8' }}>{label}</span>
        <span style={{ color: scoreColor(score), fontWeight: 600 }}>{score}</span>
      </div>
      <div style={{ height: 6, background: '#334155', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: scoreColor(score), transition: 'width 0.3s' }} />
      </div>
    </div>
  );

  return (
    <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 16, color: '#e2e8f0', marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>💎 人性质量检测</h3>
        <button onClick={runCheck} disabled={checking} style={{ ...btnStyle, background: checking ? '#475569' : '#10b981' }}>
          {checking ? '检测中...' : '▶ 开始检测'}
        </button>
      </div>

      {!result ? (
        <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 13 }}>
          点击"开始检测"评估当前章节的人性化质量
          <div style={{ marginTop: 8, fontSize: 11 }}>检测维度：情感感染力、具体细节、自然度、对话质量、节奏</div>
        </div>
      ) : (
        <div>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: scoreColor(result.overallScore) }}>{result.overallScore}</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>综合人性化评分</div>
          </div>
          <ScoreBar label="情感感染力" score={result.emotionScore} />
          <ScoreBar label="具体细节" score={result.specificityScore} />
          <ScoreBar label="自然度" score={result.naturalnessScore} />
          <ScoreBar label="对话质量" score={result.dialogueScore} />
          <ScoreBar label="节奏" score={result.pacingScore} />

          {result.issues && result.issues.length > 0 && (
            <div style={{ marginTop: 12, padding: 10, background: '#0f0f1e', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#f87171', fontWeight: 600, marginBottom: 6 }}>⚠️ 改进建议</div>
              {result.issues.map((issue: any, i: number) => (
                <div key={i} style={{ fontSize: 11, color: '#cbd5e1', marginBottom: 4 }}>
                  <span style={{ color: issue.severity === 'high' ? '#ef4444' : '#f59e0b' }}>[{issue.severity === 'high' ? '严重' : '中等'}]</span>
                  {issue.description} — {issue.suggestion}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = { background: '#334155', color: '#e2e8f0', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 };
