import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { scriptManager } from '@/storage/database';
import { generateMedia } from '@/lib/media-gen';

/**
 * POST /api/novel/script/generate-video
 * 为某个视频镜头生成实际视频，并把 videoUrl 保存到对应 videoPrompt
 * 视频提示词以 sceneIndex + subShotIndex 唯一标识
 */
export async function POST(request: NextRequest) {
  try {
    const auth = getUserFromToken(request.headers.get('Authorization') || '');
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const body = await request.json();
    const { scriptId, chapterIndex, sceneIndex, subShotIndex, configId, prompt, aspectRatio } = body || {};
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

    const videoPrompts: any[] = Array.isArray(chapter.videoPrompts) ? [...chapter.videoPrompts] : [];
    const matchSub = subShotIndex != null;
    const idx = videoPrompts.findIndex(p =>
      String(p.sceneIndex) === String(sceneIndex)
      && (!matchSub || String(p.subShotIndex ?? p.subShot ?? 1) === String(subShotIndex))
    );
    if (idx < 0) return NextResponse.json({ error: '未找到对应的视频提示词' }, { status: 400 });

    const target = videoPrompts[idx];
    const promptText = (prompt && String(prompt).trim()) || target.prompt || '';
    if (!promptText) return NextResponse.json({ error: '提示词为空' }, { status: 400 });

    const result = await generateMedia(configId, {
      prompt: promptText,
      aspectRatio: aspectRatio ?? target.aspectRatio ?? '16:9',
    });

    videoPrompts[idx] = {
      ...target,
      videoUrl: result.url,
      videoGeneratedAt: new Date().toISOString(),
    };
    chapters[chapterIndex] = { ...chapter, videoPrompts };
    await scriptManager.updateScript(scriptId, { chapters });

    return NextResponse.json({ success: true, data: { videoUrl: result.url } });
  } catch (e: any) {
    console.error('[generate-video] 失败:', e);
    return NextResponse.json({ error: e?.message || '生成视频失败' }, { status: 500 });
  }
}
