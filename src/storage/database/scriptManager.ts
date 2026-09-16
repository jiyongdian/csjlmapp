import { getDb } from './sqlite';
import { scripts } from './shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import { insertScriptSchema, updateScriptSchema } from './shared/schema';
import { shortDramaManager } from './shortDramaManager';

export class ScriptManager {
  private static saveQueue: Map<string, Promise<any>> = new Map();

  private serializeData(data: any): any {
    const result: any = { ...data };
    if (result.chapters !== undefined && result.chapters !== null && typeof result.chapters !== 'string') {
      result.chapters = JSON.stringify(result.chapters);
    }
    if (result.updatedAt instanceof Date) {
      result.updatedAt = result.updatedAt.toISOString();
    }
    return result;
  }

  private deserializeScript(script: any): any {
    if (!script) return script;
    const result = { ...script };
    if (result.chapters && typeof result.chapters === 'string') {
      try {
        result.chapters = JSON.parse(result.chapters);
      } catch {}
    }
    return result;
  }

  private deserializeScripts(scriptList: any[]): any[] {
    return scriptList.map(s => this.deserializeScript(s));
  }

  async createScript(data: { novelId: string; userId: string; status?: string; chapters?: any }) {
    const db = await getDb();
    const id = `script_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const validated = insertScriptSchema.parse({
      novelId: data.novelId,
      userId: data.userId,
      status: data.status || 'draft',
      chapters: data.chapters || null,
    });
    const serialized = this.serializeData({ ...validated, id });
    const result = await db.insert(scripts).values(serialized).returning();
    return this.deserializeScript(result[0]);
  }

  async getScriptById(id: string) {
    const db = await getDb();
    const result = await db.select().from(scripts).where(eq(scripts.id, id)).limit(1);
    return this.deserializeScript(result[0] || null);
  }

  async getScriptByNovelId(novelId: string, userId: string, isAdmin: boolean = false) {
    const db = await getDb();
    // 先尝试按 novelId + userId 查找
    let result = await db.select().from(scripts)
      .where(and(eq(scripts.novelId, novelId), eq(scripts.userId, userId)))
      .orderBy(desc(scripts.createdAt))
      .limit(1);
    
    // 管理员兜底：如果没找到，尝试查找所有脚本（包括 userId 为空的旧数据）
    if (!result[0] && isAdmin) {
      result = await db.select().from(scripts)
        .where(and(eq(scripts.novelId, novelId)))
        .orderBy(desc(scripts.createdAt))
        .limit(1);
    }
    
    return this.deserializeScript(result[0] || null);
  }

  async getScriptsByUserId(userId: string, isAdmin: boolean = false) {
    const db = await getDb();
    // 先查 userId 匹配的
    const results = await db.select().from(scripts)
      .where(eq(scripts.userId, userId))
      .orderBy(desc(scripts.createdAt));
    
    // 管理员额外查 userId 为空的旧数据（兼容旧数据，仅管理员可见）
    let merged = [...results];
    if (isAdmin) {
      const resultsWithEmptyUserId = await db.select().from(scripts)
        .where(eq(scripts.userId, ''))
        .orderBy(desc(scripts.createdAt));
      
      const seenIds = new Set(results.map(r => r.id));
      for (const r of resultsWithEmptyUserId) {
        if (!seenIds.has(r.id)) {
          merged.push(r);
          seenIds.add(r.id);
        }
      }
      
      // 按 createdAt 降序重新排序
      merged.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
    }
    
    return this.deserializeScripts(merged);
  }

  async updateScript(id: string, data: { status?: string; chapters?: any; userId?: string }, skipHistory: boolean = false) {
    // 更新前自动保存历史版本（单章字段编辑等小改动可通过 skipHistory 跳过）
    if (!skipHistory) {
      try { await this.saveHistory(id, 'auto'); } catch (e) { console.warn('[ScriptManager] 保存历史失败（不阻塞更新）:', e instanceof Error ? e.message : e); }
    }
    const db = await getDb();
    const validated = updateScriptSchema.parse(data);
    const serialized = this.serializeData({ ...validated, updatedAt: new Date().toISOString() });
    const result = await db.update(scripts)
      .set(serialized)
      .where(eq(scripts.id, id))
      .returning();
    return this.deserializeScript(result[0]);
  }

  /**
   * 保存当前剧本状态到历史记录
   */
  async saveHistory(scriptId: string, source: string = 'auto') {
    const script = await this.getScriptById(scriptId);
    if (!script) return null;
    const sqlite = (await import('./sqlite')).sqlite;
    // 获取当前最大版本号
    const maxRow: any = sqlite.prepare('SELECT MAX(version) as mv FROM script_history WHERE script_id = ?').get(scriptId);
    const nextVersion = (maxRow?.mv || 0) + 1;
    const id = `sh_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const chaptersStr = script.chapters ? (typeof script.chapters === 'string' ? script.chapters : JSON.stringify(script.chapters)) : null;
    sqlite.prepare(
      'INSERT INTO script_history (id, script_id, novel_id, user_id, version, chapters, status, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, scriptId, script.novelId, script.userId, nextVersion, chaptersStr, script.status || 'draft', source, new Date().toISOString());
    // 只保留最近 50 个版本，自动清理旧记录
    sqlite.prepare('DELETE FROM script_history WHERE script_id = ? AND id NOT IN (SELECT id FROM script_history WHERE script_id = ? ORDER BY version DESC LIMIT 50)').run(scriptId, scriptId);
    return { id, version: nextVersion };
  }

  /**
   * 列出剧本的历史版本（按版本号倒序）
   */
  async listHistory(scriptId: string) {
    const sqlite = (await import('./sqlite')).sqlite;
    const rows = sqlite.prepare('SELECT id, script_id, version, status, source, created_at, length(chapters) as chapters_len FROM script_history WHERE script_id = ? ORDER BY version DESC').all(scriptId);
    return rows.map((r: any) => ({
      id: r.id, scriptId: r.script_id, version: r.version, status: r.status,
      source: r.source, createdAt: r.created_at, chaptersLen: r.chapters_len,
    }));
  }

  /**
   * 获取某个历史版本的完整内容
   */
  async getHistory(historyId: string) {
    const sqlite = (await import('./sqlite')).sqlite;
    const row: any = sqlite.prepare('SELECT * FROM script_history WHERE id = ?').get(historyId);
    if (!row) return null;
    let chapters = row.chapters;
    if (chapters && typeof chapters === 'string') { try { chapters = JSON.parse(chapters); } catch {} }
    return { id: row.id, scriptId: row.script_id, novelId: row.novel_id, userId: row.user_id, version: row.version, chapters, status: row.status, source: row.source, createdAt: row.created_at };
  }

  /**
   * 从历史版本恢复剧本（恢复前先把当前状态存为历史）
   */
  async restoreFromHistory(historyId: string) {
    const history = await this.getHistory(historyId);
    if (!history) return null;
    // 先保存当前版本到历史
    await this.saveHistory(history.scriptId, 'before-restore');
    // 恢复
    const db = await getDb();
    const serialized = this.serializeData({ chapters: history.chapters, status: history.status, updatedAt: new Date().toISOString() });
    const result = await db.update(scripts).set(serialized).where(eq(scripts.id, history.scriptId)).returning();
    return this.deserializeScript(result[0]);
  }

  /**
   * 删除某个历史版本
   */
  async deleteHistory(historyId: string) {
    const sqlite = (await import('./sqlite')).sqlite;
    sqlite.prepare('DELETE FROM script_history WHERE id = ?').run(historyId);
    return true;
  }

  async updateChapterField(id: string, chapterIndex: number, field: string, value: any) {
    const queueKey = `chapter_${id}`;

    const previousPromise = ScriptManager.saveQueue.get(queueKey) || Promise.resolve();
    const currentPromise = previousPromise.then(async () => {
      try {
        const script = await this.getScriptById(id);
        if (!script || !script.chapters) {
          console.warn(`[ScriptManager] updateChapterField: 剧本${id}不存在或无章节数据`);
          return null;
        }

        const chapters = Array.isArray(script.chapters) ? [...script.chapters] : [];
        if (chapterIndex < 0 || chapterIndex >= chapters.length) {
          console.warn(`[ScriptManager] updateChapterField: 章节索引${chapterIndex}越界，当前长度${chapters.length}`);
          return null;
        }

        chapters[chapterIndex] = {
          ...chapters[chapterIndex],
          [field]: value,
        };

        const result = await this.updateScript(id, { chapters }, true);
        console.log(`[ScriptManager] updateChapterField: 剧本${id}第${chapterIndex}章${field}保存成功`);
        return result;
      } catch (error) {
        console.error(`[ScriptManager] updateChapterField: 剧本${id}第${chapterIndex}章${field}保存失败:`, error);
        throw error;
      }
    });

    ScriptManager.saveQueue.set(queueKey, currentPromise);

    currentPromise.finally(() => {
      if (ScriptManager.saveQueue.get(queueKey) === currentPromise) {
        ScriptManager.saveQueue.delete(queueKey);
      }
    });

    return currentPromise;
  }

  async getAllScripts(limit = 100, offset = 0) {
    const db = await getDb();
    const results = await db.select().from(scripts)
      .orderBy(desc(scripts.createdAt))
      .limit(limit)
      .offset(offset);
    return this.deserializeScripts(results);
  }

  async getScriptByNovelIdAdmin(novelId: string) {
    const db = await getDb();
    const results = await db.select().from(scripts)
      .where(eq(scripts.novelId, novelId))
      .orderBy(desc(scripts.createdAt));
    return this.deserializeScripts(results);
  }

  async deleteScript(id: string) {
    // 级联删除关联短剧（含分集/工作流）
    await shortDramaManager.deleteByScriptId(id).catch(e =>
      console.warn('[ScriptManager] Failed to cascade delete short dramas:', e)
    );
    const db = await getDb();
    await db.delete(scripts).where(eq(scripts.id, id));
  }

  async deleteByNovelId(novelId: string): Promise<void> {
    const db = await getDb();
    const list = await db.select({ id: scripts.id }).from(scripts).where(eq(scripts.novelId, novelId));
    for (const item of list) {
      await this.deleteScript(item.id);
    }
  }

  // 保存故事骨架
  async saveSkeleton(data: {
    novelId: string;
    skeleton: string;
    totalEpisodes?: number;
    episodeDuration?: number;
    genre?: string;
    tone?: any;
    protagonistName?: string;
    supportingCharacters?: string;
  }) {
    // 使用novels表的structure字段来存储骨架（JSON格式）
    const db = await getDb();
    const novelId = data.novelId;
    
    // 将骨架数据保存为JSON格式存储
    const skeletonData = {
      type: 'script-skeleton',
      content: data.skeleton,
      totalEpisodes: data.totalEpisodes,
      episodeDuration: data.episodeDuration,
      genre: data.genre,
      tone: data.tone,
      protagonistName: data.protagonistName,
      supportingCharacters: data.supportingCharacters,
      createdAt: new Date().toISOString(),
    };

    // 先获取novel的现有结构，然后附加骨架数据
    const novelManager = require('./novelManager').novelManager;
    const novel = await novelManager.getById(novelId);
    if (!novel) {
      throw new Error(`小说 ${novelId} 不存在`);
    }

    // 解析现有structure
    let existingStructure: any = {};
    if (novel.structure) {
      try {
        existingStructure = typeof novel.structure === 'string' 
          ? JSON.parse(novel.structure) 
          : novel.structure;
      } catch {
        existingStructure = {};
      }
    }

    // 添加骨架数据到structure的scriptSkeleton字段
    existingStructure.scriptSkeleton = skeletonData;

    // 更新novel的structure字段
    await novelManager.update(novelId, novel.userId, {
      structure: JSON.stringify(existingStructure),
    });

    return { id: `skeleton_${Date.now()}`, ...skeletonData };
  }

  // 保存改编策略
  async saveAdaptationStrategy(data: {
    novelId: string;
    skeleton: string;
    strategy: string;
    genre?: string;
    tone?: any;
    totalEpisodes?: number;
  }) {
    const db = await getDb();
    const novelId = data.novelId;
    
    // 将策略数据保存为JSON格式
    const strategyData = {
      type: 'script-adaptation-strategy',
      content: data.strategy,
      skeleton: data.skeleton,
      genre: data.genre,
      tone: data.tone,
      totalEpisodes: data.totalEpisodes,
      createdAt: new Date().toISOString(),
    };

    // 获取novel的现有结构
    const novelManager = require('./novelManager').novelManager;
    const novel = await novelManager.getById(novelId);
    if (!novel) {
      throw new Error(`小说 ${novelId} 不存在`);
    }

    // 解析现有structure
    let existingStructure: any = {};
    if (novel.structure) {
      try {
        existingStructure = typeof novel.structure === 'string' 
          ? JSON.parse(novel.structure) 
          : novel.structure;
      } catch {
        existingStructure = {};
      }
    }

    // 添加策略数据到structure的scriptAdaptationStrategy字段
    existingStructure.scriptAdaptationStrategy = strategyData;

    // 更新novel的structure字段
    await novelManager.update(novelId, novel.userId, {
      structure: JSON.stringify(existingStructure),
    });

    return { id: `strategy_${Date.now()}`, ...strategyData };
  }

  // 获取故事骨架
  async getSkeletonByNovelId(novelId: string) {
    const novelManager = require('./novelManager').novelManager;
    const novel = await novelManager.getById(novelId);
    if (!novel) return null;

    let structure: any = {};
    if (novel.structure) {
      try {
        structure = typeof novel.structure === 'string' 
          ? JSON.parse(novel.structure) 
          : novel.structure;
      } catch {
        structure = {};
      }
    }

    return structure.scriptSkeleton || null;
  }

  // 获取改编策略
  async getAdaptationStrategyByNovelId(novelId: string) {
    const novelManager = require('./novelManager').novelManager;
    const novel = await novelManager.getById(novelId);
    if (!novel) return null;

    let structure: any = {};
    if (novel.structure) {
      try {
        structure = typeof novel.structure === 'string' 
          ? JSON.parse(novel.structure) 
          : novel.structure;
      } catch {
        structure = {};
      }
    }

    return structure.scriptAdaptationStrategy || null;
  }
}

export const scriptManager = new ScriptManager();
