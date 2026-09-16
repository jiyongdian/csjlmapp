import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { shortDramaManager, userManager, novelManager } from '@/storage/database';

/**
 * GET /api/admin/short-dramas — 获取所有短剧列表
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const sort = searchParams.get('sort') || '';
    const order = searchParams.get('order') || '';

    const { dramas, total } = await shortDramaManager.getAllDramas({
      search: search || undefined,
      status: status || undefined,
      limit,
      offset: (page - 1) * limit,
      sort: sort || undefined,
      order: order || undefined,
    });

    let userMap = new Map<string, any>();
    try {
      const allUsers = await userManager.getAllUsers();
      userMap = new Map(allUsers.map((u: any) => [u.id, u]));
    } catch (e) {
      console.warn('[Admin Short-Dramas] 查询用户列表失败:', e);
    }

    const dramasWithOwner = await Promise.all(dramas.map(async d => {
      const owner = userMap.get(d.userId);
      let novelTitle: string | null = null;
      try {
        if (d.novelId) {
          const novel = await novelManager.getById(d.novelId);
          novelTitle = (novel as any)?.title || null;
        }
      } catch (e) {
        console.warn(`[Admin Short-Dramas] 查询小说失败 novelId=${d.novelId}:`, e);
      }
      return {
        ...d,
        ownerName: (owner as any)?.nickname || (owner as any)?.username || (owner as any)?.email || '未知用户',
        ownerEmail: (owner as any)?.email || '',
        novelTitle,
      };
    }));

    return NextResponse.json({
      success: true,
      data: {
        dramas: dramasWithOwner,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error: any) {
    console.error('获取短剧列表失败:', error);
    return NextResponse.json({ error: '获取短剧列表失败: ' + (error?.message || '未知错误') }, { status: 500 });
  }
}

/**
 * POST /api/admin/short-dramas — 创建短剧（管理员从小说转换）
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const body = await request.json();
    const drama = await shortDramaManager.create({
      userId: body.userId || payload.userId,
      novelId: body.novelId || null,
      title: body.title,
      description: body.description || null,
      genre: body.genre || null,
      targetAudience: body.targetAudience || null,
      totalEpisodes: body.totalEpisodes || 0,
      episodeDuration: body.episodeDuration || 60,
      status: body.status || 'draft',
      coverImage: body.coverImage || null,
      tags: body.tags || null,
      style: body.style || null,
      platform: body.platform || null,
    } as any);

    return NextResponse.json({ success: true, data: drama, message: '短剧创建成功' });
  } catch (error) {
    console.error('创建短剧失败:', error);
    return NextResponse.json({ error: '创建短剧失败' }, { status: 500 });
  }
}
