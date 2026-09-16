/**
 * 小说导入解析库
 *
 * 支持：.txt / .md / .epub / .docx / .html / .zip
 * 编码：UTF-8 / UTF-8 BOM / UTF-16LE / UTF-16BE / GB18030 / Big5（用 Node 内置 TextDecoder，无需额外依赖）
 * 章节：多形态标题识别 + 纯数字编号识别 + 段落/句子边界兜底切分
 */
import JSZip from 'jszip';
import { formatChapterTitle } from '@/lib/chapter-title';

export interface ParsedChapter {
  index: number;
  title: string;
  content: string;
}

export interface ParsedFile {
  chapters: ParsedChapter[];
  format: string;
  encoding: string;
  metaTitle: string | null;
  strategy: string;
  warnings: string[];
}

/* ============================== 编码检测 ============================== */

const SIMPLIFIED_ONLY =
  '这说对时过们来国见现发样将经动进种应还个后里从会无车门问开关长万与书头买卖东马鸟风飞龙页听见话语读写学觉义让记认识请谢谁讲论谈论议';
const TRADITIONAL_ONLY =
  '這說對時過們來國見現發樣將經動進種應還個後裡從會無車門問開關長萬與書頭買賣東馬鳥風飛龍頁聽見話語讀寫學覺義讓記認識請謝誰講論談議';

function countChars(s: string, set: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (set.indexOf(s[i]) >= 0) n++;
  return n;
}

function tryDecode(buf: Buffer, enc: string): string | null {
  try {
    return new TextDecoder(enc, { fatal: false }).decode(buf);
  } catch {
    return null;
  }
}

/** 智能解码：BOM → 无 BOM 的 UTF-16（按 NUL 分布）→ 严格 UTF-8 → GB18030 / Big5 择优 */
export function decodeBufferSmart(buf: Buffer): { text: string; encoding: string } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(buf.subarray(3)), encoding: 'UTF-8(BOM)' };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'UTF-16LE' };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'UTF-16BE' };
  }

  const sampleLen = Math.min(buf.length, 8192);
  let zeros = 0;
  let zeroEven = 0;
  for (let i = 0; i < sampleLen; i++) {
    if (buf[i] === 0) {
      zeros++;
      if (i % 2 === 0) zeroEven++;
    }
  }
  if (sampleLen > 0 && zeros / sampleLen > 0.2) {
    // NUL 多出现在偶数位 → 小端 UTF-16
    if (zeroEven > sampleLen - zeros - zeroEven - 1) {
      return { text: new TextDecoder('utf-16le').decode(buf), encoding: 'UTF-16LE(无BOM)' };
    }
    return { text: new TextDecoder('utf-16be').decode(buf), encoding: 'UTF-16BE(无BOM)' };
  }

  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'UTF-8' };
  } catch {
    /* 非 UTF-8，继续尝试中文编码 */
  }

  const gb = tryDecode(buf, 'gb18030') || '';
  const b5 = tryDecode(buf, 'big5') || '';
  const head = 200000;
  const gbBad = (gb.slice(0, head).match(/\uFFFD/g) || []).length;
  const b5Bad = (b5.slice(0, head).match(/\uFFFD/g) || []).length;
  // 分数越低越像：乱码少 + 简体字多
  const gbScore = gbBad * 10 + countChars(gb.slice(0, head), TRADITIONAL_ONLY) - countChars(gb.slice(0, head), SIMPLIFIED_ONLY);
  const b5Score = b5Bad * 10 + countChars(b5.slice(0, head), SIMPLIFIED_ONLY) - countChars(b5.slice(0, head), TRADITIONAL_ONLY);
  if (b5 && b5Score < gbScore) return { text: b5, encoding: 'Big5' };
  return { text: gb, encoding: 'GB18030' };
}

/* ============================== HTML 文本化 ============================== */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…',
  mdash: '—', ndash: '–', middot: '·', times: '×', copy: '©',
};

