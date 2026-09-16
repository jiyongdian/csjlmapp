type EntityKind = 'character' | 'scene' | 'item';

export type ExtractedNovelCharacter = {
  name: string;
  role: string;
  gender: string | null;
  description: string;
  personality: string | null;
  appearance: string | null;
  aliases?: string | null;
  sourceChapters: number[];
  score: number;
};

export type ExtractedNovelScene = {
  name: string;
  description: string;
  atmosphere: string | null;
  relatedChapters: number[];
  score: number;
};

export type ExtractedNovelItem = {
  name: string;
  description: string;
  significance: string | null;
  relatedChapters: number[];
  score: number;
};

export type ExtractedNovelAssets = {
  characters: ExtractedNovelCharacter[];
  scenes: ExtractedNovelScene[];
  items: ExtractedNovelItem[];
  sourceChapterCount: number;
};

type KnownCharacter = {
  role?: string;
  gender?: string | null;
};

type CandidateRecord = {
  name: string;
  count: number;
  score: number;
  chapters: Set<number>;
  contexts: string[];
};

const CHARACTER_STOP_WORDS = new Set([
  '他们', '她们', '它们', '我们', '你们', '自己', '众人', '大家', '所有人', '没人', '有人', '对方',
  '男人', '女人', '老人', '孩子', '少年', '少女', '青年', '女孩', '男孩', '医生', '护士', '老师',
  '警察', '老板', '司机', '店员', '系统', '宿主', '怪物', '宠物', '海洋', '星球', '城市', '声音',
  '目光', '空气', '身体', '心里', '脑海', '脸色', '眉头', '手指', '眼睛',
]);

const SCENE_STOP_WORDS = new Set([
  '心里', '脑海', '眼前', '手里', '怀里', '身边', '耳边', '脚下', '脸上', '屏幕上', '空气里',
  '小说里', '故事里', '记忆里', '梦里', '世界里', '系统里',
]);

const ITEM_STOP_WORDS = new Set([
  '东西', '声音', '目光', '空气', '身体', '心脏', '脑袋', '眼睛', '手指', '拳头', '问题', '办法',
  '时候', '地方', '系统', '任务', '章节', '内容', '画面',
]);

const SCENE_SUFFIX =
  '(?:星球|基地|废墟|禁区|实验室|办公室|会客厅|客厅|厨房|卧室|地下室|研究所|指挥室|会议室|医院|诊所|警局|学校|校园|公司|仓库|车站|地铁站|码头|港口|广场|市场|城市|小镇|村庄|山谷|森林|树林|海边|海底|海域|荒原|草原|沙漠|宫殿|大殿|客栈|酒楼|茶馆|街道|巷口|门口|房间|院子|屋里|船舱|甲板|洞穴|山洞|神殿|塔楼|阁楼|天台|走廊|电梯|楼梯|湖畔|河岸|岛上|城墙|战场|擂台|温室|花园|墓地|牢房|书房|大厅|后台|舞台|直播间|商场|餐厅|咖啡馆|酒店|公寓|别墅|工作室|训练场|操场|停车场|机场|机库|车厢|站台)';

const ITEM_SUFFIX =
  '(?:钥匙扣|钥匙|戒指|项链|手链|玉佩|令牌|徽章|长刀|短刀|匕首|手枪|手机|终端|电脑|芯片|硬盘|信件|照片|相片|日记|笔记|地图|卷轴|药剂|药瓶|盒子|箱子|瓶子|石头|晶石|灵石|宝石|合同|文件|护身符|罗盘|符箓|吊坠|手表|镜子|古书|背包|包裹|银行卡|门票|玉简|法器|丹药|符纸|面具|石碑|收银机|硬币|金币|种子|鱼竿|笼子|铃铛|项圈|矿石|样本|标本|试管|仪器|遥控器|按钮|核心|碎片|残片|胶囊|针剂|录音笔|U盘|刀|剑|枪|信|药|书|伞|票|卡|蛋|网|包)';

