import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { novelManager, userManager, scriptManager, shortDramaManager, projectManager } from '@/storage/database';

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
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const sort = searchParams.get('sort') || '';
    const order = searchParams.get('order') || '';

    // 获取所有小说
    let novelList: any[] = [];
    let total = 0;
    try {
      const result = await novelManager.getAllNovels({
        search: search || undefined,
        status: status || undefined,
        limit,
        offset: (page - 1) * limit,
        sort: sort || undefined,
        order: order || undefined,
      });
      novelList = result.novels;
      total = result.total;
    } catch (e: any) {
      console.error('[Admin Novels] 获取小说列表失败:', e);
      return NextResponse.json({ error: '查询小说数据库失败: ' + (e?.message || '未知错误') }, { status: 500 });
    }
    console.log(`[Admin Novels] 查到 ${novelList.length} 部小说 (总计 ${total})`);

    // 获取所有用户信息
    let userMap = new Map<string, any>();
    try {
      const allUsers = await userManager.getAllUsers();
      userMap = new Map(allUsers.map((u: any) => [u.id, u]));
    } catch (e) {
      console.warn('[Admin Novels] 加载用户列表失败:', e);
    }

    const novelsWithOwner = await Promise.all(novelList.map(async (novel: any) => {
      const owner = userMap.get(novel.userId);
      let scriptId: string | null = null;
      let dramaId: string | null = null;
      let projectId: number | null = null;
      try {
        const script = await scriptManager.getScriptByNovelId(novel.id, novel.userId);
        if (script) scriptId = script.id;
      } catch (e) {
        console.warn(`[Admin Novels] 查询剧本失败 novelId=${novel.id}:`, e);
      }
      try {
        const dramas = await shortDramaManager.getDramasByNovelId(novel.id);
        if (dramas.length > 0) dramaId = dramas[0].id;
      } catch (e) {
        console.warn(`[Admin Novels] 查询短剧失败 novelId=${novel.id}:`, e);
      }
      try {
        const project = await projectManager.getByNovelId(novel.id);
        if (project) projectId = project.id;
      } catch (e) {
        console.warn(`[Admin Novels] 查询项目失败 novelId=${novel.id}:`, e);
      }
      return {
        ...novel,
        ownerName: owner?.username || owner?.nickname || '未知用户',
        ownerEmail: owner?.email || '',
        scriptId,
        dramaId,
        projectId,
      };
    }));

    return NextResponse.json({
      success: true,
      data: {
        novels: novelsWithOwner,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error('获取小说列表失败:', error);
    const detail = process.env.NODE_ENV === 'development' ? (error?.message || String(error)) : undefined;
    return NextResponse.json({ error: '获取小说列表失败', detail }, { status: 500 });
  }
}