/**
 * 统一 @提及规则库 v2（isomorphic，可被前端组件与后端 API 路由共用）
 *
 * 解决四类问题：
 *  1. 遗漏：出场角色/所在场景/互动道具没有 @ → 参考图漏挂载
 *  2. 文字差异：AI 使用简称/别称/错字/自造名（如 "@铁皮养殖箱" vs 登记名 "铁皮棚养殖区"）→ @无法解析
 *  3. 中文粘连：中文无空格，旧规则「@ 后吃到标点为止」会把动词/方位词吃进名字
 *     （"@纪凡赛尔站在" "@锈港码头破旧摊位内" "@岩洞背景"），实测占失效 @ 的绝大多数
 *  4. 长名被拆：登记名互为子串时（橘猫蛋子/蛋子、养殖箱钥匙串/钥匙串），
 *     AI 把长名写成 "@橘猫@蛋子" "@养殖箱@钥匙串"，两个短名各自挂错图
 *
 * 解析管线（applyAtRules）：
 *  Pass 0  相邻 @ 合并：@A@B 且 A+B 构成更长登记名时合并（@橘猫@蛋子 → @橘猫蛋子）
 *  Pass 1  @ token 解析：精确 → 别名 → 最长登记名前缀（切掉粘连后缀）→ 错字容错 → 简称包含
 *  Pass 2  漏 @ 补 @：长名优先单趟扫描，已 @ 区域用占位符保护
 *  Pass 3  覆盖补齐：必 @ 但仍缺失的资产程序化追加（可选，调用 ensureMentions）
 *  幂等：对结果再次执行不会变化。
 */

export type AtAssetType = 'character' | 'scene' | 'item';

export interface AtAsset {
  id?: string;
  /** 资产登记名（唯一权威名称，提示词中 @ 必须与此逐字一致） */
  name: string;
  type: AtAssetType;
  imageUrl?: string;
  /** 角色备用参考图（referenceImages 解析后） */
  extraImages?: string[];
  /** 别名/别称（AI 常用的简称、外号、旧名）。@ 后写别名也会被解析到本资产 */
  aliases?: string[];
}

export type AtIssueKind = 'unresolved' | 'ambiguous' | 'missing' | 'conflict';

export interface AtIssue {
  kind: AtIssueKind;
  /** unresolved / ambiguous：无法唯一识别的 @ 后原始文字 */
  token?: string;
  /** missing：应出现但未 @ 的资产；conflict：卷入登记名冲突的资产 */
  asset?: AtAsset;
  message: string;
  /** ambiguous：候选登记名 */
  candidates?: string[];
}

interface IndexedAsset {
  asset: AtAsset;
  /** 登记名原文 */
  canonical: string;
  /** 标准化登记名 */
  norm: string;
  /** 标准化别名 */
  aliasesNorm: string[];
  /** 别名原文（用于剧本文本检测） */
  aliasesRaw: string[];
}

export type AtMatchVia = 'exact' | 'alias' | 'prefix' | 'typo' | 'abbrev';

export interface AtMatch {
  entry: IndexedAsset;
  /** 从原文中消耗的字符数（用于切掉粘连的后缀，如 "@纪凡赛尔站在" 消耗 4） */
  consumed: number;
  via: AtMatchVia;
  /** 歧义候选（同一 via 下有多个势均力敌的匹配） */
  ambiguous?: IndexedAsset[];
}

/**
 * @ 后跟随的名字：吃到空白/标点/反斜杠为止。
 * 注意：括号 NOT 排除 — 登记名允许括号注释（如「纪凡赛尔（男主）」）。
 * 名字末尾若粘连了正文（@铁皮棚养殖区里），由 matchAt 里的「最长前缀切分」处理。
 * 反斜杠必须排除：分镜提示词常以 JSON 字符串形式存储（\"、\n 转义），
 * 若不排除会把 \" 一起吞进名字（"@影子\"" → 影子\）。
 */
