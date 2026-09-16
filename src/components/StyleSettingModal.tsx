'use client';

import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import StylePromptLibrary from '@/components/StylePromptLibrary';

export type StyleType = 'character' | 'scene' | 'item' | 'image-storyboard' | 'video-storyboard';
export interface StyleConfig { prePrompt: string; postPrompt: string; referenceImages: string[] }

type AccentKey = 'violet' | 'emerald' | 'amber' | 'sky';
type Accent = { solid: string; text: string; soft: string; border: string; focus: string; dot: string };

/** 五种风格设置各自的强调色（Tailwind 需要字面量，不能拼字符串） */
const ACCENT: Record<AccentKey, Accent> = {
  violet: {
    solid: 'bg-violet-600 hover:bg-violet-500',
    text: 'text-violet-300',
    soft: 'bg-violet-500/10',
    border: 'border-violet-500/30',
    focus: 'focus:border-violet-400',
    dot: 'bg-violet-400',
  },
  emerald: {
    solid: 'bg-emerald-600 hover:bg-emerald-500',
    text: 'text-emerald-300',
    soft: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    focus: 'focus:border-emerald-400',
    dot: 'bg-emerald-400',
  },
  amber: {
    solid: 'bg-amber-600 hover:bg-amber-500',
    text: 'text-amber-300',
    soft: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    focus: 'focus:border-amber-400',
    dot: 'bg-amber-400',
  },
  sky: {
    solid: 'bg-sky-600 hover:bg-sky-500',
    text: 'text-sky-300',
    soft: 'bg-sky-500/10',
    border: 'border-sky-500/30',
    focus: 'focus:border-sky-400',
    dot: 'bg-sky-400',
  },
};

export const STYLE_META: Record<StyleType, { label: string; desc: string; scope: string; color: AccentKey; preHint: string; postHint: string }> = {
  character: {
    label: '角色风格设置',
    desc: '本作品所有角色生图都会带上这套风格',
    scope: '作用于：全部角色',
    color: 'violet',
    preHint: '拼在角色提示词最前面 · 风格主体',
    postHint: '拼在角色提示词最后面 · 质量词 / 负向约束',
  },
  scene: {
    label: '场景风格设置',
    desc: '本作品所有场景生图都会带上这套风格',
    scope: '作用于：全部场景',
    color: 'emerald',
    preHint: '拼在场景提示词最前面 · 风格主体',
    postHint: '拼在场景提示词最后面 · 质量词 / 负向约束',
  },
  item: {
    label: '物品风格设置',
    desc: '本作品所有物品生图都会带上这套风格',
    scope: '作用于：全部物品',
    color: 'amber',
    preHint: '拼在物品提示词最前面 · 风格主体',
    postHint: '拼在物品提示词最后面 · 质量词 / 负向约束',
  },
  'image-storyboard': {
    label: '图片分镜风格设置',
    desc: '自动拼到每个分镜的图片生图提示词上',
    scope: '作用于：全部图片分镜',
    color: 'sky',
    preHint: '拼在每个分镜图片提示词最前面',
    postHint: '拼在每个分镜图片提示词最后面',
  },
  'video-storyboard': {
    label: '视频分镜风格设置',
    desc: '自动拼到每个分镜的视频生图提示词上',
    scope: '作用于：全部视频分镜',
    color: 'violet',
    preHint: '拼在每个分镜视频提示词最前面',
    postHint: '拼在每个分镜视频提示词最后面',
  },
};

/**
 * 风格设置弹窗（角色 / 场景 / 物品 / 图片分镜 / 视频分镜共用）。
 *
 * 布局：左栏「① 挑选风格」= 提示词库；右栏「② 当前设置」= 前后置提示词 + 参考图片；
 * 底部操作栏常驻，改动需点「保存」才落库。
 */
