'use client';

import { useState } from 'react';

export function CoverAndStylePanel({ novelId, token, novelData }: {
  novelId: string; token: string; novelData?: any;
}) {
  const [generating, setGenerating] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string>(novelData?.coverImage || '');
  const [styleDNA, setStyleDNA] = useState<any>(novelData?.styleDNA || null);
  const [extractingStyle, setExtractingStyle] = useState(false);
  const [prompt, setPrompt] = useState('');

  const generateCover = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/novels/${novelId}/cover`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setCoverUrl(data.data.coverImage);
      } else {
        alert(data.error || '封面生成失败');
      }
    } catch (e: any) {
      alert('封面生成失败: ' + e.message);
    }
    finally { setGenerating(false); }
  };

  const extractStyleDNA = async () => {
    setExtractingStyle(true);
    try {
      const res = await fetch(`/api/novels/${novelId}/style-dna`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) setStyleDNA(data.data.styleDNA);
      else alert(data.error || '提取失败');
    } catch (e: any) {
      alert('风格DNA提取失败: ' + e.message);
    }
    finally { setExtractingStyle(false); }
  };

  const paceLabels: Record<string, string> = { fast: '快节奏', medium: '中节奏', slow: '慢节奏' };
  const toneLabels: Record<string, string> = { warm: '温暖明亮', dark: '黑暗压抑', balanced: '平衡' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
      {/* AI 封面生成 */}
      <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 16, color: '#e2e8f0' }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, marginBottom: 12 }}>🎨 AI 封面生成</h3>
        {coverUrl ? (
          <div style={{ marginBottom: 12 }}>
            <img src={coverUrl} alt="cover" style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 8, background: '#0f0f1e' }} />
          </div>
        ) : (
          <div style={{ background: '#0f0f1e', borderRadius: 8, padding: 40, textAlign: 'center', color: '#64748b', marginBottom: 12 }}>暂无封面</div>
        )}
        <input
          placeholder="自定义封面描述（可选，留空将自动生成）"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          style={{ ...inputStyle, marginBottom: 8 }}
        />
        <button onClick={generateCover} disabled={generating} style={{ ...btnStyle, background: generating ? '#475569' : '#ec4899', width: '100%' }}>
          {generating ? '生成中...' : '✨ 生成封面'}
        </button>
      </div>

      {/* 风格 DNA */}
      <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 16, color: '#e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>🧬 风格 DNA</h3>
          <button onClick={extractStyleDNA} disabled={extractingStyle} style={{ ...btnStyle, background: extractingStyle ? '#475569' : '#8b5cf6' }}>
            {extractingStyle ? '提取中...' : '🔬 提取风格'}
          </button>
        </div>

        {!styleDNA ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 13 }}>
            从已生成章节中提取风格特征，用于保持后续章节风格一致
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
            <div style={statBox}>
              <div style={{ color: '#94a3b8' }}>平均段落长度</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#a78bfa' }}>{styleDNA.avgParagraphLen} 字</div>
            </div>
            <div style={statBox}>
              <div style={{ color: '#94a3b8' }}>平均句长</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#a78bfa' }}>{styleDNA.avgSentenceLen} 字</div>
            </div>
            <div style={statBox}>
              <div style={{ color: '#94a3b8' }}>对话占比</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#a78bfa' }}>{styleDNA.dialogueRatio}%</div>
            </div>
            <div style={statBox}>
              <div style={{ color: '#94a3b8' }}>描写密度</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#a78bfa' }}>{styleDNA.descDensity}‰</div>
            </div>
            <div style={statBox}>
              <div style={{ color: '#94a3b8' }}>节奏类型</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#a78bfa' }}>{paceLabels[styleDNA.paceType] || styleDNA.paceType}</div>
            </div>
            <div style={statBox}>
              <div style={{ color: '#94a3b8' }}>情感基调</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#a78bfa' }}>{toneLabels[styleDNA.emotionalTone] || styleDNA.emotionalTone}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const statBox: React.CSSProperties = { background: '#0f0f1e', padding: 10, borderRadius: 8 };
const btnStyle: React.CSSProperties = { background: '#334155', color: '#e2e8f0', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 };
const inputStyle: React.CSSProperties = { background: '#0f0f1e', color: '#e2e8f0', border: '1px solid #334155', padding: '6px 10px', borderRadius: 6, fontSize: 13, outline: 'none', width: '100%' };