const AT_TOKEN_REGEX = /@([^\s@\\,，。．\.！？!？\[\]【】{}、;；:："'“”‘’<>«»\/／|｜]+)/g;

/** 登记名错字容错：name 越长允许的编辑距离越大 */
function typoBudget(nameLen: number): number {
  if (nameLen < 4) return 0;
  if (nameLen < 8) return 1;
  return 2;
}

/** Levenshtein 编辑距离（双行 DP，输入已标准化为短字符串） */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[b.length];
}

function escapeRegex(str: string): string {
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * 名称标准化：全角→半角、去括号注释、斜杠取前段、去空白与标点、小写。
 * 用于名称一致性比较，不用于展示。
 */
export function normalizeName(input: string | undefined | null): string {
  if (!input) return '';
  let s = String(input);
  // 全角 ASCII（！～ ｀）转半角
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.replace(/　/g, ' ');
  // 去括号注释：（男主）/(男主)/【主角】/[备注]
  s = s.replace(/[（(\[【][^）)\]】]*[）)\]】]/g, '');
  // 斜杠/竖线取前段（场景标题如 "铁皮棚内 / 夜色降临" → "铁皮棚内"）
  s = s.split(/[\/／|｜]/)[0];
  // 去空白与常见标点（含间隔号 ·，使 "纪凡·赛尔" 与 "纪凡赛尔" 等价）
  s = s.replace(/[\s,，。、；;：:!！?？"'“”‘’~～·…—\-_]/g, '');
  return s.toLowerCase();
}

/**
 * 在原始文本片段中，找到「标准化后恰好等于 entryNorm」的最短前缀长度。
 * 用于把 "@纪凡赛尔站在" 切分为 "@纪凡赛尔" + "站在"，同时兼容名字内部含标点的情况。
 * @returns 消耗的字符数；-1 表示不匹配
 */
function consumedForPrefix(raw: string, entryNorm: string): number {
  let acc = '';
  for (let i = 0; i < raw.length; i++) {
    const nn = normalizeName(acc + raw[i]);
    if (nn.length > entryNorm.length) break;
    if (!entryNorm.startsWith(nn)) break;
    acc += raw[i];
    if (nn === entryNorm) return acc.length;
  }
  return -1;
}

/** 解析角色 referenceImages 字段（JSON 数组 / JSON 字符串 / 逗号分隔） */
export function parseReferenceImages(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((x: any) => String(x).trim()).filter(Boolean);
    } catch { /* 逗号分隔兜底 */ }
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

/** 解析别名字段（JSON 数组 / JSON 字符串 / 顿号逗号分隔） */
export function parseAliases(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((x: any) => String(x).trim()).filter(Boolean);
    } catch { /* 分隔符兜底 */ }
    return s.split(/[,，、;；\/｜|]/).map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

/** 由数据库角色/场景/物品行构建 AtAsset 列表（自动解析角色多参考图与别名） */
export function buildAtAssets(
  characters: any[] | undefined | null,
  scenes: any[] | undefined | null,
  items: any[] | undefined | null,
): AtAsset[] {
  const assets: AtAsset[] = [];
  for (const c of characters || []) {
    if (!c?.name) continue;
    assets.push({
      id: c.id, name: String(c.name).trim(), type: 'character',
      imageUrl: c.imageUrl || '',
      extraImages: parseReferenceImages(c.referenceImages),
      aliases: parseAliases(c.aliases ?? c.aliasNames ?? c.alias),
    });
  }
  for (const s of scenes || []) {
    if (!s?.name) continue;
    assets.push({
      id: s.id, name: String(s.name).trim(), type: 'scene', imageUrl: s.imageUrl || '',
      aliases: parseAliases(s.aliases ?? s.aliasNames ?? s.alias),
    });
  }
  for (const i of items || []) {
    if (!i?.name) continue;
    assets.push({
      id: i.id, name: String(i.name).trim(), type: 'item', imageUrl: i.imageUrl || '',
      aliases: parseAliases(i.aliases ?? i.aliasNames ?? i.alias),
    });
  }
  return assets;
}

/** 资产参考图列表：主图在前，备用参考图随后，去重 */
export function getAssetRefImages(asset: AtAsset): string[] {
  const urls = [asset.imageUrl, ...(asset.extraImages || [])].map((u) => (u || '').trim()).filter(Boolean);
  return [...new Set(urls)];
}

/** 登记名冲突：两个登记名标准化后存在子串关系（如 橘猫蛋子 / 蛋子） */
export interface AtNameConflict {
  longer: AtAsset;
  shorter: AtAsset;
  kind: 'same' | 'substring';
}

/**
 * 检测资产表中的登记名冲突。
 * 冲突是「@ 不严谨」的源头之一：AI 会把长名拆成 "@短名1@短名2"，或在不同分镜里随机选用长短名。
 */
export function detectNameConflicts(assets: AtAsset[]): AtNameConflict[] {
  const list = (assets || [])
    .map((a) => ({ asset: a, norm: normalizeName(a.name), name: String(a.name || '').trim() }))
    .filter((x) => x.norm);
  const out: AtNameConflict[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      const a = list[i], b = list[j];
      if (a.norm === b.norm) {
        // 完全同名（不同类型）——只在 i<j 时记录一次
        if (i < j) out.push({ longer: a.asset, shorter: b.asset, kind: 'same' });
      } else if (a.norm.length > b.norm.length && a.norm.includes(b.norm)) {
        out.push({ longer: a.asset, shorter: b.asset, kind: 'substring' });
      }
    }
  }
  return out;
}

/**
 * @ 提及索引：登记名 → 资产
 * 支持 精确 / 别名 / 最长前缀（切中文粘连）/ 错字容错 / 简称包含 五级召回。
 */
export class AtMentionIndex {
  private byNorm = new Map<string, IndexedAsset>();
  private byNormAll = new Map<string, IndexedAsset[]>();
  private entries: IndexedAsset[] = [];

  constructor(assets: AtAsset[]) {
    for (const asset of assets || []) {
      const canonical = String(asset.name || '').trim();
      const norm = normalizeName(canonical);
      if (!canonical || !norm) continue;
      const aliasesRaw = new Set<string>();
      for (const al of asset.aliases || []) {
        const t = String(al || '').trim();
        if (t) aliasesRaw.add(t);
      }
      // 自动派生别名：去括号注释后的原名（如 "纪凡赛尔（男主）" → "纪凡赛尔"）
      const debracketed = canonical
        .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, '')
        .split(/[\/／|｜]/)[0]
        .trim();
      if (debracketed && debracketed !== canonical) aliasesRaw.add(debracketed);
      // 自动派生别名：括号内注释内容（如 "纪凡赛尔（男主）" → "男主"）
      for (const m of canonical.matchAll(/[（(\[【]([^）)\]】]+)[）)\]】]/g)) {
        const content = (m[1] || '').trim();
        if (content && content.length >= 1) aliasesRaw.add(content);
      }
      // 斜杠/竖线后半段作为别名（如 "铁皮棚内 / 夜色降临" → 登记名取前段，但"夜色降临"也可以作为场景描述别名匹配）
      const slashParts = canonical.split(/[\/／|｜]/).map(s => s.trim()).filter(Boolean);
      for (let i = 1; i < slashParts.length; i++) aliasesRaw.add(slashParts[i]);

      const aliasesNorm = new Set<string>();
      for (const al of aliasesRaw) {
        const an = normalizeName(al);
        if (an && an !== norm) aliasesNorm.add(an);
      }
      const entry: IndexedAsset = {
        asset: { ...asset, name: canonical },
        canonical, norm,
        aliasesNorm: [...aliasesNorm], aliasesRaw: [...aliasesRaw],
      };
      this.entries.push(entry);
      if (!this.byNorm.has(norm)) this.byNorm.set(norm, entry);
      const bucket = this.byNormAll.get(norm) || [];
      bucket.push(entry);
      this.byNormAll.set(norm, bucket);
    }
    // 长名优先：扫描与替换时先匹配长名，避免短名截断长名（如 "橘猫蛋子" 被 "蛋子" 截断）
    this.entries.sort((a, b) => b.canonical.length - a.canonical.length);
  }

  /** 资产列表（长名优先顺序） */
  list(): IndexedAsset[] { return this.entries; }

  /** 全部登记名（长名优先） */
  canonicalNames(): string[] { return this.entries.map((e) => e.canonical); }

  /** 从 raw 开头起，能匹配到的最长登记名（供相邻 @ 合并使用） */
  longestNameStartingWith(raw: string): { canonical: string; consumed: number } | null {
    for (const e of this.entries) {
      const c = consumedForPrefix(raw, e.norm);
      if (c > 0) return { canonical: e.canonical, consumed: c };
    }
    for (const e of this.entries) {
      for (let k = 0; k < e.aliasesRaw.length; k++) {
        const c = consumedForPrefix(raw, e.aliasesNorm[k]);
        if (c > 0) return { canonical: e.canonical, consumed: c };
      }
    }
    return null;
  }

  /**
   * 解析一个 @ 后文本。
   * 优先级：精确 → 别名 → 最长前缀（切粘连后缀）→ 错字容错 → 简称包含。
   * @returns null 表示无法识别
   */
  matchAt(rawToken: string, contextText?: string): AtMatch | null {
    const raw = String(rawToken || '');
    const t = normalizeName(raw);
    if (!t) return null;

    // helper: 在 consumed 基础上延伸，吃掉紧跟的括号注释（norm 匹配长度 ≤ canonical 原文长度时需要）
    const extend = (consumed: number): number => {
      let i = consumed;
      // 向前吃掉所有连续的括号组（支持 "(xxx)" 和 "（xxx）"）
      while (i < raw.length) {
        const ch = raw[i];
        if ((ch === '(' || ch === '（')) {
          let depth = 1;
          i++;
          while (i < raw.length && depth > 0) {
            if (raw[i] === '(' || raw[i] === '（') depth++;
            else if (raw[i] === ')' || raw[i] === '）') depth--;
            i++;
          }
        } else break;
      }
      return i;
    };

    // 1. 登记名精确
    const exact = this.byNorm.get(t);
    if (exact) {
      const base = consumedForPrefix(raw, exact.norm) || raw.length;
      return { entry: exact, consumed: extend(base), via: 'exact' };
    }

    // 2. 别名精确
    for (const e of this.entries) {
      if (e.aliasesNorm.includes(t)) {
        const base = consumedForPrefix(raw, e.norm) || raw.length;
        return { entry: e, consumed: extend(base), via: 'alias' };
      }
    }

    // 3. 最长登记名前缀：解决中文无空格造成的粘连（"@纪凡赛尔站在" "@锈港码头破旧摊位内"）
    const prefixHits: { e: IndexedAsset; consumed: number }[] = [];
    for (const e of this.entries) {
      if (raw.length < e.norm.length) continue;      // 长度不够，不可能含完整登记名前缀
      if (t[0] !== e.norm[0]) continue;              // 首字不同，直接跳过（重要剪枝）
      const c = consumedForPrefix(raw, e.norm);
      if (c > 0) prefixHits.push({ e, consumed: c });
    }
    if (prefixHits.length) {
      // 前缀命中时取最长（最具体）的登记名，如 "@岩洞秘密据点内" 命中 岩洞秘密据点 而非 岩洞
      prefixHits.sort((x, y) => y.e.norm.length - x.e.norm.length || y.consumed - x.consumed);
      return { entry: prefixHits[0].e, consumed: extend(prefixHits[0].consumed), via: 'prefix' };
    }

    // 4. 别名前缀
    const aliasPrefixHits: { e: IndexedAsset; consumed: number }[] = [];
    for (const e of this.entries) {
      for (let k = 0; k < e.aliasesNorm.length; k++) {
        const an = e.aliasesNorm[k];
        if (raw.length < an.length || t[0] !== an[0]) continue;
        const c = consumedForPrefix(raw, an);
        if (c > 0) { aliasPrefixHits.push({ e, consumed: c }); break; }
      }
    }
    if (aliasPrefixHits.length) {
      aliasPrefixHits.sort((x, y) => y.consumed - x.consumed);
      return { entry: aliasPrefixHits[0].e, consumed: extend(aliasPrefixHits[0].consumed), via: 'prefix' };
    }

    // 5. 错字容错：token 与登记名（或其前缀）编辑距离在预算内（"@铁棚养殖区内" → 铁皮棚养殖区）
    if (t.length >= 3) {
      const typoHits: { e: IndexedAsset; consumed: number; dist: number }[] = [];
      for (const e of this.entries) {
        const budget = typoBudget(e.norm.length);
        if (budget <= 0) continue;
        // 首字或次字需对齐，避免大面积误命中
        if (t[0] !== e.norm[0] && t[0] !== e.norm[1] && e.norm[0] !== t[1]) continue;
        for (let L = Math.max(2, e.norm.length - 1); L <= e.norm.length + 1; L++) {
          if (L > t.length) break;
          const slice = t.slice(0, L);
          const d = editDistance(slice, e.norm);
          if (d <= budget) { typoHits.push({ e, consumed: L, dist: d }); break; }
        }
      }
      if (typoHits.length) {
        typoHits.sort((x, y) => x.dist - y.dist || y.e.norm.length - x.e.norm.length);
        const best = typoHits[0];
        return { entry: best.e, consumed: extend(Math.min(best.consumed, raw.length)), via: 'typo' };
      }
    }

    // 6. 简称包含：token 是登记名的子串（"@橘猫" → 橘猫蛋子；"@锈港" → 锈港码头 / 锈港巷道 …）
    if (t.length >= 2) {
      const scored: { e: IndexedAsset; ratio: number }[] = [];
      for (const e of this.entries) {
        if (e.norm.length < 2) continue;
        if (!e.norm.includes(t)) continue; // 只接受 token 更短（简称/部分）的情况
        scored.push({ e, ratio: t.length / e.norm.length });
      }
      const aliasScored: { e: IndexedAsset; ratio: number }[] = [];
      for (const e of this.entries) {
        for (const an of e.aliasesNorm) {
          if (an.length < 2 || !an.includes(t)) continue;
          aliasScored.push({ e, ratio: t.length / an.length });
        }
      }
      const all = [...scored, ...aliasScored];
      if (all.length) {
        all.sort((x, y) => y.ratio - x.ratio);
        const best = all[0];
        const top = all.filter((x) => Math.abs(x.ratio - best.ratio) < 0.001);
        let chosen = best.e;
        if (top.length > 1) {
          // 多候选：先用同文本上下文消歧（文本中另行出现的登记名优先）
          const ctx = normalizeName(contextText || '');
          const inCtx = top.filter((x) => ctx && ctx.includes(x.e.norm));
          if (inCtx.length === 1) {
            chosen = inCtx[0].e;
          } else {
            // 唯一候选比例 ≥0.4 才采纳；多候选需 ≥0.5 且显著领先，否则判歧义（宁可不挂，也不挂错图）
            const second = all.find((x) => x.e !== best.e);
            const secondRatio = second?.ratio ?? 0;
            const ok = top.length === 1
              ? best.ratio >= 0.4
              : (best.ratio >= 0.5 && best.ratio - secondRatio >= 0.2);
            if (!ok) {
              return {
                entry: best.e, consumed: raw.length, via: 'abbrev',
                ambiguous: all.slice(0, 4).map((x) => x.e),
              };
            }
          }
        } else if (best.ratio < 0.4) {
          return {
            entry: best.e, consumed: raw.length, via: 'abbrev',
            ambiguous: [best.e],
          };
        }
        return { entry: chosen, consumed: raw.length, via: 'abbrev' };
      }
    }

    return null;
  }

  /** 兼容旧签名：解析 @ 后文本，返回资产或 null（不带粘连切分信息） */
  resolveToken(rawToken: string): { entry: IndexedAsset; fuzzy: boolean } | null {
    const m = this.matchAt(rawToken);
    if (!m) return null;
    return { entry: m.entry, fuzzy: m.via !== 'exact' && m.via !== 'alias' };
  }

  /** 按 id 或登记名取资产 */
  findByKey(key: string | undefined): AtAsset | null {
    if (!key) return null;
    const norm = normalizeName(key);
    const e = this.byNorm.get(norm) || this.entries.find((x) => x.asset.id === key);
    return e ? e.asset : null;
  }
}

