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

		console.log("开始修复所有会员等级的数据...");

		const db = await getDb();
		const results: any[] = [];

		// 更新免费会员
		const freeResult = await db
			.update(memberLevels)
			.set({ 
				name: "免费用户", 
				duration: 0
			})
			.where(eq(memberLevels.code, "free"))
			.returning();
		results.push({ code: "free", result: freeResult });

		const vipResult = await db
			.update(memberLevels)
			.set({ 
				name: "创世纪VIP会员", 
				description: "高级会员",
				duration: 30
			})
			.where(eq(memberLevels.code, "vip"))
			.returning();
		results.push({ code: "vip", result: vipResult });

		const svipResult = await db
			.update(memberLevels)
			.set({ 
				name: "创世纪SVIP会员", 
				description: "超级会员（年卡）",
				duration: 365
			})
			.where(eq(memberLevels.code, "svip"))
			.returning();
		results.push({ code: "svip", result: svipResult });

		console.log("所有会员等级更新完成:", results);

		// 获取更新后的所有等级数据
		const allLevels = await db.select().from(memberLevels);

		return NextResponse.json({
			success: true,
			message: "所有会员等级已修复",
			data: {
				updates: results,
				currentLevels: allLevels,
			},
		});
	} catch (error) {
		console.error("修复会员等级数据失败:", error);
		return NextResponse.json({
			error: "修复失败",
			details: error instanceof Error ? error.message : String(error)
		}, { status: 500 });
	}
}
