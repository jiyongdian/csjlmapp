/**
 * 剧本生成前的小说原文净化器
 *
 * 背景：AI 生成小说章节时，可能把与本书完全无关的固定片段（串文模板碎片）
 * 以"句中硬插入"的方式跨章重复写入正文，例如：
 *   "脸上堆着讨好的笑我攥紧了青砖棱子，手心全是冷汗，爪子灵活地转动锁芯"
 * 这些碎片会导致剧本改编时对白张冠李戴、剧情跳脱。
 *
 * 本模块在不改动小说正文落库数据的前提下，于"送给剧本 AI 之前"净化：
 *  1. 跨章 n-gram 文档频率检测：同一 10 字以上纯汉字片段出现在 ≥N 章，
 *     正常小说叙述不可能出现，判定为串文污染；
 *  2. 内置已知串文模板黑名单（跨书通用的污染指纹）；
 *  3. 剔除后做语句平滑（句中粘连补逗号、第一人称短残句连带删除、重复标点清理）；
 *  4. 引号内对白区域受保护，绝不删改。
 */

export interface CleanableChapter {
  title?: string | null;
  content?: string | null;
  [key: string]: unknown;
}

export interface CleanChaptersResult<T extends CleanableChapter> {
  chapters: T[];
  /** 被剔除的污染片段（去重后，用于日志/展示） */
  removedFragments: string[];
  /** 发生剔除的章节数 */
  affectedChapterCount: number;
  /** 发生第一人称→第三人称 POV 归一的章节数 */
  povNormalizedCount: number;
}

/** 内置串文模板黑名单（归一化纯汉字形式，匹配时容忍原文标点） */
const CROSS_BOOK_BLACKLIST: string[] = [
  '我攥紧了青砖棱子手心全是冷汗',
  '指缝间的窝头已经凉透',
  '怀里的木匣又重重地硌了我一下',
  '榻下那人忽然抬眼看我',
  '像一行没写完的字',
  '血溅在门槛边',
  '门外的雨更大了',
  '远处传来三声梆子两短一长',
  '刀已出鞘半截却再难推进半分',
];

/** 仅保留汉字 */
function hanOnly(s: string): string {
  return s.replace(/[^\u4e00-\u9fa5]/g, '');
}

/** 剔除引号内对白（对白不参与跨章重复统计） */
function stripQuoted(s: string): string {
  return s
    .replace(/[“「『][^”」』]*[”」』]/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/["'][^"']*["']/g, '');
}

/** 片段在原文中的标点容忍正则：字与字之间允许出现任意中文标点/空白 */
function buildTolerantRegex(frag: string): RegExp {
  const punct = '[，。！？、；：…—·\\s　]*';
  const body = frag
    .split('')
    .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join(punct);
  return new RegExp(body, 'g');
}

interface Range {
  start: number;
  end: number;
}

/**
 * 在单章原文中定位所有污染片段的剔除区间（含粘连/残句扩展）。
 */
function locateRemovalRanges(text: string, fragments: string[]): Range[] {
  const ranges: Range[] = [];

  for (const frag of fragments) {
    const re = buildTolerantRegex(frag);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++;
      if (m[0].length < frag.length) continue;
      // 注意：黑名单/跨章强指纹即使出现在对白引号内也属于污染（正常台词不可能跨章重复这些片段），
      // 一律剔除；引号配对仅用于 n-gram 统计阶段（对白不参与检测）。

      let start = m.index;
      let end = m.index + m[0].length;

      // 向后吞掉紧邻的句读标点（逗号/顿号/分号/冒号/空白），句号保留（新句开始）
      while (end < text.length && /[，、；：\s　]/.test(text[end])) end++;

      // 连带第一人称短残句：如"我却没敢松手"（同批污染碎片的残尾，≤24字、到下一句读为止）
      const rest = text.slice(end);
      const tailMatch = rest.match(/^[我俺咱][^，。！？；!?]{1,24}([，、；])/);
      if (tailMatch) {
        end += tailMatch[0].length;
        // 再吞残句后的句读标点
        while (end < text.length && /[，、；：\s　]/.test(text[end])) end++;
      }

      // 向前吞掉紧邻空白
      while (start > 0 && /[\s　]/.test(text[start - 1])) start--;
      // 片段作插入语时前面可能紧邻逗号（如"笑，我攥紧…"），吞掉这个逗号
      if (start > 0 && /[，、；]/.test(text[start - 1])) start--;

      ranges.push({ start, end });
    }
  }

  if (ranges.length === 0) return ranges;

  // 按起点排序、合并重叠区间
  ranges.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/** 应用剔除区间并做语句平滑 */