export interface AtRuleResult {
  /** 规范化后的文本（@ 统一为 @登记名；无法识别的 @ 已降级为纯文本；漏 @ 的登记名已补 @） */
  text: string;
  /** 命中的资产（按首次出现顺序，去重） */
  mentions: AtAsset[];
  /** 问题列表（unresolved / ambiguous；missing 由 validateAtCoverage 补充） */
  issues: AtIssue[];
  /** 是否发生了改写 */
  changed: boolean;
}

const PLACEHOLDER_PREFIX = '\u0001@';
const PLACEHOLDER_SUFFIX = '\u0001';

/**
 * Pass 0：合并被拆开的长登记名。
 * "@橘猫@蛋子" → "@橘猫蛋子"（登记名 橘猫蛋子）
 * "@养殖箱@钥匙串" → "@养殖箱钥匙串"（登记名 养殖箱钥匙串）
 * "@纪凡赛尔@小丑鱼三妹" 不构成更长登记名，保持原样。
 */
export function mergeAdjacentAtTokens(text: string, index: AtMentionIndex): string {
  if (!text || !text.includes('@')) return text || '';
  const tokens: { start: number; end: number; raw: string }[] = [];
  AT_TOKEN_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AT_TOKEN_REGEX.exec(text)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length, raw: m[1] });
  }
  if (tokens.length < 2) return text;

  const edits: { start: number; end: number; replacement: string }[] = [];
  let i = 0;
  while (i < tokens.length - 1) {
    const a = tokens[i], b = tokens[i + 1];
    if (a.end === b.start) {
      const hit = index.longestNameStartingWith(a.raw + b.raw);
      // 只有「合并后吃掉的字符比 a 自身更长」才说明 b 的前半段属于同一个登记名
      if (hit && hit.consumed > a.raw.length) {
        // 被合并掉的名字字符在 b 中占 (consumed - a.raw.length) 个，注意 b.raw 从 b.start+1 开始
        const end = b.start + 1 + (hit.consumed - a.raw.length);
        edits.push({ start: a.start, end, replacement: `@${hit.canonical}` });
        // b 中未被合并进名字的后缀保留为纯文本
        const rest = (a.raw + b.raw).slice(hit.consumed);
        if (rest) edits.push({ start: end, end: b.end, replacement: rest });
        i += 2;
        continue;
      }
    }
    i += 1;
  }
  if (!edits.length) return text;

  let out = '';
  let cursor = 0;
  for (const e of edits.sort((x, y) => x.start - y.start)) {
    if (e.start < cursor) continue; // 区间重叠则跳过，保证安全
    out += text.slice(cursor, e.start) + e.replacement;
    cursor = e.end;
  }
  out += text.slice(cursor);
  return out;
}

