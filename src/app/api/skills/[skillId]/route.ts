import { NextRequest, NextResponse } from "next/server";
import { skillManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ skillId: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const { skillId } = await params;
    await skillManager.delete(skillId, payload.userId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ skillId: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const { skillId } = await params;
    const body = await request.json();
    const skill = await skillManager.update(skillId, payload.userId, body);
    return NextResponse.json({ success: true, data: { skill } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
