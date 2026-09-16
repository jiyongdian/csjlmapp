'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ExtractKind = 'character' | 'scene' | 'item' | 'storyboard';

type LevelInfo = {
  id: string;
  name: string;
  template: string;
  isActive?: number;
  updatedAt?: string | null;
} | null;

type TemplateBrief = {
  id: string;
  name: string | null;
  template: string;
  isActive?: number;
  updatedAt?: string | null;
};

type TemplatePayload = {
  kind: ExtractKind;
  meta: { kind: ExtractKind; label: string; jsonKey: string; entityLabel: string; requiredVars: string[] };
  resolved: { template: string; name: string; source: 'drama' | 'user' | 'system'; id: string | null };
  levels: { system: LevelInfo; user: LevelInfo; drama: LevelInfo };
  /** 该层级下保存的全部模版（模版库） */
  library?: { user: TemplateBrief[]; drama: TemplateBrief[] };
  variables: Array<{ key: string; label: string; group: string; description: string }>;
  analysis: { used: string[]; unknown: string[]; missingRequired: string[]; ok: boolean };
  /** 管理员可直接编辑系统默认层（所有用户共用） */
  canEditSystem?: boolean;
};

type EditableLevel = 'system' | 'user' | 'drama';

const LEVEL_LABEL: Record<EditableLevel, string> = { system: '系统默认', user: '我的通用', drama: '仅本作品' };
const LEVEL_HINT: Record<EditableLevel, string> = {
  system: '只读基线，所有用户共用',
  user: '你账号下全部作品通用',
  drama: '只在当前作品生效，优先级最高',
};

/** 系统默认层提示：管理员可编辑，普通用户只读 */
const systemLevelHint = (canEditSystem: boolean) =>
  canEditSystem ? '系统级基线，所有用户共用，你是管理员可直接编辑' : LEVEL_HINT.system;

const KIND_TITLE: Record<ExtractKind, string> = {
  character: '角色提取模版',
  scene: '场景提取模版',
  item: '物品提取模版',
  storyboard: '分镜生成模版',
};

const KIND_ICON: Record<ExtractKind, string> = { character: '👤', scene: '🏔️', item: '🔑', storyboard: '🎬' };

const ACCENT: Record<ExtractKind, { text: string; soft: string; border: string; solid: string; focus: string }> = {
  character: { text: 'text-sky-300', soft: 'bg-sky-500/12', border: 'border-sky-500/35', solid: 'bg-sky-600 hover:bg-sky-500', focus: 'focus:border-sky-400' },
  scene: { text: 'text-teal-300', soft: 'bg-teal-500/12', border: 'border-teal-500/35', solid: 'bg-teal-600 hover:bg-teal-500', focus: 'focus:border-teal-400' },
  item: { text: 'text-orange-300', soft: 'bg-orange-500/12', border: 'border-orange-500/35', solid: 'bg-orange-600 hover:bg-orange-500', focus: 'focus:border-orange-400' },
  storyboard: { text: 'text-fuchsia-300', soft: 'bg-fuchsia-500/12', border: 'border-fuchsia-500/35', solid: 'bg-fuchsia-600 hover:bg-fuchsia-500', focus: 'focus:border-fuchsia-400' },
};

/**
 * 提取模版编辑弹窗。
 * 三层结构：系统默认 → 我的通用 → 仅本作品，层级越高优先级越高。
 * 保存时按当前所在层级写入；系统默认层仅管理员可直接改，普通用户只读（可「基于此模版编辑」）。
 * 支持模版导入/导出，以及用文字模型做 AI 辅助优化。
 */