/**
 * 对一段文本应用 @ 规则（规范化修复）：
 *  Pass 0：合并被拆开的长登记名
 *  Pass 1：已有 @token → 可识别则改写为 @登记名（修正文字差异 + 切掉粘连后缀）；不可识别则去掉 @（降级纯文本）
 *  Pass 2：未加 @ 的登记名（长名优先单趟扫描）自动补 @
 *  幂等：对结果再次执行不会变化。
 */
export function applyAtRules(text: string, index: AtMentionIndex): AtRuleResult {
  const issues: AtIssue[] = [];
  const mentions: AtAsset[] = [];
  const seen = new Set<string>();
  const addMention = (asset: AtAsset) => {
    const key = asset.id || asset.name;
    if (seen.has(key)) return;
    seen.add(key);
    mentions.push(asset);
  };

  if (!text) return { text: text || '', mentions, issues, changed: false };
  const original = text;

  // ── Pass 0：合并被拆开的长登记名 ──
  let work = mergeAdjacentAtTokens(text, index);

  // ── Pass 1：处理已有 @token（含粘连切分）──
  const replacements: { start: number; end: number; replacement: string; asset?: AtAsset }[] = [];
  AT_TOKEN_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AT_TOKEN_REGEX.exec(work)) !== null) {
    const token = m[1];
    const resolved = index.matchAt(token, work);
    if (resolved) {
      if (resolved.ambiguous && resolved.ambiguous.length > 1) {
        // 歧义：宁可不挂，也不挂错参考图；去掉 @ 保留原文，交由人工/上层处理
        replacements.push({ start: m.index, end: m.index + m[0].length, replacement: token });
        issues.push({
          kind: 'ambiguous', token,
          candidates: resolved.ambiguous.map((e) => e.canonical),
          message: `@${token} 可匹配多个登记名（${resolved.ambiguous.map((e) => e.canonical).join(' / ')}），无法确定，请改用完整登记名`,
        });
        continue;
      }
      const rest = token.slice(Math.min(resolved.consumed, token.length));
      replacements.push({
        start: m.index, end: m.index + m[0].length,
        replacement: `@${resolved.entry.canonical}${rest}`,
        asset: resolved.entry.asset,
      });
    } else {
      // 无法识别：去掉 @，保留原文（避免编造资产/错误挂参考图）；Pass2 可能在其子串上补回正确的 @
      replacements.push({ start: m.index, end: m.index + m[0].length, replacement: token });
      issues.push({
        kind: 'unresolved', token,
        message: `@${token} 无法匹配任何角色/场景/物品登记名（可能是别称、错字或自造名）`,
      });
    }
  }
  let out = '';
  let cursor = 0;
  for (const r of replacements.sort((a, b) => a.start - b.start)) {
    out += work.slice(cursor, r.start) + r.replacement;
    cursor = r.end;
    if (r.asset) addMention(r.asset);
  }
  out += work.slice(cursor);

  // ── Pass 2：漏 @ 的登记名自动补 @（已 @ 区域用占位符保护，避免重复加 @）──
  const entries = index.list();
  if (entries.length) {
    const protectedSpans: string[] = [];
    AT_TOKEN_REGEX.lastIndex = 0;
    let pm: RegExpExecArray | null;
    let shifted = '';
    let pCursor = 0;
    while ((pm = AT_TOKEN_REGEX.exec(out)) !== null) {
      const ph = `${PLACEHOLDER_PREFIX}${protectedSpans.length}${PLACEHOLDER_SUFFIX}`;
      protectedSpans.push(pm[0]);
      shifted += out.slice(pCursor, pm.index) + ph;
      pCursor = pm.index + pm[0].length;
    }
    shifted += out.slice(pCursor);

    const alternation = entries.map((e) => escapeRegex(e.canonical)).join('|');
    if (alternation) {
      const re = new RegExp(`(${alternation})`, 'g');
      shifted = shifted.replace(re, (matchedName: string) => {
        const entry = entries.find((e) => e.canonical === matchedName);
        if (!entry) return matchedName;
        addMention(entry.asset);
        return `@${matchedName}`;
      });
    }
    // 别名（未登记为 @ 的别称）也补 @，统一指向登记名
    // 注意：先用占位符保护 alternation 已标记的 @登记名 spans，避免 alias 在登记名内部命中
    // （例：alias "男主" 若在 alternation 标记的 "@纪凡赛尔（男主）" 内被命中，会产生嵌套 "@纪凡赛尔（@纪凡赛尔（男主））"）
    {
      const aliasProtected: string[] = [];
      let aliasCursor = 0;
      let aliasShifted = '';
      AT_TOKEN_REGEX.lastIndex = 0;
      let atm: RegExpExecArray | null;
      while ((atm = AT_TOKEN_REGEX.exec(shifted)) !== null) {
        const ph = `${PLACEHOLDER_PREFIX}ALIAS${aliasProtected.length}${PLACEHOLDER_SUFFIX}`;
        aliasProtected.push(atm[0]);
        aliasShifted += shifted.slice(aliasCursor, atm.index) + ph;
        aliasCursor = atm.index + atm[0].length;
      }
      aliasShifted += shifted.slice(aliasCursor);

      const aliasPairs: { alias: string; canonical: string }[] = [];
      for (const e of entries) for (const al of e.aliasesRaw) aliasPairs.push({ alias: al, canonical: e.canonical });
      aliasPairs.sort((a, b) => b.alias.length - a.alias.length);
      for (const { alias, canonical } of aliasPairs) {
        if (!alias || alias.length < 2) continue;
        const re = new RegExp(`(?<!@)(${escapeRegex(alias)})`, 'g');
        aliasShifted = aliasShifted.replace(re, (full: string) => {
          const entry = entries.find((e) => e.canonical === canonical);
          if (entry) addMention(entry.asset);
          return `@${canonical}`;
        });
      }
      // 还原 alternation 标记的 @登记名 spans
      shifted = aliasShifted.replace(new RegExp(`${PLACEHOLDER_PREFIX}ALIAS(\\d+)${PLACEHOLDER_SUFFIX}`, 'g'),
        (_full, idx: string) => aliasProtected[Number(idx)] ?? '');
    }

    out = shifted.replace(new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g'),
      (_full, idx: string) => protectedSpans[Number(idx)] ?? '');
  }

  return { text: out, mentions, issues, changed: out !== original };
}

