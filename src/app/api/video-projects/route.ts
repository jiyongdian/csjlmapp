import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "@/lib/auth";
import { videoProjects } from "@/storage/database/videoProjectStore";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    const payload = getUserFromToken(authHeader);
    
    if (!payload) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }

    const projects = Array.from(videoProjects.values()).filter(p => p.userId === payload.userId);
    return NextResponse.json({ success: true, data: projects });
  } catch (error: any) {
    console.error("获取视频项目失败:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    const payload = getUserFromToken(authHeader);
    
    if (!payload) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }

    const body = await request.json();
    const { title, description } = body;

    if (!title) {
      return NextResponse.json({ success: false, error: "缺少标题" }, { status: 400 });
    }

    const project = {
      id: `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: payload.userId,
      title,
      description: description || "",
      status: "draft" as const,
      videoUrl: null,
      thumbnail: null,
      duration: 0,
      scenes: [],
      createdAt: new Date().toISOString(),
    };

    videoProjects.set(project.id, project);

    return NextResponse.json({ success: true, data: project });
  } catch (error: any) {
    console.error("创建视频项目失败:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}