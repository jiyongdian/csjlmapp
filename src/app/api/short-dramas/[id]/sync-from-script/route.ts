import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { shortDramaManager, scriptManager, dramaWorkflowManager } from '@/storage/database';
import { resolveSourceChapterNumber } from '@/lib/episode-source';
import { buildEpisodeSynopsis } from '@/lib/episode-summary';
import { buildScriptSceneDescriptions } from '@/lib/drama-scene-description';
import { syncScriptPromptsToStoryboards } from '@/lib/drama-prompt-sync';

/**
 * POST /api/short-dramas/[id]/sync-from-script
 * 将关联剧本的章节剧本内容同步到分集（补充缺失的 screenplay/scenes/dialogues/directions）
 * 同时同步分镜的 sceneDescription 为剧本原文（1:1映射）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
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

    // 获取剧本章节
    const script = await scriptManager.getScriptById(drama.scriptId);
    if (!script) return NextResponse.json({ error: '关联剧本不存在' }, { status: 404 });

    const scriptChapters: any[] = Array.isArray(script.chapters)
      ? script.chapters
      : (() => { try { return JSON.parse(script.chapters as string) ?? []; } catch { return []; } })();

    if (scriptChapters.length === 0) {
      return NextResponse.json({ error: '剧本暂无章节内容' }, { status: 400 });
    }

    // 获取现有分集
    const episodes = await shortDramaManager.getEpisodesByDramaId(dramaId);
    if (episodes.length === 0) {
      return NextResponse.json({ error: '短剧暂无分集' }, { status: 400 });
    }

    let synced = 0;
    let skipped = 0;
    let shotsSynced = 0;

    for (const ep of episodes) {
      const chIdx = ep.sourceScriptChapterIndex != null
        ? ep.sourceScriptChapterIndex
        : ep.episodeNumber - 1;

      if (chIdx < 0 || chIdx >= scriptChapters.length) { skipped++; continue; }
      const ch = scriptChapters[chIdx];
      if (!ch?.screenplay) { skipped++; continue; }
      const screenplay = typeof ch.screenplay === 'string' ? ch.screenplay : JSON.stringify(ch.screenplay);

      await shortDramaManager.updateEpisode(ep.id, {
        screenplay,
        synopsis: buildEpisodeSynopsis({ synopsis: ep.synopsis, screenplay, scriptChapter: ch }),
        scenes: ch.scenes ? (typeof ch.scenes === 'string' ? ch.scenes : JSON.stringify(ch.scenes)) : undefined,
        dialogues: ch.dialogues ? (typeof ch.dialogues === 'string' ? ch.dialogues : JSON.stringify(ch.dialogues)) : undefined,
        directions: ch.directions ? (typeof ch.directions === 'string' ? ch.directions : JSON.stringify(ch.directions)) : undefined,
        sourceChapter: resolveSourceChapterNumber(ch, chIdx, { fromScript: true }),
        sourceScriptChapterIndex: chIdx,
        status: 'imported',
      });
      synced++;

      // ── 同步分镜的 sceneDescription 为剧本原文 ──
      try {
        const shots = await dramaWorkflowManager.getShotsByEpisodeId(ep.id);
        if (shots.length > 0) {
          // 使用共享工具构建剧本场景原文
          const scriptScenes = buildScriptSceneDescriptions(screenplay);

          // 1:1映射更新分镜的 sceneDescription
          const sceneCount = scriptScenes.length;
          for (let i = 0; i < shots.length; i++) {
            const shot = shots[i];
            let finalSceneDesc: string | null = null;
            if (i < sceneCount) {
              finalSceneDesc = scriptScenes[i].rawText;
            } else if (sceneCount > 0) {
              finalSceneDesc = scriptScenes[sceneCount - 1].rawText;
            }
            if (finalSceneDesc && finalSceneDesc !== shot.sceneDescription) {
              const updatePayload: any = { sceneDescription: finalSceneDesc };
              // 同时更新对白
              if (i < sceneCount && scriptScenes[i].dialogueLines.length > 0) {
                const d = scriptScenes[i].dialogueLines.join('\n');
                updatePayload.dialogue = d;
                updatePayload.ttsText = d;
                updatePayload.subtitle = scriptScenes[i].dialogueLines[0];
              }
              // 同步技术字段（景别/机位/时长/镜头运动/音效），保证分镜与剧本一致
              if (i < sceneCount) {
                const sc = scriptScenes[i];
                if (sc.shotType) updatePayload.shotType = sc.shotType;
                if (sc.cameraAngle) updatePayload.cameraAngle = sc.cameraAngle;
                if (sc.duration) updatePayload.duration = sc.duration;
                if (sc.cameraMovement) updatePayload.cameraMovement = sc.cameraMovement;
                if (sc.soundEffects) updatePayload.soundEffects = sc.soundEffects;
              }
              await dramaWorkflowManager.updateShot(shot.id, updatePayload);
              shotsSynced++;
            } else if (i < sceneCount) {
              // sceneDescription 未变，但仍需同步技术字段和对白
              const sc = scriptScenes[i];
              const techPayload: any = {};
              if (sc.dialogueLines.length > 0) {
                const d = sc.dialogueLines.join('\n');
                if (d !== shot.dialogue) { techPayload.dialogue = d; techPayload.ttsText = d; techPayload.subtitle = sc.dialogueLines[0]; }
              }
              if (sc.shotType && sc.shotType !== shot.shotType) techPayload.shotType = sc.shotType;
              if (sc.cameraAngle && sc.cameraAngle !== shot.cameraAngle) techPayload.cameraAngle = sc.cameraAngle;
              if (sc.duration && sc.duration !== shot.duration) techPayload.duration = sc.duration;
              if (sc.cameraMovement && sc.cameraMovement !== shot.cameraMovement) techPayload.cameraMovement = sc.cameraMovement;
              if (sc.soundEffects && sc.soundEffects !== (shot as any).soundEffects) techPayload.soundEffects = sc.soundEffects;
              if (Object.keys(techPayload).length > 0) {
                await dramaWorkflowManager.updateShot(shot.id, techPayload);
                shotsSynced++;
              }
            }
          }
        }
      } catch (err) {
        console.error('[sync-from-script] 同步分镜 sceneDescription 失败:', err);
      }
    }

    // 同时把剧本的图片/视频提示词对应写入分镜（图片分镜 / 视频分镜）
    let promptSync = { episodes: 0, shotsCreated: 0, imageFilled: 0, videoFilled: 0 };
    try {
      promptSync = await syncScriptPromptsToStoryboards(dramaId, { overwrite: true });
    } catch (err) {
      console.error('[sync-from-script] 同步分镜提示词失败:', err);
    }

    return NextResponse.json({
      success: true,
      message: `同步完成：更新 ${synced} 集，跳过 ${skipped} 集，同步 ${shotsSynced} 个分镜场景描述；图片提示词 ${promptSync.imageFilled} 条、视频提示词 ${promptSync.videoFilled} 条`,
      data: { synced, skipped, shotsSynced, promptSync, total: episodes.length },
    });
  } catch (error: any) {
    console.error('[sync-from-script] 失败:', error);
    return NextResponse.json({ error: '同步失败: ' + error.message }, { status: 500 });
  }
}