function applyRanges(text: string, ranges: Range[]): string {
  let out = '';
  let cursor = 0;
  for (const r of ranges) {
    out += text.slice(cursor, r.start);
    const leftChar = text[r.start - 1] || '';
    const rightChar = text[r.end] || '';
    const leftIsHan = /[\u4e00-\u9fa5]/.test(leftChar);
    const rightIsHan = /[\u4e00-\u9fa5]/.test(rightChar);
    // 句中粘连（前后都是汉字）补逗号；片段后紧跟对白开引号时同样补逗号（"声音颤抖，"台词""）
    if (leftIsHan && (rightIsHan || /[“「『]/.test(rightChar))) out += '，';
    cursor = r.end;
  }
  out += text.slice(cursor);

  // 标点平滑
  return out
    .replace(/，{2,}/g, '，')
    .replace(/、{2,}/g, '、')
    .replace(/，([。！？；])/g, '$1')
    .replace(/([，、])([”」』])/g, '$2')
    .replace(/^[，、；]\s*/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * 跨章 n-gram 文档频率检测：返回判定为污染的归一化片段集合。
 * 阈值：10-12 字片段需 ≥5 章共现；13 字以上需 ≥4 章共现。
 */
function detectCrossChapterFragments(
  chapters: CleanableChapter[],
  minChapters: number,
): Set<string> {
  const docFreq = new Map<string, number>();

  for (const ch of chapters) {
    if (!ch.content) continue;
    const normalized = hanOnly(stripQuoted(String(ch.content)));
    const seen = new Set<string>();
    // 10-20 字滑窗
    for (let len = 10; len <= 20; len++) {
      for (let i = 0; i + len <= normalized.length; i++) {
        const gram = normalized.slice(i, i + len);
        // 含连续 4 字以上数字/字母噪声的跳过（归一化后只剩汉字，天然过滤）
        seen.add(gram);
      }
    }
    for (const gram of seen) {
      docFreq.set(gram, (docFreq.get(gram) || 0) + 1);
    }
  }

  const hits = new Set<string>();
  for (const [gram, freq] of docFreq) {
    const threshold = gram.length <= 12 ? 5 : 4;
    if (freq >= threshold) hits.add(gram);
  }

  // 归并：短片段被长片段包含时丢弃短的（保留信息量更大的长片段）
  const sorted = [...hits].sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const gram of sorted) {
    if (!kept.some((k) => k.includes(gram))) kept.push(gram);
  }
  return new Set(kept);
}

/**
 * 剔除单章文本中的【内置跨书串文模板】片段（供小说章节定稿清洗复用）。
 * 不做跨章统计（单章上下文），只删黑名单指纹；引号内对白受保护。
 */
export function removeKnownCrossBookFragments(text: string): string {
  if (!text) return text;
  const fragList = [...CROSS_BOOK_BLACKLIST].sort((a, b) => b.length - a.length);
  const ranges = locateRemovalRanges(text, fragList);
  if (ranges.length === 0) return text;
  return applyRanges(text, ranges);
}

/** 从 protagonist 字段（逗号分隔角色列表）提取首个 2-4 字中文人名作为主角名 */
export function extractProtagonistName(protagonist?: string | null): string | null {
  if (!protagonist) return null;
  const first = String(protagonist).split(/[，,、；;\s|/]/)[0] || '';
  const m = first.match(/[\u4e00-\u9fa5]{2,4}/);
  return m ? m[0] : null;
}

/** 引号状态机：逐字符回调，标记字符是否在引号（对白）外 */
function walkOutsideQuotes(text: string, cb: (ch: string, i: number, inside: boolean) => string | null): string {
  let inside = false;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '“' || ch === '‘' || ch === '「' || ch === '『') { inside = true; out += ch; continue; }
    if (ch === '”' || ch === '’' || ch === '」' || ch === '』') { inside = false; out += ch; continue; }
    if (ch === '"') { inside = !inside; out += ch; continue; }
    const rep = cb(ch, i, inside);
    out += rep === null ? ch : rep;
  }
  return out;
}

/** 统计引号外（叙事区）的第一人称"我"数量 */
function countOutsideFirstPerson(text: string): number {
  let count = 0;
  walkOutsideQuotes(text, (ch, _i, inside) => {
    if (!inside && ch === '我') count++;
    return null;
  });
  return count;
}

/** 我 后接身体部位/亲属/方位词时用"他"更自然（他怀里/他耳边/他爸），其余用主角名避免歧义 */
const BODY_KIN_RE = /[爸妈哥姐弟妹爷奶叔伯舅姨嫂夫妻儿孙女家怀手脚头脑脸眼耳嘴牙肩背腿膝身边旁眼前海中里]/;

