import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { scriptManager, novelManager, shortDramaManager, userManager } from '@/storage/database';

/**
 * GET /api/scripts — 获取所有剧本（管理员可看全部，普通用户看自己的）
 */
export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });

    const isAdmin = payload.role === 'admin';
    
    // 管理员可查看所有剧本，普通用户只看自己的
    const allScripts = isAdmin 
      ? await scriptManager.getAllScripts(500, 0)
      : await scriptManager.getScriptsByUserId(payload.userId, false);

    // 按 novelId 去重，只保留每个小说最新的剧本
    const novelScriptMap = new Map<string, any>();
    for (const s of allScripts) {
      const key = s.novelId || s.id;
      if (!novelScriptMap.has(key)) {
        novelScriptMap.set(key, s);
      }
      // allScripts 已按 createdAt DESC 排序，第一个就是最新的
    }
    const scripts = Array.from(novelScriptMap.values());

    // 附加小说标题和所有者信息
    const list: any[] = await Promise.all(scripts.map(async (s: any) => {
      let novelTitle = '';
      let novelChapterCount = 0;
      let novelCoverImage: string | null = null;
      let dramaId: string | null = null;
      let ownerName = '';
      try {
        if (s.novelId) {
          const novel = await novelManager.getById(s.novelId);
          novelTitle = novel?.title || '';
          novelCoverImage = novel?.coverImage || null;
          let nch: any = (novel as any)?.chapters;
          if (typeof nch === 'string') { try { nch = JSON.parse(nch); } catch { nch = []; } }
          if (Array.isArray(nch)) novelChapterCount = nch.filter(Boolean).length;
          // 管理员模式：获取小说所有者昵称
          if (isAdmin && novel?.userId) {
            const owner = await userManager.getUserById(novel.userId);
            ownerName = owner?.nickname || owner?.username || '';
          }
        }
      } catch (e) {
        console.warn(`[Scripts API] 获取小说标题失败 novelId=${s.novelId}:`, e);
      }
      try {
        if (s.novelId) {
          const dramas = await shortDramaManager.getDramasByNovelId(s.novelId);
          if (dramas.length > 0) dramaId = dramas[0].id;
        }
      } catch (e) {
        console.warn(`[Scripts API] 获取短剧关联失败 novelId=${s.novelId}:`, e);
      }
      const chapterCount = Array.isArray(s.chapters) ? s.chapters.length : 0;
      const generatedChapterCount = Array.isArray(s.chapters)
        ? s.chapters.filter((c: any) => c && c.screenplay && Array.isArray(c.screenplay.scenes) && c.screenplay.scenes.length > 0).length
        : 0;
      const hasScreenplay = Array.isArray(s.chapters) && s.chapters.some((c: any) => c.screenplay);
      const hasImagePrompts = Array.isArray(s.chapters) && s.chapters.some((c: any) => c.imagePrompts?.length > 0);
      const hasVideoPrompts = Array.isArray(s.chapters) && s.chapters.some((c: any) => c.videoPrompts?.length > 0);
      // 状态以「章节覆盖率」为准：只有该小说全部章节都生成了剧本才叫「已完成」
      let status = s.status;
      if (novelChapterCount > 0) {
        if (generatedChapterCount >= novelChapterCount) status = 'completed';
        else status = s.status === 'failed' ? 'failed' : (generatedChapterCount > 0 ? 'generating' : 'draft');
      }
      return {
        id: s.id,
        novelId: s.novelId,
        novelTitle,
        coverImage: novelCoverImage,
        dramaId,
        status,
        generatedChapterCount,
        chapterCount,
        novelChapterCount,
        hasScreenplay,
        hasImagePrompts,
        hasVideoPrompts,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        ...(isAdmin ? { ownerName } : {}),
      };
    }));

    // 合并「尚无剧本」的小说（标注为待生成，便于在剧本工作区直接开始改编）
    try {
      const existing = new Set(list.map((x: any) => x.novelId).filter(Boolean));
      const novelsResult = isAdmin
        ? await novelManager.getAllNovels({ limit: 500, offset: 0 })
        : await novelManager.getUserNovels(payload.userId, { limit: 500, offset: 0 });
      const novelList = (novelsResult && (novelsResult as any).novels) || [];
      for (const n of novelList as any[]) {
        if (!n || !n.id || existing.has(n.id)) continue;
        let nch: any = n.chapters;
        if (typeof nch === 'string') { try { nch = JSON.parse(nch); } catch { nch = []; } }
        const novelChapterCount = Array.isArray(nch) ? nch.filter(Boolean).length : 0;
        list.push({
          id: '',
          pending: true,
          novelId: n.id,
          novelTitle: n.title || '',
          coverImage: n.coverImage || null,
          dramaId: null,
          status: 'pending',
          generatedChapterCount: 0,
          chapterCount: 0,
          novelChapterCount,
          hasScreenplay: false,
          hasImagePrompts: false,
          hasVideoPrompts: false,
          createdAt: n.createdAt || null,
          updatedAt: n.updatedAt || null,
        });
      }
      const toTs = (v: any) => { const ts = Date.parse(String(v || '')); return Number.isFinite(ts) ? ts : 0; };
      list.sort((a: any, b: any) => toTs(b.updatedAt) - toTs(a.updatedAt));
    } catch (e) {
      console.warn('[Scripts API] 合并待生成小说失败:', e);
    }

    return NextResponse.json({ success: true, data: list });
  } catch (error: any) {
    console.error('获取剧本列表失败:', error);
    return NextResponse.json({ error: error.message || '获取失败' }, { status: 500 });
  }
}
