import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "@/lib/auth";
import { novelManager } from "@/storage/database";

/**
 * POST /api/admin/novels/dedupe
 * 管理员全局清理所有用户的重复草稿小说 + 空草稿
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const payload = getUserFromToken(authHeader);

    if (!payload) {
      return NextResponse.json(
        { success: false, error: "未授权" },
        { status: 401 }
      );
    }
    if (payload.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: "需要管理员权限" },
        { status: 403 }
      );
    }

    const stats = await novelManager.dedupeAndMergeDrafts(/* 不传userId => 全局处理所有用户 */);

    return NextResponse.json({
      success: true,
      message: `全局去重完成：合并 ${stats.groups} 组重复，清理 ${stats.emptyDeleted} 个空草稿，共删除 ${stats.deletedTotal} 本`,
      data: stats,
    });
  } catch (error) {
    console.error("[admin novels dedupe] 全局去重失败:", error);
    return NextResponse.json(
      { success: false, error: "全局去重失败：" + (error as Error).message },
      { status: 500 }
    );
  }
}
