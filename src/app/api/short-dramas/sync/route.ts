import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { novelManager, shortDramaManager } from '@/storage/database';
import { autoCreateDramaForNovel } from '@/lib/auto-drama';

/**
 * POST /api/short-dramas/sync
 * 为当前用户的所有小说自动创建关联短剧
 */
export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });

    // 获取当前用户的所有小说
    const result = await novelManager.getUserNovels(payload.userId, { limit: 500 });
    const novels = result.novels;

    let created = 0;
    let existed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const novel of novels) {
      try {
        // autoCreateDramaForNovel 内部会检查是否已存在
        const existing = await shortDramaManager.getDramasByNovelId(novel.id);
        
        await autoCreateDramaForNovel(novel);
        
        if (existing.length > 0) {
          existed++;
        } else {
          created++;
        }
      } catch (e: any) {
        failed++;
        errors.push(`${novel.title}: ${e.message}`);
        console.error(`[SyncDrama] 小说"${novel.title}" 同步失败:`, e.message);
      }
    }

    console.log(`[SyncDramas] 用户${payload.userId}: 共${novels.length}部小说, 新建${created}, 已有${existed}, 失败${failed}`);

    return NextResponse.json({
      success: true,
      data: {
        totalNovels: novels.length,
        created,
        existed,
        failed,
        errors: errors.slice(0, 10),
      },
    });
  } catch (error: any) {
    console.error('同步短剧失败:', error);
    return NextResponse.json({ error: error.message || '同步失败' }, { status: 500 });
  }
}
