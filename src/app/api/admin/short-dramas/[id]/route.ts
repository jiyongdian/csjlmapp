import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { shortDramaManager, userManager, novelManager, dramaWorkflowManager, scriptManager } from '@/storage/database';
import { normalizeEpisodeSourceFields } from '@/lib/episode-source';
import { buildEpisodeSynopsis } from '@/lib/episode-summary';

/**
 * GET /api/admin/short-dramas/[id] — 获取短剧详情（含分集）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const { id } = await params;
    const result = await shortDramaManager.getDramaWithEpisodes(id);
    if (!result) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }

    const owner = await userManager.getUserById(result.drama.userId);
    let novelTitle: string | null = null;
    let novelChapters: any[] = [];
    if (result.drama.novelId) {
      const novel = await novelManager.getById(result.drama.novelId);
      novelTitle = novel?.title || null;
      if (novel?.chapters) {
        try {
          novelChapters = typeof novel.chapters === 'string' ? JSON.parse(novel.chapters) : novel.chapters;
        } catch { novelChapters = []; }
      }
    }

    const characters = await dramaWorkflowManager.getCharactersByDramaId(id);
    const scenes = await dramaWorkflowManager.getScenesByDramaId(id);
    const items = await dramaWorkflowManager.getItemsByDramaId(id);
    const shots = await dramaWorkflowManager.getShotsByDramaId(id);
    const assets = await dramaWorkflowManager.getAssetsByDramaId(id);
    const tasks = await dramaWorkflowManager.getTasksByDramaId(id);
    let scriptChapters: any[] = [];
    if (result.drama.scriptId) {
      const script = await scriptManager.getScriptById(result.drama.scriptId);
      scriptChapters = Array.isArray(script?.chapters) ? script.chapters : [];
    }
    const normalizedEpisodes = result.episodes.map(ep => {
      const normalized = normalizeEpisodeSourceFields(ep, scriptChapters);
      const scriptChapter = normalized.sourceScriptChapterIndex != null
        ? scriptChapters[normalized.sourceScriptChapterIndex]
        : null;
      const novelChapter = normalized.sourceChapter != null
        ? novelChapters.find((ch: any) => ch?.index === normalized.sourceChapter) || novelChapters[normalized.sourceChapter - 1]
        : null;
      return {
        ...normalized,
        synopsis: buildEpisodeSynopsis({
          synopsis: normalized.synopsis,
          screenplay: normalized.screenplay || scriptChapter?.screenplay,
          scriptChapter,
          novelChapter,
        }) || normalized.synopsis,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        ...result.drama,
        episodes: normalizedEpisodes,
        characters,
        scenes,
        items,
        shots,
        assets,
        tasks,
        ownerName: owner?.username || '未知用户',
        ownerEmail: owner?.email || '',
        novelTitle,
      },
    });
  } catch (error) {
    console.error('获取短剧详情失败:', error);
    return NextResponse.json({ error: '获取短剧详情失败' }, { status: 500 });
  }
}

/**
 * PUT /api/admin/short-dramas/[id] — 更新短剧
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const allowedFields: Record<string, unknown> = {};
    for (const key of ['title', 'description', 'genre', 'targetAudience', 'totalEpisodes', 'episodeDuration', 'status', 'coverImage', 'tags', 'style', 'platform']) {
      if (body[key] !== undefined) allowedFields[key] = body[key];
    }

    const updated = await shortDramaManager.update(id, allowedFields as any);
    if (!updated) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: updated, message: '短剧更新成功' });
  } catch (error) {
    console.error('更新短剧失败:', error);
    return NextResponse.json({ error: '更新短剧失败' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/short-dramas/[id] — 删除短剧（含所有分集）
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const { id } = await params;
    const deleted = await shortDramaManager.delete(id);
    if (!deleted) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: '短剧已删除' });
  } catch (error) {
    console.error('删除短剧失败:', error);
    return NextResponse.json({ error: '删除短剧失败' }, { status: 500 });
  }
}
