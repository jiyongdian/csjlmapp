import { NextResponse } from "next/server";
import { novelManager, projectManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";
import { autoCreateProjectForNovel } from "@/lib/auto-drama";

/**
 * POST /api/novels/:id/sync-project
 * 为单部小说同步/创建剧本项目
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const payload = getUserFromToken(authHeader);

    if (!payload) {
      return NextResponse.json(
        { error: "请先登录" },
        { status: 401 }
      );
    }

    const { id } = await params;
    const novel = await novelManager.getById(id);

    if (!novel) {
      return NextResponse.json(
        { error: "小说不存在" },
        { status: 404 }
      );
    }

    // 验证小说属于当前用户（管理员可操作任意小说）
    if (payload.role !== "admin" && novel.userId !== payload.userId) {
      return NextResponse.json(
        { error: "无权操作此小说" },
        { status: 403 }
      );
    }

    // 检查是否已有项目
    const existingProject = await projectManager.getByNovelId(novel.id);
    if (existingProject) {
      return NextResponse.json({
        success: true,
        message: "项目已存在",
        data: {
          projectId: existingProject.id,
          dramaId: null,
          alreadyExists: true,
        },
      });
    }

    // 创建项目 + 短剧
    const { projectId, dramaId } = await autoCreateProjectForNovel({
      id: novel.id,
      userId: novel.userId || payload.userId,
      title: novel.title,
      description: novel.description,
      category: novel.category,
      totalChapters: novel.totalChapters,
      currentChapters: novel.currentChapters,
      chapters: novel.chapters,
      idea: novel.idea,
      structure: novel.structure,
    });

    return NextResponse.json({
      success: true,
      message: "项目创建成功",
      data: {
        projectId,
        dramaId,
        alreadyExists: false,
      },
    });
  } catch (error: any) {
    console.error("Sync single project error:", error);
    return NextResponse.json(
      { error: error?.message || "同步项目失败" },
      { status: 500 }
    );
  }
}