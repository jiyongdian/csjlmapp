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

interface MemorySettings {
  historyRounds: number;
  compressionThreshold: number;
  compressionKeepRounds: number;
  compressionMaxChars: number;
  enableCompression: boolean;
  memoryL2Limit: number;
  memoryL1Limit: number;
  chapterMaxChars: number;
  scriptMaxChars: number;
  enableAutoMemory: boolean;
  autoMemoryChars: number;
  autoExtractEvery: number;
}

const DEFAULTS: MemorySettings = {
  historyRounds: 6,
  compressionThreshold: 20,
  compressionKeepRounds: 6,
  compressionMaxChars: 800,
  enableCompression: true,
  memoryL2Limit: 15,
  memoryL1Limit: 10,
  chapterMaxChars: 24000,
  scriptMaxChars: 20000,
  enableAutoMemory: true,
  autoMemoryChars: 3000,
  autoExtractEvery: 5,
};

interface FieldDef {
  key: keyof MemorySettings;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
}

const HISTORY_FIELDS: FieldDef[] = [
  { key: "historyRounds", label: "单次获取未压缩消息条数", hint: "每次生成带入模型的最近对话条数，0 = 不带入历史", min: 0, max: 50, step: 1 },
  { key: "compressionThreshold", label: "触发消息压缩条数", hint: "会话消息超过该条数时，把较早对话压缩成前情提要", min: 4, max: 200, step: 1 },
  { key: "compressionKeepRounds", label: "压缩时保留的最近条数", hint: "压缩时保留不参与摘要的最近消息条数", min: 2, max: 50, step: 1 },
  { key: "compressionMaxChars", label: "压缩最大字符", hint: "前情提要摘要的长度上限", min: 100, max: 8000, step: 50 },
];

const MEMORY_FIELDS: FieldDef[] = [
  { key: "memoryL2Limit", label: "章节上下文层（L2）注入条数", hint: "带入提示词的章节摘要/伏笔等条数", min: 0, max: 100, step: 1 },
  { key: "memoryL1Limit", label: "核心设定层（L1）注入条数", hint: "带入提示词的角色卡/世界观条数", min: 0, max: 100, step: 1 },
  { key: "chapterMaxChars", label: "章节正文最大字符", hint: "改写类任务带入的正文长度上限", min: 2000, max: 200000, step: 1000 },
  { key: "scriptMaxChars", label: "剧本改编最大字符", hint: "改编剧本时读取的章节正文长度上限", min: 2000, max: 200000, step: 1000 },
  { key: "autoMemoryChars", label: "章节记忆采样字符", hint: "自动沉淀章节摘要时读取的正文末尾长度", min: 500, max: 50000, step: 500 },
  { key: "autoExtractEvery", label: "每 N 章抽取设定", hint: "每多少章抽取一次角色卡/世界观设定", min: 1, max: 50, step: 1 },
];

export default function AgentMemorySection() {
  const [form, setForm] = useState<MemorySettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const authHeaders = useCallback(() => {
    return { Authorization: "Bearer " + (getToken() || ""), "Content-Type": "application/json" };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/system-settings", { headers: authHeaders() });
      const d = await res.json();
      const mem = d && d.success && d.data ? d.data.agentMemory : null;
      if (mem) setForm({ ...DEFAULTS, ...mem });
    } catch {
      setMessage("加载失败，请刷新重试");
    }
    setLoading(false);
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const setValue = (key: keyof MemorySettings, value: number | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/system-settings", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ agentMemory: form, __section: "memory" }),
      });
      const d = await res.json();
      setMessage(d && d.success ? "已保存，Agent 记忆参数立即生效" : (d && d.error) || "保存失败");
      if (d && d.success) window.dispatchEvent(new Event("settings-saved"));
    } catch {
      setMessage("保存失败");
    }
    setSaving(false);
  };

  const renderFields = (fields: FieldDef[]) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {fields.map((f) => (
        <div key={String(f.key)}>
          <label className="text-[11px] text-gray-400">{f.label}</label>
          <input
            type="number"
            min={f.min}
            max={f.max}
            step={f.step}
            value={Number(form[f.key])}
            onChange={(e) => setValue(f.key, Number(e.target.value))}
            className={inputCls + " mt-1"}
          />
          <p className="text-[11px] text-gray-500 mt-1">{f.hint}</p>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className={cardCls} style={cardStyle}>
        <h2 className="text-white font-bold">Agent 记忆配置</h2>
        <p className="text-xs text-gray-400 mt-1">
          控制 Agent 对话上下文、会话压缩与作品记忆的沉淀强度。默认值即当前推荐值，调整后立即生效。
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          <span className="px-2 py-0.5 rounded-md text-[11px] border border-violet-500/30 text-violet-300 bg-violet-500/10">
            下方两组参数分别控制「上下文与压缩」和「作品记忆」
          </span>
        </div>
      </div>

      <div className={cardCls} style={cardStyle}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-sm font-semibold text-white">上下文与压缩</div>
          <button
            onClick={() => setValue("enableCompression", !form.enableCompression)}
            className={
              "px-3 py-1.5 rounded-lg text-xs border transition-colors " +
              (form.enableCompression
                ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                : "border-white/10 text-gray-400 hover:bg-white/5")
            }
          >
            {form.enableCompression ? "✅ 会话压缩已启用" : "⛔ 会话压缩已关闭"}
          </button>
        </div>
        {renderFields(HISTORY_FIELDS)}
      </div>

      <div className={cardCls} style={cardStyle}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-sm font-semibold text-white">作品记忆</div>
          <button
            onClick={() => setValue("enableAutoMemory", !form.enableAutoMemory)}
            className={
              "px-3 py-1.5 rounded-lg text-xs border transition-colors " +
              (form.enableAutoMemory
                ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                : "border-white/10 text-gray-400 hover:bg-white/5")
            }
          >
            {form.enableAutoMemory ? "✅ 自动沉淀记忆已启用" : "⛔ 自动沉淀记忆已关闭"}
          </button>
        </div>
        {renderFields(MEMORY_FIELDS)}
      </div>

      <div className="sticky bottom-0 z-10">
        <div
          className="rounded-xl border border-white/10 px-3 py-2.5 flex flex-wrap items-center gap-3"
          style={{ background: "rgba(15,12,41,0.92)", backdropFilter: "blur(10px)" }}
        >
          <button onClick={save} disabled={saving || loading} className={btnPrimary}>
            {saving ? "保存中…" : "保存并生效"}
          </button>
          <button onClick={() => setForm(DEFAULTS)} className={btnGhost}>
            恢复推荐值
          </button>
          <button onClick={() => void load()} className={btnGhost}>
            重新加载
          </button>
          {message ? <span className="text-xs text-violet-300">{message}</span> : null}
          <span className="text-[11px] text-gray-500 ml-auto">
            当前：历史 {form.historyRounds} 条 · 压缩阈值 {form.compressionThreshold} 条 · 摘要上限 {form.compressionMaxChars} 字
          </span>
        </div>
      </div>
    </div>
  );
}
