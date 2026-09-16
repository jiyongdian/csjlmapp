'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import CommunityTopBar from '@/components/community/CommunityTopBar';
import { getToken } from '@/lib/get-token';
import { refreshUnreadMessages } from '@/lib/use-unread-messages';
import { subscribeRealtime } from '@/lib/realtime-client';

interface Thread { id: string; otherUser: { id: string; nickname: string; username: string; avatar: string | null }; unread: number; lastMessage: string; updatedAt: string; }
interface Msg { senderId: string; content: string; createdAt: string; isMine: boolean; }
/** 当前会话：普通 -> 仅 id；新建 -> id='__new__' 且带 otherUser */
interface Cur { id: string; otherUser?: { id: string; nickname: string; username: string; avatar: string | null }; }

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">加载中...</p></div>}>
      <MessagesPageContent />
    </Suspense>
  );
}

function MessagesPageContent() {
  const sp = useSearchParams();
  const token = getToken();
  const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token ?? '') };
  const [threads, setThreads] = useState<Thread[]>([]);
  const [cur, setCur] = useState<Cur | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [targetName, setTargetName] = useState('');
  const [candidates, setCandidates] = useState<any[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    try {
      const r = await fetch('/api/messages/threads', { headers: auth });
      const j = await r.json();
      if (j.success) setThreads((prev) => {
        const next = j.data ?? [];
        // 若 cur 是普通会话，保持其展示信息来自列表；新建会话保留
        return next;
      });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  // 实时消息：新消息到达时刷新会话列表；若正是当前打开的会话则同步刷新消息
  useEffect(() => {
    const off = subscribeRealtime((m) => {
      loadThreads();
      if (cur && cur.id === m.threadId) {
        const tk = getToken();
        fetch('/api/messages/threads/' + m.threadId, {
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (tk ?? '') },
        })
          .then((r) => r.json())
          .then((j) => { if (j.success) setMsgs(j.data ?? []); })
          .catch(() => {});
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, loadThreads]);

  // 从 /messages?user=xxx 进入
  useEffect(() => {
    const userId = sp.get('user');
    if (!userId) return;
    const existing = threads.find((t) => t.otherUser.id === userId);
    if (existing) { openThread(existing.id); return; }
    // 可能线程还没加载完，等待一次
    const timer = setTimeout(() => {
      const again = threads.find((t) => t.otherUser.id === userId);
      if (again) openThread(again.id);
      else {
        fetch('/api/users/search?q=' + userId, { headers: auth }).then((r) => r.json()).then((j) => {
          const u = j.success ? (j.data ?? []).find((x: any) => x.id === userId) : null;
          if (u) { setTargetName(u.nickname || u.username); openWith(u.id); }
        });
      }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, threads]);

  const openThread = useCallback(async (threadId: string) => {
    // 立刻切到该会话（信息由渲染时从 threads 解析）
    setCur({ id: threadId });
    try {
      const r = await fetch('/api/messages/threads/' + threadId, { headers: auth });
      const j = await r.json();
      if (j.success) setMsgs(j.data ?? []);
    } catch { /* ignore */ }
    setShowNew(false);
    loadThreads();
    refreshUnreadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openWith = async (otherUserId: string) => {
    try {
      const r = await fetch('/api/messages/threads', { headers: auth });
      const j = await r.json();
      const found = (j.data ?? []).find((t: Thread) => t.otherUser.id === otherUserId);
      if (found) openThread(found.id);
      else setCur({ id: '__new__', otherUser: { id: otherUserId, nickname: targetName || '用户', username: '', avatar: null } });
    } catch {
      setCur({ id: '__new__', otherUser: { id: otherUserId, nickname: targetName || '用户', username: '', avatar: null } });
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !cur) return;
    const isNewThread = cur.id === '__new__';
    const r = await fetch(isNewThread ? '/api/messages/threads' : '/api/messages/threads/' + cur.id, {
      method: 'POST', headers: auth,
      body: JSON.stringify(isNewThread ? { otherUserId: cur.otherUser!.id, content: text } : { content: text }),
    });
    const j = await r.json();
    if (j.success) {
      setInput('');
      if (isNewThread) {
        const tid = j.data?.threadId;
        if (tid) openThread(tid);
        setShowNew(false);
        loadThreads();
      } else {
        setMsgs(j.data ?? []);
        loadThreads();
      }
    }
  };

  const searchUser = async () => {
    const q = targetName.trim();
    if (!q) return;
    const r = await fetch('/api/users/search?q=' + encodeURIComponent(q), { headers: auth });
    const j = await r.json();
    setCandidates(j.success ? (j.data ?? []) : []);
  };

  useEffect(() => { if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  // 当前会话的完整信息（__new__ 用内嵌 otherUser）
  const curThread = cur ? (cur.id === '__new__' ? cur : (threads.find((t) => t.id === cur.id) ?? null)) : null;
  const curName = curThread?.otherUser?.nickname ?? '';

  return (
    <div className="h-screen flex flex-col" style={{ background: '#0b0a1f' }}>
      <CommunityTopBar title="私信" icon="✉️" />
      <div className="flex-1 min-h-0 flex max-w-5xl w-full mx-auto">
        {/* 会话列表 */}
        <div className="w-64 border-r border-white/10 flex flex-col shrink-0">
          <div className="p-3 border-b border-white/10">
            <button onClick={() => setShowNew((v) => !v)} className="w-full px-3 py-2 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors">✉ 发起新消息</button>
            {showNew && (
              <div className="mt-2 space-y-2">
                <input value={targetName} onChange={(e) => setTargetName(e.target.value)} placeholder="输入用户昵称/用户名…" className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none" />
                <button onClick={searchUser} className="w-full px-3 py-1.5 text-xs border border-white/15 text-gray-300 hover:text-white rounded-lg">搜索</button>
                {candidates.map((u) => (
                  <button key={u.id} onClick={() => { setTargetName(u.nickname || u.username); setCandidates([]); openWith(u.id); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 rounded-lg">{u.nickname || u.username}</button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {threads.length === 0 && <p className="text-[11px] text-gray-500 p-2">暂无会话，点「发起新消息」找人聊聊</p>}
            {threads.map((t) => (
              <button key={t.id} onClick={() => openThread(t.id)}
                className={'w-full text-left rounded-lg px-3 py-2 transition-colors ' + (cur?.id === t.id ? 'bg-sky-500/20 border border-sky-500/30' : 'hover:bg-white/5')}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white truncate">{t.otherUser.nickname}</span>
                  {t.unread > 0 && <span className="px-1.5 rounded-full bg-rose-500 text-[9px] text-white">{t.unread}</span>}
                </div>
                <p className="text-[10px] text-gray-500 truncate mt-0.5">{t.lastMessage || '（新会话）'}</p>
              </button>
            ))}
          </div>
        </div>
        {/* 聊天区 */}
        <div className="flex-1 flex flex-col min-w-0">
          {!cur ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">选择一个会话，或发起新消息</div>
          ) : (
            <>
              <div className="px-4 py-2.5 border-b border-white/10 text-sm text-white font-medium">{curName || '对话'}</div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {msgs.map((m, i) => (
                  <div key={i} className={'flex ' + (m.isMine ? 'justify-end' : 'justify-start')}>
                    <div className={'max-w-[75%] px-3.5 py-2 rounded-xl text-sm whitespace-pre-wrap ' + (m.isMine ? 'bg-sky-600 text-white' : 'bg-white/5 text-gray-200 border border-white/10')}>{m.content}</div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="p-3 border-t border-white/10 flex gap-2">
                <input
                  value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                  placeholder="输入消息…"
                  className="flex-1 bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500/60"
                />
                <button onClick={send} className="px-4 py-2 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors shrink-0">发送</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
