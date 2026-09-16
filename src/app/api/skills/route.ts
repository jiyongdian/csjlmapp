import { NextRequest, NextResponse } from "next/server";
import { skillManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") as any;
    const skills = await skillManager.listByUser(payload.userId, category ? { category } : undefined);
    return NextResponse.json({ success: true, data: { skills } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const body = await request.json();
    const skill = await skillManager.create({ ...body, userId: payload.userId });
    return NextResponse.json({ success: true, data: { skill } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
