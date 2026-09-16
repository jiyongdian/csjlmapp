'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface StageMeta {
  key: string;
  label: string;
  icon: string;
  desc: string;
  codes: string[];
}

interface Skill {
  id: string;
  name: string;
  description: string | null;
  category: string;
  systemPrompt: string | null;
  userPrompt: string | null;
  parameters: any;
  isDefault: number;
  isActive: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string | null;
  usageCount?: number;
  lastUsedAt?: string | null;
  versionCount?: number;
}

interface SkillVersion {
  id: string;
  skillId: string;
  version: number;
  systemPrompt: string | null;
  userPrompt: string | null;
  note: string | null;
  source: string;
  status: string;
  createdAt: string;
}

interface FormState {
  id: string | null;
  stage: string;
  name: string;
  description: string;
  systemPrompt: string;
  userPrompt: string;
  sortOrder: number;
  isActive: boolean;
  autoOptimize: boolean;
  optimizeThreshold: number;
}

const EMPTY_FORM: FormState = {
  id: null,
  stage: 'novel',
  name: '',
  description: '',
  systemPrompt: '',
  userPrompt: '',
  sortOrder: 0,
  isActive: true,
  autoOptimize: false,
  optimizeThreshold: 20,
};

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null;
  return token ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

function formatTime(value?: string | null): string {
  if (!value) return '—';
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return value;
  return new Date(t).toLocaleString('zh-CN', { hour12: false });
}

