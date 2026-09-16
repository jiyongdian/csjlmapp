import { eq, and, asc, desc, sql } from "drizzle-orm";
import { getDb } from "./sqlite";
import { normalizeSceneAtmosphereInput } from "@/lib/scene-atmosphere";
import { normalizeItemSignificanceInput } from "@/lib/item-significance";
import {
	novelPlots,
	novelChapterHooks,
	novelCharacters,
	novelScenes,
	novelItems,
	novelCharacterRelationships,
	novelCharacterConflicts,
	type NovelPlot,
	type InsertNovelPlot,
	type UpdateNovelPlot,
	type NovelChapterHook,
	type InsertNovelChapterHook,
	type UpdateNovelChapterHook,
	type NovelCharacter,
	type InsertNovelCharacter,
	type UpdateNovelCharacter,
	type NovelScene,
	type InsertNovelScene,
	type UpdateNovelScene,
	type NovelItem,
	type InsertNovelItem,
	type UpdateNovelItem,
	type NovelCharacterRelationship,
	type InsertNovelCharacterRelationship,
	type NovelCharacterConflict,
	type InsertNovelCharacterConflict,
} from "./shared/schema";

function genId(prefix: string) {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export class NovelDetailManager {

	// ======================== 剧情 (Plot) ========================

	async getPlotByNovelId(novelId: string): Promise<NovelPlot | null> {
		const db = await getDb();
		const rows = await db.select().from(novelPlots).where(eq(novelPlots.novelId, novelId)).limit(1);
		return rows[0] || null;
	}

	async upsertPlot(novelId: string, userId: string, data: Partial<UpdateNovelPlot>): Promise<NovelPlot> {
		const db = await getDb();
		const existing = await this.getPlotByNovelId(novelId);
		if (existing) {
			const [updated] = await db.update(novelPlots)
				.set({ ...data, updatedAt: new Date().toISOString() })
				.where(eq(novelPlots.id, existing.id))
				.returning();
			return updated;
		}
		const id = genId('plot');
		const [created] = await db.insert(novelPlots).values({
			id,
			novelId,
			userId,
			mainPlot: data.mainPlot ?? null,
			emotionalCurve: data.emotionalCurve ?? null,
			keyConflicts: data.keyConflicts ?? null,
			sortOrder: data.sortOrder ?? 0,
		}).returning();
		return created;
	}

	async deletePlotByNovelId(novelId: string): Promise<void> {
		const db = await getDb();
		await db.delete(novelPlots).where(eq(novelPlots.novelId, novelId));
	}

	// ======================== 章节钩子 (ChapterHook) ========================

	async getHooksByNovelId(novelId: string): Promise<NovelChapterHook[]> {
		const db = await getDb();
		return db.select().from(novelChapterHooks)
			.where(eq(novelChapterHooks.novelId, novelId))
			.orderBy(asc(novelChapterHooks.chapterNumber));
	}

	async getHookByChapter(novelId: string, chapterNumber: number): Promise<NovelChapterHook | null> {
		const db = await getDb();
		const rows = await db.select().from(novelChapterHooks)
			.where(and(eq(novelChapterHooks.novelId, novelId), eq(novelChapterHooks.chapterNumber, chapterNumber)))
			.limit(1);
		return rows[0] || null;
	}

	async upsertHook(novelId: string, userId: string, chapterNumber: number, data: { title?: string; hook?: string; status?: string }): Promise<NovelChapterHook> {
		const db = await getDb();
		const existing = await this.getHookByChapter(novelId, chapterNumber);
		if (existing) {
			const [updated] = await db.update(novelChapterHooks)
				.set({ ...data, updatedAt: new Date().toISOString() })
				.where(eq(novelChapterHooks.id, existing.id))
				.returning();
			return updated;
		}
		const id = genId('hook');
		const [created] = await db.insert(novelChapterHooks).values({
			id,
			novelId,
			userId,
			chapterNumber,
			title: data.title ?? null,
			hook: data.hook ?? null,
			status: data.status ?? 'pending',
		}).returning();
		return created;
	}

	async bulkUpsertHooks(novelId: string, userId: string, hooks: { chapterNumber: number; title?: string; hook: string; status?: string }[]): Promise<NovelChapterHook[]> {
		const results: NovelChapterHook[] = [];
		for (const h of hooks) {
			const row = await this.upsertHook(novelId, userId, h.chapterNumber, {
				title: h.title,
				hook: h.hook,
				status: h.status ?? 'pending',
			});
			results.push(row);
		}
		return results;
	}

	async deleteHooksByNovelId(novelId: string): Promise<void> {
		const db = await getDb();
		await db.delete(novelChapterHooks).where(eq(novelChapterHooks.novelId, novelId));
	}

	async deleteHook(id: string): Promise<void> {
		const db = await getDb();
		await db.delete(novelChapterHooks).where(eq(novelChapterHooks.id, id));
	}

	// ======================== 角色 (Character) ========================

	async getCharactersByNovelId(novelId: string): Promise<NovelCharacter[]> {
		const db = await getDb();
		return db.select().from(novelCharacters)
			.where(eq(novelCharacters.novelId, novelId))
			.orderBy(asc(novelCharacters.sortOrder));
	}

	async getCharacterById(id: string): Promise<NovelCharacter | null> {
		const db = await getDb();
		const rows = await db.select().from(novelCharacters).where(eq(novelCharacters.id, id)).limit(1);
		return rows[0] || null;
	}

	async createCharacter(novelId: string, userId: string, data: Omit<InsertNovelCharacter, 'novelId' | 'userId'>): Promise<NovelCharacter> {
		const db = await getDb();
		const id = genId('char');
		const [created] = await db.insert(novelCharacters).values({
			id,
			novelId,
			userId,
			name: data.name,
			role: data.role ?? 'supporting',
			gender: data.gender ?? null,
			description: data.description ?? null,
			personality: data.personality ?? null,
			appearance: data.appearance ?? null,
			aliases: data.aliases ?? null,
			appearanceHairColor: data.appearanceHairColor ?? null,
			appearanceHairstyle: data.appearanceHairstyle ?? null,
			appearanceEyes: data.appearanceEyes ?? null,
			appearanceUpper: data.appearanceUpper ?? null,
			appearanceLower: data.appearanceLower ?? null,
			background: data.background ?? null,
			relationships: data.relationships ?? null,
			sortOrder: data.sortOrder ?? 0,
		}).returning();
		return created;
	}

	async updateCharacter(id: string, data: UpdateNovelCharacter): Promise<NovelCharacter | null> {
		const db = await getDb();
		const [updated] = await db.update(novelCharacters)
			.set({ ...data, updatedAt: new Date().toISOString() })
			.where(eq(novelCharacters.id, id))
			.returning();
		return updated || null;
	}

	async deleteCharacter(id: string): Promise<void> {
		const db = await getDb();
		await db.delete(novelCharacters).where(eq(novelCharacters.id, id));
	}

	async deleteCharactersByNovelId(novelId: string): Promise<void> {
		const db = await getDb();
		await db.delete(novelCharacters).where(eq(novelCharacters.novelId, novelId));
	}

	async bulkCreateCharacters(novelId: string, userId: string, characters: Omit<InsertNovelCharacter, 'novelId' | 'userId'>[]): Promise<NovelCharacter[]> {
		const results: NovelCharacter[] = [];
		for (const c of characters) {
			const row = await this.createCharacter(novelId, userId, c);
			results.push(row);
		}
		return results;
	}

	// ======================== 场景 (Scene) ========================

	async getScenesByNovelId(novelId: string): Promise<NovelScene[]> {
		const db = await getDb();
		return db.select().from(novelScenes)
			.where(eq(novelScenes.novelId, novelId))
			.orderBy(asc(novelScenes.sortOrder));
	}

	async getSceneById(id: string): Promise<NovelScene | null> {
		const db = await getDb();
		const rows = await db.select().from(novelScenes).where(eq(novelScenes.id, id)).limit(1);
		return rows[0] || null;
	}

	async createScene(novelId: string, userId: string, data: Omit<InsertNovelScene, 'novelId' | 'userId'>): Promise<NovelScene> {
		const db = await getDb();
		const id = genId('scene');
		const sceneData = normalizeSceneAtmosphereInput(data);
		const [created] = await db.insert(novelScenes).values({
			id,
			novelId,
			userId,
			name: sceneData.name,
			description: sceneData.description ?? null,
			atmosphere: sceneData.atmosphere ?? null,
			relatedChapters: sceneData.relatedChapters ?? null,
			sortOrder: sceneData.sortOrder ?? 0,
		}).returning();
		return created;
	}

	async updateScene(id: string, data: UpdateNovelScene): Promise<NovelScene | null> {
		const db = await getDb();
		const sceneData = normalizeSceneAtmosphereInput(data);
		const [updated] = await db.update(novelScenes)
			.set({ ...sceneData, updatedAt: new Date().toISOString() })
			.where(eq(novelScenes.id, id))
			.returning();
		return updated || null;
	}

	async deleteScene(id: string): Promise<void> {
		const db = await getDb();
		await db.delete(novelScenes).where(eq(novelScenes.id, id));
	}

	async deleteScenesByNovelId(novelId: string): Promise<void> {
		const db = await getDb();
		await db.delete(novelScenes).where(eq(novelScenes.novelId, novelId));
	}

	async bulkCreateScenes(novelId: string, userId: string, scenes: Omit<InsertNovelScene, 'novelId' | 'userId'>[]): Promise<NovelScene[]> {
		const results: NovelScene[] = [];
		for (const s of scenes) {
			const row = await this.createScene(novelId, userId, s);
			results.push(row);
		}
		return results;
	}

	// ======================== 物品 (Item) ========================

	async getItemsByNovelId(novelId: string): Promise<NovelItem[]> {
		const db = await getDb();
		return db.select().from(novelItems)
			.where(eq(novelItems.novelId, novelId))
			.orderBy(asc(novelItems.sortOrder));
	}

	async getItemById(id: string): Promise<NovelItem | null> {
		const db = await getDb();
		const rows = await db.select().from(novelItems).where(eq(novelItems.id, id)).limit(1);
		return rows[0] || null;
	}

	async createItem(novelId: string, userId: string, data: Omit<InsertNovelItem, 'novelId' | 'userId'>): Promise<NovelItem> {
		const db = await getDb();
		const id = genId('item');
		const itemData = normalizeItemSignificanceInput(data);
		const [created] = await db.insert(novelItems).values({
			id,
			novelId,
			userId,
			name: itemData.name,
			description: itemData.description ?? null,
			significance: itemData.significance ?? null,
			relatedChapters: itemData.relatedChapters ?? null,
			sortOrder: itemData.sortOrder ?? 0,
		}).returning();
		return created;
	}

	async updateItem(id: string, data: UpdateNovelItem): Promise<NovelItem | null> {
		const db = await getDb();
		const itemData = normalizeItemSignificanceInput(data);
		const [updated] = await db.update(novelItems)
			.set({ ...itemData, updatedAt: new Date().toISOString() })
			.where(eq(novelItems.id, id))
			.returning();
		return updated || null;
	}

	async deleteItem(id: string): Promise<void> {
		const db = await getDb();
		await db.delete(novelItems).where(eq(novelItems.id, id));
	}

	async deleteItemsByNovelId(novelId: string): Promise<void> {
		const db = await getDb();
		await db.delete(novelItems).where(eq(novelItems.novelId, novelId));
	}

	async bulkCreateItems(novelId: string, userId: string, items: Omit<InsertNovelItem, 'novelId' | 'userId'>[]): Promise<NovelItem[]> {
		const results: NovelItem[] = [];
		for (const it of items) {
			const row = await this.createItem(novelId, userId, it);
			results.push(row);
		}
		return results;
	}

	// ======================== 角色关系 (CharacterRelationship) ========================

	async getRelationshipsByNovelId(novelId: string): Promise<NovelCharacterRelationship[]> {
		const db = await getDb();
		return db.select().from(novelCharacterRelationships)
			.where(eq(novelCharacterRelationships.novelId, novelId))
			.orderBy(asc(novelCharacterRelationships.sortOrder));
	}

	async createRelationship(novelId: string, userId: string, data: Omit<InsertNovelCharacterRelationship, 'novelId' | 'userId'>): Promise<NovelCharacterRelationship> {
		const db = await getDb();
		const id = genId('rel');
		const [created] = await db.insert(novelCharacterRelationships).values({
			id, novelId, userId,
			fromCharacter: data.fromCharacter,
			toCharacter: data.toCharacter,
			relationship: data.relationship ?? null,
			sortOrder: data.sortOrder ?? 0,
		}).returning();
		return created;
	}

	async deleteRelationshipsByNovelId(novelId: string): Promise<void> {
		const db = await getDb();
		await db.delete(novelCharacterRelationships).where(eq(novelCharacterRelationships.novelId, novelId));
	}

	async bulkCreateRelationships(novelId: string, userId: string, rels: Omit<InsertNovelCharacterRelationship, 'novelId' | 'userId'>[]): Promise<NovelCharacterRelationship[]> {
		const results: NovelCharacterRelationship[] = [];
		for (const r of rels) {
			results.push(await this.createRelationship(novelId, userId, r));
		}
		return results;
	}

	async updateRelationship(id: string, data: Partial<NovelCharacterRelationship>): Promise<NovelCharacterRelationship | null> {
		const db = await getDb();
		const [updated] = await db.update(novelCharacterRelationships)
			.set(data)
			.where(eq(novelCharacterRelationships.id, id))
			.returning();
		return updated || null;
	}

	// ======================== 角色冲突 (CharacterConflict) ========================

	async getConflictsByNovelId(novelId: string): Promise<NovelCharacterConflict[]> {
		const db = await getDb();
		return db.select().from(novelCharacterConflicts)
			.where(eq(novelCharacterConflicts.novelId, novelId))
			.orderBy(asc(novelCharacterConflicts.sortOrder));
	}

	async createConflict(novelId: string, userId: string, data: Omit<InsertNovelCharacterConflict, 'novelId' | 'userId'>): Promise<NovelCharacterConflict> {
		const db = await getDb();
		const id = genId('conflict');
		const [created] = await db.insert(novelCharacterConflicts).values({
			id, novelId, userId,
			fromCharacter: data.fromCharacter,
			toCharacter: data.toCharacter,
			conflictType: data.conflictType ?? null,
			description: data.description ?? null,
			sortOrder: data.sortOrder ?? 0,
		}).returning();
		return created;
	}

	async deleteConflictsByNovelId(novelId: string): Promise<void> {
		const db = await getDb();
		await db.delete(novelCharacterConflicts).where(eq(novelCharacterConflicts.novelId, novelId));
	}

	async bulkCreateConflicts(novelId: string, userId: string, conflicts: Omit<InsertNovelCharacterConflict, 'novelId' | 'userId'>[]): Promise<NovelCharacterConflict[]> {
		const results: NovelCharacterConflict[] = [];
		for (const c of conflicts) {
			results.push(await this.createConflict(novelId, userId, c));
		}
		return results;
	}

	// ======================== 聚合查询 ========================

	/**
	 * 获取小说的全部结构化详情（剧情 + 钩子 + 角色 + 场景 + 物品 + 关系 + 冲突）
	 */
	async getNovelDetails(novelId: string) {
		try {
			const [plot, hooks, characters, scenes, items, relationships] = await Promise.all([
				this.getPlotByNovelId(novelId),
				this.getHooksByNovelId(novelId),
				this.getCharactersByNovelId(novelId),
				this.getScenesByNovelId(novelId),
				this.getItemsByNovelId(novelId),
				this.getRelationshipsByNovelId(novelId),
			]);
			
			// 冲突表可能不存在，单独处理
			let conflicts: any[] = [];
			try {
				conflicts = await this.getConflictsByNovelId(novelId);
			} catch (e) {
				console.warn('[getNovelDetails] Conflicts table may not exist:', e);
			}
			
			return { plot, hooks, characters, scenes, items, relationships, conflicts };
		} catch (error) {
			console.error('[getNovelDetails] Error for novelId:', novelId, error);
			throw error;
		}
	}

	/**
	 * 删除小说的全部结构化数据
	 */
	async deleteAllByNovelId(novelId: string): Promise<void> {
		await Promise.all([
			this.deletePlotByNovelId(novelId),
			this.deleteHooksByNovelId(novelId),
			this.deleteCharactersByNovelId(novelId),
			this.deleteScenesByNovelId(novelId),
			this.deleteItemsByNovelId(novelId),
			this.deleteRelationshipsByNovelId(novelId),
			this.deleteConflictsByNovelId(novelId),
		]);
	}
}

export const novelDetailManager = new NovelDetailManager();
