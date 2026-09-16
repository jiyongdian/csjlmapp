import { NextRequest, NextResponse } from "next/server";
import { projectManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

/**
 * GET /api/project/list - 获取当前用户的项目列表
 */
export async function GET(request: NextRequest) {
	try {
		const authHeader = request.headers.get("authorization");
		const payload = getUserFromToken(authHeader);

		if (!payload) {
			return NextResponse.json(
				{ success: false, error: "请先登录" },
				{ status: 401 }
			);
		}

		const { searchParams } = new URL(request.url);
		const keyword = searchParams.get("keyword");

		let projects;
		if (keyword) {
			projects = await projectManager.searchByName(payload.userId, keyword);
		} else {
			projects = await projectManager.listByOwner(payload.userId);
		}

		return NextResponse.json({
			success: true,
			data: projects,
		});
	} catch (error) {
		console.error("List projects error:", error);
		return NextResponse.json(
			{ success: false, error: "获取项目列表失败" },
			{ status: 500 }
		);
	}
}
