interface EpisodeLike {
  episodeNumber?: number | null;
  sourceChapter?: number | null;
  sourceScriptChapterIndex?: number | null;
  [key: string]: any;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : null;
}

function positiveFrom(value: unknown): number | null {
  const numberValue = toNumber(value);
  return numberValue !== null && numberValue > 0 ? numberValue : null;
}

export function resolveSourceChapterNumber(
  chapter: any,
  fallbackIndex: number,
  options: { fromScript?: boolean } = {}
): number {
  const explicit =
    positiveFrom(chapter?.sourceChapter) ??
    positiveFrom(chapter?.sourceChapterNumber) ??
    positiveFrom(chapter?.novelChapter) ??
    positiveFrom(chapter?.novelChapterNumber) ??
    positiveFrom(chapter?.chapterNumber) ??
    positiveFrom(chapter?.chapterNo);

  if (explicit !== null) return explicit;

  if (options.fromScript) {
    const chapterIndex = toNumber(chapter?.chapterIndex);
    if (chapterIndex !== null && chapterIndex >= 0) return chapterIndex + 1;

    const index = toNumber(chapter?.index);
    if (index !== null) {
      if (index === fallbackIndex) return fallbackIndex + 1;
      if (index <= 0) return 1;
      return index;
    }

    return fallbackIndex + 1;
  }

  const index = toNumber(chapter?.index);
  if (index !== null) return index > 0 ? index : index + 1;

  const chapterIndex = toNumber(chapter?.chapterIndex);
  if (chapterIndex !== null) return chapterIndex >= 0 ? chapterIndex + 1 : fallbackIndex + 1;

  return fallbackIndex + 1;
}

export function normalizeEpisodeSourceFields<T extends EpisodeLike>(
  episode: T,
  scriptChapters: any[] = []
): T {
  const sourceScriptChapterIndex = toNumber(episode.sourceScriptChapterIndex);
  if (sourceScriptChapterIndex !== null && sourceScriptChapterIndex >= 0) {
    return {
      ...episode,
      sourceScriptChapterIndex,
      sourceChapter: resolveSourceChapterNumber(
        scriptChapters[sourceScriptChapterIndex],
        sourceScriptChapterIndex,
        { fromScript: true }
      ),
    };
  }

  const storedSourceChapter = positiveFrom(episode.sourceChapter);
  if (storedSourceChapter !== null) return { ...episode, sourceChapter: storedSourceChapter };

  return {
    ...episode,
    sourceChapter: episode.sourceChapter === 0 ? 1 : episode.sourceChapter ?? null,
  };
}
