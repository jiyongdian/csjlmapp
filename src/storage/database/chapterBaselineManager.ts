import { db } from './sqlite';
import { chapterBaselines } from './shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import crypto from 'crypto';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content || '').digest('hex').slice(0, 16);
}

export const chapterBaselineManager = {
  /**
   * 保存 AI 生成的章节内容作为基线
   */
  async saveBaseline(novelId: string, userId: string, chapterNumber: number, content: string) {
    const now = new Date().toISOString();
    const hash = hashContent(content);
    const existing = await db.select().from(chapterBaselines)
      .where(and(eq(chapterBaselines.novelId, novelId), eq(chapterBaselines.chapterNumber, chapterNumber)))
      .limit(1);

    if (existing[0]) {
      // 如果用户没编辑过，直接更新基线
      if (!existing[0].userEdited) {
        await db.update(chapterBaselines).set({
          baselineContent: content,
          baselineHash: hash,
          currentContent: content,
          currentHash: hash,
          lastAiGeneratedAt: now,
          updatedAt: now,
        }).where(eq(chapterBaselines.id, existing[0].id));
        return { ...existing[0], baselineContent: content, currentContent: content, userEdited: 0 };
      } else {
        // 用户编辑过，标记为冲突
        return { conflict: true, existing: existing[0] };
      }
    } else {
      const [record] = await db.insert(chapterBaselines).values({
        id: generateUUID(),
        novelId, userId, chapterNumber,
        baselineContent: content,
        baselineHash: hash,
        currentContent: content,
        currentHash: hash,
        userEdited: 0,
        lastAiGeneratedAt: now,
        createdAt: now,
        updatedAt: now,
      }).returning();
      return record;
    }
  },

  /**
   * 检测章节是否被用户修改
   */
  async checkConflict(novelId: string, chapterNumber: number, newContent: string): Promise<boolean> {
    const [baseline] = await db.select().from(chapterBaselines)
      .where(and(eq(chapterBaselines.novelId, novelId), eq(chapterBaselines.chapterNumber, chapterNumber)))
      .limit(1);

    if (!baseline) return false;
    if (!baseline.userEdited) return false;

    const newHash = hashContent(newContent);
    // 如果新内容和当前内容（用户编辑后的）不同，说明有冲突
    return baseline.currentHash !== newHash;
  },

  /**
   * 记录用户编辑
   */
  async recordUserEdit(novelId: string, userId: string, chapterNumber: number, content: string) {
    const now = new Date().toISOString();
    const hash = hashContent(content);
    const [existing] = await db.select().from(chapterBaselines)
      .where(and(eq(chapterBaselines.novelId, novelId), eq(chapterBaselines.chapterNumber, chapterNumber)))
      .limit(1);

    if (existing) {
      await db.update(chapterBaselines).set({
        currentContent: content,
        currentHash: hash,
        userEdited: 1,
        lastUserEditedAt: now,
        updatedAt: now,
      }).where(eq(chapterBaselines.id, existing.id));
      return { ...existing, currentContent: content, userEdited: 1 };
    } else {
      // 没有基线，直接创建（用户编辑的是原始内容）
      const [record] = await db.insert(chapterBaselines).values({
        id: generateUUID(),
        novelId, userId, chapterNumber,
        baselineContent: content,
        baselineHash: hash,
        currentContent: content,
        currentHash: hash,
        userEdited: 1,
        lastUserEditedAt: now,
        createdAt: now,
        updatedAt: now,
      }).returning();
      return record;
    }
  },

  /**
   * 强制覆盖（用户确认后）
   */
  async forceOverwrite(novelId: string, userId: string, chapterNumber: number, content: string) {
    const now = new Date().toISOString();
    const hash = hashContent(content);
    const [existing] = await db.select().from(chapterBaselines)
      .where(and(eq(chapterBaselines.novelId, novelId), eq(chapterBaselines.chapterNumber, chapterNumber)))
      .limit(1);

    if (existing) {
      await db.update(chapterBaselines).set({
        baselineContent: content,
        baselineHash: hash,
        currentContent: content,
        currentHash: hash,
        userEdited: 0,
        lastAiGeneratedAt: now,
        updatedAt: now,
      }).where(eq(chapterBaselines.id, existing.id));
    }
    return true;
  },

  async getByChapter(novelId: string, chapterNumber: number) {
    const [record] = await db.select().from(chapterBaselines)
      .where(and(eq(chapterBaselines.novelId, novelId), eq(chapterBaselines.chapterNumber, chapterNumber)))
      .limit(1);
    return record;
  },

  async listByNovel(novelId: string, userId: string) {
    return db.select().from(chapterBaselines)
      .where(and(eq(chapterBaselines.novelId, novelId), eq(chapterBaselines.userId, userId)))
      .orderBy(desc(chapterBaselines.chapterNumber));
  },

  async getUserEditedChapters(novelId: string, userId: string) {
    return db.select().from(chapterBaselines)
      .where(and(eq(chapterBaselines.novelId, novelId), eq(chapterBaselines.userId, userId), eq(chapterBaselines.userEdited, 1)));
  },
};
