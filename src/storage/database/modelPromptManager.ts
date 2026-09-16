import { getDb } from "./sqlite";
import { modelPrompts, insertModelPromptSchema, updateModelPromptSchema } from "./shared/schema";
import { eq, asc } from "drizzle-orm";
import type { z } from "zod";
import { appendAgentSkillPrompt, type AgentSkillPromptContext } from "@/lib/agent-skills";

export type InsertModelPrompt = z.infer<typeof insertModelPromptSchema>;
export type UpdateModelPrompt = z.infer<typeof updateModelPromptSchema>;

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 内存缓存，避免每次生成都查数据库
let promptCache: Map<string, { systemPrompt: string; userPrompt: string | null }> | null = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 1000; // 30秒缓存

function hasPromptContext(context?: AgentSkillPromptContext): boolean {
  if (!context) return false;
  return Object.values(context).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && String(value).trim().length > 0;
  });
}

class ModelPromptManager {
  async getAll() {
    const db = await getDb();
    return db.select().from(modelPrompts).orderBy(asc(modelPrompts.sortOrder), asc(modelPrompts.code));
  }

  async getByModule(module: string) {
    const db = await getDb();
    return db.select().from(modelPrompts).where(eq(modelPrompts.module, module)).orderBy(asc(modelPrompts.sortOrder));
  }

  async getByCode(code: string) {
    const db = await getDb();
    const results = await db.select().from(modelPrompts).where(eq(modelPrompts.code, code)).limit(1);
    return results[0] || null;
  }

  async create(data: InsertModelPrompt) {
    const db = await getDb();
    const parsed = insertModelPromptSchema.parse(data);
    // SQLite 类型转换
    const insertData: any = { ...parsed, id: generateUUID() };
    if (insertData.isActive !== undefined && typeof insertData.isActive !== 'number') {
      insertData.isActive = insertData.isActive ? 1 : 0;
    }
    if (insertData.sortOrder !== undefined && typeof insertData.sortOrder !== 'number') {
      insertData.sortOrder = Number(insertData.sortOrder) || 0;
    }
    const result = await db.insert(modelPrompts).values(insertData).returning();
    this.invalidateCache();
    return result[0];
  }

  async update(id: string, data: UpdateModelPrompt) {
    const db = await getDb();
    const parsed = updateModelPromptSchema.parse(data);
    // SQLite 类型转换：isActive 必须是 integer，updatedAt 必须是 string
    const updateData: any = { ...parsed, updatedAt: new Date().toISOString() };
    if (updateData.isActive !== undefined && typeof updateData.isActive !== 'number') {
      updateData.isActive = updateData.isActive ? 1 : 0;
    }
    const result = await db.update(modelPrompts)
      .set(updateData)
      .where(eq(modelPrompts.id, id))
      .returning();
    this.invalidateCache();
    return result[0];
  }

  async delete(id: string) {
    const db = await getDb();
    const result = await db.delete(modelPrompts).where(eq(modelPrompts.id, id)).returning();
    this.invalidateCache();
    return result[0];
  }

  /** 清除缓存 */
  invalidateCache() {
    promptCache = null;
    cacheTime = 0;
  }

  /** 获取提示词（带缓存），返回 systemPrompt 和 userPrompt */
  async getPrompt(code: string, context?: AgentSkillPromptContext): Promise<{ systemPrompt: string; userPrompt: string | null }> {
    if (hasPromptContext(context)) {
      const db = await getDb();
      const rows = await db.select({
        code: modelPrompts.code,
        systemPrompt: modelPrompts.systemPrompt,
        userPrompt: modelPrompts.userPrompt,
        isActive: modelPrompts.isActive,
      }).from(modelPrompts).where(eq(modelPrompts.code, code)).limit(1);
      const row = rows[0];
      if (row?.isActive) {
        return {
          systemPrompt: appendAgentSkillPrompt(row.code, row.systemPrompt, context),
          userPrompt: row.userPrompt,
        };
      }
      return { systemPrompt: '', userPrompt: null };
    }

    const now = Date.now();
    if (promptCache && now - cacheTime < CACHE_TTL) {
      const cached = promptCache.get(code);
      if (cached) return cached;
    }

    // 重建缓存
    const db = await getDb();
    const all = await db.select({
      code: modelPrompts.code,
      systemPrompt: modelPrompts.systemPrompt,
      userPrompt: modelPrompts.userPrompt,
      isActive: modelPrompts.isActive,
    }).from(modelPrompts);

    promptCache = new Map();
    cacheTime = now;
    for (const row of all) {
      if (row.isActive) {
        promptCache.set(row.code, { systemPrompt: appendAgentSkillPrompt(row.code, row.systemPrompt), userPrompt: row.userPrompt });
      }
    }

    return promptCache.get(code) || { systemPrompt: '', userPrompt: null };
  }

  /** 批量获取多个提示词 */
  async getPrompts(codes: string[]): Promise<Record<string, { systemPrompt: string; userPrompt: string | null }>> {
    const now = Date.now();
    if (promptCache && now - cacheTime < CACHE_TTL) {
      const result: Record<string, { systemPrompt: string; userPrompt: string | null }> = {};
      for (const code of codes) {
        const cached = promptCache.get(code);
        if (cached) result[code] = cached;
      }
      return result;
    }

    // 重建缓存
    const db = await getDb();
    const all = await db.select({
      code: modelPrompts.code,
      systemPrompt: modelPrompts.systemPrompt,
      userPrompt: modelPrompts.userPrompt,
      isActive: modelPrompts.isActive,
    }).from(modelPrompts);

    promptCache = new Map();
    cacheTime = now;
    for (const row of all) {
      if (row.isActive) {
        promptCache.set(row.code, { systemPrompt: appendAgentSkillPrompt(row.code, row.systemPrompt), userPrompt: row.userPrompt });
      }
    }

    const result: Record<string, { systemPrompt: string; userPrompt: string | null }> = {};
    for (const code of codes) {
      const cached = promptCache.get(code);
      if (cached) result[code] = cached;
    }
    return result;
  }

  /** 获取所有提示词（带缓存） */
  async getAllPrompts(): Promise<Record<string, { systemPrompt: string; userPrompt: string | null }>> {
    const now = Date.now();
    if (promptCache && now - cacheTime < CACHE_TTL) {
      const result: Record<string, { systemPrompt: string; userPrompt: string | null }> = {};
      for (const [code, data] of promptCache) {
        result[code] = data;
      }
      return result;
    }

    // 重建缓存
    const db = await getDb();
    const all = await db.select({
      code: modelPrompts.code,
      systemPrompt: modelPrompts.systemPrompt,
      userPrompt: modelPrompts.userPrompt,
      isActive: modelPrompts.isActive,
    }).from(modelPrompts);

    promptCache = new Map();
    cacheTime = now;
    for (const row of all) {
      if (row.isActive) {
        promptCache.set(row.code, { systemPrompt: appendAgentSkillPrompt(row.code, row.systemPrompt), userPrompt: row.userPrompt });
      }
    }

    const result: Record<string, { systemPrompt: string; userPrompt: string | null }> = {};
    for (const [code, data] of promptCache) {
      result[code] = data;
    }
    return result;
  }
}

export const modelPromptManager = new ModelPromptManager();
