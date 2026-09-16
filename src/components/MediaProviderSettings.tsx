"use client";

import { useCallback, useEffect, useState } from "react";
import { CustomSelect } from "@/components/custom-select";
import { getToken } from "@/lib/get-token";

type MediaType = "image" | "video" | "tts";

interface MediaCfg {
  id: string;
  name: string;
  provider: string;
  model: string;
  apiUrl: string;
  apiKey: string;
  modelType: string;
  isDefault: number;
  isActive: number;
  extraConfig?: string | null;
}

interface ProviderDef {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
}

interface SystemCfg {
  id: string;
  name: string;
  model: string;
  modelType: string;
}

const TABS: Array<{ key: MediaType; label: string; icon: string }> = [
  { key: "image", label: "图片生成", icon: "🖼️" },
  { key: "video", label: "视频生成", icon: "🎬" },
  { key: "tts", label: "TTS 语音合成", icon: "🔊" },
];

const EMPTY_FORM = {
  name: "",
  provider: "",
  model: "",
  apiKey: "",
  apiUrl: "",
  endpointPath: "",
  notes: "",
  isDefault: false,
};

function maskKey(key: string): string {
  if (!key) return "未设置";
  if (key.length <= 8) return "•".repeat(key.length);
  return key.slice(0, 8) + "•".repeat(key.length - 8);
}

function noteOf(c: MediaCfg): string {
  try {
    if (c.extraConfig) {
      const ec = JSON.parse(c.extraConfig);
      return ec.notes || "";
    }
  } catch {
    // 忽略解析失败
  }
  return "";
}

/**
 * 短剧制作 AI 提供商设置：图片 / 视频 / 配音均可自定义添加 API 配置。
 * 支持添加、编辑、删除、设为默认；数据存为用户级配置，管理员配置作为参考展示。
 */
