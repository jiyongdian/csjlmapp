import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { aiConfigManager } from "@/storage/database/aiConfigManager";

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
