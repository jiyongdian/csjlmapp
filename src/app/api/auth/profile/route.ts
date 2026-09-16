import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { userManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

const profileSchema = z.object({
	username: z.string().min(3).max(50).optional(),
	nickname: z.string().max(100).optional(),
	email: z.string().email().optional(),
});

export async function PUT(request: NextRequest) {
	try {
		const payload = getUserFromToken(request.headers.get("authorization"));
		if (!payload) {
			return NextResponse.json({ error: "未登录或Token已过期" }, { status: 401 });
		}

		const body = await request.json();
		const validated = profileSchema.parse(body);

		const data: { username?: string; nickname?: string; email?: string } = {};

		if (validated.username && validated.username !== payload.username) {
			const existing = await userManager.getUserByUsername(validated.username);
			if (existing && existing.id !== payload.userId) {
				return NextResponse.json({ error: "用户名已被使用" }, { status: 400 });
			}
			data.username = validated.username;
		}

		if (validated.email) {
			const existing = await userManager.getUserByEmail(validated.email);
			if (existing && existing.id !== payload.userId) {
				return NextResponse.json({ error: "邮箱已被注册" }, { status: 400 });
			}
			data.email = validated.email;
		}

		if (validated.nickname !== undefined) {
			data.nickname = validated.nickname;
		}

		const user = await userManager.updateProfile(payload.userId, data);
		if (!user) {
			return NextResponse.json({ error: "用户不存在" }, { status: 404 });
		}

		return NextResponse.json({
			success: true,
			message: "保存成功",
			data: {
				id: user.id,
				username: user.username,
				nickname: user.nickname,
				email: user.email,
			},
		});
	} catch (error) {
		if (error instanceof z.ZodError) {
			return NextResponse.json({ error: "参数错误", details: error.issues }, { status: 400 });
		}
		console.error("Update profile error:", error);
		return NextResponse.json({ error: "保存失败" }, { status: 500 });
	}
}