/**
 * 多文本扫描：对若干字段分别应用 @ 规则，聚合去重后的提及资产与全部问题。
 * 用于视频结构化提示词（startFrame/endFrame/prompt/...）的整体校验。
 */
export function scanAtTexts(
  texts: (string | undefined | null)[],
  index: AtMentionIndex,
): { mentions: AtAsset[]; issues: AtIssue[] } {
  const mentions: AtAsset[] = [];
  const issues: AtIssue[] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    const r = applyAtRules(t, index);
    for (const asset of r.mentions) {
      const key = asset.id || asset.name;
      if (!seen.has(key)) { seen.add(key); mentions.push(asset); }
    }
    issues.push(...r.issues);
  }
  return { mentions, issues };
}

/**
 * 覆盖校验：期望资产（本镜头应出现的角色/场景/物品）是否都被 @。
 * 返回 missing 类问题。
 */
export function validateAtCoverage(
  mentions: AtAsset[] | AtRuleResult,
  expected: AtAsset[],
): AtIssue[] {
  const mentionList = Array.isArray(mentions) ? mentions : mentions.mentions;
  const mentionedKeys = new Set(mentionList.map((a) => a.id || a.name));
  const missing: AtIssue[] = [];
  for (const asset of expected) {
    const key = asset.id || asset.name;
    if (!mentionedKeys.has(key)) {
      missing.push({
        kind: 'missing', asset,
        message: `本镜头涉及的${asset.type === 'character' ? '角色' : asset.type === 'scene' ? '场景' : '物品'}「${asset.name}」未在提示词中 @，参考图可能遗漏`,
      });
    }
  }
  return missing;
}

