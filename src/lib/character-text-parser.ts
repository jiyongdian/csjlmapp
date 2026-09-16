export interface ParsedCharacterHeader {
  name: string;
  rest: string;
}

export interface ParsedCharacterDetails {
  tags: string[];
  gender: '男' | '女' | '';
  personality: string;
  appearance: string;
  description: string;
  background: string;
}

const INVALID_NAME_RE = /[，,。！？；;\n]/;
const INVALID_NAME_WORD_RE = /^(他|她|它|他们|她们|其|曾是|因为|所以|但是|然而|看似|实则|现在|曾经|发色|发型|眼睛|上身|下身|外貌|性格|背景|描述|身世|关系|原因)$/;
const CHARACTER_META_LINE_RE = /^(?:[【\[]\s*(?:外貌|性格|背景|描述|身世|关系|原因)\s*[】\]]?|(?:外貌|发色|发型|眼睛|上身|下身))(?:\s|[：:]|$)/;

function isCharacterMetaLine(line: string): boolean {
  return CHARACTER_META_LINE_RE.test((line || '').trim());
}

function normalizeAppearanceText(text: string): string {
  return (text || '')
    .replace(/\s*\n\s*(?=(?:发色|发型|眼睛|上身|下身)[：:])/g, '｜')
    .replace(/\s+/g, ' ')
    .replace(/^[：:\s｜|]+/, '')
    .trim();
}

export function parseCharacterHeader(line: string): ParsedCharacterHeader | null {
  const trimmed = (line || '').trim();
  if (isCharacterMetaLine(trimmed)) return null;
  const match = trimmed.match(/^(.+?)(?:——|—|：|:|\s[—\-])/);
  if (!match) return null;
  const name = match[1].trim();
  if (!name || name.length > 12) return null;
  if (INVALID_NAME_RE.test(name)) return null;
  if (/[【】\[\]]/.test(name)) return null;
  if (INVALID_NAME_WORD_RE.test(name)) return null;
  if (isCharacterMetaLine(name)) return null;
  return { name, rest: trimmed.slice(match[0].length).trim() };
}

export function splitCharacterTags(value: string): string[] {
  return (value || '')
    .split(/[\/、，,]/)
    .map(tag => tag.trim())
    .filter(tag => tag && tag.length <= 16 && !/[：:。！？；;\n]/.test(tag));
}

export function normalizeCharacterGender(tag: string): '男' | '女' | '' {
  if (/^(男|男性|雄性)$/.test(tag)) return '男';
  if (/^(女|女性|雌性)$/.test(tag)) return '女';
  return '';
}

export function extractLeadingCharacterTags(text: string): { tags: string[]; remaining: string } {
  let remaining = (text || '').trimStart();
  const tags: string[] = [];

  while (true) {
    const bracketMatch = remaining.match(/^【([^】]+)】\s*/);
    if (!bracketMatch) break;
    tags.push(...splitCharacterTags(bracketMatch[1]));
    remaining = remaining.slice(bracketMatch[0].length).trimStart();
  }

  const tagLineMatch = remaining.match(/^([^。！？；;\n【]{1,80})(?=\s*【外貌】|\n|$)/);
  if (tagLineMatch && /[\/、，,]/.test(tagLineMatch[1])) {
    const lineTags = splitCharacterTags(tagLineMatch[1]);
    if (lineTags.length >= 2) {
      tags.push(...lineTags);
      remaining = remaining.slice(tagLineMatch[0].length).trimStart();
    }
  } else {
    const inlineTagMatch = remaining.match(/^((?:[\u4e00-\u9fa5A-Za-z0-9·]{1,16}\s*[\/、，,]\s*){1,5}[\u4e00-\u9fa5A-Za-z0-9·]{1,16})(?=\s+)/);
    if (inlineTagMatch) {
      const inlineTags = splitCharacterTags(inlineTagMatch[1]);
      if (inlineTags.length >= 2) {
        tags.push(...inlineTags);
        remaining = remaining.slice(inlineTagMatch[0].length).trimStart();
      }
    }
  }

  return { tags: Array.from(new Set(tags)), remaining };
}

