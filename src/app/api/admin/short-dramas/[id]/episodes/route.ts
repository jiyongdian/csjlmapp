import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { shortDramaManager, scriptManager } from '@/storage/database';
import { normalizeEpisodeSourceFields } from '@/lib/episode-source';
import { buildEpisodeSynopsis } from '@/lib/episode-summary';

/**
 * GET /api/admin/short-dramas/[id]/episodes — 获取短剧分集列表
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const { id } = await params;
    const drama = await shortDramaManager.getById(id);
    const episodes = await shortDramaManager.getEpisodesByDramaId(id);
    let scriptChapters: any[] = [];
    if (drama?.scriptId) {
      const script = await scriptManager.getScriptById(drama.scriptId);
      scriptChapters = Array.isArray(script?.chapters) ? script.chapters : [];
    }

    return NextResponse.json({
      success: true,
      data: episodes.map(ep => {
        const normalized = normalizeEpisodeSourceFields(ep, scriptChapters);
        const scriptChapter = normalized.sourceScriptChapterIndex != null ? scriptChapters[normalized.sourceScriptChapterIndex] : null;
        return {
          ...normalized,
          synopsis: buildEpisodeSynopsis({
            synopsis: normalized.synopsis,
            screenplay: normalized.screenplay || scriptChapter?.screenplay,
            scriptChapter,
          }) || normalized.synopsis,
        };
      }),
    });
  } catch (error) {
    console.error('获取分集列表失败:', error);
    return NextResponse.json({ error: '获取分集列表失败' }, { status: 500 });
  }
}

/**
 * POST /api/admin/short-dramas/[id]/episodes — 添加分集
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const episode = await shortDramaManager.createEpisode({
      dramaId: id,
      userId: payload.userId,
      episodeNumber: body.episodeNumber,
      title: body.title || null,
      synopsis: body.synopsis || null,
      screenplay: body.screenplay || null,
      scenes: body.scenes ? (typeof body.scenes === 'string' ? body.scenes : JSON.stringify(body.scenes)) : null,
      dialogues: body.dialogues ? (typeof body.dialogues === 'string' ? body.dialogues : JSON.stringify(body.dialogues)) : null,
      directions: body.directions || null,
      imagePrompts: body.imagePrompts ? (typeof body.imagePrompts === 'string' ? body.imagePrompts : JSON.stringify(body.imagePrompts)) : null,
      videoPrompts: body.videoPrompts ? (typeof body.videoPrompts === 'string' ? body.videoPrompts : JSON.stringify(body.videoPrompts)) : null,
      duration: body.duration || null,
      status: body.status || 'draft',
      sourceChapter: body.sourceChapter ?? null,
    } as any);

    return NextResponse.json({ success: true, data: episode, message: '分集创建成功' });
  } catch (error) {
    console.error('创建分集失败:', error);
    return NextResponse.json({ error: '创建分集失败' }, { status: 500 });
  }
}