export function htmlToText(html: string): string {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|td)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)));
  s = s.replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)));
  s = s.replace(/&([a-zA-Z]+);/g, (_m, name) => {
    const v = ENTITIES[String(name).toLowerCase()];
    return v === undefined ? _m : v;
  });
  s = s.replace(/[ \t\u00a0\u3000]+/g, ' ');
  s = s.replace(/\n[ \t]+/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** 轻量 Markdown 文本化：去掉标题井号、强调符、图片，保留正文 */
export function markdownToText(md: string): string {
  let s = String(md || '');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/^#{1,6}\s*/gm, '');
  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2');
  s = s.replace(/(\*|_)(.*?)\1/g, '$2');
  s = s.replace(/`{1,3}([^`]*)`{1,3}/g, '$1');
  s = s.replace(/^\s*>\s?/gm, '');
  s = s.replace(/^\s*([-*_])\1{2,}\s*$/gm, '');
  return s;
}

/* ============================== 格式解析 ============================== */

async function extractEpub(buf: Buffer): Promise<{ text: string; metaTitle: string | null; warnings: string[] }> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(buf);

  let opfPath = '';
  const container = zip.file('META-INF/container.xml');
  if (container) {
    const xml = await container.async('string');
    const m = /full-path="([^"]+)"/i.exec(xml);
    if (m) opfPath = m[1];
  }
  if (!opfPath) {
    Object.keys(zip.files).forEach((p) => {
      if (!opfPath && /\.opf$/i.test(p)) opfPath = p;
    });
  }

  let metaTitle: string | null = null;
  const spine: string[] = [];

  if (opfPath && zip.file(opfPath)) {
    const opfFile = zip.file(opfPath);
    const opf = opfFile ? await opfFile.async('string') : '';
    const tm = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf);
    if (tm) metaTitle = htmlToText(tm[1]).trim() || null;

    const manifest: Record<string, string> = {};
    const itemRe = /<item\b[^>]*>/gi;
    let it: RegExpExecArray | null;
    while ((it = itemRe.exec(opf)) !== null) {
      const tag = it[0];
      const idM = /\bid="([^"]+)"/i.exec(tag);
      const hrefM = /\bhref="([^"]+)"/i.exec(tag);
      const propM = /\bproperties="([^"]*)"/i.exec(tag);
      if (idM && hrefM) {
        manifest[idM[1]] = /\bnav\b/i.test(propM ? propM[1] : '') ? '#NAV#' + hrefM[1] : hrefM[1];
      }
    }
    const itemRefRe = /<itemref\b[^>]*>/gi;
    let sp: RegExpExecArray | null;
    while ((sp = itemRefRe.exec(opf)) !== null) {
      const idM = /\bidref="([^"]+)"/i.exec(sp[0]);
      if (idM && manifest[idM[1]]) spine.push(manifest[idM[1]]);
    }
  }

  const opfDir = opfPath ? opfPath.replace(/[^/]*$/, '') : '';
  const resolve = (href: string): string => {
    const clean = href.split('#')[0];
    const parts = (opfDir + clean).split('/');
    const out: string[] = [];
    for (const p of parts) {
      if (p === '..') out.pop();
      else if (p !== '.' && p !== '') out.push(p);
    }
    return out.join('/');
  };

  let files = spine
    .filter((h) => h.indexOf('#NAV#') !== 0)
    .map(resolve)
    .filter((p) => !!zip.file(p));

  if (!files.length) {
    warnings.push('EPUB 目录结构解析失败，已改为按文件名顺序读取正文');
    files = Object.keys(zip.files)
      .filter((p) => /\.(x?html?|xhtml)$/i.test(p) && !/(toc|nav|contents?|cover)\b/i.test(p))
      .sort();
  }

  const chunks: string[] = [];
  for (const p of files) {
    const f = zip.file(p);
    if (!f) continue;
    const html = await f.async('string');
    const hm = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html);
    const heading = hm ? htmlToText(hm[1]).trim() : '';
    let text = htmlToText(html);
    if (heading && text.indexOf(heading) !== 0) text = heading + '\n' + text;
    if (text.trim()) chunks.push(text.trim());
  }

  return { text: chunks.join('\n\n'), metaTitle, warnings };
}

async function extractDocx(buf: Buffer): Promise<{ text: string; metaTitle: string | null }> {
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('DOCX 结构异常：缺少 word/document.xml');
  const xml = await doc.async('string');

  const paragraphs = xml.split(/<\/w:p>/i);
  const lines: string[] = [];
  for (const para of paragraphs) {
    const bits: string[] = [];
    const tRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>/gi;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(para)) !== null) bits.push(tm[1]);
    let line = htmlToText(bits.join(''));
    if (/<w:br\s*\/?>/i.test(para) && line) line += '\n';
    lines.push(line);
  }

  let metaTitle: string | null = null;
  const core = zip.file('docProps/core.xml');
  if (core) {
    const cxml = await core.async('string');
    const tm = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(cxml);
    if (tm) metaTitle = htmlToText(tm[1]).trim() || null;
  }

  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n'), metaTitle };
}

async function extractZip(buf: Buffer): Promise<{ text: string; warnings: string[] }> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
  const txt = names.find((p) => /\.(txt|md|markdown)$/i.test(p));
  if (txt) {
    const f = zip.file(txt);
    if (f) {
      const bytes = Buffer.from(await f.async('uint8array'));
      const d = decodeBufferSmart(bytes);
      warnings.push('压缩包内读取到文本文件：' + txt);
      return { text: d.text, warnings };
    }
  }
  const epub = names.find((p) => /\.epub$/i.test(p));
  if (epub) {
    const f = zip.file(epub);
    if (f) {
      const bytes = Buffer.from(await f.async('uint8array'));
      const r = await extractEpub(bytes);
      warnings.push('压缩包内读取到 EPUB：' + epub);
      warnings.push(...r.warnings);
      return { text: r.text, warnings };
    }
  }
  throw new Error('压缩包内没有找到 .txt / .md / .epub 文件');
}

/* ============================== 章节解析 ============================== */

const NUM_CLS = '0-9０-９一二三四五六七八九十百千万零〇两';
const CN_CHAPTER = '第[\\s\\u3000]*[' + NUM_CLS + ']{1,12}[\\s\\u3000]*[章节回集篇部话]';
const CN_VOLUME = '第[\\s\\u3000]*[' + NUM_CLS + ']{1,12}[\\s\\u3000]*卷';
const SPECIAL = '(?:序章|序言|序|楔子|引子|引言|前言|序幕|前奏|尾声|终章|结局|大结局|后记|后序|番外篇|番外|外传|前传|后传)';
const EN_CHAPTER = '(?:Chapter|CHAPTER|chapter)[\\s]*[0-9]{1,4}';
const CORE =
  '(?:[【［\\[《][\\s\\u3000]*(?:' + CN_CHAPTER + '|' + CN_VOLUME + ')[\\s\\u3000]*[】］\\]》]|' +
  CN_CHAPTER + '|' + CN_VOLUME + '|' + SPECIAL + '|' + EN_CHAPTER + ')';

// 有分隔符（空格或标点）→ 标题最长 40 字
const HEAD_SEP_RE = new RegExp(
  '^' + CORE + '(?:[\\s\\u3000]+[^\\n]{0,40}|[:：.．、\\-—·~][\\s\\u3000]*[^\\n]{0,40})?$'
);
// 无分隔符 → 仅允许很短的行（如「第1章风起」）
const HEAD_TIGHT_RE = new RegExp('^' + CORE + '[^\\n\\s]{0,14}$');

function isChapterHeading(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.length > 46) return false;
  if (/[。；;、,]/.test(t)) return false;
  if (HEAD_SEP_RE.test(t)) return true;
  if (t.length <= 20 && HEAD_TIGHT_RE.test(t)) return true;
  return false;
}

/** 去掉标题里冗余的「Chapter N」/纯数字前缀，只留标题本体 */
function cleanHeadingForTitle(h: string): string {
  const t = h.trim();
  if (/^[0-9]{1,4}$/.test(t)) return '';
  return t.replace(/^(?:chapter|part|prologue|epilogue)\s*[0-9]{0,4}\s*[:：.．\-—]?\s*/i, '').trim();
}

/** 按长度分段：优先段落边界 → 句子边界 → 硬切 */
export function chunkByLength(text: string, size: number): string[] {
  const out: string[] = [];
  const n = text.length;
  let pos = 0;
  while (pos < n) {
    let end = Math.min(pos + size, n);
    if (end < n) {
      const win = text.slice(pos, Math.min(end + 200, n));
      const paraCut = win.lastIndexOf('\n\n');
      if (paraCut >= size * 0.6) {
        end = pos + paraCut;
      } else {
        // 从目标长度往前回溯，取最近的句末标点，保证不切断句子
        const punct = '。！？…”」\n';
        let best = -1;
        for (let i = Math.min(size, win.length - 1); i >= Math.floor(size * 0.6); i--) {
          if (punct.indexOf(win[i]) >= 0) {
            best = i + 1;
            break;
          }
        }
        if (best > 0) end = pos + best;
      }
    }
    if (end <= pos) end = Math.min(pos + size, n);
    const chunk = text.slice(pos, end).trim();
    if (chunk) out.push(chunk);
    pos = end;
  }
  return out;
}

export function parseNovelChapters(raw: string): { chapters: ParsedChapter[]; strategy: string; warnings: string[] } {
  const warnings: string[] = [];
  const text = String(raw || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');

  const marks: { line: number; heading: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isChapterHeading(lines[i])) marks.push({ line: i, heading: lines[i].trim() });
  }

  let strategy = 'heading';
  if (marks.length < 2) {
    // 纯数字编号行（"1" / "001"）二次识别：≥3 且基本递增
    const nums: { line: number; heading: string; n: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^[0-9]{1,4}$/.test(t)) nums.push({ line: i, heading: t, n: parseInt(t, 10) });
    }
    let inc = 0;
    for (let i = 1; i < nums.length; i++) {
      const d = nums[i].n - nums[i - 1].n;
      if (d > 0 && d <= 3) inc++;
    }
    if (nums.length >= 3 && inc >= nums.length - 2) {
      marks.length = 0;
      nums.forEach((x) => marks.push({ line: x.line, heading: x.heading }));
      strategy = 'numbering';
    }
  }

  const chapters: ParsedChapter[] = [];

  if (marks.length >= 2) {
    const pre = lines.slice(0, marks[0].line).join('\n').trim();
    for (let k = 0; k < marks.length; k++) {
      const from = marks[k].line + 1;
      const to = k + 1 < marks.length ? marks[k + 1].line : lines.length;
      let content = lines.slice(from, to).join('\n').trim();
      if (k === 0 && pre.length >= 30) content = pre + '\n\n' + content;
      if (!content) continue;
      const idx = chapters.length + 1;
      chapters.push({ index: idx, title: formatChapterTitle(idx, cleanHeadingForTitle(marks[k].heading)), content });
    }
  } else if (marks.length === 1) {
    const first = marks[0];
    const content = lines.slice(first.line + 1).join('\n').trim();
    chapters.push({ index: 1, title: formatChapterTitle(1, cleanHeadingForTitle(first.heading)), content });
    strategy = 'single-heading';
  }

  if (chapters.length === 0) {
    strategy = 'chunk';
    warnings.push('未识别到章节标题，已按篇幅自动分段（约 2500 字/章）');
    chunkByLength(text, 2500).forEach((c, i) => {
      chapters.push({ index: i + 1, title: formatChapterTitle(i + 1), content: c });
    });
  }

  if (chapters.length === 1 && chapters[0].content.length < 500 && text.trim().length > chapters[0].content.length) {
    chapters[0].content = text.trim();
  }

  return { chapters, strategy, warnings };
}

/* ============================== 统一入口 ============================== */

export async function parseNovelFile(buf: Buffer, filename: string): Promise<ParsedFile> {
  const ext = String(filename.split('.').pop() || '').toLowerCase();
  const warnings: string[] = [];
  let format = ext || 'txt';
  let encoding = 'binary';
  let metaTitle: string | null = null;
  let text = '';

  if (ext === 'epub') {
    const r = await extractEpub(buf);
    text = r.text;
    metaTitle = r.metaTitle;
    warnings.push(...r.warnings);
    format = 'epub';
  } else if (ext === 'docx') {
    const r = await extractDocx(buf);
    text = r.text;
    metaTitle = r.metaTitle;
    format = 'docx';
  } else if (ext === 'html' || ext === 'htm' || ext === 'xhtml') {
    const d = decodeBufferSmart(buf);
    text = htmlToText(d.text);
    encoding = d.encoding;
    format = 'html';
  } else if (ext === 'zip') {
    const r = await extractZip(buf);
    text = r.text;
    warnings.push(...r.warnings);
    format = 'zip';
  } else if (ext === 'pdf') {
    throw new Error('暂不支持 PDF。请先用 Word / Calibre 另存为 .epub、.docx 或 .txt 再导入');
  } else if (ext === 'md' || ext === 'markdown') {
    const d = decodeBufferSmart(buf);
    text = markdownToText(d.text);
    encoding = d.encoding;
    format = 'markdown';
  } else {
    const d = decodeBufferSmart(buf);
    text = d.text;
    encoding = d.encoding;
    format = 'txt';
  }

  const parsed = parseNovelChapters(text);
  warnings.push(...parsed.warnings);

  return {
    chapters: parsed.chapters,
    format,
    encoding,
    metaTitle,
    strategy: parsed.strategy,
    warnings,
  };
}
