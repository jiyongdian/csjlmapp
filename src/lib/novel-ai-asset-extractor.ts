import { getModelName, getRawAIConfig } from '@/lib/ai-config';
import { extractJsonObject } from '@/lib/json-parser';
import { aiConfigManager } from '@/storage/database/aiConfigManager';
import type {
  ExtractedNovelAssets,
  ExtractedNovelCharacter,
  ExtractedNovelItem,
  ExtractedNovelScene,
} from '@/lib/novel-content-extractor';
import type { ExtractKind } from '@/lib/extract-template';

type NormalizedChapter = {
  index: number;
  title: string;
  content: string;
};

type PartialAssets = {
  characters: ExtractedNovelCharacter[];
  scenes: ExtractedNovelScene[];
  items: ExtractedNovelItem[];
};

const GENERIC_CHARACTER_NAMES = new Set([
  '主角', '男主', '女主', '配角', '反派', '角色', '人物', '众人', '大家', '男人', '女人', '老人', '孩子',
  '少年', '少女', '青年', '系统', '怪物', '宠物', '旁白', '作者', '读者',
]);

const GENERIC_ITEM_NAMES = new Set([
  '东西', '物品', '道具', '线索', '秘密', '真相', '空气', '声音', '目光', '身体', '眼睛', '手指',
  '心脏', '脑海', '记忆', '概念', '能力', '系统', '任务',
]);

const ACTION_WORDS = /(说道|问道|喊道|看向|走向|进入|来到|回到|离开|拿起|打开|握着|递给|发现|意识到|开始|突然|然后|已经|正在|不是|没有)/;

export type AssetExtractionOptions = {
  idea?: unknown;
  protagonist?: unknown;
  structure?: unknown;
  configId?: string | null;
  /** 自定义系统提示词（提取模版渲染结果）。传入后不再使用内置提取提示词 */
  systemPrompt?: string | null;
  /** 只提取指定类型；不传或为空则三类一起提取（保持原有行为） */
  kinds?: ExtractKind[] | null;
  /** 单次请求最大输出 token（自定义模版建议放宽） */
  maxTokens?: number | null;
};

const ALL_EXTRACT_KINDS: ExtractKind[] = ['character', 'scene', 'item'];

export async function extractAssetsFromNovelContentWithAI(
  chaptersInput: unknown,
  options: AssetExtractionOptions = {},
): Promise<ExtractedNovelAssets | null> {
  const chapters = normalizeChapters(chaptersInput);
  if (chapters.length === 0) return null;

  const kinds: ExtractKind[] = options.kinds && options.kinds.length > 0 ? options.kinds : ALL_EXTRACT_KINDS;

  await assertTextAIConfig(options.configId);
  const { apiUrl, apiKey, provider } = await getRawAIConfig(options.configId);
  if (!apiKey) return null;
  console.log(`[AssetExtractor] Using provider: ${provider} | kinds: ${kinds.join(',')}${options.systemPrompt ? ' | 自定义模版' : ''}`);

  const model = await getModelName(options.configId, process.env.AI_MODEL || 'deepseek-chat');
  const batches = buildChapterBatches(chapters, 18000, 4);
  const merged: PartialAssets = { characters: [], scenes: [], items: [] };

  for (const batch of batches) {
    const extracted = await callAssetExtractionAI(apiUrl, apiKey, model, batch, options, kinds);
    if (kinds.includes('character')) mergeAssets(merged.characters, extracted.characters, 'character');
    if (kinds.includes('scene')) mergeAssets(merged.scenes, extracted.scenes, 'scene');
    if (kinds.includes('item')) mergeAssets(merged.items, extracted.items, 'item');
  }

  const assets: ExtractedNovelAssets = {
    characters: kinds.includes('character') ? sortAndLimit(merged.characters, 24) : [],
    scenes: kinds.includes('scene') ? sortAndLimit(merged.scenes, 24) : [],
    items: kinds.includes('item') ? sortAndLimit(merged.items, 24) : [],
    sourceChapterCount: chapters.length,
  };

  if (assets.characters.length + assets.scenes.length + assets.items.length === 0) {
    return null;
  }

  return assets;
}

