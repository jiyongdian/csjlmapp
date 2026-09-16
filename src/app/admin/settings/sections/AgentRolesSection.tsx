"use client";

import { useCallback, useEffect, useState } from "react";
import { getToken } from "@/lib/get-token";

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-500/60";
const cardCls = "rounded-2xl border border-white/5 p-4";
const cardStyle = { background: "rgba(255,255,255,0.03)" };
const btnPrimary =
  "px-4 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 transition-all";
const btnGhost =
  "px-3 py-1.5 rounded-lg text-xs text-gray-300 border border-white/10 hover:bg-white/5 transition-colors";

interface RoleRow {
  id: string;
  name: string;
  description: string;
  configId: string;
  temperature: number | null;
  maxTokens: number | null;
  enabled: boolean;
}

interface AIConfig {
  id: string;
  name: string;
  provider: string;
  model: string;
  isDefault: boolean;
  isActive: boolean;
}

export default function AgentRolesSection() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [configs, setConfigs] = useState<AIConfig[]>([]);
  const [useRoleConfig, setUseRoleConfig] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [batchConfigId, setBatchConfigId] = useState("");

  const authHeaders = useCallback(() => {
    return { Authorization: "Bearer " + (getToken() || ""), "Content-Type": "application/json" };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [resSettings, resConfigs] = await Promise.all([
        fetch("/api/admin/system-settings", { headers: authHeaders() }),
        fetch("/api/admin/ai-configs", { headers: authHeaders() }),
      ]);
      const s = await resSettings.json();
      const c = await resConfigs.json();
      const rolesData = s && s.success && s.data ? s.data.agentRoles : null;
      if (rolesData) {
        setRoles(Array.isArray(rolesData.roles) ? rolesData.roles : []);
        setUseRoleConfig(rolesData.useRoleConfig !== false);
      }
      if (c && c.success && c.data) {
        setConfigs(Array.isArray(c.data.configs) ? c.data.configs : []);
      }
    } catch {
      setMessage("加载失败，请刷新重试");
    }
    setLoading(false);
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateRole = (id: string, patch: Partial<RoleRow>) => {
    setRoles((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const applyBatch = () => {
    setRoles((prev) => prev.map((r) => ({ ...r, configId: batchConfigId })));
    setMessage(batchConfigId ? "已批量填入，记得点保存" : "已批量清空为跟随系统默认，记得点保存");
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/system-settings", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ agentRoles: { useRoleConfig, roles }, __section: "agents" }),
      });
      const d = await res.json();
      setMessage(d && d.success ? "已保存，配置立即对所有生成链路生效" : (d && d.error) || "保存失败");
      if (d && d.success) window.dispatchEvent(new Event("settings-saved"));
    } catch {
      setMessage("保存失败");
    }
    setSaving(false);
  };

  const configLabel = (config: AIConfig) => {
    return config.name + " · " + config.model + (config.isDefault ? "（系统默认）" : "");
  };

  return (
    <div className="space-y-4">
      <div className={cardCls} style={cardStyle}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-white font-bold">Agent 配置</h2>
            <p className="text-xs text-gray-400 mt-1">
              为每个生成角色指定使用的模型服务与参数。留空 = 跟随系统默认配置 / 调用点默认值。
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="px-2 py-0.5 rounded-md text-[11px] border border-emerald-500/30 text-emerald-300 bg-emerald-500/10">
                10 个角色全部启用
              </span>
              <span className="px-2 py-0.5 rounded-md text-[11px] border border-white/10 text-gray-400">
                支持批量设置与逐项微调
              </span>
            </div>
          </div>
          <button
            onClick={() => setUseRoleConfig(!useRoleConfig)}
            className={
              "px-3 py-1.5 rounded-lg text-xs border transition-colors " +
              (useRoleConfig
                ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                : "border-white/10 text-gray-400 hover:bg-white/5")
            }
          >
            {useRoleConfig ? "✅ 按角色分配已启用" : "⛔ 按角色分配已关闭"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400">批量设置模型：</span>
          <select
            value={batchConfigId}
            onChange={(e) => setBatchConfigId(e.target.value)}
            className={inputCls + " max-w-xs"}
          >
            <option value="">跟随系统默认</option>
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {configLabel(c)}
              </option>
            ))}
          </select>
          <button onClick={applyBatch} className={btnGhost}>
            应用到全部角色
          </button>
        </div>
      </div>

      {loading ? (
        <div className={cardCls + " text-sm text-gray-400"} style={cardStyle}>
          加载中…
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {roles.map((role) => (
            <div key={role.id} className={cardCls} style={cardStyle}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-white text-sm font-semibold truncate">{role.name}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{role.description}</div>
                </div>
                <button
                  onClick={() => updateRole(role.id, { enabled: !role.enabled })}
                  className={
                    "shrink-0 px-2 py-1 rounded-md text-[11px] border transition-colors " +
                    (role.enabled
                      ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                      : "border-white/10 text-gray-500 hover:bg-white/5")
                  }
                >
                  {role.enabled ? "启用" : "停用"}
                </button>
              </div>

              <div className="mt-3 space-y-2">
                <div>
                  <label className="text-[11px] text-gray-400">模型服务</label>
                  <select
                    value={role.configId}
                    onChange={(e) => updateRole(role.id, { configId: e.target.value })}
                    className={inputCls + " mt-1"}
                  >
                    <option value="">跟随系统默认</option>
                    {configs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {configLabel(c)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-gray-400">温度（0-100）</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="跟随默认"
                      value={role.temperature === null ? "" : role.temperature}
                      onChange={(e) =>
                        updateRole(role.id, {
                          temperature: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      className={inputCls + " mt-1"}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-400">最大输出 Token</label>
                    <input
                      type="number"
                      min={256}
                      placeholder="跟随默认"
                      value={role.maxTokens === null ? "" : role.maxTokens}
                      onChange={(e) =>
                        updateRole(role.id, {
                          maxTokens: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      className={inputCls + " mt-1"}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="sticky bottom-0 z-10">
        <div
          className="rounded-xl border border-white/10 px-3 py-2.5 flex flex-wrap items-center gap-3"
          style={{ background: "rgba(15,12,41,0.92)", backdropFilter: "blur(10px)" }}
        >
          <button onClick={save} disabled={saving || loading} className={btnPrimary}>
            {saving ? "保存中…" : "保存并生效"}
          </button>
          <button onClick={() => void load()} className={btnGhost}>
            重新加载
          </button>
          {message ? <span className="text-xs text-violet-300">{message}</span> : null}
          <span className="text-[11px] text-gray-500 ml-auto">
            共 {roles.length} 个角色 · 已单独配置 {" "}
            {roles.filter((r) => r.configId || r.temperature !== null || r.maxTokens !== null).length} 个
          </span>
        </div>
      </div>
    </div>
  );
}
