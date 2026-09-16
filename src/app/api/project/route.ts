import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { projectManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

/**
 * POST /api/project - 创建项目
 */
const createProjectSchema = z.object({
	name: z.string().min(1).max(255),
	description: z.string().optional(),
	coverUrl: z.string().optional(),
	scope: z.number().optional(),
	ownerType: z.number().optional(),
	ownerId: z.string().optional(),
	status: z.number().optional(),
	properties: z.string().optional(),
	artStyle: z.string().optional(),
	artStyleDescription: z.string().optional(),
	artStyleImagePrompt: z.string().optional(),
	artStyleImageUrl: z.string().optional(),
});

export async function POST(request: NextRequest) {
	try {
		const authHeader = request.headers.get("authorization");
		const payload = getUserFromToken(authHeader);

		if (!payload) {
			return NextResponse.json(
				{ success: false, error: "请先登录" },
				{ status: 401 }
			);
		}

		const body = await request.json();
		const validated = createProjectSchema.parse(body);

		// 如果没有指定 ownerId，则使用当前用户 ID
		const ownerId = validated.ownerId || payload.userId;

		const project = await projectManager.create({
			name: validated.name,
			description: validated.description || "",
			coverUrl: validated.coverUrl || null,
			scope: validated.scope ?? 0,
			ownerType: validated.ownerType ?? 0,
			ownerId,
			status: validated.status ?? 0,
			properties: validated.properties || null,
			artStyle: validated.artStyle || null,
			artStyleDescription: validated.artStyleDescription || null,
			artStyleImagePrompt: validated.artStyleImagePrompt || null,
			artStyleImageUrl: validated.artStyleImageUrl || null,
		});

		return NextResponse.json({
			success: true,
			data: project,
		});
	} catch (error) {
		console.error("Create project error:", error);
		if (error instanceof z.ZodError) {
			return NextResponse.json(
				{ success: false, error: "参数错误", details: error.issues },
				{ status: 400 }
			);
		}
		return NextResponse.json(
			{ success: false, error: "创建项目失败" },
			{ status: 500 }
		);
	}
}

/**
 * PUT /api/project - 更新项目
 */
const updateProjectSchema = z.object({
	id: z.number(),
	name: z.string().optional(),
	description: z.string().optional(),
	coverUrl: z.string().optional(),
	scope: z.number().optional(),
	ownerType: z.number().optional(),
	ownerId: z.string().optional(),
	status: z.number().optional(),
	properties: z.string().optional(),
	artStyle: z.string().optional(),
	artStyleDescription: z.string().optional(),
	artStyleImagePrompt: z.string().optional(),
	artStyleImageUrl: z.string().optional(),
});

export async function PUT(request: NextRequest) {
	try {
		const authHeader = request.headers.get("authorization");
		const payload = getUserFromToken(authHeader);

		if (!payload) {
			return NextResponse.json(
				{ success: false, error: "请先登录" },
				{ status: 401 }
			);
		}

		const body = await request.json();
		const validated = updateProjectSchema.parse(body);

		// 检查项目是否存在
		const existing = await projectManager.getById(validated.id);
		if (!existing) {
			return NextResponse.json(
				{ success: false, error: "项目不存在" },
				{ status: 404 }
			);
		}

		// 权限检查：普通用户只能操作自己的项目
		if (payload.role !== 'admin' && existing.ownerId !== payload.userId) {
			return NextResponse.json(
				{ success: false, error: "无权操作此项目" },
				{ status: 403 }
			);
		}

		const { id, ...data } = validated;
		const project = await projectManager.update(id, data);

		return NextResponse.json({
			success: true,
			data: project,
		});
	} catch (error) {
		console.error("Update project error:", error);
		if (error instanceof z.ZodError) {
			return NextResponse.json(
				{ success: false, error: "参数错误", details: error.issues },
				{ status: 400 }
			);
		}
		return NextResponse.json(
			{ success: false, error: "更新项目失败" },
			{ status: 500 }
		);
	}
}