/**
 * 场景兜底：任何镜头都必然处于某个场景。
 * 若 expected 中没有任何 scene，从场景库中挑一个与文本最相关的补入，避免整镜漏挂场景参考图。
 */
export function ensureSceneCovered(
  expected: AtAsset[],
  scenes: AtAsset[],
  text: string,
): AtAsset[] {
  if (!scenes || !scenes.length) return expected;
  if (expected.some((a) => a.type === 'scene')) return expected;
  const ranked = rankRelevantAssets(text || '', scenes, 1);
  if (!ranked.length) return expected;
  return [...expected, ranked[0]];
}

/**
 * 从剧本文本（场景描述+对白等）检测本镜头期望资产：
 * 登记名或其别名（标准化后）在原文出现即视为期望。
 * 额外：原文 2-4 字 n-gram 若能 resolve 到登记名，也视为期望（处理简称如"钥匙"→"钥匙串"）。
 * 长名优先，避免重复。
 */
export function detectExpectedAssets(sourceText: string, index: AtMentionIndex): AtAsset[] {
  if (!sourceText) return [];
  const normSource = normalizeName(sourceText);
  const rawSource = sourceText;
  const found: AtAsset[] = [];
  const seen = new Set<string>();
  const pushEntry = (e: { asset: AtAsset }) => {
    const key = e.asset.id || e.asset.name;
    if (!seen.has(key)) { seen.add(key); found.push(e.asset); }
  };

  // 精确/别名匹配
  for (const entry of index.list()) {
    const candidates = [entry.canonical, ...entry.aliasesRaw];
    const hitRaw = candidates.some((c) => c && rawSource.includes(c));
    const hitNorm = normSource.includes(entry.norm) || entry.aliasesNorm.some((an) => normSource.includes(an));
    if (hitRaw || hitNorm) pushEntry(entry);
  }

  // n-gram 匹配：处理原文简称/漏字/别名（"钥匙"→"钥匙串"、"养殖区"→"铁皮棚养殖区"）
  // 只用 2-4 字 n-gram，避免子字误匹配；且 n-gram 必须走 resolveToken 的精确/别名/模糊校验
  if (normSource.length >= 2) {
    const ngrams = new Set<string>();
    for (let L = 2; L <= 4; L++) {
      for (let i = 0; i <= normSource.length - L; i++) {
        const ng = normSource.slice(i, i + L);
        if (/^[\u4e00-\u9fa5]+$/.test(ng)) ngrams.add(ng); // 纯中文才进 ngram，减少噪声
      }
    }
    // 按长度降序：4字 ngram 优先，避免短 ngram 先命中歧义登记名
    const sorted = [...ngrams].sort((a, b) => b.length - a.length);
    for (const ng of sorted) {
      const r = index.resolveToken(ng);
      if (r && !seen.has(r.entry.asset.id || r.entry.asset.name)) {
        pushEntry(r.entry);
      }
    }
  }
  return found;
}

