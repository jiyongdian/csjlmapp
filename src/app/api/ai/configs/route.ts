import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { aiConfigManager } from "@/storage/database/aiConfigManager";
import { AI_PROVIDERS } from "@/storage/database/shared/schema";

function isTextConfig(config: any) {
  return String(config?.modelType || 'text').toLowerCase() === 'text';
}

/**
 * GET /api/ai/configs - 获取用户的所有AI配置（含系统级配置）
 */
export async function GET(request: NextRequest) {
  try {
    const auth = verifyAuth(request.headers.get("authorization"));
    const userId = auth.success && auth.user ? auth.user.userId as string : null;

    // 未登录用户只能获取平台列表
    if (!userId) {
      return NextResponse.json({
        success: true,
        data: {
          configs: [],
          systemConfigs: [],
          defaultConfigId: null,
          providers: AI_PROVIDERS,
          message: "请登录以管理您的AI配置"
        },
      });
    }

    // 获取用户可用的所有配置（系统级 + 用户级）
    const { system, user } = await aiConfigManager.getAvailableConfigs(userId);
    const textSystem = system.filter(isTextConfig);
    const textUser = user.filter(isTextConfig);

    // 获取默认配置
    const defaultConfig = await aiConfigManager.getDefaultConfig(userId);
    const defaultTextConfigId = defaultConfig && isTextConfig(defaultConfig)
      ? defaultConfig.id
      : textUser.find((config: any) => config.isDefault)?.id
        || textSystem.find((config: any) => config.isDefault)?.id
        || textUser[0]?.id
        || textSystem[0]?.id
        || null;

    return NextResponse.json({
      success: true,
      data: {
        configs: textUser,
        systemConfigs: textSystem,
        defaultConfigId: defaultTextConfigId || null,
        providers: AI_PROVIDERS,
      },
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
 * POST /api/ai/configs - 创建新的用户级AI配置
 */
export async function POST(request: NextRequest) {
  try {
    const auth = verifyAuth(request.headers.get("authorization"));
    if (!auth.success || !auth.user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const userId = auth.user.userId as string;
    const body = await request.json();

    // temperature: 前端传0-100，直接存储
    const temperature = body.temperature !== undefined
      ? Math.floor(body.temperature)
      : 85;

    const config = await aiConfigManager.createConfig({
      userId,
      name: body.name,
      provider: body.provider,
      apiUrl: body.apiUrl || body.baseUrl,
      apiKey: body.apiKey,
      model: body.model,
      temperature,
      maxTokens: body.maxTokens ? Math.floor(body.maxTokens) : 8192,
      scope: 'user',
      isDefault: body.isDefault ? 1 : 0,
    } as any);

    // 如果设置为默认，取消其他默认
    if (config.isDefault) {
      await aiConfigManager.setDefaultConfig(config.id, userId);
    }

    return NextResponse.json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error("创建AI配置失败:", error);
    return NextResponse.json(
      { error: "创建AI配置失败" },
      { status: 500 }
    );
  }
}
