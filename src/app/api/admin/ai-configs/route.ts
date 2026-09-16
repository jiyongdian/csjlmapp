import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "@/lib/auth";
import { aiConfigManager } from "@/storage/database/aiConfigManager";
import { AI_PROVIDERS } from "@/storage/database/shared/schema";

/**
 * GET /api/admin/ai-configs - 获取所有系统级AI配置
 */
export async function GET(request: NextRequest) {
	try {
		const authHeader = request.headers.get("Authorization");
		const payload = getUserFromToken(authHeader || "");
		if (!payload || payload.role !== "admin") {
			return NextResponse.json({ error: "无权限" }, { status: 403 });
		}

		const configs = await aiConfigManager.getAllSystemConfigs();
		const formattedConfigs = configs.map(config => ({
			...config,
			isActive: config.isActive === 1,
			isDefault: config.isDefault === 1
		}));

		return NextResponse.json({
			success: true,
			data: {
				configs: formattedConfigs,
				providers: AI_PROVIDERS,
			},
		});
	} catch (error) {
		console.error("获取系统AI配置失败:", error);
		return NextResponse.json(
			{ error: "获取系统AI配置失败" },
			{ status: 500 }
		);
	}
}

/**
 * POST /api/admin/ai-configs - 创建系统级AI配置
 */
export async function POST(request: NextRequest) {
	try {
		const authHeader = request.headers.get("Authorization");
		const payload = getUserFromToken(authHeader || "");
		if (!payload || payload.role !== "admin") {
			return NextResponse.json({ error: "无权限" }, { status: 403 });
		}

		const body = await request.json() as Record<string, unknown>;

		const config = await aiConfigManager.createConfig({
			userId: null,
			name: body.name as string,
			provider: body.provider as string,
			apiUrl: (body.apiUrl || body.baseUrl) as string,
			apiKey: body.apiKey as string,
			model: body.model as string,
			temperature: body.temperature !== undefined ? Math.floor(Number(body.temperature)) : 85,
			maxTokens: body.maxTokens !== undefined ? Math.floor(Number(body.maxTokens)) : 8192,
			scope: 'system',
			isDefault: body.isDefault ? 1 : 0,
			isActive: 1,
		} as any);

		if (config.isDefault) {
			await aiConfigManager.setSystemDefaultConfig(config.id);
		}

		return NextResponse.json({
			success: true,
			data: config,
		});
	} catch (error) {
		console.error("创建系统AI配置失败:", error);
		return NextResponse.json(
			{ error: "创建系统AI配置失败" },
			{ status: 500 }
		);
	}
}