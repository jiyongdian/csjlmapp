'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { getToken } from '@/lib/get-token';

export type StoryboardPreviewItem = {
  panelIndex: number;
  imagePrompt: string;
  videoPrompt: string;
  roleCandidates: string[];
  chapterText?: string;
};

/** AI 原始输出文本未给 panelIndex 时的兜底序号 */
function toPanelIndex(item: StoryboardPreviewItem, i: number) {
  return item.panelIndex || i + 1;
}

/**
 * 分镜生成结果预览弹窗。
 * 展示 AI 按「分镜生成模版」产出的一组分镜（图片提示词 + 视频提示词 + 角色候选），
 * 用户确认后点「应用到本集」才写库；可重新生成或取消。
 */
export default function StoryboardPreviewModal({
  dramaId,
  episodeId,
  chapterTitle,
  items,
  warnings,
  raw,
  applying,
  onApply,
  onRegenerate,
  onClose,
  onApplied,
}: {
  dramaId: string;
  episodeId: string;
  chapterTitle?: string;
  items: StoryboardPreviewItem[];
  warnings: string[];
  raw?: string;
  applying: boolean;
  onApply: () => void;
  onRegenerate: () => void;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [showRaw, setShowRaw] = useState(false);
  const [applying2, setApplying2] = useState(false);
  const [applyError, setApplyError] = useState('');

  const toggle = (i: number) => setExpanded((m) => ({ ...m, [i]: !m[i] }));

  const doApply = async () => {
    if (!confirm(`确认把 ${items.length} 个分镜应用到本集？将清除该集现有分镜后写入。`)) return;
    setApplying2(true);
    setApplyError('');
    try {
      const res = await fetch(`/api/short-dramas/${dramaId}/storyboard-from-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({
          episodeId,
          apply: true,
          generated: items.map((it) => ({
            panelIndex: toPanelIndex(it, items.indexOf(it)),
            imagePrompt: it.imagePrompt,
            videoPrompt: it.videoPrompt,
            chapterText: it.chapterText || '',
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setApplyError(json?.error || '应用失败');
        return;
      }
      alert(json.message || '已应用');
      onApplied();
    } catch (e: any) {
      setApplyError(e?.message || '应用失败');
    } finally {
      setApplying2(false);
    }
  };

  if (typeof document === 'undefined') return null;

  const total = items.length;
  const warnCount = warnings.length;

  return createPortal(
    <div className="fixed inset-0 z-[9200] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-[92vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#1a1040] shadow-2xl">
        {/* 头部 */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white">✨ 分镜生成预览{chapterTitle ? ` · ${chapterTitle}` : ''}</h3>
            <p className="mt-1 text-[11px] text-gray-400">
              AI 按「分镜生成模版」共生成 {total} 条分镜{warnCount > 0 ? `，其中 ${warnCount} 条可能不完整（已跳过）` : ''} · 确认后点「应用到本集」才写入，不会动现有分镜
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setShowRaw((v) => !v)}
              title="AI 原始输出（用于排查解析问题）"
              className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-gray-400 transition-colors hover:text-white"
            >
              {showRaw ? '收起原始输出' : 'AI 原始输出'}
            </button>
            <button onClick={onClose} className="text-lg leading-none text-gray-400 transition-colors hover:text-white">✕</button>
          </div>
        </div>

        {/* 原始输出（可折叠） */}
        {showRaw && raw && (
          <div className="shrink-0 max-h-[180px] overflow-y-auto border-b border-white/10 bg-black/30 px-5 py-3">
            <p className="mb-1.5 text-[10px] font-medium text-gray-500">AI 原始返回（勿手动改动）：</p>
            <pre className="whitespace-pre-wrap text-[10px] leading-4 text-gray-400">{raw.slice(0, 8000)}</pre>
          </div>
        )}

        {applyError && <p className="shrink-0 border-b border-red-500/20 bg-red-500/10 px-6 py-2 text-[11px] text-red-300">{applyError}</p>}

        {/* 列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-1 gap-3">
            {items.map((it, idx) => {
              const i = toPanelIndex(it, idx);
              const open = !!expanded[i];
              return (
                <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-xs font-bold text-white">#{i}</span>
                    <span className="text-xs font-medium text-white">分镜 {i}</span>
                    {it.roleCandidates.length > 0 && (
                      <span className="flex items-center gap-1">
                        {it.roleCandidates.slice(0, 6).map((r) => (
                          <span key={r} className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">@ {r}</span>
                        ))}
                        {it.roleCandidates.length > 6 && <span className="text-[10px] text-gray-500">+{it.roleCandidates.length - 6}</span>}
                      </span>
                    )}
                    {it.chapterText && (
                      <span className="ml-auto max-w-[40%] truncate text-[10px] text-gray-500" title={it.chapterText}>{it.chapterText.slice(0, 40)}…</span>
                    )}
                  </div>

                  <div className="mt-2.5 space-y-2">
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">图片提示词</span>
                        <span className="text-[10px] text-gray-500">{it.imagePrompt.length} 字</span>
                      </div>
                      <p className={`text-[11px] leading-5 text-gray-300 ${open ? '' : 'line-clamp-3'}`}>{it.imagePrompt}</p>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">视频提示词</span>
                        <span className="text-[10px] text-gray-500">{it.videoPrompt.length} 字{it.videoPrompt.length > 500 ? '（超长已截断）' : ''}</span>
                      </div>
                      <p className={`text-[11px] leading-5 text-gray-300 ${open ? '' : 'line-clamp-3'}`}>{it.videoPrompt}</p>
                    </div>
                  </div>

                  <button onClick={() => toggle(i)} className="mt-2 text-[10px] text-gray-500 transition-colors hover:text-violet-300">
                    {open ? '收起 ⌃' : '展开全文 ⌄'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* 底部操作 */}
        <div className="flex shrink-0 items-center gap-3 border-t border-white/10 px-6 py-3.5">
          <span className="text-[11px] text-gray-500">共 {total} 条分镜，应用后将替换本集现有分镜</span>
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-xs text-gray-400 transition-colors hover:text-white">取消</button>
            <button
              onClick={onRegenerate}
              disabled={applying || applying2}
              className="rounded-lg border border-violet-500/40 px-4 py-2 text-xs text-violet-300 transition-colors hover:bg-violet-500/10 disabled:opacity-50"
            >
              重新生成
            </button>
            <button
              onClick={doApply}
              disabled={applying || applying2 || total === 0}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-xs text-white transition-all hover:bg-emerald-500 disabled:opacity-50"
            >
              {applying2 ? '应用中…' : `应用到本集（写入 ${total} 条）`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}