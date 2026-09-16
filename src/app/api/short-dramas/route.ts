import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { shortDramaManager, novelManager } from '@/storage/database';

/**
 * GET /api/short-dramas — 获取当前用户的短剧列表
 */
export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });

    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status') || undefined;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    const { dramas, total } = await shortDramaManager.getUserDramas(payload.userId, {
      status, limit, offset: (page - 1) * limit,
    });

    // 附带关联小说标题
    const dramasWithNovelInfo = await Promise.all(dramas.map(async (d) => {
      let novelTitle: string | null = null;
      let novelCoverImage: string | null = null;
      if (d.novelId) {
        const novel = await novelManager.getById(d.novelId);
        novelTitle = novel?.title || null;
        novelCoverImage = (novel as any)?.coverImage || null;
      }
      return { ...d, novelTitle, novelCoverImage };
    }));

    return NextResponse.json({ success: true, data: { dramas: dramasWithNovelInfo, total } });
  } catch (error) {
    console.error('获取短剧列表失败:', error);
    return NextResponse.json({ error: '获取短剧列表失败' }, { status: 500 });
  }
}

/**
 * POST /api/short-dramas — 创建短剧（可从小说转换）
 */
export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });

    const body = await request.json();

    // 如果指定了 novelId，从小说获取基本信息
    let title = body.title;
    let description = body.description;
    if (body.novelId) {
      const novel = await novelManager.getById(body.novelId);
      if (novel && novel.userId === payload.userId) {
        title = title || `${novel.title} — 短剧版`;
        description = description || novel.description;
      }
    }

    if (!title) {
      return NextResponse.json({ error: '请提供短剧标题' }, { status: 400 });
    }

    const drama = await shortDramaManager.create({
      userId: payload.userId,
      novelId: body.novelId || null,
      title,
      description: description || null,
      genre: body.genre || null,
      targetAudience: body.targetAudience || null,
      totalEpisodes: body.totalEpisodes || 0,
      episodeDuration: body.episodeDuration || 60,
      status: 'draft',
      tags: body.tags || null,
      style: body.style || null,
      platform: body.platform || null,
    });

    return NextResponse.json({ success: true, data: drama, message: '短剧创建成功' });
  } catch (error) {
    console.error('创建短剧失败:', error);
    return NextResponse.json({ error: '创建短剧失败' }, { status: 500 });
  }
}
