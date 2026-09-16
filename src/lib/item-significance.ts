const ITEM_SIGNIFICANCE_LABEL = "(?:\\u91cd\\u8981\\u6027|\\u8c61\\u5f81\\u610f\\u4e49|\\u8c61\\u5f81|\\u610f\\u4e49|\\u5267\\u60c5\\u4f5c\\u7528|\\u53d9\\u4e8b\\u4f5c\\u7528|\\u5173\\u952e\\u4f5c\\u7528)";
const INLINE_ITEM_SIGNIFICANCE_RE = new RegExp(`^(.*?)(?:[\\uff0c,\\u3002\\uff1b;\\u3001\\s]*)${ITEM_SIGNIFICANCE_LABEL}[\\uff1a:]\\s*(.+)$`);
const STANDALONE_ITEM_SIGNIFICANCE_RE = new RegExp(`^${ITEM_SIGNIFICANCE_LABEL}[\\uff1a:]\\s*(.+)$`);
const MEANING_CUE_RE = /推动(?:情节|剧情|故事)|核心线索|关键(?:道具|线索|物品|信物)|承载|象征|代表|决定性作用|扭转局势|各方争夺|争夺的焦点|揭开|命运|主题|身份与使命|使命|焦点/;

type ItemSignificanceInput = {
  description?: string | null;
  significance?: string | null;
};

export const cleanItemSignificance = (value: string | null | undefined) =>
  (value || "")
    .trim()
    .replace(/^(?:是|实则是|则是|作为)\s*/, "")
    .replace(/[\u3002\uff1b;\uff0c,\u3001.]+$/, "");

export const getStandaloneItemSignificance = (line: string | null | undefined) => {
  const match = (line || "").trim().match(STANDALONE_ITEM_SIGNIFICANCE_RE);
  return match ? cleanItemSignificance(match[1]) : "";
};

const splitMeaningClause = (line: string) => {
  const cueMatch = line.match(MEANING_CUE_RE);
  if (!cueMatch || cueMatch.index === undefined) return null;

  const cueIndex = cueMatch.index;
  const beforeCue = line.slice(0, cueIndex);
  const delimiterIndex = Math.max(
    beforeCue.lastIndexOf("\uff0c"),
    beforeCue.lastIndexOf(","),
    beforeCue.lastIndexOf("\u3002"),
    beforeCue.lastIndexOf("\uff1b"),
    beforeCue.lastIndexOf(";"),
  );

  if (delimiterIndex >= 4) {
    return {
      description: line.slice(0, delimiterIndex).trim(),
      significance: cleanItemSignificance(line.slice(delimiterIndex + 1)),
    };
  }

  if (cueIndex === 0) {
    return { description: "", significance: cleanItemSignificance(line) };
  }

  return null;
};

export const splitItemDescriptionSignificance = (
  description: string | null | undefined = "",
  significance: string | null | undefined = "",
) => {
  const sourceDescription = description || "";
  let resolvedSignificance = cleanItemSignificance(significance);
  const descLines: string[] = [];

  for (const rawLine of sourceDescription.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const standaloneSignificance = getStandaloneItemSignificance(line);
    if (standaloneSignificance) {
      if (!resolvedSignificance) resolvedSignificance = standaloneSignificance;
      continue;
    }

    const inlineSignificance = line.match(INLINE_ITEM_SIGNIFICANCE_RE);
    if (inlineSignificance) {
      if (inlineSignificance[1].trim()) descLines.push(inlineSignificance[1].trim());
      if (!resolvedSignificance) resolvedSignificance = cleanItemSignificance(inlineSignificance[2]);
      continue;
    }

    const meaningClause = !resolvedSignificance ? splitMeaningClause(line) : null;
    if (meaningClause) {
      if (meaningClause.description) descLines.push(meaningClause.description);
      if (!resolvedSignificance) resolvedSignificance = meaningClause.significance;
      continue;
    }

    descLines.push(line);
  }

  return {
    description: descLines.join("\n"),
    significance: resolvedSignificance,
  };
};

export function normalizeItemSignificanceInput<T extends ItemSignificanceInput>(data: T): T {
  const hasDescription = Object.prototype.hasOwnProperty.call(data, "description");
  const hasSignificance = Object.prototype.hasOwnProperty.call(data, "significance");
  if (!hasDescription && !hasSignificance) return data;

  const itemParts = splitItemDescriptionSignificance(
    hasDescription ? data.description : "",
    hasSignificance ? data.significance : "",
  );
  const normalized: ItemSignificanceInput = { ...data };
  if (hasDescription) normalized.description = itemParts.description || null;
  if (hasSignificance || itemParts.significance) normalized.significance = itemParts.significance || null;
  return normalized as T;
}
