import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { userManager, memberLevelManager } from "@/storage/database";
import {
	generateTokenPair,
	comparePassword,
	JWTPayload,
} from "@/lib/auth";

const loginSchema = z.object({
	email: z.string().email(),
	password: z.string(),
});

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const validated = loginSchema.parse(body);

		// 查找用户
		const user = await userManager.getUserByEmail(validated.email);
		if (!user) {
			return NextResponse.json(
				{ error: "邮箱或密码错误" },
				{ status: 401 }
			);
		}

		// 检查用户是否激活
		if (!user.isActive) {
			return NextResponse.json(
				{ error: "账户已被禁用" },
				{ status: 403 }
			);
		}

		// 验证密码
		const isValid = await comparePassword(validated.password, user.passwordHash);
		if (!isValid) {
			return NextResponse.json(
				{ error: "邮箱或密码错误" },
				{ status: 401 }
			);
		}

		// 检查会员状态
		const membership = await userManager.checkMembership(user.id);

		// 获取会员等级信息
		let memberLevelName = "免费用户";
		if (membership.levelId) {
			const level = await memberLevelManager.getById(membership.levelId);
			if (level) {
				memberLevelName = level.name;
			}
		}

		// 生成Token
		const payload: JWTPayload = {
			userId: user.id,
			email: user.email,
			username: user.username,
			role: user.role || 'user',
		};
		const tokens = generateTokenPair(payload);

		return NextResponse.json({
			success: true,
			message: "登录成功",
			data: {
				user: {
					id: user.id,
					username: user.username,
					email: user.email,
					nickname: user.nickname,
					avatar: user.avatar,
					role: user.role || 'user',
					memberStatus: membership.isValid ? "active" : "expired",
					memberLevel: memberLevelName,
					memberExpireAt: membership.expireAt,
				},
				...tokens,
			},
		});
	} catch (error) {
		console.error("Login error:", error);
		if (error instanceof z.ZodError) {
			return NextResponse.json(
				{ error: "参数错误", details: error.issues },
				{ status: 400 }
			);
		}
		return NextResponse.json(
			{ error: "登录失败" },
			{ status: 500 }
		);
	}
}
