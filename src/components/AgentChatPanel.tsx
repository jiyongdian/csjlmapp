'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getToken } from '@/lib/get-token';
import type { AgentSession } from '@/lib/agent/types';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string | null;
  createdAt?: string;
}

interface ToolCard {
  toolName: string;
  summary: string;
  content: string;
  applied?: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  rewrite: '🔄 重写章节',
  continue: '✍️ 续写章节',
  polish: '✨ 润色章节',
  expand: '📖 扩写章节',
  condense: '✂️ 精简章节',
  review: '🔍 章节查错',
  summary: '📋 章节摘要',
  generate: '📖 生成小说',
  'generate-script': '🎬 生成剧本',
  'script-scenes': '🎬 优化场景拆分',
  'script-dialogue': '💬 优化对白',
  'script-image-prompts': '🖼️ 生成图片提示词',
  'script-video-prompts': '🎥 生成视频提示词',
  chat: '💬 对话',
};

const POV_LABELS: Record<string, string> = {
  'third-omniscient': '第三人称全知',
  'third-limited': '第三人称限制',
  'first-person': '第一人称',
  'second-person': '第二人称',
};
const GENDER_LABELS: Record<string, string> = { male: '男频', female: '女频' };
const CATEGORY_OPTIONS_FALLBACK = ['奇幻玄幻', '都市现实', '科幻悬疑', '冒险异能', '情感言情', '军事战争'];



