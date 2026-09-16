import { eq, and, desc, like } from "drizzle-orm";
import { getDb } from "./sqlite";
import {
	projects,
	insertProjectSchema,
	updateProjectSchema,
	type Project,
	type InsertProject,
	type UpdateProject,
} from "./shared/schema";

export class ProjectManager {
	/**
	 * 序列化数据，处理 JSON 字段
	 */
	private serializeData(data: Partial<InsertProject | UpdateProject>): any {
		const result: any = { ...data };
		if (result.properties && typeof result.properties !== 'string') {
			result.properties = JSON.stringify(result.properties);
		}
		if (result.updateTime) {
			result.updateTime = result.updateTime instanceof Date
				? result.updateTime.toISOString()
				: result.updateTime;
		}
		return result;
	}

	/**
	 * 反序列化项目数据
	 */
	private deserializeProject(project: Project): Project {
		const result: any = { ...project };
		if (result.properties && typeof result.properties === 'string') {
			try { result.properties = JSON.parse(result.properties); } catch { /* keep as string */ }
		}
		return result;
	}

	/**
	 * 创建项目
	 */
	async create(data: InsertProject): Promise<Project> {
		const db = await getDb();
		const validated = insertProjectSchema.parse(data);
		const serialized = this.serializeData({ ...validated });
		const [project] = await db.insert(projects).values(serialized).returning();
		return this.deserializeProject(project);
	}

	/**
	 * 根据ID获取项目
	 */
	async getById(id: number): Promise<Project | null> {
		const db = await getDb();
		const [project] = await db.select().from(projects).where(eq(projects.id, id));
		return project ? this.deserializeProject(project) : null;
	}

	/**
	 * 根据 ownerId 获取项目列表
	 */
	async listByOwner(ownerId: string): Promise<Project[]> {
		const db = await getDb();
		const result = await db
			.select()
			.from(projects)
			.where(eq(projects.ownerId, ownerId))
			.orderBy(desc(projects.createTime));
		return result.map((p) => this.deserializeProject(p));
	}

	/**
	 * 根据 novelId 查找关联项目（从 properties 中解析）
	 */
	async getByNovelId(novelId: string): Promise<Project | null> {
		const db = await getDb();
		const all = await db.select().from(projects);
		for (const p of all) {
			try {
				const props = typeof p.properties === 'string' ? JSON.parse(p.properties) : p.properties;
				if (props?.novelId === novelId) {
					return this.deserializeProject(p);
				}
			} catch { /* skip */ }
		}
		return null;
	}

	/**
	 * 获取所有项目（管理员用）
	 */
	async listAll(): Promise<Project[]> {
		const db = await getDb();
		const result = await db.select().from(projects).orderBy(desc(projects.createTime));
		return result.map((p) => this.deserializeProject(p));
	}

	/**
	 * 更新项目
	 */
	async update(id: number, data: Partial<UpdateProject>): Promise<Project | null> {
		const db = await getDb();
		const validated = updateProjectSchema.parse(data);
		const serialized = this.serializeData({
			...validated,
			updateTime: new Date().toISOString(),
		});
		const [project] = await db
			.update(projects)
			.set(serialized)
			.where(eq(projects.id, id))
			.returning();
		return project ? this.deserializeProject(project) : null;
	}

	/**
	 * 删除项目
	 */
	async delete(id: number): Promise<boolean> {
		const db = await getDb();
		const result = await db.delete(projects).where(eq(projects.id, id));
		return result.changes > 0;
	}

	/**
	 * 根据名称搜索项目
	 */
	async searchByName(ownerId: string, keyword: string): Promise<Project[]> {
		const db = await getDb();
		const result = await db
			.select()
			.from(projects)
			.where(and(
				eq(projects.ownerId, ownerId),
				like(projects.name, `%${keyword}%`)
			))
			.orderBy(desc(projects.createTime));
		return result.map((p) => this.deserializeProject(p));
	}
}

export const projectManager = new ProjectManager();
