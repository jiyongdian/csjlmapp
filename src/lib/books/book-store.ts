import { formatChapterTitle } from '@/lib/chapter-title';
// 书城数据层：全局只读查询（better-sqlite3 原生，列名下划线对齐 SQL）
import { sqlite } from '@/storage/database/sqlite';

export interface BookBrief {
  id: string;
  title: string;
  description: string;
  category: string;
  genderTarget: string;
  tone: string;
  currentChapters: number;
  totalChapters: number;
  coverImage: string | null;
  createdAt: string;
  updatedAt: string;
  ownerName?: string;
  ownerId?: string;
}

export interface BookChapterMeta {
  index: number;
  title: string;
  chars: number;
}

export interface BookDetail {
  brief: BookBrief;
  narrativePerspective: string;
  protagonist: string;
  chapters: BookChapterMeta[];
}

export interface BookListInput {
  category?: string;
  q?: string;
  sort?: 'updated' | 'new' | 'hot';
  page?: number;
  pageSize?: number;
}

interface NovelRow {
  id: string; user_id: string; title: string; description: string | null;
  category: string | null; gender_target: string | null; tone: string | null;
  narrative_perspective: string | null; protagonist: string | null;
  total_chapters: number; current_chapters: number;
  cover_image: string | null; status: string | null; is_public: number | null;
  created_at: string; updated_at: string | null; chapters: string | null;
}

/** is_public 为 1/NULL 视为公开（NULL 兜底为公开，避免历史数据被误隐藏） */
function isPublicValue(value: number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  return Number(value) !== 0;
}

function mapBrief(r: NovelRow): BookBrief {
  return {
    id: r.id, title: r.title, description: r.description ?? '',
    category: r.category ?? '', genderTarget: r.gender_target ?? '',
    tone: r.tone ?? '', currentChapters: r.current_chapters ?? 0, totalChapters: r.total_chapters ?? 0,
    coverImage: r.cover_image ?? null, createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at,
  };
}

export function listBooks(input: BookListInput = {}): { items: BookBrief[]; total: number } {
  const { category, q, sort = 'updated', page = 1, pageSize = 24 } = input;
  const conds: string[] = ['current_chapters > 0', 'COALESCE(is_public, 1) = 1'];
  const args: unknown[] = [];
  if (category && category !== '全部') {
    conds.push('category = ?'); args.push(category);
  }
  if (q) {
    conds.push('(title LIKE ? OR description LIKE ?)'); args.push('%' + q + '%', '%' + q + '%');
  }
  const where = 'WHERE ' + conds.join(' AND ');
  const order =
    sort === 'hot' ? 'ORDER BY current_chapters DESC, updated_at DESC'
    : sort === 'new' ? 'ORDER BY created_at DESC'
    : 'ORDER BY updated_at DESC';

  const total = (sqlite.prepare('SELECT COUNT(*) AS n FROM novels ' + where).get(...args) as { n: number }).n;
  const offset = (page - 1) * pageSize;
  const rows = sqlite.prepare('SELECT * FROM novels ' + where + ' ' + order + ' LIMIT ? OFFSET ?')
    .all(...args, pageSize, offset) as unknown as NovelRow[];
  return { items: rows.map(mapBrief), total };
}

export function listCategories(): string[] {
  const rows = sqlite.prepare("SELECT DISTINCT category FROM novels WHERE current_chapters > 0 AND COALESCE(is_public, 1) = 1 AND category IS NOT NULL AND category != '' ORDER BY category").all() as { category: string }[];
  return rows.map((r) => r.category);
}

export function getBookDetail(id: string): BookDetail | null {
  const row = sqlite.prepare('SELECT * FROM novels WHERE id = ?').get(id) as unknown as NovelRow | undefined;
  if (!row || (row.current_chapters ?? 0) <= 0 || !isPublicValue(row.is_public)) return null;
  const brief = mapBrief(row);
  // 作者：取作品所有者的会员昵称（无昵称回落用户名）
  const owner = sqlite.prepare('SELECT nickname, username FROM users WHERE id = ?').get(row.user_id) as { nickname: string | null; username: string | null } | undefined;
  brief.ownerName = (owner && (owner.nickname || owner.username)) || '';
  brief.ownerId = row.user_id;
  let chapters: { index: number; title: string; content?: string }[] = [];
  if (row.chapters) {
    try {
      const parsed = JSON.parse(row.chapters);
      if (Array.isArray(parsed)) chapters = parsed;
    } catch { /* 忽略坏 JSON */ }
  }
  // 超出 currentChapters 的草稿章不展示
  const metas: BookChapterMeta[] = chapters
    .filter((c) => c && typeof c.index === 'number' && c.index <= (row.current_chapters ?? 0))
    .sort((a, b) => a.index - b.index)
    .map((c) => ({ index: c.index, title: formatChapterTitle(c.index, c.title), chars: (c.content ?? '').length }));
  return {
    brief,
    narrativePerspective: row.narrative_perspective ?? '',
    protagonist: row.protagonist ?? '',
    chapters: metas,
  };
}

export interface BookChapterFull {
  index: number;
  title: string;
  content: string;
}

export function getBookChapter(id: string, chapterIndex: number): BookChapterFull | null {
  const row = sqlite.prepare('SELECT chapters, current_chapters, is_public FROM novels WHERE id = ?').get(id) as unknown as { chapters: string | null; current_chapters: number; is_public: number | null } | undefined;
  if (!row || !row.chapters || chapterIndex > (row.current_chapters ?? 0) || !isPublicValue(row.is_public)) return null;
  try {
    const parsed = JSON.parse(row.chapters);
    if (!Array.isArray(parsed)) return null;
    const ch = parsed.find((c) => c && c.index === Number(chapterIndex));
    if (!ch) return null;
    return { index: Number(chapterIndex), title: formatChapterTitle(Number(chapterIndex), ch.title), content: String(ch.content ?? '') };
  } catch {
    return null;
  }
}
