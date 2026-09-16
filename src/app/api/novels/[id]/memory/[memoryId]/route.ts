import { NextRequest, NextResponse } from "next/server";
import { storyMemoryManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; memoryId: string }> }) {
    const { id, memoryId } = await params;
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const body = await request.json();
    const record = await storyMemoryManager.update(memoryId, payload.userId, body);
    return NextResponse.json({ success: true, data: { memory: record } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "更新失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; memoryId: string }> }) {
    const { id, memoryId } = await params;
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await storyMemoryManager.delete(memoryId, payload.userId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "删除失败" }, { status: 500 });
  }
}
