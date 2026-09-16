import { NextRequest, NextResponse } from "next/server";
import { memberOrderManager, userManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";
import { getDb } from "@/storage/database/sqlite";
import { memberOrders, users, memberLevels } from "@/storage/database/shared/schema";
import { eq } from "drizzle-orm";

const updateOrderSchema = {
	status: ["pending", "paid", "cancelled"],
	paymentStatus: ["pending", "paid", "refunded"],
};

// PUT /api/admin/orders/[id] - 更新订单状态
export async function PUT(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const authHeader = request.headers.get("authorization");
		const payload = getUserFromToken(authHeader);

		if (!payload || payload.role !== "admin") {
			return NextResponse.json({ error: "未授权" }, { status: 401 });
		}

		const { id } = await params;
		const body = await request.json();

		// 获取订单
		const order = await memberOrderManager.getById(id);
		if (!order) {
			return NextResponse.json({ error: "订单不存在" }, { status: 404 });
		}

		const updateData: any = { ...body };

		// 如果是支付操作，需要更新用户会员状态
		if (body.paymentStatus === "paid" && order.paymentStatus !== "paid") {
			updateData.paymentTime = new Date();

			// 更新用户会员状态
			const level = await memberOrderManager.getLevelById(order.memberLevelId);
			if (level) {
				const now = new Date();
				const endTime = new Date(now.getTime() + level.duration * 24 * 60 * 60 * 1000);

				const dbInstance = await getDb();
				await (dbInstance as any).update(users)
					.set({
						memberLevelId: level.id,
						memberStatus: "active",
						memberExpireAt: endTime,
						updatedAt: now,
					})
					.where(eq(users.id, order.userId));

				updateData.startTime = now;
				updateData.endTime = endTime;
			}
		}

		// 更新订单
		const dbInstance = await getDb();
		await (dbInstance as any).update(memberOrders)
				.set(updateData)
				.where(eq(memberOrders.id, id));

		return NextResponse.json({
			success: true,
			message: "订单更新成功",
		});
	} catch (error) {
		console.error("Update order error:", error);
		return NextResponse.json({ error: "更新订单失败" }, { status: 500 });
	}
}

// GET /api/admin/orders/[id] - 获取订单详情
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const authHeader = request.headers.get("authorization");
		const payload = getUserFromToken(authHeader);

		if (!payload || payload.role !== "admin") {
			return NextResponse.json({ error: "未授权" }, { status: 401 });
		}

		const { id } = await params;
		const order = await memberOrderManager.getById(id);

		if (!order) {
			return NextResponse.json({ error: "订单不存在" }, { status: 404 });
		}

		return NextResponse.json({
			success: true,
			data: order,
		});
	} catch (error) {
		console.error("Get order error:", error);
		return NextResponse.json({ error: "获取订单详情失败" }, { status: 500 });
	}
}
