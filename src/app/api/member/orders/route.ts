import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
	memberLevelManager,
	memberOrderManager,
	userManager,
} from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

const createOrderSchema = z.object({
	levelId: z.string(),
	paymentMethod: z.enum(["wechat", "alipay", "third_party"]).optional().default("wechat"),
});

export async function POST(request: NextRequest) {
	try {
		const authHeader = request.headers.get("authorization");
		const payload = getUserFromToken(authHeader);

		if (!payload) {
			return NextResponse.json(
				{ error: "请先登录" },
				{ status: 401 }
			);
		}

		const body = await request.json();
		const validated = createOrderSchema.parse(body);

		// 获取会员等级
		const level = await memberLevelManager.getById(validated.levelId);
		if (!level || !level.isActive) {
			return NextResponse.json(
				{ error: "会员等级不存在" },
				{ status: 404 }
			);
		}

		// 免费等级直接激活
		if (level.code === "free") {
			return NextResponse.json({
				success: true,
				message: "您已是免费用户",
				data: {
					level: {
						id: level.id,
						code: level.code,
						name: level.name,
					},
				},
			});
		}

		// 生成订单
		const orderNo = memberOrderManager.generateOrderNo();
		const order = await memberOrderManager.create({
			userId: payload.userId,
			memberLevelId: level.id,
			orderNo,
			amount: level.price,
			paymentMethod: validated.paymentMethod,
		} as any);

		return NextResponse.json({
			success: true,
			data: {
				orderId: order.id,
				orderNo: order.orderNo,
				amount: order.amount,
				level: {
					id: level.id,
					code: level.code,
					name: level.name,
					duration: level.duration,
				},
			},
		});
	} catch (error) {
		console.error("Create order error:", error);
		if (error instanceof z.ZodError) {
			return NextResponse.json(
				{ error: "参数错误" },
				{ status: 400 }
			);
		}
		return NextResponse.json(
			{ error: "创建订单失败" },
			{ status: 500 }
		);
	}
}

/**
 * 获取用户订单列表
 */
export async function GET(request: NextRequest) {
	try {
		const authHeader = request.headers.get("authorization");
		const payload = getUserFromToken(authHeader);

		if (!payload) {
			return NextResponse.json(
				{ error: "请先登录" },
				{ status: 401 }
			);
		}

		const orders = await memberOrderManager.getUserOrders(payload.userId);

		// 获取对应的等级信息
		const levelIds = [...new Set(orders.map((o) => o.memberLevelId))];
		const levels = await Promise.all(
			levelIds.map((id) => memberLevelManager.getById(id))
		);
		const levelMap = new Map(levels.filter(Boolean).map((l) => [l!.id, l!]));

		return NextResponse.json({
			success: true,
			data: orders.map((order) => {
				const level = levelMap.get(order.memberLevelId);
				return {
					id: order.id,
					orderNo: order.orderNo,
					amount: order.amount,
					paymentStatus: order.paymentStatus,
					paymentTime: order.paymentTime,
					startTime: order.startTime,
					endTime: order.endTime,
					createdAt: order.createdAt,
					level: level
						? {
								id: level.id,
								code: level.code,
								name: level.name,
								duration: level.duration,
							}
						: null,
				};
			}),
		});
	} catch (error) {
		console.error("Get orders error:", error);
		return NextResponse.json(
			{ error: "获取订单失败" },
			{ status: 500 }
		);
	}
}