export default function StyleSettingModal({
  type,
  style,
  onSave,
  onClose,
}: {
  type: StyleType;
  style: StyleConfig;
  onSave: (s: StyleConfig) => Promise<void>;
  onClose: () => void;
}) {
  const meta = STYLE_META[type];
  const accent = ACCENT[meta.color];
  const [form, setForm] = useState<StyleConfig>({
    prePrompt: style.prePrompt || '',
    postPrompt: style.postPrompt || '',
    referenceImages: [...(style.referenceImages || [])].slice(0, 4).concat(Array(4).fill('')).slice(0, 4),
  });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [insertNote, setInsertNote] = useState('');
  const fileRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  const filledRefCount = useMemo(() => form.referenceImages.filter(Boolean).length, [form.referenceImages]);

  const patch = (next: Partial<StyleConfig>) => {
    setForm((f) => ({ ...f, ...next }));
    setDirty(true);
  };

  const handleFile = (idx: number, file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const imgs = [...form.referenceImages] as string[];
      imgs[idx] = e.target?.result as string;
      patch({ referenceImages: imgs });
    };
    reader.readAsDataURL(file);
  };

  const removeImg = (idx: number) => {
    const imgs = [...form.referenceImages] as string[];
    imgs[idx] = '';
    patch({ referenceImages: imgs });
  };

  /** 把提示词库条目插进「前置提示词」，缩略图填进第一个空的参考图片位 */
  const insertStylePrompt = ({ name, prompt, thumbnail }: { name: string; prompt: string; thumbnail: string | null }) => {
    const current = (form.prePrompt || '').trim();
    const incoming = String(prompt || '').trim();
    const next = !current
      ? incoming
      : !incoming
        ? current
        : /[，,。.；;、\n]$/.test(current)
          ? current + incoming
          : current + '，' + incoming;
    const imgs = [...(form.referenceImages || [])];
    let thumbFilled = false;
    if (thumbnail) {
      const emptyIdx = imgs.findIndex((v) => !v);
      if (emptyIdx >= 0) {
        imgs[emptyIdx] = thumbnail;
        thumbFilled = true;
      }
    }
    patch({ prePrompt: next, referenceImages: imgs });
    setInsertNote(thumbFilled ? `已把「${name}」追加到前置提示词，缩略图已填进参考图片` : `已把「${name}」追加到前置提示词`);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(form);
      setDirty(false);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[92vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#1a1040] shadow-2xl">
        {/* 头部 */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-base font-bold text-white">
              <span className={`h-2 w-2 rounded-full ${accent.dot}`} />
              <span>{meta.label}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${accent.border} ${accent.soft} ${accent.text}`}>
                {meta.scope}
              </span>
            </h3>
            <p className="mt-1 text-[11px] text-gray-400">
              {meta.desc}　·　先从左栏挑风格点「插入」，再在右栏微调，最后点「保存」
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-lg leading-none text-gray-400 transition-colors hover:text-white">✕</button>
        </div>

        {/* 主体：左挑风格 / 右调设置 */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:overflow-hidden">
          <StylePromptLibrary kind={type} onInsert={insertStylePrompt} />

          <div className="min-h-0 space-y-5 lg:overflow-y-auto lg:pr-1">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs font-semibold text-white">② 前置提示词</span>
                <span className="text-[10px] text-gray-500">{meta.preHint}</span>
                <span className="ml-auto text-[10px] text-gray-500">{form.prePrompt.trim().length} 字</span>
              </div>
              <textarea
                rows={7}
                className={`w-full resize-none rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5 text-xs leading-5 text-white placeholder:text-gray-500 focus:outline-none ${accent.focus}`}
                placeholder="例：国漫 3D 风格，古风仙侠，飘逸衣袂，8K 超高清，精致建模…"
                value={form.prePrompt}
                onChange={(e) => patch({ prePrompt: e.target.value })}
              />
              {insertNote && <p className={`text-[10px] ${accent.text}`}>{insertNote}</p>}
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs font-semibold text-white">后置提示词</span>
                <span className="text-[10px] text-gray-500">{meta.postHint}</span>
                <span className="ml-auto text-[10px] text-gray-500">{form.postPrompt.trim().length} 字</span>
              </div>
              <textarea
                rows={3}
                className={`w-full resize-none rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5 text-xs leading-5 text-white placeholder:text-gray-500 focus:outline-none ${accent.focus}`}
                placeholder="例：杰作，最佳质量，8K 超高清，极致细节…"
                value={form.postPrompt}
                onChange={(e) => patch({ postPrompt: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs font-semibold text-white">参考图片</span>
                <span className="text-[10px] text-gray-500">最多 4 张，会被当作生图参考</span>
                <span className="ml-auto text-[10px] text-gray-500">{filledRefCount}/4</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[0, 1, 2, 3].map((idx) => (
                  <div
                    key={idx}
                    className="group relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-white/15 bg-white/[0.03] hover:border-white/30"
                    onClick={() => fileRefs[idx].current?.click()}
                  >
                    {form.referenceImages[idx] ? (
                      <>
                        <img src={form.referenceImages[idx]} alt="" className="h-full w-full object-cover" />
                        <button
                          onClick={(e) => { e.stopPropagation(); removeImg(idx); }}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <span className="text-[10px] text-gray-500">参考图{idx + 1}</span>
                    )}
                    <input ref={fileRefs[idx]} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(idx, e.target.files?.[0] || null)} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作栏（常驻） */}
        <div className="flex shrink-0 items-center gap-3 border-t border-white/10 px-6 py-3.5">
          <span className="text-[11px] text-gray-500">
            {dirty ? '有未保存的改动' : '改动需要点「保存」才会生效'}
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-xs text-gray-400 transition-colors hover:text-white">取消</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`rounded-lg px-5 py-2 text-xs text-white transition-all disabled:opacity-50 ${accent.solid}`}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
