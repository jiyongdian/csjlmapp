import { NextRequest, NextResponse } from "next/server";
import { memberOrderManager, memberLevelManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";
import { z } from "zod";

/**
 * 获取订单详情
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

		const level = await memberLevelManager.getById(order.memberLevelId);

		return NextResponse.json({
			success: true,
			data: {
				id: order.id,
				orderNo: order.orderNo,
				amount: order.amount,
				paymentStatus: order.paymentStatus,
				paymentMethod: order.paymentMethod,
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
			},
		});
	} catch (error) {
		console.error("Get order error:", error);
		return NextResponse.json(
			{ error: "获取订单失败" },
			{ status: 500 }
		);
	}
}

const initiatePaymentSchema = z.object({
	paymentMethod: z.enum(["wechat", "alipay", "third_party"]).optional().default("wechat"),
});

/**
 * 发起支付 / 支付回调
 */
export async function POST(
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

		if (order.paymentStatus === "completed") {
			return NextResponse.json({
				success: true,
				message: "订单已完成支付",
				data: { status: "completed" },
			});
		}

		// 解析请求体，兼容两种调用方式
		const contentType = request.headers.get("content-type") || "";
		let paymentMethod = "wechat";
		let autoComplete = true;

		if (contentType.includes("application/json")) {
			try {
				const body = await request.json();
				if (body.paymentMethod) {
					paymentMethod = body.paymentMethod;
				}
				if (body.autoComplete !== undefined) {
					autoComplete = body.autoComplete;
				}
			} catch {
				// 没有JSON body时使用默认值
			}
		}

		// 如果是模拟平台支付回调，或者自动完成支付
		if (autoComplete) {
			const completedOrder = await memberOrderManager.completePayment(
				orderNo,
				`${paymentMethod}_payment`
			);

			if (!completedOrder) {
				return NextResponse.json(
					{ error: "支付失败" },
					{ status: 500 }
				);
			}

			return NextResponse.json({
				success: true,
				message: "支付成功",
				data: {
					status: "completed",
					paymentMethod,
					startTime: completedOrder.startTime,
					endTime: completedOrder.endTime,
				},
			});
		}

		// 发起支付（模拟），返回支付二维码信息
		return NextResponse.json({
			success: true,
			message: "支付已发起",
			data: {
				status: "pending",
				paymentMethod,
				orderNo: order.orderNo,
				amount: order.amount,
				// 模拟二维码信息（演示环境）
				qrCode: `${paymentMethod}_qr_${orderNo}`,
				qrcodeUrl: `/api/member/orders/${orderNo}/qrcode?method=${paymentMethod}`,
				expiresIn: 300,
			},
		});
	} catch (error) {
		console.error("Pay order error:", error);
		return NextResponse.json(
			{ error: "支付失败" },
			{ status: 500 }
		);
	}
}