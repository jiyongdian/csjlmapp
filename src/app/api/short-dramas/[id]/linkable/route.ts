import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { shortDramaManager } from '@/storage/database';
import { novelManager } from '@/storage/database/novelManager';
import { scriptManager } from '@/storage/database/scriptManager';

/**
 * GET /api/short-dramas/[id]/linkable
 * 获取可关联到该短剧的小说 / 剧本候选列表（供「关联小说」弹窗使用）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id } = await params;

    const drama = await shortDramaManager.getById(id);
    if (!drama || drama.userId !== payload.userId) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }

    // 获取用户的所有小说（带章节数）
    const { novels: userNovels } = await novelManager.getUserNovels(payload.userId, { limit: 200 });
    const novelList = userNovels.map((n: any) => {
      let chapterCount = 0;
      if (n.chapters) {
        try {
          const chs = typeof n.chapters === 'string' ? JSON.parse(n.chapters) : n.chapters;
          chapterCount = Array.isArray(chs) ? chs.length : 0;
        } catch {}
      }
      return {
        id: n.id,
        title: n.title,
        category: n.category,
        totalChapters: n.totalChapters,
        currentChapters: n.currentChapters,
        chapterCount,
        status: n.status,
      };
    });

    // 获取用户的所有剧本
    const scripts = await scriptManager.getScriptsByUserId(payload.userId);
    const scriptList = scripts.map((s: any) => {
      const chapterCount = Array.isArray(s.chapters) ? s.chapters.length : 0;
      const hasScreenplay = Array.isArray(s.chapters) && s.chapters.some((c: any) => c.screenplay);
      const hasImagePrompts = Array.isArray(s.chapters) && s.chapters.some((c: any) => c.imagePrompts?.length > 0);
      const hasVideoPrompts = Array.isArray(s.chapters) && s.chapters.some((c: any) => c.videoPrompts?.length > 0);
      return {
        id: s.id,
        novelId: s.novelId,
        status: s.status,
        chapterCount,
        hasScreenplay,
        hasImagePrompts,
        hasVideoPrompts,
        createdAt: s.createdAt,
      };
    });

    // 当前短剧的关联信息
    return NextResponse.json({
      success: true,
      data: {
        currentNovelId: drama.novelId,
        currentScriptId: drama.scriptId,
        novels: novelList,
        scripts: scriptList,
      },
    });
  } catch (error: any) {
    console.error('获取可关联资源失败:', error);
    return NextResponse.json({ error: error.message || '获取失败' }, { status: 500 });
  }
}
