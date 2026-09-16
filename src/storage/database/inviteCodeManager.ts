import { eq, desc, and, sql } from "drizzle-orm";
import { getDb } from "./sqlite";
import { inviteCodes, type InviteCode, type InsertInviteCode, type UpdateInviteCode } from "./shared/schema";

type DbInstance = Awaited<ReturnType<typeof getDb>>;

class InviteCodeManager {
	private db: DbInstance | null = null;

	private async getDb(): Promise<DbInstance> {
		if (!this.db) {
			this.db = await getDb();
		}
		return this.db;
	}

	/**
	 * 创建邀请码
	 */
	async create(data: InsertInviteCode & { levelType?: string; createdBy?: string; id?: string; isActive?: number; isUsedUp?: number; currentUses?: number }): Promise<InviteCode> {
		const id = (data as any).id || `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const [code] = await (await this.getDb()).insert(inviteCodes).values({
			...data,
			id,
			isActive: data.isActive ?? 1,
			isUsedUp: data.isUsedUp ?? 0,
			currentUses: data.currentUses ?? 0,
		} as any).returning();
		return code;
	}

	/**
	 * 批量创建邀请码
	 */
	async batchCreate(codes: (InsertInviteCode & { levelType?: string; createdBy?: string })[]): Promise<InviteCode[]> {
		const results = await (await this.getDb()).insert(inviteCodes).values(codes as any).returning();
		return results;
	}

	/**
	 * 根据ID获取邀请码
	 */
	async getById(id: string): Promise<InviteCode | undefined> {
		const result = await (await this.getDb()).select().from(inviteCodes).where(eq(inviteCodes.id, id)).limit(1);
		return result[0];
	}

	/**
	 * 根据邀请码值获取
	 */
	async getByCode(code: string): Promise<InviteCode | undefined> {
		const result = await (await this.getDb()).select().from(inviteCodes).where(eq(inviteCodes.code, code)).limit(1);
		return result[0];
	}

	/**
	 * 获取所有邀请码（支持分页和等级类型筛选）
	 */
	async list(options: {
		page?: number;
		pageSize?: number;
		levelType?: string;
	} = {}): Promise<{ codes: InviteCode[]; total: number }> {
		const { page = 1, pageSize = 20, levelType } = options;
		const offset = (page - 1) * pageSize;

		const conditions = levelType ? eq(inviteCodes.levelType, levelType) : undefined;

		const [totalResult] = await (await this.getDb())
			.select({ count: sql<number>`count(*)` })
			.from(inviteCodes)
			.where(conditions || sql`1=1`);
		const total = Number(totalResult.count);

		const codes = await (await this.getDb())
			.select()
			.from(inviteCodes)
			.where(conditions || sql`1=1`)
			.orderBy(sql`created_at DESC`)
			.limit(pageSize)
			.offset(offset);
		return { codes, total };
	}

	/**
	 * 更新邀请码
	 */
	async update(id: string, data: UpdateInviteCode): Promise<InviteCode | undefined> {
		const result = await (await this.getDb()).update(inviteCodes)
			.set({ ...data, updatedAt: new Date().toISOString() } as any)
			.where(eq(inviteCodes.id, id))
			.returning();
		return result[0];
	}

	/**
	 * 启用/禁用邀请码
	 */
	async setActive(id: string, isActive: boolean): Promise<InviteCode | undefined> {
		const result = await (await this.getDb()).update(inviteCodes)
			.set({ isActive: isActive ? 1 : 0, updatedAt: new Date().toISOString() })
			.where(eq(inviteCodes.id, id))
			.returning();
		return result[0];
	}

	/**
	 * 删除邀请码
	 */
	async delete(id: string): Promise<boolean> {
		const result = await (await this.getDb()).delete(inviteCodes).where(eq(inviteCodes.id, id)).returning();
		return result.length > 0;
	}

	/**
	 * 使用邀请码（增加使用次数，用完自动标记）
	 */
	async useCode(id: string): Promise<InviteCode | undefined> {
		const result = await (await this.getDb()).update(inviteCodes)
			.set({
				currentUses: sql`current_uses + 1`,
				// 使用次数达到上限时自动标记为已用完并禁用
				isUsedUp: sql`CASE WHEN current_uses + 1 >= max_uses THEN 1 ELSE 0 END`,
				isActive: sql`CASE WHEN current_uses + 1 >= max_uses THEN 0 ELSE 1 END`,
				updatedAt: new Date().toISOString(),
			})
			.where(and(
				eq(inviteCodes.id, id),
				eq(inviteCodes.isActive, 1),
				sql`current_uses < max_uses`,
				sql`(expires_at IS NULL OR datetime(expires_at) > datetime('now'))`
			))
			.returning();
		return result[0];
	}

	/**
	 * 验证邀请码是否有效
	 */
	async validateCode(code: string): Promise<{ valid: boolean; message: string; success: boolean; inviteCode?: InviteCode }> {
		const inviteCode = await this.getByCode(code);
		if (!inviteCode) {
			return { valid: false, message: "邀请码不存在", success: false };
		}
		if (inviteCode.isUsedUp === 1) {
			return { valid: false, message: "邀请码已用完", success: false };
		}
		if (inviteCode.isActive === 0) {
			return { valid: false, message: "邀请码已禁用", success: false };
		}
		if (inviteCode.expiresAt && new Date(inviteCode.expiresAt) < new Date()) {
			return { valid: false, message: "邀请码已过期", success: false };
		}
		if (inviteCode.currentUses >= inviteCode.maxUses) {
			return { valid: false, message: "邀请码使用次数已用完", success: false };
		}
		return { valid: true, message: "邀请码有效", success: true, inviteCode };
	}
}

export const inviteCodeManager = new InviteCodeManager();