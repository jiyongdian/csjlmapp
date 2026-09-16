'use client';
import SideDockNav from '@/components/SideDockNav';

import { formatChapterTitle } from '@/lib/chapter-title';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '@/lib/get-token';

interface NovelLite { id: string; title: string; currentChapters: number; totalChapters: number; chapters?: { index: number; title: string; content: string }[]; }
interface Msg { id: string; kind: 'user' | 'assistant' | 'intent' | 'change' | 'tool' | 'progress'; content: string; meta?: string; chapter?: string; }
interface ChangeItem { id: string; action: string; chapterIndex: number | null; title: string | null; detail: string | null; createdAt: string; }

const ACTION_LABEL: Record<string, string> = {
  rewrite: '🔄 重写', continue: '✍️ 续写', polish: '✨ 润色', expand: '📖 扩写', condense: '✂️ 精简',
  review: '🔍 查错', summary: '📋 摘要', chat: '💬 对话', generate: '📖 生成小说', 'generate-script': '🎬 生成剧本',
  'script-scenes': '🎬 优化场景拆分', 'script-dialogue': '💬 优化对白', 'script-image-prompts': '🖼️ 生成图片提示词', 'script-video-prompts': '🎥 生成视频提示词',
  create_chapter: '📄 生成章节', create_novel: '🏗️ 创建作品', update_memory: '🧠 更新记忆',
  apply_rewrite: '🔄 重写章节', apply_continue: '✍️ 续写章节', apply_polish: '✨ 润色章节', apply_expand: '📖 扩写章节', apply_condense: '✂️ 精简章节',
};


const POV_LABELS: Record<string, string> = {
  'third-omniscient': '第三人称全知',
  'third-limited': '第三人称限制',
  'first-person': '第一人称',
  'second-person': '第二人称',
};
const GENDER_LABELS: Record<string, string> = { male: '男频', female: '女频' };


function timeAgo(t: string): string {
  const d = Date.now() - new Date(t).getTime();
  if (Number.isNaN(d)) return '';
  if (d < 60000) return '刚刚';
  if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
  if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
  return Math.floor(d / 86400000) + ' 天前';
}

