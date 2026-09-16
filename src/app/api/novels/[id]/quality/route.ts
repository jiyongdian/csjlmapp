import { NextRequest, NextResponse } from "next/server";
import { qualityCheckManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const { id: novelId } = await params;
    const { searchParams } = new URL(request.url);
    const chapterNumber = searchParams.get("chapter");
    const checks = await qualityCheckManager.listByNovel(novelId, payload.userId, {
      chapterNumber: chapterNumber ? parseInt(chapterNumber) : undefined,
    });
    return NextResponse.json({ success: true, data: { checks } });
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

    if (body.action === "quick-check" && body.content) {
      const result = qualityCheckManager.quickHumanityCheck(body.content);
      const saved = await qualityCheckManager.create({
        novelId, userId: payload.userId,
        chapterNumber: body.chapterNumber,
        ...result,
      });
      return NextResponse.json({ success: true, data: saved });
    }

    const check = await qualityCheckManager.create({
      novelId, userId: payload.userId,
      chapterNumber: body.chapterNumber,
      overallScore: body.overallScore,
      emotionScore: body.emotionScore,
      specificityScore: body.specificityScore,
      naturalnessScore: body.naturalnessScore,
      dialogueScore: body.dialogueScore,
      pacingScore: body.pacingScore,
      issues: body.issues,
    });
    return NextResponse.json({ success: true, data: { check } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
