import { NextResponse } from "next/server";
import { getDb } from "@/storage/database/sqlite";
import { memberLevels } from "@/storage/database/shared/schema";
import { eq } from "drizzle-orm";
import { getUserFromToken } from "@/lib/auth";

export async function POST(request: Request) {
	try {
		const authHeader = request.headers.get('authorization');
		const payload = getUserFromToken(authHeader);
		if (!payload || payload.role !== "admin") {
			return NextResponse.json({ error: "未授权" }, { status: 401 });
		}

		console.log("开始修复SVIP会员等级的duration...");

		const db = await getDb();
		
		// 更新SVIP会员等级的duration为365天
		const result = await db
			.update(memberLevels)
			.set({ duration: 365 })
			.where(eq(memberLevels.code, "svip"))
			.returning();

		console.log("更新完成，结果:", result);

		return NextResponse.json({
			success: true,
			message: "SVIP会员等级duration已更新为365天",
			data: result,
		});
	} catch (error) {
		console.error("修复SVIP duration失败:", error);
		return NextResponse.json({
			error: "修复失败",
			details: error instanceof Error ? error.message : String(error)
		}, { status: 500 });
	}
}
