import { NextRequest, NextResponse } from "next/server";
import { aiConfigManager } from "@/storage/database/aiConfigManager";
import { getUserFromToken } from "@/lib/auth";

const MEDIA_TYPES = ["image", "video", "tts"] as const;

/**
 * GET /api/media-configs?type=image|video|tts
 * — 获取可用媒体API配置（供前端使用）
 *
 * 返回内容 = 系统公用配置 + 当前登录用户自己添加的配置（scope=user）。
 * 用户在「AI 设置」里自建的图片/视频/配音配置，必须在这里能被取到，
 * 才能在短剧工作台的「API 配置」下拉里选择使用。
 * 未携带有效 token 时行为与之前一致（只返回系统配置），保证向后兼容。
 */
export async function GET(request: NextRequest) {
  try {
    const type = request.nextUrl.searchParams.get("type") || "";
    let configs;
    if (type === "image" || type === "video" || type === "tts") {
      configs = await aiConfigManager.getSystemConfigsByModelType(type);
    } else {
      configs = await aiConfigManager.getAllMediaConfigs();
    }

    // 追加当前用户自建的配置（仅本人可见）
    const payload = getUserFromToken(request.headers.get("authorization") || "");
    if (payload?.userId) {
      const types: string[] = (MEDIA_TYPES as readonly string[]).indexOf(type) >= 0 ? [type] : [...MEDIA_TYPES];
      const mine: any[] = [];
      for (const t of types) {
        mine.push(...(await aiConfigManager.getUserConfigsByModelType(payload.userId, t)));
      }
      configs = [...configs, ...mine];
    }

    // 不返回 apiKey（安全考虑，前端只需知道有哪些配置，实际 key 由后端使用）
    const safeConfigs = configs.filter(c => c.isActive).map(c => ({
      id: c.id,
      name: c.name,
      provider: c.provider,
      model: c.model,
      apiUrl: c.apiUrl,
      modelType: c.modelType,
      isDefault: c.isDefault,
      hasKey: !!c.apiKey,
      // 前端用于区分「系统配置」与「我的配置」
      scope: c.scope === "user" ? "user" : "system",
    }));
    return NextResponse.json({ success: true, data: safeConfigs });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
