import { db } from './sqlite';
import { volumes } from './shared/schema';
import { eq, and, asc, desc } from 'drizzle-orm';
import { novelManager } from './novelManager';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export interface VolumeInput {
  novelId: string;
  userId: string;
  title: string;
  summary?: string;
  orderIndex?: number;
}

export const volumeManager = {
  async create(input: VolumeInput) {
    const now = new Date().toISOString();
    const id = generateUUID();
    const existing = await db.select().from(volumes)
      .where(and(eq(volumes.novelId, input.novelId), eq(volumes.userId, input.userId)))
      .orderBy(desc(volumes.orderIndex)).limit(1);
    const orderIndex = input.orderIndex ?? (existing[0]?.orderIndex ?? 0) + 1;
    const [record] = await db.insert(volumes).values({
      id, novelId: input.novelId, userId: input.userId,
      title: input.title, summary: input.summary ?? null, orderIndex,
      chapterCount: 0, wordCount: 0, createdAt: now, updatedAt: now,
    }).returning();
    return record;
  },

  async listByNovel(novelId: string, userId: string) {
    return db.select().from(volumes)
      .where(and(eq(volumes.novelId, novelId), eq(volumes.userId, userId)))
      .orderBy(asc(volumes.orderIndex));
  },

  async get(id: string, userId: string) {
    const [record] = await db.select().from(volumes)
      .where(and(eq(volumes.id, id), eq(volumes.userId, userId)));
    return record;
  },

  async update(id: string, userId: string, data: { title?: string; summary?: string }) {
    const now = new Date().toISOString();
    const updateData: any = { updatedAt: now };
    if (data.title !== undefined) updateData.title = data.title;
    if (data.summary !== undefined) updateData.summary = data.summary;
    const [record] = await db.update(volumes).set(updateData)
      .where(and(eq(volumes.id, id), eq(volumes.userId, userId))).returning();
    return record;
  },

  async delete(id: string, userId: string) {
    const vol = await this.get(id, userId);
    if (vol) {
      const novel = await novelManager.getById(vol.novelId);
      if (novel?.chapters) {
        const chapters = Array.isArray(novel.chapters) ? novel.chapters : [];
        const updated = chapters.map((c: any) =>
          c.volumeId === id ? { ...c, volumeId: null } : c
        );
        await novelManager.update(novel.id, novel.userId, { chapters: updated } as any);
      }
    }
    await db.delete(volumes).where(and(eq(volumes.id, id), eq(volumes.userId, userId)));
    return true;
  },

  async updateStats(id: string, userId: string, chapterCount: number, wordCount: number) {
    const now = new Date().toISOString();
    await db.update(volumes).set({ chapterCount, wordCount, updatedAt: now })
      .where(and(eq(volumes.id, id), eq(volumes.userId, userId)));
  },

  async move(id: string, userId: string, newOrder: number) {
    const now = new Date().toISOString();
    await db.update(volumes).set({ orderIndex: newOrder, updatedAt: now })
      .where(and(eq(volumes.id, id), eq(volumes.userId, userId)));
  },

  async assignChapter(novelId: string, userId: string, chapterNumber: number, volumeId: string | null) {
    const novel = await novelManager.getById(novelId);
    if (!novel) throw new Error('小说不存在');
    const chapters: any[] = Array.isArray(novel.chapters) ? novel.chapters : [];
    const updated = chapters.map((c: any) => {
      if ((c.index ?? 0) === chapterNumber) return { ...c, volumeId };
      return c;
    });
    await novelManager.update(novelId, userId, { chapters: updated } as any);
    await this.recalcStats(novelId, userId);
    return true;
  },

  async assignChaptersBatch(novelId: string, userId: string, assignments: { chapterNumber: number; volumeId: string | null }[]) {
    const novel = await novelManager.getById(novelId);
    if (!novel) throw new Error('小说不存在');
    const chapters: any[] = Array.isArray(novel.chapters) ? novel.chapters : [];
    const assignMap = new Map(assignments.map(a => [a.chapterNumber, a.volumeId]));
    const updated = chapters.map((c: any) => {
      const volId = assignMap.get(c.index ?? 0);
      if (volId !== undefined) return { ...c, volumeId: volId };
      return c;
    });
    await novelManager.update(novelId, userId, { chapters: updated } as any);
    await this.recalcStats(novelId, userId);
    return true;
  },

  async recalcStats(novelId: string, userId: string) {
    const novel = await novelManager.getById(novelId);
    if (!novel) return;
    const chapters: any[] = Array.isArray(novel.chapters) ? novel.chapters : [];
    const volList = await this.listByNovel(novelId, userId);
    for (const vol of volList) {
      const volChapters = chapters.filter((c: any) => c.volumeId === vol.id);
      const chapterCount = volChapters.length;
      const wordCount = volChapters.reduce((sum: number, c: any) => sum + (c.content?.length || 0), 0);
      await this.updateStats(vol.id, userId, chapterCount, wordCount);
    }
  },

  async getChaptersByVolume(novelId: string, userId: string, volumeId: string) {
    const novel = await novelManager.getById(novelId);
    if (!novel) return [];
    const chapters: any[] = Array.isArray(novel.chapters) ? novel.chapters : [];
    return chapters
      .filter((c: any) => c.volumeId === volumeId)
      .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
  },
};