export default function StudioPage() {
  const token = getToken();
  const auth = (json = true) => ({ ...(json ? { 'Content-Type': 'application/json' } : {}), Authorization: 'Bearer ' + (token ?? '') });

  const [novels, setNovels] = useState<NovelLite[]>([]);
  const [query, setQuery] = useState('');
  const [novelId, setNovelId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<{ index: number; title: string; content: string }[]>([]);
  const [curCh, setCurCh] = useState(1);
  const [tocOpen, setTocOpen] = useState(true);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionByChapter, setSessionByChapter] = useState<Record<number, string>>({});
  const [messages, setMessages] = useState<Msg[]>([]);
  const [changes, setChanges] = useState<ChangeItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streamPart, setStreamPart] = useState('');
  const [genState, setGenState] = useState<null | { novelId: string; title: string; current: number; total: number; chapterTitle: string; done: boolean }>(null);
  const [liveChapters, setLiveChapters] = useState<{ index: number; title: string; content: string; done: boolean }[]>([]);
  const [askPerspective, setAskPerspective] = useState<null | { options: string[]; def: string; prompt: string }>(null);
  const [povPick, setPovPick] = useState('third-omniscient');
  const [askGender, setAskGender] = useState<null | { options: string[]; def: string; prompt: string }>(null);
  const [genderPick, setGenderPick] = useState('male');
  const [askCategory, setAskCategory] = useState<null | { tree: { name: string; genres: string[] }[]; def: string; prompt: string }>(null);
  const [catTop, setCatTop] = useState('奇幻玄幻');
  const [catSub, setCatSub] = useState('奇幻');
  const lastPromptRef = useRef('');
  const listRef = useRef<HTMLDivElement>(null);
  const chaptersRef = useRef<{ index: number; title: string; content: string }[]>([]);
  chaptersRef.current = chapters;

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages, streamPart, liveChapters]);

  const loadNovels = useCallback(async () => {
    const r = await fetch('/api/novels', { headers: auth(false) });
    const j = await r.json();
    if (j.success) setNovels(j.data?.novels ?? []);
  }, [token]);

  useEffect(() => { loadNovels(); }, [loadNovels]);

  const loadChanges = useCallback(async (id: string) => {
    const r = await fetch('/api/novels/' + id + '/changes', { headers: auth(false) });
    const j = await r.json();
    if (j.success) setChanges(j.data ?? []);
  }, [token]);

  // ===== 生成任务轮询（后台运行，切页/刷新都能恢复） =====
  const pollRef = useRef<number | null>(null);
  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) { window.clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  const applyGeneration = useCallback((d: any) => {
    if (!d) return;
    const finished = d.status === 'finished';
    setGenState({ novelId: d.novelId ?? '', title: d.title ?? '', current: d.current ?? 0, total: d.total ?? 0, chapterTitle: '', done: finished });
    setLiveChapters(((d.chapters ?? []) as any[]).map((ch) => ({ index: ch.index, title: ch.title, content: ch.content ?? '', done: ch.index < (d.current ?? 0) || finished })));
  }, []);
  const startPolling = useCallback((sid: string) => {
    stopPolling();
    const tick = async () => {
      try {
        const r = await fetch('/api/agent/generations/' + sid, { headers: auth(false) });
        const j = await r.json();
        if (!j.success || !j.data) { stopPolling(); return; }
        applyGeneration(j.data);
        if (j.data.status === 'finished' || j.data.status === 'error') {
          stopPolling();
          loadNovels();
          // 小说生成结束 → 自动回到默认界面，并切到新生成的作品
          if (j.data.status === 'finished' && j.data.novelId) { void backToDefault(j.data.novelId); }
        }
      } catch { /* ignore */ }
    };
    void tick();
    pollRef.current = window.setInterval(tick, 1200);
  }, [applyGeneration, stopPolling, loadNovels]);
  useEffect(() => () => stopPolling(), [stopPolling]);

  const openNovel = useCallback(async (id: string) => {
    const r = await fetch('/api/novels/' + id, { headers: auth(false) });
    const j = await r.json();
    if (!j.success || !j.data) return;
    const n = j.data;
    const chs = Array.isArray(n.chapters) ? n.chapters.map((c: any) => ({ index: c.index, title: c.title ?? '第' + c.index + '章', content: c.content ?? '' })) : [];
    setNovelId(id); setChapters(chs); setCurCh(chs[0]?.index ?? 1); setText(chs[0]?.content ?? ''); setTocOpen(true);
    setMessages([]); setStreamPart(''); setGenState(null); setSaved(true); setLiveChapters([]); setAskPerspective(null); setAskGender(null); setAskCategory(null);
    loadChanges(id);
    // 每章一个独立会话：打开作品时先挂到第一章的会话
    setSessionByChapter({});
    const firstCh = chs[0]?.index ?? 1;
    const sr = await fetch('/api/agent/sessions?novelId=' + encodeURIComponent(id) + '&scope=studio&chapterIndex=' + firstCh, { headers: auth(false) });
    const sj = await sr.json();
    let sid: string | null = sj.success && Array.isArray(sj.data) && sj.data.length ? sj.data[0].id : null;
    if (!sid) {
      const cr = await fetch('/api/agent/sessions', { method: 'POST', headers: auth(), body: JSON.stringify({ novelId: id, chapterIndex: firstCh, scope: 'studio' }) });
      const cj = await cr.json();
      if (cj.success) sid = cj.data.id;
    }
    setSessionId(sid);
    if (sid) setSessionByChapter({ [firstCh]: sid });
    // 恢复该会话的生成历史（进度 + 已产出章节），若仍在生成则继续轮询
    if (sid) {
      try {
        const gr = await fetch('/api/agent/generations/' + sid, { headers: auth(false) });
        const gj = await gr.json();
        if (gj.success && gj.data) {
          applyGeneration(gj.data);
          if (gj.data.status === 'running' || gj.data.status === 'preparing') startPolling(sid);
          else stopPolling();
        }
      } catch { /* ignore */ }
    }
    // 回放历史对话（含生成记录），让对话区保留历史
    if (sid) {
      try {
        const mr = await fetch('/api/agent/sessions/' + sid, { headers: auth(false) });
        const mj = await mr.json();
        if (mj.success && Array.isArray(mj.data?.messages)) {
          const hist = (mj.data.messages as any[])
            .filter((x) => x.role === 'user' || x.role === 'assistant')
            .map((x, i) => {
              const toolName = x.toolName ?? x.tool_name ?? '';
              let chIdx: number | null = null;
              if (x.toolPayload) { try { const tp = JSON.parse(x.toolPayload); if (typeof tp?.chapterIndex === 'number') chIdx = tp.chapterIndex; } catch { /* ignore */ } }
              const chInfo = chIdx !== null ? (chs.find((c: any) => c.index === chIdx)?.title ?? '第' + chIdx + '章') : '';
              if (x.role === 'user') return { id: 'h' + i, kind: 'user' as const, content: x.content ?? '' };
              if (toolName) return { id: 'h' + i, kind: 'tool' as const, content: x.content ?? '', meta: String(toolName), chapter: chInfo };
              return { id: 'h' + i, kind: 'assistant' as const, content: x.content ?? '' };
            });
          if (hist.length) setMessages(hist as Msg[]);
        }
      } catch { /* ignore */ }
    }
  }, [token]);

  /** 生成结束后回到「默认界面」：清空中栏（对话/进度/选择卡），并把左栏切到新生成的作品 */
  const backToDefault = useCallback(async (novelIdToOpen?: string | null) => {
    if (novelIdToOpen) {
      try { await openNovel(novelIdToOpen); } catch { /* ignore */ }
    }
    setMessages([]); setStreamPart(''); setGenState(null); setLiveChapters([]);
    setAskPerspective(null); setAskGender(null); setAskCategory(null);
    setInput(''); setSaved(true);
  }, [openNovel]);

  // ===== 每章一个独立会话：点章节标题 → 载入该章自己的对话历史 =====
  const ensureSessionForChapter = useCallback(async (chapterIndex: number) => {
    if (!novelId) return null;
    const ci = Number(chapterIndex) > 0 ? Number(chapterIndex) : 1;
    const cached = sessionByChapter[ci];
    if (cached) { setSessionId(cached); return cached; }
    try {
      const sr = await fetch('/api/agent/sessions?novelId=' + encodeURIComponent(novelId) + '&scope=studio&chapterIndex=' + ci, { headers: auth(false) });
      const sj = await sr.json();
      let sid: string | null = sj.success && Array.isArray(sj.data) && sj.data.length ? sj.data[0].id : null;
      if (!sid) {
        const cr = await fetch('/api/agent/sessions', { method: 'POST', headers: auth(), body: JSON.stringify({ novelId, chapterIndex: ci, scope: 'studio' }) });
        const cj = await cr.json();
        if (cj.success) sid = cj.data.id;
      }
      if (sid) { setSessionByChapter((prev) => ({ ...prev, [ci]: sid as string })); setSessionId(sid); }
      return sid;
    } catch { return null; }
  }, [novelId, sessionByChapter, token]);

  const replayMessages = useCallback(async (sid: string) => {
    try {
      const mr = await fetch('/api/agent/sessions/' + sid, { headers: auth(false) });
      const mj = await mr.json();
      if (!mj.success || !Array.isArray(mj.data?.messages)) { setMessages([]); return; }
      const list = chaptersRef.current;
      const hist = (mj.data.messages as any[])
        .filter((x) => x.role === 'user' || x.role === 'assistant')
        .map((x, i) => {
          const toolName = x.toolName ?? x.tool_name ?? '';
          let chIdx: number | null = null;
          if (x.toolPayload) { try { const tp = JSON.parse(x.toolPayload); if (typeof tp?.chapterIndex === 'number') chIdx = tp.chapterIndex; } catch { /* ignore */ } }
          const chInfo = chIdx !== null ? (list.find((c) => c.index === chIdx)?.title ?? '第' + chIdx + '章') : '';
          if (x.role === 'user') return { id: 'h' + i, kind: 'user' as const, content: x.content ?? '' };
          if (toolName) return { id: 'h' + i, kind: 'tool' as const, content: x.content ?? '', meta: String(toolName), chapter: chInfo };
          return { id: 'h' + i, kind: 'assistant' as const, content: x.content ?? '' };
        });
      setMessages(hist as Msg[]);
    } catch { /* ignore */ }
  }, [token]);

  const switchChapter = useCallback(async (idx: number) => {
    const c = chaptersRef.current.find((x) => x.index === idx);
    setCurCh(idx); setText(c?.content ?? '');
    setMessages([]); setStreamPart('');
    const sid = await ensureSessionForChapter(idx);
    if (sid) await replayMessages(sid);
  }, [ensureSessionForChapter, replayMessages]);

  const saveChapters = async (next: { index: number; title: string; content: string }[]) => {
    if (!novelId) return;
    await fetch('/api/novels/' + novelId, { method: 'PUT', headers: auth(), body: JSON.stringify({ chapters: next } as any) });
  };

  const doSave = async () => {
    const next = chapters.map((c) => (c.index === curCh ? { ...c, content: text } : c));
    setChapters(next);
    await saveChapters(next);
    setSaved(true);
  };

  const markDirty = (v: string) => { setText(v); setSaved(false); };

  const send = async (arg?: string | { prompt?: string; narrativePerspective?: string; genderTarget?: string; category?: string; skipUserMessage?: boolean }) => {
    const override = typeof arg === 'string' ? { prompt: arg } : (arg ?? {});
    const prompt = (override.prompt ?? input).trim();
    if (!prompt || busy) return;
    if (!novelId) { alert('请先在左侧选择一部作品'); return; }
    const sid = await ensureSessionForChapter(curCh);
    if (!sid) { alert('无法创建对话会话，请稍后重试'); return; }
    setInput(''); setStreamPart(''); setBusy(true); setSaved(true); setLiveChapters([]); setAskPerspective(null); setAskGender(null); setAskCategory(null);
    lastPromptRef.current = prompt;
    if (!override.skipUserMessage) setMessages((m) => [...m, { id: 'u' + Date.now(), kind: 'user', content: prompt }]);
    try {
      const r = await fetch('/api/agent/runs', {
        method: 'POST', headers: auth(), body: JSON.stringify({ sessionId: sid, novelId, chapterIndex: curCh, prompt, narrativePerspective: override.narrativePerspective, genderTarget: override.genderTarget, category: override.category, skipUserMessage: override.skipUserMessage }),
      });
      if (!r.ok || !r.body) { const t = await r.text().catch(() => '生成失败'); setMessages((m) => [...m, { id: 'e' + Date.now(), kind: 'assistant', content: t.slice(0, 200) }]); return; }
      const reader = r.body.getReader();
      const dec = new TextDecoder(); let buf = ''; let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() || '';
        for (const raw of parts) {
          if (!raw.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(raw.slice(6));
            switch (ev.type) {
              case 'intent': setMessages((m) => [...m, { id: 'i' + Date.now(), kind: 'intent', content: ACTION_LABEL[ev.action] ?? ev.action, meta: ev.instruction }]); break;
              case 'change_applied': setMessages((m) => [...m, { id: 'c' + Date.now(), kind: 'change', content: ev.action ?? '', meta: ev.title ?? '' }]); if (novelId) loadChanges(novelId); break;
              case 'text_delta': acc += ev.content; setStreamPart(acc); break;
              case 'text_reset': acc = ''; setStreamPart(''); break;
              case 'generation_start': setGenState({ novelId: ev.novelId, title: ev.title, current: 0, total: ev.total, chapterTitle: '', done: false }); break;
              case 'generation_progress': setGenState((g) => ({ novelId: g?.novelId ?? ev.novelId, title: g?.title ?? '', current: ev.current, total: ev.total, chapterTitle: ev.chapterTitle ?? '', done: false })); break;
              case 'generation_chapter_start': setLiveChapters((p) => [...p, { index: ev.current, title: ev.title ?? '', content: '', done: false }]); break;
              case 'generation_chapter_delta': setLiveChapters((p) => p.map((c) => (c.index === ev.current ? { ...c, content: c.content + (ev.content ?? '') } : c))); break;
              case 'generation_chapter_end': setLiveChapters((p) => p.map((c) => (c.index === ev.current ? { ...c, content: ev.content ?? c.content, done: true } : c))); break;
              case 'generation_queued': { const qsid = (ev.sessionId ?? sid) as string | null; if (qsid) startPolling(qsid); break; }
              case 'need_gender': setAskGender({ options: ev.options ?? [], def: ev.default ?? 'male', prompt: lastPromptRef.current }); setGenderPick(ev.default ?? 'male'); break;
              case 'need_category': { const tree = (ev.tree ?? []) as { name: string; genres: string[] }[]; const def = ev.default ?? '奇幻玄幻'; setAskCategory({ tree, def, prompt: lastPromptRef.current }); setCatTop(def); setCatSub(tree.find((t) => t.name === def)?.genres[0] ?? ''); break; }
              case 'need_perspective': setAskPerspective({ options: ev.options ?? [], def: ev.default ?? 'third-omniscient', prompt: lastPromptRef.current }); setPovPick(ev.default ?? 'third-omniscient'); break;
              case 'generation_finished': setGenState((g) => ({ novelId: ev.novelId, title: ev.title, current: ev.total, total: ev.total, chapterTitle: '', done: true })); if (novelId) { loadNovels(); loadChanges(novelId); } break;
              case 'tool_result': {
                const chInfo = (ev.chapterIndex !== undefined && ev.chapterIndex !== null) ? (chapters.find((c) => c.index === ev.chapterIndex)?.title ?? '第' + ev.chapterIndex + '章') : '';
                setMessages((m) => [...m, { id: 't' + Date.now(), kind: 'tool', content: ev.content || ev.summary || '完成', meta: ev.toolName || (ev.applied ? '✅ 已写回' : ''), chapter: chInfo }]);
                if (ev.applied && novelId) { void backToDefault(novelId); } loadChanges(novelId);
                break;
              }
              case 'run_finished':
                if (acc.trim()) setMessages((m) => [...m, { id: 'a' + Date.now(), kind: 'assistant', content: acc.trim() }]);
                setStreamPart('');
                break;
              case 'run_error': setMessages((m) => [...m, { id: 'e' + Date.now(), kind: 'assistant', content: '❌ ' + (ev.message ?? '出错') }]); break;
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') setMessages((m) => [...m, { id: 'e' + Date.now(), kind: 'assistant', content: '❌ ' + (e?.message ?? '网络错误') }]);
    } finally { setBusy(false); }
  };

  const aiAction = (action: string) => {
    const prompts: Record<string, string> = {
      continue: '继续往下写这一章，自然衔接结尾',
      polish: '帮我润色这一章',
      expand: '帮我扩写这一章，补充更丰富的细节',
      condense: '帮我精简这一章，去掉冗余',
      rewrite: '帮我重写这一章，保留情节骨架，换更生动的写法',
    };
    send(prompts[action]);
  };

  const keyword = query.trim().toLowerCase();
  const filteredNovels = keyword ? novels.filter((n) => n.title.toLowerCase().includes(keyword)) : novels;
  const currentTitle = formatChapterTitle(curCh, chapters.find((c) => c.index === curCh)?.title);
  const totalChars = chapters.reduce((s, c) => s + c.content.length, 0);

  return (
    <div className="flex flex-col" style={{ background: '#0b0a1f', height: '100vh' }}>
      <header className="shrink-0 border-b border-white/10 flex items-center gap-4 px-4 py-2" style={{ background: '#0f0c29' }}>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-lg">🎬</span>
          <span className="text-sm font-bold text-white">创作工作区</span>
          <span className="text-[11px] text-gray-500">（Agent 实时对话 · 记忆 · 变更追踪）</span>
        </div>
        <div className="relative flex-1 max-w-[560px]">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-500">🔍</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索小说标题…"
            className="w-full pl-7 pr-8 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 outline-none focus:border-purple-500/50"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="清空搜索" className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300">✕</button>
          )}
        </div>
        <SideDockNav title="导航" />
      </header>

      <div className="flex flex-1 min-h-0">
        {/* ===== 左栏：作品树 ===== */}
        <div className="w-60 border-r border-white/10 flex flex-col shrink-0">
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredNovels.length === 0 && <p className="text-[11px] text-gray-500 p-2">{novels.length === 0 ? '还没有作品' : '没有匹配的作品'}</p>}
            {filteredNovels.map((n) => (
              <div key={n.id} className="rounded-lg">
                <button onClick={() => { if (novelId === n.id) { setTocOpen((v) => !v); } else { void openNovel(n.id); } }}
                  className={'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ' + (novelId === n.id ? 'bg-purple-500/25 text-purple-200 border border-purple-500/40' : 'text-gray-300 hover:bg-white/5')}>
                  <span className="flex items-center gap-1.5">
                    <span className={'shrink-0 text-[9px] transition-transform ' + (novelId === n.id && tocOpen ? 'rotate-90' : '')}>▶</span>
                    <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  </span>
                  <span className="text-[10px] text-gray-500">{n.currentChapters}/{n.totalChapters} 章</span>
                </button>
                {novelId === n.id && tocOpen && chapters.length > 0 && (
                  <div className="ml-3 mt-1 space-y-0.5 border-l border-white/10 pl-2">
                    {chapters.map((c) => (
                      <button key={c.index} onClick={() => void switchChapter(c.index)}
                        className={'w-full text-left px-2 py-1 rounded text-[11px] transition-colors ' + (curCh === c.index ? 'text-purple-200 bg-purple-500/20' : 'text-gray-500 hover:text-gray-300')}>
                        {formatChapterTitle(c.index, c.title)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ===== 中栏：对话 + 时间线 ===== */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-white/10">
          <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-2.5">
            <div className="text-center text-[11px] text-gray-500 mb-2">
              {novelId ? '当前章节：《' + currentTitle + '》 · ' + text.length + ' 字 · 全 ' + chapters.length + ' 章 ' + totalChars + ' 字' : '请在左侧选择一部作品，或新建后回来继续'}
            </div>
            {messages.length === 0 && !streamPart && (
              <div className="text-center text-gray-500 text-xs mt-10 space-y-2">
                <p className="text-3xl">🤖</p>
                <p>告诉我做什么，我会自动完成并记录下来，比如：</p>
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  {['生成一部20章小说：都市逆袭，主角从职员到行业大佬', '帮我润色当前这一章', '继续往下写这一章', '帮我扩写这一章', '把这一章生成剧本'].map((ex) => (
                    <button key={ex} onClick={() => send(ex)} className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-full text-[11px] text-purple-200 hover:bg-purple-500/20 transition-colors">{ex}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => {
              if (m.kind === 'user') return <div key={m.id} className="flex justify-end"><div className="max-w-[75%] px-3 py-2 rounded-xl text-sm bg-purple-600 text-white whitespace-pre-wrap">{m.content}</div></div>;
              if (m.kind === 'assistant') return <div key={m.id} className="flex justify-start"><div className="max-w-[75%] px-3 py-2 rounded-xl text-sm bg-white/5 text-gray-200 border border-white/10 whitespace-pre-wrap">{m.content}</div></div>;
              if (m.kind === 'intent') return <div key={m.id} className="flex justify-start"><div className="bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs px-3 py-1.5 rounded-lg">{m.content}{m.meta ? '：' + m.meta : ''}</div></div>;
              if (m.kind === 'change') return <div key={m.id} className="flex justify-start"><div className="bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs px-3 py-1.5 rounded-lg">✅ {m.content}{m.meta ? ' · ' + m.meta : ''}</div></div>;
              if (m.kind === 'tool') return (
                <div key={m.id} className="flex justify-start">
                  <div className="max-w-[85%] bg-emerald-500/10 border border-emerald-500/30 rounded-lg overflow-hidden">
                    <div className="px-3 py-1.5 bg-emerald-500/15 text-emerald-300 text-[11px] flex items-center gap-1.5">
                      <span>🛠️ 生成记录</span>
                      {m.chapter && <span className="text-amber-300 font-medium truncate">📖 {m.chapter}</span>}
                      <span className="ml-auto font-medium shrink-0">{ACTION_LABEL[m.meta ?? ''] ?? m.meta}</span>
                    </div>
                    <div className="px-3 py-2 text-[11px] text-gray-300 whitespace-pre-wrap max-h-80 overflow-y-auto">{m.content || '（无内容）'}</div>
                  </div>
                </div>
              );
              return null;
            })}

            {genState && (
              <div className="flex justify-start">
                <div className="w-full max-w-[85%] rounded-xl border border-purple-500/40 bg-purple-500/10 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-purple-500/20 text-purple-200 text-xs">
                    <span>📖 {genState.done ? '生成完成' : '正在生成小说中…'} {genState.title ? '《' + genState.title + '》' : ''}</span>
                    <span>{genState.current}/{genState.total} 章</span>
                  </div>
                  <div className="px-3 py-2">
                    <div className="h-1.5 rounded bg-white/10 overflow-hidden">
                      <div className="h-full bg-purple-500 transition-all duration-300" style={{ width: (genState.total ? genState.current / genState.total : 0) * 100 + '%' }} />
                    </div>
                    {!genState.done && genState.chapterTitle && <p className="text-[11px] text-gray-300 mt-1.5 truncate">{genState.chapterTitle}</p>}
                    {genState.done && <div className="mt-2 flex gap-2"><a href={'/my-novels'} className="px-3 py-1.5 text-[11px] rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors">📋 我的小说</a><a href={'/books/' + genState.novelId} target="_blank" rel="noreferrer" className="px-3 py-1.5 text-[11px] rounded-lg border border-purple-500/40 text-purple-300 hover:bg-purple-500/15 transition-colors">📖 书城查看</a></div>}
                  </div>
                </div>
              </div>
            )}





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
                      disabled={busy}
                      className="w-full px-3 py-2 text-xs rounded-lg bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 transition-colors">确认并开始生成 ➤　{(catSub || catTop)}</button>
                  </div>
                </div>
              </div>
            )}

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
                      disabled={busy}
                      className="w-full px-3 py-2 text-xs rounded-lg bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 transition-colors">下一步：选择叙事视角 ➤</button>
                  </div>
                </div>
              </div>
            )}

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
                      disabled={busy}
                      className="w-full px-3 py-2 text-xs rounded-lg bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 transition-colors">确认并开始生成 ➤</button>
                  </div>
                </div>
              </div>
            )}

            {liveChapters.length > 0 && (
              <div className="space-y-2.5">
                {liveChapters.map((c) => (
                  <div key={c.index} className="w-full rounded-xl border border-purple-500/30 bg-white/[0.03] overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-purple-500/15 text-purple-200 text-[11px]">
                      <span className="font-medium truncate">{c.title || '第' + c.index + '章'}</span>
                      <span className="text-gray-400 shrink-0 ml-2">{c.done ? c.content.length + ' 字' : '正在书写…'}</span>
                    </div>
                    <div className={'px-3 py-2 text-[13px] leading-6 text-gray-200 whitespace-pre-wrap ' + (c.done ? 'max-h-72 overflow-y-auto' : '')}>
                      {c.content || <span className="text-gray-500">正在生成本章标题与正文…</span>}
                      {!c.done && <span className="inline-block w-1.5 h-4 bg-purple-400 ml-0.5 align-middle animate-pulse" />}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {streamPart && (
              <div className="flex justify-start">
                <div className="max-w-[75%] bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-200 whitespace-pre-wrap">{streamPart}<span className="inline-block w-2 h-4 bg-purple-400 ml-0.5 animate-pulse" /></div>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-white/10 bg-[#0f0c29]/80">
            <textarea value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="告诉我要做什么，我会自主完成…（Enter 发送）" rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50 resize-none" />
            <div className="flex justify-end mt-2">
              <button onClick={() => send()} disabled={busy || !input.trim()} className="px-4 py-1.5 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-40 transition-colors">{busy ? '执行中…' : '发送 ➤'}</button>
            </div>
          </div>
        </div>

        {/* ===== 右栏：章节编辑器 ===== */}
        <div className="w-96 flex flex-col shrink-0 min-w-0">
          <div className="p-3 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm text-white font-semibold truncate">{currentTitle}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{text.length} 字 · {saved ? '已保存' : '未保存'}</p>
              </div>
              <button onClick={doSave} disabled={saved} className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-40 transition-colors shrink-0">保存</button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {[['continue', '续写'], ['polish', '润色'], ['expand', '扩写'], ['condense', '精简'], ['rewrite', '重写']].map(([k, label]) => (
                <button key={k} onClick={() => aiAction(k)} disabled={busy}
                  className="px-2.5 py-1 text-[11px] rounded-lg border border-purple-500/40 text-purple-300 hover:bg-purple-500/15 disabled:opacity-40 transition-colors">{label}</button>
              ))}
            </div>
          </div>
          <textarea
            value={text} onChange={(e) => markDirty(e.target.value)}
            className="flex-1 min-h-0 p-4 bg-[#0e0b23] text-gray-200 text-sm leading-7 resize-none focus:outline-none"
            style={{ whiteSpace: 'pre-wrap', textIndent: '2em' }}
            placeholder="选右侧章节开始编辑，或让 Agent 帮你生成"
          />
          <div className="border-t border-white/10 max-h-44 overflow-y-auto">
            <div className="px-3 py-2 text-[11px] text-gray-400 border-b border-white/10 font-semibold">工作区变更 · {changes.length} 条</div>
            {changes.length === 0 && <div className="px-3 py-3 text-[11px] text-gray-600">暂无变更记录，Agent 每次操作都会留痕</div>}
            {changes.map((c) => (
              <div key={c.id} className="px-3 py-1.5 flex items-start gap-2 border-b border-white/5 text-[11px]">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <div className="min-w-0">
                  <span className="text-gray-300">{ACTION_LABEL[c.action] ?? c.action}</span>
                  {c.title && <span className="text-gray-500"> · {c.title}</span>}
                  {c.detail && <span className="text-gray-600"> · {c.detail}</span>}
                  <div className="text-[9px] text-gray-600">{timeAgo(c.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}