async function assertTextAIConfig(configId?: string | null) {
  if (!configId) return;
  const config = await aiConfigManager.getConfigById(configId);
  if (!config) {
    throw new Error('所选AI模型配置不存在或已停用，请重新选择文字模型。');
  }
  const modelType = String(config.modelType || 'text').toLowerCase();
  if (modelType !== 'text') {
    throw new Error('请选择文字模型配置来提取角色、场景、物品，当前配置不是文字模型。');
  }
}

async function callAssetExtractionAI(
  apiUrl: string,
  apiKey: string,
  model: string,
  chapters: NormalizedChapter[],
  options: AssetExtractionOptions,
  kinds: ExtractKind[] = ALL_EXTRACT_KINDS,
): Promise<PartialAssets> {
  const endpoint = apiUrl.endsWith('/chat/completions')
    ? apiUrl
    : `${apiUrl.replace(/\/+$/, '')}/chat/completions`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: options.maxTokens && options.maxTokens > 0 ? options.maxTokens : 5000,
        messages: options.systemPrompt
          ? [
              { role: 'system', content: options.systemPrompt },
              { role: 'user', content: buildTemplateUserPrompt(chapters, kinds) },
            ]
          : [
              { role: 'system', content: buildAssetExtractionSystemPrompt() },
              { role: 'user', content: buildUserPrompt(chapters, options) },
            ],
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`AI提取失败 HTTP ${res.status}: ${errorText.slice(0, 300)}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.delta?.content || '';
    const cleaned = String(content).replace(/<think[\s\S]*?<\/think>/gi, '').trim();
    const parsed = parseExtractionJson(cleaned, kinds);
    if (!parsed) return { characters: [], scenes: [], items: [] };
    return normalizeAIAssets(parsed, chapters, kinds);
  } finally {
    clearTimeout(timeout);
  }
}

function buildAssetExtractionSystemPrompt() {
  return `你是小说影视化资料整理员，只做“从正文提取事实”，不能扩写、不能脑补。
请从用户给出的小说章节正文中提取三类资料：
1. characters：正文里出现过、有名字或明确称呼的角色，包含人类、宠物、异兽、AI等。不要提取“主角/反派/男人/女人/众人/系统”这类泛称，除非它就是正式名字。
2. scenes：可用于短剧拍摄/分镜的固定地点或场所。场景名必须是地点名，不要把动作句、整句话、剧情事件当场景。
3. items：可以视觉呈现且对剧情有作用的具体物品。不要提取抽象概念、身体部位、情绪、能力、任务。

严格只输出 JSON，不要解释：
{
  "characters": [
    {
      "name": "",
      "role": "protagonist|supporting|minor",
      "gender": "male|female|other|unknown",
      "description": "基于正文的身份/背景/剧情作用简述",
      "personality": "性格关键词，用顿号分隔",
      "appearance": {
        "hairColor": "发色，没有依据则空字符串",
        "hairstyle": "发型，没有依据则空字符串",
        "eyes": "眼睛特征，没有依据则空字符串",
        "upper": "上身服装/体态，没有依据则空字符串",
        "lower": "下身服装/体态，没有依据则空字符串"
      },
      "sourceChapters": [1,2]
    }
  ],
  "scenes": [
    {"name":"", "description":"基于正文的场景描述", "atmosphere":"氛围/光线/环境感", "relatedChapters":[1]}
  ],
  "items": [
    {"name":"", "description":"基于正文的物品描述", "significance":"剧情作用", "relatedChapters":[1]}
  ]
}

要求：
- name 必须短、干净，不能包含“走进/看向/拿起/说道”等动作词。
- 性别必须结合名字、称谓、代词、上下文判断；如出现“先生/少爷/父亲/他”等男性依据，输出 male；出现“小姐/夫人/母亲/她”等女性依据，输出 female。无法判断才用 unknown。
- appearance 必须尽量拆成 hairColor/hairstyle/eyes/upper/lower，正文没有直接写明时可以从已知人设/创意参考中提取；完全无依据才留空。
- 每一条必须能在正文或已知人设中找到依据。
- 多章重复出现的同名实体合并，sourceChapters/relatedChapters 列出章节号。
- 不要输出“反派”这个角色分类，敌对角色也归为 supporting。`;
}

function buildSystemPrompt() {
  return `你是小说影视化资料整理员，只做“从正文抽取事实”，不能扩写、不能脑补。

请从用户给出的小说章节正文中提取三类资料：
1. characters：确实在正文里出现过、有名字或明确称呼的角色，包括人类、宠物、异兽、AI等。不要提取“主角/反派/男人/女人/众人/系统”这类泛称，除非它就是正式名字。
2. scenes：可以用于短剧拍摄/分镜的固定地点或场所。场景名必须是地点名，不要把动作句、整句话、剧情事件当场景。
3. items：可以视觉呈现且对剧情有作用的具体物品。不要提取抽象概念、身体部位、情绪、能力、任务。

严格只输出JSON，不要解释：
{
  "characters": [
    {"name":"", "role":"protagonist|supporting|minor", "gender":"male|female|other|unknown", "description":"基于正文的简述", "personality":"", "appearance":"", "sourceChapters":[1,2]}
  ],
  "scenes": [
    {"name":"", "description":"基于正文的场景描述", "atmosphere":"", "relatedChapters":[1]}
  ],
  "items": [
    {"name":"", "description":"基于正文的物品描述", "significance":"剧情作用", "relatedChapters":[1]}
  ]
}

要求：
- name必须短、干净，不能包含“走进/看向/拿起/说道”等动作词。
- 每一条必须能在正文中找到依据。
- 多章重复出现的同名实体合并，sourceChapters/relatedChapters列出章节号。
- 不要输出反派这个角色分类，敌对角色也归为supporting。`;
}

function buildUserPrompt(
  chapters: NormalizedChapter[],
  options: { idea?: unknown; protagonist?: unknown; structure?: unknown },
) {
  const known = [
    options.protagonist ? `【已知主角设定】\n${trimText(toPlainText(options.protagonist), 1000)}` : '',
    options.idea ? `【主题创意/人物参考】\n${trimText(toPlainText(options.idea), 1800)}` : '',
  ].filter(Boolean).join('\n\n');

  const chapterText = chapters
    .map((chapter) => `【第${chapter.index}章 ${chapter.title}】\n${trimText(chapter.content, 7000)}`)
    .join('\n\n');

  return `${known}

【小说正文】
${chapterText}`;
}

/** 自定义模版模式下的用户消息（正文已通过 {{小说原文}} 渲染进系统提示词）*/
function buildTemplateUserPrompt(chapters: NormalizedChapter[], kinds: ExtractKind[]) {
  const labels = kinds
    .map((k) => (k === 'character' ? '角色' : k === 'scene' ? '场景' : '物品'))
    .join('、');
  const chapterHint = chapters.map((c) => `第${c.index}章 ${c.title}`).join('、');
  return `请严格按系统提示词的要求，从【输入数据】中提取${labels}，并且只输出 JSON。\n本次涉及的章节：${chapterHint}`;
}

/** 兼容两种输出：{characters:[...]} 对象，或直接输出 JSON 数组（单类型模版常见写法）*/
function parseExtractionJson(cleaned: string, kinds: ExtractKind[]): any {
  const jsonKeys = kinds.map((k) => (k === 'character' ? 'characters' : k === 'scene' ? 'scenes' : 'items'));
  const obj = extractJsonObject<any>(cleaned, jsonKeys as string[]);
  if (obj) return obj;
  const arr = tryParseJsonArray(cleaned);
  if (arr && kinds.length === 1) return { [jsonKeys[0]]: arr };
  return null;
}

function tryParseJsonArray(raw: string): any[] | null {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeAIAssets(
  parsed: any,
  chapters: NormalizedChapter[],
  kinds: ExtractKind[] = ALL_EXTRACT_KINDS,
): PartialAssets {
  const validChapterNumbers = new Set(chapters.map((chapter) => chapter.index));
  const characters = kinds.includes('character')
    ? normalizeArray(parsed?.characters)
        .map((item) => normalizeAICharacter(item, validChapterNumbers))
        .filter((item): item is ExtractedNovelCharacter => Boolean(item))
    : [];
  promoteProtagonistByMentions(characters, chapters);
  return {
    characters,
    scenes: kinds.includes('scene')
      ? normalizeArray(parsed?.scenes)
          .map((item) => normalizeAIScene(item, validChapterNumbers))
          .filter((item): item is ExtractedNovelScene => Boolean(item))
      : [],
    items: kinds.includes('item')
      ? normalizeArray(parsed?.items)
          .map((item) => normalizeAIItem(item, validChapterNumbers))
          .filter((item): item is ExtractedNovelItem => Boolean(item))
      : [],
  };
}

/**
 * 模版可能只输出 name / aliases / description（并在正文里写死「不可增减字段」），
 * 这时拿不到 gender / role 字段，只能从描述文本和其它线索推导。
 */

/** 明确的性别用词：谁先出现就按谁判定（模版要求 description「必须硬性包含性别」） */
const GENDER_FEMALE_RE = /女性|女人|女子|女孩|女娃|女童|少女|姑娘|少妇|老妇|妇人|老妪|老太婆|老太太|女士|雌性/;
const GENDER_MALE_RE = /男性|男人|男子|男孩|男娃|男童|少年|儿郎|汉子|老汉|老头|老丈|壮汉|后生|小伙|雄性/;

/** 非人角色的强信号：明确交代了本体 / 种族，优先级高于人称代词 */
const NON_HUMAN_STRONG_RE = /本体(?:为|是)|原形|真身|妖兽|魔兽|妖怪|灵兽|异兽|神兽|兽形|兽类|凡兽|妖身|傀儡|亡灵|僵尸|尸傀|器灵|灵体|精怪|机器人|机械体|人工智能|数据体|不通人言|非人|灵物/;

/**
 * 非人角色的弱信号：只是出现了动物名词。
 * 这类词经常是比喻（如「以猫捉老鼠的姿态步步紧逼」），所以排在人称代词之后才敢用。
 */
const NON_HUMAN_WEAK_RE = /猫|犬|狗|狼|狐|蛇|龙|凤|鹤|鹰|兽|妖|鸟|鱼|虫|蛛|蝶/;

/** 第一人称 / 主角代称：别名里出现即视为主角 */
const PROTAGONIST_ALIAS_RE = /^(?:我|我主|主人公|主角|男主|女主|本座|本王|本尊|朕|俺|吾)$/;

/** 推导性别：先看模版是否给了 gender 字段，再看描述文本，最后才考虑非人 */
export function inferGenderFromCharacter(item: any): string | null {
  const declared = normalizeGender(item?.gender);
  if (declared) return declared;

  const text = [
    toPlainText(item?.description),
    toPlainText(item?.appearance),
    toPlainText(item?.personality),
    toPlainText(item?.aliases),
    toPlainText(item?.name),
  ].join('\n');
  if (!text.trim()) return null;

  const maleAt = text.search(GENDER_MALE_RE);
  const femaleAt = text.search(GENDER_FEMALE_RE);
  if (maleAt >= 0 || femaleAt >= 0) {
    const word = maleAt < 0 ? '女' : femaleAt < 0 ? '男' : maleAt <= femaleAt ? '男' : '女';
    // 统一口径：与模版直接给出 gender 字段时走同一个 normalizeGender
    return normalizeGender(word);
  }

  // 强信号（明确交代本体 / 种族）优先于人称代词
  if (NON_HUMAN_STRONG_RE.test(text)) return normalizeGender('其他');

  // 通篇只用「他」或只用「她」时才敢判定；两种都出现则放弃。
  // 先剔除「其他」，否则它里面的「他」会被误当成男性代词。
  const pronouns = text.replace(/其他/g, '');
  const hasHe = pronouns.includes('他');
  const hasShe = pronouns.includes('她');
  if (hasHe && !hasShe) return normalizeGender('男');
  if (hasShe && !hasHe) return normalizeGender('女');

  // 最后才用动物名词兜底（可能是比喻）
  if (NON_HUMAN_WEAK_RE.test(text)) return normalizeGender('其他');

  return null;
}

/** 推导角色类型：模版给了 role 就用它；没给时按「第一人称/主角代称」判断 */
export function inferRoleFromCharacter(item: any): string {
  if (String(item?.role ?? '').trim()) return normalizeRole(item?.role);
  const aliases = String(item?.aliases ?? '')
    .split(/[,，、;；\/｜|]/)
    .map((alias) => alias.trim())
    .filter(Boolean);
  return aliases.some((alias) => PROTAGONIST_ALIAS_RE.test(alias)) ? 'protagonist' : 'supporting';
}

/**
 * 模版不含 role 字段时的兜底：
 * 按角色在所选正文里被提及的次数，把明显占优的那个补成主角。
 * 只在前文一个主角都没判出来、且优势足够明显时才动手，避免误判。
 */
export function promoteProtagonistByMentions(characters: ExtractedNovelCharacter[], chapters: NormalizedChapter[]) {
  if (characters.length === 0) return;
  if (characters.some((character) => character.role === 'protagonist')) return;

  const text = chapters.map((chapter) => chapter.content).join('\n');
  if (!text.trim()) return;

  const countMentions = (character: ExtractedNovelCharacter) => {
    const keys = new Set<string>();
    const bare = character.name.replace(/[（(【\[].*$/, '').trim();
    if (bare.length >= 2) keys.add(bare);
    for (const alias of String(character.aliases || '').split(',').map((value) => value.trim())) {
      if (alias.length >= 2 && !/^\d+$/.test(alias)) keys.add(alias);
    }
    let total = 0;
    for (const key of keys) total += text.split(key).length - 1;
    return total;
  };

  const ranked = characters
    .map((character) => ({ character, count: countMentions(character) }))
    .sort((a, b) => b.count - a.count);

  const top = ranked[0];
  const runnerUp = ranked[1]?.count || 0;
  if (!top || top.count < 5 || top.count < runnerUp * 2) return;

  top.character.role = 'protagonist';
  top.character.score = (top.character.score || 100) + 50;
}

function normalizeAICharacter(item: any, validChapters: Set<number>): ExtractedNovelCharacter | null {
  const name = cleanName(item?.name, 'character');
  if (!isValidCharacterName(name)) return null;
  const sourceChapters = normalizeChaptersList(item?.sourceChapters || item?.relatedChapters, validChapters);
  const role = inferRoleFromCharacter(item);
  return {
    name,
    role,
    gender: inferGenderFromCharacter(item),
    // 模版常把完整人物形象写成一段长文，截太短会把形象描述腰斩
    description: trimText(toPlainText(item?.description), 900),
    personality: trimText(toPlainText(item?.personality), 120) || null,
    appearance: normalizeAppearance(item),
    aliases: normalizeAliases(item),
    sourceChapters,
    // 主角加权，排序时排在最前
    score: 100 + sourceChapters.length + (role === 'protagonist' ? 50 : 0),
  };
}

/** 别名：模版可能给字符串（逗号分隔）或数组；@提及 靠它做别名解析 */
function normalizeAliases(item: any): string | null {
  const raw = item?.aliases ?? item?.alias ?? item?.aliasNames ?? item?.nicknames ?? item?.别称 ?? item?.别名;
  if (!raw) return null;
  const list = Array.isArray(raw)
    ? raw.map((x) => String(x).trim())
    : String(raw).split(/[,，、;；\/｜|]/).map((x) => x.trim());
  const cleaned = list.filter((x) => x && x.length <= 40);
  if (cleaned.length === 0) return null;
  return trimText([...new Set(cleaned)].join(','), 200);
}

function normalizeAppearance(item: any): string | null {
  const appearance = item?.appearance;
  const detail = item?.appearanceDetail || item?.appearanceDetails || item?.visual || {};
  const source = appearance && typeof appearance === 'object' ? appearance : detail;
  const parts = [
    ['发色', source?.hairColor ?? source?.hair_color ?? source?.发色],
    ['发型', source?.hairstyle ?? source?.hairStyle ?? source?.hair_style ?? source?.发型],
    ['眼睛', source?.eyes ?? source?.eyeColor ?? source?.eye_color ?? source?.眼睛],
    ['上身', source?.upper ?? source?.upperBody ?? source?.upper_body ?? source?.上身],
    ['下身', source?.lower ?? source?.lowerBody ?? source?.lower_body ?? source?.下身],
  ]
    .map(([label, value]) => {
      const text = trimText(toPlainText(value), 60);
      return text ? `${label}：${text}` : '';
    })
    .filter(Boolean);

  if (parts.length > 0) return trimText(parts.join('｜'), 220);

  const text = trimText(toPlainText(appearance), 900);
  return text || null;
}

function normalizeAIScene(item: any, validChapters: Set<number>): ExtractedNovelScene | null {
  const name = cleanName(item?.name || item?.title, 'scene');
  if (!isValidPlaceOrItemName(name, 'scene')) return null;
  const relatedChapters = normalizeChaptersList(item?.relatedChapters || item?.sourceChapters, validChapters);
  return {
    name,
    description: trimText(toPlainText(item?.description), 260),
    atmosphere: trimText(toPlainText(item?.atmosphere), 80) || null,
    relatedChapters,
    score: 100 + relatedChapters.length,
  };
}

function normalizeAIItem(item: any, validChapters: Set<number>): ExtractedNovelItem | null {
  const name = cleanName(item?.name || item?.title, 'item');
  if (!isValidPlaceOrItemName(name, 'item')) return null;
  const relatedChapters = normalizeChaptersList(item?.relatedChapters || item?.sourceChapters, validChapters);
  return {
    name,
    description: trimText(toPlainText(item?.description), 220),
    significance: trimText(toPlainText(item?.significance), 100) || null,
    relatedChapters,
    score: 100 + relatedChapters.length,
  };
}

function cleanName(input: unknown, kind: 'character' | 'scene' | 'item') {
  let name = toPlainText(input)
    .replace(/^["'“”‘’《》【】\[\]（）()]+|["'“”‘’《》【】\[\]（）()]+$/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (kind !== 'character') {
    name = name
      .replace(/^.*(?:走进|进入|来到|回到|抵达|离开|穿过|站在|坐在|看向|望向|拿起|打开|握着|递给|发现)/, '')
      .replace(/^的/, '');
  }

  return name.slice(0, kind === 'character' ? 12 : 18);
}

function isValidCharacterName(name: string) {
  if (!name || name.length < 2 || name.length > 12) return false;
  if (GENERIC_CHARACTER_NAMES.has(name)) return false;
  if (ACTION_WORDS.test(name)) return false;
  if (/[，,。！？!?：:；;、]/.test(name)) return false;
  if (/^(一个|这个|那个|某个|所有|没有|正在|突然)/.test(name)) return false;
  return /[\u4e00-\u9fffA-Za-z]/.test(name);
}

function isValidPlaceOrItemName(name: string, kind: 'scene' | 'item') {
  if (!name || name.length < 2 || name.length > 18) return false;
  if (ACTION_WORDS.test(name)) return false;
  if (/[，,。！？!?：:；;]/.test(name)) return false;
  if (/^(一个|这个|那个|某个|所有|没有|正在|突然)/.test(name)) return false;
  if (kind === 'item' && GENERIC_ITEM_NAMES.has(name)) return false;
  return /[\u4e00-\u9fffA-Za-z0-9]/.test(name);
}

function normalizeRole(role: unknown) {
  const text = toPlainText(role).toLowerCase();
  if (text.includes('protagonist') || text.includes('主角')) return 'protagonist';
  if (text.includes('minor') || text.includes('次要') || text.includes('路人')) return 'minor';
  return 'supporting';
}

function normalizeGender(gender: unknown): string | null {
  const text = toPlainText(gender).toLowerCase();
  if (!text || text === 'unknown' || text === '未知') return null;
  if (text === 'male' || text.includes('男')) return 'male';
  if (text === 'female' || text.includes('女')) return 'female';
  if (text === 'other' || text.includes('其他') || text.includes('非人') || text.includes('动物') || text.includes('宠物') || text.includes('异兽') || text.includes('ai')) return 'other';
  return null;
}

function normalizeChaptersList(input: unknown, validChapters: Set<number>) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[、,，\s]+/);
  const chapters = raw
    .map((item) => Number(String(item).replace(/[^\d]/g, '')))
    .filter((num) => Number.isFinite(num) && validChapters.has(num));
  return Array.from(new Set(chapters)).sort((a, b) => a - b);
}

function normalizeChapters(input: unknown): NormalizedChapter[] {
  let chapters: any[] = [];
  if (Array.isArray(input)) chapters = input;
  else if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) chapters = parsed;
    } catch {
      chapters = [];
    }
  }

  return chapters
    .map((chapter, idx) => ({
      index: Number(chapter?.index ?? chapter?.chapterNumber ?? idx + 1) || idx + 1,
      title: toPlainText(chapter?.title ?? chapter?.chapterTitle ?? `第${idx + 1}章`),
      content: cleanContent(toPlainText(chapter?.content ?? chapter?.text ?? chapter?.chapterContent ?? '')),
    }))
    .filter((chapter) => chapter.content.length > 20);
}

function buildChapterBatches(chapters: NormalizedChapter[], maxChars: number, maxBatches: number) {
  const batches: NormalizedChapter[][] = [];
  let current: NormalizedChapter[] = [];
  let currentLength = 0;

  for (const chapter of chapters) {
    const len = chapter.content.length;
    if (current.length > 0 && currentLength + len > maxChars) {
      batches.push(current);
      current = [];
      currentLength = 0;
      if (batches.length >= maxBatches) break;
    }
    current.push(chapter);
    currentLength += len;
  }

  if (current.length > 0 && batches.length < maxBatches) batches.push(current);
  return batches;
}

function mergeAssets<T extends { name: string; description?: string; sourceChapters?: number[]; relatedChapters?: number[]; score?: number }>(
  target: T[],
  incoming: T[],
  _kind: 'character' | 'scene' | 'item',
) {
  for (const item of incoming) {
    const existing = target.find((row) => row.name === item.name);
    if (!existing) {
      target.push(item);
      continue;
    }
    if ((item.description || '').length > (existing.description || '').length) {
      existing.description = item.description;
    }
    const mutableExisting = existing as any;
    const mutableItem = item as any;
    for (const key of ['gender', 'role', 'personality', 'appearance']) {
      if (!mutableItem[key]) continue;
      if (!mutableExisting[key] || String(mutableItem[key]).length > String(mutableExisting[key]).length) {
        mutableExisting[key] = mutableItem[key];
      }
    }
    const currentChapters = new Set([...(existing.sourceChapters || existing.relatedChapters || []), ...(item.sourceChapters || item.relatedChapters || [])]);
    const sorted = Array.from(currentChapters).sort((a, b) => a - b);
    if (existing.sourceChapters) existing.sourceChapters = sorted;
    if (existing.relatedChapters) existing.relatedChapters = sorted;
    existing.score = Math.max(existing.score || 0, item.score || 0) + 1;
  }
}

function sortAndLimit<T extends { score?: number; name: string }>(items: T[], limit: number) {
  return items
    .sort((a, b) => (b.score || 0) - (a.score || 0) || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, limit);
}

function normalizeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function cleanContent(text: string) {
  return text
    .replace(/<think[\s\S]*?<\/think>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toPlainText(input: unknown) {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function trimText(text: string, maxLength: number) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1)}…`;
}