export function parseCharacterDetails(rest: string): ParsedCharacterDetails {
  const { tags, remaining } = extractLeadingCharacterTags(rest || '');
  const gender = tags.map(normalizeCharacterGender).find(Boolean) || '';
  const personalityTags = tags.filter(tag => !normalizeCharacterGender(tag));
  const appearanceMatch = remaining.match(/【外貌】\s*([\s\S]*?)(?=(?:\n\s*(?:背景故事|背景|身世|经历)[：:])|$)/);
  const appearance = appearanceMatch ? normalizeAppearanceText(appearanceMatch[1]) : '';

  let descriptionSource = remaining;
  let background = '';

  if (appearanceMatch && typeof appearanceMatch.index === 'number') {
    const beforeAppearance = remaining.slice(0, appearanceMatch.index).trim();
    const afterAppearance = remaining.slice(appearanceMatch.index + appearanceMatch[0].length).trim();
    descriptionSource = beforeAppearance;
    background = afterAppearance;
  } else {
    const explicitBackground = remaining.match(/(?:^|\n)\s*(?:背景故事|背景|身世|经历)[：:]\s*([\s\S]+)$/);
    if (explicitBackground && typeof explicitBackground.index === 'number') {
      descriptionSource = remaining.slice(0, explicitBackground.index).trim();
      background = explicitBackground[1].trim();
    }
  }

  const description = descriptionSource
    .replace(/【外貌】[\s\S]*$/g, '')
    .replace(/(?:^|\n)\s*(?:背景故事|背景|身世|经历)[：:]\s*[\s\S]+$/g, '')
    .trim();

  return {
    tags,
    gender,
    personality: personalityTags.join(', '),
    appearance,
    description,
    background,
  };
}

export type AppearanceFields = {
  hairColor: string;
  hairstyle: string;
  eyes: string;
  upper: string;
  lower: string;
};

const EMPTY_APPEARANCE_FIELDS: AppearanceFields = { hairColor: '', hairstyle: '', eyes: '', upper: '', lower: '' };

/** 标签别名 → 字段（兼容模版里写的「眼睛颜色 / 上身服装 / 下身服装」「眼眸」等写法） */
const APPEARANCE_LABEL_ALIASES: Array<{ key: keyof AppearanceFields; names: string[] }> = [
  { key: 'hairColor', names: ['发色', '头发颜色'] },
  { key: 'hairstyle', names: ['发型', '头发样式'] },
  { key: 'eyes', names: ['眼睛颜色', '眼眸', '眼睛', '双眼', '眼瞳', '瞳色', '眸色', '瞳孔'] },
  { key: 'upper', names: ['上身服装', '上身衣着', '上装', '上身', '上衣'] },
  { key: 'lower', names: ['下身服装', '下身衣着', '下装', '下身', '下裤', '裤子'] },
];

const APPEARANCE_LABEL_TO_KEY: Record<string, keyof AppearanceFields> = (() => {
  const map: Record<string, keyof AppearanceFields> = {};
  for (const { key, names } of APPEARANCE_LABEL_ALIASES) {
    for (const name of names) map[name] = key;
  }
  return map;
})();

/** 明确表示「没写」的说法，不能当成外貌内容 */
const APPEARANCE_UNKNOWN_RE = /未提及|未描写|未说明|未交代|未给出|未写|不详|不明|未知|无描述|暂无/;

/** 整句声明「某项没写」时，该句不参与散文兜底（否则会把「未提及发色、发型」当成发色内容） */
const APPEARANCE_ABSENT_CLAUSE_RE = /未提及|未描写|未说明|未交代|未给出|未写|无描述/;

/** 仙光特效等收尾描写，服饰段遇到就该停 */
const APPEARANCE_FX_RE = /脑[后前]|身后|背后|周身|整体|自带|行走间|气质|气场|气韵|神光|仙辉|仙光|光环|光圈|仙环|特效|氛围/;

/** 服饰段开头的部位词，取字段时应剥掉 */
const APPEARANCE_LABEL_STRIP_RE = /^(?:(?:上身|上装|上衣|下身|下装|下裤|裤子)(?:服装|衣着|部位)?)+/;

