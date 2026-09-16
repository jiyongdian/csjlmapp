'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken } from '@/lib/get-token';

type Tab = 'overview' | 'users' | 'novels' | 'posts' | 'comments' | 'logs';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '📊 概览' },
  { key: 'users', label: '👥 用户' },
  { key: 'novels', label: '📚 作品' },
  { key: 'posts', label: '📌 帖子' },
  { key: 'comments', label: '💬 评论' },
  { key: 'logs', label: '🧾 审计日志' },
];

const TOKEN = '';
function useApi() {
  const token = getToken();
  const auth = (isJson = true) => ({ ...(isJson ? { 'Content-Type': 'application/json' } : {}), Authorization: 'Bearer ' + (token ?? '') });
  return { token, auth };
}

function timeAgo(t: string): string {
  if (!t) return '';
  const diff = Date.now() - new Date(t).getTime();
  if (Number.isNaN(diff)) return '';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  return d + ' 天前';
}

export default function AdminConsolePage() {
  const { auth } = useApi();
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [novels, setNovels] = useState<any[]>([]);
  const [novelsTotal, setNovelsTotal] = useState(0);
  const [posts, setPosts] = useState<any[]>([]);
  const [postsTotal, setPostsTotal] = useState(0);
  const [comments, setComments] = useState<any[]>([]);
  const [commentsTotal, setCommentsTotal] = useState(0);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [toast, setToast] = useState('');

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2200); };

  const loadStats = useCallback(async () => {
    const r = await fetch('/api/admin/console/stats', { headers: auth(false) });
    const j = await r.json();
    if (j.success) setStats(j.data);
  }, [auth]);

  const loadUsers = useCallback(async (kw = '') => {
    const r = await fetch('/api/admin/console/users?q=' + encodeURIComponent(kw), { headers: auth(false) });
    const j = await r.json();
    if (j.success) { setUsers(j.data.items ?? []); setUsersTotal(j.data.total ?? 0); }
  }, [auth]);

  const loadNovels = useCallback(async (kw = '') => {
    const r = await fetch('/api/admin/console/novels?q=' + encodeURIComponent(kw), { headers: auth(false) });
    const j = await r.json();
    if (j.success) { setNovels(j.data.items ?? []); setNovelsTotal(j.data.total ?? 0); }
  }, [auth]);

  const loadPosts = useCallback(async (kw = '') => {
    const r = await fetch('/api/admin/console/posts?q=' + encodeURIComponent(kw), { headers: auth(false) });
    const j = await r.json();
    if (j.success) { setPosts(j.data.items ?? []); setPostsTotal(j.data.total ?? 0); }
  }, [auth]);

  const loadComments = useCallback(async (kw = '') => {
    const r = await fetch('/api/admin/console/comments?q=' + encodeURIComponent(kw), { headers: auth(false) });
    const j = await r.json();
    if (j.success) { setComments(j.data.items ?? []); setCommentsTotal(j.data.total ?? 0); }
  }, [auth]);

  const loadLogs = useCallback(async () => {
    const r = await fetch('/api/admin/console/logs', { headers: auth(false) });
    const j = await r.json();
    if (j.success) { setLogs(j.data.items ?? []); setLogsTotal(j.data.total ?? 0); }
  }, [auth]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { if (tab === 'users') loadUsers(); if (tab === 'novels') loadNovels(); if (tab === 'posts') loadPosts(); if (tab === 'comments') loadComments(); if (tab === 'logs') loadLogs(); }, [tab, loadUsers, loadNovels, loadPosts, loadComments, loadLogs]);

  const patchUser = async (id: string, body: any) => {
    const r = await fetch('/api/admin/console/users/' + id, { method: 'PATCH', headers: auth(), body: JSON.stringify(body) });
    const j = await r.json();
    flash(j.success ? '已更新' : (j.error ?? '操作失败'));
    if (j.success) loadUsers(qInput); loadLogs();
  };
  const patchNovel = async (id: string, status: string) => {
    const r = await fetch('/api/admin/console/novels/' + id, { method: 'PATCH', headers: auth(), body: JSON.stringify({ status }) });
    const j = await r.json();
    flash(j.success ? '已更新' : (j.error ?? '操作失败'));
    if (j.success) loadNovels(qInput); loadLogs();
  };
  const delPost = async (id: string) => {
    if (!confirm('确认删除该帖子？（不可恢复）')) return;
    const r = await fetch('/api/admin/console/posts/' + id, { method: 'DELETE', headers: auth(false) });
    const j = await r.json();
    flash(j.success ? '已删除' : (j.error ?? '操作失败'));
    if (j.success) loadPosts(qInput); loadLogs();
  };
  const delComment = async (id: string) => {
    if (!confirm('确认删除该评论？')) return;
    const r = await fetch('/api/admin/console/comments/' + id, { method: 'DELETE', headers: auth(false) });
    const j = await r.json();
    flash(j.success ? '已删除' : (j.error ?? '操作失败'));
    if (j.success) loadComments(qInput); loadLogs();
  };

  const search = () => {
    setQInput(q); setQ('');
    if (tab === 'users') loadUsers(q);
    else if (tab === 'novels') loadNovels(q);
    else if (tab === 'posts') loadPosts(q);
    else if (tab === 'comments') loadComments(q);
  };

  const statCards = stats ? [
    ['总用户', stats.users], ['活跃用户', stats.activeUsers], ['作品数', stats.novels], ['总章节', stats.totalChapters],
    ['帖子', stats.posts], ['评论', stats.comments], ['私信消息', stats.messages], ['未读私信', stats.unreadMsgs],
    ['审计日志', stats.auditLogs],
  ] : [];

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(239,68,68,0.1), transparent), #0b0a1f' }}>
      <header className="sticky top-0 z-30 border-b border-white/5 backdrop-blur-xl" style={{ background: 'rgba(15,12,41,0.92)' }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">🛠️</span>
            <span className="text-sm font-bold text-white">运营管理后台</span>
          </div>
          <a href="/my-novels" className="px-3 py-1.5 rounded-lg text-xs border border-red-500/40 text-red-300 hover:bg-red-500/20 transition-colors">← 返回工作台</a>
        </div>
        <div className="max-w-6xl mx-auto px-4 pb-2 flex gap-1.5 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={'px-3.5 py-1.5 text-xs rounded-lg border whitespace-nowrap transition-colors ' + (tab === t.key ? 'bg-red-500/25 border-red-500/50 text-red-200' : 'border-white/10 text-gray-400 hover:text-white')}>
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {toast && <div className="fixed top-16 right-4 z-50 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs shadow-lg">{toast}</div>}

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* ===== 概览 ===== */}
        {tab === 'overview' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {statCards.length === 0 ? Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-white/[0.03] animate-pulse" />) :
              statCards.map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-2xl font-bold text-white">{value}</p>
                  <p className="text-[11px] text-gray-400 mt-1">{label}</p>
                </div>
              ))}
          </div>
        )}

        {/* ===== 用户 ===== */}
        {tab === 'users' && (
          <>
            <SearchBar q={q} setQ={setQ} onSearch={search} placeholder="搜索昵称/邮箱/用户名…" />
            <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden mt-4">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-400 border-b border-white/10 text-left">
                  <th className="px-3 py-2.5">用户</th><th className="px-3 py-2.5">角色</th><th className="px-3 py-2.5">状态</th><th className="px-3 py-2.5">作品/章节</th><th className="px-3 py-2.5">注册时间</th><th className="px-3 py-2.5">操作</th>
                </tr></thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-white/5 text-gray-300 hover:bg-white/[0.02]">
                      <td className="px-3 py-2.5"><div className="text-white">{u.nickname}</div><div className="text-gray-500 text-[10px]">@{u.username} · {u.email}</div></td>
                      <td className="px-3 py-2.5">
                        <select value={u.role} onChange={(e) => patchUser(u.id, { role: e.target.value })}
                          className="bg-transparent border border-white/15 rounded px-1.5 py-0.5 text-xs text-gray-300">{['user', 'admin'].map((r) => <option key={r} value={r}>{r}</option>)}</select>
                      </td>
                      <td className="px-3 py-2.5">{u.isActive ? <span className="text-emerald-400">正常</span> : <span className="text-red-400">已封禁</span>}</td>
                      <td className="px-3 py-2.5">{u.novelCount} / {u.chapterCount}</td>
                      <td className="px-3 py-2.5 text-gray-500">{timeAgo(u.createdAt)}</td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => patchUser(u.id, { isActive: !u.isActive })}
                          className={'px-2.5 py-1 rounded-md text-[11px] border transition-colors ' + (u.isActive ? 'border-red-500/40 text-red-300 hover:bg-red-500/20' : 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20')}>
                          {u.isActive ? '封禁' : '解封'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && <div className="text-center text-gray-500 text-sm py-10">暂无用户</div>}
              <div className="px-3 py-2 text-[10px] text-gray-500">共 {usersTotal} 人</div>
            </div>
          </>
        )}

        {/* ===== 作品 ===== */}
        {tab === 'novels' && (
          <>
            <SearchBar q={q} setQ={setQ} onSearch={search} placeholder="搜索作品标题…" />
            <div className="space-y-2 mt-4">
              {novels.length === 0 && <div className="text-center text-gray-500 text-sm py-10">暂无作品</div>}
              {novels.map((n) => (
                <div key={n.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white truncate">{n.title}</span>
                      <span className={'text-[10px] px-1.5 py-0.5 rounded ' + (n.status === 'published' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/15')}>{n.status}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{n.ownerName} · {n.category || '未分类'} · {n.currentChapters}/{n.totalChapters} 章 · 更新于 {timeAgo(n.updatedAt)}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => patchNovel(n.id, n.status === 'published' ? 'draft' : 'published')}
                      className="px-2.5 py-1 text-[11px] rounded-md border transition-colors border-white/15 text-gray-300 hover:text-white">
                      {n.status === 'published' ? '下架' : '上架'}
                    </button>
                    <a href={'/books/' + n.id} target="_blank" className="px-2.5 py-1 text-[11px] rounded-md border border-purple-500/40 text-purple-300 hover:bg-purple-500/15 transition-colors">查看</a>
                  </div>
                </div>
              ))}
              {novels.length > 0 && <div className="text-[10px] text-gray-500 px-1">共 {novelsTotal} 部</div>}
            </div>
          </>
        )}

        {/* ===== 帖子 ===== */}
        {tab === 'posts' && (
          <>
            <SearchBar q={q} setQ={setQ} onSearch={search} placeholder="搜索帖子标题/内容…" />
            <div className="space-y-2 mt-4">
              {posts.length === 0 && <div className="text-center text-gray-500 text-sm py-10">暂无帖子</div>}
              {posts.map((p) => (
                <div key={p.id} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white truncate">{p.title}</span>
                      {p.topicKey && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300">#{p.topicKey}</span>}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1 line-clamp-2">{p.content}</p>
                    <div className="text-[10px] text-gray-600 mt-1">{p.ownerName} · ❤{p.likes} 💬{p.comments} · {timeAgo(p.createdAt)}</div>
                  </div>
                  <button onClick={() => delPost(p.id)} className="px-2.5 py-1 text-[11px] rounded-md border border-red-500/40 text-red-300 hover:bg-red-500/20 transition-colors shrink-0">删除</button>
                </div>
              ))}
              {posts.length > 0 && <div className="text-[10px] text-gray-500 px-1">共 {postsTotal} 帖</div>}
            </div>
          </>
        )}

        {/* ===== 评论 ===== */}
        {tab === 'comments' && (
          <>
            <SearchBar q={q} setQ={setQ} onSearch={search} placeholder="搜索评论内容…" />
            <div className="space-y-2 mt-4">
              {comments.length === 0 && <div className="text-center text-gray-500 text-sm py-10">暂无评论</div>}
              {comments.map((c) => (
                <div key={c.id} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-300">{c.content}</p>
                    <div className="text-[10px] text-gray-600 mt-1">{c.ownerName} · 帖子 {c.postId.slice(0, 12)}… · {timeAgo(c.createdAt)}</div>
                  </div>
                  <button onClick={() => delComment(c.id)} className="px-2.5 py-1 text-[11px] rounded-md border border-red-500/40 text-red-300 hover:bg-red-500/20 transition-colors shrink-0">删除</button>
                </div>
              ))}
              {comments.length > 0 && <div className="text-[10px] text-gray-500 px-1">共 {commentsTotal} 条</div>}
            </div>
          </>
        )}

        {/* ===== 日志 ===== */}
        {tab === 'logs' && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
            <div className="px-4 py-2.5 text-[11px] text-gray-400 border-b border-white/10">共 {logsTotal} 条操作记录（只增不删）</div>
            {logs.length === 0 && <div className="text-center text-gray-500 text-sm py-10">暂无操作日志</div>}
            {logs.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 text-xs">
                <span className="text-gray-500 shrink-0">{timeAgo(l.createdAt)}</span>
                <span className="text-sky-300 shrink-0">{l.adminName}</span>
                <span className="text-gray-300 shrink-0">{l.action}</span>
                <span className="text-gray-600 shrink-0">{l.targetType}·{l.targetId.slice(0, 16)}…</span>
                {l.detail && <span className="text-gray-500 truncate ml-auto">{l.detail}</span>}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function SearchBar({ q, setQ, onSearch, placeholder }: { q: string; setQ: (v: string) => void; onSearch: () => void; placeholder: string }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSearch(); }} className="flex gap-2 max-w-md">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
        className="flex-1 bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-red-500/60" />
      <button type="submit" className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors shrink-0">搜索</button>
    </form>
  );
}
