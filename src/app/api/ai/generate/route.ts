import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { aiConfigManager } from "@/storage/database/aiConfigManager";
import { z } from "zod";

// 请求体验证
const generateSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
  })),
  configId: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  stream: z.boolean().optional(),
});

/**
 * POST /api/ai/generate - AI文本生成
 */
export async function POST(request: NextRequest) {
  try {
    const auth = verifyAuth(request.headers.get("authorization"));
    if (!auth.success || !auth.user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const userId = auth.user.userId as string;
    const body = await request.json();

    // 验证请求参数
    const parseResult = generateSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "参数错误", details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { messages, configId, model, temperature, maxTokens, stream } = parseResult.data;

    // 获取AI配置
    let config;
    if (configId) {
      config = await aiConfigManager.getConfigById(configId);
      if (!config || config.userId !== userId) {
        return NextResponse.json({ error: "AI配置不存在或无权限" }, { status: 404 });
      }
    } else {
      config = await aiConfigManager.getOrCreateDefaultConfig(userId);
    }

    // 如果提供了覆盖参数，使用覆盖值
    const effectiveModel = model || config.model;
    const effectiveTemperature = temperature ?? config.temperature;
    const effectiveMaxTokens = maxTokens || config.maxTokens;

    // 如果没有API Key，返回错误
    if (!config.apiKey) {
      return NextResponse.json(
        { error: "请先配置API Key" },
        { status: 400 }
      );
    }

    // 调用外部AI API
    const apiResponse = await fetch(`${config.apiUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: effectiveModel,
        messages,
        temperature: effectiveTemperature,
        max_tokens: effectiveMaxTokens,
        stream: stream || false,
      }),
    });

    if (!apiResponse.ok) {
      const errorData = await apiResponse.json().catch(() => ({}));
      console.error("AI API错误:", apiResponse.status, errorData);
      return NextResponse.json(
        { error: `AI API错误: ${apiResponse.status} ${errorData.error?.message || ""}` },
        { status: 502 }
      );
    }

    // 流式响应
    if (stream) {
      // 返回流式响应
      return new Response(apiResponse.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // 非流式响应
    const data = await apiResponse.json();
    return NextResponse.json({
      success: true,
      data: {
        content: data.choices?.[0]?.message?.content || "",
        model: effectiveModel,
        usage: data.usage,
      },
    });
  } catch (error) {
    console.error("AI生成失败:", error);
    return NextResponse.json(
      { error: "AI生成失败" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/ai/generate - 测试AI连接
 */
export async function GET(request: NextRequest) {
  try {
    const auth = verifyAuth(request.headers.get("authorization"));
    if (!auth.success || !auth.user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const userId = auth.user.userId as string;
    const { searchParams } = new URL(request.url);
    const configId = searchParams.get("configId");

    // 获取AI配置
    let config;
    if (configId) {
      config = await aiConfigManager.getConfigById(configId);
      if (!config || config.userId !== userId) {
        return NextResponse.json({ error: "AI配置不存在或无权限" }, { status: 404 });
      }
    } else {
      config = await aiConfigManager.getOrCreateDefaultConfig(userId);
    }

    // 如果没有API Key，返回提示
    if (!config.apiKey) {
      return NextResponse.json({
        success: false,
        error: "请先配置API Key",
        data: { configured: false },
      });
    }

    // 测试API连接
    try {
      const testResponse = await fetch(`${config.apiUrl}/models`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${config.apiKey}`,
        },
      });

      if (testResponse.ok) {
        return NextResponse.json({
          success: true,
          data: {
            configured: true,
            provider: config.provider,
            model: config.model,
            message: "连接成功",
          },
        });
      } else {
        const errorText = await testResponse.text();
        return NextResponse.json({
          success: false,
          error: `连接失败: ${testResponse.status}`,
          details: errorText,
        });
      }
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: "网络连接失败",
      });
    }
  } catch (error) {
    console.error("测试AI连接失败:", error);
    return NextResponse.json(
      { error: "测试AI连接失败" },
      { status: 500 }
    );
  }
}
