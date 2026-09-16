import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { novelManager } from '@/storage/database';
import { autoCreateDramaForNovel } from '@/lib/auto-drama';

/**
 * POST /api/admin/sync-dramas
 * 批量为所有已有小说自动创建关联短剧（管理员接口，也支持普通用户同步自己的）
 */
export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const isAdmin = payload.role === 'admin';
    const syncAll = isAdmin && body.syncAll === true;

    let novels: any[] = [];

    if (syncAll) {
      // 管理员：同步所有用户的小说
      const result = await novelManager.getAllNovels({ limit: 5000 });
      novels = result.novels;
    } else {
      // 普通用户：只同步自己的小说
      const result = await novelManager.getUserNovels(payload.userId, { limit: 500 });
      novels = result.novels;
    }

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const novel of novels) {
      try {
        await autoCreateDramaForNovel(novel);
        created++;
      } catch (e: any) {
        // 如果已存在会跳过，这里只捕获真正的错误
        if (e.message?.includes('already') || e.message?.includes('UNIQUE')) {
          skipped++;
        } else {
          failed++;
          errors.push(`${novel.title}: ${e.message}`);
        }
      }
    }

    console.log(`[SyncDramas] 完成: 共${novels.length}部小说, 创建${created}, 跳过${skipped}, 失败${failed}`);

    return NextResponse.json({
      success: true,
      data: {
        totalNovels: novels.length,
        created,
        skipped,
        failed,
        errors: errors.slice(0, 10),
      },
    });
  } catch (error: any) {
    console.error('批量同步短剧失败:', error);
    return NextResponse.json({ error: error.message || '同步失败' }, { status: 500 });
  }
}
