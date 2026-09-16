'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '@/lib/get-token';
import { refreshUnreadMessages } from '@/lib/use-unread-messages';
import { subscribeRealtime } from '@/lib/realtime-client';

export interface MessageTarget {
  id: string;
  nickname: string;
}

interface Msg {
  senderId: string;
  content: string;
  createdAt: string;
  isMine: boolean;
}

/**
 * 私信弹窗：传入目标用户即可直接对话（自动查找已有会话，没有则新建）。
 * 复用 /api/messages 系列接口；支持实时推送（对方发来的新消息会即时出现）。
 */
export default function MessageDialog({
  open,
  target,
  onClose,
}: {
  open: boolean;
  target: MessageTarget | null;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const threadIdRef = useRef<string | null>(null);

  const authHeaders = useCallback(() => {
    const token = getToken();
    return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token ?? '') };
  }, []);

  const reloadThread = useCallback(async (id: string) => {
    try {
      const r = await fetch('/api/messages/threads/' + id, { headers: authHeaders() });
      const j = await r.json();
      if (j.success) setMessages(j.data ?? []);
      refreshUnreadMessages();
    } catch {
      // 忽略网络抖动
    }
  }, [authHeaders]);

  // 打开时加载会话（存在则读取历史，不存在则视为新会话）
  useEffect(() => {
    if (!open || !target) return;
    let alive = true;
    setLoading(true);
    setError('');
    setMessages([]);
    setInput('');
    threadIdRef.current = null;
    (async () => {
      if (!getToken()) {
        if (alive) { setError('请先登录后再发送私信'); setLoading(false); }
        return;
      }
      try {
        const r = await fetch('/api/messages/threads', { headers: authHeaders() });
        const j = await r.json();
        if (!alive) return;
        if (!j.success) { setError(j.error || '加载失败'); return; }
        const t = (j.data ?? []).find((x: { otherUser?: { id: string } }) => x.otherUser && x.otherUser.id === target.id);
        if (t) {
          threadIdRef.current = t.id;
          await reloadThread(t.id);
        }
      } catch {
        if (alive) setError('网络错误，请重试');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, target, authHeaders, reloadThread]);

  // 实时推送：对方发来新消息时即时刷新
  useEffect(() => {
    const off = subscribeRealtime((m) => {
      const tgt = target;
      if (!open || !tgt) return;
      const tid = threadIdRef.current;
      if (tid && m.threadId === tid) {
        reloadThread(tid);
      } else if (!tid && m.senderId === tgt.id) {
        // 新会话：对方先发来消息，找到会话并加载
        fetch('/api/messages/threads', { headers: authHeaders() })
          .then((r) => r.json())
          .then((j) => {
            const t = j.success
              ? (j.data ?? []).find((x: { otherUser?: { id: string } }) => x.otherUser && x.otherUser.id === tgt.id)
              : null;
            if (t) {
              threadIdRef.current = t.id;
              reloadThread(t.id);
            }
          })
          .catch(() => {});
      }
    });
    return off;
  }, [open, target, authHeaders, reloadThread]);

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || !target || sending) return;
    if (!getToken()) { setError('请先登录后再发送私信'); return; }
    setSending(true);
    setError('');
    try {
      const isNew = !threadIdRef.current;
      const r = await fetch(isNew ? '/api/messages/threads' : '/api/messages/threads/' + threadIdRef.current, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(isNew ? { otherUserId: target.id, content: text } : { content: text }),
      });
      const j = await r.json();
      if (!j.success) { setError(j.error || '发送失败'); return; }
      setInput('');
      if (isNew) {
        const tid = j.data && j.data.threadId;
        if (tid) {
          threadIdRef.current = tid;
          await reloadThread(tid);
        }
      } else {
        setMessages(j.data ?? []);
      }
      refreshUnreadMessages();
    } catch {
      setError('发送失败，请重试');
    } finally {
      setSending(false);
    }
  };

  if (!open || !target) return null;

  return (
    <div className="fixed inset-0 z-[9500] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg h-[70vh] max-h-[560px] rounded-2xl border border-white/10 overflow-hidden flex flex-col shadow-2xl"
        style={{ background: 'rgba(15,12,41,0.97)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base">💬</span>
            <span className="text-sm font-bold text-white truncate">{target.nickname}</span>
            <span className="text-[11px] text-gray-500 shrink-0">私信</span>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭私信"
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-white/15 text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
          >✕</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {loading && <p className="text-center text-xs text-gray-500">加载中...</p>}
          {!loading && messages.length === 0 && <p className="text-center text-xs text-gray-500 mt-8">还没有消息，打个招呼吧 👋</p>}
          {messages.map((m, i) => (
            <div key={i} className={'flex ' + (m.isMine ? 'justify-end' : 'justify-start')}>
              <div className={'max-w-[78%] px-3.5 py-2 rounded-xl text-sm whitespace-pre-wrap break-words ' + (m.isMine ? 'bg-sky-600 text-white' : 'bg-white/5 text-gray-200 border border-white/10')}>
                {m.content}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="p-3 border-t border-white/10 shrink-0">
          {error && <p className="text-[11px] text-rose-400 mb-2">{error}</p>}
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={'给 ' + target.nickname + ' 发消息…'}
              className="flex-1 bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-sky-500/60"
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              className="px-4 py-2 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? '发送中…' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
