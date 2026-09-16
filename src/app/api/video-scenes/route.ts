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

    const projectId = request.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ success: false, error: "缺少项目ID" }, { status: 400 });
    }

    const project = videoProjects.get(projectId);
    if (!project || project.userId !== payload.userId) {
      return NextResponse.json({ success: false, error: "项目不存在或无权访问" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: project.scenes });
  } catch (error: any) {
    console.error("获取场景失败:", error);
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
    const { projectId, order } = body;

    if (!projectId) {
      return NextResponse.json({ success: false, error: "缺少项目ID" }, { status: 400 });
    }

    const project = videoProjects.get(projectId);
    if (!project || project.userId !== payload.userId) {
      return NextResponse.json({ success: false, error: "项目不存在或无权访问" }, { status: 404 });
    }

    const scene = {
      id: `scene_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      prompt: "",
      imageUrl: null,
      audioText: "",
      duration: 3,
      order: order || project.scenes.length,
      status: "pending" as const,
    };

    project.scenes.push(scene);
    videoProjects.set(projectId, project);

    return NextResponse.json({ success: true, data: scene });
  } catch (error: any) {
    console.error("创建场景失败:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    const payload = getUserFromToken(authHeader);
    
    if (!payload) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }

    const body = await request.json();
    const { id, prompt, audioText, duration } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: "缺少场景ID" }, { status: 400 });
    }

    let foundProject: any = null;
    let foundScene: any = null;
    
    for (const [_, project] of videoProjects) {
      const scene = project.scenes.find((s: any) => s.id === id);
      if (scene) {
        foundProject = project;
        foundScene = scene;
        break;
      }
    }

    if (!foundProject || !foundScene) {
      return NextResponse.json({ success: false, error: "场景不存在" }, { status: 404 });
    }

    if (foundProject.userId !== payload.userId) {
      return NextResponse.json({ success: false, error: "无权访问" }, { status: 403 });
    }

    if (prompt !== undefined) foundScene.prompt = prompt;
    if (audioText !== undefined) foundScene.audioText = audioText;
    if (duration !== undefined) foundScene.duration = duration;

    videoProjects.set(foundProject.id, foundProject);

    return NextResponse.json({ success: true, data: foundScene });
  } catch (error: any) {
    console.error("更新场景失败:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}