import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "@/lib/auth";
import { aiConfigManager } from "@/storage/database/aiConfigManager";

/**
 * PUT /api/admin/ai-configs/[id] - 更新系统级AI配置
 */
export async function PUT(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const authHeader = request.headers.get("Authorization");
		const payload = getUserFromToken(authHeader || "");
		if (!payload || payload.role !== "admin") {
			return NextResponse.json({ error: "无权限" }, { status: 403 });
		}

		const { id } = await params;
		const body = await request.json();

		const existingConfig = await aiConfigManager.getConfigByIdAdmin(id);
		if (!existingConfig) {
			return NextResponse.json({ error: "配置不存在" }, { status: 404 });
		}

		const updateData: Record<string, unknown> = {};
		if (body.name !== undefined) updateData.name = body.name;
		if (body.provider !== undefined) updateData.provider = body.provider;
		if (body.apiUrl !== undefined || body.baseUrl !== undefined) updateData.apiUrl = body.apiUrl || body.baseUrl;
		if (body.apiKey !== undefined) updateData.apiKey = body.apiKey;
		if (body.model !== undefined) updateData.model = body.model;
		if (body.temperature !== undefined) updateData.temperature = Math.floor(body.temperature);
		if (body.maxTokens !== undefined) updateData.maxTokens = body.maxTokens;
		if (body.isDefault !== undefined) updateData.isDefault = body.isDefault ? 1 : 0;
		if (body.isActive !== undefined) updateData.isActive = body.isActive ? 1 : 0;

		const updatedConfig = await aiConfigManager.updateSystemConfig(id, updateData as any);

		if (body.isDefault) {
			await aiConfigManager.setSystemDefaultConfig(id);
		}

		return NextResponse.json({
			success: true,
			data: updatedConfig,
		});
	} catch (error) {
		console.error("更新系统AI配置失败:", error);
		return NextResponse.json(
			{ error: "更新系统AI配置失败" },
			{ status: 500 }
		);
	}
}

/**
 * DELETE /api/admin/ai-configs/[id] - 删除系统级AI配置
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("Authorization");
    const payload = getUserFromToken(authHeader || "");
    if (!payload || payload.role !== "admin") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { id } = await params;

    const deleted = await aiConfigManager.deleteSystemConfig(id);

    return NextResponse.json({
      success: deleted,
      message: deleted ? "删除成功" : "删除失败",
    });
  } catch (error) {
    console.error("删除系统AI配置失败:", error);
    return NextResponse.json(
      { error: "删除系统AI配置失败" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/ai-configs/[id]/validate - 验证系统级AI配置
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("Authorization");
    const payload = getUserFromToken(authHeader || "");
    if (!payload || payload.role !== "admin") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { id } = await params;

    const config = await aiConfigManager.getConfigByIdAdmin(id);
    if (!config) {
      return NextResponse.json({ error: "配置不存在" }, { status: 404 });
    }

    if (!config.apiUrl) {
      return NextResponse.json({ success: false, error: "API地址未配置" }, { status: 400 });
    }

    if (!config.apiKey) {
      return NextResponse.json({ success: false, error: "API密钥未配置" }, { status: 400 });
    }

    const validateUrl = `${config.apiUrl.replace(/\/$/, '')}/chat/completions`;

    const response = await fetch(validateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 10,
      }),
    });

    if (response.ok) {
      return NextResponse.json({ success: true, message: "连接成功" });
    } else {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json({
        success: false,
        error: errorData.error?.message || `请求失败 (${response.status})`
      });
    }
  } catch (error: any) {
    console.error("验证系统AI配置失败:", error);
    return NextResponse.json({
      success: false,
      error: error.message || "验证失败，请检查API地址和密钥"
    }, { status: 500 });
  }
}