const CHARACTER_PATTERNS: Array<{ regex: RegExp; weight: number }> = [
  { regex: /([\u4e00-\u9fff]{2,6})(?:轻声|低声|冷声|沉声|急忙|突然|皱眉|笑着|咬牙|喃喃|认真|平静|大声|小声)?(?:说|道|问|喊|叫|笑道|叹道|开口|回答|怒吼|低语|提醒|解释|吩咐|嘀咕)/g, weight: 5 },
  { regex: /[“"「『][^”"」』]{1,100}[”"」』]\s*([\u4e00-\u9fff]{2,6})(?:说|道|问|喊|叫|笑道|叹道|开口|回答|低语)?/g, weight: 4 },
  { regex: /([\u4e00-\u9fff]{2,6})(?:看向|望着|盯着|走向|冲向|拉住|抓住|推开|抱住|拦住|点头|摇头|皱眉|沉默|愣住|笑了|哭了|转身|抬头|低头|伸手|开口|站起|坐下|走进|离开|回头)/g, weight: 2 },
];

export function extractAssetsFromNovelContent(
  chaptersInput: unknown,
  options: { idea?: unknown; protagonist?: unknown; structure?: unknown } = {},
): ExtractedNovelAssets {
  const chapters = normalizeChapters(chaptersInput);
  const knownCharacters = collectKnownCharacters(options.idea, options.protagonist);
  const characterMap = new Map<string, CandidateRecord>();
  const sceneMap = new Map<string, CandidateRecord>();
  const itemMap = new Map<string, CandidateRecord>();
  const sceneRegex = new RegExp(`([\\u4e00-\\u9fff]{2,16}${SCENE_SUFFIX})`, 'g');
  const sceneActionRegex = new RegExp(`(?:在|到|来到|走进|进入|回到|抵达|穿过|离开|赶往|站在|坐在|躲进|冲进|拖到)([\\u4e00-\\u9fff]{2,16}${SCENE_SUFFIX})`, 'g');
  const itemRegex = new RegExp(`([\\u4e00-\\u9fff]{0,14}${ITEM_SUFFIX})`, 'g');
  const itemActionRegex = new RegExp(`(?:拿起|握着|攥着|掏出|递给|打开|捡起|放下|拔出|举起|藏着|戴着|扔出|收起|展开|按下|递过|交出|摸出)([\\u4e00-\\u9fff]{0,14}${ITEM_SUFFIX})`, 'g');

  for (const chapter of chapters) {
    const chapterNumber = chapter.index;
    const text = chapter.content;
    if (!text) continue;

    for (const [name] of knownCharacters) {
      const regex = new RegExp(escapeRegExp(name), 'g');
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        addCandidate(characterMap, name, chapterNumber, sentenceAround(text, match.index), 3, 'character');
      }
    }

    for (const pattern of CHARACTER_PATTERNS) {
      let match: RegExpExecArray | null;
      pattern.regex.lastIndex = 0;
      while ((match = pattern.regex.exec(text)) !== null) {
        addCandidate(characterMap, match[1], chapterNumber, sentenceAround(text, match.index), pattern.weight, 'character');
      }
    }

    for (const regex of [sceneActionRegex, sceneRegex]) {
      let match: RegExpExecArray | null;
      regex.lastIndex = 0;
      while ((match = regex.exec(text)) !== null) {
        addCandidate(sceneMap, match[1], chapterNumber, sentenceAround(text, match.index), regex === sceneActionRegex ? 4 : 2, 'scene');
      }
    }

    for (const regex of [itemActionRegex, itemRegex]) {
      let match: RegExpExecArray | null;
      regex.lastIndex = 0;
      while ((match = regex.exec(text)) !== null) {
        addCandidate(itemMap, match[1], chapterNumber, sentenceAround(text, match.index), regex === itemActionRegex ? 4 : 2, 'item');
      }
    }
  }

  return {
    characters: finalizeCharacters(characterMap, knownCharacters),
    scenes: finalizeScenes(sceneMap),
    items: finalizeItems(itemMap),
    sourceChapterCount: chapters.length,
  };
}

function normalizeChapters(input: unknown): Array<{ index: number; title: string; content: string }> {
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
      title: String(chapter?.title ?? chapter?.chapterTitle ?? `第${idx + 1}章`),
      content: cleanText(String(chapter?.content ?? chapter?.text ?? chapter?.chapterContent ?? '')),
    }))
    .filter((chapter) => chapter.content.length > 20);
}