export default function AgentChatPanel({ open, onClose, novelId, chapterIndex }: {
  open: boolean;
  onClose: () => void;
  novelId?: string | null;
  chapterIndex?: number;
}) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [intent, setIntent] = useState<{ action: string; instruction: string } | null>(null);
  const [tools, setTools] = useState<ToolCard[]>([]);
  const [error, setError] = useState('');
  const [sessionTitle, setSessionTitle] = useState('新对话');
  const [genState, setGenState] = useState<null | { novelId: string; title: string; current: number; total: number; chapterTitle: string; chars: number; preview: string; done: boolean; interrupted?: boolean; error?: string }>(null);
  const [liveChapters, setLiveChapters] = useState<{ index: number; title: string; content: string; done: boolean }[]>([]);
  const [askPerspective, setAskPerspective] = useState<null | { options: string[]; def: string; prompt: string; sessionId: string }>(null);
  const [povPick, setPovPick] = useState('third-omniscient');
  const [askGender, setAskGender] = useState<null | { options: string[]; def: string; prompt: string; sessionId: string }>(null);
  const [genderPick, setGenderPick] = useState('male');
  const [askCategory, setAskCategory] = useState<null | { tree: { name: string; genres: string[] }[]; def: string; prompt: string; sessionId: string }>(null);
  const [catTop, setCatTop] = useState('奇幻玄幻');
  const [catSub, setCatSub] = useState('奇幻');
  const [ideaChips, setIdeaChips] = useState<string[]>([]);
  const [ideaLoading, setIdeaLoading] = useState(false);
  const lastPromptRef = useRef('');
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const token = getToken();

  const authHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
  });

  // 加载「AI 分析热门短剧」生成的写小说灵感（服务端随机取子集，故每次不同）
  const loadIdeas = useCallback(async (fresh?: boolean) => {
    setIdeaLoading(true);
    try {
      const r = await fetch('/api/novel/agent-suggestions?count=6' + (fresh ? '&fresh=1' : ''), { headers: authHeaders() });
      const j = await r.json();
      if (j && j.success && Array.isArray(j.data)) setIdeaChips(j.data);
    } catch { /* ignore */ }
    setIdeaLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 加载会话列表
  const loadSessions = useCallback(async (targetNovelId?: string) => {
    try {
      const q = targetNovelId ? '?novelId=' + encodeURIComponent(targetNovelId) : '';
      const r = await fetch('/api/agent/sessions' + q, { headers: authHeaders() });
      const j = await r.json();
      if (j.success) setSessions(j.data ?? []);
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => {
    if (open) loadSessions(novelId ?? undefined);
  }, [open, novelId, loadSessions]);

  // 打开面板且无对话时，拉取一批热门短剧灵感
  useEffect(() => {
    if (open && messages.length === 0) void loadIdeas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ===== 生成任务轮询（后台运行，切页/刷新都能恢复） =====
  const pollRef = useRef<number | null>(null);
  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) { window.clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  const applyGeneration = useCallback((d: any) => {
    if (!d) return;
    const finished = d.status === 'finished';
    const errored = d.status === 'error';
    setGenState((prev) => ({
      novelId: d.novelId ?? prev?.novelId ?? '',
      title: d.title ?? prev?.title ?? '',
      current: d.current ?? 0,
      total: d.total ?? 0,
      chapterTitle: '',
      chars: 0,
      preview: '',
      done: finished,
      interrupted: errored,
      error: errored ? String(d.error || '生成中断') : undefined,
    }));
    setLiveChapters(((d.chapters ?? []) as any[]).map((ch) => ({ index: ch.index, title: ch.title, content: ch.content ?? '', done: ch.index < (d.current ?? 0) || finished })));
    if (errored) setError('生成中断：' + String(d.error || '未知原因') + '（可点「继续生成」从断点续写）');
  }, []);
  const startPolling = useCallback((sid: string) => {
    stopPolling();
    const tick = async () => {
      try {
        const r = await fetch('/api/agent/generations/' + sid, { headers: authHeaders() });
        const j = await r.json();
        if (!j.success || !j.data) { stopPolling(); return; }
        applyGeneration(j.data);
        if (j.data.status === 'finished' || j.data.status === 'error') { stopPolling(); loadSessions(novelId ?? undefined); }
      } catch { /* ignore */ }
    };
    void tick();
    pollRef.current = window.setInterval(tick, 1200);
  }, [applyGeneration, stopPolling, loadSessions, novelId]);
  useEffect(() => () => stopPolling(), [stopPolling]);

  // 会话消息加载
  const openSession = async (sessionId: string) => {
    setAskPerspective((prev) => (prev && prev.sessionId === sessionId ? prev : null));
    setAskGender((prev) => (prev && prev.sessionId === sessionId ? prev : null));
    setAskCategory((prev) => (prev && prev.sessionId === sessionId ? prev : null));
    setCurrentSessionId(sessionId);
    setMessages([]); setStreamText(''); setTools([]); setIntent(null); setError(''); setGenState(null); setLiveChapters([]);
    try {
      const r = await fetch('/api/agent/sessions/' + sessionId, { headers: authHeaders() });
      const j = await r.json();
      if (j.success) {
        const msgs = (j.data.messages ?? []).map((m: any) => ({
          id: m.id, role: m.role, content: m.content ?? '', toolName: m.toolName ?? null,
        }));
        setMessages(msgs);
        setSessionTitle(j.data.session?.title ?? '新对话');
      }
      // 恢复该会话的生成历史（进度 + 已产出章节），若仍在生成则继续轮询
      try {
        const gr = await fetch('/api/agent/generations/' + sessionId, { headers: authHeaders() });
        const gj = await gr.json();
        if (gj.success && gj.data) {
          applyGeneration(gj.data);
          if (gj.data.status === 'running' || gj.data.status === 'preparing') startPolling(sessionId);
          else stopPolling();
        } else { setGenState(null); setLiveChapters([]); }
      } catch { /* ignore */ }
    } catch { /* ignore */ }
  };

  // 新建会话
  const createSession = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/agent/sessions', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ novelId: novelId ?? undefined, chapterIndex }),
      });
      const j = await r.json();
      if (j.success) {
        setSessions((prev) => [j.data, ...prev]);
        setCurrentSessionId(j.data.id);
        setMessages([]); setStreamText(''); setTools([]); setIntent(null); setGenState(null); setLiveChapters([]); setAskPerspective(null); setAskGender(null); setAskCategory(null);
        setSessionTitle('新对话');
      }
    } catch { setError('创建会话失败'); }
    setLoading(false);
  };

  // 删除会话
  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch('/api/agent/sessions/' + sessionId, { method: 'DELETE', headers: authHeaders() });
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (currentSessionId === sessionId) { setCurrentSessionId(null); setMessages([]); }
  };

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, streamText, liveChapters]);

  // ===== 发送 / SSE 流式 =====
  const send = async (override?: { prompt?: string; narrativePerspective?: string; genderTarget?: string; category?: string; skipUserMessage?: boolean }) => {
    const prompt = (override?.prompt ?? input).trim();
    if (!prompt || loading) return;
    let sessionId = currentSessionId;
    if (!sessionId) {
      // 自动建会话
      const r = await fetch('/api/agent/sessions', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ novelId: novelId ?? undefined, chapterIndex }),
      });
      const j = await r.json();
      if (!j.success) { setError('创建会话失败'); return; }
      sessionId = j.data.id;
      setCurrentSessionId(sessionId);
      setSessions((prev) => [j.data, ...prev]);
    }
    setInput(''); setError(''); setStreamText(''); setTools([]); setIntent(null); setGenState(null); setLiveChapters([]); setAskPerspective(null); setAskGender(null); setAskCategory(null);
    lastPromptRef.current = prompt;
    if (!override?.skipUserMessage) setMessages((prev) => [...prev, { id: 'local-' + Date.now(), role: 'user', content: prompt }]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await fetch('/api/agent/runs', {
        method: 'POST', headers: authHeaders(), signal: controller.signal,
        body: JSON.stringify({ sessionId, novelId: novelId ?? undefined, chapterIndex, prompt, narrativePerspective: override?.narrativePerspective, genderTarget: override?.genderTarget, category: override?.category, skipUserMessage: override?.skipUserMessage }),
      });
      if (!r.ok || !r.body) { const t = await r.text().catch(() => '生成失败，请稍后重试'); setError(t.slice(0, 200)); return; }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';
        for (const raw of parts) {
          if (!raw.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(raw.slice(6));
            switch (event.type) {
              case 'intent':
                setIntent({ action: event.action, instruction: event.instruction });
                break;
              case 'text_delta':
                acc += event.content;
                setStreamText(acc);
                break;
              case 'text_reset':
                acc = '';
                setStreamText('');
                break;
              case 'tool_result':
                setTools((prev) => [...prev, {
                  toolName: event.toolName, summary: event.summary ?? '', content: event.content ?? '', applied: !!event.applied,
                }]);
                break;
              case 'generation_start':
                setGenState({ novelId: event.novelId, title: event.title, current: 0, total: event.total, chapterTitle: '', chars: 0, preview: '', done: false });
                break;
              case 'generation_progress':
                setGenState((prev) => ({ novelId: prev?.novelId ?? '', title: prev?.title ?? '', current: event.current, total: event.total, chapterTitle: event.chapterTitle ?? '', chars: event.chars ?? 0, preview: event.preview ?? '', done: false }));
                break;
              case 'generation_chapter_start':
                setLiveChapters((prev) => [...prev, { index: event.current, title: event.title ?? '', content: '', done: false }]);
                break;
              case 'generation_chapter_reset':
                setLiveChapters((prev) => prev.map((c) => (c.index === event.current ? { ...c, content: '', done: false } : c)));
                break;
              case 'generation_chapter_delta':
                setLiveChapters((prev) => prev.map((c) => (c.index === event.current ? { ...c, content: c.content + (event.content ?? '') } : c)));
                break;
              case 'generation_chapter_end':
                setLiveChapters((prev) => prev.map((c) => (c.index === event.current ? { ...c, content: event.content ?? c.content, done: true } : c)));
                break;
              case 'generation_queued':
                startPolling(sessionId as string);
                break;
              case 'need_gender':
                setAskGender({ options: event.options ?? [], def: event.default ?? 'male', prompt: lastPromptRef.current, sessionId: sessionId as string });
                setGenderPick(event.default ?? 'male');
                break;
              case 'need_category': {
                const tree = (event.tree ?? []) as { name: string; genres: string[] }[];
                const def = event.default ?? CATEGORY_OPTIONS_FALLBACK[0];
                setAskCategory({ tree, def, prompt: lastPromptRef.current, sessionId: sessionId as string });
                setCatTop(def);
                setCatSub(tree.find((t) => t.name === def)?.genres[0] ?? '');
                break;
              }
              case 'need_perspective':
                setAskPerspective({ options: event.options ?? [], def: event.default ?? 'third-omniscient', prompt: lastPromptRef.current, sessionId: sessionId as string });
                setPovPick(event.default ?? 'third-omniscient');
                break;
              case 'generation_finished':
                setGenState((prev) => ({ novelId: event.novelId, title: event.title, current: event.total, total: event.total, chapterTitle: '', chars: 0, preview: '', done: true }));
                break;
              case 'run_finished':
                if (acc.trim()) {
                  setMessages((prev) => [...prev, { id: 'assistant-' + Date.now(), role: 'assistant', content: acc.trim() }]);
                }
                setStreamText('');
                // 刷新标题/消息
                openSession(sessionId as string);
                break;
              case 'run_error':
                setError(event.message ?? '生成出错');
                break;
            }
          } catch { /* 忽略坏事件 */ }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e?.message ?? '网络错误');
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex justify-end">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      {/* 抽屉 */}
      <div className="relative w-full max-w-[900px] h-full bg-[#0f0c29] border-l border-purple-500/30 shadow-2xl flex flex-col animate-[slideInRight_0.25s_ease-out]">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-purple-950/40">
          <div className="flex items-center gap-2">
            <span className="text-lg">🤖</span>
            <div>
              <h2 className="text-white font-bold text-sm">Agent 对话</h2>
              <p className="text-[11px] text-gray-400">{sessionTitle} · {chapterIndex !== undefined ? '第' + chapterIndex + '章' : '整部作品'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={createSession} disabled={loading}
              className="px-3 py-1.5 text-xs bg-purple-500/20 border border-purple-500/40 text-purple-300 rounded-lg hover:bg-purple-500/30 transition-colors disabled:opacity-50">
              + 新对话
            </button>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 rounded-lg">✕</button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* 左侧会话列表 */}
          <div className="w-52 border-r border-white/10 overflow-y-auto hidden md:block">
            <div className="p-2 space-y-1">
              {sessions.length === 0 && <p className="text-xs text-gray-500 p-2">暂无会话，点击右上角「+ 新对话」开始</p>}
              {sessions.map((s) => (
                <div key={s.id}
                  onClick={() => openSession(s.id)}
                  className={'group cursor-pointer rounded-lg px-3 py-2 text-xs transition-colors ' + (s.id === currentSessionId ? 'bg-purple-500/25 text-purple-200 border border-purple-500/30' : 'hover:bg-white/5 text-gray-300')}>
                  <div className="truncate">{s.title}</div>
                  <div className="flex justify-between text-[10px] text-gray-500 mt-0.5">
                    <span className="truncate">{s.novelId ? '📖 ' + (s.novelTitle || '作品') + (s.chapterIndex ? ' · 第' + s.chapterIndex + '章' : '') : '💬 通用对话'}</span>
                    <button onClick={(e) => deleteSession(s.id, e)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 shrink-0 ml-1">删除</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 右侧对话区 */}
          <div className="flex-1 flex flex-col min-w-0">
            <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && !streamText && (
                <div className="text-center text-gray-500 text-xs mt-12 space-y-2">
                  <p className="text-3xl">🤖</p>
                  <p>告诉 Agent 你想做什么，例如：</p>
                  <div className="flex flex-wrap justify-center gap-2 pt-1">
                    {['重写这一章，换一种紧张感更强的写法', '接着这一章继续写下去', '帮我润色本章的对话部分', '检查这一章有没有逻辑问题', '总结这一章讲了什么', '把这一章生成剧本'].map((ex) => (
                      <button key={ex} onClick={() => setInput(ex)}
                        className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-full text-[11px] text-purple-200 hover:bg-purple-500/20 transition-colors">{ex}</button>
                    ))}
                  </div>

                  {/* AI 分析热门短剧 → 一键生成小说 */}
                  <div className="pt-3 mt-2 border-t border-white/10 max-w-[680px] mx-auto">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <span className="text-[11px] text-amber-300">🔥 AI 分析热门短剧 · 一键生成小说</span>
                      <button onClick={() => void loadIdeas(true)} disabled={ideaLoading}
                        className="text-[11px] text-purple-300 hover:text-purple-200 disabled:opacity-40 transition-colors">
                        {ideaLoading ? '分析中…' : '换一批 ↻'}
                      </button>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      {ideaLoading && ideaChips.length === 0 ? (
                        [0, 1, 2].map((i) => (
                          <span key={i} className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] text-gray-600 animate-pulse">AI 正在分析热门短剧…</span>
                        ))
                      ) : (
                        ideaChips.map((ex) => (
                          <button key={ex} onClick={() => setInput(ex)} title={ex}
                            className="px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-200 hover:bg-amber-500/20 transition-colors max-w-[300px] truncate">{ex}</button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={'flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ' + (m.role === 'user'
                    ? 'bg-purple-600 text-white border border-purple-500/40'
                    : 'bg-white/5 text-gray-200 border border-white/10')}>
                    {m.content}
                  </div>
                </div>
              ))}

              {/* 意图 chip */}
              {intent && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs px-3 py-1.5 rounded-lg whitespace-pre-wrap break-words">
                    {ACTION_LABEL[intent.action] ?? 'Agent'}：{intent.instruction}
                  </div>
                </div>
              )}

              {/* 流式正文 */}
              {streamText && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-gray-200 whitespace-pre-wrap">
                    {streamText}<span className="inline-block w-2 h-4 bg-purple-400 ml-0.5 animate-pulse" />
                  </div>
                </div>
              )}

              {/* 成书进度 */}
              {genState && (
                <div className="flex justify-start">
                  <div className="w-full max-w-[85%] rounded-xl border border-purple-500/40 bg-purple-500/10 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-purple-500/20 text-purple-200 text-xs">
                      <span>📖 {genState.done ? '生成完成' : genState.interrupted ? '生成中断' : '正在生成小说中…'} {genState.title ? '《' + genState.title + '》' : ''}</span>
                      <span>{genState.current}/{genState.total} 章</span>
                    </div>
                    <div className="px-3 py-2">
                      <div className="h-1.5 rounded bg-white/10 overflow-hidden">
                        <div className="h-full bg-purple-500 transition-all duration-300" style={{ width: (genState.total ? genState.current / genState.total : 0) * 100 + '%' }} />
                      </div>
                      {!genState.done && genState.chapterTitle && (
                        <p className="text-[11px] text-gray-300 mt-1.5 truncate">{genState.chapterTitle} · {genState.chars} 字</p>
                      )}
                    </div>
                    <div className="px-3 py-2 border-t border-purple-500/20 flex flex-wrap gap-2">
                      {genState.done ? (
                        <>
                          <a href={'/my-novels'} className="px-3 py-1.5 text-[11px] rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors">📋 我的小说</a>
                          <a href={'/books/' + genState.novelId} target="_blank" rel="noreferrer" className="px-3 py-1.5 text-[11px] rounded-lg border border-purple-500/40 text-purple-300 hover:bg-purple-500/15 transition-colors">📖 在书城查看</a>
                          <a href={'/books/' + genState.novelId + '/read'} target="_blank" rel="noreferrer" className="px-3 py-1.5 text-[11px] rounded-lg border border-purple-500/40 text-purple-300 hover:bg-purple-500/15 transition-colors">📕 开始阅读</a>
                        </>
                      ) : genState.interrupted ? (
                        <>
                          <button
                            onClick={() => {
                              const p = lastPromptRef.current || (messages.filter((m) => m.role === 'user').slice(-1)[0]?.content ?? '');
                              void send({ prompt: p, skipUserMessage: true });
                            }}
                            className="px-3 py-1.5 text-[11px] rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                          >▶ 继续生成（从断点续写）</button>
                          <a href={'/my-novels'} className="px-3 py-1.5 text-[11px] rounded-lg border border-purple-500/40 text-purple-300 hover:bg-purple-500/15 transition-colors">📋 我的小说</a>
                          {genState.error && <p className="w-full text-[11px] text-red-300">⚠ {genState.error}</p>}
                        </>
                      ) : genState.preview ? (
                        <p className="text-[11px] text-gray-400 line-clamp-2">{genState.preview}…</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}





              {/* 选择小说类型（大类 + 二级类型） */}
              {askCategory && (
                <div className="flex justify-start">
                  <div className="w-full max-w-[85%] rounded-xl border border-emerald-500/40 bg-emerald-500/10 overflow-hidden">
                    <div className="px-3 py-2 bg-emerald-500/20 text-emerald-200 text-xs font-medium">🎯 第 3 步：选择小说类型</div>
                    <div className="p-3 space-y-2.5">
                      <div>
                        <p className="text-[10px] text-gray-400 mb-1.5">大类</p>
                        <div className="flex flex-wrap gap-1.5">
                          {askCategory.tree.map((t) => (
                            <button key={t.name} onClick={() => { setCatTop(t.name); setCatSub(t.genres[0] ?? ''); }}
                              className={'px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors ' + (catTop === t.name ? 'border-emerald-400 bg-emerald-500/25 text-emerald-100' : 'border-white/15 text-gray-300 hover:bg-white/5')}>
                              {t.name}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 mb-1.5">二级类型</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(askCategory.tree.find((t) => t.name === catTop)?.genres ?? []).map((g) => (
                            <button key={g} onClick={() => setCatSub(g)}
                              className={'px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors ' + (catSub === g ? 'border-emerald-400 bg-emerald-500/25 text-emerald-100' : 'border-white/15 text-gray-300 hover:bg-white/5')}>
                              {catSub === g ? '● ' : ''}{g}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="px-3 pb-3">
                      <button
                        onClick={() => { const req = askCategory; setAskCategory(null); send({ prompt: req.prompt, genderTarget: genderPick, narrativePerspective: povPick, category: (catSub || catTop), skipUserMessage: true }); }}
                        disabled={loading}
                        className="w-full px-3 py-2 text-xs rounded-lg bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 transition-colors">确认并开始生成 ➤　{(catSub || catTop)}</button>
                    </div>
                  </div>
                </div>
              )}

              {/* 选择性别方向 */}
              {askGender && (
                <div className="flex justify-start">
                  <div className="w-full max-w-[85%] rounded-xl border border-sky-500/40 bg-sky-500/10 overflow-hidden">
                    <div className="px-3 py-2 bg-sky-500/20 text-sky-200 text-xs font-medium">🎯 第 1 步：选择目标读者方向</div>
                    <div className="p-3 grid grid-cols-2 gap-2">
                      {askGender.options.map((op) => (
                        <button key={op} onClick={() => setGenderPick(op)}
                          className={'px-3 py-2 rounded-lg border text-xs text-left transition-colors ' + (genderPick === op ? 'border-sky-400 bg-sky-500/20 text-sky-100' : 'border-white/15 text-gray-300 hover:bg-white/5')}>
                          {genderPick === op ? '● ' : '○ '}{GENDER_LABELS[op] ?? op}{op === askGender.def ? '（默认）' : ''}
                        </button>
                      ))}
                    </div>
                    <div className="px-3 pb-3">
                      <button
                        onClick={() => { const req = askGender; setAskGender(null); send({ prompt: req.prompt, genderTarget: genderPick, skipUserMessage: true }); }}
                        disabled={loading}
                        className="w-full px-3 py-2 text-xs rounded-lg bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 transition-colors">下一步：选择叙事视角 ➤</button>
                    </div>
                  </div>
                </div>
              )}

              {/* 选择叙事视角 */}
              {askPerspective && (
                <div className="flex justify-start">
                  <div className="w-full max-w-[85%] rounded-xl border border-amber-500/40 bg-amber-500/10 overflow-hidden">
                    <div className="px-3 py-2 bg-amber-500/20 text-amber-200 text-xs font-medium">🎯 第 2 步：选择叙事视角</div>
                    <div className="p-3 grid grid-cols-2 gap-2">
                      {askPerspective.options.map((op) => (
                        <button key={op} onClick={() => setPovPick(op)}
                          className={'px-3 py-2 rounded-lg border text-xs text-left transition-colors ' + (povPick === op ? 'border-amber-400 bg-amber-500/20 text-amber-100' : 'border-white/15 text-gray-300 hover:bg-white/5')}>
                          {povPick === op ? '● ' : '○ '}{POV_LABELS[op] ?? op}{op === askPerspective.def ? '（默认）' : ''}
                        </button>
                      ))}
                    </div>
                    <div className="px-3 pb-3">
                      <button
                        onClick={() => { const req = askPerspective; setAskPerspective(null); send({ prompt: req.prompt, narrativePerspective: povPick, genderTarget: genderPick, skipUserMessage: true }); }}
                        disabled={loading}
                        className="w-full px-3 py-2 text-xs rounded-lg bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 transition-colors">确认并开始生成 ➤</button>
                    </div>
                  </div>
                </div>
              )}

              {/* 逐章实时输出 */}
              {liveChapters.length > 0 && (
                <div className="space-y-2.5">
                  {liveChapters.map((c) => (
                    <div key={c.index} className="w-full rounded-xl border border-purple-500/30 bg-white/[0.03] overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-1.5 bg-purple-500/15 text-purple-200 text-[11px]">
                        <span className="font-medium truncate">{c.title || '第' + c.index + '章'}</span>
                        <span className="text-gray-400 shrink-0 ml-2">{c.done ? c.content.length + ' 字' : '正在书写…'}</span>
                      </div>
                      <div className={'px-3 py-2 text-[13px] leading-6 text-gray-200 whitespace-pre-wrap ' + (c.done ? 'max-h-72 overflow-y-auto' : '')}>
                        {c.content || <span className="text-gray-500">{genState?.interrupted ? '本章未写完（已中断）' : '正在生成本章标题与正文…'}</span>}
                        {!c.done && !genState?.interrupted && <span className="inline-block w-1.5 h-4 bg-purple-400 ml-0.5 align-middle animate-pulse" />}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 工具结果卡片 */}
              {tools.map((t, i) => (
                <div key={i} className="flex justify-start">
                  <div className="w-full max-w-[85%] bg-emerald-500/10 border border-emerald-500/30 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-emerald-500/15 text-emerald-300 text-xs">
                      <span>📎 {ACTION_LABEL[t.toolName] ?? t.toolName}{t.summary ? ' · ' + t.summary : ''}</span>
                    </div>
                    <div className="px-3 py-2 max-h-72 overflow-y-auto text-xs text-gray-400 whitespace-pre-wrap">{t.content}</div>
                    <div className="px-3 py-1.5 flex gap-2 border-t border-emerald-500/20">
                      {t.applied && <span className="text-[11px] text-emerald-300">✅ 已写回章节</span>}
                      <button onClick={() => navigator.clipboard.writeText(t.content)}
                        className="text-[11px] text-purple-300 hover:text-purple-200 ml-auto">复制全文</button>
                    </div>
                  </div>
                </div>
              ))}

              {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
            </div>

            {/* 输入区 */}
            <div className="p-3 border-t border-white/10 bg-[#0f0c29]/80">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="描述你要对小说做什么…（Enter 发送 / Shift+Enter 换行）"
                rows={2}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50 resize-none"
              />
              <div className="flex justify-end mt-2">
                <button onClick={() => send()} disabled={loading || !input.trim()}
                  className="px-4 py-1.5 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-40 transition-colors">
                  {loading ? '生成中…' : '发送 ➤'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <style jsx global>{'@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}'}</style>
    </div>,
    document.body
  );
}
