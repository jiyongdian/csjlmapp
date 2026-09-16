function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMaybeJson(value: unknown): any {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function clampText(text: string, maxLength: number): string {
  const cleaned = cleanText(text);
  if (cleaned.length <= maxLength) return cleaned;
  const sliced = cleaned.slice(0, maxLength);
  const sentenceEnd = Math.max(sliced.lastIndexOf('。'), sliced.lastIndexOf('！'), sliced.lastIndexOf('？'));
  return `${sentenceEnd > 80 ? sliced.slice(0, sentenceEnd + 1) : sliced}...`;
}

function getScreenplayObject(screenplay: unknown): any {
  const parsed = parseMaybeJson(screenplay);
  if (parsed) return parsed;
  if (typeof screenplay === 'object' && screenplay) return screenplay;
  return null;
}

function getScreenplayScenes(screenplay: unknown): any[] {
  const parsed = getScreenplayObject(screenplay);
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.screenplayScenes)) return parsed.screenplayScenes;
  if (Array.isArray(parsed.scenes)) return parsed.scenes;
  if (Array.isArray(parsed.screenplay?.scenes)) return parsed.screenplay.scenes;
  return [];
}

function getExistingSummary(screenplay: unknown): string {
  const parsed = getScreenplayObject(screenplay);
  if (!parsed || Array.isArray(parsed)) return '';
  return cleanText(parsed.summary || parsed.synopsis || parsed.screenplay?.summary || parsed.screenplay?.synopsis);
}

function sceneToSummaryPart(scene: any, index: number): string {
  const title = cleanText(scene?.sceneTitle || scene?.title || scene?.location || `场景${index + 1}`);
  const action = cleanText(scene?.actions || scene?.action || scene?.description || scene?.stageDirections);
  const transition = cleanText(scene?.sceneTransition);
  const firstDialogue = Array.isArray(scene?.dialogues)
    ? scene.dialogues
        .map((dialogue: any) => cleanText(dialogue?.line || dialogue?.content || dialogue?.text))
        .find(Boolean)
    : '';
  const content = action || transition || firstDialogue || title;
  const cleanedContent = content.replace(/[。！？；;]+$/g, '');
  const cleanedTitle = title.replace(/[。！？；;]+$/g, '');
  return cleanedTitle && cleanedContent && cleanedContent !== cleanedTitle ? `${cleanedTitle}中，${cleanedContent}` : cleanedContent;
}

export function buildEpisodeSynopsis(input: {
  synopsis?: unknown;
  screenplay?: unknown;
  scriptChapter?: any;
  novelChapter?: any;
  maxLength?: number;
}): string {
  const maxLength = input.maxLength || 280;
  const existing = cleanText(input.synopsis);
  if (existing && !existing.startsWith('{') && !existing.startsWith('[')) return clampText(existing, maxLength);

  const screenplay = input.screenplay || input.scriptChapter?.screenplay || input.scriptChapter?.screenplayScenes;
  const directSummary =
    cleanText(input.scriptChapter?.summary || input.scriptChapter?.synopsis) ||
    getExistingSummary(screenplay);
  if (directSummary) return clampText(directSummary, maxLength);

  const scenes = getScreenplayScenes(screenplay)
    .map(sceneToSummaryPart)
    .filter(Boolean);
  if (scenes.length > 0) {
    const selected = scenes.slice(0, 4);
    const prefix = selected.length === 1 ? '本章剧情集中在' : '本章剧情围绕';
    return clampText(`${prefix}${selected.join('；')}。`, maxLength);
  }

  const novelContent = cleanText(input.novelChapter?.summary || input.novelChapter?.content);
  if (novelContent) return clampText(novelContent, maxLength);

  return '';
}
