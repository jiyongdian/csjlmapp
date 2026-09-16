'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getToken } from '@/lib/get-token';

type StylePromptItem = {
  id: string;
  name: string;
  prompt: string;
  category: string;
  thumbnail: string | null;
  scope: 'system' | 'user';
  sortOrder: number;
  editable: boolean;
  isMine: boolean;
};

type CategoryBrief = { name: string; count: number };

type DraftForm = { name: string; prompt: string; category: string; thumbnail: string | null };

const ALL_CATEGORY = '__all__';
const FALLBACK_DEFAULT_CATEGORY = '风格';
const MAX_THUMB_SIDE = 200;

/** 缩略图统一压到 200px 以内再转 dataURL，避免把大图塞进数据库 */
function downscaleToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        const scale = Math.min(1, MAX_THUMB_SIDE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('浏览器不支持图片压缩'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 风格提示词库（风格设置弹窗的左栏）。
 * 库内按「分类」组织：内置的 14 条属于「风格」，新建时可以选已有分类，也可以直接输入新分类名。
 * 管理员保存的是「管理员级」（所有用户可用），会员保存的只有自己可用。
 */
export default function StylePromptLibrary({
  kind,
  onInsert,
}: {
  kind: string;
  onInsert: (payload: { name: string; prompt: string; thumbnail: string | null }) => void;
}) {
  const [items, setItems] = useState<StylePromptItem[]>([]);
  const [categories, setCategories] = useState<CategoryBrief[]>([]);
  const [defaultCategory, setDefaultCategory] = useState(FALLBACK_DEFAULT_CATEGORY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [flash, setFlash] = useState('');
  const [keyword, setKeyword] = useState('');
  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORY);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [canManageSystem, setCanManageSystem] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftForm>({ name: '', prompt: '', category: FALLBACK_DEFAULT_CATEGORY, thumbnail: null });
  const fileRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/short-dramas/style-prompts?kind=${encodeURIComponent(kind)}`, {
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error || '读取提示词库失败');
        setItems([]);
        setCategories([]);
        return;
      }
      setItems(json.data?.prompts || []);
      setCategories(json.data?.categories || []);
      setDefaultCategory(json.data?.defaultCategory || FALLBACK_DEFAULT_CATEGORY);
      setCanManageSystem(json.data?.canManageSystem === true);
    } catch (e: any) {
      setError(e?.message || '读取提示词库失败');
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  /** 当前选中的分类被删空了就回到「全部」 */
  useEffect(() => {
    if (activeCat !== ALL_CATEGORY && !categories.some((c) => c.name === activeCat)) setActiveCat(ALL_CATEGORY);
  }, [categories, activeCat]);

  const showFlash = (text: string) => {
    setFlash(text);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 3000);
  };

  /** 搜索 + 分类过滤 */
  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (activeCat !== ALL_CATEGORY && item.category !== activeCat) return false;
      if (!key) return true;
      return item.name.toLowerCase().includes(key) || item.prompt.toLowerCase().includes(key);
    });
  }, [items, keyword, activeCat]);

  /** 选「全部」时按分类分组展示；分类顺序沿用接口给的顺序 */
  const groups = useMemo(() => {
    if (activeCat !== ALL_CATEGORY) return [[activeCat, filtered]] as Array<[string, StylePromptItem[]]>;
    const map = new Map<string, StylePromptItem[]>();
    for (const item of filtered) {
      const list = map.get(item.category);
      if (list) list.push(item);
      else map.set(item.category, [item]);
    }
    const known = categories.map((c) => c.name).filter((n) => map.has(n));
    const rest = [...map.keys()].filter((n) => !known.includes(n));
    return [...known, ...rest].map((name) => [name, map.get(name) || []] as [string, StylePromptItem[]]);
  }, [filtered, categories, activeCat]);

  const openCreate = () => {
    setEditingId(null);
    setDraft({ name: '', prompt: '', category: activeCat === ALL_CATEGORY ? defaultCategory : activeCat, thumbnail: null });
    setFormOpen(true);
    setError('');
    setNotice('');
  };

  const openEdit = (item: StylePromptItem) => {
    setEditingId(item.id);
    setDraft({ name: item.name, prompt: item.prompt, category: item.category, thumbnail: item.thumbnail });
    setFormOpen(true);
    setError('');
    setNotice('');
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setDraft({ name: '', prompt: '', category: defaultCategory, thumbnail: null });
  };

  const handleThumb = async (file: File | null) => {
    if (!file) return;
    try {
      const dataUrl = await downscaleToDataUrl(file);
      setDraft((d) => ({ ...d, thumbnail: dataUrl }));
    } catch (e: any) {
      setError(e?.message || '缩略图处理失败');
    }
  };

  const submit = async () => {
    const name = draft.name.trim();
    const prompt = draft.prompt.trim();
    const category = draft.category.replace(/\s+/g, ' ').trim();
    if (!name) { setError('请填写风格名称'); return; }
    if (!prompt) { setError('请填写提示词内容'); return; }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/short-dramas/style-prompts', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify(editingId ? { id: editingId, name, prompt, category, thumbnail: draft.thumbnail } : { kind, name, prompt, category, thumbnail: draft.thumbnail }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) { setError(json?.error || '保存失败'); return; }
      setNotice(json.message || '已保存');
      const savedCategory = json.data?.item?.category;
      closeForm();
      await load();
      // 让刚保存的那条立刻可见
      if (savedCategory) setActiveCat(savedCategory);
    } catch (e: any) {
      setError(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: StylePromptItem) => {
    if (!confirm(`确认删除「${item.name}」？删除后不可恢复。`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/short-dramas/style-prompts?id=${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      const json = await res.json();
      if (!res.ok || !json?.success) { setError(json?.error || '删除失败'); return; }
      setNotice(json.message || '已删除');
      await load();
    } catch (e: any) {
      setError(e?.message || '删除失败');
    } finally {
      setSaving(false);
    }
  };

  const chipClass = (active: boolean) =>
    `rounded-full border px-2 py-0.5 text-[10px] transition-all ${
      active ? 'border-violet-500/50 bg-violet-500/15 text-violet-100' : 'border-white/10 bg-white/[0.04] text-gray-400 hover:text-white hover:border-white/25'
    }`;

  const renderCard = (item: StylePromptItem) => {
    const expanded = expandedId === item.id;
    return (
      <div
        key={item.id}
        className={`rounded-xl border p-2.5 transition-all ${
          item.scope === 'system'
            ? 'border-white/10 bg-white/[0.03] hover:border-violet-500/45 hover:bg-violet-500/[0.07]'
            : 'border-amber-500/25 bg-amber-500/[0.05] hover:border-amber-400/50'
        }`}
      >
        <div className="flex gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-white/15 bg-white/[0.04]">
            {item.thumbnail
              ? <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />
              : <span className="text-[10px] text-gray-600">无图</span>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-medium text-white" title={item.name}>{item.name}</span>
              <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] ${
                item.scope === 'system' ? 'border-sky-500/30 bg-sky-500/10 text-sky-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }`}>
                {item.scope === 'system' ? '官方' : '我的'}
              </span>
              <span className="ml-auto shrink-0 text-[9px] text-gray-600">{item.prompt.length} 字</span>
            </div>
            <button
              type="button"
              onClick={() => setExpandedId(expanded ? null : item.id)}
              title={expanded ? '收起' : '展开全文'}
              className={`mt-1 block w-full text-left text-[11px] leading-4 text-gray-400 transition-colors hover:text-gray-200 ${expanded ? '' : 'line-clamp-2'}`}
            >
              {item.prompt}
            </button>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onInsert({ name: item.name, prompt: item.prompt, thumbnail: item.thumbnail });
                  showFlash(`已插入「${item.name}」到右侧「前置提示词」`);
                }}
                className="rounded-lg bg-emerald-600/85 px-2.5 py-1 text-[11px] text-white transition-all hover:bg-emerald-500"
              >
                插入
              </button>
              <button
                type="button"
                onClick={() => setActiveCat(item.category)}
                title={`只看分类「${item.category}」`}
                className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-gray-400 transition-all hover:text-white hover:border-white/25"
              >
                {item.category}
              </button>
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : item.id)}
                className="text-[10px] text-gray-500 transition-colors hover:text-gray-300"
              >
                {expanded ? '收起 ⌃' : '展开全文 ⌄'}
              </button>
              {item.editable && (
                <div className="ml-auto flex items-center gap-2">
                  <button type="button" onClick={() => openEdit(item)} className="text-[10px] text-gray-500 transition-colors hover:text-violet-300">✏️ 编辑</button>
                  <button type="button" onClick={() => remove(item)} className="text-[10px] text-gray-500 transition-colors hover:text-red-300">🗑️ 删除</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-white/10 bg-white/[0.03]">
      {/* 标题栏 + 分类筛选 */}
      <div className="shrink-0 space-y-2 border-b border-white/10 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white">① 挑选提示词</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-gray-400">共 {items.length} 条</span>
          <button
            type="button"
            onClick={formOpen ? closeForm : openCreate}
            className="ml-auto rounded-lg border border-violet-500/40 px-2.5 py-1 text-[11px] text-violet-200 transition-all hover:bg-violet-500/15"
          >
            {formOpen ? '收起' : '+ 新建提示词'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setActiveCat(ALL_CATEGORY)} className={chipClass(activeCat === ALL_CATEGORY)}>
            全部 {items.length}
          </button>
          {categories.map((c) => (
            <button key={c.name} type="button" onClick={() => setActiveCat(c.name)} className={chipClass(activeCat === c.name)}>
              {c.name} {c.count}
            </button>
          ))}
        </div>
      </div>

      {/* 新建 / 编辑表单 */}
      {formOpen && (
        <div className="shrink-0 space-y-2 border-b border-violet-500/25 bg-violet-500/[0.06] px-3.5 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-medium text-violet-200">{editingId ? '编辑提示词' : '新建提示词'}</span>
            <span className="text-[10px] text-gray-500">{canManageSystem ? '保存后所有人可用' : '保存后仅自己可用'}</span>
          </div>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="提示词名称，如：三分法构图"
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white focus:border-violet-400 focus:outline-none"
          />
          <textarea
            rows={3}
            value={draft.prompt}
            onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
            placeholder="提示词内容，点「插入」时会追加到右侧的前置提示词…"
            className="w-full resize-none rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs leading-5 text-white focus:border-violet-400 focus:outline-none"
          />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[10px] text-gray-400">分类</span>
              <input
                type="text"
                value={draft.category}
                onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                placeholder={`点下面已有分类，或直接输入新分类名（如：构图、光影、镜头）`}
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white focus:border-violet-400 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pl-8">
              <span className="text-[10px] text-gray-600">已有：</span>
              {categories.length === 0 && <span className="text-[10px] text-gray-600">还没有分类</span>}
              {categories.map((c) => (
                <button key={c.name} type="button" onClick={() => setDraft((d) => ({ ...d, category: c.name }))} className={chipClass(draft.category.trim() === c.name)}>
                  {c.name}
                </button>
              ))}
              <span className="text-[10px] text-gray-600">· 输入新名字就是新建分类</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-white/15 bg-white/[0.04] hover:border-white/30"
              onClick={() => fileRef.current?.click()}
              title="上传缩略图（插入时会一并填进参考图片）"
            >
              {draft.thumbnail
                ? <img src={draft.thumbnail} alt="" className="h-full w-full object-cover" />
                : <span className="text-[9px] leading-tight text-gray-500">缩略图</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleThumb(e.target.files?.[0] || null)} />
            {draft.thumbnail && (
              <button type="button" onClick={() => setDraft((d) => ({ ...d, thumbnail: null }))} className="text-[10px] text-gray-400 transition-colors hover:text-red-300">
                移除缩略图
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={closeForm} className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-gray-400 transition-colors hover:text-white">取消</button>
              <button
                type="button"
                onClick={submit}
                disabled={saving}
                className="rounded-lg bg-violet-600 px-3.5 py-1.5 text-[11px] text-white transition-all hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? '保存中…' : editingId ? '保存修改' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 搜索 + 反馈 */}
      <div className="shrink-0 space-y-1.5 px-3.5 pt-2.5">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="🔍 搜提示词名称或内容…"
          className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white placeholder:text-gray-500 focus:border-violet-400 focus:outline-none"
        />
        {error && <p className="text-[11px] text-red-300">{error}</p>}
        {notice && <p className="text-[11px] text-emerald-300">{notice}</p>}
        {flash && <p className="text-[11px] text-sky-300">{flash}</p>}
      </div>

      {/* 列表（选「全部」时按分类分组） */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        {loading && <p className="py-8 text-center text-[11px] text-gray-500">加载中…</p>}
        {!loading && filtered.length === 0 && (
          <p className="py-8 text-center text-[11px] leading-5 text-gray-500">
            {items.length === 0
              ? '这个类型下还没有提示词，点右上角「+ 新建提示词」添加第一条。'
              : keyword.trim()
                ? '没有匹配的提示词，换个关键词试试。'
                : `分类「${activeCat}」下还没有提示词。`}
          </p>
        )}
        {!loading && filtered.length > 0 && groups.map(([cat, list]) => (
          <div key={cat} className="space-y-2">
            {activeCat === ALL_CATEGORY && (
              <div className="flex items-center gap-2 px-0.5">
                <span className="text-[10px] font-medium text-gray-300">{cat}</span>
                <span className="text-[10px] text-gray-600">{list.length}</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
            )}
            {list.map(renderCard)}
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-white/10 px-3.5 py-2 text-[10px] leading-4 text-gray-500">
        点「插入」把提示词追加到右侧「前置提示词」，缩略图自动填进「参考图片」的空位
      </div>
    </section>
  );
}