/** 服饰段开头的动词，取字段时应剥掉 */
const APPEARANCE_VERB_RE = /^(?:身着|穿着|身穿|穿了|穿|搭配|配着|披着|披|着|戴|是|为|有)+/;

/** 散文定位锚点：发 / 眼 / 上身 / 下身 */
const APPEARANCE_HAIR_ANCHOR_RE = /发色|头发颜色|头发|发丝|长发|中长发|短发|卷发|发髻|仙髻|发冠|马尾|鬓角|刘海|发梢/;
const APPEARANCE_EYES_ANCHOR_RE = /眼睛颜色|眼眸|眼睛|双眼|眼瞳|瞳色|眸色|瞳孔|竖瞳|瞳/;
const APPEARANCE_UPPER_ANCHOR_RE = /上身|上装|上衣/;
const APPEARANCE_LOWER_ANCHOR_RE = /下身|下装|下裤|下穿|裤子/;

/** 头发本体名词：发型从它开始取 */
const APPEARANCE_HAIR_NOUN_RE = /长发|中长发|短发|卷发|头发|发丝|发髻|仙髻|发冠|马尾|发(?![色型])/;

/** 发型段的续接词：出现这些才继续往后取，否则视为气质形容收尾 */
const APPEARANCE_HAIR_KEEP_RE = /发|冠|髻|束|挽|梳|披|垂|散|盘|扎|辫|簪|马尾|刘海|鬓|寸/;

/** 颜色字：用于从「一头银白色长发」里切出发色 */
const APPEARANCE_COLOR_CHAR_RE = /[纯暗浅深淡亮莹雪霜乌漆金银铜黑白灰红赤朱绯粉樱蓝碧青绿紫墨玄苍棕褐橙黄玉月冰幽琥珀玛瑙茶酒色]/;

/** 颜色字紧贴「发」（如「一头黑发」）：比裸「发」安全，用于兜住「发髻」出现在发色之后、颜色被切在段外的写法 */
const APPEARANCE_COLOR_HAIR_ANCHOR_RE = /[纯暗浅深淡亮莹雪霜乌漆金银铜黑白灰红赤朱绯粉樱蓝碧青绿紫墨玄苍棕褐橙黄玉月冰幽]色?(?:的)?(?=发(?![色型]))/;

/** 单字发色：颜色字紧贴头发名词（黑发 / 白发 / 红发），免得被「至少两字」的规则挡掉 */
const APPEARANCE_SINGLE_COLOR_HAIR_RE = /([纯暗浅深淡亮莹雪霜乌漆金银铜黑白灰红赤朱绯粉樱蓝碧青绿紫墨玄苍棕褐橙黄玉月冰幽])色?(?:的)?(?=发(?![色型]))/;

/** 发型本体名词：不含裸「发」，避免把「黑发」里的「发」当成发型起点 */
const APPEARANCE_HAIRSTYLE_NOUN_RE = /长发|中长发|短发|卷发|头发|发丝|发髻|仙髻|发冠|马尾|刘海|发梢/;

/** 别的部位标签：出现它说明这一句是「发色、发型与眼睛都未提及」这类否定式罗列 */
const APPEARANCE_FOREIGN_LABEL_RE = /发色|头发颜色|发型|头发样式|头发|发丝|长发|中长发|短发|卷发|发髻|仙髻|发冠|马尾|上身|上装|上衣|下身|下装|下裤|下穿|裤子/;

const cleanAppearanceValue = (raw: string): string => {
  const text = (raw || '')
    .replace(/^[：:\s,，、。．;；]+/, '')
    .replace(/[。．.；;,，、\s]+$/, '')
    .trim();
  if (!text) return '';
  if (APPEARANCE_UNKNOWN_RE.test(text)) return '';
  return text;
};

const cleanCostumeValue = (raw: string): string =>
  cleanAppearanceValue((raw || '').replace(APPEARANCE_LABEL_STRIP_RE, '').replace(APPEARANCE_VERB_RE, ''));