function addCandidate(
  map: Map<string, CandidateRecord>,
  rawName: string,
  chapterNumber: number,
  context: string,
  weight: number,
  kind: EntityKind,
) {
  const name = normalizeEntityName(rawName, kind);
  if (!isValidEntityName(name, kind)) return;
  const existing = map.get(name) || { name, count: 0, score: 0, chapters: new Set<number>(), contexts: [] };
  existing.count += 1;
  existing.score += weight;
  existing.chapters.add(chapterNumber);
  if (context && existing.contexts.length < 5 && !existing.contexts.includes(context)) {
    existing.contexts.push(context);
  }
  map.set(name, existing);
}

function finalizeCharacters(
  map: Map<string, CandidateRecord>,
  knownCharacters: Map<string, KnownCharacter>,
): ExtractedNovelCharacter[] {
  return Array.from(map.values())
    .filter((record) => record.count >= 2 || Boolean(knownCharacters.get(record.name)))
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, 24)
    .map((record, index) => {
      const known = knownCharacters.get(record.name);
      const role = known?.role || (knownCharacters.size === 0 && index === 0 ? 'protagonist' : 'supporting');
      return {
        name: record.name,
        role: role === 'antagonist' ? 'supporting' : role,
        gender: known?.gender || inferGender(record.name, record.contexts),
        description: buildDescription(record, '角色'),
        personality: null,
        appearance: null,
        sourceChapters: sortedChapters(record),
        score: record.score,
      };
    });
}

function finalizeScenes(map: Map<string, CandidateRecord>): ExtractedNovelScene[] {
  return Array.from(map.values())
    .filter((record) => record.score >= 2 || record.count >= 2)
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, 20)
    .map((record) => ({
      name: record.name,
      description: buildDescription(record, '场景'),
      atmosphere: inferAtmosphere(record.contexts),
      relatedChapters: sortedChapters(record),
      score: record.score,
    }));
}

function finalizeItems(map: Map<string, CandidateRecord>): ExtractedNovelItem[] {
  return Array.from(map.values())
    .filter((record) => record.score >= 2 || record.count >= 2)
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, 20)
    .map((record) => ({
      name: record.name,
      description: buildDescription(record, '物品'),
      significance: inferItemSignificance(record),
      relatedChapters: sortedChapters(record),
      score: record.score,
    }));
}

function collectKnownCharacters(ideaInput: unknown, protagonistInput: unknown): Map<string, KnownCharacter> {
  const map = new Map<string, KnownCharacter>();
  const idea = parseMaybeJson(ideaInput);
  addKnownCharacterText(map, String(protagonistInput || ''), 'protagonist');
  if (idea && typeof idea === 'object') {
    addKnownCharacterText(map, String((idea as any).characters || ''), 'protagonist');
    addKnownCharacterText(map, String((idea as any).supportingCharacters || ''), 'supporting');
  }
  return map;
}

function addKnownCharacterText(map: Map<string, KnownCharacter>, text: string, role: string) {
  if (!text) return;
  const normalized = text.replace(/\\n/g, '\n');
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (isValidEntityName(line, 'character')) {
      map.set(line, { role, gender: inferGender(line, [line]) });
      continue;
    }
    const header = line.match(/^([\u4e00-\u9fff]{2,6})\s*(?:[—\-:：]|【|\(|（)/);
    if (header && isValidEntityName(header[1], 'character')) {
      map.set(header[1], { role, gender: inferGender(header[1], [line]) });
      continue;
    }
    const names = line.split(/[、，,；;\s]+/).map((part) => part.trim()).filter(Boolean);
    if (names.length >= 2 && names.length <= 12 && names.every((name) => isValidEntityName(name, 'character'))) {
      for (const name of names) map.set(name, { role, gender: inferGender(name, [line]) });
    }
  }
}

