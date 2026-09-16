/**
 * 资产提取模版引擎（角色 / 场景 / 物品）
 *
 * 设计要点：
 * - 模版就是一段可编辑的提示词，用户可在「角色/场景/物品提取模版」里改。
 * - 模版内用 {{变量名}} 占位，运行时按上下文渲染成真实内容。
 * - 变量渲染与校验都在这里，保持纯函数、无 DB 依赖，便于复用与测试。
 */

export type ExtractKind = 'character' | 'scene' | 'item' | 'storyboard';

export const EXTRACT_KINDS: ExtractKind[] = ['character', 'scene', 'item', 'storyboard'];

/** 单复数互转：UI/接口既接受 character 也接受 characters */
export function normalizeExtractKind(input: unknown): ExtractKind | null {
  const raw = String(input || '').trim().toLowerCase();
  if (raw === 'character' || raw === 'characters' || raw === 'role' || raw === 'roles') return 'character';
  if (raw === 'scene' || raw === 'scenes' || raw === 'location' || raw === 'locations') return 'scene';
  if (raw === 'item' || raw === 'items' || raw === 'prop' || raw === 'props') return 'item';
  if (raw === 'storyboard' || raw === 'storyboards' || raw === 'shot' || raw === 'shots') return 'storyboard';
  return null;
}

export const EXTRACT_KIND_META: Record<
  ExtractKind,
  { kind: ExtractKind; label: string; jsonKey: 'characters' | 'scenes' | 'items' | 'storyboards'; entityLabel: string; requiredVars: string[] }
> = {
  character: { kind: 'character', label: '角色', jsonKey: 'characters', entityLabel: '角色', requiredVars: ['小说原文'] },
  scene: { kind: 'scene', label: '场景', jsonKey: 'scenes', entityLabel: '场景', requiredVars: ['小说原文'] },
  item: { kind: 'item', label: '物品', jsonKey: 'items', entityLabel: '物品', requiredVars: ['小说原文'] },
  storyboard: { kind: 'storyboard', label: '分镜', jsonKey: 'storyboards', entityLabel: '分镜', requiredVars: ['章节文案'] },
};

