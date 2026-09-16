import { eq, and, asc, desc, SQL } from "drizzle-orm";
import { getDb } from "./sqlite";
import {
	memberLevels,
	insertMemberLevelSchema,
	updateMemberLevelSchema,
	type MemberLevel,
	type InsertMemberLevel,
	type UpdateMemberLevel,
} from "./shared/schema";

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export class MemberLevelManager {
	async create(data: InsertMemberLevel): Promise<MemberLevel> {
		const db = await getDb();
		const validated = insertMemberLevelSchema.parse(data);
		const [level] = await db.insert(memberLevels).values({
			...validated,
			id: generateUUID()
		}).returning();
		return level;
	}

	async getById(id: string): Promise<MemberLevel | null> {
		const db = await getDb();
		const result = await db.select().from(memberLevels).where(eq(memberLevels.id, id)).limit(1);
		return result[0] || null;
	}

	async getByCode(code: string): Promise<MemberLevel | null> {
		const db = await getDb();
		const result = await db.select().from(memberLevels).where(eq(memberLevels.code, code)).limit(1);
		return result[0] || null;
	}

	async getAllEnabled(): Promise<MemberLevel[]> {
		const db = await getDb();
		const levels = await db
			.select()
			.from(memberLevels)
			.where(eq(memberLevels.isActive, 1))
			.orderBy(asc(memberLevels.sortOrder));
		return levels;
	}

	async getAll(): Promise<MemberLevel[]> {
		const db = await getDb();
		const levels = await db
			.select()
			.from(memberLevels)
			.orderBy(asc(memberLevels.sortOrder));
		return levels;
	}

	async update(id: string, data: UpdateMemberLevel): Promise<MemberLevel | null> {
		const db = await getDb();
		const validated = updateMemberLevelSchema.parse(data);
		const [level] = await db
			.update(memberLevels)
			.set(validated)
			.where(eq(memberLevels.id, id))
			.returning();
		return level || null;
	}

	async delete(id: string): Promise<boolean> {
		const db = await getDb();
		const result = await db
			.update(memberLevels)
			.set({ isActive: 0 })
			.where(eq(memberLevels.id, id))
			.returning();
		return result.length > 0;
	}
}

export const memberLevelManager = new MemberLevelManager();