/** 引号外第一人称叙事 → 第三人称归一（对白内"我/我们"不动） */
function normalizeFirstPersonToThird(text: string, name: string | null): string {
  let inside = false;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '“' || ch === '‘' || ch === '「' || ch === '『') { inside = true; out += ch; continue; }
    if (ch === '”' || ch === '’' || ch === '」' || ch === '』') { inside = false; out += ch; continue; }
    if (ch === '"') { inside = !inside; out += ch; continue; }
    if (!inside && ch === '我') {
      if (text[i + 1] === '们') { out += name ? `${name}他们` : '他们'; i++; continue; }
      const next = text[i + 1] || '';
      out += BODY_KIN_RE.test(next) ? '他' : (name || '他');
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * 单章 POV 归一：第三人称小说的章节中，引号外叙事区出现成段第一人称漂移时，
 * 把"我/我们"转为主角名/他；对白内自称不动。引号外"我"不足 4 处则视为正常（不动）。
 */
export function normalizeChapterPovToThird(text: string, protagonist?: string | null): string {
  if (!text) return text;
  const name = extractProtagonistName(protagonist);
  if (countOutsideFirstPerson(text) < 4) return text;
  return normalizeFirstPersonToThird(text, name);
}

/**
 * 第三人称 POV 归一：第三人称主导的小说中，个别章节整段漂移为第一人称叙事
 * （内容是真剧情、视角错误），把引号外叙事"我"转为主角名/他；对白内自称不动。
 */
function normalizePovChapters<T extends CleanableChapter>(chapters: T[], protagonist?: string | null): { chapters: T[]; normalizedCount: number } {
  const name = extractProtagonistName(protagonist);
  let totalMe = 0;
  let totalThird = 0;
  const mePerChapter: number[] = [];
  for (const ch of chapters) {
    const content = typeof ch.content === 'string' ? ch.content : '';
    if (!content) { mePerChapter.push(0); continue; }
    const me = countOutsideFirstPerson(content);
    mePerChapter.push(me);
    totalMe += me;
    totalThird += (content.match(/[他她]/g) || []).length + (name ? content.split(name).length - 1 : 0);
  }
  // 全书第三人称主导（他/她/主角名 远多于叙事"我"）才归一，避免误伤第一人称小说
  if (totalMe < 4 || totalThird < totalMe * 2) {
    return { chapters, normalizedCount: 0 };
  }
  let normalizedCount = 0;
  const out = chapters.map((ch, idx) => {
    if (mePerChapter[idx] < 4 || typeof ch.content !== 'string') return ch;
    normalizedCount++;
    return { ...ch, content: normalizeFirstPersonToThird(ch.content, name) };
  });
  return { chapters: out, normalizedCount };
}

/**
 * 净化全部章节正文（不修改入参，返回新数组）。
 * @param chapters 章节数组（小说表 chapters jsonb）
 * @param minChapters 跨章检测的最小章节数（默认 4），章节总数少时自动放宽
 * @param protagonist 小说主角设定字段（用于第一人称 POV 漂移归一）
 */
export function cleanNovelChaptersForScript<T extends CleanableChapter>(
  chapters: T[],
  minChapters?: number,
  protagonist?: string | null,
): CleanChaptersResult<T> {
  if (!Array.isArray(chapters) || chapters.length === 0) {
    return { chapters, removedFragments: [], affectedChapterCount: 0, povNormalizedCount: 0 };
  }

  const autoMin = minChapters ?? Math.max(3, Math.min(4, Math.floor(chapters.length / 8)));
  const detected = detectCrossChapterFragments(chapters, autoMin);

  // 合并黑名单（归一化）
  const fragments = new Set<string>(detected);
  for (const b of CROSS_BOOK_BLACKLIST) fragments.add(b);

  // 长片段优先剔除
  const fragList = [...fragments].sort((a, b) => b.length - a.length);

  const removedFragments = new Set<string>();
  let affectedChapterCount = 0;

  let working = chapters.map((ch) => {
    if (!ch || typeof ch.content !== 'string' || !ch.content) return ch;
    const ranges = locateRemovalRanges(ch.content, fragList);
    if (ranges.length === 0) return ch;

    for (const r of ranges) {
      const snippet = ch.content.slice(r.start, Math.min(r.end, r.start + 30));
      if (snippet) removedFragments.add(hanOnly(snippet).slice(0, 24));
    }
    affectedChapterCount++;
    const newContent = applyRanges(ch.content, ranges);
    return { ...ch, content: newContent };
  });

  // 第三人称 POV 漂移归一（个别章节整段用第一人称叙事，内容是真剧情、视角错误）
  const pov = normalizePovChapters(working, protagonist);
  working = pov.chapters;

  return {
    chapters: working,
    removedFragments: [...removedFragments].slice(0, 50),
    affectedChapterCount,
    povNormalizedCount: pov.normalizedCount,
  };
}
