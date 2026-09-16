// ======== chapter-text-cleaner.ts ========
// 章节文本清理 —— 仅清除 AI 技术垃圾，绝不干涉文学内容。
// 保留：原段落结构、原对话格式、原叙事视角、原排版节奏。
// 清除：<think/> 思考标签、<entity/> 实体标签、Markdown 代码块、JSON 泄漏、控制字符。

// 注：sanitizeChapterDelta 仍依赖 collapseCjkSpacing（清全角空格），故保留该辅助函数。
// ======== 中文小说排版回流（novel-format-reflow）========
// 目的：把模型返回或流式拼接产生的"每行 1-2 个汉字 / 标点跑在行首"的坏排版，
//       还原为『段首空两格 + 段内自然句流 + 段与段间空一行』的正常中文小说格式。
function countCJK(s: string): number {
  // 统计中日韩统一汉字字符数（含假名/谚文基本区），不包括标点、数字、拉丁
  return (s.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/g) || []).length;
}
function isFormattingBreak(line: string): boolean {
  // 段与段的语义分隔：全句仅是分隔线、空行、或明显 HTML/Markdown 块（非正文）
  const t = line.trim();
  if (!t) return true;
  return /^[-—_＊*=·•\s]{4,}$/.test(t) || /^\[.*\]$/.test(t) || /^(第\s*\d+\s*[章回節篇集卷].*)$/.test(t);
}
// ============================================================
// 【CJK 间距压缩器】：清除模型乱塞在字/词/标点之间的"全角空格 U+3000 × N"，
// 同时保留：段首缩进最后由段后处理统一加；英文/数字 与 中文 之间保留 1 个半角空格。
// ============================================================
function collapseCjkSpacing(input: string): string {
  if (!input) return input;
  // 1. 统一：U+3000（全角空格）/ Tab / 不换行空格 / 零宽空格 → 普通半角空格
  let s = input.replace(/[\u3000\t\u00A0\u200B\u200C\u200D\uFEFF]/g, ' ');
  // 2. 连续 ≥2 个半角空格先压为 1 个（后续按上下文删/留）
  s = s.replace(/ {2,}/g, ' ');
  // 3. CJK 字符（含扩展 A 区、假名、谚文）↔ CJK 字符之间的半角空格：删除
  const CJK = '[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]';
  //    (CJK) SP (CJK) → 粘
  s = s.replace(new RegExp('(' + CJK + ') (' + CJK + ')', 'g'), '$1$2');
  //    再来一遍，处理 3 个以上连续 CJK 被空格隔开的情况（贪婪一次可能漏）
  s = s.replace(new RegExp('(' + CJK + ') (' + CJK + ')', 'g'), '$1$2');
  // 4. CJK ↔ 中文标点（，。！？!?；：、…—“”‘’《》【】（）「」『』、）之间的空格：删除
  const CN_PUNCT = '[，。！？!?；：、…—“”‘’「」『』《》【】（）\(\)\[\]\.,;:]';
  s = s.replace(new RegExp('(' + CJK + ') (' + CN_PUNCT + ')', 'g'), '$1$2');
  s = s.replace(new RegExp('(' + CN_PUNCT + ') (' + CJK + ')', 'g'), '$1$2');
  // 5. 标点 ↔ 标点 之间的空格：删除
  s = s.replace(new RegExp('(' + CN_PUNCT + ') (' + CN_PUNCT + ')', 'g'), '$1$2');
  // 6. 英文/数字 ↔ CJK：保留 1 个半角空格（上面压 1 步已经是 1 个，不要再删；若没空格也不硬加）
  //    若被空格隔开的是 "中文 英文" 或 "英文 中文" → 保留 1 个
  //    注意：这里不主动插入空格（避免把"iPhone14"拆开），只在已有空格时决定保/删，且保证是 1 个
  s = s.replace(new RegExp('(' + CJK + ') {2,}([A-Za-z0-9])', 'g'), '$1 $2');
  s = s.replace(new RegExp('([A-Za-z0-9]) {2,}(' + CJK + ')', 'g'), '$1 $2');
  // 7. 收尾：段中出现的孤立句间空格再保险压 1 次
  s = s.replace(new RegExp('(' + CJK + ') +(' + CJK + ')', 'g'), '$1$2');
  return s;
}
function normalizeInline(line: string): string {
  // 段内行级合并前的规整：先执行 CJK 间距压缩（清 U+3000 / Tab / 字间乱空格）
  let s = collapseCjkSpacing(line);
  return s;
}
function novelFormatReflow(input: string): string {
  const raw = String(input || '');
  if (!raw) return '';
  // 0) 把 \r\n / \r 统一为 \n，压缩连续 3+ 空行为 2 空行（段分隔符）
  let s0 = raw.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
  // 1) 按段切开：以"\n\n"为段界，段界两侧为独立段落块
  const rawBlocks = s0.split('\n\n');
  const paragraphs: string[] = [];
  for (const rawBlock of rawBlocks) {
    if (!rawBlock) continue;
    const lines = rawBlock.split('\n');
    // 段内只有一行 → 原样（但还是做 inline 规整）
    if (lines.length === 1) {
      paragraphs.push(normalizeInline(lines[0]));
      continue;
    }
    // 段内多行 → 判断是否属于"碎字坏排版"：统计『≤5个 CJK 字符的连续行』是否占比高，或出现 ≥3 行碎字串
    const frags = lines.map((ln, i) => ({ i, ln, cjk: countCJK(ln), len: ln.length }));
    let consecutiveFrag = 0;
    let maxFrag = 0;
    let totalShort = 0;
    for (const f of frags) {
      const trimmed = f.ln.trim();
      const isShort = trimmed.length > 0 && (f.cjk <= 5 && f.len <= 8) && !isFormattingBreak(f.ln);
      if (trimmed && isShort) {
        consecutiveFrag++;
        maxFrag = Math.max(maxFrag, consecutiveFrag);
        totalShort++;
      } else if (trimmed) {
        consecutiveFrag = 0;
      }
    }
    const needMerge = maxFrag >= 3 || (totalShort >= 4 && totalShort >= lines.length * 0.4);
    let merged = '';
    for (let i = 0; i < lines.length; i++) {
      const cur = normalizeInline(lines[i].replace(/^ +/, ''));
      if (!cur.trim()) continue;
      if (!merged) { merged = cur; continue; }
      // 合并规则：若上一行结尾不是句末标点、或这一行开头是中文标点 → 直接粘连；否则空一格
      const tailChar = merged.slice(-1);
      const headChar = cur.trimStart().slice(0, 1);
      const isHeadPunct = /^[，。！？!?；：、…—”’》）\]\.!?,;:_"']/.test(headChar);
      if (needMerge) {
        // 碎字坏排版 → 强行粘连，不插入任何空行空格
        merged = merged + cur.trimStart();
      } else if (isHeadPunct) {
        // 正常段中但这行以标点开头（中文标点/引号右半）→ 标点粘到上一行尾部
        merged = merged + cur.trimStart();
      } else if (/[，、：；—“‘《（\[]$/.test(tailChar)) {
        // 上一行末尾是半衔接标点（，、：；—「《（…）→ 这行是下半句 → 粘连
        merged = merged + cur.trimStart();
      } else if (/[。！？!?…”’》）\]]$/.test(tailChar)) {
        // 上一行以句末标点结尾 → 中文句间保留连续流
        merged = merged + cur.trimStart();
      } else {
        merged = merged + '\n' + cur;
      }
    }
    // 段内合并后再压一次重复标点 / 中英之间空格
    merged = normalizeInline(merged)
      .replace(/。。+/g, '。').replace(/，，+/g, '，').replace(/，。/g, '。').replace(/。，/g, '，')
      .replace(/[	 ]+/g, ' ').trim();
    if (!merged) continue;
    paragraphs.push(merged);
  }
  // 2) 段后处理：每段加段首空两格（段首的半角/全角空格一律先剥光，引号/书名号/括号对话开头则不加缩进，避免错位）
  const finalParas = paragraphs.map((p) => {
    let t = p.replace(/^[　 	]+/, '').trim();
    if (!t) return '';
    if (/^[“‘《（[(【〔「『·]/.test(t)) return t;
    return '　　' + t;
  }).filter(Boolean);
  return finalParas.join('\n\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, (m)=>m.slice(0, Math.min(1, m.length)));
}

// ======== 章节内部【桥段复述剔除 + 视角(POV)归一】工具（sanitizeChapterText 定稿阶段 5）========
function splitSentences(s: string): string[] {
  // 按。！？!?；… ~ 换行 / 中文引号闭合成对话 切句；保留尾部标点
  if (!s) return [];
  const res: string[] = [];
  let cur = '';
  let inQuote = 0; // 「」『』“” 引号深度
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    cur += ch;
    if ('「『“'.includes(ch)) inQuote++;
    if ('」』”'.includes(ch)) inQuote = Math.max(0, inQuote - 1);
    if (inQuote === 0 && '。！？!?；…'.includes(ch)) {
      const t = cur.trim();
      if (t) res.push(t);
      cur = '';
    } else if (ch === '\n' && cur.trim()) {
      const t = cur.trim();
      if (t) res.push(t);
      cur = '';
    }
  }
  const t = cur.trim();
  if (t) res.push(t);
  return res;
}
function normalize4Sim(s: string): string {
  // 做 2-gram/词袋 的归一化：去标点/空白/常见人称代词外壳/数字，只保留剧情语义骨架（人名/地名/名词/动词）
  return (s || '')
    // 先把引号里的对白原文也保留（但去掉引号外壳）
    .replace(/[「」『』"“”‘'()（）【】[]《》]/g, '')
    .replace(/[，。！？!?；：、…—·,\.\-\s\t\u3000\/\\_=+*#@$%^&<>{}|~\d]+/g, '')
    .trim();
}
function jaccardAB(a: string, b: string): number {
  const sa = new Set<string>();
  const sb = new Set<string>();
  const na = normalize4Sim(a);
  const nb = normalize4Sim(b);
  if (!na || !nb) return 0;
  for (let i = 0; i < na.length - 1; i++) sa.add(na[i] + na[i + 1]);
  for (let i = 0; i < nb.length - 1; i++) sb.add(nb[i] + nb[i + 1]);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const uni = sa.size + sb.size - inter;
  return uni === 0 ? 0 : inter / uni;
}
// ===== POV 判定三步防护：对白剔除 + 模板句剔除 + 人称密度 =====
// 统计 CJK 字数（用于模板句"是否真章末兜底"判定）
// 剔除 CUT_OFF_PICK 模板句，避免模板句中残留「我/他」污染 POV 判定
function stripPovNoiseByPick(text: string, pickList: readonly string[]): string {
  if (!text) return '';
  let s = String(text);
  for (const pk of pickList) if (pk) s = s.split(pk).join(' ');
  return s;
}
// 剔除引号内对白内容（人物说话不计入叙事视角 POV，只统计叙述部分的人称）
function stripDialogue(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/「[^」\n]*?」/g, ' ')
    .replace(/『[^』\n]*?』/g, ' ')
    .replace(/"[^"\n]*?"/g, ' ')
    .replace(/“[^”\n]*?”/g, ' ');
}
type Pov = 'first' | 'third' | 'none';
function blockPovTag(block: string, cutOffPickList: readonly string[] = []): { pov: Pov; firstCount: number; thirdProper: number } {
  if (!block) return { pov: 'none', firstCount: 0, thirdProper: 0 };
  // 核心修复：先去对白→再去模板句→再统计人称代词，避免误判 POV 漂移
  const cleanBlock = stripDialogue(stripPovNoiseByPick(block, cutOffPickList));
  const first = (cleanBlock.match(/(^|[^\w])[我咱俺](?!们)|我的|俺的|咱的|老子/g) || []).length;
  const thirdHe = (cleanBlock.match(/[他她它]|他们|她们/g) || []).length;
  const proper = (cleanBlock.match(/[一-鿿]{2,4}(?=[的了在把被将向想对去到走去说喊问道看吃听见掏出掏出])/g) || []).length;
  const thirdProper = thirdHe + proper;
  let pov: Pov = 'none';
  if (first === 0 && thirdProper === 0) pov = 'none';
  else if (first >= thirdProper + 2) pov = 'first';
  else if (thirdProper >= first + 1) pov = 'third';
  else pov = 'none';
  return { pov, firstCount: first, thirdProper };
}

interface DedupResult {
  content: string;
  droppedBlocks: number;
  pickedDropped: number;
  firstBlockMerges: number;
}
/**
 * D-1 核心逻辑：
 *  (1) 全文按 

 切段，段作为 block。
 *  (2) 对所有 block 做 POV 投票 → 得 POV_MAJORITY（整章应该是 第一人称 还是 第三人称）。
 *  (3) 维护一个『已出现剧情骨架』列表：对每个 block 按 4 句一组做滑动窗，归一化 Jaccard 对比所有已登记窗，若 ≥0.62 且该 block POV ≠ majority → 判定为"复演桥段"，整个 block 删除。
 *  (4) CUT_OFF_PICK 正文多插剔除：扫描全文，若同一句 cutOffPick 在正文内出现 ≥2 次，保留最后一次（若最后一次位于全文最末 ≤3 句则作为章末兜底保留），其余全部就地抹掉（含其前后标点换行一并补顺）。
 */
function dedupBridgeAndPov(raw: string, cutOffPickList: readonly string[]): DedupResult {
  if (!raw) return { content: raw, droppedBlocks: 0, pickedDropped: 0, firstBlockMerges: 0 };
  let blocks = raw.split('\n\n').map((b) => b.trim()).filter(Boolean);
  if (blocks.length === 0) return { content: raw, droppedBlocks: 0, pickedDropped: 0, firstBlockMerges: 0 };

  // ===== (a) 段内 POV 漂移自动切片（intra-block POV split）=====
  const SCENE_CHANGE_HINTS = /海风|天色|回到|走进|推开|木棚|码头|屋里|外面|滩涂|破|天已经|灯|暮色|路灯/;
  const splitBlocks: string[] = [];
  for (const blk of blocks) {
    const sents = splitSentences(blk);
    if (sents.length <= 4) { splitBlocks.push(blk); continue; }
    let cursor = 0;
    let lastPov: Pov = 'none';
    let firstWin = true;
    for (let i = 0; i < sents.length; i += 2) {
      const win = sents.slice(i, i + 4).join(' ');
      const { pov } = blockPovTag(win, cutOffPickList);
      if (pov === 'none') continue;
      if (firstWin) { lastPov = pov; firstWin = false; continue; }
      const explicitFlip =
        (lastPov === 'first' && pov === 'third') ||
        (lastPov === 'third' && pov === 'first');
      const leadSent = sents[Math.max(0, i - 1)] || sents[i] || '';
      const hasSceneChange = SCENE_CHANGE_HINTS.test(leadSent) || /[。！？!?；…]$/.test(leadSent || '');
      if (explicitFlip && hasSceneChange && i - cursor >= 3) {
        const chunk = sents.slice(cursor, i).join('');
        if (chunk.trim()) splitBlocks.push(chunk.trim());
        cursor = i;
        lastPov = pov;
      } else if (pov !== 'none') {
        lastPov = pov;
      }
    }
    const tail = sents.slice(cursor).join('');
    if (tail.trim()) splitBlocks.push(tail.trim());
  }
  blocks = splitBlocks;

  // (2) POV 多数投票
  let first = 0;
  let third = 0;
  for (const b of blocks) {
    const t = blockPovTag(b, cutOffPickList);
    first += t.firstCount;
    third += t.thirdProper;
  }
  let POV_MAJORITY: Pov = 'none';
  if (first > third + 3) POV_MAJORITY = 'first';
  else if (third > first + 1) POV_MAJORITY = 'third';

  // (3) 剧情骨架登记
  const seenSkeletons: string[] = [];
  const registerBlockSkeletons = (block: string) => {
    const sents = splitSentences(block);
    for (let i = 0; i < sents.length; i += 2) {
      const win = sents.slice(i, i + 4).join(' ');
      if (win.length >= 40) seenSkeletons.push(normalize4Sim(win));
    }
  };
  const simScore = (a: string, b: string): number => {
    if (!a || !b) return 0;
    let inter = 0;
    const sa = new Set<string>();
    const sb = new Set<string>();
    for (let j = 0; j < a.length - 1; j++) sa.add(a[j] + a[j + 1]);
    for (let j = 0; j < b.length - 1; j++) sb.add(b[j] + b[j + 1]);
    for (const x of sa) if (sb.has(x)) inter++;
    const uni = sa.size + sb.size - inter;
    return uni === 0 ? 0 : inter / uni;
  };
  const maxDupScore = (block: string): { score: number; hitWin: string } => {
    const sents = splitSentences(block);
    if (sents.length < 3) return { score: 0, hitWin: '' };
    let maxJ = 0; let hit = '';
    for (let i = 0; i < sents.length; i += 2) {
      const win = sents.slice(i, i + 4).join(' ');
      if (win.length < 50) continue;
      const nwin = normalize4Sim(win);
      for (const sk of seenSkeletons) {
        const j = simScore(nwin, sk);
        if (j > maxJ) { maxJ = j; hit = win.slice(0, 60); }
      }
    }
    return { score: maxJ, hitWin: hit };
  };

  const kept: string[] = [];
  let droppedBlocks = 0;
  const keptOriginal = blocks.length;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b) continue;
    const { pov } = blockPovTag(b, cutOffPickList);
    const povMismatch = POV_MAJORITY !== 'none' && pov !== 'none' && pov !== POV_MAJORITY;
    if (i === 0) { registerBlockSkeletons(b); kept.push(b); continue; }
    const { score } = maxDupScore(b);
    // ===== (b) 放宽判定 =====
    //  情况1：POV 冲突 + Jaccard >= 0.60 → 复演桥段，剔除
    //  情况2：即使 POV 不冲突，Jaccard >= 0.72（极高相似度）→ 也剔除
    const drop =
      (povMismatch && score >= 0.60) ||
      (score >= 0.72);
    if (drop) { droppedBlocks++; continue; }
    registerBlockSkeletons(b);
    kept.push(b);
  }
  void SCENE_CHANGE_HINTS;

  // (4) CUT_OFF_PICK 多插剔除（v8：章末兜底三条件，否则段内全删）
  //   保留 1 次的充要条件（三条件 AND）：
  //     ① 最后一次出现在距章末 ≤120 字 内
  //     ② 位于最后一自然段中
  //     ③ 模板句结束后，剩余正文字数（CJK）≤ 60（否则只是段中间的污染套话，不是章末兜底）
  //   任何条件不满足 → keepIdx=-1，所有出现全部就地抹掉
  let out = kept.join('\n\n');
  let pickedDropped = 0;
  for (const pick of cutOffPickList) {
    if (!pick) continue;
    const idxs: number[] = [];
    let pos = 0;
    while ((pos = out.indexOf(pick, pos)) !== -1) { idxs.push(pos); pos += pick.length; }
    if (idxs.length === 0) continue;
    const END_WINDOW = 120;
    const last = idxs[idxs.length - 1];
    const nearEnd = last >= out.length - END_WINDOW;
    const lastParaStart = out.lastIndexOf('\n\n');
    const inLastPara = lastParaStart === -1 || last >= lastParaStart + 2;
    const tailAfter = out.slice(last + pick.length);
    const tailCjk = countCJK(tailAfter);
    const isTrueChapterEnding = tailCjk <= 60;
    const canKeepLast = nearEnd && inLastPara && isTrueChapterEnding;
    const keepIdx: number = canKeepLast ? last : -1;
    const toRemove = (keepIdx === -1 ? idxs.slice() : idxs.filter((i) => i !== keepIdx)).sort((a, b) => b - a);
    for (const i of toRemove) {
      let start = i;
      let end = i + pick.length;
      while (end < out.length && /[，。！？!?；：、…—\.\,!?;:\-_ 　\t\n]/.test(out[end])) end++;
      let atePunctBack = 0;
      while (start > 0 && /[ 　\t\n]/.test(out[start - 1])) start--;
      while (start > 0 && atePunctBack < 2 && /[，。！？!?；：、…—\.\,!?;:_\-]/.test(out[start - 1])) { start--; atePunctBack++; }
      out = out.slice(0, start) + out.slice(end);
      pickedDropped++;
    }
  }
  out = out.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  out = out.replace(/。。+/g, '。').replace(/，，+/g, '，').replace(/，。/g, '。').replace(/。，/g, '，');
  return { content: out, droppedBlocks, pickedDropped, firstBlockMerges: keptOriginal - kept.length };
}

function escapeRegex(s: string): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function countMatches(s: string, re: RegExp): number {
  try {
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    const m = String(s || '').match(new RegExp(re.source, flags));
    return m ? m.length : 0;
  } catch { return 0; }
}

/**
 * 章节文本清理 —— 仅清除 AI 技术垃圾，绝不干涉文学内容。
 * 保留：原段落结构、原对话格式、原叙事视角、原排版节奏。
 * 清除：<think/> 思考标签、<entity/> 实体标签、Markdown 代码块、JSON 泄漏、控制字符、过多空行。
 */
export function sanitizeChapterText(
  input: string,
  _streamingHint = false,
  _opts?: { protagonistName?: string | null; thirdPerson?: boolean },
): string {
  if (!input) return '';

  let text = input;

  // 1. 清除 <think>...</think> 思考链标签
  text = text.replace(/<think[\s\S]*?<\/think\s*>/gi, '');

  // 2. 清除 <entity>...</entity> 实体标签（成对 + 残留单边）
  text = text.replace(/<entity[^>]*>[\s\S]*?<\/entity\s*>/gi, '');
  text = text.replace(/<entity[^>]*>/gi, '');
  text = text.replace(/<\/entity\s*>/gi, '');

  // 3. 清除模型泄漏的 entity JSON 片段（□entity□[...]□ / Entity[]{}[] 等）
  text = text.replace(/[□▢▣■]*\s*entity\s*[□▢▣■]*\s*\[[\s\S]*?\]\s*[□▢▣■]*/gi, '');
  text = text.replace(/[□▢▣■]*\s*entity\s*[□▢▣■]*\s*\[[^\n\r。！？]*$/gi, '');
  text = text.replace(/[□▢▣■]\s*(?:entity|people|place|item|scene)\s*[□▢▣■]/gi, '');
  text = text.replace(/(?:Entity|entity)\s*\[\]\s*(\{[\s\S]*?\})\s*\[\]/g, (_full, payload) => {
    const nameMatch = String(payload).match(/["'](?:fictional_character|character|name|people|person|role)["']\s*:\s*["']([^"']{1,40})["']/i);
    return nameMatch?.[1] || '';
  });
  text = text.replace(/["'](?:fictional_character|character|name|people|place|item|scene|entity)["']\s*:\s*["'][^"']*["']\s*,?/gi, '');

  // 4. 清除直接混入正文的 JSON / Markdown / 代码围栏
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/^\s*```(?:json|ts|js|javascript|typescript|markdown)?\s*$/gim, '');
  text = text.replace(/^\s*["']?(?:people|place|item|scene|entity|content|summary|hook)["']?\s*:\s*[\s\S]*?(?=\n\n|$)/gim, '');
  text = text.replace(/^\s*[\[{]\s*["'](?:people|place|item|scene|entity)["'][\s\S]*?[\]}]\s*$/gim, '');

  // 5. 清除控制字符 + 行尾空格
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  text = text.replace(/[ \t]+\n/g, '');

  // 6. 压缩过多空行：4+ 空行 → 2 空行（段分隔）
  text = text.replace(/\n{4,}/g, '\n\n');

  // 7. 首尾 trim
  text = text.replace(/^\n+|\n+$/g, '').trim();

  return text;
}

export function sanitizeChapterDelta(rawText: string, sentLength: number, streamingHint = true): { cleanText: string; delta: string; sentLength: number } {
  const cleanText = sanitizeChapterText(rawText, streamingHint);
  const safeSentLength = Math.min(sentLength, cleanText.length);
  let delta = cleanText.slice(safeSentLength);
  // 流式 CJK 间距压缩保险：delta 里有全角空格/Tab/连续半角空格时再揉平一次
  try {
    if (/　|	/.test(delta) || delta.includes('  ')) {
      const pre = delta.match(/^(s+)/)?.[1] || '';
      const body = delta.slice(pre.length);
      if (body) delta = pre + collapseCjkSpacing(body);
    }
  } catch {}
  return { cleanText, delta, sentLength: cleanText.length };
}

export function containsInternalMarkup(input: string): boolean {
  if (!input) return false;
  return /(?:<entity|<\/entity|[□▢▣■]\s*entity|entity\s*[□▢▣■]|Entity\s*\[\]|fictional_character|```|^\s*["']?(?:people|place|item|scene|entity)["']?\s*:)/im.test(input);
}
