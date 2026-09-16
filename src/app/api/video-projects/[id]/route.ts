import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "@/lib/auth";
import { videoProjects } from "@/storage/database/videoProjectStore";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authHeader = request.headers.get("Authorization");
    const payload = getUserFromToken(authHeader);
    
    if (!payload) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }

    const { id } = await params;
    const project = videoProjects.get(id);
    if (!project || project.userId !== payload.userId) {
      return NextResponse.json({ success: false, error: "项目不存在或无权访问" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: project });
  } catch (error: any) {
    console.error("获取项目失败:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authHeader = request.headers.get("Authorization");
    const payload = getUserFromToken(authHeader);
    
    if (!payload) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }

    const { id } = await params;
    const project = videoProjects.get(id);
    if (!project || project.userId !== payload.userId) {
      return NextResponse.json({ success: false, error: "项目不存在或无权访问" }, { status: 404 });
    }

    const body = await request.json();
    const { title, description } = body;

    if (title) project.title = title;
    if (description) project.description = description;

    videoProjects.set(id, project);

    return NextResponse.json({ success: true, data: project });
  } catch (error: any) {
    console.error("更新项目失败:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authHeader = request.headers.get("Authorization");
    const payload = getUserFromToken(authHeader);
    
    if (!payload) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }

    const { id } = await params;
    const project = videoProjects.get(id);
    if (!project || project.userId !== payload.userId) {
      return NextResponse.json({ success: false, error: "项目不存在或无权访问" }, { status: 404 });
    }

    videoProjects.delete(id);

    return NextResponse.json({ success: true, message: "项目已删除" });
  } catch (error: any) {
    console.error("删除项目失败:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authHeader = request.headers.get("Authorization");
    const payload = getUserFromToken(authHeader);
    
    if (!payload) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }

    const { id } = await params;
    const project = videoProjects.get(id);
    if (!project || project.userId !== payload.userId) {
      return NextResponse.json({ success: false, error: "项目不存在或无权访问" }, { status: 404 });
    }

    const body = await request.json();
    const { configId } = body;

    project.status = "generating";
    videoProjects.set(id, project);

    setTimeout(() => {
      project.status = "completed";
      project.videoUrl = `https://example.com/video/${project.id}.mp4`;
      project.thumbnail = `https://picsum.photos/seed/${project.id}/1280/720`;
      project.duration = project.scenes.reduce((sum: number, s: any) => sum + (s.duration || 3), 0);
      videoProjects.set(id, project);
    }, 5000);

    return NextResponse.json({ success: true, message: "视频生成任务已提交" });
  } catch (error: any) {
    console.error("生成视频失败:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}