export default function ExtractTemplateModal({
  open,
  kind,
  dramaId,
  dramaTitle,
  getToken,
  configId,
  onClose,
  onSaved,
  onGenerate,
  generating,
}: {
  open: boolean;
  kind: ExtractKind;
  dramaId: string;
  dramaTitle?: string;
  getToken: () => string;
  configId?: string | null;
  onClose: () => void;
  onSaved?: (info: any) => void;
  /** 分镜类别：点击后校验模版并回调，交给调用方去生成（先预览再应用） */
  onGenerate?: () => void;
  /** 生成中的 loading 态（由调用方控制） */
  generating?: boolean;
}) {
  const accent = ACCENT[kind] || ACCENT.character;
  const [payload, setPayload] = useState<TemplatePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [level, setLevel] = useState<EditableLevel>('system');
  const [draft, setDraft] = useState({ name: '', template: '' });
  /** 正在编辑的模版 id；null 表示「尚未保存的新模版」 */
  const [draftId, setDraftId] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [undoDraft, setUndoDraft] = useState<{ name: string; template: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canEditSystem = payload?.canEditSystem === true;
  /** 系统默认层对普通用户只读；管理员可直接编辑 */
  const readOnly = level === 'system' && !canEditSystem;

  const load = useCallback(async (preferredLevel?: EditableLevel) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/short-dramas/extract-templates?kind=${kind}&dramaId=${encodeURIComponent(dramaId)}`, {
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error || '读取提取模版失败');
        setPayload(null);
        return;
      }
      const data: TemplatePayload = json.data;
      setPayload(data);
      const effective: EditableLevel =
        data.resolved?.source === 'drama' ? 'drama' : data.resolved?.source === 'user' ? 'user' : 'system';
      // 保存/恢复后留在原层级，避免管理员改完系统层被自动跳到「我的通用」
      const next = preferredLevel || effective;
      setLevel(next);
      const stored = data.levels[next];
      const fallback = data.levels.system?.template || '';
      const list = (next === 'system' ? [] : data.library?.[next === 'drama' ? 'drama' : 'user']) || [];
      // 优先落在该层级「当前使用」的那条模版上
      const active = list.find((t) => t.isActive === 1) || null;
      setDraftId(next === 'system' ? null : active?.id || null);
      setDraft({ name: active?.name || stored?.name || LEVEL_LABEL[next], template: active?.template || stored?.template || fallback });
      setUndoDraft(null);
    } catch (e: any) {
      setError(e?.message || '读取提取模版失败');
    } finally {
      setLoading(false);
    }
  }, [dramaId, getToken, kind]);

  useEffect(() => {
    if (!open) { setShown(false); return; }
    const raf = requestAnimationFrame(() => setShown(true));
    setNotice('');
    setError('');
    setInstruction('');
    load();
    return () => cancelAnimationFrame(raf);
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const switchLevel = (next: EditableLevel) => {
    if (!payload || next === level) return;
    setLevel(next);
    setNotice('');
    setError('');
    setUndoDraft(null);
    const stored = payload.levels[next];
    const list = (next === 'system' ? [] : payload.library?.[next === 'drama' ? 'drama' : 'user']) || [];
    const active = list.find((t) => t.isActive === 1) || null;
    setDraftId(next === 'system' ? null : active?.id || null);
    setDraft({
      name: active?.name || stored?.name || LEVEL_LABEL[next],
      template: active?.template || stored?.template || payload.levels.system?.template || '',
    });
  };

  const copyFromSystem = () => {
    if (!payload) return;
    switchLevel('drama');
    setDraftId(null);
    setDraft({ name: LEVEL_LABEL.drama, template: payload.levels.system?.template || payload.resolved.template || '' });
    setNotice('已把系统默认模版复制到「仅本作品」，改动后点保存会新建一条模版。');
  };

  const analysis = useMemo(() => {
    const found = Array.from(draft.template.matchAll(/\{\{\s*([^{}:\s]+)(?::[^{}]*)?\s*\}\}/g)).map((m) => m[1]);
    const used = Array.from(new Set(found));
    const keys = new Set((payload?.variables || []).map((v) => v.key));
    const unknown = used.filter((k) => !keys.has(k));
    const missingRequired = (payload?.meta?.requiredVars || []).filter((k) => !used.includes(k));
    return { used, unknown, missingRequired, ok: unknown.length === 0 && missingRequired.length === 0 && draft.template.trim().length > 0 };
  }, [draft.template, payload]);

  const groupedVars = useMemo(() => {
    const order: string[] = [];
    const map: Record<string, TemplatePayload['variables']> = {};
    for (const v of payload?.variables || []) {
      if (!map[v.group]) { map[v.group] = []; order.push(v.group); }
      map[v.group].push(v);
    }
    return order.map((group) => ({ group, items: map[group] }));
  }, [payload]);

  const insertVariable = (key: string) => {
    if (readOnly) { setNotice('系统默认模版为只读，请先「基于此模版编辑」。'); return; }
    const token = '{{' + key + '}}';
    const el = textareaRef.current;
    if (!el) { setDraft((d) => ({ ...d, template: d.template + token })); return; }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    setDraft((d) => ({ ...d, template: next }));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  };

  const handleExport = () => {
    const data = {
      type: 'extract-template',
      version: 1,
      kind,
      name: draft.name,
      template: draft.template,
      requiredVars: payload?.meta?.requiredVars || [],
      allowedVars: (payload?.variables || []).map((v) => v.key),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `提取模版-${KIND_TITLE[kind]}-${(draft.name || '未命名').replace(/[\\/:*?"<>|]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice('已导出为 JSON 文件，可用于备份或分享给其他作品。');
  };

  const handleImportFile = async (file: File) => {
    setError('');
    setNotice('');
    if (readOnly) {
      setError('系统默认模版为只读，请先切到「我的通用」或「仅本作品」，或点「基于此模版编辑」后再导入。');
      return;
    }
    try {
      const text = await file.text();
      const trimmed = text.trim();
      let template = trimmed;
      let name = '';
      let importedKind = '';
      if (trimmed.startsWith('{')) {
        const obj = JSON.parse(trimmed);
        template = String(obj?.template ?? '');
        name = String(obj?.name ?? '');
        importedKind = String(obj?.kind ?? '');
      }
      if (!template.trim()) {
        setError('文件里没有找到可用的模版内容（需要 JSON 的 template 字段，或直接是纯文本模版）。');
        return;
      }
      const nextMeta = analyzeFor(template);
      if (nextMeta.missingRequired.length > 0) {
        setError(`导入的模版缺少必备变量：${nextMeta.missingRequired.map((v) => '{{' + v + '}}').join('、')}，请补齐后再保存。`);
      } else if (nextMeta.unknown.length > 0) {
        setError(`导入的模版含不支持的变量：${nextMeta.unknown.map((v) => '{{' + v + '}}').join('、')}，请修改后再保存。`);
      }
      setDraft((d) => ({ name: name || d.name, template }));
      setUndoDraft(null);
      if (importedKind && importedKind !== kind) {
        setNotice(`⚠ 该文件导出时的类型是「${importedKind}」，与当前「${kind}」不一致，请确认内容无误。`);
      } else if (nextMeta.missingRequired.length === 0 && nextMeta.unknown.length === 0) {
        setNotice('已导入到编辑器，检查无误后点保存生效。');
      }
    } catch (e: any) {
      setError('导入失败：' + (e?.message || '文件格式无法解析'));
    }
  };

  /** 校验任意模版文本（导入/AI 结果复用） */
  const analyzeFor = (template: string) => {
    const found = Array.from(String(template).matchAll(/\{\{\s*([^{}:\s]+)(?::[^{}]*)?\s*\}\}/g)).map((m) => m[1]);
    const used = Array.from(new Set(found));
    const keys = new Set((payload?.variables || []).map((v) => v.key));
    return {
      unknown: used.filter((k) => !keys.has(k)),
      missingRequired: (payload?.meta?.requiredVars || []).filter((k) => !used.includes(k)),
    };
  };

  const handleOptimize = async () => {
    if (readOnly) { setError('系统默认模版为只读，请先切到可编辑层级再优化。'); return; }
    setOptimizing(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/short-dramas/extract-templates/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ kind, template: draft.template, instruction, configId: configId || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error || 'AI 优化失败');
        return;
      }
      setUndoDraft({ ...draft });
      setDraft((d) => ({ ...d, template: json.data.template }));
      setNotice(`✨ AI 已生成优化版本（${json.data.before.length} → ${json.data.after.length} 字，模型 ${json.data.model}），请检查后保存。`);
    } catch (e: any) {
      setError(e?.message || 'AI 优化失败');
    } finally {
      setOptimizing(false);
    }
  };

  /** 当前层级的模版库（系统默认层是只读单条，不参与） */
  const levelLibrary: TemplateBrief[] =
    level === 'system' ? [] : payload?.library?.[level === 'drama' ? 'drama' : 'user'] || [];
  const selectedBrief = levelLibrary.find((t) => t.id === draftId) || null;

  /** 选中模版库里的一条并载入编辑器 */
  const selectTemplate = (id: string) => {
    const target = levelLibrary.find((t) => t.id === id);
    if (!target) return;
    setDraftId(id);
    setDraft({ name: target.name || LEVEL_LABEL[level], template: target.template });
    setUndoDraft(null);
    setError('');
    setNotice('');
  };

  /** 基于当前编辑器内容新建一条模版（先留在草稿状态，点保存才落库） */
  const createTemplate = () => {
    const base = draft.name || LEVEL_LABEL[level];
    setDraftId(null);
    setDraft({ name: `${base} 副本`, template: draft.template });
    setUndoDraft(null);
    setError('');
    setNotice('已基于当前内容新建一条模版，改好名字后点保存即可。');
  };

  /** 把当前编辑的模版设为该层级「当前使用」 */
  const activateTemplate = async () => {
    if (!draftId) { setNotice('这条模版还没保存，先点保存。'); return; }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/short-dramas/extract-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ action: 'activate', id: draftId }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) { setError(json?.error || '设为使用失败'); return; }
      setNotice(json.message || '已设为当前使用');
      await load(level);
      onSaved?.(json.data);
    } catch (e: any) {
      setError(e?.message || '设为使用失败');
    } finally {
      setSaving(false);
    }
  };

  /** 删除当前编辑的模版 */
  const deleteTemplate = async () => {
    if (!draftId) { setNotice('这条模版还没保存，没有可删除的内容。'); return; }
    if (!confirm(`确认删除模版「${draft.name || '未命名'}」？删除后不可恢复。`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/short-dramas/extract-templates?id=${encodeURIComponent(draftId)}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      const json = await res.json();
      if (!res.ok || !json?.success) { setError(json?.error || '删除失败'); return; }
      setNotice(json.message || '已删除');
      await load(level);
      onSaved?.(json.data);
    } catch (e: any) {
      setError(e?.message || '删除失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (readOnly) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/short-dramas/extract-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({
          kind,
          level,
          name: draft.name,
          template: draft.template,
          // 保存到系统默认时也要带上 dramaId，后端才能同时撤掉「仅本作品」的当前使用
          ...(level === 'user' ? {} : { dramaId }),
          // 有 id 就更新那一条；没有就新建一条（同层可存多条，互不覆盖）
          ...(draftId ? { templateId: draftId } : { createNew: true }),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error || '保存失败');
        return;
      }
      setNotice(json.message || '已保存');
      setUndoDraft(null);
      await load(level);
      onSaved?.(json.data);
    } catch (e: any) {
      setError(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (readOnly) return;
    const label = level === 'drama' ? '本作品模版' : level === 'system' ? '系统默认模版' : '我的通用模版';
    const tip =
      level === 'system'
        ? '确认把系统默认模版恢复为内置出厂内容？同时会取消你「我的通用 / 仅本作品」的当前使用，让系统默认真正生效。已保存的模版都会保留，可随时「设为当前使用」重新启用。'
        : `确认把${label}恢复为默认？该层级将不再使用自定义模版、回落到上一层。已保存的模版都会保留，可随时「设为当前使用」重新启用。`;
    if (!confirm(tip)) return;
    setResetting(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/short-dramas/extract-templates/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ kind, dramaId, level }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error || '恢复失败');
        return;
      }
      setNotice(json.message || '已恢复默认');
      await load(level);
      onSaved?.(json.data);
    } catch (e: any) {
      setError(e?.message || '恢复失败');
    } finally {
      setResetting(false);
    }
  };

  /** 校验通过后触发生成（仅供 storyboard 使用） */
  const handleGenerate = () => {
    if (kind !== 'storyboard' || !onGenerate) return;
    if (!analysis.ok) {
      const problems = [
        ...analysis.missingRequired.map((v) => '缺少 {{' + v + '}}'),
        ...analysis.unknown.map((v) => '未知变量 {{' + v + '}}'),
      ];
      setError('模版还没就绪：' + (problems.join('、') || '内容为空') + '，请先修正后再生成。');
      return;
    }
    setError('');
    setNotice('');
    onGenerate();
  };

  if (!open) return null;

  const activeStored = payload?.levels[level] || null;
  const effectiveSource = payload?.resolved?.source;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`bg-[#1a1040] border border-white/15 rounded-2xl w-full max-w-[1100px] max-h-[92vh] flex flex-col overflow-hidden transition-all duration-200 ${shown ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.98]'}`}
      >
        {/* 头部 */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-white/10">
          <div className="min-w-0">
            <h3 className="text-white font-bold text-base flex items-center gap-2">
              <span>{KIND_ICON[kind]}</span>
              <span>{KIND_TITLE[kind]}</span>
              {effectiveSource && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${accent.border} ${accent.soft} ${accent.text} font-medium`}>
                  当前生效：{LEVEL_LABEL[effectiveSource as EditableLevel]}
                </span>
              )}
            </h3>
            <p className="text-[11px] text-gray-400 mt-1">
              模版内用 <span className="text-gray-300 font-mono">{'{{变量}}'}</span> 占位，提取时自动替换成真实内容。
              {dramaTitle ? <span className="text-gray-500"> 当前作品：{dramaTitle}</span> : null}
            </p>
            {kind === 'storyboard' && (
              <p className="text-[11px] text-emerald-300/90 mt-1">
                可在此修改 / 自定义 / 新建分镜模版；点底部「✨ 生成视频分镜提示词」按当前生效模版把章节拆段生成（先预览再应用）。
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => fileRef.current?.click()}
              title="从 JSON 文件导入模版到编辑器"
              className="px-3 py-1.5 text-[11px] rounded-lg border border-white/15 text-gray-300 hover:text-white hover:bg-white/5 transition-all"
            >
              ⬆ 导入
            </button>
            <button
              onClick={handleExport}
              title="把编辑器里的模版导出为 JSON 文件"
              className="px-3 py-1.5 text-[11px] rounded-lg border border-white/15 text-gray-300 hover:text-white hover:bg-white/5 transition-all"
            >
              ⬇ 导出
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none px-1">✕</button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.txt,.md,application/json,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
              e.target.value = '';
            }}
          />
        </div>

        {/* 层级切换 */}
        <div className="px-6 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {(['system', 'user', 'drama'] as EditableLevel[]).map((lv) => {
                const active = level === lv;
                const hasRow = !!payload?.levels[lv];
                const isEffective = effectiveSource === lv;
                return (
                  <button
                    key={lv}
                    onClick={() => switchLevel(lv)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-all font-medium flex items-center gap-1.5 ${
                      active ? `${accent.solid} text-white shadow-sm` : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {LEVEL_LABEL[lv]}
                    {lv === 'system' && canEditSystem && <span className="text-[9px] opacity-80">可编辑</span>}
                    {hasRow && <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white/80' : 'bg-emerald-400/80'}`} />}
                    {isEffective && !hasRow && <span className="text-[9px] opacity-70">生效</span>}
                  </button>
                );
              })}
            </div>
            <span className="text-[11px] text-gray-500">
              {level === 'system' ? systemLevelHint(canEditSystem) : LEVEL_HINT[level]}
            </span>
            {level === 'system' && effectiveSource && effectiveSource !== 'system' && (
              <span className="text-[11px] text-amber-300/90">
                ⚠ 当前被「{LEVEL_LABEL[effectiveSource as EditableLevel]}」覆盖，提取用的还是那边；保存为系统默认或点「恢复默认模版」会自动取消上层覆盖
              </span>
            )}
            {!readOnly && level !== 'system' && (
              <div className="w-full mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-gray-500">该层级模版：</span>
                {levelLibrary.map((t) => {
                  const isEditing = t.id === draftId;
                  return (
                    <button
                      key={t.id}
                      onClick={() => selectTemplate(t.id)}
                      title={t.name || '未命名模版'}
                      className={`px-2.5 py-1 text-[11px] rounded-lg border transition-all flex items-center gap-1.5 ${
                        isEditing
                          ? `${accent.border} ${accent.soft} ${accent.text}`
                          : 'border-white/10 bg-white/[0.02] text-gray-400 hover:text-white hover:border-white/25'
                      }`}
                    >
                      <span className="max-w-[140px] truncate">{t.name || '未命名模版'}</span>
                      {t.isActive === 1 && <span className="text-[9px] px-1 rounded bg-emerald-500/20 text-emerald-300">使用中</span>}
                    </button>
                  );
                })}
                {draftId === null && (
                  <span className="px-2.5 py-1 text-[11px] rounded-lg border border-violet-400/40 bg-violet-500/10 text-violet-200">新模版（未保存）</span>
                )}
                <button
                  onClick={createTemplate}
                  className="px-2.5 py-1 text-[11px] rounded-lg border border-white/15 text-gray-300 hover:text-white hover:bg-white/5 transition-all"
                >
                  ＋ 新建模版
                </button>
                {draftId && (
                  <>
                    {selectedBrief?.isActive !== 1 && (
                      <button
                        onClick={activateTemplate}
                        disabled={saving || optimizing}
                        className="px-2.5 py-1 text-[11px] rounded-lg border border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 transition-all"
                      >
                        设为当前使用
                      </button>
                    )}
                    <button
                      onClick={deleteTemplate}
                      disabled={saving || optimizing}
                      className="px-2.5 py-1 text-[11px] rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition-all"
                    >
                      删除
                    </button>
                  </>
                )}
              </div>
            )}
            {readOnly && (
              <button
                onClick={copyFromSystem}
                className="ml-auto px-3 py-1.5 text-[11px] rounded-lg border border-white/15 text-gray-300 hover:text-white hover:bg-white/5 transition-all"
              >
                ⧉ 基于此模版编辑
              </button>
            )}
          </div>
        </div>

        {/* 主体 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && <div className="py-16 text-center text-xs text-gray-400">正在读取模版…</div>}

          {!loading && !payload && (
            <div className="py-16 text-center space-y-3">
              <p className="text-xs text-red-300">{error || '读取失败'}</p>
              <button onClick={() => load()} className="px-4 py-2 text-xs rounded-lg border border-white/15 text-gray-300 hover:text-white hover:bg-white/5">重新读取</button>
            </div>
          )}

          {!loading && payload && (
            <div className="flex flex-col lg:flex-row gap-5">
              {/* 编辑器 */}
              <div className="flex-1 min-w-0 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    disabled={readOnly}
                    placeholder="模版名称"
                    className={`flex-1 px-3 py-2 text-xs rounded-lg border border-white/15 bg-white/5 text-white placeholder-gray-500 focus:outline-none ${accent.focus} disabled:opacity-60`}
                  />
                  <span className="text-[11px] text-gray-500 shrink-0 tabular-nums">{draft.template.length} 字</span>
                </div>

                <textarea
                  ref={textareaRef}
                  value={draft.template}
                  onChange={(e) => setDraft((d) => ({ ...d, template: e.target.value }))}
                  readOnly={readOnly}
                  spellCheck={false}
                  className={`w-full h-[42vh] min-h-[260px] px-4 py-3 text-[11px] leading-relaxed font-mono rounded-xl border bg-black/40 text-gray-100 resize-none focus:outline-none custom-scrollbar ${
                    readOnly ? 'border-white/10 opacity-80' : `border-white/15 ${accent.focus}`
                  }`}
                />

                {/* 校验结果 */}
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`px-2 py-1 rounded-md border ${analysis.ok ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/35 bg-amber-500/10 text-amber-300'}`}>
                    {analysis.ok ? '✓ 模版可用' : '⚠ 需修正'}
                  </span>
                  <span className="px-2 py-1 rounded-md border border-white/10 bg-white/[0.03] text-gray-400">
                    已用变量 {analysis.used.length}
                  </span>
                  {undoDraft && (
                    <button
                      onClick={() => { setDraft(undoDraft); setUndoDraft(null); setNotice('已撤销上一次改动。'); }}
                      className="px-2 py-1 rounded-md border border-white/15 text-gray-300 hover:text-white hover:bg-white/5 transition-all"
                    >
                      ↩ 撤销上一步
                    </button>
                  )}
                  {analysis.missingRequired.length > 0 && (
                    <span className="px-2 py-1 rounded-md border border-red-500/35 bg-red-500/10 text-red-300">
                      缺少必备：{analysis.missingRequired.map((v) => '{{' + v + '}}').join('、')}
                    </span>
                  )}
                  {analysis.unknown.length > 0 && (
                    <span className="px-2 py-1 rounded-md border border-red-500/35 bg-red-500/10 text-red-300">
                      未知变量：{analysis.unknown.map((v) => '{{' + v + '}}').join('、')}
                    </span>
                  )}
                </div>

                {error && <p className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
                {notice && <p className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">{notice}</p>}
              </div>

              {/* 侧栏：可用变量 + AI 优化 */}
              <div className="lg:w-[300px] shrink-0 space-y-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 max-h-[34vh] overflow-y-auto custom-scrollbar">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-300">可用变量</span>
                    <span className="text-[10px] text-gray-500">点击插入</span>
                  </div>
                  <div className="space-y-3">
                    {groupedVars.map(({ group, items }) => (
                      <div key={group}>
                        <div className="text-[10px] text-gray-500 mb-1.5">{group}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {items.map((v) => {
                            const required = (payload?.meta?.requiredVars || []).includes(v.key);
                            const usedInDraft = analysis.used.includes(v.key);
                            return (
                              <button
                                key={v.key}
                                onClick={() => insertVariable(v.key)}
                                title={v.description}
                                className={`px-2 py-1 text-[10px] rounded-md border transition-all font-mono ${
                                  usedInDraft
                                    ? `${accent.border} ${accent.soft} ${accent.text}`
                                    : 'border-white/10 bg-white/[0.02] text-gray-400 hover:text-white hover:border-white/25'
                                }`}
                              >
                                {v.label}
                                {required && <span className="text-red-400 ml-0.5">*</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-500 leading-relaxed mt-3 pt-3 border-t border-white/10">
                    标 <span className="text-red-400">*</span> 为必备变量。带颜色的是当前模版已引用的变量。
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-gray-300">✨ AI 辅助优化</span>
                    <span className="text-[10px] text-gray-500 ml-auto">使用文字模型</span>
                  </div>
                  <textarea
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    rows={2}
                    disabled={readOnly || optimizing}
                    placeholder="想怎么改？（可留空，留空则按通用最佳实践优化）例如：加强防杜撰约束、把输出格式写得更严格"
                    className="w-full px-2.5 py-2 text-[11px] rounded-lg border border-white/15 bg-black/30 text-gray-100 placeholder-gray-500 resize-none focus:outline-none focus:border-white/30 disabled:opacity-60 custom-scrollbar"
                  />
                  <button
                    onClick={handleOptimize}
                    disabled={readOnly || optimizing || !draft.template.trim()}
                    className={`w-full mt-2 px-3 py-2 text-[11px] rounded-lg text-white disabled:opacity-50 transition-all ${accent.solid}`}
                  >
                    {optimizing ? 'AI 优化中…（约需 10–40 秒）' : '✨ 生成优化版本'}
                  </button>
                  <p className="text-[10px] text-gray-500 leading-relaxed mt-2">
                    只生成候选结果填回编辑器，不会直接保存；结果仍会做变量校验，不合规会拒绝。
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center gap-2 px-6 py-4 border-t border-white/10">
          <span className="text-[11px] text-gray-500">
            正在编辑：<span className="text-gray-300">{LEVEL_LABEL[level]}</span>
            {level !== 'system' && draft.name ? <span className="text-gray-400">{' · ' + draft.name}</span> : null}
            {level === 'system' && canEditSystem
              ? '（管理员 · 所有用户共用）'
              : draftId
                ? '（已保存）'
                : '（尚未保存）'}
          </span>
          <div className="ml-auto flex gap-2">
            {!readOnly && activeStored && (
              <button
                onClick={handleReset}
                disabled={resetting || saving || optimizing}
                className="px-4 py-2 text-xs rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition-all"
              >
                {resetting ? '恢复中…' : '恢复默认模版'}
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2 text-xs text-gray-400 hover:text-white border border-white/10 rounded-lg transition-colors">关闭</button>
            {!readOnly && (
              <button
                onClick={handleSave}
                disabled={saving || optimizing || !draft.template.trim()}
                className={`px-5 py-2 text-xs rounded-lg text-white disabled:opacity-50 transition-all ${accent.solid}`}
              >
                {saving
                  ? '保存中…'
                  : level === 'system'
                    ? '保存为系统默认（所有用户共用）'
                    : draftId
                      ? `保存到「${LEVEL_LABEL[level]}」`
                      : `新建并保存到「${LEVEL_LABEL[level]}」`}
              </button>
            )}
            {kind === 'storyboard' && onGenerate && (
              <button
                onClick={handleGenerate}
                disabled={generating || saving || optimizing || loading}
                title="按当前生效的分镜模版，把所选集章节正文拆段生成分镜提示词（先预览再应用）"
                className="px-6 py-2 text-xs font-semibold rounded-lg text-white bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 shadow-lg shadow-emerald-900/30"
              >
                {generating ? (
                  <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />生成中…</>
                ) : (
                  '✨ 生成视频分镜提示词'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
