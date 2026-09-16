import { formatChapterTitle } from '@/lib/chapter-title';
import { NextRequest, NextResponse } from 'next/server';
import { novelManager } from '@/storage/database';
import { getUserFromToken } from '@/lib/auth';
import { syncNovelDetails } from '@/lib/novel-detail-sync';
import { autoCreateProjectForNovel } from '@/lib/auto-drama';

/**
 * GET /api/novels/[id]
 * 获取单个小说（需要登录）
 */
export async function GET(
  request: NextRequest,
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
        { error: '小说不存在' },
        { status: 404 }
      );
    }

    // 验证小说属于当前用户
    if (novel.userId !== payload.userId) {
      return NextResponse.json(
        { error: '无权访问此小说' },
        { status: 403 }
      );
    }

    // 构建 NovelBrief 格式的响应
    const brief: any = {
      id: novel.id,
      title: novel.title,
      description: novel.description || undefined,
      category: novel.category || undefined,
      genderTarget: novel.genderTarget || undefined,
      tone: novel.tone || undefined,
      protagonist: novel.protagonist || undefined,
      totalChapters: novel.totalChapters,
      currentChapters: novel.currentChapters,
      isPublic: Number(novel.isPublic) !== 0,
      structure: novel.structure || undefined,
      idea: novel.idea || undefined,
    };

    // 处理章节数据
    if (novel.chapters) {
      let chapters: any = novel.chapters;
      if (typeof chapters === 'string') {
        try { if (typeof chapters === 'string') chapters = JSON.parse(chapters); } catch { chapters = []; }
      }
      if (Array.isArray(chapters)) {
        brief.chapters = chapters.map((ch: any, i: number) => ({
          index: ch.index ?? ch.number ?? i + 1,
          title: formatChapterTitle(ch.index ?? ch.number ?? i + 1, ch.title),
          content: ch.content || ch.text || ch.body || undefined,
          summary: ch.summary || ch.hook || ch.outline || undefined,
        }));
      }
    } else {
      brief.chapters = [];
    }

    return NextResponse.json({
      success: true,
      data: brief,
    });
  } catch (error: any) {
    console.error('Error fetching novel:', error);
    return NextResponse.json(
      { error: error.message || '获取小说失败' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/novels/[id]
 * 更新小说（需要登录）
 */
export async function PUT(
  request: NextRequest,
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
    const body = await request.json();

    // 检查小说是否存在
    const existing = await novelManager.getById(id);
    if (!existing) {
      return NextResponse.json(
        { error: '小说不存在' },
        { status: 404 }
      );
    }

    // 验证小说属于当前用户
    if (existing.userId !== payload.userId) {
      return NextResponse.json(
        { error: '无权操作此小说' },
        { status: 403 }
      );
    }

    const novel = await novelManager.update(id, payload.userId, body);

    // 异步同步到子表（不阻塞响应）
    syncNovelDetails(id, payload.userId, body).catch((e: unknown) =>
      console.warn('[Novels PUT] Detail sync failed:', e)
    );

    // 异步自动同步关联剧本项目 + 短剧（标题/简介/分类/章节/创意变更时）
    if (body.title || body.description !== undefined || body.category || body.chapters || body.currentChapters || body.idea || body.structure) {
      autoCreateProjectForNovel({ ...existing, ...body, id, userId: payload.userId }).catch((e: unknown) =>
        console.warn('[Novels PUT] Auto project sync failed:', e)
      );
    }

    return NextResponse.json({
      success: true,
      data: novel,
    });
  } catch (error: any) {
    console.error('Error updating novel:', error);
    return NextResponse.json(
      { error: error.message || '更新小说失败' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/novels/[id]
 * 删除小说（需要登录）
 */
export async function DELETE(
  request: NextRequest,
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

    // 检查小说是否存在
    const existing = await novelManager.getById(id);
    if (!existing) {
      return NextResponse.json(
        { error: '小说不存在' },
        { status: 404 }
      );
    }

    // 验证小说属于当前用户
    if (existing.userId !== payload.userId) {
      return NextResponse.json(
        { error: '无权操作此小说' },
        { status: 403 }
      );
    }

    const deleted = await novelManager.delete(id, payload.userId);

    if (!deleted) {
      return NextResponse.json(
        { error: '删除小说失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '小说已删除',
    });
  } catch (error: any) {
    console.error('Error deleting novel:', error);
    return NextResponse.json(
      { error: error.message || '删除小说失败' },
      { status: 500 }
    );
  }
}
