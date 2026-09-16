import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { shortDramaManager, dramaWorkflowManager, novelManager, novelDetailManager, scriptManager } from '@/storage/database';
import { expandCharacterRelationshipRows } from '@/lib/character-relationships';
import { normalizeEpisodeSourceFields } from '@/lib/episode-source';
import { buildEpisodeSynopsis } from '@/lib/episode-summary';

/**
 * GET /api/short-dramas/[id] — 获取短剧详情（含分集、角色、分镜统计 + 关联小说/剧本全部数据）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });

    const { id } = await params;
    const result = await shortDramaManager.getDramaWithEpisodes(id);
    if (!result || result.drama.userId !== payload.userId) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }

    const characters = await dramaWorkflowManager.getCharactersByDramaId(id);
    const scenes = await dramaWorkflowManager.getScenesByDramaId(id);
    const items = await dramaWorkflowManager.getItemsByDramaId(id);
    const shots = await dramaWorkflowManager.getShotsByDramaId(id);
    const assets = await dramaWorkflowManager.getAssetsByDramaId(id);
    const tasks = await dramaWorkflowManager.getTasksByDramaId(id);

    // ====== 关联小说数据 ======
    let novelData: any = null;
    if (result.drama.novelId) {
      const novel = await novelManager.getById(result.drama.novelId);
      if (novel) {
        let details = await novelDetailManager.getNovelDetails(novel.id);
        
        const relationshipRows = details.relationships || [];
        const expandedRelationships = expandCharacterRelationshipRows(relationshipRows);
        const relationshipsNeedResync = relationshipRows.length === 0 || expandedRelationships.length > relationshipRows.length;

        // 自动同步：如果 relationships 为空或还是旧版合并数据，就从 idea 重新解析写入
        if (relationshipsNeedResync && novel.idea) {
          try {
            const { syncNovelDetails } = await import('@/lib/novel-detail-sync');
            await syncNovelDetails(novel.id, novel.userId, {
              idea: novel.idea,
              structure: novel.structure,
              protagonist: novel.protagonist,
            });
            details = await novelDetailManager.getNovelDetails(novel.id);
          } catch (e) {
            console.warn('[Short Drama API] Auto-sync relationships failed:', e);
          }
        }
        const finalRelationships = expandCharacterRelationshipRows(details?.relationships || []);
        let chapters: any[] = [];
        try {
          chapters = novel.chapters ? (typeof novel.chapters === 'string' ? JSON.parse(novel.chapters) : novel.chapters) : [];
        } catch {}
        let structure: any = null;
        try {
          structure = novel.structure ? (typeof novel.structure === 'string' ? JSON.parse(novel.structure) : novel.structure) : null;
        } catch {}

        novelData = {
          id: novel.id,
          title: novel.title,
          description: novel.description,
          category: novel.category,
          genderTarget: novel.genderTarget,
          tone: novel.tone,
          protagonist: novel.protagonist,
          totalChapters: novel.totalChapters,
          currentChapters: novel.currentChapters,
          status: novel.status,
          structure,
          chapters: chapters.map((ch: any, i: number) => ({
            index: ch.index ?? i + 1,
            title: ch.title || `第${i + 1}章`,
            wordCount: ch.content?.length || 0,
            content: ch.content || '',
          })),
          // 结构化子表数据
          characters: details?.characters || [],
          scenes: details?.scenes || [],
          items: details?.items || [],
          plot: details?.plot || null,
          chapterHooks: details?.hooks || [],
          characterRelationships: finalRelationships,
        };
      }
    }

    // ====== 关联剧本数据 ======
    let scriptData: any = null;
    let linkedScriptChapters: any[] = [];
    const scriptId = result.drama.scriptId;
    if (scriptId) {
      const script = await scriptManager.getScriptById(scriptId);
      if (script) {
        const chapters = Array.isArray(script.chapters) ? script.chapters : [];
        linkedScriptChapters = chapters;
        scriptData = {
          id: script.id,
          novelId: script.novelId,
          status: script.status,
          createdAt: script.createdAt,
          chapters: chapters.map((ch: any, i: number) => ({
            index: i,
            title: ch.title || ch.chapterTitle || `第${i + 1}章`,
            hasScreenplay: !!ch.screenplay,
            screenplay: ch.screenplay || null,
            scenes: ch.scenes || [],
            imagePrompts: ch.imagePrompts || [],
            videoPrompts: ch.videoPrompts || [],
          })),
        };
      }
    } else if (result.drama.novelId) {
      // 自动查找该小说的剧本
      const script = await scriptManager.getScriptByNovelId(result.drama.novelId, payload.userId);
      if (script) {
        const chapters = Array.isArray(script.chapters) ? script.chapters : [];
        linkedScriptChapters = chapters;
        scriptData = {
          id: script.id,
          novelId: script.novelId,
          status: script.status,
          createdAt: script.createdAt,
          chapters: chapters.map((ch: any, i: number) => ({
            index: i,
            title: ch.title || ch.chapterTitle || `第${i + 1}章`,
            hasScreenplay: !!ch.screenplay,
            screenplay: ch.screenplay || null,
            scenes: ch.scenes || [],
            imagePrompts: ch.imagePrompts || [],
            videoPrompts: ch.videoPrompts || [],
          })),
        };
      }
    }

    const normalizedEpisodes = result.episodes.map(ep => {
      const normalized = normalizeEpisodeSourceFields(ep, linkedScriptChapters);
      const scriptChapter = normalized.sourceScriptChapterIndex != null
        ? linkedScriptChapters[normalized.sourceScriptChapterIndex]
        : null;
      const novelChapter = normalized.sourceChapter != null
        ? novelData?.chapters?.find((ch: any) => ch.index === normalized.sourceChapter) || novelData?.chapters?.[normalized.sourceChapter - 1]
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
        shotCount: shots.length,
        assetCount: assets.length,
        pendingTasks: tasks.filter(t => t.status === 'pending' || t.status === 'running').length,
        // 关联数据
        novel: novelData,
        script: scriptData,
      },
    });
  } catch (error) {
    console.error('获取短剧详情失败:', error);
    return NextResponse.json({ error: '获取短剧详情失败' }, { status: 500 });
  }
}

/**
 * PUT /api/short-dramas/[id] — 更新短剧
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });

    const { id } = await params;
    const existing = await shortDramaManager.getById(id);
    if (!existing || existing.userId !== payload.userId) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }

    const body = await request.json();
    const updated = await shortDramaManager.update(id, body);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('更新短剧失败:', error);
    return NextResponse.json({ error: '更新短剧失败' }, { status: 500 });
  }
}

/**
 * DELETE /api/short-dramas/[id] — 删除短剧
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });

    const { id } = await params;
    const existing = await shortDramaManager.getById(id);
    if (!existing || existing.userId !== payload.userId) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }

    await shortDramaManager.delete(id);
    return NextResponse.json({ success: true, message: '短剧已删除' });
  } catch (error) {
    console.error('删除短剧失败:', error);
    return NextResponse.json({ error: '删除短剧失败' }, { status: 500 });
  }
}
