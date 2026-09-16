/**
 * 章节拆段工具：把小说章节正文切成「逐条分镜」用的章节文案片段。
 *
 * 规则：
 * - 按空行/换行分段落，清理空段与噪音段（过短、纯标点）。
 * - 单段超过 MAX_SEGMENT_LEN 时按句子/逗号二次切分。
 * - 总段数上限 MAX_SEGMENTS，超出时把尾部短段向上合并，避免一集分镜爆炸。
 * - 返回带 1 基 index 的片段列表，作为模版 {{章节文案}} 的输入。
 */

const MAX_SEGMENT_LEN = 400;
const MAX_SEGMENTS = 12;
const MIN_SEGMENT_LEN = 8;

function splitLongText(text: string): string[] {
  const parts = text.split(/(?<=[。！？!?；;])/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  let current = '';
  for (const part of parts) {
    if ((current + part).length > MAX_SEGMENT_LEN && current) {
      out.push(current);
      current = part;
    } else {
      current += part;
    }
    if (current.length > MAX_SEGMENT_LEN) {
      out.push(current);
      current = '';
    }
  }
  if (current) out.push(current);
  return out;
}

/** 判断一段文本是否是噪音（纯标点 / 对话标签 / 过短） */
function isNoise(text: string): boolean {
  const cleaned = text.replace(/[\s\u3000]+/g, '');
  if (!cleaned) return true;
  if (cleaned.length < MIN_SEGMENT_LEN) return true;
  // 纯标点/语气词开头且整体很短的（如「……」「哈？」）
  if (/^[\s…\.。！？!?，,、：:；;~～—「」『』（）()【】·\u200b]*$/.test(cleaned)) return true;
  // 明确是章节标题/分隔标记的行
  if (/^(第[一二三四五六七八九十百千万\d]+[章节回部集卷]|序章|楔子|番外|完)/.test(cleaned) && cleaned.length < 20) return true;
  return false;
}

export interface ChapterSegment {
  /** 1 基序号，作为分镜 panel 顺序 */
  index: number;
  text: string;
}

/**
 * 把章节正文切成逐条分镜用的片段列表。
 */
export function splitChapterContent(content: string): ChapterSegment[] {
  const raw = String(content || '').replace(/\r\n/g, '\n');
  let paragraphs: string[] = raw
    .split(/\n{1,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !isNoise(s));

  // 单段超长：二次切分
  const expanded: string[] = [];
  for (const p of paragraphs) {
    if (p.length > MAX_SEGMENT_LEN) expanded.push(...splitLongText(p));
    else expanded.push(p);
  }

  // 段数上限：超出时把相邻短段合并，尽量保前保后
  let segments = expanded.filter(Boolean);
  while (segments.length > MAX_SEGMENTS) {
    // 找最短相邻对合并
    let bestIdx = 0;
    let bestSum = Infinity;
    for (let i = 0; i < segments.length - 1; i++) {
      const sum = segments[i].length + segments[i + 1].length;
      if (sum < bestSum) {
        bestSum = sum;
        bestIdx = i;
      }
    }
    segments[bestIdx] = segments[bestIdx] + ' ' + segments[bestIdx + 1];
    segments.splice(bestIdx + 1, 1);
  }

  return segments.map((text, i) => ({ index: i + 1, text }));
}