/** 去除文本中的 @ 符号（@ 仅用于系统挂载参考图，不进入视频/绘画模型） */
export function stripAtMentions(text: string): string {
  if (!text) return text || '';
  return text.replace(AT_TOKEN_REGEX, '$1');
}

/** bigram 重合度（0~1），用于资产相关性召回 */
function bigramScore(name: string, text: string): number {
  if (!name || !text) return 0;
  const grams: string[] = [];
  for (let i = 0; i < name.length - 1; i++) grams.push(name.slice(i, i + 2));
  if (!grams.length) return text.includes(name) ? 1 : 0;
  let hit = 0;
  for (const g of grams) if (text.includes(g)) hit++;
  return hit / grams.length;
}

/**
 * 资产相关性召回：只把与当前分镜最相关的 Top-K 资产注入提示词。
 * 场景表动辄数百条，全量注入会让 AI 无所适从，是 @ 引用混乱的重要诱因。
 */
export function rankRelevantAssets(text: string, assets: AtAsset[], topK = 24): AtAsset[] {
  if (!assets || !assets.length) return [];
  const normText = normalizeName(text || '').slice(0, 600);
  const scored = assets.map((a) => {
    const n = normalizeName(a.name);
    let score = 0;
    if (n && normText.includes(n)) score += 100 + n.length;
    for (const al of a.aliases || []) {
      const an = normalizeName(al);
      if (an && normText.includes(an)) score += 80 + an.length;
    }
    score += bigramScore(n, normText) * 20;
    if (a.type === 'character') score += 6;
    else if (a.type === 'scene') score += 4;
    else score += 2;
    return { a, score };
  });
  scored.sort((x, y) => y.score - x.score || y.a.name.length - x.a.name.length);
  const picked = scored.filter((s) => s.score >= 20).slice(0, topK).map((s) => s.a);
  if (picked.length < topK) {
    for (const s of scored) {
      if (picked.length >= topK) break;
      if (!picked.includes(s.a)) picked.push(s.a);
    }
  }
  return picked;
}

const TYPE_LABEL: Record<AtAssetType, string> = { character: '角色', scene: '场景', item: '物品' };

/**
 * 程序化补齐：把「必 @ 但仍缺失」的资产追加到文本末尾。
 * 用于 AI 重试仍不合规时的最后兜底，避免遗漏直接流到出图环节。
 */
