import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { userManager, memberLevelManager, novelManager } from '@/storage/database';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);

    if (!payload) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const user = await userManager.getUserById(payload.userId);
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    // 获取会员等级信息
    let levelChapterLimit = 11; // 默认免费用户11章
    let storageLimit = 50; // 默认免费用户50部小说
    let memberLevelName = '免费用户';
    let memberLevelCode = null;

    if (user.memberLevelId) {
      const level = await memberLevelManager.getById(user.memberLevelId);
      if (level) {
        levelChapterLimit = level.chapterLimit || 11;
        memberLevelName = level.name;
        memberLevelCode = level.code;
        // 从 features 中提取 storageLimit
        if (level.features) {
          const features = typeof level.features === 'string'
            ? JSON.parse(level.features)
            : level.features;
          if (features.storageLimit !== undefined) {
            storageLimit = features.storageLimit;
          }
        }
      }
    }

    // 管理员无存储限制
    if (payload.role === 'admin') {
      storageLimit = -1;
    }

    // 用户自定义的章节上限优先于等级默认值
    const userChapterLimit = user.chapterLimit !== null && user.chapterLimit !== undefined
      ? user.chapterLimit
      : levelChapterLimit;

    // 统计用户所有小说已生成的章节总数
    const totalChaptersUsed = await novelManager.getUserTotalChapters(payload.userId);
    // 统计用户小说数量
    const novelCount = await novelManager.getUserNovelCount(payload.userId);
    // chapterLimit === 0 表示无限制
    const remainingChapters = userChapterLimit === 0 ? 99999 : Math.max(0, userChapterLimit - totalChaptersUsed);

    return NextResponse.json({
      success: true,
      data: {
        chapterLimit: userChapterLimit,
        levelChapterLimit: levelChapterLimit,
        totalChaptersUsed,
        remainingChapters,
        storageLimit,
        novelCount,
        remainingNovels: storageLimit === -1 ? 99999 : Math.max(0, storageLimit - novelCount),
        memberLevelName,
        memberLevelCode,
        hasCustomLimit: user.chapterLimit !== null && user.chapterLimit !== undefined,
      },
    });
  } catch (error) {
    console.error('获取章节限制失败:', error);
    return NextResponse.json({ error: '获取章节限制失败' }, { status: 500 });
  }
}
