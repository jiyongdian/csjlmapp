import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { shortDramaManager, dramaWorkflowManager } from '@/storage/database';
import { scriptManager } from '@/storage/database/scriptManager';

/**
 * POST /api/short-dramas/[id]/sync-storyboards
 * 将关联剧本的章节场景（scenes / imagePrompts / videoPrompts）同步为短剧分镜
 * Body: { episodeId?: string }  — 不传则同步全部分集
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const { id: dramaId } = await params;
    const drama = await shortDramaManager.getById(dramaId);
    if (!drama) return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    if (drama.userId !== payload.userId && payload.role !== 'admin') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }
    if (!drama.scriptId) {
      return NextResponse.json({ error: '该短剧未关联剧本' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const targetEpisodeId: string | null = body.episodeId || null;

    // 获取剧本章节
    const script = await scriptManager.getScriptById(drama.scriptId);
    if (!script || !script.chapters || !Array.isArray(script.chapters)) {
      return NextResponse.json({ error: '关联剧本无章节数据' }, { status: 400 });
    }
    const scriptChapters: any[] = script.chapters;

    // 获取分集列表
    const allEpisodes = await shortDramaManager.getEpisodesByDramaId(dramaId);
    const episodes = targetEpisodeId
      ? allEpisodes.filter(e => e.id === targetEpisodeId)
      : allEpisodes;

    if (episodes.length === 0) {
      return NextResponse.json({ error: '没有可同步的分集' }, { status: 400 });
    }

    let totalCreated = 0;
    let totalSkipped = 0;
    const results: Array<{ episodeId: string; episodeNumber: number; created: number }> = [];

    for (const episode of episodes) {
      const chIdx = episode.sourceScriptChapterIndex;
      if (chIdx == null || chIdx < 0 || chIdx >= scriptChapters.length) continue;

      const chapter = scriptChapters[chIdx];
      if (!chapter) continue;

      // 解析 scenes
      let scenes: any[] = [];
      if (chapter.scenes) {
        try {
          scenes = typeof chapter.scenes === 'string' ? JSON.parse(chapter.scenes) : chapter.scenes;
          if (!Array.isArray(scenes)) scenes = [];
        } catch { scenes = []; }
      }

      // 解析 imagePrompts / videoPrompts
      let imagePrompts: any[] = [];
      let videoPrompts: any[] = [];
      try {
        if (chapter.imagePrompts) {
          const ip = typeof chapter.imagePrompts === 'string' ? JSON.parse(chapter.imagePrompts) : chapter.imagePrompts;
          if (Array.isArray(ip)) imagePrompts = ip;
        }
        if (chapter.videoPrompts) {
          const vp = typeof chapter.videoPrompts === 'string' ? JSON.parse(chapter.videoPrompts) : chapter.videoPrompts;
          if (Array.isArray(vp)) videoPrompts = vp;
        }
      } catch {}

      if (scenes.length === 0) continue;

      // 检查已有分镜数量（跳过已有分镜的分集）
      const existingShots = await dramaWorkflowManager.getShotsByEpisodeId(episode.id);
      if (existingShots.length > 0) {
        totalSkipped++;
        continue;
      }

      // 构造分镜列表
      const shots = scenes.map((scene: any, idx: number) => {
        const ip = imagePrompts.find((p: any) => (p.sceneIndex ?? p.index ?? -1) === (scene.sceneIndex ?? idx)) || imagePrompts[idx];
        const vp = videoPrompts.find((p: any) => (p.sceneIndex ?? p.index ?? -1) === (scene.sceneIndex ?? idx)) || videoPrompts[idx];

        const dialogueLines: string[] = [];
        if (Array.isArray(scene.dialogues)) {
          for (const d of scene.dialogues) {
            if (d.character && d.line) dialogueLines.push(`${d.character}：${d.line}`);
          }
        }

        const descParts: string[] = [];
        if (scene.description) descParts.push(scene.description);
        if (scene.actions) descParts.push(scene.actions);

        return {
          dramaId,
          episodeId: episode.id,
          userId: payload.userId,
          shotNumber: (scene.sceneIndex ?? idx) + 1,
          shotType: 'storyboard' as const,
          sceneDescription: descParts.join('\n') || null,
          cameraAngle: extractCameraAngle(scene.stageDirections || ''),
          cameraMovement: extractCameraMovement(scene.stageDirections || ''),
          dialogue: dialogueLines.length > 0 ? dialogueLines.join('\n') : null,
          voiceover: null,
          soundEffects: null,
          characterIds: null,
          imagePrompt: ip?.imagePrompt || ip?.prompt || null,
          videoPrompt: vp?.videoPrompt || vp?.prompt || null,
          ttsText: dialogueLines.length > 0 ? dialogueLines.join('\n') : null,
          subtitle: dialogueLines.length > 0 ? dialogueLines[0] : null,
          duration: 3,
          status: 'draft' as const,
        };
      });

      await dramaWorkflowManager.bulkCreateShots(shots);
      totalCreated += shots.length;
      results.push({ episodeId: episode.id, episodeNumber: episode.episodeNumber, created: shots.length });
    }

    return NextResponse.json({
      success: true,
      message: `同步完成：新增分镜 ${totalCreated} 个${totalSkipped > 0 ? `，跳过已有分镜分集 ${totalSkipped} 集` : ''}`,
      data: { totalCreated, totalSkipped, results },
    });
  } catch (error: any) {
    console.error('[sync-storyboards] 失败:', error);
    return NextResponse.json({ error: '同步失败: ' + error.message }, { status: 500 });
  }
}

function extractCameraAngle(text: string): string | null {
  if (!text) return null;
  const m = text.match(/(?:远景|大全景|全景|中景|近景|特写|大特写)/);
  return m ? m[0] : null;
}

function extractCameraMovement(text: string): string | null {
  if (!text) return null;
  const m = text.match(/(?:推镜|拉镜|摇镜|移镜|跟镜|固定)/);
  return m ? m[0] : null;
}
