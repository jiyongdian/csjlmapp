"use client";

import { useCallback, useEffect, useState } from "react";
import { getToken } from "@/lib/get-token";
import SiteSection from "../system-settings/page";
import ModelsSection from "../api-settings/page";
import MediaApiSection from "../media-configs/page";
import ComfySection from "../comfyui-servers/page";
import PromptsSection from "../model-prompts/page";
import SkillsSection from "../skills/page";
import AgentRolesSection from "./sections/AgentRolesSection";
import AgentMemorySection from "./sections/AgentMemorySection";
import DatabaseSection from "./sections/DatabaseSection";
import FilesSection from "./sections/FilesSection";
import NavMenuSection from "./sections/NavMenuSection";

interface SectionItem {
  key: string;
  label: string;
  icon: string;
  desc: string;
  group: string;
}

interface SectionGroup {
  group: string;
  items: { key: string; label: string; icon: string; desc: string }[];
}

const GROUPS: SectionGroup[] = [
  {
    group: "站点与外观",
    items: [
      { key: "site", label: "站点设置", icon: "🎨", desc: "全站标题、文案、背景与媒体路径" },
      { key: "nav", label: "导航菜单", icon: "🧭", desc: "前台菜单的名称、地址与显示开关" },
    ],
  },
  {
    group: "AI 能力",
    items: [
      { key: "models", label: "模型服务", icon: "🔌", desc: "供应商、API Key、模型与默认配置" },
      { key: "media", label: "媒体 API", icon: "🖼️", desc: "生图 / 生视频 / 语音合成配置" },
      { key: "comfyui", label: "ComfyUI 服务", icon: "🧩", desc: "工作流服务地址与可用性测试" },
      { key: "agents", label: "Agent 配置", icon: "🎛️", desc: "按角色分配模型、温度与最大 Token" },
      { key: "prompts", label: "提示词管理", icon: "📝", desc: "全站提示词模板与增强" },
      { key: "skills", label: "Skills 技能管理", icon: "🧠", desc: "Agent 技能、自动学习与自动优化" },
      { key: "memory", label: "Agent 记忆配置", icon: "💾", desc: "上下文条数、会话压缩与记忆沉淀" },
    ],
  },
  {
    group: "系统运维",
    items: [
      { key: "database", label: "数据库操作", icon: "🗄️", desc: "概览、备份导出、恢复导入与清空" },
      { key: "files", label: "文件管理", icon: "📁", desc: "媒体目录浏览、上传、下载与删除" },
    ],
  },
];

const ALL_ITEMS: SectionItem[] = GROUPS.reduce((acc: SectionItem[], group) => {
  return acc.concat(
    group.items.map((item) => ({ ...item, group: group.group }))
  );
}, []);

const panelStyle = { background: "rgba(255,255,255,0.03)" };
const selectCls =
  "w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-gray-100 focus:outline-none focus:border-violet-500/60";

function formatSavedAt(iso: string): string {
  if (!iso) return "暂无记录";
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return "暂无记录";
  const pad = (n: number) => (n < 10 ? "0" + n : String(n));
  return (
    time.getFullYear() +
    "-" +
    pad(time.getMonth() + 1) +
    "-" +
    pad(time.getDate()) +
    " " +
    pad(time.getHours()) +
    ":" +
    pad(time.getMinutes())
  );
}

