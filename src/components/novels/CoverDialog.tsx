'use client';

import { useEffect, useRef, useState } from 'react';

export interface CoverDialogProps {
  novelId: string;
  novelTitle?: string;
  open: boolean;
  onClose: () => void;
  onSaved?: (url: string) => void;
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(new Error('读取图片失败'));
    fr.readAsDataURL(file);
  });
}

export default function CoverDialog({ novelId, novelTitle, open, onClose, onSaved }: CoverDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<'' | 'prompt' | 'gen' | 'upload'>('');
  const [err, setErr] = useState('');
  const [tip, setTip] = useState('');
  const [current, setCurrent] = useState('');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [count, setCount] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  // 打开时载入当前封面
  useEffect(() => {
    if (!open || !novelId) return;
    setErr(''); setTip(''); setCandidates([]);
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/novels/' + novelId);
        const j = await r.json();
        const data = j && j.success ? j.data : null;
        if (alive && data) setCurrent(data.coverImage || '');
      } catch { /* 忽略 */ }
    })();
    return () => { alive = false; };
  }, [open, novelId]);

  const authHeaders = () => {
    let token = '';
    try { token = localStorage.getItem('token') || ''; } catch { /* 忽略 */ }
    return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
  };

  const genPrompt = async () => {
    setBusy('prompt'); setErr(''); setTip('AI 正在提炼封面提示词…');
    try {
      const r = await fetch('/api/novels/' + novelId + '/cover-prompt', { method: 'POST', headers: authHeaders() });
      const j = await r.json();
      if (j && j.success) { setPrompt(j.data.prompt || ''); setTip('已生成提示词，可继续微调。'); }
      else { setErr((j && j.error) || '提示词生成失败'); setTip(''); }
    } catch (e: any) {
      setErr('提示词生成失败：' + (e?.message || '网络错误')); setTip('');
    } finally { setBusy(''); }
  };

  const generate = async () => {
    setErr(''); setTip('正在生成封面，约需 1-3 分钟，请勿关闭…');
    setBusy('gen');
    try {
      const total = Math.max(1, Math.min(4, count));
      for (let i = 0; i < total; i++) {
        const r = await fetch('/api/novels/' + novelId + '/cover', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ prompt: prompt || undefined }),
        });
        const j = await r.json();
        if (!j || !j.success) { setErr((j && j.error) || '封面生成失败'); setTip(''); return; }
        const url = j.data.coverImage as string;
        setCurrent(url);
        setCandidates((prev) => (prev.indexOf(url) >= 0 ? prev : [...prev, url]));
        if (onSaved) onSaved(url);
      }
      setTip('封面已生成并应用。');
    } catch (e: any) {
      setErr('封面生成失败：' + (e?.message || '网络错误')); setTip('');
    } finally { setBusy(''); }
  };

  const applyCandidate = async (url: string) => {
    setErr('');
    try {
      const r = await fetch('/api/novels/' + novelId + '/cover', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ mode: 'set', url }),
      });
      const j = await r.json();
      if (j && j.success) { setCurrent(url); if (onSaved) onSaved(url); }
      else setErr((j && j.error) || '应用失败');
    } catch (e: any) { setErr('应用失败：' + (e?.message || '网络错误')); }
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setErr('请选择图片文件'); return; }
    if (file.size > 5 * 1024 * 1024) { setErr('图片不能超过 5MB'); return; }
    setErr(''); setBusy('upload'); setTip('正在上传封面…');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const r = await fetch('/api/novels/' + novelId + '/cover', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ mode: 'upload', dataUrl }),
      });
      const j = await r.json();
      if (j && j.success) { setCurrent(j.data.coverImage); if (onSaved) onSaved(j.data.coverImage); setTip('已上传并应用。'); }
      else { setErr((j && j.error) || '上传失败'); setTip(''); }
    } catch (e: any) {
      setErr('上传失败：' + (e?.message || '网络错误')); setTip('');
    } finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  };

  if (!open) return null;

  const btn = 'px-3 py-2 rounded-xl text-xs font-medium transition-colors disabled:opacity-40';

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4" style={{ background: 'rgba(4,3,16,0.72)' }} onClick={onClose}>
      <div className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 p-5" style={{ background: 'linear-gradient(160deg, #171233 0%, #120e2b 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-white">🎨 AI 封面 <span className="text-gray-500 font-normal">{novelTitle ? '《' + novelTitle + '》' : ''}</span></h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
        </div>
        <p className="text-[11px] text-gray-500 mb-3">一键生成提示词和封面，也可以自己写提示词或直接上传封面。</p>

        {/* 预览 */}
        <div className="w-56 aspect-[3/4] mx-auto rounded-xl border border-white/10 overflow-hidden flex items-center justify-center mb-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
          {current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current} alt="封面" className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs text-gray-500">暂无封面，点击下方生成</span>
          )}
        </div>

        <button onClick={genPrompt} disabled={!!busy} className={btn + ' w-full mb-3 text-purple-200 border border-purple-500/30 hover:bg-purple-500/15'} style={{ background: 'rgba(124,58,237,0.10)' }}>
          {busy === 'prompt' ? '提炼中…' : '✨ 智能生成提示词'}
        </button>

        <p className="text-[11px] text-gray-400 mb-1.5">封面提示词</p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="留空则由系统按书名 / 题材 / 主角 / 简介自动拼一条提示词"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/60 resize-none mb-3"
        />

        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] text-gray-400">候选数量</span>
          <select value={count} onChange={(e) => setCount(parseInt(e.target.value, 10))}
            className="text-xs bg-white/5 border border-white/15 rounded-lg px-2 py-1 text-gray-300">
            {[1, 2, 3, 4].map((n) => (<option key={n} value={n}>{n} 张</option>))}
          </select>
          <span className="text-[10px] text-gray-600">封面按 768 × 1024 生成</span>
        </div>

        <div className="flex gap-2 mb-3">
          <button onClick={generate} disabled={!!busy} className={btn + ' flex-1 text-white bg-purple-600 hover:bg-purple-500'}>
            {busy === 'gen' ? '生成中…' : '🎨 生成封面'}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} className={btn + ' flex-1 text-gray-300 border border-white/15 hover:bg-white/5'}>
            {busy === 'upload' ? '上传中…' : '⬆ 本地上传封面'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPickFile(e.target.files?.[0] || undefined)} />
        </div>

        {candidates.length > 0 && (
          <div className="mb-3">
            <p className="text-[11px] text-gray-400 mb-1.5">封面候选（点击应用）</p>
            <div className="flex flex-wrap gap-2">
              {candidates.map((u) => (
                <button key={u} onClick={() => applyCandidate(u)}
                  className={'w-16 h-20 rounded-lg overflow-hidden border transition-colors ' + (u === current ? 'border-purple-400' : 'border-white/15 hover:border-purple-500/50')}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="候选封面" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

        {tip && <p className="text-[11px] text-emerald-400 mb-1">{tip}</p>}
        {err && <p className="text-[11px] text-red-400 mb-1">{err}</p>}
      </div>
    </div>
  );
}
