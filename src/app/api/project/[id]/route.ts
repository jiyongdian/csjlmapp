import { NextRequest, NextResponse } from "next/server";
import { projectManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

/**
 * GET /api/project/[id] - 获取项目详情
 */
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const authHeader = request.headers.get("authorization");
		const payload = getUserFromToken(authHeader);

		if (!payload) {
			return NextResponse.json(
				{ success: false, error: "请先登录" },
				{ status: 401 }
			);
		}

		const { id } = await params;
		const projectId = parseInt(id);

		if (isNaN(projectId)) {
			return NextResponse.json(
				{ success: false, error: "无效的项目ID" },
				{ status: 400 }
			);
		}

		const project = await projectManager.getById(projectId);

		if (!project) {
			return NextResponse.json(
				{ success: false, error: "项目不存在" },
				{ status: 404 }
			);
		}

		// 权限检查
		if (payload.role !== 'admin' && project.ownerId !== payload.userId) {
			return NextResponse.json(
				{ success: false, error: "无权访问此项目" },
				{ status: 403 }
			);
		}

		return NextResponse.json({
			success: true,
			data: project,
		});
	} catch (error) {
		console.error("Get project error:", error);
		return NextResponse.json(
			{ success: false, error: "获取项目详情失败" },
			{ status: 500 }
		);
	}
}

/**
 * DELETE /api/project/[id] - 删除项目
 */
export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const authHeader = request.headers.get("authorization");
		const payload = getUserFromToken(authHeader);

		if (!payload) {
			return NextResponse.json(
				{ success: false, error: "请先登录" },
				{ status: 401 }
			);
		}

		const { id } = await params;
		const projectId = parseInt(id);

		if (isNaN(projectId)) {
			return NextResponse.json(
				{ success: false, error: "无效的项目ID" },
				{ status: 400 }
			);
		}

		const project = await projectManager.getById(projectId);

		if (!project) {
			return NextResponse.json(
				{ success: false, error: "项目不存在" },
				{ status: 404 }
			);
		}

		// 权限检查
		if (payload.role !== 'admin' && project.ownerId !== payload.userId) {
			return NextResponse.json(
				{ success: false, error: "无权删除此项目" },
				{ status: 403 }
			);
		}

		const deleted = await projectManager.delete(projectId);

		return NextResponse.json({
			success: deleted,
			message: deleted ? "项目已删除" : "删除失败",
		});
	} catch (error) {
		console.error("Delete project error:", error);
		return NextResponse.json(
			{ success: false, error: "删除项目失败" },
			{ status: 500 }
		);
	}
}
