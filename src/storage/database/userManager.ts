import { eq, and, asc, desc, sql } from "drizzle-orm";
import { getDb } from "./sqlite";
import {
	users,
	insertUserSchema,
	updateUserSchema,
	type User,
	type InsertUser,
	type UpdateUser,
} from "./shared/schema";

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export class UserManager {
	async checkMembership(userId: string): Promise<{
		isValid: boolean;
		levelId: string | null;
		expireAt: Date | null;
	}> {
		const db = await getDb();
		const result = await db
			.select({
				memberLevelId: users.memberLevelId,
				memberExpireAt: users.memberExpireAt,
				memberStatus: users.memberStatus,
			})
			.from(users)
			.where(eq(users.id, userId))
			.limit(1);

		if (!result[0] || !result[0].memberLevelId) {
			return { isValid: false, levelId: null, expireAt: null };
		}

		const now = new Date();
		const expireAt = result[0].memberExpireAt ? new Date(result[0].memberExpireAt) : null;
		const isExpired = expireAt ? expireAt < now : true;
		const isActive = result[0].memberStatus === "active";

		return {
			isValid: !isExpired && isActive,
			levelId: result[0].memberLevelId,
			expireAt: expireAt,
		};
	}

	async updateMemberStatus(
		userId: string,
		levelId: string,
		expireAt: Date,
		status: string
	): Promise<User | null> {
		const db = await getDb();
		const [user] = await db
			.update(users)
			.set({
				memberLevelId: levelId,
				memberExpireAt: expireAt.toISOString(),
				memberStatus: status,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(users.id, userId))
			.returning();
		return user || null;
	}

	async getAllUsers(): Promise<User[]> {
		const db = await getDb();
		const result = await db.select().from(users).orderBy(desc(users.createdAt));
		return result;
	}

	async createUser(data: InsertUser): Promise<User> {
		const db = await getDb();
		const validated = insertUserSchema.parse(data);
		const [user] = await db.insert(users).values({
			...validated,
			id: generateUUID()
		} as any).returning();
		return user;
	}

	async getUserById(id: string): Promise<User | null> {
		const db = await getDb();
		const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
		return result[0] || null;
	}

	async getUserByEmail(email: string): Promise<User | null> {
		const db = await getDb();
		const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
		return result[0] || null;
	}

	async getUserByUsername(username: string): Promise<User | null> {
		const db = await getDb();
		const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
		return result[0] || null;
	}

	async updateUser(id: string, data: UpdateUser): Promise<User | null> {
		const db = await getDb();
		const validated = updateUserSchema.parse(data);
		const [user] = await db
			.update(users)
			.set({ ...validated, updatedAt: new Date().toISOString() })
			.where(eq(users.id, id))
			.returning();
		return user || null;
	}

	async updateProfile(
		id: string,
		data: { username?: string; nickname?: string | null; email?: string }
	): Promise<User | null> {
		const db = await getDb();
		const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
		if (data.username !== undefined) patch.username = data.username;
		if (data.nickname !== undefined) patch.nickname = data.nickname;
		if (data.email !== undefined) patch.email = data.email;
		const [user] = await db
			.update(users)
			.set(patch as any)
			.where(eq(users.id, id))
			.returning();
		return user || null;
	}

	async updatePassword(id: string, passwordHash: string): Promise<boolean> {
		const db = await getDb();
		const result = await db
			.update(users)
			.set({ passwordHash, updatedAt: new Date().toISOString() })
			.where(eq(users.id, id))
			.returning();
		return result.length > 0;
	}

	async updateMemberInfo(
		id: string,
		memberLevelId: string,
		memberExpireAt: Date | null,
		memberStatus: string
	): Promise<User | null> {
		const db = await getDb();
		const [user] = await db
			.update(users)
			.set({
				memberLevelId,
				memberExpireAt: memberExpireAt ? memberExpireAt.toISOString() : null,
				memberStatus,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(users.id, id))
			.returning();
		return user || null;
	}

	async deleteUser(id: string): Promise<boolean> {
		const db = await getDb();
		const result = await db.delete(users).where(eq(users.id, id)).returning();
		return result.length > 0;
	}
}

export const userManager = new UserManager();