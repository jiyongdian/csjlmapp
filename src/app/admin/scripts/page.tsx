"use client";

import { AdminPageHeader, StatCard, Btn } from '@/components/admin/ui';
import { AdminToolbar, AdminSearch, AdminSelect, AdminSelectionBar } from '@/components/admin/AdminToolbar';
import { AdminDrawer } from '@/components/admin/AdminOverlay';
import { AdminPagination } from '@/components/admin/AdminTable';

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getToken as getAuthToken } from "@/lib/get-token";
import { broadcastDataChange, onDataChange } from "@/lib/data-sync";
import { expandCharacterRelationshipRows } from "@/lib/character-relationships";

interface ScriptChapter {
  chapterIndex: number;
  chapterTitle: string;
  screenplay: Record<string, unknown> | null;
  imagePrompts: Record<string, unknown>[] | null;
  videoPrompts: Record<string, unknown>[] | null;
}

interface AdminScript {
  id: string;
  novelId: string;
  userId: string;
  status: string;
  chapters: ScriptChapter[];
  createdAt: string;
  updatedAt: string;
  novelTitle: string;
  userName: string;
  dramaId: string | null;
}

export default function AdminScriptsPage() {
  const router = useRouter();
  const [scripts, setScripts] = useState<AdminScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Detail modal
  const [detailModal, setDetailModal] = useState<{ visible: boolean; script: AdminScript | null }>({ visible: false, script: null });
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<Record<string, unknown> | null>(null);

  // Expanded chapters
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set());

  // Novel settings panel (characters / scenes / items / relationships)
  const [novelSettings, setNovelSettings] = useState<Record<string, any> | null>(null);
  const [novelSettingsTab, setNovelSettingsTab] = useState<'characters' | 'relationships' | 'scenes' | 'items'>('characters');
  const [showNovelSettings, setShowNovelSettings] = useState(false);

  const getToken = useCallback(() => getAuthToken(), []);

  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [sortKey, setSortKey] = useState('updatedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectMode, setSelectMode] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [editStatusModal, setEditStatusModal] = useState<{ visible: boolean; script: AdminScript | null }>({ visible: false, script: null });
  const [editingStatus, setEditingStatus] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);

  const fetchScripts = useCallback(async () => {
    const token = getToken();
    if (!token) {
      router.push("/auth/login");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "20");
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      params.set("sort", sortKey);
      params.set("order", sortOrder);

      const res = await fetch(`/api/admin/scripts?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setScripts(data.data.scripts || []);
        if (data.data.pagination) setPagination(data.data.pagination);
      } else {
        console.error('[Admin Scripts Page] API返回失败:', data);
        setError(data.error || `API返回失败 (${res.status})`);
      }
    } catch (err: any) {
      console.error("获取剧本列表失败:", err);
      setError(err.message || "网络错误");
    } finally {
      setLoading(false);
    }
  }, [getToken, router, search, statusFilter, page, sortKey, sortOrder]);

  useEffect(() => {
    fetchScripts();
  }, [fetchScripts]);

  useEffect(() => {
    const cleanup = onDataChange((e) => {
      if (e.type === 'script' || e.type === 'novel') fetchScripts();
    });
    return cleanup;
  }, [fetchScripts]);

  const handleDelete = async (script: AdminScript) => {
    if (!confirm(`确定要删除《${script.novelTitle}》的剧本吗？此操作不可恢复！`)) return;
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/scripts/${script.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        broadcastDataChange({ type: 'script', action: 'delete', id: script.id });
        fetchScripts();
        if (detailModal.visible) setDetailModal({ visible: false, script: null });
      }
    } catch (error) {
      console.error("删除失败:", error);
    }
  };

  const openDetailModal = async (script: AdminScript) => {
    setDetailModal({ visible: true, script });
    setDetailLoading(true);
    setExpandedChapters(new Set());
    setNovelSettings(null);
    setShowNovelSettings(false);
    try {
      const token = getToken();
      const [scriptRes, novelRes] = await Promise.all([
        fetch(`/api/admin/scripts/${script.id}`, { headers: { Authorization: `Bearer ${token}` } }),
        script.novelId ? fetch(`/api/admin/novels/${script.novelId}/details`, { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null),
      ]);
      const scriptData = await scriptRes.json();
      if (scriptData.success) setDetailData(scriptData.data);
      if (novelRes) {
        const novelData = await novelRes.json();
        if (novelData.success) setNovelSettings(novelData.data);
      }
    } catch (error) {
      console.error("获取剧本详情失败:", error);
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleChapter = (index: number) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      completed: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/20",
      generating: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20",
      draft: "bg-white/10 text-gray-300 ring-1 ring-white/20",
      failed: "bg-red-500/15 text-red-300 ring-1 ring-red-500/20",
    };
    const labelMap: Record<string, string> = {
      completed: "已完成",
      generating: "生成中",
      draft: "草稿",
      failed: "失败",
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${map[status] || "bg-white/10 text-gray-300"}`}>
        {labelMap[status] || status}
      </span>
    );
  };

  const filteredScripts = scripts;

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm('确定要删除选中的 ' + selectedIds.size + ' 个剧本吗？此操作不可恢复！')) return;
    setBatchDeleting(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/scripts/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (!data.success) { alert(data.error || '批量删除失败'); return; }
      setSelectedIds(new Set());
      setSelectMode(false);
      broadcastDataChange({ type: 'script', action: 'delete', id: 'batch' });
      fetchScripts();
    } catch (err) {
      console.error('批量删除失败:', err);
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleEditStatus = (script: AdminScript) => {
    setEditStatusModal({ visible: true, script });
    setEditingStatus(script.status);
  };

  const handleSaveStatus = async () => {
    if (!editStatusModal.script) return;
    setSavingStatus(true);
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/scripts/${editStatusModal.script.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: editingStatus }),
      });
      const data = await res.json();
      if (data.success) {
        broadcastDataChange({ type: 'script', action: 'update', id: editStatusModal.script.id });
        fetchScripts();
        setEditStatusModal({ visible: false, script: null });
      }
    } catch (err) {
      console.error('更新状态失败:', err);
    } finally {
      setSavingStatus(false);
    }
  };

  // Stats
  const totalScripts = scripts.length;
  const completedCount = scripts.filter((s) => s.status === "completed").length;
  const failedCount = scripts.filter((s) => s.status === "failed").length;
  const linkedDramaCount = scripts.filter((s) => s.dramaId).length;
  const filteredChapters = filteredScripts.reduce((acc, s) => acc + (s.chapters?.length || 0), 0);
  const hasActiveFilters = search.trim().length > 0 || statusFilter !== "";
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("");
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon="🎬"
        title="剧本管理"
        subtitle={'共 ' + pagination.total + ' 个剧本 · 第 ' + pagination.page + ' / ' + (pagination.totalPages || 1) + ' 页 · 本页章节合计 ' + filteredChapters + ' 章'}
        actions={<Btn tone="ghost" onClick={fetchScripts} disabled={loading}>刷新</Btn>}
      />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="剧本总数" value={pagination.total} tone="amber" icon="🎬" hint={"第 " + pagination.page + " / " + (pagination.totalPages || 1) + " 页"} />
        <StatCard label="本页已完成" value={completedCount} tone="emerald" icon="✅" />
        <StatCard label="本页异常" value={failedCount} tone="red" icon="⚠️" />
        <StatCard label="本页已转短剧" value={linkedDramaCount} tone="violet" icon="🎥" />
      </div>

      <AdminToolbar
        actions={
          <>
            <AdminSelect
              value={sortKey + ':' + sortOrder}
              onChange={(v) => { const p = v.split(':'); setSortKey(p[0]); setSortOrder(p[1] as 'asc' | 'desc'); setPage(1); }}
              options={[
                { value: 'updatedAt:desc', label: '最近更新' },
                { value: 'createdAt:desc', label: '最新创建' },
                { value: 'novelTitle:asc', label: '小说标题' },
                { value: 'chapterCount:desc', label: '章节最多' },
                { value: 'status:asc', label: '按状态' },
              ]}
              className="w-36"
            />
            <Btn tone={selectMode ? 'danger' : 'ghost'} size="sm" onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }}>
              {selectMode ? '退出批量' : '批量管理'}
            </Btn>
            {hasActiveFilters && <Btn tone="ghost" size="sm" onClick={clearFilters}>清除筛选</Btn>}
          </>
        }
      >
        <AdminSearch value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="搜索小说标题或用户名…" className="w-full sm:w-72" />
        <AdminSelect
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v); setPage(1); }}
          options={[
            { value: '', label: '全部状态' },
            { value: 'completed', label: '已完成' },
            { value: 'generating', label: '生成中' },
            { value: 'draft', label: '草稿' },
            { value: 'failed', label: '失败' },
          ]}
          className="w-32"
        />
      </AdminToolbar>

      <AdminSelectionBar count={selectMode ? selectedIds.size : 0} onClear={() => setSelectedIds(new Set())}>
        <Btn tone="danger" size="sm" onClick={handleBatchDelete} disabled={batchDeleting}>
          {batchDeleting ? '删除中…' : '删除选中'}
        </Btn>
      </AdminSelectionBar>

      {/* Error display */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/15 text-red-400 border border-red-500/20 text-sm flex items-center justify-between">
          <span>获取剧本数据失败: {error}</span>
          <button onClick={fetchScripts} className="px-3 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-xs transition-colors">重试</button>
        </div>
      )}

      {/* Scripts table */}
      <div className="backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10" style={{ background: 'rgba(255,255,255,0.06)' }}>
                {selectMode && <th className="px-4 py-4 w-10"><input type="checkbox" checked={selectedIds.size === filteredScripts.length && filteredScripts.length > 0} onChange={(e) => setSelectedIds(e.target.checked ? new Set(filteredScripts.map(s => s.id)) : new Set())} className="w-4 h-4 rounded accent-purple-500" /></th>}
                <th className="text-left px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">关联小说</th>
                <th className="text-left px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">用户</th>
                <th className="text-center px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">章节数</th>
                <th className="text-center px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">进度</th>
                <th className="text-center px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">状态</th>
                <th className="text-center px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">短剧</th>
                <th className="text-right px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">更新时间</th>
                <th className="text-center px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={selectMode ? 9 : 8} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="animate-spin w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full" />
                      <span className="text-sm text-gray-400">加载中...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredScripts.length === 0 ? (
                <tr>
                  <td colSpan={selectMode ? 9 : 8} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <span className="text-4xl">🎬</span>
                      <span className="text-sm text-gray-300">{hasActiveFilters ? '没有匹配的剧本' : '暂无剧本'}</span>
                      {hasActiveFilters && (
                        <button onClick={clearFilters} className="px-4 py-2 rounded-lg border border-amber-500/25 text-amber-300 hover:bg-amber-500/10 text-xs transition-colors">
                          清除筛选
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredScripts.map((script) => {
                  const chapters = script.chapters || [];
                  const screenplayCount = chapters.filter((ch) => ch.screenplay).length;
                  const progress = chapters.length > 0 ? Math.round((screenplayCount / chapters.length) * 100) : 0;

                  return (
                    <tr key={script.id} className={`border-b border-white/5 hover:bg-white/5 transition-colors duration-150 ${selectMode && selectedIds.has(script.id) ? 'bg-purple-500/8' : ''}`}>
                      {selectMode && <td className="px-4 py-4 w-10"><input type="checkbox" checked={selectedIds.has(script.id)} onChange={() => setSelectedIds(prev => { const next = new Set(prev); if (next.has(script.id)) next.delete(script.id); else next.add(script.id); return next; })} className="w-4 h-4 rounded accent-purple-500" /></td>}
                      <td className="px-5 py-4">
                        <button
                          onClick={() => openDetailModal(script)}
                          className="text-amber-300 hover:text-amber-200 font-medium text-sm text-left hover:underline transition-all"
                        >
                          《{script.novelTitle}》
                        </button>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                            {script.userName?.[0] || "?"}
                          </div>
                          <span className="text-sm font-medium text-gray-200">{script.userName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className="text-sm font-medium text-gray-200">{chapters.length}</span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col items-center gap-1">
                          <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="text-xs text-gray-500">{progress}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-center">{getStatusBadge(script.status)}</td>
                      <td className="px-5 py-4 text-center">
                        {script.dramaId ? (
                          <span className="px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 text-[10px] font-medium">已关联</span>
                        ) : (
                          <span className="text-xs text-gray-600">-</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-500 text-right whitespace-nowrap">
                        {new Date(script.updatedAt).toLocaleDateString("zh-CN")}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleEditStatus(script)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-lg hover:bg-amber-500/20 transition-all whitespace-nowrap"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            编辑状态
                          </button>
                          <button
                            onClick={() => openDetailModal(script)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-sky-500/10 border border-sky-500/20 text-sky-300 rounded-lg hover:bg-sky-500/20 transition-all whitespace-nowrap"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            详情
                          </button>
                          <button
                            onClick={() => handleDelete(script)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg hover:bg-red-500/20 transition-all whitespace-nowrap"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AdminPagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} limit={pagination.limit} onChange={setPage} loading={loading} />

      {/* Edit Status Modal */}
      {editStatusModal.visible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setEditStatusModal({ visible: false, script: null })}>
          <div className="w-full max-w-sm mx-4 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 p-6" style={{ background: 'rgba(15,12,41,0.98)' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">编辑剧本状态</h3>
            <p className="text-xs text-gray-400 mb-4">《{editStatusModal.script?.novelTitle}》</p>
            <div className="space-y-3">
              <label className="block text-xs text-gray-400 mb-1">状态</label>
              <select
                value={editingStatus}
                onChange={(e) => setEditingStatus(e.target.value)}
                className="w-full px-4 py-2.5 border border-white/15 rounded-xl bg-white/5 text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
              >
                <option value="draft">草稿</option>
                <option value="generating">生成中</option>
                <option value="completed">已完成</option>
                <option value="failed">失败</option>
              </select>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditStatusModal({ visible: false, script: null })} className="flex-1 px-4 py-2.5 rounded-xl text-sm text-gray-400 border border-white/10 hover:bg-white/5 transition-colors">取消</button>
              <button onClick={handleSaveStatus} disabled={savingStatus} className="flex-1 px-4 py-2.5 rounded-xl text-sm text-white font-medium disabled:opacity-50 transition-all" style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
                {savingStatus ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      <AdminDrawer
        open={detailModal.visible}
        onClose={() => setDetailModal({ visible: false, script: null })}
        title="剧本详情"
        subtitle={'《' + (detailModal.script?.novelTitle || '') + '》'}
      >
        <div>
              {detailLoading ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <div className="animate-spin w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full" />
                  <span className="text-sm text-gray-400">加载中...</span>
                </div>
              ) : detailData ? (
                <div className="space-y-4">
                  {/* Info grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <div className="text-xs text-gray-400">用户</div>
                      <div className="text-sm font-bold text-gray-200 mt-0.5">{(detailData as Record<string, unknown>).userName as string || "未知"}</div>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <div className="text-xs text-gray-400">状态</div>
                      <div className="mt-0.5">{getStatusBadge((detailData as Record<string, unknown>).status as string)}</div>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <div className="text-xs text-gray-400">创建时间</div>
                      <div className="text-sm font-bold text-gray-200 mt-0.5">{new Date((detailData as Record<string, unknown>).createdAt as string).toLocaleString("zh-CN")}</div>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <div className="text-xs text-gray-400">更新时间</div>
                      <div className="text-sm font-bold text-gray-200 mt-0.5">{new Date((detailData as Record<string, unknown>).updatedAt as string).toLocaleString("zh-CN")}</div>
                    </div>
                  </div>

                  {/* Chapters */}
                  {Array.isArray(detailData.chapters) && (detailData.chapters as ScriptChapter[]).length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-bold text-gray-200 flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-amber-500/15 flex items-center justify-center text-xs">📑</span>
                        章节列表 ({(detailData.chapters as ScriptChapter[]).length})
                      </h3>
                      {(detailData.chapters as ScriptChapter[]).map((chapter, idx) => {
                        const isExpanded = expandedChapters.has(idx);
                        const hasScreenplay = !!chapter.screenplay;

                        return (
                          <div key={idx} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                            <button
                              onClick={() => toggleChapter(idx)}
                              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/8 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-bold text-xs">
                                  {idx + 1}
                                </div>
                                <div className="text-left">
                                  <span className="text-sm font-bold text-gray-200 block">{chapter.chapterTitle || `第${idx + 1}章`}</span>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <div className="flex gap-1">
                                      <div className={`w-1.5 h-1.5 rounded-full ${hasScreenplay ? "bg-emerald-500" : "bg-gray-600"}`} />
                                    </div>
                                    <span className="text-xs text-gray-400">{hasScreenplay ? '已生成' : '未生成'}</span>
                                  </div>
                                </div>
                              </div>
                              <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </button>

                            {isExpanded && (
                              <div className="border-t border-white/10 px-4 py-4 space-y-4 bg-white/3">
                                {/* Screenplay */}
                                <div>
                                  <h4 className="text-xs font-bold text-emerald-600 mb-2 flex items-center gap-1.5">
                                    <span className="w-4 h-4 rounded bg-emerald-500/15 flex items-center justify-center text-[10px]">📜</span>
                                    剧本
                                  </h4>
                                  {hasScreenplay ? (
                                    <div className="bg-white/5 rounded-lg p-3 max-h-60 overflow-y-auto border border-white/10 space-y-3">
                                      {(() => {
                                        const sp = chapter.screenplay as any;
                                        const scenes = sp?.scenes || (Array.isArray(sp) ? sp : []);
                                        if (scenes.length === 0) return <p className="text-xs text-gray-500 italic">无场景数据</p>;
                                        return scenes.map((scene: any, si: number) => (
                                          <div key={si} className="space-y-1">
                                            <div className="text-xs font-bold text-amber-400">🎬 场景{si + 1}：{scene.sceneTitle || ''}</div>
                                            {scene.description && <p className="text-xs text-gray-300 leading-relaxed pl-4">{scene.description}</p>}
                                            {scene.dialogues?.length > 0 && (
                                              <div className="pl-4 space-y-0.5">
                                                {scene.dialogues.map((d: any, di: number) => (
                                                  <p key={di} className="text-xs text-gray-400"><span className="text-cyan-400 font-medium">💬 {d.character}：</span>{d.line}</p>
                                                ))}
                                              </div>
                                            )}
                                            {scene.stageDirections && <p className="text-xs text-gray-500 italic pl-4">🎥 {scene.stageDirections}</p>}
                                          </div>
                                        ));
                                      })()}
                                    </div>
                                  ) : (
                                    <p className="text-xs text-gray-400 italic">未生成</p>
                                  )}
                                </div>

                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* 小说人物设定面板 */}
                  {novelSettings && (() => {
                    const relationships = expandCharacterRelationshipRows(novelSettings.relationships || []);
                    const tabs = [
                      { key: 'characters' as const, label: `角色 (${novelSettings.characters?.length || 0})`, icon: '👤' },
                      { key: 'relationships' as const, label: `关系 (${relationships.length})`, icon: '🔗' },
                      { key: 'scenes' as const, label: `场景 (${novelSettings.scenes?.length || 0})`, icon: '🏞️' },
                      { key: 'items' as const, label: `物品 (${novelSettings.items?.length || 0})`, icon: '💎' },
                    ];
                    return (
                      <div className="bg-white/3 border border-white/8 rounded-xl overflow-hidden">
                        <button onClick={() => setShowNovelSettings(v => !v)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors">
                          <span className="text-sm font-bold text-gray-200 flex items-center gap-2">
                            <span className="w-5 h-5 rounded bg-violet-500/20 flex items-center justify-center text-[10px]">📖</span>
                            小说人物设定
                          </span>
                          <svg className={`w-4 h-4 text-gray-400 transition-transform ${showNovelSettings ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </button>
                        {showNovelSettings && (
                          <div className="border-t border-white/8 p-4 space-y-3">
                            <div className="flex gap-1.5 flex-wrap">
                              {tabs.map(t => (
                                <button key={t.key} onClick={() => setNovelSettingsTab(t.key)}
                                  className={`px-2.5 py-1 text-[11px] rounded-lg transition-all ${novelSettingsTab === t.key ? 'bg-violet-600/40 text-violet-200 border border-violet-500/40' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
                                  {t.icon} {t.label}
                                </button>
                              ))}
                            </div>
                            {novelSettingsTab === 'characters' && (
                              <div className="space-y-2">
                                {(novelSettings.characters?.length || 0) > 0 ? novelSettings.characters.map((c: any) => (
                                  <div key={c.id} className="bg-white/5 rounded-lg px-3 py-2">
                                    <div className="flex items-center gap-2 mb-0.5">
                                      <span className="text-xs font-bold text-white">{c.name}</span>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${c.role === 'protagonist' ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-500/20 text-gray-400'}`}>{c.role === 'protagonist' ? '主角' : '配角'}</span>
                                    </div>
                                    {c.description && <p className="text-[11px] text-gray-400 line-clamp-2">{c.description}</p>}
                                    {c.personality && <p className="text-[10px] text-gray-500 mt-0.5">性格：{c.personality}</p>}
                                  </div>
                                )) : <p className="text-xs text-gray-500">暂无数据</p>}
                              </div>
                            )}
                            {novelSettingsTab === 'relationships' && (
                              <div className="space-y-2">
                                {relationships.length > 0 ? relationships.map((r: any) => (
                                  <div key={r.id} className="bg-white/5 rounded-lg px-3 py-2">
                                    <div className="flex items-center gap-2 mb-0.5">
                                      <span className="text-xs font-bold text-amber-400">{r.fromCharacter}</span>
                                      <span className="text-gray-500">→</span>
                                      <span className="text-xs font-bold text-violet-400">{r.toCharacter}</span>
                                    </div>
                                    {r.relationship && <p className="text-[11px] text-gray-400 line-clamp-2">{r.relationship}</p>}
                                  </div>
                                )) : <p className="text-xs text-gray-500">暂无数据</p>}
                              </div>
                            )}
                            {novelSettingsTab === 'scenes' && (
                              <div className="space-y-2">
                                {(novelSettings.scenes?.length || 0) > 0 ? novelSettings.scenes.map((s: any) => (
                                  <div key={s.id} className="bg-white/5 rounded-lg px-3 py-2">
                                    <div className="text-xs font-bold text-emerald-400 mb-0.5">{s.name}</div>
                                    {s.description && <p className="text-[11px] text-gray-400 line-clamp-2">{s.description}</p>}
                                  </div>
                                )) : <p className="text-xs text-gray-500">暂无数据</p>}
                              </div>
                            )}
                            {novelSettingsTab === 'items' && (
                              <div className="space-y-2">
                                {(novelSettings.items?.length || 0) > 0 ? novelSettings.items.map((it: any) => (
                                  <div key={it.id} className="bg-white/5 rounded-lg px-3 py-2">
                                    <div className="text-xs font-bold text-sky-400 mb-0.5">{it.name}</div>
                                    {it.description && <p className="text-[11px] text-gray-400 line-clamp-2">{it.description}</p>}
                                  </div>
                                )) : <p className="text-xs text-gray-500">暂无数据</p>}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-400">加载失败</div>
              )}
            </div>

            {/* Modal footer */}
            <div className="border-t border-white/10 px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => setDetailModal({ visible: false, script: null })}
                className="px-5 py-2.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl text-sm transition-colors"
              >
                关闭
              </button>
              {detailModal.script && (
                <button
                  onClick={() => { handleDelete(detailModal.script!); }}
                  className="px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-bold transition-colors"
                >
                  删除剧本
                </button>
              )}
            </div>
      </AdminDrawer>
    </div>
  );
}
