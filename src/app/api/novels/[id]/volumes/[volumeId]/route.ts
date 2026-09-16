import { NextRequest, NextResponse } from "next/server";
import { volumeManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; volumeId: string }> }) {
    const { id, volumeId } = await params;
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const body = await request.json();
    const record = await volumeManager.update(volumeId, payload.userId, body);
    return NextResponse.json({ success: true, data: { volume: record } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "更新失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; volumeId: string }> }) {
    const { id, volumeId } = await params;
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await volumeManager.delete(volumeId, payload.userId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "删除失败" }, { status: 500 });
  }
}
