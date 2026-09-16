import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { shortDramaManager, scriptManager } from '@/storage/database';
import { normalizeEpisodeSourceFields } from '@/lib/episode-source';
import { buildEpisodeSynopsis } from '@/lib/episode-summary';

/**
 * GET /api/short-dramas/[id]/episodes — 获取分集列表
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id } = await params;
    const drama = await shortDramaManager.getById(id);
    if (!drama || drama.userId !== payload.userId) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }
    const episodes = await shortDramaManager.getEpisodesByDramaId(id);
    let scriptChapters: any[] = [];
    if (drama.scriptId) {
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
 * POST /api/short-dramas/[id]/episodes — 添加分集
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id } = await params;
    const drama = await shortDramaManager.getById(id);
    if (!drama || drama.userId !== payload.userId) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }
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
    });
    return NextResponse.json({ success: true, data: episode, message: '分集创建成功' });
  } catch (error) {
    console.error('创建分集失败:', error);
    return NextResponse.json({ error: '创建分集失败' }, { status: 500 });
  }
}

/**
 * PUT /api/short-dramas/[id]/episodes — 更新分集 (body: { episodeId, title, synopsis, screenplay, status, duration })
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id } = await params;
    const drama = await shortDramaManager.getById(id);
    if (!drama || drama.userId !== payload.userId) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }
    const body = await request.json();
    const { episodeId, ...fields } = body;
    if (!episodeId) return NextResponse.json({ error: '缺少分集ID' }, { status: 400 });
    const updated = await shortDramaManager.updateEpisode(episodeId, {
      title: fields.title ?? undefined,
      synopsis: fields.synopsis ?? undefined,
      screenplay: fields.screenplay ?? undefined,
      status: fields.status ?? undefined,
      duration: fields.duration ?? undefined,
    });
    if (!updated) return NextResponse.json({ error: '分集不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data: updated, message: '分集更新成功' });
  } catch (error) {
    console.error('更新分集失败:', error);
    return NextResponse.json({ error: '更新分集失败' }, { status: 500 });
  }
}

/**
 * DELETE /api/short-dramas/[id]/episodes — 删除分集（body: { episodeId })
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { id } = await params;
    const drama = await shortDramaManager.getById(id);
    if (!drama || drama.userId !== payload.userId) {
      return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    }
    const { episodeId } = await request.json();
    if (!episodeId) return NextResponse.json({ error: '缺少分集ID' }, { status: 400 });
    const deleted = await shortDramaManager.deleteEpisode(episodeId);
    if (!deleted) return NextResponse.json({ error: '分集不存在' }, { status: 404 });
    return NextResponse.json({ success: true, message: '分集已删除' });
  } catch (error) {
    console.error('删除分集失败:', error);
    return NextResponse.json({ error: '删除分集失败' }, { status: 500 });
  }
}
