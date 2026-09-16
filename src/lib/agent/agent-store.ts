// Agent 数据存取层：基于 better-sqlite3 原生查询（新建表在 storage/database/sqlite.ts）
import { sqlite } from '@/storage/database/sqlite';
import { novelManager } from '@/storage/database';
import type {
  AgentSession,
  AgentMessage,
  AgentRun,
  ChapterRef,
} from './types';

function genId(prefix: string): string {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

/** 会话作用域默认值（历史数据均归入创作工作区） */
const DEFAULT_AGENT_SCOPE = 'studio';

function now(): string {
  return new Date().toISOString();
}

interface SessionRow {
  id: string; user_id: string; novel_id: string | null; title: string;
  status: string; chapter_index: number | null; scope: string | null;
  created_at: string; updated_at: string;
  novel_title: string | null;
}
function mapSession(r: SessionRow): AgentSession {
  return {
    id: r.id, userId: r.user_id, novelId: r.novel_id, title: r.title, status: r.status,
    chapterIndex: r.chapter_index ?? null, scope: r.scope ?? DEFAULT_AGENT_SCOPE,
    createdAt: r.created_at, updatedAt: r.updated_at,
    novelTitle: r.novel_title ?? '',
  };
}

// ---------- sessions ----------
export function createAgentSession(userId: string, input: { novelId?: string; chapterIndex?: number; title?: string; scope?: string }): AgentSession {
  const id = genId('agent_s');
  const title = input.title?.trim() || '新对话';
  sqlite.prepare(
    `INSERT INTO agent_sessions (id, user_id, novel_id, title, status, chapter_index, scope, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  ).run(id, userId, input.novelId ?? null, title, input.chapterIndex ?? null, input.scope ?? DEFAULT_AGENT_SCOPE, now(), now());
  const row = sqlite.prepare('SELECT s.*, n.title AS novel_title FROM agent_sessions s LEFT JOIN novels n ON n.id = s.novel_id WHERE s.id = ?').get(id) as unknown as SessionRow;
  return mapSession(row);
}

export function listAgentSessions(userId: string, novelId?: string, scope?: string, chapterIndex?: number | null): AgentSession[] {
  const sc = scope || DEFAULT_AGENT_SCOPE;
  const hasChapter = chapterIndex !== undefined && chapterIndex !== null && Number.isFinite(Number(chapterIndex));
  if (novelId) {
    if (hasChapter) {
      const rows = sqlite.prepare(
        'SELECT s.*, n.title AS novel_title FROM agent_sessions s LEFT JOIN novels n ON n.id = s.novel_id WHERE s.user_id = ? AND s.novel_id = ? AND COALESCE(s.scope, ?) = ? AND s.chapter_index = ? ORDER BY s.updated_at DESC'
      ).all(userId, novelId, DEFAULT_AGENT_SCOPE, sc, Number(chapterIndex)) as unknown as SessionRow[];
      return rows.map(mapSession);
    }
    const rows = sqlite.prepare(
      'SELECT s.*, n.title AS novel_title FROM agent_sessions s LEFT JOIN novels n ON n.id = s.novel_id WHERE s.user_id = ? AND s.novel_id = ? AND COALESCE(s.scope, ?) = ? ORDER BY s.updated_at DESC'
    ).all(userId, novelId, DEFAULT_AGENT_SCOPE, sc) as unknown as SessionRow[];
    return rows.map(mapSession);
  }
  const rows = sqlite.prepare(
    'SELECT s.*, n.title AS novel_title FROM agent_sessions s LEFT JOIN novels n ON n.id = s.novel_id WHERE s.user_id = ? AND COALESCE(s.scope, ?) = ? ORDER BY s.updated_at DESC'
  ).all(userId, DEFAULT_AGENT_SCOPE, sc) as unknown as SessionRow[];
  return rows.map(mapSession);
}

export function getAgentSession(sessionId: string): AgentSession | null {
  const row = sqlite.prepare('SELECT s.*, n.title AS novel_title FROM agent_sessions s LEFT JOIN novels n ON n.id = s.novel_id WHERE s.id = ?').get(sessionId) as unknown as SessionRow | undefined;
  return row ? mapSession(row) : null;
}

export function touchAgentSession(sessionId: string, title?: string): void {
  const t = title?.trim();
  if (t) {
    sqlite.prepare("UPDATE agent_sessions SET updated_at = ?, title = ?, status = 'active' WHERE id = ?").run(now(), t, sessionId);
  } else {
    sqlite.prepare("UPDATE agent_sessions SET updated_at = ?, status = 'active' WHERE id = ?").run(now(), sessionId);
  }
}

export function setAgentSessionChapter(sessionId: string, chapterIndex: number | null): void {
  sqlite.prepare("UPDATE agent_sessions SET chapter_index = ?, updated_at = ? WHERE id = ?").run(chapterIndex, now(), sessionId);
}

export function deleteAgentSession(sessionId: string): boolean {
  sqlite.prepare('DELETE FROM agent_messages WHERE session_id = ?').run(sessionId);
  const r = sqlite.prepare('DELETE FROM agent_sessions WHERE id = ?').run(sessionId);
  return r.changes > 0;
}

// ---------- messages ----------
interface MessageRow {
  id: string; session_id: string; role: string; content: string | null;
  tool_name: string | null; tool_payload: string | null; created_at: string;
}
function mapMessage(r: MessageRow): AgentMessage {
  return {
    id: r.id, sessionId: r.session_id, role: r.role as AgentMessage['role'],
    content: r.content ?? '', toolName: r.tool_name ?? null, toolPayload: r.tool_payload ?? null,
    createdAt: r.created_at,
  };
}

export function createAgentMessage(input: {
  sessionId: string; role: AgentMessage['role']; content: string;
  toolName?: string; toolPayload?: string;
}): AgentMessage {
  const id = genId('agent_m');
  sqlite.prepare(
    'INSERT INTO agent_messages (id, session_id, role, content, tool_name, tool_payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, input.sessionId, input.role, input.content, input.toolName ?? null, input.toolPayload ?? null, now());
  const row = sqlite.prepare('SELECT * FROM agent_messages WHERE id = ?').get(id) as unknown as MessageRow;
  return mapMessage(row);
}

export function listAgentMessages(sessionId: string): AgentMessage[] {
  const rows = sqlite.prepare('SELECT * FROM agent_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC').all(sessionId) as unknown as MessageRow[];
  return rows.map(mapMessage);
}

// ---------- 会话压缩摘要 ----------
export function getSessionDigest(sessionId: string): { digest: string; coveredCount: number } | null {
  try {
    const row = sqlite.prepare('SELECT digest, covered_count FROM agent_session_digest WHERE session_id = ?').get(sessionId) as unknown as { digest: string; covered_count: number } | undefined;
    if (!row) return null;
    return { digest: row.digest || '', coveredCount: Number(row.covered_count) || 0 };
  } catch {
    return null;
  }
}

export function saveSessionDigest(sessionId: string, digest: string, coveredCount: number): void {
  try {
    sqlite.prepare(
      'INSERT INTO agent_session_digest (session_id, digest, covered_count, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET digest = excluded.digest, covered_count = excluded.covered_count, updated_at = excluded.updated_at'
    ).run(sessionId, digest, coveredCount, now());
  } catch (e) {
    console.error('[Agent] 保存会话摘要失败:', e instanceof Error ? e.message : e);
  }
}

export function clearSessionDigest(sessionId: string): void {
  try {
    sqlite.prepare('DELETE FROM agent_session_digest WHERE session_id = ?').run(sessionId);
  } catch {
    // 忽略
  }
}

// ---------- runs ----------
export function createAgentRun(input: {
  sessionId: string; userId: string; novelId?: string; chapterIndex?: number; prompt: string;
}): AgentRun {
  const id = genId('agent_r');
  sqlite.prepare(
    'INSERT INTO agent_runs (id, session_id, user_id, novel_id, chapter_index, prompt, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, input.sessionId, input.userId, input.novelId ?? null, input.chapterIndex ?? null, input.prompt, 'running', now());
  const row = sqlite.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as unknown as {
    id: string; status: string; error: string | null; finished_at: string | null;
  };
  return {
    id, sessionId: input.sessionId, userId: input.userId, novelId: input.novelId ?? null,
    chapterIndex: input.chapterIndex ?? null, prompt: input.prompt, status: 'running',
    error: null, createdAt: row ? '' : '',
    finishedAt: null,
  };
}

export function updateAgentRunStatus(runId: string, status: AgentRun['status'], error?: string): void {
  sqlite.prepare('UPDATE agent_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
    .run(status, error ?? null, status === 'running' ? null : now(), runId);
}

export function getAgentRun(runId: string): { id: string; user_id: string; session_id: string; novel_id: string | null; chapter_index: number | null; prompt: string; status: string } | null {
  const row = sqlite.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as unknown as {
    id: string; user_id: string; session_id: string; novel_id: string | null; chapter_index: number | null; prompt: string; status: string;
  } | undefined;
  return row ?? null;
}

// ---------- novel 章节读写 ----------
/** 读取章节（chapters JSON 数组 {index,title,content}）—— 直接查库，不依赖 novelManager */
export function getChapter(novelId: string, chapterIndex: number): ChapterRef | null {
  const row = sqlite.prepare('SELECT chapters FROM novels WHERE id = ?').get(novelId) as { chapters: string | null } | undefined;
  if (!row || !row.chapters) return null;
  let arr: ChapterRef[] | null = null;
  try { const parsed = JSON.parse(row.chapters); if (Array.isArray(parsed)) arr = parsed; } catch { arr = null; }
  if (!arr) return null;
  const ch = arr.find((c) => c && c.index === Number(chapterIndex));
  return ch ? { index: Number(chapterIndex), title: ch.title ?? '', content: ch.content ?? '' } : null;
}

function safeParse(s: string): ChapterRef[] | null {
  try { return JSON.parse(s); } catch { return null; }
}

/** 写回章节正文（改稿/续写/润色）—— 直接查库更新，不依赖 novelManager */
export async function applyChapterContent(novelId: string, ownerUserId: string, chapterIndex: number, newContent: string): Promise<boolean> {
  const row = sqlite.prepare('SELECT chapters, user_id, current_chapters FROM novels WHERE id = ?').get(novelId) as { chapters: string | null; user_id: string; current_chapters: number } | undefined;
  if (!row) return false;
  if (row.user_id !== ownerUserId && row.user_id !== 'admin') return false;
  let arr: ChapterRef[] | null = null;
  try { const parsed = JSON.parse(row.chapters ?? '[]'); if (Array.isArray(parsed)) arr = parsed; } catch { arr = null; }
  if (!arr) return false;
  const target = arr.find((c) => c && c.index === Number(chapterIndex));
  if (!target) return false;
  target.content = newContent;
  sqlite.prepare('UPDATE novels SET chapters = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(arr), now(), novelId);
  return true;
}

/** 取作品里序号最大的一章（即最后一章） */
export function getLastChapter(novelId: string): ChapterRef | null {
  const row = sqlite.prepare('SELECT chapters FROM novels WHERE id = ?').get(novelId) as { chapters: string | null } | undefined;
  if (!row) return null;
  let arr: ChapterRef[] = [];
  try {
    const parsed = JSON.parse(row.chapters ?? '[]');
    if (Array.isArray(parsed)) arr = parsed;
  } catch {
    return null;
  }
  let last: ChapterRef | null = null;
  let lastIdx = -1;
  for (const c of arr) {
    if (!c) continue;
    const idx = Number((c as ChapterRef).index) || 0;
    if (idx > lastIdx) { lastIdx = idx; last = c as ChapterRef; }
  }
  return last;
}

/**
 * 在作品末尾追加一章，返回新章序号（失败返回 null）。
 * 同步更新 current_chapters 计数，保证书籍阅读端能读到新章。
 */
export async function appendChapter(novelId: string, ownerUserId: string, content: string, title: string): Promise<number | null> {
  const row = sqlite.prepare('SELECT chapters, user_id FROM novels WHERE id = ?').get(novelId) as { chapters: string | null; user_id: string } | undefined;
  if (!row) return null;
  if (row.user_id !== ownerUserId && row.user_id !== 'admin') return null;
  let arr: ChapterRef[] = [];
  try {
    const parsed = JSON.parse(row.chapters ?? '[]');
    if (Array.isArray(parsed)) arr = parsed;
  } catch {
    arr = [];
  }
  let maxIndex = 0;
  for (const c of arr) {
    const idx = c && Number((c as ChapterRef).index) ? Number((c as ChapterRef).index) : 0;
    if (idx > maxIndex) maxIndex = idx;
  }
  const index = maxIndex + 1;
  arr.push({ index, title, content });
  const count = arr.filter((c) => c && Number((c as ChapterRef).index) > 0).length;
  sqlite.prepare('UPDATE novels SET chapters = ?, current_chapters = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(arr), count, now(), novelId);
  return index;
}



// ---------- 生成任务（后台运行 + 历史恢复） ----------
export interface GenerationChapter { index: number; title: string; content: string; }
export interface GenerationState {
  sessionId: string; userId: string; novelId: string | null; title: string;
  total: number; current: number; status: string;
  chapters: GenerationChapter[]; error: string | null; updatedAt: string;
}

export function upsertGeneration(input: {
  sessionId: string; userId: string; novelId?: string | null; title?: string;
  total?: number; current?: number; status?: string;
  chapters?: GenerationChapter[]; error?: string | null;
}): void {
  const exists = sqlite.prepare('SELECT session_id FROM agent_generations WHERE session_id = ?').get(input.sessionId);
  if (exists) {
    const sets: string[] = []; const args: unknown[] = [];
    if (input.novelId !== undefined) { sets.push('novel_id = ?'); args.push(input.novelId); }
    if (input.title !== undefined) { sets.push('title = ?'); args.push(input.title); }
    if (input.total !== undefined) { sets.push('total = ?'); args.push(input.total); }
    if (input.current !== undefined) { sets.push('current = ?'); args.push(input.current); }
    if (input.status !== undefined) { sets.push('status = ?'); args.push(input.status); }
    if (input.chapters !== undefined) { sets.push('chapters = ?'); args.push(JSON.stringify(input.chapters)); }
    if (input.error !== undefined) { sets.push('error = ?'); args.push(input.error); }
    sets.push('updated_at = ?'); args.push(now());
    args.push(input.sessionId);
    sqlite.prepare('UPDATE agent_generations SET ' + sets.join(', ') + ' WHERE session_id = ?').run(...args);
  } else {
    sqlite.prepare(
      'INSERT INTO agent_generations (session_id, user_id, novel_id, title, total, current, status, chapters, error, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      input.sessionId, input.userId, input.novelId ?? null, input.title ?? '', input.total ?? 0,
      input.current ?? 0, input.status ?? 'running', JSON.stringify(input.chapters ?? []),
      input.error ?? null, now()
    );
  }
}

export function getGeneration(sessionId: string): GenerationState | null {
  const row = sqlite.prepare('SELECT * FROM agent_generations WHERE session_id = ?').get(sessionId) as unknown as {
    session_id: string; user_id: string; novel_id: string | null; title: string | null;
    total: number; current: number; status: string; chapters: string | null; error: string | null; updated_at: string;
  } | undefined;
  if (!row) return null;
  let chapters: GenerationChapter[] = [];
  try { const p = JSON.parse(row.chapters ?? '[]'); if (Array.isArray(p)) chapters = p; } catch { chapters = []; }
  return {
    sessionId: row.session_id, userId: row.user_id, novelId: row.novel_id, title: row.title ?? '',
    total: row.total ?? 0, current: row.current ?? 0, status: row.status ?? 'running',
    chapters, error: row.error, updatedAt: row.updated_at,
  };
}

// ---------- 作品变更记录（Agent 工作区时间线） ----------
export function addNovelChange(input: {
  novelId: string; userId: string; action: string;
  chapterIndex?: number | null; title?: string; detail?: string;
}): void {
  sqlite.prepare(
    'INSERT INTO novel_changes (id, novel_id, user_id, action, chapter_index, title, detail) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(genId('chg'), input.novelId, input.userId, input.action, input.chapterIndex ?? null, input.title ?? null, input.detail ?? null);
}

export function listNovelChanges(novelId: string, userId: string, limit = 60) {
  return sqlite.prepare(
    'SELECT id, action, chapter_index AS chapterIndex, title, detail, created_at AS createdAt FROM novel_changes WHERE novel_id = ? AND user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?'
  ).all(novelId, userId, limit) as { id: string; action: string; chapterIndex: number | null; title: string | null; detail: string | null; createdAt: string }[];
}
