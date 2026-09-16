import { eq, and, asc, desc, sql } from "drizzle-orm";
import { getDb } from "./sqlite";
import {
	novels,
	insertNovelSchema,
	updateNovelSchema,
	type Novel,
	type InsertNovel,
	type UpdateNovel,
} from "./shared/schema";
import { novelDetailManager } from "./novelDetailManager";
import { scriptManager } from "./scriptManager";
import { shortDramaManager } from "./shortDramaManager";

export class NovelManager {
	/**
	 * 序列化数据，处理 JSON 字段
	 */
	private serializeData(data: Partial<InsertNovel | UpdateNovel>): any {
		const result: any = { ...data };
		// 处理需要 JSON 序列化的字段
		if (result.tone && typeof result.tone !== 'string') {
			result.tone = JSON.stringify(result.tone);
		}
		if (result.idea && typeof result.idea !== 'string') {
			result.idea = JSON.stringify(result.idea);
		}
		if (result.structure && typeof result.structure !== 'string') {
			result.structure = JSON.stringify(result.structure);
		}
		if (result.chapters && typeof result.chapters !== 'string') {
			result.chapters = JSON.stringify(result.chapters);
		}
		if (result.styleDNA && typeof result.styleDNA !== 'string') {
			result.styleDNA = JSON.stringify(result.styleDNA);
		}
		// 公开开关：布尔转 0/1（SQLite 驱动不接受布尔值）
		if (result.isPublic !== undefined && result.isPublic !== null) {
			result.isPublic = result.isPublic ? 1 : 0;
		}
		// 处理日期字段
		if (result.updatedAt) {
			result.updatedAt = result.updatedAt instanceof Date 
				? result.updatedAt.toISOString() 
				: result.updatedAt;
		}
		return result;
	}

