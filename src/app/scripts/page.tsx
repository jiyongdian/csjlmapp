"use client";

import SideDockNav from '@/components/SideDockNav';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getToken } from '@/lib/get-token';
import { onDataChange } from '@/lib/data-sync';
import { useAgentPageContext } from '@/components/AgentPanelProvider';

interface ScriptListItem {
  pending?: boolean;
  generatedChapterCount?: number;
  id: string;
  novelId: string;
  novelTitle: string;
  dramaId: string | null;
  status: string;
  chapterCount: number;
  novelChapterCount?: number;
  hasScreenplay: boolean;
  hasImagePrompts: boolean;
  hasVideoPrompts: boolean;
  createdAt: string;
  coverImage?: string | null;
}

interface DialogueItem {
  character?: string;
  line?: string;
}

interface SceneItem {
  sceneIndex?: number;
  sceneTitle?: string;
  location?: string;
  shotType?: string;
  cameraAngle?: string;
  duration?: string;
  cameraMovement?: string;
  description?: string;
  actions?: string;
  dialogues?: DialogueItem[];
  stageDirections?: string;
}

interface PromptItem {
  id?: string;
  sceneIndex?: number;
  sceneTitle?: string;
  shotType?: string;
  description?: string;
  prompt?: string;
  negativePrompt?: string;
  style?: string;
  subShotIndex?: number;
  location?: string;
  cameraAngle?: string;
  startFrame?: string;
  cameraMovement?: string;
  action?: string;
  endFrame?: string;
  duration?: string;
  transition?: string;
  dialogueRange?: string;
}

interface ScriptChapter {
  chapterIndex?: number;
  chapterTitle?: string;
  title?: string;
  screenplay?: { scenes?: SceneItem[] };
  imagePrompts?: PromptItem[];
  videoPrompts?: PromptItem[];
}

interface ScriptDetail {
  id: string;
  novelId: string;
  status?: string;
  chapters?: ScriptChapter[];
}

interface TimelineItem {
  id?: string;
  action?: string;
  title?: string;
  createdAt?: string;
}

interface ChatMsg {
  id: string;
  kind: 'user' | 'assistant' | 'intent' | 'tool' | 'change' | 'error';
  content: string;
  meta?: string;
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

const QUICK_COMMANDS = [
  '把这一章生成剧本',
  '这一章场景太碎了，帮我重新拆分场景',
  '这一章台词太少，帮我补充对白',
  '生成这一章的图片提示词',
  '生成这一章的视频提示词',
];

const AGENT_W_KEY = 'script-agent-width-v2';
const AGENT_W_OLD_KEY = 'script-agent-width';
const AGENT_W_MIN = 320;
const AGENT_W_MAX = 1100;
const AGENT_W_DEFAULT = 680;

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '待生成剧本', color: 'bg-amber-500/20 text-amber-300' },
  draft: { label: '草稿', color: 'bg-gray-500/20 text-gray-400' },
  generating: { label: '生成中', color: 'bg-blue-500/20 text-blue-300' },
  completed: { label: '已完成', color: 'bg-emerald-500/20 text-emerald-300' },
  failed: { label: '失败', color: 'bg-red-500/20 text-red-300' },
};

const inputCls =
  'w-full px-2 py-1 text-[11px] bg-white/5 border border-white/10 rounded text-gray-200 placeholder:text-gray-600 outline-none focus:border-amber-500/50';

/**
 * 随内容自动撑高的多行输入框：
 * 固定 rows 会把长描述裁掉、只能靠框内滚动才能看全，这里按 scrollHeight 实时把高度撑开，
 * 保证描述文字一次性完整显示（挂载时与每次内容变化都会重新计算）。
 */
function AutoTextarea({
  value,
  onChange,
  placeholder,
  className,
  minRows = 2,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    // Tailwind 的 box-sizing: border-box 会把上下边框算进 height，
    // 只给 scrollHeight 会让内容少 2px；补上边框高度才能刚好完整显示。
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = el.scrollHeight + border + 'px';
  }, []);

  useEffect(() => { fit(); }, [value, fit]);

  // 面板宽度变化（侧栏收起、窗口缩放、数据加载后布局变化）会让文字重新折行、行数变多，
  // 只按内容变化算高度会残留裁剪，这里监听尺寸变化后重新撑高；
  // 只在宽度真的变化时重算，避免和自身高度变化互相触发。
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - lastWidth) < 1) return;
      lastWidth = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={minRows}
      className={className}
    />
  );
}

function chapterNum(chapter: ScriptChapter | undefined, pos: number): number {
  const raw = chapter?.chapterIndex;
  return typeof raw === 'number' && raw >= 0 ? raw + 1 : pos + 1;
}

function stripNumPrefix(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^(第\s*[0-9一二三四五六七八九十百]+\s*[章集][：:、.\s]*)+/, '')
    .replace(/^[】\]：:、.\s]+/, '')
    .trim();
}

function chapterTitleOf(chapter: ScriptChapter | undefined, pos: number): string {
  const num = chapterNum(chapter, pos);
  const stripped = stripNumPrefix(String(chapter?.chapterTitle || chapter?.title || ''));
  return stripped || ('第' + num + '章');
}

function sceneCountOf(chapter: ScriptChapter | undefined): number {
  const scenes = chapter?.screenplay?.scenes;
  return Array.isArray(scenes) ? scenes.length : 0;
}