export default function AdminSettingsPage() {
  const [active, setActive] = useState("site");
  const current = ALL_ITEMS.find((item) => item.key === active) || ALL_ITEMS[0];
  const [savedAt, setSavedAt] = useState<Record<string, string>>({});

  const refreshSavedAt = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings-saved-at", {
        headers: { Authorization: "Bearer " + (getToken() || "") },
      });
      const d = await res.json();
      if (d && d.success && d.data && d.data.sections) {
        const map: Record<string, string> = {};
        for (const key of Object.keys(d.data.sections)) {
          const item = d.data.sections[key];
          if (item && item.at) map[key] = String(item.at);
        }
        setSavedAt(map);
      }
    } catch {
      // 忽略：拿不到时间不影响设置
    }
  }, []);

  useEffect(() => {
    void refreshSavedAt();
  }, [refreshSavedAt, active]);

  useEffect(() => {
    const onChanged = () => {
      void refreshSavedAt();
    };
    window.addEventListener("settings-saved", onChanged);
    window.addEventListener("focus", onChanged);
    const timer = window.setInterval(onChanged, 20000);
    return () => {
      window.removeEventListener("settings-saved", onChanged);
      window.removeEventListener("focus", onChanged);
      window.clearInterval(timer);
    };
  }, [refreshSavedAt]);

  const isOperationSection = active === "database" || active === "files";
  const savedLabel = isOperationSection ? "最后操作" : "最后保存";

  return (
    <div className="flex flex-col lg:flex-row gap-5">
      {/* 移动端：下拉切换（避免横向挤压） */}
      <div className="lg:hidden rounded-2xl border border-white/5 p-3" style={panelStyle}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">⚙️</span>
          <span className="text-sm font-bold text-white">系统配置</span>
          <span className="text-[11px] text-gray-500 ml-auto">{ALL_ITEMS.length} 项设置</span>
        </div>
        <select value={active} onChange={(e) => setActive(e.target.value)} className={selectCls}>
          {GROUPS.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.items.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.icon} {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* 桌面端：分组侧边栏 */}
      <aside
        className="hidden lg:flex lg:flex-col w-64 shrink-0 rounded-2xl border border-white/5 p-3 sticky top-6 max-h-[calc(100vh-7rem)] overflow-y-auto"
        style={panelStyle}
      >
        <div className="px-2 pb-3 mb-2 border-b border-white/5">
          <div className="text-sm font-bold text-white flex items-center gap-2">
            <span>⚙️</span>
            <span>系统配置</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
            共 {ALL_ITEMS.length} 项设置，改完点保存即生效
          </p>
        </div>

        <nav className="flex flex-col gap-1">
          {GROUPS.map((group) => (
            <div key={group.group} className="mt-2 first:mt-0">
              <div className="px-2 py-1 text-[11px] font-semibold text-gray-500 tracking-wide">
                {group.group}
              </div>
              {group.items.map((item) => {
                const isActive = item.key === active;
                return (
                  <button
                    key={item.key}
                    onClick={() => setActive(item.key)}
                    className={
                      "w-full flex items-start gap-2 px-2.5 py-2 rounded-xl text-left transition-all " +
                      (isActive
                        ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/20"
                        : "text-gray-300 hover:bg-white/5")
                    }
                  >
                    <span className="text-base leading-5 shrink-0">{item.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium leading-5 truncate">{item.label}</span>
                      <span
                        className={
                          "block text-[10px] leading-4 truncate " +
                          (isActive ? "text-white/70" : "text-gray-500")
                        }
                      >
                        {item.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* 右侧内容区 */}
      <section className="flex-1 min-w-0 space-y-4">
        <div className="rounded-2xl border border-white/5 p-4 flex items-start gap-3" style={panelStyle}>
          <span className="text-2xl leading-8 shrink-0">{current.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-gray-500">
              系统配置 <span className="mx-1 text-gray-600">/</span> {current.group}
            </div>
            <h1 className="text-white font-bold text-lg leading-tight">{current.label}</h1>
            <p className="text-xs text-gray-400 mt-1">{current.desc}</p>
          </div>
          <div className="shrink-0 text-right pl-2">
            <div className="text-[11px] text-gray-500">{savedLabel}</div>
            <div className="text-xs text-violet-300 whitespace-nowrap mt-0.5">
              {formatSavedAt(savedAt[active] || "")}
            </div>
          </div>
        </div>

        {active === "site" && <SiteSection />}
        {active === "models" && <ModelsSection />}
        {active === "media" && <MediaApiSection />}
        {active === "comfyui" && <ComfySection />}
        {active === "agents" && <AgentRolesSection />}
        {active === "prompts" && <PromptsSection />}
        {active === "skills" && <SkillsSection />}
        {active === "memory" && <AgentMemorySection />}
        {active === "database" && <DatabaseSection />}
        {active === "files" && <FilesSection />}
        {active === "nav" && <NavMenuSection />}
      </section>
    </div>
  );
}
