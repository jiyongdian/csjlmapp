import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "@/lib/auth";

/**
 * 模拟支付二维码（演示环境）
 * 返回一个SVG格式的模拟二维码
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
		const method = request.nextUrl.searchParams.get("method") || "wechat";

		// 生成模拟二维码SVG
		const methodNames: Record<string, string> = {
			wechat: "微信支付",
			alipay: "支付宝",
			third_party: "第三方支付",
		};
		const methodName = methodNames[method] || "支付";

		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="320" viewBox="0 0 300 320">
  <rect width="300" height="320" fill="white" rx="16"/>
  <text x="150" y="45" text-anchor="middle" font-size="18" font-weight="bold" fill="#333">${methodName}</text>
  <text x="150" y="70" text-anchor="middle" font-size="14" fill="#999">请使用${methodName}扫码支付</text>
  <rect x="40" y="90" width="220" height="220" rx="8" fill="#f0f0f0"/>
  <!-- 模拟二维码图案 -->
  <g transform="translate(50,100)" stroke="#333" stroke-width="3">
    <rect x="0" y="0" width="40" height="40" fill="#333"/>
    <rect x="50" y="0" width="40" height="40" fill="#333"/>
    <rect x="100" y="0" width="40" height="40" fill="none"/>
    <rect x="150" y="0" width="40" height="40" fill="#333"/>
    <rect x="0" y="50" width="40" height="40" fill="none"/>
    <rect x="50" y="50" width="40" height="40" fill="#333"/>
    <rect x="100" y="50" width="40" height="40" fill="#333"/>
    <rect x="150" y="50" width="40" height="40" fill="none"/>
    <rect x="0" y="100" width="40" height="40" fill="#333"/>
    <rect x="50" y="100" width="40" height="40" fill="none"/>
    <rect x="100" y="100" width="40" height="40" fill="#333"/>
    <rect x="150" y="100" width="40" height="40" fill="#333"/>
    <rect x="0" y="150" width="40" height="40" fill="none"/>
    <rect x="50" y="150" width="40" height="40" fill="#333"/>
    <rect x="100" y="150" width="40" height="40" fill="none"/>
    <rect x="150" y="150" width="40" height="40" fill="#333"/>
  </g>
  <text x="150" y="290" text-anchor="middle" font-size="14" fill="#666">订单号: ${orderNo.slice(-8)}</text>
</svg>`;

		return new NextResponse(svg, {
			headers: {
				"Content-Type": "image/svg+xml",
				"Cache-Control": "no-cache",
			},
		});
	} catch (error) {
		console.error("Generate QR code error:", error);
		return NextResponse.json(
			{ error: "生成二维码失败" },
			{ status: 500 }
		);
	}
}