	/**
	 * 创建小说
	 */
	async create(data: InsertNovel): Promise<Novel> {
		const db = await getDb();
		const validated = insertNovelSchema.parse(data);
		// 自动生成id
		const id = (validated as any).id || `novel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		// 序列化数据
		const serialized = this.serializeData({ ...validated, id } as any);
		const [novel] = await db.insert(novels).values(serialized).returning();
		return this.deserializeNovel(novel);
	}

	/**
	 * 反序列化小说数据，把 JSON 字符串解析成对象
	 * 同时兜底 createdAt / updatedAt：避免空值/0/非法值 导致前端显示 1970
	 */
	private deserializeNovel(novel: Novel): Novel {
		const result: any = { ...novel };
		// 解析 JSON 字段
		if (result.tone && typeof result.tone === 'string') {
			try { result.tone = JSON.parse(result.tone); } catch { /* 保持原样 */ }
		}
		if (result.idea && typeof result.idea === 'string') {
			try { result.idea = JSON.parse(result.idea); } catch { /* 保持原样 */ }
		}
		if (result.structure && typeof result.structure === 'string') {
			try { result.structure = JSON.parse(result.structure); } catch { /* 保持原样 */ }
		}
		if (result.chapters && typeof result.chapters === 'string') {
			try { result.chapters = JSON.parse(result.chapters); } catch { /* 保持原样 */ }
		}
		if (result.styleDNA && typeof result.styleDNA === 'string') {
			try { result.styleDNA = JSON.parse(result.styleDNA); } catch { /* 保持原样 */ }
		}
		// is_public 兜底为布尔：未设置视为公开，避免历史数据被误隐藏
		result.isPublic = result.isPublic === false || Number(result.isPublic) === 0 ? false : true;
		// ===== ★ 日期兜底（核心修复） =====
		const resolveTs = (val: any): number => {
			if (!val) return 0;
			if (val instanceof Date) return val.getTime();
			if (typeof val === 'number') {
				if (val <= 0) return 0;
				return val < 1e12 ? val * 1000 : val;
			}
			if (typeof val !== 'string') return 0;
			// 纯数字串：秒 / 毫秒
			if (/^\d{10,}$/.test(val)) {
				const n = Number(val);
				return n < 1e12 ? n * 1000 : n;
			}
			const t = Date.parse(val);
			return Number.isNaN(t) ? 0 : t;
		};
		const now = new Date().toISOString();
		const createdTs = resolveTs(result.createdAt);
		const updatedTs = resolveTs(result.updatedAt);
		// createdAt 为空 → 取 updatedAt，仍空 → now
		if (createdTs < 1000) {
			result.createdAt = updatedTs > 1000 ? new Date(updatedTs).toISOString() : now;
		}
		// updatedAt 为空 → 至少等于 createdAt（显示生成日期）
		if (updatedTs < 1000) {
			result.updatedAt = (createdTs > 1000 ? new Date(createdTs) : new Date()).toISOString();
		}
		return result;
	}

	/**
	 * 根据ID获取小说
	 */
	async getById(id: string): Promise<Novel | null> {
		const db = await getDb();
		const result = await db.select().from(novels).where(eq(novels.id, id)).limit(1);
		if (!result[0]) return null;
		return this.deserializeNovel(result[0]);
	}

	/**
	 * 获取用户的小说列表
	 */
	async getUserNovels(
		userId: string,
		options: { status?: string; limit?: number; offset?: number } = {}
	): Promise<{ novels: Novel[]; total: number }> {
		const db = await getDb();
		const conditions: any[] = [eq(novels.userId, userId)];
		if (options.status) {
			conditions.push(eq(novels.status, options.status));
		}

		const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

		// 获取总数
		const countResult = await db
			.select({ count: sql<number>`count(*)` })
			.from(novels)
			.where(whereClause);

		// 获取列表
		const limit = options.limit || 20;
		const offset = options.offset || 0;
		const novelList = await db
			.select()
			.from(novels)
			.where(whereClause)
			.orderBy(desc(novels.updatedAt))
			.limit(limit)
			.offset(offset);

		return {
			novels: novelList.map(novel => this.deserializeNovel(novel)),
			total: Number(countResult[0]?.count) || 0,
		};
	}

	/**
	 * 获取用户已生成章节总数
	 */
	async getUserTotalChapters(userId: string): Promise<number> {
		const db = await getDb();
		const result = await db
			.select({ total: novels.currentChapters })
			.from(novels)
			.where(eq(novels.userId, userId));
		return result.reduce((sum, r) => sum + (r.total || 0), 0);
	}

	/**
	 * 获取用户的小说数量
	 */
	async getUserNovelCount(userId: string): Promise<number> {
		const db = await getDb();
		const result = await db
			.select({ count: sql<number>`count(*)` })
			.from(novels)
			.where(eq(novels.userId, userId));
		return Number(result[0]?.count) || 0;
	}

	/**
	 * 更新小说
	 */
	async update(id: string, userId: string, data: UpdateNovel): Promise<Novel | null> {
		const db = await getDb();
		const validated = updateNovelSchema.parse(data);
		// 序列化数据
		const serialized = this.serializeData({ ...validated, updatedAt: new Date().toISOString() } as any);
		const [novel] = await db
			.update(novels)
			.set(serialized)
			.where(and(eq(novels.id, id), eq(novels.userId, userId)))
			.returning();
		return novel ? this.deserializeNovel(novel) : null;
	}

	/**
	 * 草稿/生成中 状态集合（兼容中英文）
	 */
	private readonly DRAFT_STATUSES = ['draft', 'generating', '生成中', '草稿'];
	private readonly COMPLETED_STATUSES = ['completed', '已完成', '完成'];

	/**
	 * 判断是否为草稿态（参与去重合并）
	 */
	private isDraftStatus(status: string | null | undefined): boolean {
		if (!status) return true;
		const s = String(status).toLowerCase().trim();
		if (this.COMPLETED_STATUSES.includes(s)) return false;
		return true;
	}

	/**
	 * 选择组内冠军：优先 currentChapters DESC，其次 updatedAt DESC
	 */
	private pickWinner(group: Novel[]): Novel {
		return [...group].sort((a, b) => {
			const ac = a.currentChapters || 0;
			const bc = b.currentChapters || 0;
			if (ac !== bc) return bc - ac;
			const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
			const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
			return bt - at;
		})[0];
	}

	/**
	 * 合并 incoming 数据到 champion：新传入非空字段为主，空值时保留 champion 已有的章节/idea/structure
	 */
	private mergeOntoChampion(champion: Novel, incoming: Partial<InsertNovel>): UpdateNovel {
		const pick = <K extends keyof Novel>(key: K, inVal: any): Novel[K] => {
			if (inVal !== undefined && inVal !== null && !(typeof inVal === 'string' && inVal === '')) {
				return inVal as any;
			}
			return champion[key];
		};
		return {
			title: pick('title', incoming.title),
			description: pick('description', incoming.description),
			category: pick('category', incoming.category),
			genderTarget: pick('genderTarget', incoming.genderTarget),
			narrativePerspective: pick('narrativePerspective', incoming.narrativePerspective),
			tone: incoming.tone !== undefined && incoming.tone !== null ? incoming.tone : champion.tone,
			protagonist: pick('protagonist', incoming.protagonist),
			supportingCharacterName: pick('supportingCharacterName', incoming.supportingCharacterName),
			totalChapters: pick('totalChapters', incoming.totalChapters),
			currentChapters: pick('currentChapters', incoming.currentChapters),
			status: incoming.status !== undefined && incoming.status !== null ? incoming.status : champion.status,
			idea: incoming.idea !== undefined && incoming.idea !== null ? incoming.idea : champion.idea,
			structure: incoming.structure !== undefined && incoming.structure !== null ? incoming.structure : champion.structure,
			chapters: incoming.chapters !== undefined && incoming.chapters !== null ? incoming.chapters : champion.chapters,
		} as UpdateNovel;
	}

	/**
	 * 级联删除小说（复用 delete 的级联逻辑，但不校验 userId，内部调用）
	 */
	private async cascadeDeleteById(id: string): Promise<boolean> {
		const db = await getDb();
		const result = await db.delete(novels).where(eq(novels.id, id)).returning();
		if (result.length > 0) {
			await novelDetailManager.deleteAllByNovelId(id).catch(e =>
				console.warn('[NovelManager.dedupe] Failed to cascade delete details:', e)
			);
			await scriptManager.deleteByNovelId(id).catch(e =>
				console.warn('[NovelManager.dedupe] Failed to cascade delete scripts:', e)
			);
			await shortDramaManager.deleteByNovelId(id).catch(e =>
				console.warn('[NovelManager.dedupe] Failed to cascade delete short dramas:', e)
			);
		}
		return result.length > 0;
	}

	/**
	 * 幂等创建或更新草稿小说：按 userId + title(trim) + 草稿态 查找命中则合并（保留章节最多者），删除其余副本
	 * @returns action 新建/更新、保留的novel、本次合并删除的副本数及ID
	 */
	async createOrUpdateDraft(
		userId: string,
		title: string,
		data: Partial<InsertNovel>,
		opts: { dedupe?: boolean } = {}
	): Promise<{
		action: 'created' | 'updated';
		novel: Novel;
		mergedCount: number;
		deletedIds: string[];
		foundDuplicateGroup: boolean;
	}> {
		const db = await getDb();
		const cleanTitle = String(title || '').trim();
		const dedupe = opts.dedupe !== false;
		const deletedIds: string[] = [];

		if (dedupe && cleanTitle) {
			// Step 1: 查询同用户 + 同标题（trim完全一致）+ 草稿态 的所有小说
			const all = await db
				.select()
				.from(novels)
				.where(and(eq(novels.userId, userId), sql`TRIM(novels.title) = ${cleanTitle}`))
				.orderBy(desc(novels.updatedAt));
			const drafts = all
				.map(n => this.deserializeNovel(n))
				.filter(n => this.isDraftStatus(n.status));

			if (drafts.length >= 1) {
				// Step 2: 选冠军（章节最多 / 最新）
				const winner = this.pickWinner(drafts);
				const duplicates = drafts.filter(n => n.id !== winner.id);

				// Step 3: 删除所有非冠军副本（级联）
				for (const dup of duplicates) {
					const ok = await this.cascadeDeleteById(dup.id);
					if (ok) deletedIds.push(dup.id);
				}

				// Step 4: 合并 incoming 到冠军并 UPDATE
				const merged = this.mergeOntoChampion(winner, { ...data, userId, title: cleanTitle });
				const serialized = this.serializeData({ ...merged, updatedAt: new Date().toISOString() } as any);
				const [updated] = await db
					.update(novels)
					.set(serialized)
					.where(eq(novels.id, winner.id))
					.returning();
				return {
					action: 'updated',
					novel: this.deserializeNovel(updated),
					mergedCount: deletedIds.length,
					deletedIds,
					foundDuplicateGroup: drafts.length > 1 || deletedIds.length > 0,
				};
			}
		}

		// 未命中草稿组 → 正常新建
		const createData: InsertNovel = {
			userId,
			title: cleanTitle,
			description: data.description || null,
			category: data.category || null,
			genderTarget: data.genderTarget || null,
			narrativePerspective: data.narrativePerspective || null,
			tone: data.tone || null,
			protagonist: data.protagonist || null,
			supportingCharacterName: data.supportingCharacterName || null,
			totalChapters: data.totalChapters || 10,
			currentChapters: data.currentChapters || 0,
			status: data.status || 'draft',
			idea: data.idea || null,
			structure: data.structure || null,
			chapters: data.chapters || null,
			createdAt: data.createdAt || new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		} as InsertNovel;
		const novel = await this.create(createData);
		return {
			action: 'created',
			novel,
			mergedCount: 0,
			deletedIds: [],
			foundDuplicateGroup: false,
		};
	}

	/**
	 * 批量去重合并草稿 + 清理空草稿
	 * @param targetUserId 指定用户则只处理该用户；传 undefined 则管理员全局处理所有用户
	 * @returns 合并分组数、删除总数、保留ID、删除ID列表、清理空草稿数
	 */
	async dedupeAndMergeDrafts(targetUserId?: string): Promise<{
		groups: number;
		deletedTotal: number;
		keptIds: string[];
		deletedIds: string[];
		emptyDeleted: number;
	}> {
		const db = await getDb();
		const where = targetUserId ? eq(novels.userId, targetUserId) : undefined;
		const allRows = await db.select().from(novels).where(where as any);
		const allNovels = allRows.map(n => this.deserializeNovel(n));

		// === 第一阶段：空草稿清理（currentChapters=0 且 草稿态 且 (createdAt超过30天 或 title空)）===
		const nowTs = Date.now();
		const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
		const emptyDeletable: Novel[] = [];
		for (const n of allNovels) {
			if (!this.isDraftStatus(n.status)) continue;
			const ch = Number(n.currentChapters) || 0;
			const age = n.createdAt ? nowTs - new Date(n.createdAt).getTime() : 0;
			const emptyTitle = !String(n.title || '').trim();
			if (ch === 0 && (emptyTitle || age > THIRTY_DAYS)) {
				emptyDeletable.push(n);
			}
		}
		const emptyDeletedIds: string[] = [];
		for (const n of emptyDeletable) {
			const ok = await this.cascadeDeleteById(n.id);
			if (ok) emptyDeletedIds.push(n.id);
		}
		const remaining = allNovels.filter(n => !emptyDeletedIds.includes(n.id));

		// === 第二阶段：按 (userId, title.trim) 分组草稿态 ===
		const groupMap = new Map<string, Novel[]>();
		for (const n of remaining) {
			if (!this.isDraftStatus(n.status)) continue;
			const key = `${n.userId}::${String(n.title || '').trim()}`;
			if (!groupMap.has(key)) groupMap.set(key, []);
			groupMap.get(key)!.push(n);
		}

		const keptIds: string[] = [];
		const deletedIds: string[] = [];
		let groups = 0;

		for (const [key, group] of groupMap.entries()) {
			if (group.length <= 1) continue;
			groups++;
			const winner = this.pickWinner(group);
			keptIds.push(winner.id);
			const losers = group.filter(n => n.id !== winner.id);
			// 如果冠军章节较少但 loser 有更多章节，合并章节字段到冠军再删除 loser
			let needUpdateWinner = false;
			let merged: any = {};
			for (const loser of losers) {
				const wc = winner.currentChapters || 0;
				const lc = loser.currentChapters || 0;
				if (lc > wc) {
					merged.currentChapters = lc;
					if (loser.chapters && !winner.chapters) merged.chapters = loser.chapters;
					needUpdateWinner = true;
				}
				if (loser.idea && !winner.idea) { merged.idea = loser.idea; needUpdateWinner = true; }
				if (loser.structure && !winner.structure) { merged.structure = loser.structure; needUpdateWinner = true; }
			}
			if (needUpdateWinner) {
				const serialized = this.serializeData({ ...merged, updatedAt: new Date().toISOString() });
				await db.update(novels).set(serialized).where(eq(novels.id, winner.id));
			}
			for (const loser of losers) {
				const ok = await this.cascadeDeleteById(loser.id);
				if (ok) deletedIds.push(loser.id);
			}
		}

		return {
			groups,
			deletedTotal: deletedIds.length + emptyDeletedIds.length,
			keptIds,
			deletedIds: [...deletedIds, ...emptyDeletedIds],
			emptyDeleted: emptyDeletedIds.length,
		};
	}

	/**
	 * 更新小说章节
	 */
	async updateChapters(
		id: string,
		userId: string,
		chapters: unknown
	): Promise<Novel | null> {
		const db = await getDb();
		// 序列化章节数据
		const serializedChapters = typeof chapters !== 'string' ? JSON.stringify(chapters) : chapters;
		const [novel] = await db
			.update(novels)
			.set({
				chapters: serializedChapters,
				updatedAt: new Date().toISOString(),
			})
			.where(and(eq(novels.id, id), eq(novels.userId, userId)))
			.returning();
		return novel ? this.deserializeNovel(novel) : null;
	}

	/**
	 * 更新生成进度
	 */
	async updateProgress(
		id: string,
		userId: string,
		currentChapters: number
	): Promise<Novel | null> {
		const db = await getDb();
		const [novel] = await db
			.update(novels)
			.set({
				currentChapters,
				updatedAt: new Date().toISOString(),
			})
			.where(and(eq(novels.id, id), eq(novels.userId, userId)))
			.returning();
		return novel ? this.deserializeNovel(novel) : null;
	}

	/**
	 * 获取所有小说（管理员用）
	 */
	async getAllNovels(
		options: { search?: string; status?: string; limit?: number; offset?: number; sort?: string; order?: string } = {}
	): Promise<{ novels: Novel[]; total: number }> {
		const db = await getDb();
		const conditions: any[] = [];
		if (options.search) {
			conditions.push(
				sql`(novels.title LIKE ${'%' + options.search + '%'} OR novels.description LIKE ${'%' + options.search + '%'})`
			);
		}
		if (options.status) {
			conditions.push(eq(novels.status, options.status));
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

		const countResult = await db
			.select({ count: sql<number>`count(*)` })
			.from(novels)
			.where(whereClause);

		const limit = options.limit || 20;
		const offset = options.offset || 0;
		// 排序（白名单，默认按更新时间倒序，保持既有行为）
		const sortColumn =
			options.sort === 'title' ? novels.title
			: options.sort === 'chapters' ? novels.currentChapters
			: options.sort === 'totalChapters' ? novels.totalChapters
			: options.sort === 'status' ? novels.status
			: options.sort === 'createdAt' ? novels.createdAt
			: novels.updatedAt;
		const orderByClause = options.order === 'asc' ? asc(sortColumn) : desc(sortColumn);

		const novelList = await db
			.select()
			.from(novels)
			.where(whereClause)
			.orderBy(orderByClause)
			.limit(limit)
			.offset(offset);

		return {
			novels: novelList.map(novel => this.deserializeNovel(novel)),
			total: Number(countResult[0]?.count) || 0,
		};
	}

	/**
	 * 管理员更新小说（不校验 userId）
	 */
	async adminUpdate(id: string, data: UpdateNovel): Promise<Novel | null> {
		const db = await getDb();
		const validated = updateNovelSchema.parse(data);
		// 序列化数据
		const serialized = this.serializeData({ ...validated, updatedAt: new Date().toISOString() } as any);
		const [novel] = await db
			.update(novels)
			.set(serialized)
			.where(eq(novels.id, id))
			.returning();
		return novel ? this.deserializeNovel(novel) : null;
	}

	/**
	 * 删除小说
	 */
	async delete(id: string, userId: string): Promise<boolean> {
		const db = await getDb();
		const result = await db
			.delete(novels)
			.where(and(eq(novels.id, id), eq(novels.userId, userId)))
			.returning();
		if (result.length > 0) {
			// 级联删除子表详情数据
			await novelDetailManager.deleteAllByNovelId(id).catch(e =>
				console.warn('[NovelManager] Failed to cascade delete details:', e)
			);
			// 级联删除剧本（每个剧本内部会再级联删除关联短剧）
			await scriptManager.deleteByNovelId(id).catch(e =>
				console.warn('[NovelManager] Failed to cascade delete scripts:', e)
			);
			// 级联删除直接关联的短剧（novelId 直接指向此小说，但 scriptId 可能为空）
			await shortDramaManager.deleteByNovelId(id).catch(e =>
				console.warn('[NovelManager] Failed to cascade delete short dramas:', e)
			);
		}
		return result.length > 0;
	}
}

export const novelManager = new NovelManager();
