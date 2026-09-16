import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "@/lib/auth";
import { videoProjects } from "@/storage/database/videoProjectStore";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authHeader = request.headers.get("Authorization");
    const payload = getUserFromToken(authHeader);
    
    if (!payload) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }

    const { id: sceneId } = await params;

    let foundProject: any = null;
    let sceneIndex = -1;
    
    for (const [_, project] of videoProjects) {
      const index = project.scenes.findIndex((s: any) => s.id === sceneId);
      if (index >= 0) {
        foundProject = project;
        sceneIndex = index;
        break;
      }
    }

    if (!foundProject || sceneIndex < 0) {
      return NextResponse.json({ success: false, error: "场景不存在" }, { status: 404 });
    }

    if (foundProject.userId !== payload.userId) {
      return NextResponse.json({ success: false, error: "无权访问" }, { status: 403 });
    }

    foundProject.scenes.splice(sceneIndex, 1);
    foundProject.scenes.forEach((scene: any, index: number) => {
      scene.order = index;
    });

    videoProjects.set(foundProject.id, foundProject);

    return NextResponse.json({ success: true, message: "场景已删除" });
  } catch (error: any) {
    console.error("删除场景失败:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}