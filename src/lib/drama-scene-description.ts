/**
 * 短剧分镜 - 剧本场景描述构建工具
 * 用于从剧本 screenplay 解析并构建每个场景的完整原文文本
 * 保证图片分镜和视频分镜的场景画面描述（SCENE DESCRIPTION）
 * 始终使用剧本原文（1:1映射）
 */

export interface ScriptSceneDesc {
  rawText: string;
  dialogueLines: string[];
  shotType?: string;
  cameraAngle?: string;
  duration?: number;
  cameraMovement?: string;
  soundEffects?: string;
}

/**
 * 从剧本 screenplay 解析并构建每个场景的完整原文文本
 * 返回每个场景的结构化文本（含【场景N】标题、描述、对白、承上启下、镜头指示）
 */
export function buildScriptSceneDescriptions(screenplay: string | any): ScriptSceneDesc[] {
  // 解析剧本场景（兼容字符串和对象两种格式）
  let rawScenes: any[] = [];

  // 如果传入的是对象，直接提取 scenes 数组
  if (typeof screenplay === 'object' && screenplay !== null) {
    if (Array.isArray(screenplay)) {
      rawScenes = screenplay;
    } else if (Array.isArray(screenplay.scenes)) {
      rawScenes = screenplay.scenes;
    }
  } else if (typeof screenplay === 'string') {
    const str = screenplay.trim();
    // 尝试 JSON 解析
    if (str.startsWith('{') || str.startsWith('[')) {
      try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed?.scenes)) rawScenes = parsed.scenes;
        else if (Array.isArray(parsed)) rawScenes = parsed;
      } catch {}
    }
  }

  if (rawScenes.length > 0) {
    return rawScenes.map((scene: any, idx: number) => {
      const parts: string[] = [];

      // 1. 场景标题行（优先 sceneTitle，兼容旧字段名）
      const heading = scene.sceneTitle || scene.sceneHeading || scene.title || '';
      if (heading) {
        parts.push(`【场景${idx + 1}】${heading}`);
      } else {
        parts.push(`【场景${idx + 1}】`);
      }

      // 2. 场景描述
      if (scene.description) parts.push(scene.description);

      // 3. 动作描写
      if (scene.actions) parts.push(scene.actions);

      // 4. 对白段落
      const dialogueLines: string[] = [];
      if (Array.isArray(scene.dialogues)) {
        for (const d of scene.dialogues) {
          if (d.character && d.line) dialogueLines.push(`${d.character}：${d.line}`);
          else if (d.line) dialogueLines.push(d.line);
        }
      }
      if (Array.isArray(scene.dialogue)) {
        for (const d of scene.dialogue) {
          if (typeof d === 'string') dialogueLines.push(d);
          else if (d.character && d.line) dialogueLines.push(`${d.character}：${d.line}`);
          else if (d.line) dialogueLines.push(d.line);
        }
      } else if (typeof scene.dialogue === 'string' && scene.dialogue.trim()) {
        dialogueLines.push(scene.dialogue.trim());
      }
      if (dialogueLines.length > 0) {
        parts.push('[对白]');
        parts.push(...dialogueLines);
      }

      // 5. 承上启下段落（仅 sceneTransition / transitionNote / continuity 才是承上启下）
      //    ⚠️ 新剧本结构中 transition 字段实际存储的是音效/BGM，不是承上启下
      const continuity = scene.sceneTransition || scene.transitionNote || scene.continuity;
      if (continuity) {
        parts.push('[承上启下]');
        parts.push(continuity);
      }

      // 6. 镜头指示（优先 stageDirections，兼容旧字段名）
      const camera = scene.stageDirections || scene.cameraDirection || scene.cameraLanguage || scene.shootingGuide;
      if (camera) {
        parts.push(camera);
      }

      // 7. 提取技术字段（景别/机位/时长/镜头运动/音效），用于同步到分镜
      const shotType = scene.shotType || scene.shot || scene.景别 || undefined;
      const cameraAngle = scene.cameraAngle || scene.angle || scene.机位 || undefined;
      const cameraMovement = scene.cameraMovement || scene.movement || scene.镜头运动 || undefined;
      let duration: number | undefined;
      if (scene.duration) {
        const durStr = String(scene.duration).replace(/[^0-9]/g, '');
        if (durStr) duration = parseInt(durStr, 10);
      }
      // 音效/BGM：新剧本结构用 transition 字段存储音效；旧格式用 soundDesign/soundEffects 等
      const soundEffects = scene.soundDesign || scene.soundEffects || scene.sfx || scene.bgm || scene.音效 || scene.transition || undefined;
      if (soundEffects) {
        parts.push('[音效/BGM]');
        parts.push(soundEffects);
      }

      return { rawText: parts.join('\n'), dialogueLines, shotType, cameraAngle, duration, cameraMovement, soundEffects };
    });
  }

  // 纯文本剧本：按【场景N】标记分割（仅当输入为字符串时）
  if (typeof screenplay === 'string') {
    const str = screenplay.trim();
    if (str.includes('【场景')) {
      const splitRegex = /(?=【场景\d+】)/g;
      const blocks = str.split(splitRegex).filter((b: string) => b.trim().length > 0);
      if (blocks.length > 0) {
        return blocks.map((text: string) => ({ rawText: text.trim(), dialogueLines: [] }));
      }
    }
    // 无场景标记，按段落拆分
    const paragraphs = str.split(/\n\s*\n/).filter((p: string) => p.trim().length > 0);
    return paragraphs.map((text: string) => ({ rawText: text.trim(), dialogueLines: [] }));
  }

  return [];
}

/**
 * 从剧本场景构建分镜数据（用于新建分镜）
 */
export function buildShotsFromScriptScenes(
  dramaId: string, episodeId: string, userId: string,
  sceneDescs: ScriptSceneDesc[]
) {
  return sceneDescs.map((sd, idx: number) => ({
    dramaId, episodeId, userId,
    shotNumber: idx + 1,
    shotType: 'storyboard' as const,
    sceneDescription: sd.rawText,
    cameraAngle: null,
    cameraMovement: null,
    dialogue: sd.dialogueLines.length > 0 ? sd.dialogueLines.join('\n') : null,
    voiceover: null,
    soundEffects: null,
    characterIds: null,
    imagePrompt: null,
    videoPrompt: null,
    ttsText: sd.dialogueLines.length > 0 ? sd.dialogueLines.join('\n') : null,
    subtitle: sd.dialogueLines.length > 0 ? sd.dialogueLines[0] : null,
    duration: 3,
    status: 'draft' as const,
  }));
}