export default function ScriptWorkspacePage() {
  const token = getToken();

  const [scripts, setScripts] = useState<ScriptListItem[]>([]);
  const [loadingScripts, setLoadingScripts] = useState(true);
  const [query, setQuery] = useState('');
  const [listError, setListError] = useState('');

  const [activeId, setActiveId] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(true);
  const [detail, setDetail] = useState<ScriptDetail | null>(null);
  const [novelChapters, setNovelChapters] = useState<{ index: number; title: string }[]>([]);
  const [curPos, setCurPos] = useState(0);
  const [tab, setTab] = useState<'scenes' | 'images' | 'videos'>('scenes');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState('');
  // 场景卡片收起状态：按「章节位置-场景序号」记录，切换章节后自动回到全部展开
  const [collapsedScenes, setCollapsedScenes] = useState<Set<string>>(new Set());
  const [busyAction, setBusyAction] = useState('');
  const [genText, setGenText] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ScriptListItem | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionByChapter, setSessionByChapter] = useState<Record<number, string>>({});
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  // 并发：按「会话」维度记录运行中 / 流式文本，支持同时多开对话、互不阻塞
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});
  const [streamMap, setStreamMap] = useState<Record<string, string>>({});
  const busy = !!(sessionId && runningMap[sessionId]);
  const streamPart = sessionId ? (streamMap[sessionId] || '') : '';
  const setRun = useCallback((sid: string, on: boolean) => {
    setRunningMap((prev) => ({ ...prev, [sid]: on }));
  }, []);
  const setStream = useCallback((sid: string, text: string) => {
    setStreamMap((prev) => ({ ...prev, [sid]: text }));
  }, []);
  const [changes, setChanges] = useState<TimelineItem[]>([]);
  const [agentWidth, setAgentWidth] = useState(AGENT_W_DEFAULT);
  const [batch, setBatch] = useState<{ running: boolean; done: number; total: number } | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const agentInputRef = useRef<HTMLTextAreaElement>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const scenesEditedRef = useRef(false);           // 本页是否改过剧本场景/对白
  const generatePromptsRef = useRef<((kind: 'image' | 'video', force?: boolean) => Promise<void>) | null>(null);
  const activeSidRef = useRef<string | null>(null);

  const activeScript = useMemo(
    () => scripts.find((item) => (item.id || ('pending-' + item.novelId)) === activeId) || null,
    [scripts, activeId]
  );
  const chapters = useMemo<ScriptChapter[]>(
    () => (detail && Array.isArray(detail.chapters) ? detail.chapters : []),
    [detail]
  );
  const curChapter = chapters[curPos];
  const scenes = useMemo<SceneItem[]>(() => {
    const list = curChapter?.screenplay?.scenes;
    return Array.isArray(list) ? list : [];
  }, [curChapter]);

  // 章节树：以小说章节为准（这样小说新增的集数会立即出现），并标注哪些还没生成剧本
  const treeChapters = useMemo(() => {
    if (novelChapters.length) {
      return novelChapters.map((nc, i) => {
        const sc = chapters[i];
        const sceneCount = sceneCountOf(sc);
        const num = Number(nc.index) || i + 1;
        const hasScript = sceneCount > 0;
        const title = hasScript ? chapterTitleOf(sc, i) : (stripNumPrefix(nc.title) || ('第' + num + '章'));
        return { pos: i, num, title, scenes: sceneCount, hasScript };
      });
    }
    return chapters.map((sc, i) => {
      const num = chapterNum(sc, i);
      return { pos: i, num, title: chapterTitleOf(sc, i), scenes: sceneCountOf(sc), hasScript: true };
    });
  }, [novelChapters, chapters]);

  useAgentPageContext(activeScript ? activeScript.novelId : null, curPos + 1);

  const auth = useCallback((json = true): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (json) headers['Content-Type'] = 'application/json';
    const t = tokenRef.current;
    if (t) headers.Authorization = 'Bearer ' + t;
    return headers;
  }, []);

  const flash = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 2400);
  }, []);

  // ---------- 剧本列表 ----------
  const loadScripts = useCallback(async () => {
    setLoadingScripts(true);
    setListError('');
    try {
      const res = await fetch('/api/scripts', { headers: auth(false) });
      const data = await res.json();
      if (data && data.success) {
        setScripts(Array.isArray(data.data) ? data.data : []);
      } else {
        setListError((data && data.error) || '获取剧本列表失败');
      }
    } catch (e) {
      setListError(e instanceof Error ? e.message : '网络错误');
    }
    setLoadingScripts(false);
  }, [auth]);

  useEffect(() => {
    void loadScripts();
  }, [loadScripts]);

  useEffect(() => {
    const cleanup = onDataChange((e) => {
      if (e.type === 'script' || e.type === 'novel') void loadScripts();
    });
    return cleanup;
  }, [loadScripts]);

  // ---------- Agent 对话栏宽度（可拖拽，本地记忆） ----------
  useEffect(() => {
    try {
      window.localStorage.removeItem(AGENT_W_OLD_KEY);
      const saved = Number(window.localStorage.getItem(AGENT_W_KEY));
      if (Number.isFinite(saved) && saved >= AGENT_W_MIN && saved <= AGENT_W_MAX) {
        setAgentWidth(saved);
      }
    } catch {
      // ignore
    }
  }, []);

  const startAgentResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = agentWidth;
    let last = startW;
    const onMove = (ev: MouseEvent) => {
      last = Math.min(AGENT_W_MAX, Math.max(AGENT_W_MIN, startW + (ev.clientX - startX)));
      setAgentWidth(last);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        window.localStorage.setItem(AGENT_W_KEY, String(last));
      } catch {
        // ignore
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [agentWidth]);

  // ---------- 变更时间线 ----------
  const loadChanges = useCallback(async (novelId: string) => {
    try {
      const res = await fetch('/api/novels/' + novelId + '/changes', { headers: auth(false) });
      const data = await res.json();
      if (data && data.success) setChanges(Array.isArray(data.data) ? data.data : []);
    } catch {
      // 忽略
    }
  }, [auth]);

  // ---------- 剧本详情 ----------
  const loadDetail = useCallback(async (scriptId: string, silent = false) => {
    if (!scriptId) { setDetail(null); return null; }
    if (!silent) setDetailLoading(true);
    setDetailError('');
    try {
      const res = await fetch('/api/novel/script?scriptId=' + encodeURIComponent(scriptId), { headers: auth(false) });
      const data = await res.json();
      if (data && data.success && data.data) {
        setDetail(data.data);
        setDirty(false);
        return data.data as ScriptDetail;
      }
      setDetailError((data && data.error) || '获取剧本详情失败');
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : '网络错误');
    } finally {
      if (!silent) setDetailLoading(false);
    }
    return null;
  }, [auth]);

  // ---------- 小说章节（章节树以此为准，保证小说新增集数能同步） ----------
  const loadNovelChapters = useCallback(async (novelId: string) => {
    try {
      const res = await fetch('/api/novels/' + encodeURIComponent(novelId), { headers: auth(false) });
      const data = await res.json();
      const list = data && data.success && data.data && Array.isArray(data.data.chapters) ? data.data.chapters : [];
      setNovelChapters(list.map((c: { index?: number; title?: string }) => ({ index: Number(c.index) || 0, title: String(c.title || '') })));
    } catch {
      setNovelChapters([]);
    }
  }, [auth]);

  // 小说新增章节 / 剧本更新时，刷新章节树与当前章详情（有未保存修改时不覆盖详情）
  useEffect(() => {
    const cleanup = onDataChange((e) => {
      if (e.type !== 'script' && e.type !== 'novel') return;
      if (!activeScript) return;
      void loadNovelChapters(activeScript.novelId);
      if (!dirtyRef.current) void loadDetail(activeScript.id, true);
    });
    return cleanup;
  }, [activeScript, loadDetail, loadNovelChapters]);

  // 「待生成」条目在 Agent 生成出剧本后，自动切换到真实剧本
  useEffect(() => {
    if (!activeId || !activeId.startsWith('pending-')) return;
    const novelId = activeId.slice('pending-'.length);
    const real = scripts.find((s) => s.novelId === novelId && s.id);
    if (real) {
      setActiveId(real.id);
      void loadDetail(real.id);
    }
  }, [activeId, scripts, loadDetail]);

  // 每章一个独立 Agent 会话：生成内容与历史记录都只属于当前点击的这一章
  const ensureSession = useCallback(async (novelId: string, chapterIndex: number) => {
    const ci = Number(chapterIndex) > 0 ? Number(chapterIndex) : 1;
    const cached = sessionByChapter[ci];
    if (cached) { setSessionId(cached); return cached; }
    try {
      const res = await fetch('/api/agent/sessions?novelId=' + encodeURIComponent(novelId) + '&scope=scripts&chapterIndex=' + ci, { headers: auth(false) });
      const data = await res.json();
      const first = data && data.success && Array.isArray(data.data) ? data.data[0] : null;
      if (first && first.id) {
        setSessionByChapter((prev) => ({ ...prev, [ci]: first.id }));
        setSessionId(first.id);
        return first.id as string;
      }
      const created = await fetch('/api/agent/sessions', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ novelId, chapterIndex: ci, scope: 'scripts' }),
      });
      const cj = await created.json();
      if (cj && cj.success && cj.data) {
        setSessionByChapter((prev) => ({ ...prev, [ci]: cj.data.id }));
        setSessionId(cj.data.id);
        return cj.data.id as string;
      }
    } catch {
      // 忽略
    }
    return null;
  }, [auth, sessionByChapter]);

  useEffect(() => { activeSidRef.current = sessionId; }, [sessionId]);

  const loadMessages = useCallback(async (sid: string) => {
    try {
      const res = await fetch('/api/agent/sessions/' + sid, { headers: auth(false) });
      const data = await res.json();
      if (data && data.success && data.data && Array.isArray(data.data.messages)) {
        setMessages(
          data.data.messages
            .filter((m: { content?: string }) => m && m.content)
            .map((m: { id: string; role: string; content: string; toolName?: string }, i: number) => ({
              id: m.id || 'h' + i,
              kind: m.role === 'user' ? 'user' : m.toolName ? 'tool' : 'assistant',
              content: m.content,
              meta: m.toolName || undefined,
            }))
        );
      }
    } catch {
      // 忽略
    }
  }, [auth]);

  // 切换章节：切到该章节自己的 Agent 会话，并载入它的历史记录
  const switchChapter = useCallback(async (pos: number) => {
    setCurPos(pos);
    const novelId = activeScript?.novelId;
    if (!novelId) return;
    setMessages([]);
    const sid = await ensureSession(novelId, pos + 1);
    if (sid) {
      setSessionId(sid);
      void loadMessages(sid);
    }
  }, [activeScript, ensureSession, loadMessages]);

  const saveChapters = useCallback(async (silent = false) => {
    if (!detail) return false;
    setBusyAction('save');
    try {
      const res = await fetch('/api/novel/script', {
        method: 'PUT',
        headers: auth(),
        body: JSON.stringify({ scriptId: detail.id, chapters: chapters }),
      });
      const data = await res.json();
      if (data && data.success) {
        setDirty(false);
        if (!silent) flash('剧本已保存');
        // 剧本场景有变动 → 自动重新生成图片/视频提示词，让提示词跟着剧本变化
        const edited = scenesEditedRef.current;
        scenesEditedRef.current = false;
        if (edited) {
          const cur = chapters[curPos];
          const hasImage = Array.isArray(cur?.imagePrompts) && cur.imagePrompts.length > 0;
          const hasVideo = Array.isArray(cur?.videoPrompts) && cur.videoPrompts.length > 0;
          const gp = generatePromptsRef.current;
          if ((hasImage || hasVideo) && gp) {
            flash('剧本场景已变动，正在自动同步提示词…');
            void (async () => {
              try {
                if (hasImage) await gp('image', true);
                if (hasVideo) await gp('video', true);
                flash('图片/视频提示词已随剧本自动同步');
              } catch {
                flash('提示词自动同步失败，可点「生成图片/视频提示词」重试');
              }
            })();
          }
        }
        return true;
      }
      flash((data && data.error) || '保存失败');
    } catch {
      flash('保存失败');
    } finally {
      setBusyAction('');
    }
    return false;
  }, [auth, chapters, detail, flash]);

  const openScript = useCallback(async (item: ScriptListItem) => {
    if (dirty && activeScript && activeScript.id) await saveChapters(true);
    if (item.pending) {
      // 尚无剧本：不离开本页，就地展开章节树，交由中间「Agent 实时对话」生成
      setActiveId('pending-' + item.novelId);
      setTocOpen(true);
      setCurPos(0);
      setTab('scenes');
      setMessages([]);
      setStreamMap({});
      setSessionId(null);
      setDetail(null);
      setDetailError('');
      setDirty(false);
      void loadNovelChapters(item.novelId);
      void loadChanges(item.novelId);
      const sid0 = await ensureSession(item.novelId, 1);
      if (sid0) void loadMessages(sid0);
      flash('这部作品还没有剧本——点左侧章节标题，或让中间 Agent「把这一章生成剧本」');
      return;
    }
    setActiveId(item.id);
    setTocOpen(true);
    setCurPos(0);
    setTab('scenes');
    setMessages([]);
    setStreamMap({});
    setSessionId(null);
    const loaded = await loadDetail(item.id);
    void loadNovelChapters(item.novelId);
    void loadChanges(item.novelId);
    const sid = await ensureSession(item.novelId, 1);
    const currentSid = sid || sessionId;
    if (currentSid) void loadMessages(currentSid);
    if (loaded && Array.isArray(loaded.chapters) && loaded.chapters.length === 0) {
      flash('这部作品还没有剧本内容，可在中间让 Agent「把这一章生成剧本」');
    }
  }, [activeScript, dirty, ensureSession, flash, loadChanges, loadDetail, loadMessages, loadNovelChapters, saveChapters, sessionId]);

  // ---------- 场景编辑 ----------
  const patchChapter = useCallback((pos: number, updater: (chapter: ScriptChapter) => ScriptChapter) => {
    setDetail((prev) => {
      if (!prev) return prev;
      const list = Array.isArray(prev.chapters) ? [...prev.chapters] : [];
      while (list.length <= pos) list.push({});
      list[pos] = updater({ ...list[pos] });
      return { ...prev, chapters: list };
    });
    setDirty(true);
  }, []);

  const updateScene = useCallback((pos: number, sceneIdx: number, patch: Partial<SceneItem>) => {
    scenesEditedRef.current = true;
    patchChapter(pos, (chapter) => {
      const screenplay = chapter.screenplay ? { ...chapter.screenplay } : {};
      const list = Array.isArray(screenplay.scenes) ? [...screenplay.scenes] : [];
      list[sceneIdx] = { ...list[sceneIdx], ...patch };
      screenplay.scenes = list;
      return { ...chapter, screenplay };
    });
  }, [patchChapter]);

  const updateDialogue = useCallback((pos: number, sceneIdx: number, dlgIdx: number, patch: Partial<DialogueItem>) => {
    scenesEditedRef.current = true;
    patchChapter(pos, (chapter) => {
      const screenplay = chapter.screenplay ? { ...chapter.screenplay } : {};
      const list = Array.isArray(screenplay.scenes) ? [...screenplay.scenes] : [];
      const scene = { ...list[sceneIdx] };
      const dialogues = Array.isArray(scene.dialogues) ? [...scene.dialogues] : [];
      dialogues[dlgIdx] = { ...dialogues[dlgIdx], ...patch };
      scene.dialogues = dialogues;
      list[sceneIdx] = scene;
      screenplay.scenes = list;
      return { ...chapter, screenplay };
    });
  }, [patchChapter]);

  const addDialogue = useCallback((pos: number, sceneIdx: number) => {
    scenesEditedRef.current = true;
    patchChapter(pos, (chapter) => {
      const screenplay = chapter.screenplay ? { ...chapter.screenplay } : {};
      const list = Array.isArray(screenplay.scenes) ? [...screenplay.scenes] : [];
      const scene = { ...list[sceneIdx] };
      const dialogues = Array.isArray(scene.dialogues) ? [...scene.dialogues] : [];
      dialogues.push({ character: '', line: '' });
      scene.dialogues = dialogues;
      list[sceneIdx] = scene;
      screenplay.scenes = list;
      return { ...chapter, screenplay };
    });
  }, [patchChapter]);

  const removeDialogue = useCallback((pos: number, sceneIdx: number, dlgIdx: number) => {
    scenesEditedRef.current = true;
    patchChapter(pos, (chapter) => {
      const screenplay = chapter.screenplay ? { ...chapter.screenplay } : {};
      const list = Array.isArray(screenplay.scenes) ? [...screenplay.scenes] : [];
      const scene = { ...list[sceneIdx] };
      const dialogues = Array.isArray(scene.dialogues) ? [...scene.dialogues] : [];
      dialogues.splice(dlgIdx, 1);
      scene.dialogues = dialogues;
      list[sceneIdx] = scene;
      screenplay.scenes = list;
      return { ...chapter, screenplay };
    });
  }, [patchChapter]);

  const updatePrompt = useCallback((pos: number, kind: 'imagePrompts' | 'videoPrompts', idx: number, patch: Partial<PromptItem>) => {
    patchChapter(pos, (chapter) => {
      const list = Array.isArray(chapter[kind]) ? [...(chapter[kind] as PromptItem[])] : [];
      list[idx] = { ...list[idx], ...patch };
      return { ...chapter, [kind]: list };
    });
  }, [patchChapter]);

  // ---------- 图片 / 视频提示词生成 ----------
  const generatePrompts = useCallback(async (kind: 'image' | 'video', force = false) => {
    if (!detail) return;
    setBusyAction(kind);
    setGenText(kind === 'image' ? '正在生成图片提示词…' : '正在生成视频提示词…');
    try {
      const res = await fetch(kind === 'image' ? '/api/novel/script/image-prompts' : '/api/novel/script/video-prompts', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ scriptId: detail.id, chapterIndex: curPos, ...(force ? { force: true } : {}) }),
      });
      if (!res.body) {
        setGenText('');
        flash('生成失败：没有返回数据流');
        setBusyAction('');
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let lastMsg = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const raw of lines) {
          const trimmed = raw.trim();
          if (!trimmed.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(trimmed.slice(6));
            if (ev.type === 'start') {
              lastMsg = '共 ' + (ev.scenesToGenerate ?? ev.totalScenes ?? 0) + ' 个场景，已跳过 ' + (ev.skippedScenes ?? 0) + ' 个';
            } else if (ev.type === 'scene_start' || ev.type === 'progress') {
              lastMsg = ev.sceneTitle ? ('正在处理：' + ev.sceneTitle) : ('进度 ' + (ev.completed ?? ev.current ?? '') + '/' + (ev.total ?? ev.scenesToGenerate ?? ''));
            } else if (ev.type === 'scene_complete') {
              lastMsg = '已完成 ' + (ev.completed ?? '') + '/' + (ev.total ?? '');
            } else if (ev.type === 'complete' || ev.type === 'done') {
              lastMsg = '生成完成';
            } else if (ev.type === 'error') {
              lastMsg = '出错：' + (ev.message ?? '未知错误');
            }
            setGenText((kind === 'image' ? '图片提示词：' : '视频提示词：') + (lastMsg || '处理中…'));
          } catch {
            // 忽略
          }
        }
      }
      await loadDetail(detail.id, true);
      setTab(kind === 'image' ? 'images' : 'videos');
      flash(kind === 'image' ? '图片提示词已生成' : '视频提示词已生成');
    } catch (e) {
      flash(e instanceof Error ? e.message : '生成失败');
    } finally {
      setBusyAction('');
      setGenText('');
    }
  }, [auth, curPos, detail, flash, loadDetail]);

  generatePromptsRef.current = generatePrompts;

  // ---------- Agent 对话 ----------
  const send = useCallback(async (override?: string) => {
    const prompt = (override ?? input).trim();
    if (!prompt) return;
    if (!activeScript) {
      flash('请先在左侧选择一部剧本');
      return;
    }
    const runNovelId = activeScript.novelId;
    const runScriptId = activeScript.id;
    const sid = await ensureSession(runNovelId, curPos + 1);
    if (!sid) {
      flash('无法创建 Agent 会话，请稍后重试');
      return;
    }
    // 仅禁止「同一会话」重复提交；其它会话可并行执行（多开对话）
    if (runningMap[sid]) { flash('该会话正在执行中，可切换到其它作品/章节并行处理'); return; }
    const isActive = () => activeSidRef.current === sid;
    setInput('');
    setRun(sid, true);
    setStream(sid, '');
    if (isActive()) setMessages((prev) => [...prev, { id: 'u' + Date.now(), kind: 'user', content: prompt }]);
    try {
      const res = await fetch('/api/agent/runs', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({
          sessionId: sid,
          novelId: runNovelId,
          chapterIndex: curPos + 1,
          prompt,
        }),
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '生成失败');
        if (isActive()) setMessages((prev) => [...prev, { id: 'e' + Date.now(), kind: 'error', content: text.slice(0, 300) }]);
        setRun(sid, false);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const raw of lines) {
          const trimmed = raw.trim();
          if (!trimmed.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(trimmed.slice(6));
            const show = isActive();
            if (ev.type === 'intent') {
              if (show) setMessages((prev) => [...prev, { id: 'i' + Date.now(), kind: 'intent', content: ACTION_LABEL[ev.action] ?? ev.action, meta: ev.instruction }]);
            } else if (ev.type === 'change_applied') {
              if (show) setMessages((prev) => [...prev, { id: 'c' + Date.now(), kind: 'change', content: ev.action ?? '', meta: ev.title ?? '' }]);
              void loadChanges(runNovelId);
            } else if (ev.type === 'text_delta') {
              acc += ev.content ?? '';
              setStream(sid, acc);
            } else if (ev.type === 'text_reset') {
              acc = '';
              setStream(sid, '');
            } else if (ev.type === 'tool_result') {
              if (show) setMessages((prev) => [...prev, {
                id: 't' + Date.now(),
                kind: 'tool',
                content: ev.content || ev.summary || '完成',
                meta: ev.toolName || (ev.applied ? '已写回' : ''),
              }]);
              if (show && runScriptId) void loadDetail(runScriptId, true);
              void loadChanges(runNovelId);
            } else if (ev.type === 'run_finished') {
              if (show) {
                if (acc.trim()) setMessages((prev) => [...prev, { id: 'a' + Date.now(), kind: 'assistant', content: acc.trim() }]);
                if (runScriptId) void loadDetail(runScriptId, true);
              }
              setStream(sid, '');
              void loadScripts();
            } else if (ev.type === 'run_error') {
              if (show) setMessages((prev) => [...prev, { id: 'e' + Date.now(), kind: 'error', content: '❌ ' + (ev.message ?? '出错') }]);
            }
          } catch {
            // 忽略
          }
        }
      }
    } catch (e) {
      if (!(e instanceof Error) || e.name !== 'AbortError') {
        if (isActive()) setMessages((prev) => [...prev, { id: 'e' + Date.now(), kind: 'error', content: '❌ ' + (e instanceof Error ? e.message : '网络错误') }]);
      }
    } finally {
      setRun(sid, false);
    }
  }, [activeScript, auth, curPos, ensureSession, flash, input, loadChanges, loadDetail, loadScripts, runningMap, setRun, setStream]);

  // 「生成全部章节」：对尚未生成剧本的章节逐章依次调用 Agent（每章独立请求，含图片/视频提示词）
  const generateAllChapters = useCallback(async () => {
    if (busy || (batch && batch.running)) return;
    if (!activeScript) { flash('请先在左侧选择一部作品'); return; }
    const pendingChs = treeChapters.filter((tc) => !tc.hasScript);
    if (!pendingChs.length) { flash('全部章节都已生成剧本'); return; }
    const go = window.confirm('将为 ' + pendingChs.length + ' 个尚未生成的章节依次生成剧本（含图片/视频提示词），每章约需 1~2 分钟，期间请勿关闭页面。是否继续？');
    if (!go) return;
    const novelId = activeScript.novelId;
    setBatch({ running: true, done: 0, total: pendingChs.length });
    for (let i = 0; i < pendingChs.length; i++) {
      const ch = pendingChs[i];
      setCurPos(ch.pos);
      try {
        await send('把第' + ch.num + '章生成剧本');
      } catch { /* 单章失败继续下一章 */ }
      setBatch({ running: true, done: i + 1, total: pendingChs.length });
      await new Promise((r) => window.setTimeout(r, 500));
    }
    setBatch({ running: false, done: pendingChs.length, total: pendingChs.length });
    flash('已依次处理 ' + pendingChs.length + ' 个章节');
    void loadScripts();
    if (novelId) void loadNovelChapters(novelId);
  }, [activeScript, batch, busy, flash, loadNovelChapters, loadScripts, send, treeChapters]);

  // 自动滚动到底部
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, streamPart]);

  // Agent 生成期间实时刷新剧本内容（本地有未保存修改时不覆盖）
  useEffect(() => {
    if (!busy || !activeScript) return;
    const timer = window.setInterval(() => {
      if (dirtyRef.current) return;
      void loadDetail(activeScript.id, true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [busy, activeScript, loadDetail]);

  // 通用兜底：提示词与场景条数不一致时（如经 pipeline 重新生成剧本）自动按当前场景重新生成，保证提示词跟随剧本
  const autoSyncTriedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!detail || busy || busyAction !== '') return;
    if (scenesEditedRef.current) return;
    const cur = chapters[curPos];
    if (!cur) return;
    const scenes = Array.isArray(cur.screenplay?.scenes) ? cur.screenplay.scenes : [];
    if (!scenes.length) return;
    const img = Array.isArray(cur.imagePrompts) ? cur.imagePrompts : [];
    const vid = Array.isArray(cur.videoPrompts) ? cur.videoPrompts : [];
    const needImg = img.length > 0 && img.length !== scenes.length;
    const needVid = vid.length > 0 && vid.length !== scenes.length;
    if (!needImg && !needVid) return;
    const key = detail.id + ':' + curPos;
    if (autoSyncTriedRef.current.has(key)) return;
    const gp = generatePromptsRef.current;
    if (!gp) return;
    autoSyncTriedRef.current.add(key);
    flash('检测到提示词与场景不一致，正在自动同步…');
    void (async () => {
      try {
        if (needImg) await gp('image', true);
        if (needVid) await gp('video', true);
        flash('图片/视频提示词已随场景自动同步');
      } catch { /* 忽略，用户可手动重试 */ }
    })();
  }, [detail, chapters, curPos, busy, busyAction, flash]);

  const deleteScript = useCallback(async (item: ScriptListItem) => {
    setPendingDelete(null);
    try {
      const res = await fetch('/api/novel/script?scriptId=' + encodeURIComponent(item.id), {
        method: 'DELETE',
        headers: auth(false),
      });
      const data = await res.json();
      if (data && data.success) {
        if (activeId === item.id) {
          setActiveId(null);
          setDetail(null);
          setNovelChapters([]);
        }
        flash('剧本已删除');
        void loadScripts();
      } else {
        flash((data && data.error) || '删除失败');
      }
    } catch {
      flash('删除失败');
    }
  }, [activeId, auth, flash, loadScripts]);

  const keyword = query.trim().toLowerCase();
  const filteredScripts = useMemo(() => {
    if (!keyword) return scripts;
    return scripts.filter((item) => {
      const text = [item.novelTitle].filter(Boolean).join(' ').toLowerCase();
      return text.includes(keyword);
    });
  }, [keyword, scripts]);

  const totalScenes = scenes.length;
  const metaCompleteScenes = scenes.filter((scene) =>
    (['location', 'shotType', 'cameraAngle', 'duration', 'cameraMovement'] as const)
      .every((key) => String(scene[key] || '').trim())
  ).length;
  const totalChars = useMemo(() => {
    const parts: string[] = [];
    for (const scene of scenes) {
      parts.push(String(scene.description || ''), String(scene.actions || ''), String(scene.stageDirections || ''));
      const dialogues = Array.isArray(scene.dialogues) ? scene.dialogues : [];
      for (const d of dialogues) parts.push(String(d.line || ''));
    }
    return parts.join('').replace(/\s/g, '').length;
  }, [scenes]);

  const curTree = treeChapters.find((t) => t.pos === curPos);
  const curTitle = curTree ? curTree.title : chapterTitleOf(curChapter, curPos);
  const curNum = curTree ? curTree.num : chapterNum(curChapter, curPos);
  const imagePrompts = Array.isArray(curChapter?.imagePrompts) ? (curChapter?.imagePrompts as PromptItem[]) : [];
  const videoPrompts = Array.isArray(curChapter?.videoPrompts) ? (curChapter?.videoPrompts as PromptItem[]) : [];


  return (
    <div className="flex flex-col" style={{ background: '#0b0a1f', height: '100vh' }}>
      <header className="shrink-0 border-b border-white/10 flex items-center gap-3 px-4 py-2" style={{ background: '#0f0c29' }}>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-lg">🎬</span>
          <span className="text-sm font-bold text-white">剧本工作区</span>
          <span className="text-[11px] text-gray-500">（Agent 实时对话 · 场景编辑 · 变更追踪）</span>
        </div>
        <div className="relative flex-1 max-w-[460px]">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-500">🔍</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索剧本（按小说标题）…"
            className="w-full pl-7 pr-8 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 outline-none focus:border-amber-500/50"
          />
          {query ? (
            <button onClick={() => setQuery('')} aria-label="清空搜索" className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300">✕</button>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {activeScript ? (
            <a
              href={'/script?novelId=' + encodeURIComponent(activeScript.novelId)}
              className="px-3 py-1.5 rounded-lg text-[11px] text-amber-200 border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
            >
              打开完整剧本工坊
            </a>
          ) : null}
          <SideDockNav title="导航" />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* ===== 左栏：剧本 + 章节 ===== */}
        <aside className="w-60 shrink-0 border-r border-white/10 flex flex-col">
          <div className="px-3 py-2 text-[11px] text-gray-400 border-b border-white/10 flex items-center justify-between">
            <span>剧本列表</span>
            <span className="text-gray-600">{filteredScripts.length}/{scripts.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loadingScripts ? (
              <p className="text-[11px] text-gray-500 p-2">加载中…</p>
            ) : listError ? (
              <div className="p-2 space-y-2">
                <p className="text-[11px] text-red-300">{listError}</p>
                <button onClick={() => void loadScripts()} className="text-[11px] text-amber-300 hover:text-amber-200">重试</button>
              </div>
            ) : filteredScripts.length === 0 ? (
              <div className="p-2 space-y-2">
                <p className="text-[11px] text-gray-500">{scripts.length === 0 ? '还没有剧本，先到小说库生成剧本' : '没有匹配的剧本'}</p>
                {scripts.length === 0 ? (
                  <a href="/my-novels" className="inline-block px-2.5 py-1 rounded-lg text-[11px] text-amber-200 border border-amber-500/30 hover:bg-amber-500/10 transition-colors">前往小说库</a>
                ) : null}
              </div>
            ) : (
              filteredScripts.map((item) => {
                const isActive = (item.id || ('pending-' + item.novelId)) === activeId;
                const st = STATUS_MAP[item.status] || STATUS_MAP.draft;
                return (
                  <div key={item.id || ('pending-' + item.novelId)} className="rounded-lg">
                    <button
                      onClick={() => {
                        if (isActive) { setTocOpen((v) => !v); } else { void openScript(item); }
                      }}
                      title={item.pending ? '该作品还没有剧本，点击展开章节，用中间 Agent 生成' : (isActive ? (tocOpen ? '点击收起章节目录' : '点击展开章节目录') : '点击打开剧本')}
                      className={'w-full text-left px-3 py-2 rounded-lg transition-colors ' + (isActive ? 'bg-amber-500/20 text-amber-100 border border-amber-500/40' : 'text-gray-300 hover:bg-white/5')}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className={'shrink-0 text-[9px] transition-transform ' + (isActive && tocOpen ? 'rotate-90' : '')}>▶</span>
                        <span className="min-w-0 flex-1 truncate text-xs">{item.novelTitle ? '《' + item.novelTitle + '》' : '未命名小说'}</span>
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-[10px] text-gray-500">
                        <span className={'px-1.5 py-0.5 rounded-full ' + st.color}>{item.status === 'generating' ? '生成中 ' + (item.generatedChapterCount || 0) + '/' + (item.novelChapterCount || 0) : st.label}</span>
                        <span>{item.novelChapterCount || item.chapterCount} 章</span>
                        {item.hasImagePrompts ? <span className="text-sky-400">图</span> : null}
                        {item.hasVideoPrompts ? <span className="text-violet-400">视</span> : null}
                      </span>
                    </button>
                    {isActive && tocOpen && treeChapters.length > 0 ? (
                      <div className="ml-3 mt-1 space-y-0.5 border-l border-white/10 pl-2">
                        <div className="flex items-center justify-between gap-1 pb-1">
                          <button
                            onClick={() => void generateAllChapters()}
                            disabled={busy || !!(batch && batch.running)}
                            title="为所有尚未生成的章节依次生成剧本"
                            className="px-2 py-0.5 rounded text-[10px] text-emerald-200 border border-emerald-500/30 hover:bg-emerald-500/10 disabled:opacity-40 whitespace-nowrap transition-colors"
                          >
                            {batch && batch.running ? '生成中 ' + batch.done + '/' + batch.total : '⚡ 生成全部章节'}
                          </button>
                          <span className="text-[10px] text-gray-600 whitespace-nowrap">{treeChapters.filter((tc) => !tc.hasScript).length} 待生成</span>
                        </div>
                        {treeChapters.map((tc) => (
                          <button
                            key={'ch' + tc.pos}
                            onClick={() => {
                              if (dirty) void saveChapters(true);
                              void switchChapter(tc.pos);
                              if (!tc.hasScript) window.setTimeout(() => agentInputRef.current?.focus(), 50);
                            }}
                            className={'w-full text-left px-2 py-1 rounded text-[11px] transition-colors flex items-center justify-between gap-2 ' + (curPos === tc.pos ? 'text-amber-200 bg-amber-500/15' : 'text-gray-500 hover:text-gray-300')}
                          >
                            <span className={'min-w-0 truncate ' + (tc.hasScript ? '' : 'opacity-60')}>第{tc.num}章 {tc.title}</span>
                            <span className="shrink-0 text-[10px] text-gray-600">{tc.hasScript ? tc.scenes + '场' : '待生成'}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-white/10 p-2">
            {pendingDelete ? (
              <div className="space-y-1.5">
                <p className="text-[11px] text-red-300">确认删除《{pendingDelete.novelTitle}》的剧本？</p>
                <div className="flex gap-1.5">
                  <button onClick={() => void deleteScript(pendingDelete)} className="flex-1 px-2 py-1 rounded text-[11px] bg-red-500/20 text-red-200 hover:bg-red-500/30 transition-colors">确认删除</button>
                  <button onClick={() => setPendingDelete(null)} className="flex-1 px-2 py-1 rounded text-[11px] text-gray-400 hover:bg-white/5 transition-colors">取消</button>
                </div>
              </div>
            ) : activeScript && activeScript.id ? (
              <button
                onClick={() => setPendingDelete(activeScript)}
                className="w-full px-2 py-1.5 rounded text-[11px] text-red-300 border border-red-500/25 hover:bg-red-500/10 transition-colors"
              >
                删除该剧本
              </button>
            ) : (
              <p className="text-[10px] text-gray-600 px-1">选中剧本后可删除</p>
            )}
          </div>
        </aside>

        {/* ===== 中栏：Agent 对话 + 变更时间线 ===== */}
        <div className="relative shrink-0 border-r border-white/10 flex flex-col min-w-0" style={{ width: agentWidth }}>
          <div
            onMouseDown={startAgentResize}
            title="拖动调整对话栏宽度"
            className="absolute top-0 -right-[3px] h-full w-[6px] cursor-col-resize z-30 group/resize"
          >
            <div className="absolute inset-y-1 left-1/2 -translate-x-1/2 w-[2px] rounded-full bg-transparent group-hover/resize:bg-amber-500/60 transition-colors" />
          </div>
          <div className="px-3 py-2 text-[11px] text-gray-400 border-b border-white/10 flex items-center justify-between">
            <span>Agent 实时对话</span>
            <span className="text-gray-600 truncate max-w-[150px]">{activeScript ? '《' + activeScript.novelTitle + '》' : '未选择剧本'}</span>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 && !streamPart ? (
              <div className="text-center text-gray-500 text-xs mt-8 space-y-2">
                <p className="text-2xl">🤖</p>
                <p>告诉我做什么，我会实时改编剧本并记录变更</p>
                <div className="flex flex-wrap justify-center gap-1.5 pt-1">
                  {QUICK_COMMANDS.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => void send(ex)}
                      className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-full text-[11px] text-amber-200 hover:bg-amber-500/20 transition-colors"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-600 pt-1">支持：生成剧本 · 重排场景拆分 · 补充对白 · 生成图片/视频提示词</p>
                <p className="text-[10px] text-gray-600">提示：先在左侧选中剧本与章节，Agent 才知道要改哪一部</p>
              </div>
            ) : null}

            {messages.map((msg) => {
              if (msg.kind === 'user') {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm bg-gradient-to-r from-amber-600 to-orange-600 text-white text-xs whitespace-pre-wrap break-words">{msg.content}</div>
                  </div>
                );
              }
              if (msg.kind === 'intent' || msg.kind === 'change') {
                return (
                  <div key={msg.id} className="flex justify-start">
                    <div className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-gray-300">
                      {msg.content}{msg.meta ? <span className="text-gray-500"> · {msg.meta}</span> : null}
                    </div>
                  </div>
                );
              }
              if (msg.kind === 'tool') {
                return (
                  <div key={msg.id} className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2">
                    <div className="text-[10px] text-emerald-300 mb-1">{msg.meta || '工具'}</div>
                    <pre className="whitespace-pre-wrap break-words text-[11px] text-gray-200 font-sans">{msg.content}</pre>
                  </div>
                );
              }
              return (
                <div key={msg.id} className="flex justify-start">
                  <div className={'max-w-[92%] px-3 py-2 rounded-2xl rounded-bl-sm text-xs whitespace-pre-wrap break-words ' + (msg.kind === 'error' ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-white/5 text-gray-200 border border-white/10')}>
                    {msg.content}
                  </div>
                </div>
              );
            })}

            {streamPart ? (
              <div className="flex justify-start">
                <div className="max-w-[92%] px-3 py-2 rounded-2xl rounded-bl-sm bg-white/5 border border-white/10 text-xs text-gray-200 whitespace-pre-wrap break-words">
                  {streamPart}
                  <span className="inline-block w-1.5 h-3 ml-0.5 align-middle bg-amber-400 animate-pulse" />
                </div>
              </div>
            ) : null}

            {busy && !streamPart ? (
              <div className="text-[11px] text-gray-500">执行中…</div>
            ) : null}
          </div>

          <div className="border-t border-white/10 p-2 space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {QUICK_COMMANDS.slice(0, 3).map((cmd) => (
                <button
                  key={'q' + cmd}
                  onClick={() => void send(cmd)}
                  disabled={busy || !activeScript}
                  className="px-2 py-0.5 rounded-full text-[10px] text-gray-400 border border-white/10 hover:bg-white/5 disabled:opacity-40 transition-colors"
                >
                  {cmd}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                ref={agentInputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                placeholder="告诉我要做什么，我会自主完成…（Enter 发送）"
                className="flex-1 px-2.5 py-2 text-xs bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 outline-none focus:border-amber-500/50 resize-none"
              />
              <button
                onClick={() => void send()}
                disabled={busy || !input.trim()}
                className="px-3 py-2 rounded-lg text-xs font-medium text-white bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-40 transition-all"
              >
                {busy ? '执行中' : '发送 ➤'}
              </button>
            </div>
          </div>

          <div className="border-t border-white/10 max-h-[152px] flex flex-col">
            <div className="px-3 py-1.5 text-[11px] text-gray-400 border-b border-white/10">剧本变更 · {changes.length} 条</div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {changes.length === 0 ? (
                <p className="text-[10px] text-gray-600 px-1">暂无变更记录，Agent 每次改编都会留痕</p>
              ) : (
                changes.slice(0, 40).map((item, idx) => (
                  <div key={(item.id || 'c') + idx} className="flex items-center gap-2 text-[10px] text-gray-400">
                    <span className="text-emerald-400">✓</span>
                    <span className="min-w-0 flex-1 truncate">{item.title || item.action || '变更'}</span>
                    <span className="shrink-0 text-gray-600">{item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ===== 右栏：剧本编辑 ===== */}
        <section className="flex-1 min-w-0 flex flex-col">
          <div className="shrink-0 border-b border-white/10 px-3 py-2 flex items-center gap-3">
            <div className="min-w-0">
              <div className="text-sm text-white font-semibold truncate">
                {activeScript ? '第' + curNum + '章 ' + curTitle : '未选择剧本'}
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">
                {activeScript
                  ? (detailLoading ? '加载中…' : totalScenes + ' 个场景 · ' + totalChars + ' 字 · 场景数据 ' + metaCompleteScenes + '/' + totalScenes + ' 完整 · 图片提示词 ' + imagePrompts.length + ' 条 · 视频提示词 ' + videoPrompts.length + ' 条')
                  : '请在左侧选择一部剧本'}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {genText ? <span className="text-[10px] text-sky-300 max-w-[240px] truncate">{genText}</span> : null}
              {dirty ? <span className="text-[10px] text-amber-300">有未保存修改</span> : <span className="text-[10px] text-gray-500">已保存</span>}
              <button
                onClick={() => void saveChapters()}
                disabled={!activeScript || busyAction === 'save' || !dirty}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-white bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-40 transition-all"
              >
                {busyAction === 'save' ? '保存中…' : '保存'}
              </button>
            </div>
          </div>

          <div className="shrink-0 border-b border-white/10 px-3 py-2 flex flex-wrap items-center gap-1.5">
            {([
              { key: 'scenes', label: '剧本场景' },
              { key: 'images', label: '图片提示词' },
              { key: 'videos', label: '视频提示词' },
            ] as { key: 'scenes' | 'images' | 'videos'; label: string }[]).map((item) => (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={'px-2.5 py-1 rounded-lg text-[11px] transition-colors ' + (tab === item.key ? 'bg-amber-500/20 text-amber-100 border border-amber-500/40' : 'text-gray-400 border border-white/10 hover:bg-white/5')}
              >
                {item.label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-white/10" />
            <button
              onClick={() => void generatePrompts('image', imagePrompts.length > 0)}
              disabled={!activeScript?.id || busyAction === 'image' || totalScenes === 0}
              className="px-2.5 py-1 rounded-lg text-[11px] text-sky-200 border border-sky-500/30 hover:bg-sky-500/10 disabled:opacity-40 transition-colors"
            >
              {busyAction === 'image' ? '生成中…' : (imagePrompts.length > 0 ? '重刷图片提示词' : '生成图片提示词')}
            </button>
            <button
              onClick={() => void generatePrompts('video', videoPrompts.length > 0)}
              disabled={!activeScript?.id || busyAction === 'video' || totalScenes === 0}
              className="px-2.5 py-1 rounded-lg text-[11px] text-violet-200 border border-violet-500/30 hover:bg-violet-500/10 disabled:opacity-40 transition-colors"
            >
              {busyAction === 'video' ? '生成中…' : (videoPrompts.length > 0 ? '重刷视频提示词' : '生成视频提示词')}
            </button>
            <button
              onClick={() => void send('补齐本章所有场景的数据：地点、景别、机位、时长、镜头运动，不要改动画面、动作与对白')}
              disabled={!activeScript || busy || totalScenes === 0}
              title="让 Agent 为每个场景补齐地点/景别/机位/时长/镜头运动，并自动同步图片与视频提示词"
              className="px-2.5 py-1 rounded-lg text-[11px] text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/10 disabled:opacity-40 transition-colors"
            >
              补全场景数据
            </button>
            <button
              onClick={() => void send('把这一章生成剧本')}
              disabled={!activeScript || busy}
              className="px-2.5 py-1 rounded-lg text-[11px] text-emerald-200 border border-emerald-500/30 hover:bg-emerald-500/10 disabled:opacity-40 transition-colors"
            >
              Agent 重新改编本章
            </button>
            {activeScript ? (
              <a
                href={'/script?novelId=' + encodeURIComponent(activeScript.novelId)}
                className="px-2.5 py-1 rounded-lg text-[11px] text-gray-300 border border-white/10 hover:bg-white/5 transition-colors"
              >
                完整工坊
              </a>
            ) : null}
            {activeScript && activeScript.id ? (
              <button
                onClick={() => void loadDetail(activeScript.id)}
                className="px-2.5 py-1 rounded-lg text-[11px] text-gray-300 border border-white/10 hover:bg-white/5 transition-colors"
              >
                重新载入
              </button>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {!activeScript ? (
              <div className="text-center py-20 text-gray-500 text-sm">请在左侧选择一部剧本开始编辑</div>
            ) : detailError ? (
              <div className="text-sm text-red-300">{detailError}</div>
            ) : tab === 'scenes' ? (
              scenes.length === 0 ? (
                <div className="text-center py-16 text-gray-500 text-xs space-y-3">
                  <p className="text-3xl">🎬</p>
                  <p>这一章还没有剧本内容</p>
                  <button
                    onClick={() => void send('把这一章生成剧本')}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-lg text-xs text-white bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-40 transition-all"
                  >
                    让 Agent 生成这一章剧本
                  </button>
                </div>
              ) : (
                scenes.map((scene, idx) => {
                  const scKey = curPos + '-' + idx;
                  const collapsed = collapsedScenes.has(scKey);
                  const filled = (['location', 'shotType', 'cameraAngle', 'duration', 'cameraMovement'] as const)
                    .filter((key) => String(scene[key] || '').trim()).length;
                  const dialogueList = Array.isArray(scene.dialogues) ? scene.dialogues : [];
                  const labelCls = (value: unknown) =>
                    'block mb-0.5 text-[10px] ' + (String(value || '').trim() ? 'text-gray-500' : 'text-amber-300/80');
                  const todo = (value: unknown) => (String(value || '').trim() ? '' : ' · 待补');
                  return (
                    <div key={'sc' + idx} className="rounded-2xl border border-white/10 overflow-hidden" style={{ background: 'rgba(255,255,255,0.035)' }}>
                      {/* 场景头部：序号 / 标题 / 概要 / 完整度 */}
                      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-white/[0.07]" style={{ background: 'rgba(245,158,11,0.06)' }}>
                        <button
                          type="button"
                          onClick={() => setCollapsedScenes((prev) => {
                            const next = new Set(prev);
                            if (next.has(scKey)) next.delete(scKey); else next.add(scKey);
                            return next;
                          })}
                          title={collapsed ? '展开本场景' : '收起本场景'}
                          className="shrink-0 w-5 h-5 rounded-md text-[10px] text-gray-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
                        >
                          {collapsed ? '▶' : '▼'}
                        </button>
                        <span className="shrink-0 w-6 h-6 rounded-lg bg-amber-500/20 text-amber-200 text-[11px] flex items-center justify-center font-semibold">{idx + 1}</span>
                        <input
                          value={scene.sceneTitle || ''}
                          onChange={(event) => updateScene(curPos, idx, { sceneTitle: event.target.value })}
                          placeholder="场景标题（未命名）"
                          title="场景标题"
                          className="flex-1 min-w-0 px-1.5 py-0.5 text-xs font-semibold bg-transparent border border-transparent rounded text-white placeholder:text-gray-500 placeholder:font-normal outline-none hover:border-white/15 focus:border-amber-500/50 focus:bg-white/5"
                        />
                        {collapsed ? (
                          <span className="shrink-0 max-w-[36%] truncate text-[10px] text-gray-500">{scene.description || '（无画面描述）'}</span>
                        ) : null}
                        <span className="shrink-0 text-[10px] text-gray-500">对白 {dialogueList.length}</span>
                        <span
                          title="地点/景别/机位/时长/镜头运动 五项数据的填写情况，缺失会导致图片/视频提示词无法对应该场景"
                          className={'shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-medium ' + (filled === 5 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300')}
                        >
                          数据 {filled}/5
                        </span>
                      </div>

                      {collapsed ? null : (
                        <div className="p-2.5 space-y-2.5">
                          {/* 镜头参数区 */}
                          <div className="rounded-xl border border-white/[0.07] p-2" style={{ background: 'rgba(255,255,255,0.02)' }}>
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className="text-[10px] font-medium text-amber-200">镜头参数</span>
                              <span className="text-[10px] text-gray-600">图片 / 视频提示词严格按这里的取值生成</span>
                            </div>
                            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
                              <label className="block min-w-0">
                                <span className={labelCls(scene.location)}>地点{todo(scene.location)}</span>
                                <input value={scene.location || ''} onChange={(event) => updateScene(curPos, idx, { location: event.target.value })} placeholder="如：废弃村落村口" title="具体地点，如「废弃村落村口」" className={inputCls} />
                              </label>
                              <label className="block min-w-0">
                                <span className={labelCls(scene.shotType)}>景别{todo(scene.shotType)}</span>
                                <input list="scene-shot-type-list" value={scene.shotType || ''} onChange={(event) => updateScene(curPos, idx, { shotType: event.target.value })} placeholder="远景/全景/中景…" title="远景/全景/中景/近景/特写/过肩镜头" className={inputCls} />
                              </label>
                              <label className="block min-w-0">
                                <span className={labelCls(scene.cameraAngle)}>机位{todo(scene.cameraAngle)}</span>
                                <input list="scene-camera-angle-list" value={scene.cameraAngle || ''} onChange={(event) => updateScene(curPos, idx, { cameraAngle: event.target.value })} placeholder="正面/侧面/俯拍…" title="正面/侧面/斜侧/俯拍/仰拍/过肩" className={inputCls} />
                              </label>
                              <label className="block min-w-0">
                                <span className={labelCls(scene.duration)}>时长{todo(scene.duration)}</span>
                                <input list="scene-duration-list" value={scene.duration || ''} onChange={(event) => updateScene(curPos, idx, { duration: event.target.value })} placeholder="如：6秒" title="如 4秒 / 6秒 / 8秒" className={inputCls} />
                              </label>
                              <label className="block min-w-0">
                                <span className={labelCls(scene.cameraMovement)}>镜头运动{todo(scene.cameraMovement)}</span>
                                <input list="scene-camera-movement-list" value={scene.cameraMovement || ''} onChange={(event) => updateScene(curPos, idx, { cameraMovement: event.target.value })} placeholder="固定/推镜/拉镜…" title="固定/推镜/拉镜/摇镜/跟镜" className={inputCls} />
                              </label>
                            </div>
                          </div>

                          {/* 画面 / 动作 */}
                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                            <label className="block min-w-0">
                              <span className="block mb-0.5 text-[10px] text-gray-500">画面描述 <span className="text-gray-600">· 场景里看到什么</span></span>
                              <AutoTextarea
                                value={scene.description || ''}
                                onChange={(next) => updateScene(curPos, idx, { description: next })}
                                placeholder="环境、人物、光线、色调…"
                                className={inputCls + ' overflow-hidden leading-relaxed'}
                              />
                            </label>
                            <label className="block min-w-0">
                              <span className="block mb-0.5 text-[10px] text-gray-500">角色动作 <span className="text-gray-600">· 谁在做什么</span></span>
                              <AutoTextarea
                                value={scene.actions || ''}
                                onChange={(next) => updateScene(curPos, idx, { actions: next })}
                                placeholder="人物动作与场面调度…"
                                className={inputCls + ' overflow-hidden leading-relaxed'}
                              />
                            </label>
                          </div>

                          {/* 对白区 */}
                          <div className="rounded-xl border border-white/[0.07] p-2" style={{ background: 'rgba(255,255,255,0.02)' }}>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-medium text-sky-200">对白 <span className="text-gray-600">· 共 {dialogueList.length} 句</span></span>
                              <button type="button" onClick={() => addDialogue(curPos, idx)} className="text-[10px] text-amber-300 hover:text-amber-200">+ 添加对白</button>
                            </div>
                            <div className="space-y-1.5">
                              {dialogueList.map((dlg, dIdx) => (
                                <div key={'d' + dIdx} className="flex items-start gap-1.5">
                                  <span className="shrink-0 w-4 text-right text-[10px] text-gray-600">{dIdx + 1}</span>
                                  <input
                                    value={dlg.character || ''}
                                    onChange={(event) => updateDialogue(curPos, idx, dIdx, { character: event.target.value })}
                                    placeholder="角色名"
                                    title="角色名"
                                    className="w-20 shrink-0 px-2 py-1 text-[11px] bg-amber-500/10 border border-amber-500/20 rounded text-amber-100 placeholder:text-amber-200/40 outline-none focus:border-amber-500/50"
                                  />
                                  <AutoTextarea
                                    value={dlg.line || ''}
                                    onChange={(next) => updateDialogue(curPos, idx, dIdx, { line: next })}
                                    placeholder="台词内容"
                                    minRows={1}
                                    className="flex-1 min-w-0 px-2 py-1 text-[11px] bg-white/5 border border-white/10 rounded text-gray-200 placeholder:text-gray-600 outline-none focus:border-sky-500/50 overflow-hidden leading-relaxed"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeDialogue(curPos, idx, dIdx)}
                                    title="删除这句对白"
                                    className="shrink-0 w-5 h-5 rounded-md text-gray-600 hover:text-red-300 hover:bg-red-500/10 flex items-center justify-center transition-colors"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                              {dialogueList.length === 0 ? (
                                <p className="pl-6 text-[10px] text-gray-600">本场暂无对白，可点右上「+ 添加对白」，或让 Agent「补充对白」</p>
                              ) : null}
                            </div>
                          </div>

                          {/* 音效 / 舞台提示 */}
                          <label className="block min-w-0">
                            <span className="block mb-0.5 text-[10px] text-gray-500">音效 / 舞台提示 <span className="text-gray-600">· 光线、环境音、转场</span></span>
                            <AutoTextarea
                              value={scene.stageDirections || ''}
                              onChange={(next) => updateScene(curPos, idx, { stageDirections: next })}
                              placeholder="例如：雨声渐强，冷蓝月光，镜头缓慢推进"
                              minRows={1}
                              className={inputCls + ' overflow-hidden leading-relaxed'}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })
              )
            ) : (tab === 'images' ? imagePrompts : videoPrompts).length === 0 ? (
              <div className="text-center py-16 text-gray-500 text-xs space-y-3">
                <p className="text-3xl">{tab === 'images' ? '🖼️' : '🎥'}</p>
                <p>{tab === 'images' ? '这一章还没有图片提示词' : '这一章还没有视频提示词'}</p>
                <button
                  onClick={() => void generatePrompts(tab === 'images' ? 'image' : 'video')}
                  disabled={busyAction !== '' || totalScenes === 0}
                  className="px-3 py-1.5 rounded-lg text-xs text-white bg-gradient-to-r from-sky-600 to-violet-600 hover:from-sky-500 hover:to-violet-500 disabled:opacity-40 transition-all"
                >
                  立即生成
                </button>
              </div>
            ) : (
              <>
              {(() => {
                // 视频提示词按子镜头拆分，条数本就可以多于场景数：
                // 这里按「场景覆盖数」判断是否与最新剧本脱节，避免误报「场景已变化」
                const list = tab === 'images' ? imagePrompts : videoPrompts;
                if (totalScenes === 0 || list.length === 0) return null;
                const covered = new Set(list.map((p) => String(p.sceneIndex ?? '')).filter(Boolean));
                if (covered.size >= totalScenes) return null;
                return (
                  <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                    <span className="text-[11px] text-amber-200">
                      ⚠ 场景已变化：当前 {totalScenes} 个场景，现有 {list.length} 条{tab === 'images' ? '图片' : '视频'}提示词，仅覆盖 {covered.size}/{totalScenes} 个场景
                    </span>
                    <button
                      onClick={() => void generatePrompts(tab === 'images' ? 'image' : 'video', true)}
                      disabled={busyAction !== ''}
                      className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] text-white bg-gradient-to-r from-sky-600 to-violet-600 hover:from-sky-500 hover:to-violet-500 disabled:opacity-40 transition-all"
                    >
                      按场景重新生成
                    </button>
                  </div>
                );
              })()}
              {(tab === 'images' ? imagePrompts : videoPrompts).map((prompt, pIdx) => (
                <div key={'p' + pIdx} className="rounded-xl border border-white/10 p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={'shrink-0 px-2 py-0.5 rounded-md text-[10px] ' + (tab === 'images' ? 'bg-sky-500/20 text-sky-200' : 'bg-violet-500/20 text-violet-200')}>
                      场景 {prompt.sceneIndex ?? pIdx + 1}
                    </span>
                    <span className="text-xs text-white truncate flex-1">{prompt.sceneTitle || ''}</span>
                    <span className="shrink-0 text-[10px] text-gray-500">{prompt.shotType || ''}</span>
                  </div>
                  {prompt.location || prompt.cameraAngle ? (
                    <p className="text-[10px] text-gray-500 mb-1.5">{[prompt.location, prompt.cameraAngle ? '机位 ' + prompt.cameraAngle : ''].filter(Boolean).join(' · ')}</p>
                  ) : null}
                  {prompt.description ? <p className="text-[11px] text-gray-400 mb-1.5">{prompt.description}</p> : null}
                  {tab === 'videos' && (prompt.duration || prompt.subShotIndex) ? (
                    <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                      {prompt.duration ? <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-amber-500/15 text-amber-200">时长 {prompt.duration}</span> : null}
                      {prompt.subShotIndex ? <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-white/10 text-gray-300">镜头 {prompt.subShotIndex}</span> : null}
                    </div>
                  ) : null}
                  <AutoTextarea
                    value={prompt.prompt || ''}
                    onChange={(next) => updatePrompt(curPos, tab === 'images' ? 'imagePrompts' : 'videoPrompts', pIdx, { prompt: next })}
                    className={inputCls + ' overflow-hidden leading-relaxed'}
                  />
                  {prompt.negativePrompt ? (
                    <p className="text-[10px] text-gray-600 mt-1.5">负向：{prompt.negativePrompt}</p>
                  ) : null}
                  {tab === 'videos' && (prompt.startFrame || prompt.action || prompt.endFrame || prompt.transition || prompt.dialogueRange) ? (
                    <div className="mt-1.5 space-y-0.5">
                      {prompt.startFrame ? <p className="text-[10px] text-gray-500">起始画面：{prompt.startFrame}</p> : null}
                      {prompt.cameraMovement ? <p className="text-[10px] text-gray-500">运镜：{prompt.cameraMovement}</p> : null}
                      {prompt.action ? <p className="text-[10px] text-gray-500">动作：{prompt.action}</p> : null}
                      {prompt.endFrame ? <p className="text-[10px] text-gray-500">结束画面：{prompt.endFrame}</p> : null}
                      {prompt.transition ? <p className="text-[10px] text-gray-500">转场：{prompt.transition}</p> : null}
                      {prompt.dialogueRange ? <p className="text-[10px] text-gray-500">对白范围：{prompt.dialogueRange}</p> : null}
                    </div>
                  ) : null}
                </div>
              ))}
              </>
            )}
          </div>
        </section>
      </div>


      <datalist id="scene-shot-type-list">
        {['远景', '全景', '中景', '近景', '特写', '过肩镜头'].map((option) => <option key={option} value={option} />)}
      </datalist>
      <datalist id="scene-camera-angle-list">
        {['正面', '侧面', '斜侧', '俯拍', '仰拍', '过肩'].map((option) => <option key={option} value={option} />)}
      </datalist>
      <datalist id="scene-camera-movement-list">
        {['固定', '推镜', '拉镜', '摇镜', '跟镜'].map((option) => <option key={option} value={option} />)}
      </datalist>
      <datalist id="scene-duration-list">
        {['4秒', '5秒', '6秒', '8秒', '10秒'].map((option) => <option key={option} value={option} />)}
      </datalist>

      {toast ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9000] px-4 py-2 rounded-xl text-xs text-white shadow-lg" style={{ background: 'rgba(15,12,41,0.95)', border: '1px solid rgba(245,158,11,0.35)' }}>
          {toast}
        </div>
      ) : null}
    </div>
  );
}
