import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { scriptManager } from '@/storage/database';
import { generateMedia } from '@/lib/media-gen';

/**
 * POST /api/novel/script/generate-image
 * 为某个分镜的 imagePrompt 生成实际图片，并把 imageUrl 保存到 script.chapters[i].imagePrompts[j].imageUrl
 */
export async function POST(request: NextRequest) {
  try {
    const auth = getUserFromToken(request.headers.get('Authorization') || '');
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const body = await request.json();
    const { scriptId, chapterIndex, sceneIndex, configId, prompt, negativePrompt, aspectRatio } = body || {};
    if (!scriptId || chapterIndex == null || sceneIndex == null || !configId) {
      return NextResponse.json({ error: '参数缺失' }, { status: 400 });
    }

    const script = await scriptManager.getScriptById(scriptId);
    if (!script || script.userId !== auth.userId) {
      return NextResponse.json({ error: '剧本不存在或无权访问' }, { status: 403 });
    }

    const chapters = Array.isArray(script.chapters) ? [...script.chapters] : [];
    const chapter = chapters[chapterIndex];
    if (!chapter) return NextResponse.json({ error: '章节不存在' }, { status: 400 });

    const imagePrompts: any[] = Array.isArray(chapter.imagePrompts) ? [...chapter.imagePrompts] : [];
    const idx = imagePrompts.findIndex(p => String(p.sceneIndex) === String(sceneIndex));
    if (idx < 0) return NextResponse.json({ error: '该场景没有图片提示词，请先生成提示词' }, { status: 400 });

    const promptText = (prompt && String(prompt).trim()) || imagePrompts[idx].prompt || '';
    if (!promptText) return NextResponse.json({ error: '提示词为空' }, { status: 400 });

    const result = await generateMedia(configId, {
      prompt: promptText,
      negativePrompt: negativePrompt ?? imagePrompts[idx].negativePrompt ?? '',
      aspectRatio: aspectRatio ?? imagePrompts[idx].aspectRatio ?? '1:1',
    });

    imagePrompts[idx] = {
      ...imagePrompts[idx],
      imageUrl: result.url,
      imageGeneratedAt: new Date().toISOString(),
    };
    chapters[chapterIndex] = { ...chapter, imagePrompts };
    await scriptManager.updateScript(scriptId, { chapters });

    return NextResponse.json({ success: true, data: { imageUrl: result.url } });
  } catch (e: any) {
    console.error('[generate-image] 失败:', e);
    return NextResponse.json({ error: e?.message || '生成图片失败' }, { status: 500 });
  }
}
