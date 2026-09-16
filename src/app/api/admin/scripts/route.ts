import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { scriptManager, novelManager, userManager, shortDramaManager } from '@/storage/database';

/**
 * GET /api/admin/scripts - 获取剧本列表（管理员）
 * 支持 page / limit / search / status / sort / order，返回统一分页信息。
 * 注：剧本没有标题，搜索目标是「关联小说标题 / 所属用户」，因此先过滤再分页。
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    if (payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const novelId = searchParams.get('novelId');
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const sort = searchParams.get('sort') || 'updatedAt';
    const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20));

    // 1. 取全部剧本（单表数据量有限）
    let scripts: any[] = [];
    try {
      if (novelId) {
        const result = await scriptManager.getScriptByNovelIdAdmin(novelId);
        scripts = Array.isArray(result) ? result : result ? [result] : [];
      } else {
        scripts = await scriptManager.getAllScripts(2000);
      }
    } catch (e: any) {
      console.error('[Admin Scripts] 获取剧本失败:', e);
      return NextResponse.json({ error: '查询剧本数据库失败: ' + (e?.message || '未知错误') }, { status: 500 });
    }

    // 2. 状态过滤
    if (status) scripts = scripts.filter((s: any) => s.status === status);

    // 3. 用户 / 小说映射
    let userMap = new Map<string, any>();
    try {
      const allUsers = await userManager.getAllUsers();
      userMap = new Map(allUsers.map((u: any) => [u.id, u]));
    } catch (e) {
      console.warn('[Admin Scripts] 加载用户列表失败:', e);
    }

    const novelMap = new Map<string, any>();
    const novelIds = [...new Set(scripts.map((s: any) => s.novelId).filter(Boolean))];
    for (const nid of novelIds as string[]) {
      try {
        const novel = await novelManager.getById(nid);
        if (novel) novelMap.set(nid, novel);
      } catch (e) {
        console.warn('[Admin Scripts] 加载小说失败 novelId=' + nid + ':', e);
      }
    }

    // 4. 组装
    let enriched = scripts.map((script: any) => {
      const novel = novelMap.get(script.novelId);
      const user = novel ? userMap.get(novel.userId) : userMap.get(script.userId);
      const chapterCount = Array.isArray(script.chapters)
        ? script.chapters.length
        : (() => { try { const p = JSON.parse(script.chapters || '[]'); return Array.isArray(p) ? p.length : 0; } catch { return 0; } })();
      return {
        ...script,
        chapterCount,
        novelTitle: novel?.title || '未知小说',
        userName: (user as any)?.nickname || (user as any)?.username || (user as any)?.email || '未知用户',
        dramaId: null as string | null,
      };
    });

    // 5. 关键词搜索（小说标题 / 用户名）
    if (search) {
      const kw = search.toLowerCase();
      enriched = enriched.filter((s: any) =>
        (s.novelTitle || '').toLowerCase().includes(kw) ||
        (s.userName || '').toLowerCase().includes(kw)
      );
    }

    // 6. 排序
    const dir = order === 'asc' ? 1 : -1;
    enriched.sort((a: any, b: any) => {
      let va: any; let vb: any;
      switch (sort) {
        case 'novelTitle': va = a.novelTitle || ''; vb = b.novelTitle || ''; break;
        case 'userName': va = a.userName || ''; vb = b.userName || ''; break;
        case 'chapterCount': va = a.chapterCount || 0; vb = b.chapterCount || 0; break;
        case 'status': va = a.status || ''; vb = b.status || ''; break;
        case 'createdAt': va = a.createdAt || ''; vb = b.createdAt || ''; break;
        default: va = a.updatedAt || a.createdAt || ''; vb = b.updatedAt || b.createdAt || '';
      }
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'zh-Hans-CN') * dir;
    });

    // 7. 分页
    const total = enriched.length;
    const start = (page - 1) * limit;
    const pageItems = enriched.slice(start, start + limit);

    // 8. 关联短剧（仅当前页，避免全量 N+1）
    try {
      await Promise.all(pageItems.map(async (s: any) => {
        if (!s.novelId) return;
        try {
          const dramas = await shortDramaManager.getDramasByNovelId(s.novelId);
          if (dramas.length > 0) s.dramaId = dramas[0].id;
        } catch { /* 忽略 */ }
      }));
    } catch { /* 忽略 */ }

    return NextResponse.json({
      success: true,
      data: {
        scripts: pageItems,
        total,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      },
    });
  } catch (error: any) {
    console.error('Admin get scripts error:', error);
    return NextResponse.json({ error: '获取剧本列表失败: ' + (error?.message || '未知错误') }, { status: 500 });
  }
}
