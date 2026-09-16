import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { userManager, memberLevelManager, novelManager } from '@/storage/database';
import { getDb } from '@/storage/database/sqlite';
import { novels, memberLevels as memberLevelsTable } from '@/storage/database/shared/schema';
import { eq, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    // 检查管理员权限
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

    // 获取所有用户
    const allUsers = await userManager.getAllUsers();
    let filteredUsers = allUsers;

    // 搜索过滤
    if (search) {
      const searchLower = search.toLowerCase();
      filteredUsers = filteredUsers.filter((u: { username: string; email: string }) =>
        u.username.toLowerCase().includes(searchLower) ||
        u.email.toLowerCase().includes(searchLower)
      );
    }

    // 分页
    const offset = (page - 1) * limit;
    const paginatedUsers = filteredUsers.slice(offset, offset + limit);

    // 获取会员等级信息
    const levels = await memberLevelManager.getAll();
    const levelsMap = new Map(levels.map((l: { id: string; name: string; code: string; chapterLimit?: number }) => [l.id, l]));

    // 批量获取所有用户的章节使用数
    const db = await getDb();
    const chapterStats = await db
      .select({
        userId: novels.userId,
        total: sql<number>`COALESCE(SUM(${novels.currentChapters}), 0)`,
      })
      .from(novels)
      .groupBy(novels.userId);
    const chapterMap = new Map(chapterStats.map((r) => [r.userId, Number(r.total)]));

    const membersWithLevel = paginatedUsers.map((user: { memberLevelId: string | null; chapterLimit?: number | null; id: string }) => {
      const level = user.memberLevelId ? levelsMap.get(user.memberLevelId) : null;
      // 计算有效章节上限：用户单独设置 > 会员等级默认 > 11
      const rawChapterLimit = user.chapterLimit;
      const effectiveLimit = rawChapterLimit === 0 ? 99999 : (rawChapterLimit ?? level?.chapterLimit ?? 11);
      const totalChaptersUsed = chapterMap.get(user.id) || 0;
      return {
        ...user,
        memberLevelName: level?.name || '免费用户',
        memberLevelCode: level?.code || null,
        _originalChapterLimit: rawChapterLimit,
        chapterLimit: effectiveLimit,
        totalChaptersUsed,
        remainingChapters: rawChapterLimit === 0 ? 99999 : Math.max(0, effectiveLimit - totalChaptersUsed),
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        members: membersWithLevel,
        pagination: {
          page,
          limit,
          total: filteredUsers.length,
          totalPages: Math.ceil(filteredUsers.length / limit),
        },
      },
    });
  } catch (error) {
    console.error('获取会员列表失败:', error);
    return NextResponse.json({ error: '获取会员列表失败' }, { status: 500 });
  }
}