function normalizeEntityName(name: string, kind: EntityKind): string {
  let cleaned = String(name || '')
    .replace(/[“”"'《》【】（）()\[\]，,。！？!?:：；;、\s]/g, '')
    .trim();
  if (kind === 'scene') {
    cleaned = cleaned
      .replace(/^.*(?:在|到|从|回到|进入|来到|走进|离开|穿过|赶往|抵达|站在|坐在|躲进|冲进|拖到|看向|望向|望着)/, '')
      .replace(/^的/, '');
  } else if (kind === 'item') {
    cleaned = cleaned
      .replace(/^.*(?:拿起|握着|攥着|掏出|递给|打开|捡起|放下|拔出|举起|藏着|戴着|扔出|收起|展开|按下|递过|交出|摸出)/, '')
      .replace(/^(?:手里|怀里|口袋里|掌心里|桌上|地上|盒里|箱里)/, '')
      .replace(/^的/, '');
  }
  return cleaned.slice(0, kind === 'character' ? 8 : 18);
}

function isValidEntityName(name: string, kind: EntityKind): boolean {
  if (!name || !/^[\u4e00-\u9fffA-Za-z0-9]+$/.test(name)) return false;
  if (/^(?:这个|那个|一种|一只|一条|一片|一点|一股|一声|一次|一天|所有|什么|怎么|为什么)/.test(name)) return false;
  if (kind === 'character') {
    if (!/^[\u4e00-\u9fff]{2,6}$/.test(name)) return false;
    if (CHARACTER_STOP_WORDS.has(name)) return false;
    if (/[的了着过吗呢啊吧]$/.test(name)) return false;
    return true;
  }
  if (kind === 'scene') {
    if (SCENE_STOP_WORDS.has(name)) return false;
    if (!new RegExp(`${SCENE_SUFFIX}$`).test(name)) return false;
    return name.length >= 2 && name.length <= 18;
  }
  if (ITEM_STOP_WORDS.has(name)) return false;
  if (!new RegExp(`${ITEM_SUFFIX}$`).test(name)) return false;
  return name.length >= 2 && name.length <= 18;
}

function inferGender(name: string, contexts: string[]): string | null {
  if (/(先生|少爷|大叔|叔|哥|父|爸|爷|公|王子|男)$/.test(name)) return 'male';
  if (/(小姐|夫人|太太|姐姐|姐|姨|母|妈|奶|妹|姑娘|女)$/.test(name)) return 'female';
  const text = contexts.join('');
  const femaleCount = (text.match(/她/g) || []).length;
  const maleCount = (text.match(/他/g) || []).length;
  if (femaleCount > maleCount) return 'female';
  if (maleCount > femaleCount) return 'male';
  return null;
}

function inferAtmosphere(contexts: string[]): string | null {
  const text = contexts.join('');
  if (/(昏暗|阴冷|压抑|死寂|潮湿|腐朽|破败|废弃)/.test(text)) return '昏暗压抑';
  if (/(热闹|喧哗|拥挤|灯火|繁华|吵闹)/.test(text)) return '热闹喧嚣';
  if (/(紧张|危险|杀意|追逐|逃|爆炸|警报|冲突)/.test(text)) return '紧张危险';
  if (/(温暖|柔和|安静|宁静|阳光|清风)/.test(text)) return '温暖安静';
  if (/(神秘|诡异|未知|迷雾|禁忌|异样)/.test(text)) return '神秘诡异';
  return null;
}

function inferItemSignificance(record: CandidateRecord): string | null {
  const text = record.contexts.join('');
  if (/(唯一|关键|线索|证据|秘密|真相|核心|钥匙|打开|解开)/.test(text)) return '关键线索';
  if (/(保命|救命|武器|护身|防身|攻击|斩|刺|开枪)/.test(text)) return '行动道具';
  if (/(纪念|遗物|承诺|约定|回忆|母亲|父亲|曾经)/.test(text)) return '情感象征';
  return record.count >= 3 ? '高频关键物品' : null;
}

function buildDescription(record: CandidateRecord, label: string): string {
  const chapters = sortedChapters(record).slice(0, 6).join('、');
  const context = record.contexts
    .map((item) => trimText(item, 120))
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
  return `来自小说正文第${chapters}章的${label}提取。${context}`;
}

function sortedChapters(record: CandidateRecord): number[] {
  return Array.from(record.chapters).sort((a, b) => a - b);
}

function sentenceAround(text: string, index: number): string {
  const start = Math.max(
    text.lastIndexOf('。', index),
    text.lastIndexOf('！', index),
    text.lastIndexOf('？', index),
    text.lastIndexOf('\n', index),
  ) + 1;
  const nextStops = ['。', '！', '？', '\n']
    .map((mark) => text.indexOf(mark, index + 1))
    .filter((pos) => pos >= 0);
  const end = nextStops.length > 0 ? Math.min(...nextStops) + 1 : Math.min(text.length, index + 120);
  return trimText(text.slice(Math.max(0, start), end), 180);
}

function cleanText(text: string): string {
  return text
    .replace(/<think[\s\S]*?<\/think>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function trimText(text: string, maxLength: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1)}…`;
}

function parseMaybeJson(input: unknown): unknown {
  if (!input || typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
