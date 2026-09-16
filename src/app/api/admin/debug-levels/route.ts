import { NextResponse } from "next/server";
import { getDb } from "@/storage/database/sqlite";
import { memberLevels } from "@/storage/database/shared/schema";
import { getUserFromToken } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
	try {
		const authHeader = request.headers.get('authorization');
		const payload = getUserFromToken(authHeader);
		if (!payload || payload.role !== "admin") {
			return NextResponse.json({ error: "未授权" }, { status: 401 });
		}

		const db = await getDb();
		const allLevels = await db.select().from(memberLevels);

		console.log("当前会员等级数据:", allLevels);

		return NextResponse.json({
			success: true,
			data: allLevels,
		});
	} catch (error) {
		console.error("获取会员等级数据失败:", error);
		return NextResponse.json({
			error: "获取失败",
			details: error instanceof Error ? error.message : String(error)
		}, { status: 500 });
	}
}

export async function POST(request: Request) {
	try {
		const authHeader = request.headers.get('authorization');
		const payload = getUserFromToken(authHeader);
		if (!payload || payload.role !== "admin") {
			return NextResponse.json({ error: "未授权" }, { status: 401 });
		}

		const body = await request.json();
		const { code, duration } = body;

		if (!code || duration === undefined) {
			return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
		}

		const db = await getDb();
		const result = await db
			.update(memberLevels)
			.set({ duration })
			.where(eq(memberLevels.code, code))
			.returning();

		console.log(`更新会员等级 ${code} 的 duration 为 ${duration} 天, 结果:`, result);

		return NextResponse.json({
			success: true,
			message: `会员等级 ${code} 的 duration 已更新为 ${duration} 天`,
			data: result,
		});
	} catch (error) {
		console.error("更新会员等级数据失败:", error);
		return NextResponse.json({
			error: "更新失败",
			details: error instanceof Error ? error.message : String(error)
		}, { status: 500 });
	}
}
