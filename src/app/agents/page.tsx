"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  BookOpen,
  Clapperboard,
  FileText,
  Layers3,
  Mic2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { getToken } from "@/lib/get-token";
import SideDockNav from "@/components/SideDockNav";

type AgentTarget = {
  promptCode: string;
  area: string;
  label: string;
  href: string;
  accent: string;
  mode?: "always" | "contextual";
  modeLabel?: string;
};

type AgentSkill = {
  code: string;
  name: string;
  description: string;
  category: string;
  categoryLabel: string;
  relativePath: string;
  contentLength: number;
  area: string;
  targets: AgentTarget[];
};

type AgentModule = AgentTarget & {
  skillCount: number;
  contextualSkillCount?: number;
};

type AgentApiData = {
  skills: AgentSkill[];
  modules: AgentModule[];
  areas: { area: string; skillCount: number }[];
  totals: {
    skills: number;
    modules: number;
    linkedSkills: number;
    contextualSkills?: number;
    possibleLinkedSkills?: number;
  };
};

const accentClasses: Record<string, { border: string; bg: string; text: string; icon: string; button: string }> = {
  cyan: {
    border: "border-cyan-400/25",
    bg: "bg-cyan-400/10",
    text: "text-cyan-200",
    icon: "text-cyan-300 bg-cyan-400/10",
    button: "hover:border-cyan-300/50 hover:bg-cyan-400/10",
  },
  emerald: {
    border: "border-emerald-400/25",
    bg: "bg-emerald-400/10",
    text: "text-emerald-200",
    icon: "text-emerald-300 bg-emerald-400/10",
    button: "hover:border-emerald-300/50 hover:bg-emerald-400/10",
  },
  amber: {
    border: "border-amber-400/25",
    bg: "bg-amber-400/10",
    text: "text-amber-200",
    icon: "text-amber-300 bg-amber-400/10",
    button: "hover:border-amber-300/50 hover:bg-amber-400/10",
  },
  sky: {
    border: "border-sky-400/25",
    bg: "bg-sky-400/10",
    text: "text-sky-200",
    icon: "text-sky-300 bg-sky-400/10",
    button: "hover:border-sky-300/50 hover:bg-sky-400/10",
  },
  orange: {
    border: "border-orange-400/25",
    bg: "bg-orange-400/10",
    text: "text-orange-200",
    icon: "text-orange-300 bg-orange-400/10",
    button: "hover:border-orange-300/50 hover:bg-orange-400/10",
  },
  rose: {
    border: "border-rose-400/25",
    bg: "bg-rose-400/10",
    text: "text-rose-200",
    icon: "text-rose-300 bg-rose-400/10",
    button: "hover:border-rose-300/50 hover:bg-rose-400/10",
  },
  violet: {
    border: "border-violet-400/25",
    bg: "bg-violet-400/10",
    text: "text-violet-200",
    icon: "text-violet-300 bg-violet-400/10",
    button: "hover:border-violet-300/50 hover:bg-violet-400/10",
  },
  indigo: {
    border: "border-indigo-400/25",
    bg: "bg-indigo-400/10",
    text: "text-indigo-200",
    icon: "text-indigo-300 bg-indigo-400/10",
    button: "hover:border-indigo-300/50 hover:bg-indigo-400/10",
  },
  teal: {
    border: "border-teal-400/25",
    bg: "bg-teal-400/10",
    text: "text-teal-200",
    icon: "text-teal-300 bg-teal-400/10",
    button: "hover:border-teal-300/50 hover:bg-teal-400/10",
  },
};

const areaIconMap: Record<string, typeof BookOpen> = {
  小说: BookOpen,
  剧本: FileText,
  短剧: Clapperboard,
  配音: Mic2,
  通用: Sparkles,
};

function getAccent(accent?: string) {
  return accentClasses[accent || ""] || accentClasses.cyan;
}

function getStoredUserRole(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const user = JSON.parse(localStorage.getItem("user") || "null");
    if (user?.role) return user.role;
  } catch {}
  try {
    const authStorage = JSON.parse(localStorage.getItem("auth-storage") || "null");
    if (authStorage?.state?.user?.role) return authStorage.state.user.role;
  } catch {}
  return undefined;
}

