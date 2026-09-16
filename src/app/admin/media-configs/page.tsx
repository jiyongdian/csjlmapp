"use client";
import { useState, useEffect, useCallback } from "react";
import { CustomSelect } from "@/components/custom-select";
import { getToken } from "@/lib/get-token";
import { IMAGE_PROVIDERS, VIDEO_PROVIDERS, TTS_PROVIDERS } from "@/storage/database/shared/schema";

type MediaType = "image" | "video" | "tts";
type Cfg = {
  id: string; name: string; provider: string; model: string; apiKey: string;
  apiUrl: string; modelType: string; isDefault: number; isActive: number;
  extraConfig?: string | null; createdAt: string;
};

const EMPTY_FORM = { name: "", provider: "", model: "", apiKey: "", apiUrl: "", modelType: "image" as MediaType, isDefault: false, notes: "", endpointPath: "" };
const MEDIA_TABS: Array<{ key: MediaType; label: string; icon: string; emptyName: string }> = [
  { key: "image", label: "图片生成配置", icon: "🖼️", emptyName: "图片" },
  { key: "video", label: "视频生成配置", icon: "🎬", emptyName: "视频" },
  { key: "tts", label: "配音生成配置", icon: "🔊", emptyName: "配音" },
];

export default function AdminMediaConfigsPage() {
  const [tab, setTab] = useState<MediaType>("image");
  const [configs, setConfigs] = useState<Cfg[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string; imageUrl?: string; audioUrl?: string }>>({});

  const providers = (tab === "image"
    ? IMAGE_PROVIDERS
    : tab === "video"
      ? VIDEO_PROVIDERS
      : TTS_PROVIDERS) as unknown as { id: string; name: string; baseUrl: string; models: readonly string[] }[];

  const curFormProvider = providers.find(p => p.id === form.provider);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/media-configs?type=${tab}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) setConfigs(data.data.configs);
    } finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY_FORM, modelType: tab, provider: providers[0]?.id || "", model: providers[0]?.models?.[0] || "", apiUrl: providers[0]?.baseUrl || "", endpointPath: "" });
    setShowForm(true);
  };

  const openEdit = (c: Cfg) => {
    setEditId(c.id);
    let notes = "";
    let endpointPath = "";
    try {
      if (c.extraConfig) {
        const ec = JSON.parse(c.extraConfig);
        notes = ec.notes || "";
        endpointPath = ec.endpointPath || "";
      }
    } catch {}
    setForm({ name: c.name, provider: c.provider, model: c.model, apiKey: c.apiKey, apiUrl: c.apiUrl, modelType: c.modelType as MediaType, isDefault: c.isDefault === 1, notes, endpointPath });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.provider || !form.model || (!editId && !form.apiKey)) {
      setMsg({ text: "名称、供应商、模型、API Key 为必填项", ok: false }); return;
    }
    setSaving(true);
    try {
      const url = editId ? `/api/admin/media-configs/${editId}` : "/api/admin/media-configs";
      const method = editId ? "PUT" : "POST";
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ ...form, modelType: tab }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg({ text: editId ? "更新成功" : "创建成功", ok: true });
        setShowForm(false); setEditId(null);
        fetchConfigs();
      } else { setMsg({ text: data.error || "保存失败", ok: false }); }
    } finally { setSaving(false); }
  };

  const handleTest = async (c: Cfg) => {
    setTesting(s => ({ ...s, [c.id]: true }));
    setTestResult(s => ({ ...s, [c.id]: { ok: false, msg: "测试中…" } }));
    try {
      const res = await fetch(`/api/admin/media-configs/${c.id}/test`, {
        method: "POST", headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setTestResult(s => ({ ...s, [c.id]: { ok: !!data.success, msg: data.message || data.error || "未知结果", imageUrl: data.imageUrl, audioUrl: data.audioUrl } }));
    } catch (e: any) {
      setTestResult(s => ({ ...s, [c.id]: { ok: false, msg: e.message } }));
    } finally {
      setTesting(s => ({ ...s, [c.id]: false }));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确认删除配置「${name}」？`)) return;
    const res = await fetch(`/api/admin/media-configs/${id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await res.json();
    setMsg({ text: data.message, ok: data.success });
    if (data.success) fetchConfigs();
  };

  const handleToggleActive = async (c: Cfg) => {
    const res = await fetch(`/api/admin/media-configs/${c.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ isActive: c.isActive ? 0 : 1 }),
    });
    const data = await res.json();
    if (data.success) fetchConfigs();
  };

  const handleSetDefault = async (c: Cfg) => {
    const res = await fetch(`/api/admin/media-configs/${c.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ isDefault: 1 }),
    });
    const data = await res.json();
    if (data.success) fetchConfigs();
  };

  return (
    <div className="min-h-screen p-6" style={{ background: "linear-gradient(135deg,#0a0f1e 0%,#0d1528 60%,#0a0f1e 100%)" }}>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">媒体API配置管理</h1>
            <p className="text-sm text-gray-400 mt-1">管理系统公用的图片、视频和配音 API，供所有用户使用</p>
          </div>
          <button onClick={openCreate}
            className="px-4 py-2 text-sm font-medium bg-violet-600 text-white rounded-xl hover:bg-violet-500 transition-all">
            + 新建配置
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {MEDIA_TABS.map(({ key: t, label, icon }) => (
            <button key={t} onClick={() => { setTab(t); setShowForm(false); }}
              className={`px-5 py-2 text-sm rounded-xl font-medium transition-all ${tab === t ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:bg-white/10"}`}>
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Message */}
        {msg && (
          <div className={`px-4 py-2 rounded-lg text-sm border ${msg.ok ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400"}`}>
            {msg.text}
            <button onClick={() => setMsg(null)} className="ml-3 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Create / Edit Form */}
        {showForm && (
          <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-violet-300">{editId ? "编辑配置" : "新建配置"}</h2>
            <div className="grid grid-cols-2 gap-4">
              {/* 名称 */}
              <div className="col-span-2">
                <label className="text-xs text-gray-400 mb-1 block">配置名称 *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="如：SiliconFlow FLUX 高速图片生成"
                  className="w-full text-sm bg-white/8 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-600 focus:outline-none" />
              </div>
              {/* 供应商 */}
              <div>
                <label className="text-xs text-gray-400 mb-1 block">供应商 *</label>
                <CustomSelect
                  value={form.provider}
                  onChange={v => { const p = providers.find(x => x.id === v); setForm(f => ({ ...f, provider: v, apiUrl: p?.baseUrl || "", model: p?.models?.[0] || "" })); }}
                  options={[{ value: "", label: "-- 选择供应商 --" }, ...providers.map(p => ({ value: p.id, label: p.name }))]}
                />
              </div>
              {/* 模型 */}
              <div>
                <label className="text-xs text-gray-400 mb-1 block">模型 *</label>
                {(curFormProvider?.models?.length ?? 0) > 0 ? (
                  <CustomSelect
                    value={form.model}
                    onChange={v => setForm(f => ({ ...f, model: v }))}
                    options={(curFormProvider?.models || []).map(m => ({ value: m, label: m }))}
                  />
                ) : (
                  <input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                    placeholder="输入模型名称"
                    className="w-full text-sm bg-white/8 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-600 focus:outline-none" />
                )}
              </div>
              {/* API Key */}
              <div>
                <label className="text-xs text-gray-400 mb-1 block">API Key {!editId && <span className="text-red-400">*</span>}</label>
                <input type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                  placeholder={editId ? "留空则不修改" : "sk-..."}
                  className="w-full text-sm bg-white/8 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-600 focus:outline-none" />
              </div>
              {/* API URL */}
              <div>
                <label className="text-xs text-gray-400 mb-1 block">API URL <span className="text-gray-600">(可选，默认: {curFormProvider?.baseUrl})</span></label>
                <input value={form.apiUrl} onChange={e => setForm(f => ({ ...f, apiUrl: e.target.value }))}
                  placeholder={curFormProvider?.baseUrl || "https://..."}
                  className="w-full text-sm bg-white/8 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none" />
              </div>
              {/* 自定义 API 接口路径 (仅对自定义供应商显示) */}
              {(form.provider === "custom-video" || form.provider === "custom-image") && (
                <div className="col-span-2">
                  <label className="text-xs text-gray-400 mb-1 block">自定义 API 接口路径 <span className="text-gray-600">(例如: /v1/video/generations 或者是自定义本地路径如 /my-custom-path)</span></label>
                  <input value={form.endpointPath} onChange={e => setForm(f => ({ ...f, endpointPath: e.target.value }))}
                    placeholder="默认：视频使用 /video/generations, 图片使用 /images/generations"
                    className="w-full text-sm bg-white/8 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-600 focus:outline-none" />
                </div>
              )}
              {/* 备注 */}
              <div className="col-span-2">
                <label className="text-xs text-gray-400 mb-1 block">备注说明</label>
                <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="可选说明，如适用场景、限速等"
                  className="w-full text-sm bg-white/8 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-600 focus:outline-none" />
              </div>
              {/* 设为默认 */}
              <div className="col-span-2 flex items-center gap-2">
                <input type="checkbox" id="isDefault" checked={form.isDefault}
                  onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))}
                  className="w-4 h-4 rounded accent-violet-500" />
                <label htmlFor="isDefault" className="text-xs text-gray-300">设为此类型的默认配置</label>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-2 text-sm font-medium bg-violet-600 text-white rounded-xl hover:bg-violet-500 disabled:opacity-50 transition-all">
                {saving ? "保存中…" : editId ? "更新" : "创建"}
              </button>
              <button onClick={() => { setShowForm(false); setEditId(null); }}
                className="px-5 py-2 text-sm text-gray-400 bg-white/5 rounded-xl hover:bg-white/10 transition-all">
                取消
              </button>
            </div>
          </div>
        )}

        {/* Config List */}
        {loading ? (
          <div className="text-center py-16 text-gray-400">加载中…</div>
        ) : configs.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-white/8 bg-white/2">
            <div className="text-4xl mb-3">{MEDIA_TABS.find(t => t.key === tab)?.icon}</div>
            <p className="text-gray-400 text-sm">暂无{MEDIA_TABS.find(t => t.key === tab)?.emptyName}生成配置</p>
            <p className="text-gray-600 text-xs mt-1">点击右上角「新建配置」添加</p>
          </div>
        ) : (
          <div className="space-y-3">
            {configs.map(c => {
              let notes = "";
              try { notes = c.extraConfig ? JSON.parse(c.extraConfig).notes || "" : ""; } catch {}
              const keyVisible = showKey[c.id];
              return (
                <div key={c.id}
                  className={`rounded-2xl border p-4 transition-all ${c.isActive ? "border-white/10 bg-white/3" : "border-white/5 bg-white/1 opacity-50"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">{c.name}</span>
                        {c.isDefault === 1 && <span className="px-2 py-0.5 text-[10px] bg-violet-600/30 text-violet-300 rounded-full border border-violet-500/30">默认</span>}
                        {!c.isActive && <span className="px-2 py-0.5 text-[10px] bg-red-600/20 text-red-400 rounded-full border border-red-500/20">已禁用</span>}
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-400">
                        <span>供应商: <span className="text-gray-300">{c.provider}</span></span>
                        <span>模型: <span className="text-gray-300">{c.model}</span></span>
                        <span>API URL: <span className="text-gray-300 truncate">{c.apiUrl || "(默认)"}</span></span>
                        <span>
                          API Key:&nbsp;
                          <span className="text-gray-300 font-mono">
                            {keyVisible
                              ? c.apiKey
                              : c.apiKey ? `${c.apiKey.slice(0, 8)}${"•".repeat(Math.max(0, c.apiKey.length - 8))}` : "未设置"}
                          </span>
                          <button onClick={() => setShowKey(s => ({ ...s, [c.id]: !s[c.id] }))} className="ml-1 text-gray-600 hover:text-gray-300">{keyVisible ? "🙈" : "👁"}</button>
                        </span>
                        {notes && <span className="col-span-2 text-gray-500">备注: {notes}</span>}
                      </div>
                      {/* 测试结果 */}
                      {testResult[c.id] && (
                        <div className={`mt-3 flex items-start gap-2 text-xs rounded-xl px-3 py-2 border ${
                          testResult[c.id].ok
                            ? "border-green-500/25 bg-green-500/8 text-green-300"
                            : "border-red-500/25 bg-red-500/8 text-red-300"
                        }`}>
                          <span className="shrink-0 mt-0.5">{testResult[c.id].ok ? "✓" : "✗"}</span>
                          <span className="flex-1">{testResult[c.id].msg}</span>
                          {testResult[c.id].imageUrl && (
                            <img src={testResult[c.id].imageUrl} alt="test" className="w-16 h-16 object-cover rounded-lg border border-white/10 shrink-0" />
                          )}
                          {testResult[c.id].audioUrl && (
                            <audio src={testResult[c.id].audioUrl} controls className="h-7 max-w-48 shrink-0" />
                          )}
                          <button onClick={() => setTestResult(s => { const n = { ...s }; delete n[c.id]; return n; })} className="text-gray-600 hover:text-gray-300 shrink-0">✕</button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => handleTest(c)} disabled={testing[c.id]}
                        className="px-2 py-1 text-[11px] border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/10 disabled:opacity-50 transition-all">
                        {testing[c.id] ? "测试中…" : "🔗 测试"}
                      </button>
                      {c.isDefault !== 1 && c.isActive === 1 && (
                        <button onClick={() => handleSetDefault(c)}
                          className="px-2 py-1 text-[11px] border border-violet-500/30 text-violet-400 rounded-lg hover:bg-violet-500/10 transition-all">
                          设为默认
                        </button>
                      )}
                      <button onClick={() => handleToggleActive(c)}
                        className={`px-2 py-1 text-[11px] border rounded-lg transition-all ${c.isActive ? "border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10" : "border-green-500/30 text-green-400 hover:bg-green-500/10"}`}>
                        {c.isActive ? "禁用" : "启用"}
                      </button>
                      <button onClick={() => openEdit(c)}
                        className="px-2 py-1 text-[11px] border border-white/15 text-gray-300 rounded-lg hover:bg-white/10 transition-all">
                        编辑
                      </button>
                      <button onClick={() => handleDelete(c.id, c.name)}
                        className="px-2 py-1 text-[11px] border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/10 transition-all">
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
