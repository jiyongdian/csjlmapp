import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { aiConfigManager } from "@/storage/database/aiConfigManager";

/**
 * GET /api/ai/configs/[id] - 获取单个AI配置
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = verifyAuth(request.headers.get("authorization"));
    if (!auth.success || !auth.user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { id } = await params;
    const userId = auth.user.userId as string;

    const config = await aiConfigManager.getConfigById(id);
    if (!config) {
      return NextResponse.json({ error: "配置不存在" }, { status: 404 });
    }

    // 验证所有权
    if (config.userId !== userId) {
      return NextResponse.json({ error: "无权限访问" }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error("获取AI配置失败:", error);
    return NextResponse.json(
      { error: "获取AI配置失败" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/ai/configs/[id] - 更新AI配置
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = verifyAuth(request.headers.get("authorization"));
    if (!auth.success || !auth.user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { id } = await params;
    const userId = auth.user.userId as string;
    const body = await request.json();

    // 检查配置是否存在
    const existingConfig = await aiConfigManager.getConfigById(id);
    if (!existingConfig) {
      return NextResponse.json({ error: "配置不存在" }, { status: 404 });
    }

    // 验证所有权
    if (existingConfig.userId !== userId) {
      return NextResponse.json({ error: "无权限修改" }, { status: 403 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.provider !== undefined) updateData.provider = body.provider;
    if (body.baseUrl !== undefined) updateData.baseUrl = body.baseUrl;
    if (body.apiKey !== undefined) updateData.apiKey = body.apiKey;
    if (body.model !== undefined) updateData.model = body.model;
    if (body.temperature !== undefined) updateData.temperature = Math.floor(body.temperature);
    if (body.maxTokens !== undefined) updateData.maxTokens = body.maxTokens;
    if (body.isDefault !== undefined) updateData.isDefault = body.isDefault;

    const updatedConfig = await aiConfigManager.updateConfig(id, userId, updateData as any);

    // 如果设置为默认
    if (body.isDefault) {
      await aiConfigManager.setDefaultConfig(id, userId);
    }

    return NextResponse.json({
      success: true,
      data: updatedConfig,
    });
  } catch (error) {
    console.error("更新AI配置失败:", error);
    return NextResponse.json(
      { error: "更新AI配置失败" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/ai/configs/[id] - 删除AI配置
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = verifyAuth(request.headers.get("authorization"));
    if (!auth.success || !auth.user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { id } = await params;
    const userId = auth.user.userId as string;

    // 检查配置是否存在
    const existingConfig = await aiConfigManager.getConfigById(id);
    if (!existingConfig) {
      return NextResponse.json({ error: "配置不存在" }, { status: 404 });
    }

    // 验证所有权
    if (existingConfig.userId !== userId) {
      return NextResponse.json({ error: "无权限删除" }, { status: 403 });
    }

    const deleted = await aiConfigManager.deleteConfig(id, userId);

    return NextResponse.json({
      success: deleted,
      message: deleted ? "删除成功" : "删除失败",
    });
  } catch (error) {
    console.error("删除AI配置失败:", error);
    return NextResponse.json(
      { error: "删除AI配置失败" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ai/configs/[id]/validate - 验证AI配置
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = verifyAuth(request.headers.get("authorization"));
    if (!auth.success || !auth.user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { id } = await params;
    const userId = auth.user.userId as string;

    // 获取配置
    const config = await aiConfigManager.getConfigById(id);
    if (!config) {
      return NextResponse.json({ error: "配置不存在" }, { status: 404 });
    }

    // 验证所有权
    if (config.userId !== userId) {
      return NextResponse.json({ error: "无权限访问" }, { status: 403 });
    }

    // 调用API进行验证
    const apiUrl = config.apiUrl;
    if (!apiUrl) {
      return NextResponse.json({ success: false, error: "API地址未配置" }, { status: 400 });
    }

    if (!config.apiKey) {
      return NextResponse.json({ success: false, error: "API密钥未配置" }, { status: 400 });
    }

    // 构造验证请求
    const validateUrl = `${apiUrl.replace(/\/$/, '')}/chat/completions`;
    
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
    console.error("验证AI配置失败:", error);
    return NextResponse.json({
      success: false,
      error: error.message || "验证失败，请检查API地址和密钥"
    }, { status: 500 });
  }
}
