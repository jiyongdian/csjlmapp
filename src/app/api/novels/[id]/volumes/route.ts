import { NextRequest, NextResponse } from "next/server";
import { volumeManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const { id: novelId } = await params;
    const volumes = await volumeManager.listByNovel(novelId, payload.userId);
    return NextResponse.json({ success: true, data: { volumes } });
  } catch (error: any) {
    console.error("Get volumes error:", error);
    return NextResponse.json({ error: error.message || "获取失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const { id: novelId } = await params;
    const body = await request.json();
    const record = await volumeManager.create({
      novelId, userId: payload.userId,
      title: body.title, summary: body.summary,
    });
    return NextResponse.json({ success: true, data: { volume: record } });
  } catch (error: any) {
    console.error("Create volume error:", error);
    return NextResponse.json({ error: error.message || "创建失败" }, { status: 500 });
  }
}

// 批量分配章节到卷
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const { id: novelId } = await params;
    const body = await request.json();
    if (body.assignments && Array.isArray(body.assignments)) {
      await volumeManager.assignChaptersBatch(novelId, payload.userId, body.assignments);
      return NextResponse.json({ success: true, message: "章节分配成功" });
    }
    if (body.chapterNumber !== undefined && body.volumeId !== undefined) {
      await volumeManager.assignChapter(novelId, payload.userId, body.chapterNumber, body.volumeId);
      return NextResponse.json({ success: true, message: "章节分配成功" });
    }
    // 重新统计
    if (body.recalc) {
      await volumeManager.recalcStats(novelId, payload.userId);
      return NextResponse.json({ success: true, message: "统计已更新" });
    }
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  } catch (error: any) {
    console.error("Assign chapters error:", error);
    return NextResponse.json({ error: error.message || "分配失败" }, { status: 500 });
  }
}
