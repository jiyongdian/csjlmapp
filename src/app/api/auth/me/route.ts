import { NextRequest, NextResponse } from "next/server";
import { userManager, memberLevelManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

export async function GET(request: NextRequest) {
	try {
		const authHeader = request.headers.get("authorization");
		const payload = getUserFromToken(authHeader);

		if (!payload) {
			return NextResponse.json(
				{ error: "未登录或Token已过期" },
				{ status: 401 }
			);
		}

		const user = await userManager.getUserById(payload.userId);
		if (!user) {
			return NextResponse.json(
				{ error: "用户不存在" },
				{ status: 404 }
			);
		}

		// 检查会员状态
		const membership = await userManager.checkMembership(user.id);

		// 获取会员等级信息
		let memberLevelName = "免费用户";
		let memberFeatures = null;
		if (membership.levelId) {
			const level = await memberLevelManager.getById(membership.levelId);
			if (level) {
				memberLevelName = level.name;
				memberFeatures = level.features;
			}
		}

		return NextResponse.json({
			success: true,
			data: {
				id: user.id,
				username: user.username,
				email: user.email,
				nickname: user.nickname,
				avatar: user.avatar,
				role: user.role || 'user',
				memberStatus: membership.isValid ? "active" : "expired",
				memberLevel: memberLevelName,
				memberExpireAt: membership.expireAt,
				memberFeatures,
				createdAt: user.createdAt,
			},
		});
	} catch (error) {
		console.error("Get user error:", error);
		return NextResponse.json(
			{ error: "获取用户信息失败" },
			{ status: 500 }
		);
	}
}