/** 模版可用变量（前端「可用变量」面板与校验共用） */
export const EXTRACT_TEMPLATE_VARIABLES: Array<{
  key: string;
  label: string;
  group: string;
  description: string;
}> = [
  { key: '小说原文', label: '小说原文', group: '正文', description: '所选章节的正文（按提取范围拼接）' },
  { key: '章节标题', label: '章节标题', group: '正文', description: '所选章节的标题（多个用、分隔）' },
  { key: '章节号', label: '章节号', group: '正文', description: '所选章节号（多个用、分隔）' },
  { key: '章节列表', label: '章节列表', group: '正文', description: '整部作品的章节号与标题清单' },

  { key: '小说名称', label: '小说名称', group: '小说信息', description: '关联小说标题' },
  { key: '小说简介', label: '小说简介', group: '小说信息', description: '关联小说简介' },
  { key: '题材', label: '题材', group: '小说信息', description: '小说分类 / 题材' },
  { key: '目标性别', label: '目标性别', group: '小说信息', description: '男频 / 女频等' },
  { key: '叙事视角', label: '叙事视角', group: '小说信息', description: '如第一人称 / 第三人称' },
  { key: '基调', label: '基调', group: '小说信息', description: '小说整体基调' },
  { key: '主角设定', label: '主角设定', group: '小说信息', description: '小说主角设定' },
  { key: '故事情节', label: '故事情节', group: '小说信息', description: '主题创意 / 情节概要' },
  { key: '故事结构', label: '故事结构', group: '小说信息', description: '小说结构大纲' },
  { key: '风格DNA', label: '风格DNA', group: '小说信息', description: '小说风格画像' },

  { key: '作品名', label: '作品名', group: '短剧作品', description: '当前短剧作品标题' },
  { key: '作品简介', label: '作品简介', group: '短剧作品', description: '当前短剧作品简介' },
  { key: '作品风格', label: '作品风格', group: '短剧作品', description: '作品风格 / 类型' },
  { key: '角色画风', label: '角色画风', group: '短剧作品', description: '角色出图画风（用于角色提取）' },
  { key: '场景画风', label: '场景画风', group: '短剧作品', description: '场景出图画风（用于场景提取）' },
  { key: '物品画风', label: '物品画风', group: '短剧作品', description: '物品出图画风（用于物品提取）' },

  { key: '已有角色', label: '已有角色', group: '已有资产', description: '已提取的角色名，避免重复' },
  { key: '已有场景', label: '已有场景', group: '已有资产', description: '已提取的场景名，避免重复' },
  { key: '已有物品', label: '已有物品', group: '已有资产', description: '已提取的物品名，避免重复' },

  { key: '推文文案', label: '推文文案', group: '其它', description: '推广文案（当前系统未维护该字段，渲染为空）' },

  { key: '章节文案', label: '章节文案', group: '分镜生成', description: '按段落拆好的章节文案列表，逐条生成分镜' },
  { key: '角色信息', label: '角色信息', group: '分镜生成', description: '该作品的角色库（名称 + @名称 + 简介）' },
  { key: '场景信息', label: '场景信息', group: '分镜生成', description: '该作品的场景库（名称 + @名称 + 简介）' },
  { key: '物品信息', label: '物品信息', group: '分镜生成', description: '该作品的物品库（名称 + @名称 + 简介）' },
  { key: '前面分镜', label: '前面分镜', group: '分镜生成', description: '该集已生成的末尾分镜（供衔接），可用 {{前面分镜:N}} 取前 N 条' },
  { key: '后面分镜', label: '后面分镜', group: '分镜生成', description: '可用 {{后面分镜:N}} 取后 N 条（一般为空）' },
];

const VARIABLE_KEYS = new Set(EXTRACT_TEMPLATE_VARIABLES.map((v) => v.key));

/**
 * 渲染模版：{{变量}}/{{变量:参数}} → 上下文取值；未知变量渲染为空串。
 * 带参语法（如 {{前面分镜:2}}）只取变量名做替换，参数交由调用方在上下文里自行解释，
 * 这里保证：同一变量带不带参数都引用同一个上下文键。
 */
