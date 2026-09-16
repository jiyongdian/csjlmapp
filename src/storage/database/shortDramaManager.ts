import { eq, and, asc, desc, sql, like, or } from "drizzle-orm";
import { getDb } from "./sqlite";
import { dramaWorkflowManager } from "./dramaWorkflowManager";
import {
	shortDramas,
	shortDramaEpisodes,
	type ShortDrama,
	type InsertShortDrama,
	type UpdateShortDrama,
	type ShortDramaEpisode,
	type InsertShortDramaEpisode,
	type UpdateShortDramaEpisode,
} from "./shared/schema";

function genId(prefix: string) {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export class ShortDramaManager {

	// ======================== 短剧 CRUD ========================

	async create(data: InsertShortDrama): Promise<ShortDrama> {
		const db = await getDb();
		const id = genId('drama');
		const [created] = await db.insert(shortDramas).values({
			id,
			...data,
		} as any).returning();
		return created;
	}

	async getById(id: string): Promise<ShortDrama | null> {
		const db = await getDb();
		const rows = await db.select().from(shortDramas).where(eq(shortDramas.id, id)).limit(1);
		return rows[0] || null;
	}

	async update(id: string, data: UpdateShortDrama): Promise<ShortDrama | null> {
		const db = await getDb();
		const [updated] = await db.update(shortDramas)
			.set({ ...data, updatedAt: new Date().toISOString() })
			.where(eq(shortDramas.id, id))
			.returning();
		return updated || null;
	}

	async delete(id: string): Promise<boolean> {
		const db = await getDb();
		// 级联删除：分集 + 角色/分镜/资产/任务
		await db.delete(shortDramaEpisodes).where(eq(shortDramaEpisodes.dramaId, id));
		await dramaWorkflowManager.deleteAllByDramaId(id);
		const result = await db.delete(shortDramas).where(eq(shortDramas.id, id)).returning();
		return result.length > 0;
	}

	async getUserDramas(userId: string, options?: { status?: string; limit?: number; offset?: number }): Promise<{ dramas: ShortDrama[]; total: number }> {
		const db = await getDb();
		const conditions = [eq(shortDramas.userId, userId)];
		if (options?.status) conditions.push(eq(shortDramas.status, options.status));

		const where = conditions.length === 1 ? conditions[0] : and(...conditions);
		const total = await db.select({ count: sql<number>`count(*)` }).from(shortDramas).where(where);
		const dramas = await db.select().from(shortDramas)
			.where(where)
			.orderBy(desc(shortDramas.updatedAt))
			.limit(options?.limit || 50)
			.offset(options?.offset || 0);
		return { dramas, total: Number(total[0]?.count || 0) };
	}

	async getAllDramas(options?: { search?: string; status?: string; limit?: number; offset?: number; sort?: string; order?: string }): Promise<{ dramas: ShortDrama[]; total: number }> {
		const db = await getDb();
		const conditions: any[] = [];
		if (options?.status) conditions.push(eq(shortDramas.status, options.status));
		if (options?.search) {
			conditions.push(
				or(
					like(shortDramas.title, `%${options.search}%`),
					like(shortDramas.description, `%${options.search}%`)
				)
			);
		}

		const where = conditions.length > 0 ? and(...conditions) : undefined;
		const total = await db.select({ count: sql<number>`count(*)` }).from(shortDramas).where(where);
		// 排序（白名单，默认按更新时间倒序）
		const sortColumn =
			options?.sort === 'title' ? shortDramas.title
			: options?.sort === 'episodes' ? shortDramas.totalEpisodes
			: options?.sort === 'currentEpisodes' ? shortDramas.currentEpisodes
			: options?.sort === 'status' ? shortDramas.status
			: options?.sort === 'createdAt' ? shortDramas.createdAt
			: shortDramas.updatedAt;
		const orderByClause = options?.order === 'asc' ? asc(sortColumn) : desc(sortColumn);

		const dramas = await db.select().from(shortDramas)
			.where(where)
			.orderBy(orderByClause)
			.limit(options?.limit || 50)
			.offset(options?.offset || 0);
		return { dramas, total: Number(total[0]?.count || 0) };
	}

	async getDramasByNovelId(novelId: string): Promise<ShortDrama[]> {
		const db = await getDb();
		return db.select().from(shortDramas)
			.where(eq(shortDramas.novelId, novelId))
			.orderBy(desc(shortDramas.createdAt));
	}

	async getDramasByScriptId(scriptId: string): Promise<ShortDrama[]> {
		const db = await getDb();
		return db.select().from(shortDramas)
			.where(eq(shortDramas.scriptId, scriptId))
			.orderBy(desc(shortDramas.createdAt));
	}

	// ======================== 分集 CRUD ========================

	async createEpisode(data: InsertShortDramaEpisode): Promise<ShortDramaEpisode> {
		const db = await getDb();
		const id = genId('ep');
		const [created] = await db.insert(shortDramaEpisodes).values({
			id,
			...data,
		} as any).returning();
		// 更新短剧的 currentEpisodes
		await this.refreshEpisodeCount(data.dramaId);
		return created;
	}

	async getEpisodeById(id: string): Promise<ShortDramaEpisode | null> {
		const db = await getDb();
		const rows = await db.select().from(shortDramaEpisodes).where(eq(shortDramaEpisodes.id, id)).limit(1);
		return rows[0] || null;
	}

	async getEpisodesByDramaId(dramaId: string): Promise<ShortDramaEpisode[]> {
		const db = await getDb();
		return db.select().from(shortDramaEpisodes)
			.where(eq(shortDramaEpisodes.dramaId, dramaId))
			.orderBy(asc(shortDramaEpisodes.episodeNumber));
	}

	async updateEpisode(id: string, data: UpdateShortDramaEpisode): Promise<ShortDramaEpisode | null> {
		const db = await getDb();
		const [updated] = await db.update(shortDramaEpisodes)
			.set({ ...data, updatedAt: new Date().toISOString() })
			.where(eq(shortDramaEpisodes.id, id))
			.returning();
		return updated || null;
	}

	async deleteEpisode(id: string): Promise<boolean> {
		const db = await getDb();
		const ep = await this.getEpisodeById(id);
		
		// 级联删除该分集的分镜与资产（以及自动删除其磁盘物理文件）
		await dramaWorkflowManager.deleteShotsByEpisodeId(id);
		await dramaWorkflowManager.deleteAssetsByEpisodeId(id);

		const result = await db.delete(shortDramaEpisodes).where(eq(shortDramaEpisodes.id, id)).returning();
		if (result.length > 0 && ep) {
			await this.refreshEpisodeCount(ep.dramaId);
		}
		return result.length > 0;
	}

	async deleteEpisodesByDramaId(dramaId: string): Promise<void> {
		const db = await getDb();
		await db.delete(shortDramaEpisodes).where(eq(shortDramaEpisodes.dramaId, dramaId));
	}

	// ======================== 辅助 ========================

	async refreshEpisodeCount(dramaId: string): Promise<void> {
		const db = await getDb();
		const result = await db.select({ count: sql<number>`count(*)` })
			.from(shortDramaEpisodes)
			.where(eq(shortDramaEpisodes.dramaId, dramaId));
		const count = Number(result[0]?.count || 0);
		await db.update(shortDramas)
			.set({ currentEpisodes: count, updatedAt: new Date().toISOString() })
			.where(eq(shortDramas.id, dramaId));
	}

	/**
	 * 获取短剧详情（含所有分集）
	 */
	async getDramaWithEpisodes(id: string): Promise<{ drama: ShortDrama; episodes: ShortDramaEpisode[] } | null> {
		const drama = await this.getById(id);
		if (!drama) return null;
		const episodes = await this.getEpisodesByDramaId(id);
		return { drama, episodes };
	}

	/**
	 * 删除小说关联的所有短剧（含分集/工作流）
	 */
	async deleteByNovelId(novelId: string): Promise<void> {
		const db = await getDb();
		const list = await db.select({ id: shortDramas.id }).from(shortDramas).where(eq(shortDramas.novelId, novelId));
		for (const item of list) {
			await this.delete(item.id);
		}
	}

	/**
	 * 删除剧本关联的所有短剧（含分集/工作流）
	 */
	async deleteByScriptId(scriptId: string): Promise<void> {
		const db = await getDb();
		const list = await db.select({ id: shortDramas.id }).from(shortDramas).where(eq(shortDramas.scriptId, scriptId));
		for (const item of list) {
			await this.delete(item.id);
		}
	}
}

export const shortDramaManager = new ShortDramaManager();
