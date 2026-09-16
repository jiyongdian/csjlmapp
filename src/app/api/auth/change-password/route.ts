import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { userManager } from "@/storage/database";
import { getUserFromToken, hashPassword, comparePassword } from "@/lib/auth";

const passwordSchema = z.object({
	oldPassword: z.string().min(1),
	newPassword: z.string().min(6).max(100),
});

export async function PUT(request: NextRequest) {
	try {
		const payload = getUserFromToken(request.headers.get("authorization"));
		if (!payload) {
			return NextResponse.json({ error: "未登录或Token已过期" }, { status: 401 });
		}

		const body = await request.json();
		const validated = passwordSchema.parse(body);

		const user = await userManager.getUserById(payload.userId);
		if (!user) {
			return NextResponse.json({ error: "用户不存在" }, { status: 404 });
		}

		const isValid = await comparePassword(validated.oldPassword, user.passwordHash);
		if (!isValid) {
			return NextResponse.json({ error: "当前密码不正确" }, { status: 400 });
		}

		const passwordHash = await hashPassword(validated.newPassword);
		await userManager.updatePassword(payload.userId, passwordHash);

		return NextResponse.json({ success: true, message: "密码修改成功", data: true });
	} catch (error) {
		if (error instanceof z.ZodError) {
			return NextResponse.json({ error: "参数错误", details: error.issues }, { status: 400 });
		}
		console.error("Change password error:", error);
		return NextResponse.json({ error: "修改密码失败" }, { status: 500 });
	}
}
