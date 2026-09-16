import { NextRequest, NextResponse } from "next/server";
import { storyMemoryManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const { id: novelId } = await params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") as any;
    const layer = searchParams.get("layer") as any;
    const keyword = searchParams.get("keyword");
    const limit = parseInt(searchParams.get("limit") || "50");

    let memories;
    if (keyword) {
      memories = await storyMemoryManager.search(novelId, payload.userId, keyword);
    } else {
      memories = await storyMemoryManager.listByNovel(novelId, payload.userId, { type, layer, limit });
    }

    return NextResponse.json({ success: true, data: { memories } });
  } catch (error: any) {
    console.error("Get memory error:", error);
    return NextResponse.json({ error: error.message || "获取失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const { id: novelId } = await params;
    const body = await request.json();
    const record = await storyMemoryManager.create({
      novelId,
      userId: payload.userId,
      memoryType: body.memoryType,
      title: body.title,
      content: body.content,
      importance: body.importance,
      sourceChapter: body.sourceChapter,
      tags: body.tags,
    });
    return NextResponse.json({ success: true, data: { memory: record } });
  } catch (error: any) {
    console.error("Create memory error:", error);
    return NextResponse.json({ error: error.message || "创建失败" }, { status: 500 });
  }
}