export default function AdminSkillsPage() {
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [stages, setStages] = useState<StageMeta[]>([]);
  const [activeStage, setActiveStage] = useState('novel');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [versionsOf, setVersionsOf] = useState<Skill | null>(null);
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [optimizeResult, setOptimizeResult] = useState<{ skill: Skill; insights: string[]; version: SkillVersion } | null>(null);
  const [preview, setPreview] = useState<{ code: string; prompt: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/skills', { headers: authHeaders(), cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '加载失败');
      setSkills(json.data.skills || []);
      setStages(json.data.stages || []);
      if (json.data.stages?.length) {
        setActiveStage((prev) => (json.data.stages.some((s: StageMeta) => s.key === prev) ? prev : json.data.stages[0].key));
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '加载技能失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeMeta = useMemo(() => stages.find((s) => s.key === activeStage) || null, [stages, activeStage]);
  const stageSkills = useMemo(() => skills.filter((s) => s.category === activeStage), [skills, activeStage]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, stage: activeStage, sortOrder: (stageSkills.length + 1) * 10 });
  };

  const openEdit = (skill: Skill) => {
    const params = skill.parameters || {};
    setForm({
      id: skill.id,
      stage: skill.category,
      name: skill.name,
      description: skill.description || '',
      systemPrompt: skill.systemPrompt || '',
      userPrompt: skill.userPrompt || '',
      sortOrder: skill.sortOrder ?? 0,
      isActive: skill.isActive === 1,
      autoOptimize: Boolean(params.autoOptimize),
      optimizeThreshold: Number(params.optimizeThreshold) || 20,
    });
  };

  const saveForm = async () => {
    if (!form) return;
    if (!form.name.trim() || !form.systemPrompt.trim()) {
      setMessage({ type: 'error', text: '技能名称与系统提示词不能为空。' });
      return;
    }
    setBusy(true);
    try {
      const parameters = { autoOptimize: form.autoOptimize, optimizeThreshold: form.optimizeThreshold };
      const body = {
        stage: form.stage,
        name: form.name.trim(),
        description: form.description.trim(),
        systemPrompt: form.systemPrompt,
        userPrompt: form.userPrompt,
        sortOrder: form.sortOrder,
        isActive: form.isActive,
        parameters,
      };
      const res = await fetch(form.id ? `/api/admin/skills/${form.id}` : '/api/admin/skills', {
        method: form.id ? 'PUT' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '保存失败');
      setForm(null);
      setMessage({ type: 'success', text: form.id ? '技能已更新并生成新版本。' : '技能已创建。' });
      await load();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '保存失败' });
    } finally {
      setBusy(false);
    }
  };

  const removeSkill = async (skill: Skill) => {
    if (!window.confirm(`确认删除技能「${skill.name}」？`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/skills/${skill.id}`, { method: 'DELETE', headers: authHeaders() });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '删除失败');
      setMessage({ type: 'success', text: '技能已删除。' });
      await load();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '删除失败' });
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (skill: Skill) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/skills/${skill.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ isActive: skill.isActive !== 1 }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '操作失败');
      await load();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '操作失败' });
    } finally {
      setBusy(false);
    }
  };

  const seed = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/skills/seed', { method: 'POST', headers: authHeaders() });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '初始化失败');
      setMessage({ type: 'success', text: `已初始化默认技能：新建 ${json.data.created} 个，已存在 ${json.data.skipped} 个。` });
      await load();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '初始化失败' });
    } finally {
      setBusy(false);
    }
  };

  const optimize = async (skill: Skill) => {
    setBusy(true);
    setOptimizeResult(null);
    try {
      const res = await fetch(`/api/admin/skills/${skill.id}/optimize`, { method: 'POST', headers: authHeaders() });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '优化失败');
      setOptimizeResult({ skill, insights: json.data.insights || [], version: json.data.version });
      await load();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '优化失败' });
    } finally {
      setBusy(false);
    }
  };

  const openVersions = async (skill: Skill) => {
    setVersionsOf(skill);
    setVersions([]);
    try {
      const res = await fetch(`/api/admin/skills/${skill.id}/versions`, { headers: authHeaders(), cache: 'no-store' });
      const json = await res.json();
      if (json.success) setVersions(json.data || []);
    } catch {
      /* ignore */
    }
  };

  const applyVersion = async (versionId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/skills/${versionsOf?.id}/versions`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ versionId }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '应用失败');
      setMessage({ type: 'success', text: '已应用该版本。' });
      setVersionsOf(null);
      setOptimizeResult(null);
      await load();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '应用失败' });
    } finally {
      setBusy(false);
    }
  };

  const loadPreview = async (code: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/skills/preview?code=' + encodeURIComponent(code), { headers: authHeaders(), cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '预览失败');
      setPreview({ code, prompt: json.data.prompt });
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '预览失败' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">🧠 Agent 技能与自动优化</h1>
          <p className="mt-1 text-xs text-gray-400">
            为「小说生成 / 剧本生成 / 图片提示词 / 视频提示词」四个 Agent 配置专属技能，注入到对应生成流程，并基于真实调用数据自动学习优化。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/admin/model-prompts" className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-200 transition-colors hover:bg-white/10">
            📝 提示词模板
          </a>
          <button onClick={seed} disabled={busy} className="rounded-lg border border-purple-500/40 bg-purple-600/20 px-3 py-1.5 text-xs text-purple-200 transition-colors hover:bg-purple-600/30 disabled:opacity-40">
            初始化默认技能
          </button>
          <button onClick={() => void load()} disabled={busy} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-200 transition-colors hover:bg-white/10 disabled:opacity-40">
            刷新
          </button>
        </div>
      </div>

      {message && (
        <div className={
          'rounded-lg border px-3 py-2 text-xs ' +
          (message.type === 'success'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-red-500/30 bg-red-500/10 text-red-300')
        }>
          {message.text}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {stages.map((stage) => (
          <button
            key={stage.key}
            onClick={() => setActiveStage(stage.key)}
            className={
              'rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors ' +
              (activeStage === stage.key
                ? 'border-violet-500/50 bg-violet-600/25 text-white'
                : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10')
            }
          >
            {stage.icon} {stage.label}
            <span className="ml-1.5 text-[10px] text-gray-400">{skills.filter((s) => s.category === stage.key).length}</span>
          </button>
        ))}
      </div>

      {activeMeta && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-[11px] text-gray-400">
          <div className="text-gray-300">{activeMeta.desc}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span>注入提示词点位：{activeMeta.codes.join('、')}</span>
            {activeMeta.codes[0] && (
              <button onClick={() => void loadPreview(activeMeta.codes[0])} disabled={busy} className="rounded border border-sky-500/40 bg-sky-600/20 px-2 py-0.5 text-[10px] text-sky-200 transition-colors hover:bg-sky-600/30 disabled:opacity-40">
                预览注入效果
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">共 {stageSkills.length} 个技能</span>
        <button onClick={openCreate} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-500">
          + 新建技能
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-xs text-gray-500">加载中…</div>
      ) : stageSkills.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-xs text-gray-500">
          该阶段还没有技能，点上方「初始化默认技能」或「+ 新建技能」。
        </div>
      ) : (
        <div className="space-y-3">
          {stageSkills.map((skill) => (
            <div key={skill.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{skill.name}</span>
                    {skill.isDefault === 1 && <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-300">默认</span>}
                    <span className={'rounded px-1.5 py-0.5 text-[10px] ' + (skill.isActive === 1 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-gray-400')}>
                      {skill.isActive === 1 ? '已启用' : '已停用'}
                    </span>
                    {skill.parameters?.autoOptimize && <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">自动优化</span>}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">{skill.description || '（暂无描述）'}</div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-500">
                    <span>调用次数 <span className="text-gray-300">{skill.usageCount ?? 0}</span></span>
                    <span>版本数 <span className="text-gray-300">{skill.versionCount ?? 0}</span></span>
                    <span>最近调用 {formatTime(skill.lastUsedAt)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button onClick={() => void optimize(skill)} disabled={busy} className="rounded-lg border border-sky-500/40 bg-sky-600/20 px-2.5 py-1.5 text-[11px] text-sky-200 transition-colors hover:bg-sky-600/30 disabled:opacity-40">
                    ⚡ 优化
                  </button>
                  <button onClick={() => void openVersions(skill)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-gray-200 transition-colors hover:bg-white/10">
                    版本
                  </button>
                  <button onClick={() => openEdit(skill)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-gray-200 transition-colors hover:bg-white/10">
                    编辑
                  </button>
                  <button onClick={() => void toggleActive(skill)} disabled={busy} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-gray-200 transition-colors hover:bg-white/10 disabled:opacity-40">
                    {skill.isActive === 1 ? '停用' : '启用'}
                  </button>
                  <button onClick={() => void removeSkill(skill)} disabled={busy} className="rounded-lg bg-red-500/20 px-2.5 py-1.5 text-[11px] text-red-300 transition-colors hover:bg-red-500/30 disabled:opacity-40">
                    删除
                  </button>
                </div>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] text-gray-400 hover:text-gray-200">查看系统提示词</summary>
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 text-[11px] leading-relaxed text-gray-300">
                  {skill.systemPrompt || '（空）'}
                </pre>
              </details>
            </div>
          ))}
        </div>
      )}

      {optimizeResult && (
        <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 p-4" onClick={() => setOptimizeResult(null)}>
          <div className="max-h-[86vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 p-5" style={{ background: 'rgba(15,12,41,0.97)' }} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">⚡ 优化结果 · {optimizeResult.skill.name}</h3>
              <button onClick={() => setOptimizeResult(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <ul className="mt-3 space-y-1 text-[11px] text-gray-300">
              {optimizeResult.insights.map((line) => <li key={line}>· {line}</li>)}
            </ul>
            <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-200">
              已生成新版本 v{optimizeResult.version.version}（草稿），应用后立即对生成流程生效。
            </div>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 text-[11px] leading-relaxed text-gray-200">
              {optimizeResult.version.systemPrompt}
            </pre>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setOptimizeResult(null)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10">关闭</button>
              <button onClick={() => void applyVersion(optimizeResult.version.id)} disabled={busy} className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">
                应用该版本
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 p-4" onClick={() => setPreview(null)}>
          <div className="max-h-[86vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 p-5" style={{ background: 'rgba(15,12,41,0.97)' }} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">🔎 注入预览 · {preview.code}</h3>
              <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <p className="mt-2 text-[11px] text-gray-400">下面是生成流程实际收到的系统提示词（数据库模板 + 已启用技能拼接结果）。</p>
            <pre className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 text-[11px] leading-relaxed text-gray-200">
              {preview.prompt || '（空）'}
            </pre>
          </div>
        </div>
      )}

      {versionsOf && (
        <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 p-4" onClick={() => setVersionsOf(null)}>
          <div className="max-h-[86vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 p-5" style={{ background: 'rgba(15,12,41,0.97)' }} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">🕘 版本历史 · {versionsOf.name}</h3>
              <button onClick={() => setVersionsOf(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            {versions.length === 0 ? (
              <div className="py-10 text-center text-xs text-gray-500">暂无版本记录</div>
            ) : (
              <div className="mt-3 space-y-3">
                {versions.map((version) => (
                  <div key={version.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-white">v{version.version}</span>
                        <span className={'rounded px-1.5 py-0.5 text-[10px] ' + (version.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-gray-400')}>
                          {version.status === 'active' ? '当前生效' : '历史'}
                        </span>
                        <span className="text-[10px] text-gray-500">{version.source === 'auto' ? '自动优化' : version.source === 'seed' ? '初始版本' : '手动'}</span>
                        <span className="text-[10px] text-gray-500">{formatTime(version.createdAt)}</span>
                      </div>
                      {version.status !== 'active' && (
                        <button onClick={() => void applyVersion(version.id)} disabled={busy} className="rounded-lg border border-emerald-500/40 bg-emerald-600/20 px-2.5 py-1 text-[11px] text-emerald-200 hover:bg-emerald-600/30 disabled:opacity-40">
                          应用此版本
                        </button>
                      )}
                    </div>
                    {version.note && <div className="mt-1 text-[11px] text-gray-400">{version.note}</div>}
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-2.5 text-[11px] leading-relaxed text-gray-300">
                      {version.systemPrompt || '（空）'}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 p-4" onClick={() => setForm(null)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 p-5" style={{ background: 'rgba(15,12,41,0.97)' }} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">{form.id ? '✏️ 编辑技能' : '✏️ 新建技能'}</h3>
              <button onClick={() => setForm(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] text-gray-400">技能名称</span>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-violet-400" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-gray-400">所属阶段</span>
                  <select value={form.stage} disabled={Boolean(form.id)} onChange={(e) => setForm({ ...form, stage: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-violet-400 disabled:opacity-60">
                    {stages.map((s) => <option key={s.key} value={s.key} className="bg-gray-800">{s.icon} {s.label}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-[11px] text-gray-400">描述</span>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-violet-400" />
              </label>
              <label className="block">
                <span className="text-[11px] text-gray-400">系统提示词（技能主体，会追加到该阶段所有提示词之后）</span>
                <textarea value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} rows={12} className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs leading-relaxed text-white outline-none focus:border-violet-400" />
              </label>
              <label className="block">
                <span className="text-[11px] text-gray-400">用户提示词（可选）</span>
                <textarea value={form.userPrompt} onChange={(e) => setForm({ ...form, userPrompt: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs leading-relaxed text-white outline-none focus:border-violet-400" />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="text-[11px] text-gray-400">排序</span>
                  <input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-violet-400" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-gray-400">自动优化阈值（调用次数）</span>
                  <input type="number" value={form.optimizeThreshold} onChange={(e) => setForm({ ...form, optimizeThreshold: Number(e.target.value) || 20 })} className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-violet-400" />
                </label>
                <div className="flex items-end gap-4 pb-1">
                  <label className="flex items-center gap-2 text-[11px] text-gray-300">
                    <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="accent-violet-500" /> 启用
                  </label>
                  <label className="flex items-center gap-2 text-[11px] text-gray-300">
                    <input type="checkbox" checked={form.autoOptimize} onChange={(e) => setForm({ ...form, autoOptimize: e.target.checked })} className="accent-sky-500" /> 自动优化
                  </label>
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setForm(null)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10">取消</button>
              <button onClick={() => void saveForm()} disabled={busy} className="rounded-lg bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