export default function AgentsPage() {
  const router = useRouter();
  const [data, setData] = useState<AgentApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessChecked, setAccessChecked] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedArea, setSelectedArea] = useState("全部");

  const loadAgents = async () => {
    const token = getToken();
    if (!token) {
      router.push("/auth/login");
      return;
    }
    const storedRole = getStoredUserRole();
    if (storedRole && storedRole !== "admin") {
      setLoading(false);
      setAccessChecked(true);
      setError("仅管理员可以查看 Agent 工作台");
      router.replace("/novel-generator");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/agent-skills", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "获取 Agent 功能失败");
      }
      setData(result.data);
      setAccessChecked(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "获取 Agent 功能失败";
      setError(message);
      setAccessChecked(true);
      if (message.includes("仅管理员")) {
        router.replace("/novel-generator");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const areaTabs = useMemo(() => {
    if (!data) return [{ area: "全部", skillCount: 0 }];
    return [
      { area: "全部", skillCount: data.totals.skills },
      ...data.areas.sort((a, b) => b.skillCount - a.skillCount),
    ];
  }, [data]);

  const filteredSkills = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.skills.filter((skill) => {
      const areaMatched = selectedArea === "全部" || skill.area === selectedArea || skill.targets.some(target => target.area === selectedArea);
      if (!areaMatched) return false;
      if (!q) return true;
      const searchable = [
        skill.name,
        skill.description,
        skill.categoryLabel,
        skill.relativePath,
        skill.targets.map(target => `${target.area}${target.label}`).join(" "),
      ].join(" ").toLowerCase();
      return searchable.includes(q);
    });
  }, [data, search, selectedArea]);

  const visibleModules = useMemo(() => {
    if (!data) return [];
    return data.modules.filter(module => selectedArea === "全部" || module.area === selectedArea);
  }, [data, selectedArea]);

  const activeModuleCount = data?.modules.filter(module => module.skillCount > 0).length || 0;

  if (!accessChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#07111d_0%,#101827_48%,#151322_100%)] text-slate-100">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#07111d_0%,#101827_48%,#151322_100%)] text-slate-100">
      {/* 站点导航（左侧浮标） */}
      <SideDockNav title="导航" />
      {/* 品牌 / 会员中心 / API设置（左侧竖排浮动条） */}

      <main className="relative z-10 mx-auto max-w-7xl pl-16 pr-5 py-8">
        <div className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-400/10">
                <Bot className="h-6 w-6 text-cyan-200" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight text-white">前台Agent功能对应</h1>
                <p className="mt-1 text-sm text-slate-400">小说、剧本、短剧和配音生成流程已接入的 Agent 能力</p>
              </div>
            </div>
          </div>

          <div className="flex w-full items-center gap-2 lg:w-auto">
            <div className="relative w-full lg:w-96">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索Agent、模块或来源路径"
                className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.05] pl-9 pr-3 text-sm text-white outline-none transition-all placeholder:text-slate-500 focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/10"
              />
            </div>
            <button
              onClick={loadAgents}
              disabled={loading}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              刷新
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            <span>{error}</span>
            <button onClick={loadAgents} className="rounded-lg border border-rose-300/25 px-3 py-1.5 text-xs font-semibold hover:bg-rose-300/10">
              重试
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex h-72 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035]">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
          </div>
        ) : data ? (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                <div className="text-[11px] font-semibold text-slate-500">Agent技能</div>
                <div className="mt-2 text-3xl font-black text-white">{data.totals.skills}</div>
              </div>
              <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 p-4">
                <div className="text-[11px] font-semibold text-cyan-200/70">默认接入</div>
                <div className="mt-2 text-3xl font-black text-cyan-100">{data.totals.linkedSkills}<span className="text-sm font-semibold text-cyan-100/50">/{data.totals.skills}</span></div>
              </div>
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-4">
                <div className="text-[11px] font-semibold text-amber-200/70">前台模块</div>
                <div className="mt-2 text-3xl font-black text-amber-100">{activeModuleCount}<span className="text-sm font-semibold text-amber-100/50">/{data.totals.modules}</span></div>
              </div>
              <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4">
                <div className="text-[11px] font-semibold text-emerald-200/70">按题材触发</div>
                <div className="mt-2 text-3xl font-black text-emerald-100">{data.totals.contextualSkills || 0}</div>
              </div>
            </div>

            <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
              {areaTabs.map((tab) => {
                const active = selectedArea === tab.area;
                const Icon = areaIconMap[tab.area] || Layers3;
                return (
                  <button
                    key={tab.area}
                    onClick={() => setSelectedArea(tab.area)}
                    className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-all ${
                      active
                        ? "border-cyan-300/40 bg-cyan-300/12 text-cyan-100"
                        : "border-white/10 bg-white/[0.035] text-slate-400 hover:bg-white/[0.07] hover:text-white"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.area}
                    <span className={active ? "text-cyan-100/60" : "text-slate-500"}>{tab.skillCount}</span>
                  </button>
                );
              })}
            </div>

            <section className="mb-8">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-bold text-white">模块对应</h2>
                <span className="text-xs text-slate-500">{visibleModules.length} 个模块</span>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {visibleModules.map((module) => {
                  const accent = getAccent(module.accent);
                  const Icon = areaIconMap[module.area] || Layers3;
                  return (
                    <Link
                      key={module.promptCode}
                      href={module.href}
                      className={`group rounded-lg border border-white/10 bg-white/[0.04] p-4 transition-all ${accent.button}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent.icon}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${accent.border} ${accent.bg} ${accent.text}`}>
                          {module.skillCount} 个{module.contextualSkillCount ? ` +${module.contextualSkillCount}` : ''}
                        </span>
                      </div>
                      <div className="mt-4 text-[11px] font-semibold text-slate-500">{module.area}</div>
                      <div className="mt-1 font-bold text-white">{module.label}</div>
                      <div className="mt-2 truncate text-[11px] text-slate-500">{module.promptCode}</div>
                    </Link>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-bold text-white">Agent技能库</h2>
                <span className="text-xs text-slate-500">{filteredSkills.length} / {data.totals.skills}</span>
              </div>

              {filteredSkills.length === 0 ? (
                <div className="rounded-lg border border-white/10 bg-white/[0.035] px-5 py-14 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
                    <Search className="h-5 w-5 text-slate-500" />
                  </div>
                  <div className="font-semibold text-white">没有匹配的 Agent</div>
                  <button
                    onClick={() => { setSearch(""); setSelectedArea("全部"); }}
                    className="mt-4 rounded-lg border border-cyan-300/25 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-300/10"
                  >
                    清除筛选
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {filteredSkills.map((skill) => {
                    const firstTarget = skill.targets[0];
                    const accent = getAccent(firstTarget?.accent);
                    const Icon = areaIconMap[firstTarget?.area || skill.area] || Bot;
                    return (
                      <article key={skill.code} className={`rounded-lg border bg-white/[0.04] p-4 transition-all ${firstTarget ? accent.border : "border-white/10"}`}>
                        <div className="flex items-start gap-3">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${firstTarget ? accent.icon : "bg-white/[0.06] text-slate-300"}`}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="min-w-0 truncate text-sm font-bold text-white">{skill.name}</h3>
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                                {skill.categoryLabel}
                              </span>
                            </div>
                            <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">{skill.description}</p>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-1.5">
                          {skill.targets.length > 0 ? skill.targets.map((target) => {
                            const targetAccent = getAccent(target.accent);
                            return (
                              <Link
                                key={`${skill.code}-${target.promptCode}`}
                                href={target.href}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${targetAccent.border} ${targetAccent.bg} ${targetAccent.text} hover:bg-white/[0.08]`}
                              >
                                {target.area} · {target.label}{target.modeLabel ? ` · ${target.modeLabel}` : ''}
                              </Link>
                            );
                          }) : (
                            <span className="rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] font-semibold text-slate-500">待接入</span>
                          )}
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3 text-[11px] text-slate-500">
                          <span className="min-w-0 truncate">{skill.relativePath}</span>
                          <span className="shrink-0">{Math.ceil(skill.contentLength / 1000)}k 字符</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
