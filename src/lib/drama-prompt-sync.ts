import { shortDramaManager, scriptManager, dramaWorkflowManager } from '@/storage/database';
import { buildScriptSceneDescriptions, buildShotsFromScriptScenes } from '@/lib/drama-scene-description';

/**
 * 剧本提示词 → 短剧分镜 同步。
 * 把剧本章节里的 imagePrompts / videoPrompts 自动对应写入短剧对应分集的
 * drama_storyboards.image_prompt / video_prompt，即「图片分镜 / 视频分镜」的提示词。
 *
 * 对应关系：drama.scriptId → script.chapters[episode.sourceScriptChapterIndex]
 *           chapter.screenplay.scenes[i] ↔ 分镜第 i 条（shotNumber 升序）↔ prompts[].sceneIndex
 */

export interface PromptSyncResult {
  /** 实际处理的分集数 */
  episodes: number;
  /** 自动创建的分镜数 */
  shotsCreated: number;
  /** 写入/更新的图片提示词条数 */
  imageFilled: number;
  /** 写入/更新的视频提示词条数 */
  videoFilled: number;
}

export interface PromptSyncOptions {
  /** 只同步指定剧本章节（0-based，即 sourceScriptChapterIndex） */
  chapterIndex?: number;
  /** true：用剧本提示词覆盖分镜已有提示词；false/不传：仅在分镜提示词为空时补齐 */
  overwrite?: boolean;
}

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // 忽略坏 JSON
    }
  }
  return [];
}

/** 优先按 sceneIndex 匹配，其次按位置匹配 */
function pickPrompt(list: any[], sceneNo: number, position: number): any | null {
  if (!list.length) return null;
  const byScene = list.find((p) => p && Number(p.sceneIndex) === sceneNo);
  return byScene || list[position] || null;
}

function parseSeconds(value: unknown): number | null {
  const n = parseInt(String(value ?? '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 视频提示词统一存结构化 JSON（与短剧工作台「标准格式」一致，读取 vp.prompt） */
function buildVideoPromptJson(promptText: string, cameraMovement: string): string {
  return JSON.stringify({
    startFrame: '',
    endFrame: '',
    cameraMovement: cameraMovement || '',
    characterAction: '',
    prompt: promptText,
    stateNote: '',
  });
}

/** 同步单个短剧：把关联剧本的图片/视频提示词对应到分镜 */
export async function syncScriptPromptsToStoryboards(
  dramaId: string,
  options: PromptSyncOptions = {}
): Promise<PromptSyncResult> {
  const result: PromptSyncResult = { episodes: 0, shotsCreated: 0, imageFilled: 0, videoFilled: 0 };

  const drama = await shortDramaManager.getById(dramaId);
  if (!drama || !drama.scriptId) return result;

  const script = await scriptManager.getScriptById(drama.scriptId as string);
  if (!script) return result;
  const chapters = asArray((script as any).chapters);
  if (!chapters.length) return result;

  const episodes = await shortDramaManager.getEpisodesByDramaId(dramaId);
  if (!episodes.length) return result;

  const overwrite = options.overwrite === true;

  for (const ep of episodes) {
    const chIdx = (ep as any).sourceScriptChapterIndex != null
      ? (ep as any).sourceScriptChapterIndex
      : (ep as any).episodeNumber - 1;
    if (options.chapterIndex != null && chIdx !== options.chapterIndex) continue;
    if (chIdx < 0 || chIdx >= chapters.length) continue;

    const chapter = chapters[chIdx];
    if (!chapter) continue;

    const imagePrompts = asArray(chapter.imagePrompts);
    const videoPrompts = asArray(chapter.videoPrompts);
    if (!imagePrompts.length && !videoPrompts.length) continue;

    const sceneDescs = buildScriptSceneDescriptions(chapter.screenplay);
    if (!sceneDescs.length) continue;

    let shots = await dramaWorkflowManager.getShotsByEpisodeId(ep.id);
    if (!shots.length) {
      // 还没有分镜：按剧本场景自动创建（对应工作台空态「点击生成提示词自动创建」）
      const created = await dramaWorkflowManager.bulkCreateShots(
        buildShotsFromScriptScenes(dramaId, ep.id, drama.userId, sceneDescs) as any
      );
      shots = await dramaWorkflowManager.getShotsByEpisodeId(ep.id);
      result.shotsCreated += created.length;
    }
    if (!shots.length) continue;
    result.episodes++;

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i] as any;
      const imageP = pickPrompt(imagePrompts, i + 1, i);
      const videoP = pickPrompt(videoPrompts, i + 1, i);
      const scene = sceneDescs[i];

      const patch: Record<string, unknown> = {};

      const imageText = String(imageP?.prompt || '').trim();
      if (imageText && (overwrite || !shot.imagePrompt)) patch.imagePrompt = imageText;

      const negative = String(imageP?.negativePrompt || '').trim();
      if (negative && (overwrite || !shot.negativePrompt)) patch.negativePrompt = negative;

      const videoText = String(videoP?.prompt || '').trim();
      if (videoText && (overwrite || !shot.videoPrompt)) {
        patch.videoPrompt = buildVideoPromptJson(
          videoText,
          String(scene?.cameraMovement || videoP?.cameraMovement || '')
        );
      }

      const duration = parseSeconds(videoP?.duration) ?? scene?.duration ?? null;
      if (duration && (overwrite || shot.duration == null || shot.duration === 3)) patch.duration = duration;

      if (Object.keys(patch).length) {
        await dramaWorkflowManager.updateShot(shot.id, patch as any);
        if (patch.imagePrompt) result.imageFilled++;
        if (patch.videoPrompt) result.videoFilled++;
      }
    }
  }

  return result;
}

/** 同步某小说下的所有短剧 */
export async function syncNovelScriptPromptsToDramas(
  novelId: string,
  options: PromptSyncOptions = {}
): Promise<PromptSyncResult> {
  const total: PromptSyncResult = { episodes: 0, shotsCreated: 0, imageFilled: 0, videoFilled: 0 };
  const dramas = await shortDramaManager.getDramasByNovelId(novelId);
  for (const d of dramas) {
    const r = await syncScriptPromptsToStoryboards(d.id, options);
    total.episodes += r.episodes;
    total.shotsCreated += r.shotsCreated;
    total.imageFilled += r.imageFilled;
    total.videoFilled += r.videoFilled;
  }
  return total;
}
