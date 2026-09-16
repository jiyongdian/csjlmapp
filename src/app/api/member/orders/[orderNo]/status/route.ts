import { NextRequest, NextResponse } from "next/server";
import { memberOrderManager, memberLevelManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

/**
 * 查询订单支付状态（用于前端轮询）
 */
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ orderNo: string }> }
) {
	try {
		const authHeader = request.headers.get("authorization");
		const payload = getUserFromToken(authHeader);

		if (!payload) {
			return NextResponse.json(
				{ error: "请先登录" },
				{ status: 401 }
			);
		}

		const { orderNo } = await params;
		const order = await memberOrderManager.getByOrderNo(orderNo);

		if (!order) {
			return NextResponse.json(
				{ error: "订单不存在" },
				{ status: 404 }
			);
		}

		if (order.userId !== payload.userId) {
			return NextResponse.json(
				{ error: "无权访问该订单" },
				{ status: 403 }
			);
		}

		const level = order.memberLevelId
			? await memberLevelManager.getById(order.memberLevelId)
			: null;

		return NextResponse.json({
			success: true,
			data: {
				orderNo: order.orderNo,
				paymentStatus: order.paymentStatus,
				paymentMethod: order.paymentMethod,
				paymentTime: order.paymentTime,
				amount: order.amount,
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
			},
		});
	} catch (error) {
		console.error("Query payment status error:", error);
		return NextResponse.json(
			{ error: "查询支付状态失败" },
			{ status: 500 }
		);
	}
}

/**
 * 模拟支付回调（第三方支付平台回调）
 */
export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ orderNo: string }> }
) {
	try {
		const { orderNo } = await params;
		const body = await request.json();

		// 验证签名（模拟）
		const paymentMethod = body.paymentMethod || "wechat";
		const tradeNo = body.tradeNo || `T${Date.now()}`;

		const completedOrder = await memberOrderManager.completePayment(
			orderNo,
			tradeNo
		);

		if (!completedOrder) {
			return NextResponse.json(
				{ error: "支付回调处理失败" },
				{ status: 500 }
			);
		}

		return NextResponse.json({
			success: true,
			message: "支付回调处理成功",
			data: {
				orderNo,
				tradeNo,
				paymentMethod,
				status: "completed",
				paymentTime: completedOrder.paymentTime,
				startTime: completedOrder.startTime,
				endTime: completedOrder.endTime,
			},
		});
	} catch (error) {
		console.error("Payment callback error:", error);
		return NextResponse.json(
			{ error: "支付回调处理失败" },
			{ status: 500 }
		);
	}
}