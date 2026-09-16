import { NextResponse } from "next/server";
import { novelManager, projectManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";
import { autoCreateProjectForNovel } from "@/lib/auto-drama";

/**
 * POST /api/novels/sync-projects
 * 为当前用户的所有小说同步剧本项目
 * - 已有关联项目的小说 → 跳过
 * - 无关联项目的小说 → 自动创建项目 + 短剧
 */
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const payload = getUserFromToken(authHeader);

    if (!payload) {
      return NextResponse.json(
        { error: "请先登录" },
        { status: 401 }
      );
    }

    // 管理员可同步所有小说，普通用户仅同步自己的
    let novels: any[] = [];
    if (payload.role === "admin") {
      const all = await novelManager.getAllNovels({ limit: 500, offset: 0 });
      novels = all.novels;
    } else {
      const result = await novelManager.getUserNovels(payload.userId, {
        limit: 500,
        offset: 0,
      });
      novels = result.novels;
    }

    const results: Array<{
      novelId: string;
      title: string;
      projectId: number | null;
      dramaId: string | null;
      action: "created" | "skipped" | "failed";
      error?: string;
    }> = [];

    // 并发处理，限制并发数
    const BATCH_SIZE = 5;

    for (let i = 0; i < novels.length; i += BATCH_SIZE) {
      const batch = novels.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (novel) => {
          try {
            // 检查是否已有项目
            const existingProject = await projectManager.getByNovelId(novel.id);
            if (existingProject) {
              return {
                novelId: novel.id,
                title: novel.title,
                projectId: existingProject.id,
                dramaId: null as string | null,
                action: "skipped" as const,
              };
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

            return {
              novelId: novel.id,
              title: novel.title,
              projectId,
              dramaId,
              action: "created" as const,
            };
          } catch (e: any) {
            return {
              novelId: novel.id,
              title: novel.title,
              projectId: null,
              dramaId: null,
              action: "failed" as const,
              error: e.message || String(e),
            };
          }
        })
      );
      results.push(...batchResults);
    }

    const created = results.filter((r) => r.action === "created").length;
    const skipped = results.filter((r) => r.action === "skipped").length;
    const failed = results.filter((r) => r.action === "failed").length;

    return NextResponse.json({
      success: true,
      message: `同步完成：创建 ${created} 个项目，跳过 ${skipped} 个（已有项目），失败 ${failed} 个`,
      data: {
        total: results.length,
        created,
        skipped,
        failed,
        details: results,
      },
    });
  } catch (error) {
    console.error("Sync projects error:", error);
    return NextResponse.json(
      { error: "同步项目失败" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/novels/sync-projects
 * 检查当前用户小说的项目关联状态
 */
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const payload = getUserFromToken(authHeader);

    if (!payload) {
      return NextResponse.json(
        { error: "请先登录" },
        { status: 401 }
      );
    }

    const result = await novelManager.getUserNovels(payload.userId, {
      limit: 500,
      offset: 0,
    });

    const statuses = await Promise.all(
      result.novels.map(async (novel) => {
        const project = await projectManager.getByNovelId(novel.id);
        return {
          novelId: novel.id,
          title: novel.title,
          hasProject: !!project,
          projectId: project?.id || null,
        };
      })
    );

    const missing = statuses.filter((s) => !s.hasProject).length;

    return NextResponse.json({
      success: true,
      data: {
        total: statuses.length,
        hasProject: statuses.length - missing,
        missing,
        details: statuses,
      },
    });
  } catch (error) {
    console.error("Check sync status error:", error);
    return NextResponse.json(
      { error: "检查同步状态失败" },
      { status: 500 }
    );
  }
}