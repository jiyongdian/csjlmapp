import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "@/lib/auth";
import { novelManager } from "@/storage/database";

/**
 * POST /api/novels/dedupe
 * 当前登录用户清理自己的重复草稿小说 + 空草稿
 * 合并规则：按 (userId + title.trim + 草稿态) 分组，保留 currentChapters 最多/更新时间最新者
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const payload = getUserFromToken(authHeader);

    if (!payload) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    const stats = await novelManager.dedupeAndMergeDrafts(payload.userId);

    return NextResponse.json({
      success: true,
      message: `去重完成：合并 ${stats.groups} 组重复，清理 ${stats.emptyDeleted} 个空草稿，共删除 ${stats.deletedTotal} 本`,
      data: stats,
    });
  } catch (error) {
    console.error("[novels dedupe] 去重失败:", error);
    return NextResponse.json(
      { success: false, error: "去重失败：" + (error as Error).message },
      { status: 500 }
    );
  }
}
