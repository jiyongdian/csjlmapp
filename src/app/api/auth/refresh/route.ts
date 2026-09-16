import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { refreshAccessToken } from "@/lib/auth";

const refreshSchema = z.object({
	refreshToken: z.string(),
});

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const validated = refreshSchema.parse(body);

		const tokens = refreshAccessToken(validated.refreshToken);
		if (!tokens) {
			return NextResponse.json(
				{ error: "Token已过期，请重新登录" },
				{ status: 401 }
			);
		}

		return NextResponse.json({
			success: true,
			data: tokens,
		});
	} catch (error) {
		console.error("Refresh token error:", error);
		return NextResponse.json(
			{ error: "Token刷新失败" },
			{ status: 500 }
		);
	}
}