export function ensureMentions(text: string, missing: AtAsset[]): string {
  if (!missing || !missing.length) return text || '';
  const add = missing.map((a) => `@${a.name}`).join('');
  const base = (text || '').trimEnd();
  if (!base) return add;
  return `${base}，画面中须出现${add}`;
}

/**
 * 【@提及规则】生成侧系统提示词共用条款（图片/视频提示词生成均注入）。
 * v2 重点：解决中文无空格造成的名字粘连，以及登记名互为子串时的拆分误写。
 */
export const AT_MENTION_RULES = `【@提及规则 — 必须严格遵守，违反将导致参考图无法挂载】
1. 提示词中凡出现角色、场景、物品，必须在其登记名【正前方】紧接 @ 符号（@ 与名字之间不得有空格），且 @ 后必须【逐字】使用上方资产列表中的登记名，严禁使用简称、别称、漏字、错字或自造名。
   例：登记名为「纪凡赛尔」时只能写 @纪凡赛尔，写 @凡赛尔、@纪凡、@男主 均无效；登记名为「铁皮棚养殖区」时写 @铁皮养殖箱 属于自造名，严禁。
2. 【中文粘连规则 — 最易出错】中文没有空格，@ 后的登记名必须【完整且到此为止】，后续动词、方位词、标点不再属于名字。
   正确：@纪凡赛尔 站在摊位前 / @锈港码头破旧摊位 内 / @岩洞 深处
   错误：@纪凡赛尔站在（"站在"被并入名字）/ @锈港码头破旧摊位内（"内"被并入名字）/ @岩洞背景
   判据：写完 @登记名 后，紧接着的那个字必须是动作、方位或标点，不得是可以继续拼进名字的字。
3. 登记名存在包含关系时（如「橘猫蛋子」与「蛋子」、「养殖箱钥匙串」与「钥匙串」、「锈港码头破旧摊位」与「锈港码头」），必须写【完整的那一个登记名】，严禁拆成两段 @。
   正确：@橘猫蛋子 仰躺在铁框上 / 腰间挂着@养殖箱钥匙串
   错误：@橘猫@蛋子（拆成两个资产，挂错图）/ @养殖箱@钥匙串
4. 本镜头出场的每个角色、所在场景、角色手持/互动/特写的道具，都必须 @，一个都不能少；未出场的资产不要 @。
5. 只允许 @ 上方资产列表中存在的登记名；严禁 @ 列表外的任何词语（如 @画面、@镜头、@图片1、@铁皮养殖箱）。
6. 名字在多个字段/多次出现时，每次出现都要带 @（至少在 startFrame、prompt、endFrame 中各出现一次）。
7. @ 仅用于标注资产，不要把 @ 加在动作、景别、光线等非资产词语前。`;

/** 格式化"本镜头必@清单"（注入用户消息，供 AI 逐项核对） */
export function formatExpectedAtList(expected: AtAsset[]): string {
  if (!expected.length) return '（本镜头未从剧本原文检测到已登记资产，请依据上方资产列表判断：凡画面中出现的角色/场景/物品必须逐字 @）';
  const byType = (t: AtAssetType) => expected.filter((a) => a.type === t);
  const lines: string[] = [];
  for (const t of ['character', 'scene', 'item'] as AtAssetType[]) {
    const arr = byType(t);
    if (arr.length) lines.push(`${TYPE_LABEL[t]}（必须逐字 @，缺一不可）：${arr.map((a) => `@${a.name}`).join('、')}`);
  }
  lines.push('此外，若画面中还出现上方资产列表里的其他角色/场景/物品，也必须逐字 @；严禁 @ 列表外的自造名。');
  lines.push('注意：@ 后登记名必须完整收尾，不要把后面的动词/方位词写进名字（见系统提示词【中文粘连规则】）。');
  return lines.join('\n');
}

/**
 * 格式化资产清单（注入系统提示词）。
 * 只注入相关资产（Top-K），并为存在包含关系的登记名加冲突提示，从源头减少拆名与选名错误。
 */
export function formatAssetGlossary(assets: AtAsset[], conflicts?: AtNameConflict[]): string {
  if (!assets.length) return '';
  const conflictMap = new Map<string, string[]>();
  for (const c of conflicts || []) {
    const key = c.longer.id || c.longer.name;
    const arr = conflictMap.get(key) || [];
    arr.push(c.shorter.name);
    conflictMap.set(key, arr);
  }
  const lines: string[] = [];
  for (const t of ['character', 'scene', 'item'] as AtAssetType[]) {
    const arr = assets.filter((a) => a.type === t);
    if (!arr.length) continue;
    lines.push(`【${TYPE_LABEL[t]}登记名（@ 后必须逐字一致）】`);
    for (const a of arr) {
      const warn = conflictMap.get(a.id || a.name);
      const aliasPart = a.aliases?.length ? `（别称：${a.aliases.join('、')}）` : '';
      lines.push(`  - @${a.name}${aliasPart}${warn ? `　⚠️ 与「${warn.join('、')}」存在包含关系，必须写完整名 @${a.name}` : ''}`);
    }
  }
  return lines.join('\n');
}