/**
 * 把一段 appearance 描述拆成 5 个外貌字段。
 *
 * 依次尝试四种写法（前者有结果就不覆盖后者）：
 * 1) 标签式：`发色：X｜发型：X`，标签兼容长短写法，遇其它标签即停；
 * 2) 位置式：`24岁｜male｜未提及｜未提及｜未提及｜上身｜下身`（恰好 7 段才按位置对齐，不猜）；
 * 3) 散文式：`…银白长发…，眼眸是鎏金色，上身穿着…，下身搭配…`（按「发/眼/上身/下身」锚点切段，段尾收敛到句末或仙光特效）；
 * 4) 关键词兜底：`上身穿一件…` 这类零散写法。
 * 明确写了「未提及」的字段一律留空，不猜、不编。
 */
export function extractAppearanceFields(appearance: string): AppearanceFields {
  const text = normalizeAppearanceText(appearance || '');
  if (!text) return { ...EMPTY_APPEARANCE_FIELDS };

  const out: AppearanceFields = { ...EMPTY_APPEARANCE_FIELDS };

  /* ---------- 第 1 遍：标签式 ---------- */
  for (const { key, names } of APPEARANCE_LABEL_ALIASES) {
    const otherLabels = APPEARANCE_LABEL_ALIASES
      .filter((a) => a.key !== key)
      .reduce<string[]>((acc, a) => acc.concat(a.names), [])
      .sort((a, b) => b.length - a.length);
    const bounded = '(?:(?!' + otherLabels.join('|') + ')[^｜|\\n])*';
    for (const name of names) {
      const match = text.match(new RegExp(name + '[：:]\\s*(' + bounded + ')'));
      if (match) {
        out[key] = cleanAppearanceValue(match[1]);
        break;
      }
    }
  }

  /* ---------- 第 2 遍：位置式（无冒号的 7 段） ---------- */
  const hasAppearanceLabelColon = /(?:发色|头发颜色|发型|头发样式|眼睛颜色|眼眸|眼睛|双眼|眼瞳|瞳色|眸色|瞳孔|上身服装|上身衣着|上装|上身|上衣|下身服装|下身衣着|下装|下身|下裤|裤子)[：:]/.test(text);
  if (!hasAppearanceLabelColon) {
    const parts = text.split(/[｜|]/).map((s) => s.trim()).filter((s) => s.length > 0);
    if (parts.length === 7) {
      const at = (i: number) => cleanAppearanceValue(parts[i]);
      out.hairColor = out.hairColor || at(2);
      out.hairstyle = out.hairstyle || at(3);
      out.eyes = out.eyes || at(4);
      out.upper = out.upper || cleanCostumeValue(parts[5]);
      out.lower = out.lower || cleanCostumeValue(parts[6]);
    }
  }

  /* ---------- 第 3 遍：散文式（锚点切段 + 分句收敛） ---------- */
  const idxOf = (re: RegExp) => text.search(re);
  // 头发段起点：常规锚点，或「颜色字紧贴发」的位置（后者更早时以它为准）
  const hairAt = [idxOf(APPEARANCE_HAIR_ANCHOR_RE), idxOf(APPEARANCE_COLOR_HAIR_ANCHOR_RE)]
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0] ?? -1;
  const eyesAt = idxOf(APPEARANCE_EYES_ANCHOR_RE);
  const upperAt = idxOf(APPEARANCE_UPPER_ANCHOR_RE);
  const lowerAt = idxOf(APPEARANCE_LOWER_ANCHOR_RE);
  const fieldAnchors = [hairAt, eyesAt, upperAt, lowerAt].filter((i) => i >= 0);

  /** 该位置之后最近的四类外貌锚点（发/眼/上身/下身） */
  const nextFieldAnchorAfter = (pos: number) =>
    fieldAnchors.filter((i) => i > pos).sort((a, b) => a - b)[0] ?? text.length;

  /** 该位置之后最近的收尾锚点：外貌锚点或仙光特效 */
  const nextAnchorAfter = (pos: number) => {
    const fxAfter = text.slice(pos + 1).search(APPEARANCE_FX_RE);
    const stops = [nextFieldAnchorAfter(pos)];
    if (fxAfter >= 0) stops.push(pos + 1 + fxAfter);
    return Math.min(...stops);
  };

  /** 往前回退到子句起点，避免「一头银白色」这类修饰被切在切片外面 */
  const clauseStart = (pos: number) => {
    const cut = text.slice(0, pos).search(/[，,、。．.;；][^，,、。．.;；]*$/);
    return cut < 0 ? 0 : cut + 1;
  };

  /** 从 start 起第一处句末标点，避免把下一句吞进来 */
  const sentenceEndAt = (start: number) => {
    const cut = text.slice(start).search(/[。．.;；！？!?]/);
    return cut < 0 ? text.length : start + cut;
  };

  /** 取 [start, endAnchor] 之间、收尾到最近句末标点的片段 */
  const sliceSegment = (start: number, endAnchor: number) =>
    text
      .slice(start, Math.min(endAnchor, sentenceEndAt(start)))
      .replace(/[，,、。．.;；\s]+$/, '')
      .trim();

  /** 段落里混进别的部位标签时（如「未提及发色、发型与眼睛」），只保留本字段标签之后的内容 */
  const keepFromOwnLabel = (segment: string, ownLabelRe: RegExp) => {
    const own = segment.match(ownLabelRe);
    if (!own || own.index === undefined || own.index === 0) return segment;
    return APPEARANCE_FOREIGN_LABEL_RE.test(segment.slice(0, own.index)) ? segment.slice(own.index) : segment;
  };

  /** 切颜色词：先剥掉「一头/如/是」等前缀，再取开头连续的颜色字 */
  const pickColorWord = (raw: string): string => {
    const cleaned = (raw || '')
      .replace(/^[，,、。．.;；：:\s]+/, '')
      .replace(/^(?:一头|满头|那一头|那一|一缕|一袭|如|是|为|呈|泛着|泛|着|的)+/, '');
    let color = '';
    for (const ch of cleaned) {
      if (APPEARANCE_COLOR_CHAR_RE.test(ch)) color += ch;
      else break;
    }
    return color.length >= 2 ? color : '';
  };

  // 发型段：回退到子句起点，遇到「成熟沉稳极具威严」这类气质形容就收敛
  let hairSeg = '';
  if (hairAt >= 0) {
    const raw = keepFromOwnLabel(sliceSegment(clauseStart(hairAt), nextFieldAnchorAfter(hairAt)), APPEARANCE_HAIR_ANCHOR_RE);
    const kept: string[] = [];
    for (const clause of raw.split(/[，,、。．.;；]/).map((s) => s.trim()).filter(Boolean)) {
      if (kept.length > 0 && !APPEARANCE_HAIR_KEEP_RE.test(clause)) break;
      kept.push(clause);
    }
    hairSeg = kept.join('，');
  }

  if (!out.hairColor && hairSeg) {
    const labelled = hairSeg.match(/(?:发色|头发颜色)(?:是|为|如|呈)?\s*([^，,、。．.;；]{1,12})/);
    const firstClause = hairSeg.split(/[，,、。．.;；]/)[0] || hairSeg;
    const nounAt = firstClause.search(APPEARANCE_HAIR_NOUN_RE);
    const beforeNoun = nounAt >= 0 ? firstClause.slice(0, nounAt) : '';
    // 单字颜色（黑发 / 白发 / 红发）：颜色字紧贴头发名词时也认
    const singleColor = hairSeg.match(APPEARANCE_SINGLE_COLOR_HAIR_RE);
    out.hairColor = cleanAppearanceValue(
      (labelled ? pickColorWord(labelled[1]) : '')
      || pickColorWord(beforeNoun.length > 6 ? beforeNoun.slice(-6) : beforeNoun)
      || pickColorWord(hairSeg)
      || (singleColor ? singleColor[1] : ''),
    );
  }

  if (!out.hairstyle && hairSeg) {
    // 优先从「长发 / 发髻」这类完整名词起取，没有才退到裸「发」
    const nounAt = hairSeg.search(APPEARANCE_HAIRSTYLE_NOUN_RE);
    const fallbackAt = hairSeg.search(APPEARANCE_HAIR_NOUN_RE);
    out.hairstyle = cleanAppearanceValue(
      nounAt >= 0
        ? hairSeg.slice(nounAt)
        : fallbackAt >= 0
          ? hairSeg.slice(fallbackAt)
          : hairSeg.replace(out.hairColor, ''),
    );
  }

  // 眼睛段：锚点起，到下一锚点或句末
  if (!out.eyes && eyesAt >= 0) {
    out.eyes = cleanAppearanceValue(
      keepFromOwnLabel(sliceSegment(clauseStart(eyesAt), nextAnchorAfter(eyesAt)), APPEARANCE_EYES_ANCHOR_RE)
        .replace(/^(?:一双|两只|一对|那双眼|那对)\s*/, '')
        .replace(/^(?:眼睛颜色|眼眸|眼睛|双眼|眼瞳|瞳色|眸色|瞳孔|竖瞳|瞳)(?:是|为|呈|泛着|透着|带着)?\s*/, ''),
    );
  }

  // 上身段
  if (!out.upper && upperAt >= 0) {
    out.upper = cleanCostumeValue(keepFromOwnLabel(sliceSegment(clauseStart(upperAt), nextAnchorAfter(upperAt)), APPEARANCE_UPPER_ANCHOR_RE));
  }

  // 下身段
  if (!out.lower && lowerAt >= 0) {
    out.lower = cleanCostumeValue(keepFromOwnLabel(sliceSegment(clauseStart(lowerAt), nextAnchorAfter(lowerAt)), APPEARANCE_LOWER_ANCHOR_RE));
  }

  /* ---------- 第 4 遍：关键词兜底 ---------- */
  const proseRules: Array<{ key: keyof AppearanceFields; re: RegExp }> = [
    { key: 'upper', re: /(?:^|[^半])(?:上身|上装|上衣)(?:穿戴着|穿着|穿了|穿|着|是|为)?(?:一件|一条|一套|一身|那件)?\s*((?:(?!下身|下装|下裤|裤子|眼睛|眼眸|双眼|发色|发型)[^。；;\n｜|]){2,80})/ },
    { key: 'lower', re: /(?:^|[^半])(?:下身|下装|下裤|裤子)(?:穿戴着|穿着|穿了|穿|着|是|为)?(?:一件|一条|一套|一身|那件)?\s*((?:(?!上身|上装|上衣|眼睛|眼眸|双眼|发色|发型)[^。；;\n｜|]){2,80})/ },
    { key: 'eyes', re: /(?:眼睛颜色|眼眸|眼睛|双眼|眼瞳|眸子)(?:颜色)?(?:是|为|呈|泛着|透出|带着)?\s*((?:(?!上身|上装|上衣|下身|下装|下裤|裤子|发色|发型)[^。；;\n｜|]){1,40})/ },
    { key: 'hairColor', re: /(?:发色|头发颜色)(?:是|为|呈)?\s*((?:(?!上身|上装|上衣|下身|下装|下裤|裤子|眼睛|眼眸|双眼|发型)[^。；;\n｜|]){1,30})/ },
    { key: 'hairstyle', re: /(?:发型)(?:是|为)?\s*((?:(?!上身|上装|上衣|下身|下装|下裤|裤子|眼睛|眼眸|双眼|发色)[^。；;\n｜|]){1,40})/ },
  ];
  // 散文兜底前，先剔除「声明某项没写」的整句
  const proseText = text
    .split(/[。；;\n]/)
    .filter((clause) => clause.trim() && !APPEARANCE_ABSENT_CLAUSE_RE.test(clause))
    .join('。');

  for (const { key, re } of proseRules) {
    if (out[key]) continue;
    const match = proseText.match(re);
    if (match) out[key] = key === 'upper' || key === 'lower' ? cleanCostumeValue(match[1]) : cleanAppearanceValue(match[1]);
  }

  return out;
}

/** 按标签取单个外貌字段（保持旧签名，内部走宽容解析） */
export function parseAppearanceField(appearance: string, label: string): string {
  const key = APPEARANCE_LABEL_TO_KEY[label];
  if (key) return extractAppearanceFields(appearance)[key];
  const match = (appearance || '').match(new RegExp(label + '[：:]\\s*([^｜|\\n]*)'));
  return match ? cleanAppearanceValue(match[1]) : '';
}