export function renderExtractTemplate(template: string, context: Record<string, unknown>): string {
  return String(template || '').replace(/\{\{\s*([^{}:\s]+)\s*(?::([^{}]*))?\s*\}\}/g, (_match, key: string, _param?: string) => {
    const value = context[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

export type ExtractTemplateAnalysis = {
  /** 模版里实际用到的变量 */
  used: string[];
  /** 未知变量（写错了或不受支持） */
  unknown: string[];
  /** 缺少的必备变量（缺了会导致模型拿不到正文） */
  missingRequired: string[];
  ok: boolean;
};

/** 校验模版：找出未知变量与缺少的必备变量 */
export function analyzeExtractTemplate(template: string, kind: ExtractKind): ExtractTemplateAnalysis {
  const used: string[] = [];
  const unknown: string[] = [];
  const re = /\{\{\s*([^{}:\s]+)\s*(?::([^{}]*))?\s*\}\}/g;
  let m: RegExpExecArray | null;
  const raw = String(template || '');
  while ((m = re.exec(raw)) !== null) {
    const key = m[1];
    if (!used.includes(key)) used.push(key);
    if (!VARIABLE_KEYS.has(key) && !unknown.includes(key)) unknown.push(key);
  }
  const required = EXTRACT_KIND_META[kind]?.requiredVars || [];
  const missingRequired = required.filter((key) => !used.includes(key));
  return { used, unknown, missingRequired, ok: unknown.length === 0 && missingRequired.length === 0 && raw.trim().length > 0 };
}

/** 章节标准化（与提取器内部结构保持一致） */
export type ExtractChapter = { index: number; title: string; content: string };

/** 把 novel.chapters / script.chapters 等形态统一成章节数组 */
export function normalizeExtractChapters(input: unknown): ExtractChapter[] {
  let list: any[] = [];
  if (Array.isArray(input)) list = input;
  else if (typeof input === 'string' && input.trim()) {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  return list
    .map((raw, i) => {
      const paragraphs = Array.isArray(raw?.paragraphs) ? raw.paragraphs.join('\n') : '';
      const content = String(
        raw?.content ?? raw?.text ?? raw?.body ?? raw?.chapterContent ?? paragraphs ?? '',
      ).trim();
      const index = Number(raw?.index ?? raw?.chapterNumber ?? raw?.number ?? i + 1) || i + 1;
      const title = String(raw?.title ?? raw?.name ?? ('第' + index + '章')).trim();
      return { index, title, content };
    })
    .filter((c) => c.content.length > 0);
}

/** 按章节号筛选（1 基，匹配 chapter.index）；未传则返回全部 */
export function pickExtractChapters(chapters: ExtractChapter[], chapterIndexes?: number[] | null): ExtractChapter[] {
  if (!chapterIndexes || chapterIndexes.length === 0) return chapters;
  const wanted = new Set(chapterIndexes.map((n) => Number(n)).filter((n) => Number.isFinite(n)));
  const picked = chapters.filter((c) => wanted.has(c.index));
  return picked.length > 0 ? picked : chapters;
}

/** 构造模版渲染上下文 */
export function buildExtractTemplateContext(opts: {
  kind: ExtractKind;
  novel?: any;
  drama?: any;
  chapters: ExtractChapter[];
  allChapters?: ExtractChapter[];
  existingNames?: string[];
}): Record<string, string> {
  const { kind, novel, drama, chapters } = opts;
  const list = opts.allChapters && opts.allChapters.length > 0 ? opts.allChapters : chapters;
  const text = (v: unknown, limit = 0) => {
    const s = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
    const trimmed = s.trim();
    if (!limit || trimmed.length <= limit) return trimmed;
    return trimmed.slice(0, limit) + '…';
  };

  const novelOriginal = chapters
    .map((c) => '【第' + c.index + '章 ' + c.title + '】\n' + c.content)
    .join('\n\n');

  const existingLabel = kind === 'character' ? '已有角色' : kind === 'scene' ? '已有场景' : '已有物品';

  const context: Record<string, string> = {
    小说原文: novelOriginal,
    章节标题: chapters.map((c) => c.title).join('、'),
    章节号: chapters.map((c) => c.index).join('、'),
    章节列表: list.map((c) => '第' + c.index + '章 ' + c.title).join('\n'),

    小说名称: text(novel?.title),
    小说简介: text(novel?.description, 1200),
    题材: text(novel?.category),
    目标性别: text(novel?.genderTarget),
    叙事视角: text(novel?.narrativePerspective),
    基调: text(novel?.tone),
    主角设定: text(novel?.protagonist, 1500),
    故事情节: text(novel?.idea, 2000),
    故事结构: text(novel?.structure, 2000),
    风格DNA: text(novel?.styleDNA, 1200),

    作品名: text(drama?.title),
    作品简介: text(drama?.description, 1200),
    作品风格: text(drama?.style || drama?.genre),
    角色画风: text(drama?.characterStyle, 800),
    场景画风: text(drama?.sceneStyle, 800),
    物品画风: text(drama?.itemStyle, 800),

    推文文案: '',
  };
  context[existingLabel] = (opts.existingNames || []).join('、');
  // 分镜相关变量：默认给空，由分镜生成接口按作品库与拆段结果覆盖
  if (kind === 'storyboard') {
    context['章节文案'] = '';
    context['角色信息'] = '';
    context['场景信息'] = '';
    context['物品信息'] = '';
    context['前面分镜'] = '（无）';
    context['后面分镜'] = '（无）';
  }
  return context;
}
