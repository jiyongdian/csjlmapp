import { sqlite } from './sqlite';
import { getSystemSettings } from '@/lib/system-settings';

export type MemoryType =
  | 'novelSummary' | 'worldbuilding' | 'characterCard' | 'chapterSummary'
  | 'timelineEvent' | 'foreshadowing' | 'stylePreference' | 'continuityRule'
  | 'storyArc' | 'sceneState' | 'relationshipState';

export type MemoryLayer = 'L1' | 'L2' | 'L3';

export interface StoryMemoryInput {
  novelId: string;
  userId: string;
  memoryType: MemoryType;
  layer?: MemoryLayer;
  title: string;
  content: string;
  importance?: number;
  sourceChapter?: number;
  tags?: string[];
}

interface StoryMemoryRecord {
  id: string;
  novelId: string;
  userId: string;
  memoryType: MemoryType;
  layer: MemoryLayer;
  title: string;
  content: string;
  importance: number;
  status: string;
  sourceChapter: number | null;
  evidence: string | null;
  tags: string | null;
  createdAt: string;
  updatedAt: string | null;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function layerForType(type: MemoryType): MemoryLayer {
  if (['novelSummary', 'storyArc', 'continuityRule', 'stylePreference'].includes(type)) return 'L3';
  if (['chapterSummary', 'sceneState', 'relationshipState', 'timelineEvent', 'foreshadowing'].includes(type)) return 'L2';
  return 'L1';
}

// 将 snake_case 行转换为 camelCase 记录
function mapRow(row: any): StoryMemoryRecord {
  return {
    id: row.id,
    novelId: row.novel_id,
    userId: row.user_id,
    memoryType: row.memory_type,
    layer: row.layer,
    title: row.title,
    content: row.content,
    importance: row.importance,
    status: row.status,
    sourceChapter: row.source_chapter,
    evidence: row.evidence,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const storyMemoryManager = {
  async create(input: StoryMemoryInput): Promise<StoryMemoryRecord> {
    const now = new Date().toISOString();
    const id = generateUUID();
    const layer = input.layer || layerForType(input.memoryType);
    sqlite.prepare(
      `INSERT INTO story_memory (id, novel_id, user_id, memory_type, layer, title, content, importance, source_chapter, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.novelId, input.userId, input.memoryType, layer, input.title, input.content,
      input.importance ?? 70, input.sourceChapter ?? null,
      input.tags ? JSON.stringify(input.tags) : null, now, now);
    return this.getById(id) as Promise<StoryMemoryRecord>;
  },

  async getById(id: string): Promise<StoryMemoryRecord | null> {
    const row = sqlite.prepare('SELECT * FROM story_memory WHERE id = ?').get(id);
    return row ? mapRow(row) : null;
  },

  async listByNovel(novelId: string, userId: string, opts?: { type?: MemoryType; layer?: MemoryLayer; limit?: number }): Promise<StoryMemoryRecord[]> {
    if (!novelId || !userId) return [];
    let sql = 'SELECT * FROM story_memory WHERE novel_id = ? AND user_id = ?';
    const params: any[] = [novelId, userId];
    if (opts?.type) { sql += ' AND memory_type = ?'; params.push(opts.type); }
    if (opts?.layer) { sql += ' AND layer = ?'; params.push(opts.layer); }
    sql += ' ORDER BY importance DESC, created_at DESC';
    if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    return sqlite.prepare(sql).all(...params).map(mapRow);
  },

  async search(novelId: string, userId: string, keyword: string): Promise<StoryMemoryRecord[]> {
    if (!novelId || !userId) return [];
    const rows = sqlite.prepare(
      'SELECT * FROM story_memory WHERE novel_id = ? AND user_id = ? AND (title LIKE ? OR content LIKE ?) ORDER BY importance DESC LIMIT 20'
    ).all(novelId, userId, `%${keyword}%`, `%${keyword}%`);
    return rows.map(mapRow);
  },

  async update(id: string, userId: string, data: Partial<StoryMemoryInput>): Promise<StoryMemoryRecord | null> {
    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const params: any[] = [now];
    if (data.title !== undefined) { sets.push('title = ?'); params.push(data.title); }
    if (data.content !== undefined) { sets.push('content = ?'); params.push(data.content); }
    if (data.importance !== undefined) { sets.push('importance = ?'); params.push(data.importance); }
    if (data.memoryType !== undefined) { sets.push('memory_type = ?'); sets.push('layer = ?'); params.push(data.memoryType, layerForType(data.memoryType)); }
    if (data.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(data.tags)); }
    params.push(id, userId);
    sqlite.prepare(`UPDATE story_memory SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
    return this.getById(id);
  },

  async delete(id: string, userId: string): Promise<boolean> {
    sqlite.prepare('DELETE FROM story_memory WHERE id = ? AND user_id = ?').run(id, userId);
    return true;
  },

  /**
   * 更新或创建章节摘要记忆（同一章节只保留一条，重新生成时覆盖）
   */
  async upsertChapterSummary(input: StoryMemoryInput & { sourceChapter: number }): Promise<StoryMemoryRecord | null> {
    const now = new Date().toISOString();
    const existing: any = sqlite.prepare(
      'SELECT * FROM story_memory WHERE novel_id = ? AND user_id = ? AND memory_type = ? AND source_chapter = ?'
    ).get(input.novelId, input.userId, 'chapterSummary', input.sourceChapter);
    if (existing) {
      sqlite.prepare(
        'UPDATE story_memory SET title = ?, content = ?, importance = ?, updated_at = ? WHERE id = ?'
      ).run(input.title, input.content, input.importance ?? 60, now, existing.id);
      return this.getById(existing.id);
    }
    const id = generateUUID();
    const layer = input.layer || layerForType(input.memoryType);
    sqlite.prepare(
      `INSERT INTO story_memory (id, novel_id, user_id, memory_type, layer, title, content, importance, source_chapter, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.novelId, input.userId, input.memoryType, layer, input.title, input.content,
      input.importance ?? 60, input.sourceChapter,
      input.tags ? JSON.stringify(input.tags) : null, now, now);
    return this.getById(id);
  },

  async getContextForChapter(novelId: string, userId: string, chapterNum: number) {
    if (!novelId || !userId) return { L3: [] as StoryMemoryRecord[], L2: [] as StoryMemoryRecord[], L1: [] as StoryMemoryRecord[], all: [] as StoryMemoryRecord[] };
    const all = sqlite.prepare(
      'SELECT * FROM story_memory WHERE novel_id = ? AND user_id = ? ORDER BY source_chapter ASC, importance DESC'
    ).all(novelId, userId).map(mapRow);
    const L3 = all.filter(m => m.layer === 'L3');
    const L2 = all.filter(m => m.layer === 'L2' && (m.sourceChapter === null || m.sourceChapter <= chapterNum));
    const L1 = all.filter(m => m.layer === 'L1');
    return { L3, L2, L1, all };
  },

  async buildMemoryDigest(novelId: string, userId: string, chapterNum: number): Promise<string> {
    const { L3, L2, L1 } = await this.getContextForChapter(novelId, userId, chapterNum);
    // 注入条数可在「系统配置 → Agent记忆配置」中调整
    let l2Limit = 15;
    let l1Limit = 10;
    try {
      const settings = await getSystemSettings();
      l2Limit = Math.max(0, settings.agentMemory.memoryL2Limit);
      l1Limit = Math.max(0, settings.agentMemory.memoryL1Limit);
    } catch { /* 读取失败时使用默认条数 */ }
    const clip = (text: string | null | undefined, max: number) => {
      const v = String(text || '').replace(/\s+/g, ' ').trim();
      return v.length > max ? v.slice(0, max) + '…' : v;
    };
    const lines: string[] = [];
    if (L3.length) { lines.push('【全书设定层 L3】'); L3.forEach(m => lines.push(`- [${m.memoryType}] ${m.title}：${m.content}`)); }
    if (l2Limit > 0 && L2.length) { lines.push('\n【章节上下文层 L2】'); L2.slice(-l2Limit).forEach(m => lines.push(`- [第${m.sourceChapter ?? '?'}章·${m.memoryType}] ${m.title}${m.content ? '：' + clip(m.content, 80) : ''}`)); }
    if (l1Limit > 0 && L1.length) { lines.push('\n【核心设定层 L1】'); L1.slice(-l1Limit).forEach(m => lines.push(`- [${m.memoryType}] ${m.title}${m.content ? '：' + clip(m.content, 120) : ''}`)); }
    return lines.join('\n');
  },
};
