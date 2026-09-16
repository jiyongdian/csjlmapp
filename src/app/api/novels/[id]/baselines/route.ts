import { NextRequest, NextResponse } from "next/server";
import { chapterBaselineManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const { id: novelId } = await params;
    const { searchParams } = new URL(request.url);
    const chapterNumber = searchParams.get("chapter");
    if (chapterNumber) {
      const baseline = await chapterBaselineManager.getByChapter(novelId, parseInt(chapterNumber));
      return NextResponse.json({ success: true, data: { baseline } });
    }
    const edited = await chapterBaselineManager.getUserEditedChapters(novelId, payload.userId);
    return NextResponse.json({ success: true, data: { editedChapters: edited } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const { id: novelId } = await params;
    const body = await request.json();
    const { action } = body;

    if (action === "save-baseline") {
      const result = await chapterBaselineManager.saveBaseline(novelId, payload.userId, body.chapterNumber, body.content);
      return NextResponse.json({ success: true, data: result });
    }
    if (action === "user-edit") {
      const result = await chapterBaselineManager.recordUserEdit(novelId, payload.userId, body.chapterNumber, body.content);
      return NextResponse.json({ success: true, data: result });
    }
    if (action === "force-overwrite") {
      await chapterBaselineManager.forceOverwrite(novelId, payload.userId, body.chapterNumber, body.content);
      return NextResponse.json({ success: true });
    }
    if (action === "check-conflict") {
      const conflict = await chapterBaselineManager.checkConflict(novelId, body.chapterNumber, body.content);
      return NextResponse.json({ success: true, data: { conflict } });
    }
    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
