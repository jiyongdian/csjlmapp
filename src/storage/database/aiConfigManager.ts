import { eq, and, or, isNull, asc, desc, sql, SQL } from "drizzle-orm";
import { getDb } from "./sqlite";
import {
	aiConfigs,
	insertAiConfigSchema,
	updateAiConfigSchema,
	type AiConfig,
	type InsertAiConfig,
	type UpdateAiConfig,
} from "./shared/schema";

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export class AiConfigManager {
	async getConfigsByUserId(userId: string): Promise<AiConfig[]> {
		const db = await getDb();
		const result = await db
			.select()
			.from(aiConfigs)
			.where(and(eq(aiConfigs.userId, userId), eq(aiConfigs.scope, 'user')))
			.orderBy(desc(aiConfigs.isDefault), asc(aiConfigs.createdAt));
		return result;
	}

	async getSystemConfigs(): Promise<AiConfig[]> {
		const db = await getDb();
		const result = await db
			.select()
			.from(aiConfigs)
			.where(and(isNull(aiConfigs.userId), eq(aiConfigs.scope, 'system'), eq(aiConfigs.isActive, 1)))
			.orderBy(desc(aiConfigs.isDefault), asc(aiConfigs.createdAt));
		return result;
	}

	async getAllSystemConfigs(): Promise<AiConfig[]> {
		const db = await getDb();
		const result = await db
			.select()
			.from(aiConfigs)
			.where(and(isNull(aiConfigs.userId), eq(aiConfigs.scope, 'system')))
			.orderBy(desc(aiConfigs.isActive), desc(aiConfigs.isDefault), asc(aiConfigs.createdAt));
		return result;
	}

	async getAvailableConfigs(userId: string): Promise<{ system: AiConfig[]; user: AiConfig[] }> {
		const [system, user] = await Promise.all([
			this.getSystemConfigs(),
			this.getConfigsByUserId(userId),
		]);
		return { system, user };
	}

	async getDefaultConfig(userId: string): Promise<AiConfig | null> {
		const db = await getDb();
		const userDefault = await db
			.select()
			.from(aiConfigs)
			.where(and(eq(aiConfigs.userId, userId), eq(aiConfigs.isDefault, 1)))
			.limit(1);
		if (userDefault[0]) return userDefault[0];

		const systemDefault = await db
			.select()
			.from(aiConfigs)
			.where(and(isNull(aiConfigs.userId), eq(aiConfigs.scope, 'system'), eq(aiConfigs.isDefault, 1), eq(aiConfigs.isActive, 1)))
			.limit(1);
		return systemDefault[0] || null;
	}

	async getConfigById(id: string): Promise<AiConfig | null> {
		const db = await getDb();
		const result = await db
			.select()
			.from(aiConfigs)
			.where(and(eq(aiConfigs.id, id), eq(aiConfigs.isActive, 1)))
			.limit(1);
		return result[0] || null;
	}

	async getConfigByIdAdmin(id: string): Promise<AiConfig | null> {
		const db = await getDb();
		const result = await db
			.select()
			.from(aiConfigs)
			.where(eq(aiConfigs.id, id))
			.limit(1);
		return result[0] || null;
	}

	async createConfig(data: InsertAiConfig): Promise<AiConfig> {
		const db = await getDb();
		const result = await db.insert(aiConfigs).values({
			...data,
			id: generateUUID()
		}).returning();
		return result[0];
	}

	async updateConfig(id: string, userId: string, data: UpdateAiConfig): Promise<AiConfig | null> {
		const db = await getDb();
		const result = await db
			.update(aiConfigs)
			.set(data)
			.where(and(eq(aiConfigs.id, id), eq(aiConfigs.userId, userId)))
			.returning();
		return result[0] || null;
	}

	async updateSystemConfig(id: string, data: UpdateAiConfig): Promise<AiConfig | null> {
		const db = await getDb();
		const result = await db
			.update(aiConfigs)
			.set(data)
			.where(and(eq(aiConfigs.id, id), isNull(aiConfigs.userId), eq(aiConfigs.scope, 'system')))
			.returning();
		return result[0] || null;
	}

	async deleteConfig(id: string, userId: string): Promise<boolean> {
		const db = await getDb();
		const result = await db
			.delete(aiConfigs)
			.where(and(eq(aiConfigs.id, id), eq(aiConfigs.userId, userId)))
			.returning();
		return result.length > 0;
	}

	async deleteSystemConfig(id: string): Promise<boolean> {
		const db = await getDb();
		const result = await db
			.delete(aiConfigs)
			.where(and(eq(aiConfigs.id, id), isNull(aiConfigs.userId), eq(aiConfigs.scope, 'system')))
			.returning();
		return result.length > 0;
	}

	async setDefaultConfig(id: string, userId: string): Promise<boolean> {
		const db = await getDb();
		await db
			.update(aiConfigs)
			.set({ isDefault: 0 })
			.where(and(eq(aiConfigs.userId, userId), eq(aiConfigs.scope, 'user')));
		const result = await db
			.update(aiConfigs)
			.set({ isDefault: 1 })
			.where(and(eq(aiConfigs.id, id), eq(aiConfigs.userId, userId)))
			.returning();
		return result.length > 0;
	}

	async setSystemDefaultConfig(id: string): Promise<boolean> {
		const db = await getDb();
		await db
			.update(aiConfigs)
			.set({ isDefault: 0 })
			.where(and(isNull(aiConfigs.userId), eq(aiConfigs.scope, 'system')));
		const result = await db
			.update(aiConfigs)
			.set({ isDefault: 1 })
			.where(and(eq(aiConfigs.id, id), isNull(aiConfigs.userId), eq(aiConfigs.scope, 'system')))
			.returning();
		return result.length > 0;
	}

	async getSystemConfigsByModelType(modelType: string): Promise<AiConfig[]> {
		const db = await getDb();
		return db.select().from(aiConfigs)
			.where(and(isNull(aiConfigs.userId), eq(aiConfigs.scope, 'system'), eq(aiConfigs.modelType, modelType)))
			.orderBy(desc(aiConfigs.isDefault), desc(aiConfigs.isActive), asc(aiConfigs.createdAt));
	}

	async getAllMediaConfigs(): Promise<AiConfig[]> {
		const db = await getDb();
		return db.select().from(aiConfigs)
			.where(and(isNull(aiConfigs.userId), eq(aiConfigs.scope, 'system'), or(eq(aiConfigs.modelType, 'image'), eq(aiConfigs.modelType, 'video'), eq(aiConfigs.modelType, 'tts'))))
			.orderBy(asc(aiConfigs.modelType), desc(aiConfigs.isDefault), asc(aiConfigs.createdAt));
	}

	async updateSystemConfigAdmin(id: string, data: Partial<AiConfig>): Promise<AiConfig | null> {
		const db = await getDb();
		const result = await db.update(aiConfigs).set({ ...data, updatedAt: new Date().toISOString() })
			.where(and(eq(aiConfigs.id, id), isNull(aiConfigs.userId), eq(aiConfigs.scope, 'system')))
			.returning();
		return result[0] || null;
	}

	async setMediaDefaultConfig(id: string, modelType: string): Promise<boolean> {
		const db = await getDb();
		await db.update(aiConfigs).set({ isDefault: 0 })
			.where(and(isNull(aiConfigs.userId), eq(aiConfigs.scope, 'system'), eq(aiConfigs.modelType, modelType)));
		const result = await db.update(aiConfigs).set({ isDefault: 1 })
			.where(and(eq(aiConfigs.id, id), isNull(aiConfigs.userId), eq(aiConfigs.scope, 'system')))
			.returning();
		return result.length > 0;
	}

	/** 某用户指定类型（image / video / tts）的全部配置 */
	async getUserConfigsByModelType(userId: string, modelType: string): Promise<AiConfig[]> {
		const db = await getDb();
		return db.select().from(aiConfigs)
			.where(and(eq(aiConfigs.userId, userId), eq(aiConfigs.scope, 'user'), eq(aiConfigs.modelType, modelType)))
			.orderBy(desc(aiConfigs.isDefault), desc(aiConfigs.isActive), asc(aiConfigs.createdAt));
	}

	/** 用户自己的配置设为默认（仅在同一类型内互斥，校验归属） */
	async setUserMediaDefaultConfigById(id: string, userId: string): Promise<AiConfig | null> {
		const db = await getDb();
		const found = await db.select().from(aiConfigs)
			.where(and(eq(aiConfigs.id, id), eq(aiConfigs.userId, userId)))
			.limit(1);
		const target = found[0];
		if (!target) return null;
		await db.update(aiConfigs).set({ isDefault: 0 })
			.where(and(eq(aiConfigs.userId, userId), eq(aiConfigs.scope, 'user'), eq(aiConfigs.modelType, target.modelType)));
		const result = await db.update(aiConfigs).set({ isDefault: 1 })
			.where(and(eq(aiConfigs.id, id), eq(aiConfigs.userId, userId)))
			.returning();
		return result[0] || null;
	}
	async getOrCreateDefaultConfig(userId: string): Promise<AiConfig> {
		let config = await this.getDefaultConfig(userId);
		if (!config) {
			const configs = await this.getConfigsByUserId(userId);
			if (configs.length > 0) {
				config = configs[0];
			} else {
				const systemConfigs = await this.getSystemConfigs();
				if (systemConfigs.length > 0) {
					config = systemConfigs[0];
				} else {
					config = await this.createConfig({
						userId,
						name: "DeepSeek",
						provider: "deepseek",
						apiUrl: "https://api.deepseek.com/v1",
						apiKey: "",
						model: "deepseek-v4-flash",
						temperature: 0.7,
						maxTokens: 4000,
						scope: 'user',
						isDefault: 1,
					});
				}
			}
		}
		return config;
	}
}

export const aiConfigManager = new AiConfigManager();