export default function MediaProviderSettings() {
  const [mine, setMine] = useState<MediaCfg[]>([]);
  const [system, setSystem] = useState<SystemCfg[]>([]);
  const [providers, setProviders] = useState<Record<MediaType, ProviderDef[]>>({ image: [], video: [], tts: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formType, setFormType] = useState<MediaType>("image");
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    try {
      const res = await fetch("/api/media-configs/mine", {
        headers: { Authorization: "Bearer " + token },
        cache: "no-store",
      });
      const data = await res.json();
      if (data.success) {
        setMine(data.data.mine || []);
        setSystem(data.data.system || []);
        if (data.data.providers) setProviders(data.data.providers);
      }
    } catch {
      // 忽略网络错误
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = (type: MediaType, provider?: ProviderDef) => {
    const list = providers[type] || [];
    const p = provider || list[0];
    setEditId(null);
    setFormType(type);
    setForm({
      ...EMPTY_FORM,
      provider: p ? p.id : "",
      model: p && p.models.length ? p.models[0] : "",
      apiUrl: p ? p.baseUrl : "",
      name: p ? p.name : "",
    });
    setMsg(null);
    setShowForm(true);
  };

  const openEdit = (c: MediaCfg) => {
    let notes = "";
    let endpointPath = "";
    try {
      if (c.extraConfig) {
        const ec = JSON.parse(c.extraConfig);
        notes = ec.notes || "";
        endpointPath = ec.endpointPath || "";
      }
    } catch {
      // 忽略解析失败
    }
    setEditId(c.id);
    setFormType(c.modelType as MediaType);
    setForm({
      name: c.name,
      provider: c.provider,
      model: c.model,
      apiKey: c.apiKey || "",
      apiUrl: c.apiUrl || "",
      endpointPath,
      notes,
      isDefault: c.isDefault === 1,
    });
    setMsg(null);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name || !form.provider || !form.model || (!editId && !form.apiKey)) {
      setMsg({ ok: false, text: "名称、供应商、模型、API Key 为必填项" });
      return;
    }
    const token = getToken();
    if (!token) return;
    setSaving(true);
    try {
      const url = editId ? "/api/media-configs/mine/" + editId : "/api/media-configs/mine";
      const res = await fetch(url, {
        method: editId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ ...form, modelType: formType }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg({ ok: true, text: editId ? "配置已更新" : "配置已添加" });
        setShowForm(false);
        setEditId(null);
        await load();
      } else {
        setMsg({ ok: false, text: data.error || "保存失败" });
      }
    } catch {
      setMsg({ ok: false, text: "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: MediaCfg) => {
    if (!confirm("确认删除配置「" + c.name + "」？")) return;
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch("/api/media-configs/mine/" + c.id, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });
      const data = await res.json();
      setMsg({ ok: !!data.success, text: data.message || (data.success ? "已删除" : "删除失败") });
      if (data.success) await load();
    } catch {
      setMsg({ ok: false, text: "删除失败" });
    }
  };

  const setDefault = async (c: MediaCfg) => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch("/api/media-configs/mine/" + c.id + "/default", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      const data = await res.json();
      if (data.success) {
        setMsg({ ok: true, text: "已设为默认" });
        await load();
      } else {
        setMsg({ ok: false, text: data.error || "操作失败" });
      }
    } catch {
      setMsg({ ok: false, text: "操作失败" });
    }
  };

  const curList = providers[formType] || [];
  const curProvider = curList.find((p) => p.id === form.provider);
  const isCustomProvider = form.provider.indexOf("custom") === 0;
  const curTabLabel = (TABS.find((t) => t.key === formType) || TABS[0]).label;

  return (
    <div className="mt-10 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">🎥 短剧制作 AI 提供商</h2>
          <p className="text-xs text-gray-400 mt-1">
            图片、视频、配音均可自定义添加 API 配置；保存后可在短剧工作台中选择使用
          </p>
        </div>
        <button
          onClick={() => openCreate("image")}
          className="px-4 py-2 text-sm font-medium bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-xl hover:opacity-90 transition"
        >
          + 添加配置
        </button>
      </div>

      {msg && (
        <div className={"px-4 py-2 rounded-lg text-sm border " + (msg.ok ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400")}>
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-3 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* 添加 / 编辑表单 */}
      {showForm && (
        <div className="rounded-2xl border border-purple-500/30 bg-purple-500/5 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-purple-300">
              {editId ? "编辑配置" : "添加" + curTabLabel + "配置"}
            </h3>
            <button
              onClick={() => { setShowForm(false); setEditId(null); }}
              className="text-gray-400 hover:text-white text-sm"
            >✕</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-400 mb-1">配置名称 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="如：硅基流动 FLUX 高速图片生成"
                className="w-full text-sm bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/60"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">类型 *</label>
              <CustomSelect
                value={formType}
                disabled={!!editId}
                onChange={(v) => {
                  const t = v as MediaType;
                  const p = (providers[t] || [])[0];
                  setFormType(t);
                  setForm((f) => ({
                    ...f,
                    provider: p ? p.id : "",
                    model: p && p.models.length ? p.models[0] : "",
                    apiUrl: p ? p.baseUrl : "",
                  }));
                }}
                options={TABS.map((t) => ({ value: t.key, label: t.icon + " " + t.label }))}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">供应商 *</label>
              <CustomSelect
                value={form.provider}
                onChange={(v) => {
                  const p = curList.find((x) => x.id === v);
                  setForm((f) => ({
                    ...f,
                    provider: v,
                    apiUrl: p ? p.baseUrl : "",
                    model: p && p.models.length ? p.models[0] : "",
                  }));
                }}
                options={[{ value: "", label: "-- 选择供应商 --" }].concat(curList.map((p) => ({ value: p.id, label: p.name })))}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">模型 *</label>
              {curProvider && curProvider.models.length > 0 ? (
                <CustomSelect
                  value={form.model}
                  onChange={(v) => setForm((f) => ({ ...f, model: v }))}
                  options={curProvider.models.map((m) => ({ value: m, label: m }))}
                />
              ) : (
                <input
                  value={form.model}
                  onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  placeholder="输入模型名称"
                  className="w-full text-sm bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/60"
                />
              )}
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">API Key {!editId && "*"}</label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                placeholder={editId ? "留空则不修改" : "sk-..."}
                className="w-full text-sm bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/60"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-400 mb-1">API 地址</label>
              <input
                value={form.apiUrl}
                onChange={(e) => setForm((f) => ({ ...f, apiUrl: e.target.value }))}
                placeholder={(curProvider && curProvider.baseUrl) || "https://..."}
                className="w-full text-sm bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/60"
              />
            </div>

            {isCustomProvider && (
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-400 mb-1">
                  自定义接口路径 <span className="text-gray-600">（如 /v1/images/generations 或本地路径）</span>
                </label>
                <input
                  value={form.endpointPath}
                  onChange={(e) => setForm((f) => ({ ...f, endpointPath: e.target.value }))}
                  placeholder="留空则使用默认路径"
                  className="w-full text-sm bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/60"
                />
              </div>
            )}

            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-400 mb-1">备注说明</label>
              <input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="可选，如适用场景、限速说明"
                className="w-full text-sm bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/60"
              />
            </div>

            <div className="sm:col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                id="media-is-default"
                checked={form.isDefault}
                onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                className="w-4 h-4 accent-purple-500"
              />
              <label htmlFor="media-is-default" className="text-xs text-gray-300">设为此类型的默认配置</label>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="px-5 py-2 text-sm font-medium bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-xl hover:opacity-90 disabled:opacity-50 transition"
            >
              {saving ? "保存中…" : editId ? "更新" : "添加"}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditId(null); }}
              className="px-5 py-2 text-sm text-gray-300 bg-white/5 rounded-xl hover:bg-white/10 transition"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 三种类型 */}
      {loading ? (
        <div className="text-center text-gray-400 py-8 text-sm">加载中…</div>
      ) : (
        TABS.map((tab) => {
          const list = mine.filter((c) => c.modelType === tab.key);
          const sysList = system.filter((c) => c.modelType === tab.key);
          const catalog = providers[tab.key] || [];
          return (
            <div key={tab.key}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-sm font-semibold text-purple-300 flex items-center gap-2">{tab.icon} {tab.label}</h3>
                <button
                  onClick={() => openCreate(tab.key)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-white/15 text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                >
                  + 添加
                </button>
              </div>

              {/* 我的配置 */}
              {list.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-5 text-center text-xs text-gray-400">
                  还没有添加{tab.label}配置，点击右上角「+ 添加」或下方快捷卡片
                </div>
              ) : (
                <div className="space-y-2">
                  {list.map((c) => (
                    <div key={c.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-white">{c.name}</span>
                            {c.isDefault === 1 && (
                              <span className="px-2 py-0.5 text-[10px] rounded-full bg-green-500/20 text-green-300 border border-green-500/30">我的默认</span>
                            )}
                          </div>
                          <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-400">
                            <span>供应商：<span className="text-gray-300">{c.provider}</span></span>
                            <span>模型：<span className="text-gray-300">{c.model}</span></span>
                            <span className="truncate">API 地址：<span className="text-gray-300">{c.apiUrl || "(默认)"}</span></span>
                            <span className="truncate">
                              API Key：
                              <span className="text-gray-300 font-mono">{showKey[c.id] ? c.apiKey : maskKey(c.apiKey)}</span>
                              <button
                                onClick={() => setShowKey((s) => ({ ...s, [c.id]: !s[c.id] }))}
                                className="ml-1 text-gray-500 hover:text-gray-200"
                              >{showKey[c.id] ? "🙈" : "👁"}</button>
                            </span>
                            {noteOf(c) && <span className="sm:col-span-2 text-gray-500">备注：{noteOf(c)}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {c.isDefault !== 1 && (
                            <button
                              onClick={() => setDefault(c)}
                              className="px-2 py-1 text-[11px] rounded-lg border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors"
                            >设为默认</button>
                          )}
                          <button
                            onClick={() => openEdit(c)}
                            className="px-2 py-1 text-[11px] rounded-lg border border-white/15 text-gray-300 hover:bg-white/10 transition-colors"
                          >编辑</button>
                          <button
                            onClick={() => remove(c)}
                            className="px-2 py-1 text-[11px] rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                          >删除</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 快捷添加 */}
              <div className="mt-3">
                <div className="text-[11px] text-gray-500 mb-2">快捷添加（点击卡片会自动填入该提供商的默认信息）</div>
                <div className="grid md:grid-cols-4 gap-3">
                  {catalog.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => openCreate(tab.key, p)}
                      className="text-left bg-white/5 border border-white/10 hover:border-purple-500/40 hover:bg-purple-500/10 rounded-xl p-3 transition-colors"
                    >
                      <div className="text-xs font-bold text-white">{p.name}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5 break-all">
                        {p.models.length > 0 ? p.models.slice(0, 2).join(", ") : "自定义接口"}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 系统提供（参考） */}
              {sysList.length > 0 && (
                <div className="mt-3 text-[11px] text-gray-500">
                  系统已提供：{sysList.map((c) => c.name + "（" + c.model + "）").join("、")}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
