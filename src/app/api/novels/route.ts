import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { novelManager, userManager, memberLevelManager, scriptManager, shortDramaManager, projectManager } from "@/storage/database";
import type { InsertNovel } from "@/storage/database/shared/schema";
import { getUserFromToken } from "@/lib/auth";
import { syncNovelDetails } from "@/lib/novel-detail-sync";
import { autoCreateProjectForNovel } from "@/lib/auto-drama";

/**
 * 获取当前用户的小说列表
 */
export async function GET(request: NextRequest) {
	try {
		const authHeader = request.headers.get("authorization");
		const payload = getUserFromToken(authHeader);

		if (!payload) {
			return NextResponse.json(
				{ error: "请先登录" },
				{ status: 401 }
			);
		}

		const { searchParams } = new URL(request.url);
		const status = searchParams.get("status") || undefined;
		const limit = parseInt(searchParams.get("limit") || "50");
		const offset = parseInt(searchParams.get("offset") || "0");

		const result = await novelManager.getUserNovels(payload.userId, {
			status,
			limit,
			offset,
		});

		// 附带每部小说的剧本/短剧/项目关联状态
		const novelsWithLinks = await Promise.all(result.novels.map(async (novel) => {
			let scriptId: string | null = null;
			let dramaId: string | null = null;
			let projectId: number | null = null;
			try {
				const script = await scriptManager.getScriptByNovelId(novel.id, payload.userId);
				if (script) scriptId = script.id;
				const dramas = await shortDramaManager.getDramasByNovelId(novel.id);
				if (dramas.length > 0) dramaId = dramas[0].id;
				const project = await projectManager.getByNovelId(novel.id);
				if (project) projectId = project.id;
			} catch {}
			return {
				id: novel.id,
				title: novel.title,
				description: novel.description,
				category: novel.category,
				genderTarget: novel.genderTarget,
				narrativePerspective: novel.narrativePerspective,
				tone: novel.tone,
				protagonist: novel.protagonist,
				supportingCharacterName: novel.supportingCharacterName,
				totalChapters: novel.totalChapters,
				currentChapters: novel.currentChapters,
				isPublic: Number(novel.isPublic) !== 0,
				status: novel.status,
				coverImage: novel.coverImage ?? null,
				createdAt: novel.createdAt,
				updatedAt: novel.updatedAt,
				scriptId,
				dramaId,
				projectId,
			};
		}));

		return NextResponse.json({
			success: true,
			data: {
				novels: novelsWithLinks,
				total: result.total,
				limit,
				offset,
			},
		});
	} catch (error) {
		console.error("Get user novels error:", error);
		return NextResponse.json(
			{ error: "获取小说列表失败" },
			{ status: 500 }
		);
	}
}

/**
 * 创建新小说（幂等：同用户+同标题+草稿态会自动合并，避免重复新建）
 */
const createNovelSchema = z.object({
	title: z.string().min(1).max(255),
	description: z.string().optional(),
	category: z.string().optional(),
	genderTarget: z.string().optional(),
	narrativePerspective: z.string().optional(),
	tone: z.array(z.string()).optional(),
	protagonist: z.string().optional(),
	supportingCharacterName: z.string().optional(),
	totalChapters: z.number().min(1).max(100).optional(),
	currentChapters: z.number().optional(),
	status: z.string().optional(),
	idea: z.any().optional(),
	structure: z.any().optional(),
	chapters: z.any().optional(),
	dedupe: z.boolean().optional(), // 传false强制新建不合并，默认true
});

export async function POST(request: NextRequest) {
	try {
		const authHeader = request.headers.get("authorization");
		const payload = getUserFromToken(authHeader);

		if (!payload) {
			return NextResponse.json(
				{ error: "请先登录" },
				{ status: 401 }
			);
		}

		const body = await request.json();
		const validated = createNovelSchema.parse(body);
		const dedupe = validated.dedupe !== false;

		// === 1. 幂等保存：同用户+同标题+草稿态 自动合并（先于存储上限检查——合并后数量可能减少） ===
		const result = await novelManager.createOrUpdateDraft(
			payload.userId,
			validated.title,
			{
				description: validated.description || null,
				category: validated.category || null,
				genderTarget: validated.genderTarget || null,
				narrativePerspective: validated.narrativePerspective || null,
				tone: validated.tone ? JSON.stringify(validated.tone) : null,
				protagonist: validated.protagonist || null,
				supportingCharacterName: validated.supportingCharacterName || null,
				totalChapters: validated.totalChapters || 10,
				currentChapters: validated.currentChapters || 0,
				status: validated.status || "draft",
				idea: validated.idea ? JSON.stringify(validated.idea) : null,
				structure: validated.structure ? JSON.stringify(validated.structure) : null,
				chapters: validated.chapters ? JSON.stringify(validated.chapters) : null,
			} as Partial<InsertNovel>,
			{ dedupe }
		);
		const novel = result.novel;

		// === 2. 检查会员可创建的小说数量（合并后再判断，避免用户因重复堆积达上限而无法保存） ===
		const membership = await userManager.checkMembership(payload.userId);
		let storageLimit = 50; // 默认免费用户限制

		if (payload.role === 'admin') {
			storageLimit = -1;
		} else if (membership.isValid && membership.levelId) {
			const level = await memberLevelManager.getById(membership.levelId);
			if (level?.features) {
				const features = typeof level.features === 'string'
					? JSON.parse(level.features)
					: level.features;
				storageLimit = features.storageLimit || 50;
			}
		}

		const currentCount = await novelManager.getUserNovelCount(payload.userId);
		if (result.action === 'created' && currentCount > storageLimit && storageLimit !== -1) {
			// 新建才检查上限；更新不影响（已占用过槽位）
			return NextResponse.json(
				{
					error: `存储空间已达上限（${storageLimit}部）`,
					code: "STORAGE_LIMIT",
				},
				{ status: 403 }
			);
		}

		// 异步同步到子表（不阻塞响应）
		syncNovelDetails(novel.id, payload.userId, body).catch((e: unknown) =>
			console.warn('[Novels POST] Detail sync failed:', e)
		);

		// 异步自动创建关联剧本项目 + 短剧
		autoCreateProjectForNovel({ ...novel, userId: payload.userId }).catch((e: unknown) =>
			console.warn('[Novels POST] Auto project creation failed:', e)
		);

		const message = result.action === 'updated'
			? (result.mergedCount > 0
				? `小说更新成功（已合并${result.mergedCount}个重复草稿）`
				: '小说更新成功')
			: '小说创建成功';

		return NextResponse.json({
			success: true,
			message,
			action: result.action,
			dedupeStats: {
				mergedCount: result.mergedCount,
				deletedIds: result.deletedIds,
				foundDuplicateGroup: result.foundDuplicateGroup,
			},
			data: {
				id: novel.id,
				title: novel.title,
				description: novel.description,
				category: novel.category,
				genderTarget: novel.genderTarget,
				narrativePerspective: novel.narrativePerspective,
				tone: novel.tone,
				protagonist: novel.protagonist,
				supportingCharacterName: novel.supportingCharacterName,
				totalChapters: novel.totalChapters,
				currentChapters: novel.currentChapters,
				status: novel.status,
				createdAt: novel.createdAt,
			},
		});
	} catch (error) {
		console.error("Create novel error:", error);
		if (error instanceof z.ZodError) {
			return NextResponse.json(
				{ error: "参数错误", details: error.issues },
				{ status: 400 }
			);
		}
		return NextResponse.json(
			{ error: "创建小说失败" },
			{ status: 500 }
		);
	}
}
