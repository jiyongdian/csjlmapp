"use client";
import SideDockNav from '@/components/SideDockNav';

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getToken as getAuthToken } from "@/lib/get-token";
import { getCategoryLabel } from "@/lib/category";
import { broadcastDataChange, onDataChange } from "@/lib/data-sync";

interface ShortDrama {
  id: string;
  novelId: string | null;
  scriptId: string | null;
  novelTitle: string | null;
  title: string;
  description: string | null;
  genre: string | null;
  totalEpisodes: number;
  currentEpisodes: number;
  status: string;
  style: string | null;
  platform: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function ShortDramasPage() {
  const router = useRouter();
  const [dramas, setDramas] = useState<ShortDrama[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isAdmin, setIsAdmin] = useState(false);

  const getToken = useCallback(() => getAuthToken(), []);

  useEffect(() => {
    try {
      const user = JSON.parse(localStorage.getItem("user") || "null");
      const authStorage = JSON.parse(localStorage.getItem("auth-storage") || "null");
      setIsAdmin(user?.role === "admin" || authStorage?.state?.user?.role === "admin");
    } catch {
      setIsAdmin(false);
    }
  }, []);

  const fetchDramas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = getAuthToken();
      if (!token) {
        router.push("/auth/login");
        return;
      }
      const res = await fetch("/api/short-dramas", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "获取短剧列表失败");
      }
      setDramas(data.data.dramas || []);
    } catch (e: unknown) {
      console.error(e);
      setError(e instanceof Error ? e.message : "获取短剧列表失败");
    }
    finally { setLoading(false); }
  }, [router]);

  const handleSync = async () => {
    setSyncing(true); setSyncMsg(null);
    try {
      const token = getAuthToken();
      if (!token) {
        router.push("/auth/login");
        return;
      }
      const res = await fetch("/api/short-dramas/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        const d = data.data;
        let msg = `同步完成！共${d.totalNovels}部小说，新建${d.created}部短剧${d.existed > 0 ? `，已有${d.existed}部` : ''}${d.failed > 0 ? `，失败${d.failed}` : ''}`;
        if (d.errors?.length > 0) msg += `\n错误详情: ${d.errors.join('; ')}`;
        setSyncMsg(msg);
        // 无论是否有新建都刷新列表
        fetchDramas();
      } else {
        setSyncMsg(`同步失败: ${data.error || '未知错误'}`);
      }
    } catch (e: unknown) {
      console.error('同步失败:', e);
      setSyncMsg(`同步出错: ${e instanceof Error ? e.message : '网络错误'}`);
    }
    finally { setSyncing(false); }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDramas();
  }, [fetchDramas]);

  useEffect(() => {
    const cleanup = onDataChange((e) => {
      if (e.type === 'short-drama' || e.type === 'novel') fetchDramas();
    });
    return cleanup;
  }, [fetchDramas]);

  // 页面加载自动同步一次
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!syncedRef.current) {
      syncedRef.current = true;
      handleSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = async (drama: ShortDrama) => {
    if (!confirm(`确定要删除《${drama.title}》吗？`)) return;
    try {
      const res = await fetch(`/api/short-dramas/${drama.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "删除失败");
      }
      broadcastDataChange({ type: 'short-drama', action: 'delete', id: drama.id });
      setSyncMsg(`已删除《${drama.title}》`);
      fetchDramas();
    } catch (e: unknown) {
      console.error(e);
      setSyncMsg(`删除失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  const statusMap: Record<string, { label: string; color: string }> = {
    draft: { label: "草稿", color: "bg-gray-500/20 text-gray-400" },
    generating: { label: "生成中", color: "bg-blue-500/20 text-blue-400" },
    completed: { label: "已完成", color: "bg-green-500/20 text-green-400" },
    published: { label: "已发布", color: "bg-emerald-500/20 text-emerald-400" },
    failed: { label: "失败", color: "bg-red-500/20 text-red-400" },
  };

  const statusOptions = [
    { value: "all", label: "全部状态" },
    { value: "draft", label: "草稿" },
    { value: "generating", label: "生成中" },
    { value: "completed", label: "已完成" },
    { value: "published", label: "已发布" },
    { value: "failed", label: "失败" },
  ];

  const filteredDramas = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return dramas.filter((drama) => {
      const matchesStatus = statusFilter === "all" || drama.status === statusFilter;
      const searchable = [
        drama.title,
        drama.novelTitle,
        drama.description,
        drama.genre ? getCategoryLabel(drama.genre) : "",
        drama.platform,
        drama.style,
      ].filter(Boolean).join(" ").toLowerCase();
      return matchesStatus && (!q || searchable.includes(q));
    });
  }, [dramas, searchQuery, statusFilter]);

  const stats = useMemo(() => {
    const totalEpisodes = dramas.reduce((sum, drama) => sum + (drama.totalEpisodes || 0), 0);
    const generatedEpisodes = dramas.reduce((sum, drama) => sum + (drama.currentEpisodes || 0), 0);
    return {
      total: dramas.length,
      completed: dramas.filter((drama) => drama.status === "completed" || drama.status === "published").length,
      generating: dramas.filter((drama) => drama.status === "generating").length,
      linkedScripts: dramas.filter((drama) => drama.scriptId).length,
      totalEpisodes,
      generatedEpisodes,
    };
  }, [dramas]);

  const hasActiveFilters = searchQuery.trim().length > 0 || statusFilter !== "all";
  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
  };

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0f0c29 0%, #1a1040 40%, #0d1b2a 100%)' }}>
      {/* 背景装饰 */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-600/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-pink-600/8 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-0 w-64 h-64 bg-purple-600/6 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      {/* 站点导航（左侧浮标） */}
          <SideDockNav title="导航" />
      {/* 品牌 / 会员中心 / API设置（左侧竖排浮动条） */}

      <main className="relative z-10 max-w-7xl mx-auto pl-16 pr-6 py-10">
        {/* 页面标题区 */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/30 to-pink-500/30 border border-violet-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-white tracking-tight">我的短剧</h1>
            </div>
            <p className="text-gray-500 text-sm ml-1">
              {hasActiveFilters ? `筛选到 ${filteredDramas.length} / ${dramas.length} 部短剧` : `共 ${dramas.length} 部短剧`} · 智能驱动的短剧制作工作台
            </p>
          </div>
          <div className="flex items-center gap-4 flex-wrap justify-end">
            {!loading && !error && dramas.length > 0 && (
              <div className="flex items-center gap-4 text-[11px] text-gray-500">
                <span>短剧总数 <b className="text-white text-sm font-bold ml-0.5">{stats.total}</b></span>
                <span>已完成/发布 <b className="text-emerald-300 text-sm font-bold ml-0.5">{stats.completed}</b></span>
                <span>已生成集数 <b className="text-violet-200 text-sm font-bold ml-0.5">{stats.generatedEpisodes}<span className="text-[11px] text-gray-500 font-medium">/{stats.totalEpisodes}</span></b></span>
                <span>已关联剧本 <b className="text-amber-200 text-sm font-bold ml-0.5">{stats.linkedScripts}</b></span>
              </div>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl transition-all disabled:opacity-50 font-semibold"
            >
              {syncing ? <div className="w-3.5 h-3.5 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" /> : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
              {syncing ? '同步中...' : '同步小说'}
            </button>
          </div>
        </div>

        {/* 同步提示 */}
        {syncMsg && (
          <div className={`mb-4 p-3 rounded-xl text-xs flex items-center justify-between ${syncMsg.includes('失败') || syncMsg.includes('出错') ? 'bg-red-500/15 text-red-400 border border-red-500/20' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'}`}>
            <span>{syncMsg}</span>
            <button onClick={() => setSyncMsg(null)} className="opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {!loading && !error && dramas.length > 0 && (
          <>
            <div className="rounded-2xl border border-white/10 p-4 mb-7" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
                  <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索短剧标题、关联小说、平台或风格..."
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-white/10 bg-white/5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 transition-all"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-sm text-gray-200 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 transition-all"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="px-4 py-2.5 rounded-xl border border-white/10 text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-all"
                  >
                    清除筛选
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/15 text-red-300 border border-red-500/20 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <span>短剧列表加载失败: {error}</span>
            <button onClick={fetchDramas} className="px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-xs transition-colors">重试</button>
          </div>
        )}

        {/* 短剧列表 */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin w-8 h-8 border-3 border-violet-500 border-t-transparent rounded-full" />
          </div>
        ) : error ? null : dramas.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🎥</div>
            <h3 className="text-lg font-semibold text-white mb-2">还没有短剧</h3>
            <p className="text-gray-400 mb-6">同步你的小说库，从小说到成片一键完成</p>
            <button onClick={handleSync} disabled={syncing} className="px-6 py-3 text-sm font-medium bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white rounded-xl shadow-lg shadow-violet-500/25 disabled:opacity-50 inline-flex items-center gap-2 cursor-pointer transition-all">
              {syncing ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
              {syncing ? '同步小说中...' : '一键同步小说创建短剧'}
            </button>
          </div>
        ) : filteredDramas.length === 0 ? (
          <div className="text-center py-20 rounded-2xl border border-white/10" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl border border-white/10 flex items-center justify-center text-gray-500">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">没有匹配的短剧</h3>
            <p className="text-gray-400 mb-6 text-sm">换个关键词，或清除当前筛选条件</p>
            <button onClick={clearFilters} className="px-5 py-2.5 rounded-xl text-violet-300 border border-violet-500/30 hover:bg-violet-500/10 transition-colors text-sm">
              清除筛选
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredDramas.map((d) => {
              const progress = d.totalEpisodes > 0 ? Math.min(100, Math.round((d.currentEpisodes / d.totalEpisodes) * 100)) : 0;
              return (
              <div key={d.id} className="group backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden hover:border-violet-500/30 transition-all duration-300" style={{ background: 'rgba(255,255,255,0.04)' }}>
                {/* 封面 */}
                <div className="aspect-[3/4] bg-gradient-to-br from-violet-600/20 to-pink-600/20 flex items-center justify-center relative overflow-hidden">
                  {((d as any).coverImage || (d as any).novelCoverImage) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={(d as any).coverImage || (d as any).novelCoverImage} alt={d.title || '封面'} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-5xl opacity-60">🎬</span>
                  )}
                  <div className="absolute top-3 right-3">
                    <span className={`text-[10px] font-medium px-2 py-1 rounded-full ${statusMap[d.status]?.color || 'bg-gray-500/20 text-gray-400'}`}>
                      {statusMap[d.status]?.label || d.status}
                    </span>
                  </div>
                </div>

                <div className="p-4">
                  <h3 className="text-base font-bold text-white truncate">《{d.title}》</h3>
                  {d.genre && <span className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 mt-1">{getCategoryLabel(d.genre)}</span>}
                  <p className="text-xs text-gray-400 mt-2 line-clamp-2 min-h-[2rem]">{d.description || "暂无简介，可进入工作台继续完善短剧设定。"}</p>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                      <span>{d.currentEpisodes}/{d.totalEpisodes} 集</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-pink-500 transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 mt-3 text-xs text-gray-500">
                    {d.novelId ? (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Link href={`/novel-generator?novelId=${d.novelId}`}
                          onClick={e => e.stopPropagation()}
                          className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors">
                          小说
                        </Link>
                        {d.scriptId ? (
                          <Link href={`/script?novelId=${d.novelId}`}
                            onClick={e => e.stopPropagation()}
                            className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors">
                            剧本
                          </Link>
                        ) : (
                          <Link href={`/script?novelId=${d.novelId}`}
                            onClick={e => e.stopPropagation()}
                            className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-500 hover:bg-gray-500/30 transition-colors">
                            生成剧本
                          </Link>
                        )}
                        {d.platform ? <span className="truncate ml-1">{d.platform}</span> : null}
                      </div>
                    ) : (
                      d.platform ? <span className="truncate">{d.platform}</span> : <span>未设置平台</span>
                    )}
                    <span className="shrink-0">{new Date(d.updatedAt || d.createdAt).toLocaleDateString("zh-CN")}</span>
                  </div>

                  <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/5">
                    <Link
                      href={`/short-dramas/${d.id}`}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 text-center py-2 text-xs font-medium bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg hover:from-violet-700 hover:to-indigo-700 transition-all"
                    >
                      进入工作台
                    </Link>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(d); }}
                      className="px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            );})}
          </div>
        )}
      </main>
    </div>
  );
}
