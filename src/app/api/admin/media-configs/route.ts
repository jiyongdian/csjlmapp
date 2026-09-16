import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "@/lib/auth";
import { aiConfigManager } from "@/storage/database/aiConfigManager";
import { IMAGE_PROVIDERS, VIDEO_PROVIDERS, TTS_PROVIDERS } from "@/storage/database/shared/schema";

/** GET /api/admin/media-configs?type=image|video  — 获取所有媒体API配置 */
export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get("Authorization") || "");
    if (!payload || payload.role !== "admin") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }
    const type = request.nextUrl.searchParams.get("type");
    const configs = type
      ? await aiConfigManager.getSystemConfigsByModelType(type)
      : await aiConfigManager.getAllMediaConfigs();
    return NextResponse.json({ success: true, data: { configs, imageProviders: IMAGE_PROVIDERS, videoProviders: VIDEO_PROVIDERS, ttsProviders: TTS_PROVIDERS } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** POST /api/admin/media-configs  — 创建系统媒体API配置 */
export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get("Authorization") || "");
    if (!payload || payload.role !== "admin") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }
    const body = await request.json();
    const { name, provider, model, apiKey, apiUrl, modelType, isDefault, notes, endpointPath } = body;
    if (!name || !provider || !model || !apiKey) {
      return NextResponse.json({ error: "name、provider、model、apiKey 为必填项" }, { status: 400 });
    }
    if (modelType !== "image" && modelType !== "video" && modelType !== "tts") {
      return NextResponse.json({ error: "modelType 必须为 image、video 或 tts" }, { status: 400 });
    }
    const config = await aiConfigManager.createConfig({
      userId: null as any,
      name,
      provider,
      model,
      apiKey,
      apiUrl: apiUrl || "",
      modelType,
      scope: "system",
      isDefault: isDefault ? 1 : 0,
      isActive: 1,
      temperature: 85,
      extraConfig: (notes || endpointPath) ? JSON.stringify({ notes, endpointPath }) : null,
    } as any);
    if (config.isDefault) {
      await aiConfigManager.setMediaDefaultConfig(config.id, modelType);
    }
    return NextResponse.json({ success: true, data: config });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
