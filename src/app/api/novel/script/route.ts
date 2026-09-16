import { NextRequest } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { scriptManager, shortDramaManager } from '@/storage/database';

/**
 * GET /api/novel/script?novelId=xxx - 获取小说的剧本
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const payload = getUserFromToken(authHeader || '');
    if (!payload) {
      return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const { searchParams } = new URL(request.url);
    const novelId = searchParams.get('novelId');
    const scriptId = searchParams.get('scriptId');

    let script = null;
    const isAdmin = payload.role === 'admin';
    if (scriptId) {
      script = await scriptManager.getScriptById(scriptId);
    } else if (novelId) {
      script = await scriptManager.getScriptByNovelId(novelId, payload.userId, isAdmin);
    }

    if (!script) {
      return new Response(JSON.stringify({ success: true, data: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (script.userId !== payload.userId && script.userId !== '' && !isAdmin) {
      return new Response(JSON.stringify({ error: '无权访问' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: true, data: script }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : '服务器错误';
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * PUT /api/novel/script - 更新剧本
 * Body: { scriptId, chapters } or { scriptId, chapterIndex, field, value }
 */
export async function PUT(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const payload = getUserFromToken(authHeader || '');
    if (!payload) {
      return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const body = await request.json();
    const { scriptId, chapters, chapterIndex, field, value } = body;

    if (!scriptId) {
      return new Response(JSON.stringify({ error: '缺少scriptId' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const script = await scriptManager.getScriptById(scriptId);
    const isAdmin = payload.role === 'admin';
    if (!script || (script.userId !== payload.userId && !isAdmin)) {
      return new Response(JSON.stringify({ error: '剧本不存在或无权访问' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    let updated;
    if (chapterIndex !== undefined && field && value !== undefined) {
      // 更新单章某个字段
      updated = await scriptManager.updateChapterField(scriptId, chapterIndex, field, value);
    } else if (chapters) {
      // 更新整个chapters
      updated = await scriptManager.updateScript(scriptId, { chapters });
    } else {
      return new Response(JSON.stringify({ error: '缺少更新参数' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // 异步1：同步 scriptId 到关联短剧
    if (script.novelId) {
      shortDramaManager.getDramasByNovelId(script.novelId).then(dramas => {
        for (const d of dramas) {
          if (!d.scriptId || d.scriptId !== scriptId) {
            shortDramaManager.update(d.id, { scriptId } as any).catch(() => {});
          }
        }
      }).catch(() => {});
    }

    // 异步2：若更新了某章节 screenplay/scenes，同步到所有关联短剧的对应分集
    if (chapterIndex !== undefined) {
      (async () => {
        try {
          // 查找所有关联该剧本的短剧（按 scriptId 或 novelId）
          const [byScript, byNovel] = await Promise.all([
            shortDramaManager.getDramasByScriptId(scriptId),
            script.novelId ? shortDramaManager.getDramasByNovelId(script.novelId) : Promise.resolve([]),
          ]);
          const dramaMap = new Map<string, typeof byScript[0]>();
          [...byScript, ...byNovel].forEach(d => dramaMap.set(d.id, d));

          // 获取最新章节数据
          const freshScript = await scriptManager.getScriptById(scriptId);
          const chapter = freshScript?.chapters?.[chapterIndex];
          if (!chapter) return;

          const screenplayStr = chapter.screenplay
            ? (typeof chapter.screenplay === 'string' ? chapter.screenplay : JSON.stringify(chapter.screenplay))
            : null;
          const chapterTitle: string | null = (chapter as any).title || (chapter as any).chapterTitle || null;

          for (const drama of dramaMap.values()) {
            if (!drama.scriptId) continue;
            const episodes = await shortDramaManager.getEpisodesByDramaId(drama.id);
            for (const ep of episodes) {
              if (ep.sourceScriptChapterIndex === chapterIndex) {
                await shortDramaManager.updateEpisode(ep.id, {
                  screenplay: screenplayStr ?? undefined,
                  ...(chapterTitle && !ep.title ? { title: chapterTitle } : {}),
                } as any);
              }
            }
          }
        } catch (e) {
          console.error('[script-PUT] episode sync failed:', e);
        }
      })();
    }

    return new Response(JSON.stringify({ success: true, data: updated }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : '服务器错误';
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * DELETE /api/novel/script?scriptId=xxx - 删除剧本
 */
export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const payload = getUserFromToken(authHeader || '');
    if (!payload) {
      return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const { searchParams } = new URL(request.url);
    const scriptId = searchParams.get('scriptId');

    if (!scriptId) {
      return new Response(JSON.stringify({ error: '缺少scriptId' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const script = await scriptManager.getScriptById(scriptId);
    const isAdmin = payload.role === 'admin';
    if (!script || (script.userId !== payload.userId && !isAdmin)) {
      return new Response(JSON.stringify({ error: '剧本不存在或无权访问' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    await scriptManager.deleteScript(scriptId);
    return new Response(JSON.stringify({ success: true, message: '剧本已删除' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : '服务器错误';
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
