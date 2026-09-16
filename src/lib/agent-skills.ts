import fs from 'node:fs';
import path from 'node:path';

export interface AgentSkill {
  code: string;
  name: string;
  description: string;
  category: string;
  relativePath: string;
  content: string;
}

export interface AgentSkillPromptContext {
  genre?: string | null;
  category?: string | null;
  tone?: string | string[] | null;
  genderTarget?: string | null;
  theme?: string | null;
  concept?: string | null;
  setting?: string | null;
  title?: string | null;
  text?: string | null;
  tags?: string[] | null;
  provider?: string | null;
  model?: string | null;
  roleType?: string | null;
  characterGender?: string | null;
  // 以下为各生成环节额外注入的上下文（用于技能匹配与占位符替换）
  toneNames?: string | null;
  genderTargetName?: string | null;
  genreName?: string | null;
  narrativePerspective?: string | null;
  protagonistName?: string | null;
  supportingCharacterName?: string | null;
}

const AGENT_SKILL_MARKER = '【Agent Skills 增强规则】';
/** 单次追加的技能文本总量上限：技能库单个文件可达 1w+ 字，全量拼接会挤爆上下文 */
const MAX_APPENDIX_SKILL_CHARS = 16000;
const SKILLS_ROOT = path.join(process.cwd(), 'agent-skills');

export const PROMPT_SKILL_MAP: Record<string, string[]> = {
  'idea-options-system': [
    'agent-skill-novel-market-research',
    'agent-skill-novel-premise',
  ],
  'idea-system': [
    'agent-skill-novel-market-research',
    'agent-skill-novel-premise',
    'agent-skill-novel-writing-brief',
  ],
  'structure-system': [
    'agent-skill-novel-outline',
    'agent-skill-novel-story-dissection',
  ],
  'trial-read-system': [
    'agent-skill-novel-writing-brief',
    'agent-skill-ai-dehumanizer',
  ],
  'chapter-title-system': [
    'agent-skill-novel-outline',
  ],
  'chapter-stream-system': [
    'agent-skill-novel-chapter-writer',
    'agent-skill-ai-dehumanizer',
  ],
  'chapter-regenerate-system': [
    'agent-skill-novel-chapter-writer',
    'agent-skill-ai-dehumanizer',
  ],
  'script-generate-system': [
    'agent-skill-drama-script-specialist',
    'agent-skill-drama-script-formatter',
    'agent-skill-drama-script-natural',
    'agent-skill-drama-script-continuity',
    'agent-skill-drama-script-novel-adaptation',
  ],
  // Agent 实时对话的剧本点位（优化对白 / 场景重排 / 场景数据补齐 / Agent 生成剧本）：
  // 该点位在 model_prompts 里没有自定义提示词，此前也未登记技能，是唯一完全未接入技能库的点位
  'agent-script-system': [
    'agent-skill-drama-script-natural',
    'agent-skill-drama-script-continuity',
    'agent-skill-drama-script-formatter',
  ],
  'extract-characters-system': [
    'agent-skill-drama-cast-scene-extract',
  ],
  'storyboard-breakdown-system': [
    'agent-skill-drama-storyboard-breakdown',
  ],
  'image-prompts-system': [
    'agent-skill-drama-image-prompt',
    'agent-skill-drama-quality-check',
  ],
  'video-prompts-system': [
    'agent-skill-drama-video-director',
    'agent-skill-drama-quality-check',
  ],
  'tts-voice-assign-system': [
    'agent-skill-drama-voice-assign',
  ],
  'novel-cover-prompt-system': [
    'agent-skill-novel-cover-prompt',
  ],
  'novel-title-system': [
    'agent-skill-novel-title',
  ],
  'quality-check-shots-system': [
    'agent-skill-drama-quality-check',
    'agent-skill-drama-storyboard-breakdown',
  ],
  'script-quality-check-system': [
    'agent-skill-drama-script-supervision',
    'agent-skill-drama-script-quality-check',
    'agent-skill-drama-script-specialist',
    'agent-skill-drama-script-continuity',
    'agent-skill-drama-script-novel-adaptation',
  ],
  'script-skeleton-system': [
    'agent-skill-drama-script-skeleton',
    'agent-skill-drama-development-reader',
    'agent-skill-drama-script-agent-decision',
  ],
  'script-adaptation-system': [
    'agent-skill-drama-script-adaptation',
    'agent-skill-drama-script-skeleton',
    'agent-skill-drama-script-agent-decision',
  ],
  'script-agent-decision-system': [
    'agent-skill-drama-script-agent-decision',
  ],
  'script-supervision-system': [
    'agent-skill-drama-script-supervision',
    'agent-skill-drama-script-skeleton',
    'agent-skill-drama-script-adaptation',
  ],
  'chapter-quality-check-system': [
    'agent-skill-novel-chapter-quality-check',
  ],
};

const GENRE_SKILL_SUFFIX_MAP: Record<string, string> = {
  fantasy: 'xuanhuan',
  xuanhuan: 'xuanhuan',
  xianxia: 'xianxia',
  wuxia: 'wuxia',
  romance: 'romance',
  mystery: 'mystery',
  thriller: 'mystery',
  horror: 'weird',
  weird: 'weird',
  'sci-fi': 'scifi',
  scifi: 'scifi',
  cyberpunk: 'scifi',
  'post-apocalyptic': 'apocalypse',
  apocalypse: 'apocalypse',
  game: 'game',
  campus: 'campus',
  farming: 'farming',
  officialdom: 'officialdom',
  business: 'officialdom',
  spy: 'spy',
  'time-travel': 'isekai',
  isekai: 'isekai',
  superpower: 'superpower',
  brainhole: 'brainhole',
  angst: 'angst',
};

const KEYWORD_SUFFIX_RULES: Array<{ suffix: string; keywords: string[] }> = [
  { suffix: 'xuanhuan', keywords: ['玄幻', '高武', '血脉', '万族', '境界', '武魂', '神骨'] },
  { suffix: 'xianxia', keywords: ['仙侠', '修仙', '修真', '飞升', '灵根', '金丹', '元婴', '天劫'] },
  { suffix: 'wuxia', keywords: ['武侠', '江湖', '门派', '侠客', '刀剑', '武林'] },
  { suffix: 'romance', keywords: ['言情', '爱情', '恋爱', '甜宠', '破镜重圆', '暧昧', '双向奔赴'] },
  { suffix: 'mystery', keywords: ['悬疑', '推理', '凶案', '侦探', '谜案', '真相'] },
  { suffix: 'weird', keywords: ['诡异', '怪谈', '灵异', '恐怖', '禁忌', '污染'] },
  { suffix: 'scifi', keywords: ['科幻', '赛博', '机甲', '星际', '飞船', '人工智能'] },
  { suffix: 'apocalypse', keywords: ['末世', '废土', '丧尸', '灾变', '避难所'] },
  { suffix: 'game', keywords: ['游戏', '副本', '玩家', '系统面板', '电竞'] },
  { suffix: 'campus', keywords: ['校园', '同桌', '高考', '社团', '青春'] },
  { suffix: 'farming', keywords: ['种田', '经营', '农家', '基建', '美食'] },
  { suffix: 'officialdom', keywords: ['官场', '商战', '权力', '仕途', '谈判'] },
  { suffix: 'spy', keywords: ['间谍', '卧底', '潜伏', '情报', '特工'] },
  { suffix: 'isekai', keywords: ['异世界', '穿越', '转生', '重生', '异界'] },
  { suffix: 'superpower', keywords: ['异能', '超能力', '觉醒者', '超凡'] },
  { suffix: 'brainhole', keywords: ['脑洞', '规则怪谈', '无限流', '反套路'] },
  { suffix: 'angst', keywords: ['虐恋', '虐心', '追妻', '火葬场'] },
];

const CONTEXTUAL_PROMPT_SKILLS: Record<string, string[]> = {
  'structure-system': ['agent-skill-novel-outline-continuity'],
  'chapter-title-system': ['agent-skill-novel-outline-continuity'],
  'chapter-stream-system': ['agent-skill-novel-chapter-writer-continuity'],
  'chapter-regenerate-system': ['agent-skill-novel-chapter-writer-continuity'],
};

const GENRE_PROMPT_PREFIXES: Record<string, string[]> = {
  'idea-options-system': ['agent-skill-novel-premise'],
  'idea-system': ['agent-skill-novel-premise', 'agent-skill-novel-writing-brief'],
  'structure-system': ['agent-skill-novel-outline'],
  'trial-read-system': ['agent-skill-novel-writing-brief'],
  'chapter-title-system': ['agent-skill-novel-outline'],
  'chapter-stream-system': ['agent-skill-novel-chapter-writer', 'agent-skill-novel-writing-brief'],
  'chapter-regenerate-system': ['agent-skill-novel-chapter-writer', 'agent-skill-novel-writing-brief'],
};

const ACTION_SKILL_CODE = 'agent-skill-martial-action-director';

let skillCache: AgentSkill[] | null = null;

function normalizeSkillCode(relativePath: string): string {
  const noExt = relativePath.replace(/\\/g, '/').replace(/\/SKILL\.md$/i, '').replace(/\.md$/i, '');
  return `agent-skill-${noExt}`
    .replace(/_/g, '-')
    .replace(/\//g, '-')
    .replace(/-skill$/i, '')
    .toLowerCase();
}

function parseFrontMatter(raw: string): { name?: string; description?: string; body: string } {
  if (!raw.startsWith('---')) return { body: raw.trim() };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { body: raw.trim() };
  const frontMatter = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trim();
  const parsed: Record<string, string> = {};
  for (const line of frontMatter.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    parsed[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
  }
  return { name: parsed.name, description: parsed.description, body };
}

function getFirstHeading(markdown: string): string {
  const line = markdown.split(/\r?\n/).find(l => /^#\s+/.test(l));
  return line ? line.replace(/^#\s+/, '').trim() : '';
}

function walkSkillFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSkillFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
      files.push(fullPath);
    }
  }
  return files;
}

function readReferenceMarkdown(skillDir: string): string {
  const referenceDir = path.join(skillDir, 'reference');
  if (!fs.existsSync(referenceDir)) return '';
  const files = fs.readdirSync(referenceDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map(entry => path.join(referenceDir, entry.name))
    .sort();

  if (files.length === 0) return '';
  return files.map(file => {
    const title = path.basename(file, '.md');
    const text = fs.readFileSync(file, 'utf8').trim();
    return `\n\n## 参考资料：${title}\n\n${text}`;
  }).join('');
}

export function getAgentSkills(): AgentSkill[] {
  if (skillCache) return skillCache;
  const files = walkSkillFiles(SKILLS_ROOT);
  skillCache = files.map(file => {
    const relativePath = path.relative(SKILLS_ROOT, file).replace(/\\/g, '/');
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = parseFrontMatter(raw);
    const referenceText = readReferenceMarkdown(path.dirname(file));
    const content = `${parsed.body}${referenceText}`.trim();
    const category = relativePath.split('/')[0] || 'agent';
    const fallbackName = getFirstHeading(content) || category.replace(/_/g, ' ');
    return {
      code: normalizeSkillCode(relativePath),
      name: parsed.name || fallbackName,
      description: parsed.description || fallbackName,
      category,
      relativePath,
      content,
    };
  }).sort((a, b) => a.code.localeCompare(b.code));
  return skillCache;
}

export function clearAgentSkillCache() {
  skillCache = null;
}

export function getAgentSkillByCode(code: string): AgentSkill | null {
  return getAgentSkills().find(skill => skill.code === code) || null;
}

function compactContextText(context?: AgentSkillPromptContext): string {
  if (!context) return '';
  const parts = [
    context.genre,
    context.category,
    Array.isArray(context.tone) ? context.tone.join(' ') : context.tone,
    context.genderTarget,
    context.theme,
    context.concept,
    context.setting,
    context.title,
    context.text,
    context.tags?.join(' '),
    context.provider,
    context.model,
    context.roleType,
    context.characterGender,
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function inferGenreSuffixes(context?: AgentSkillPromptContext): string[] {
  if (!context) return [];
  const suffixes = new Set<string>();
  const explicitValues = [context.genre, context.category]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim().toLowerCase());
  for (const value of explicitValues) {
    const normalized = value.replace(/_/g, '-');
    if (GENRE_SKILL_SUFFIX_MAP[normalized]) suffixes.add(GENRE_SKILL_SUFFIX_MAP[normalized]);
  }

  const text = compactContextText(context);
  for (const rule of KEYWORD_SUFFIX_RULES) {
    if (rule.keywords.some(keyword => text.includes(keyword.toLowerCase()))) {
      suffixes.add(rule.suffix);
    }
  }
  return Array.from(suffixes).slice(0, 3);
}

function hasActionContext(context?: AgentSkillPromptContext): boolean {
  const text = compactContextText(context);
  return ['武打', '打斗', '格斗', '动作', '招式', '追逐', '斗法', '战斗', '刀', '剑', '拳', '机甲', '搏杀']
    .some(keyword => text.includes(keyword.toLowerCase()));
}

function uniqueSkillCodes(codes: string[], availableCodes: Set<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const code of codes) {
    if (!availableCodes.has(code) || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
  }
  return result;
}

export function getAgentSkillCodesForPrompt(promptCode: string, context?: AgentSkillPromptContext): string[] {
  const availableCodes = new Set(getAgentSkills().map(skill => skill.code));
  const skillCodes = [
    ...(PROMPT_SKILL_MAP[promptCode] || []),
    ...(CONTEXTUAL_PROMPT_SKILLS[promptCode] || []),
  ];

  const suffixes = inferGenreSuffixes(context);
  const prefixes = GENRE_PROMPT_PREFIXES[promptCode] || [];
  for (const suffix of suffixes) {
    for (const prefix of prefixes) {
      skillCodes.push(`${prefix}-${suffix}`);
    }
  }

  if (
    ['script-generate-system', 'storyboard-breakdown-system', 'video-prompts-system'].includes(promptCode)
    && hasActionContext(context)
  ) {
    skillCodes.push(ACTION_SKILL_CODE);
  }

  return uniqueSkillCodes(skillCodes, availableCodes).slice(0, 8);
}

export function getAgentSkillsForPrompt(promptCode: string, context?: AgentSkillPromptContext): AgentSkill[] {
  const skillCodes = getAgentSkillCodesForPrompt(promptCode, context);
  if (skillCodes.length === 0) return [];
  const skills = getAgentSkills();
  return skillCodes
    .map(code => skills.find(skill => skill.code === code))
    .filter((skill): skill is AgentSkill => Boolean(skill));
}

export function buildAgentSkillAppendix(promptCode: string, context?: AgentSkillPromptContext): string {
  const skills = getAgentSkillsForPrompt(promptCode, context);
  if (skills.length === 0) return '';
  // 体量护栏：按顺序累积，超出上限后跳过后续技能；首个技能始终保留，
  // 保证「技能库已打通」不会被上限抹成空。
  const picked: AgentSkill[] = [];
  let total = 0;
  for (const skill of skills) {
    const size = skill.content.length;
    if (picked.length > 0 && total + size > MAX_APPENDIX_SKILL_CHARS) continue;
    picked.push(skill);
    total += size;
  }
  if (picked.length === 0) return '';
  // 技能注入可观测性：明确记录本次注入的点位、技能与体量，便于排查「技能没生效」
  console.log(
    '[AgentSkills] 注入 ' + promptCode + '：' + picked.map(s => s.code).join(', ')
    + '（' + picked.length + '/' + skills.length + ' 个，' + total + ' 字'
    + (picked.length < skills.length ? '，因体量上限跳过 ' + (skills.length - picked.length) + ' 个' : '')
    + '）'
  );
  const sections = picked.map(skill => [
    `### ${skill.name}`,
    `来源：${skill.relativePath}`,
    '',
    skill.content,
  ].join('\n'));
  return [
    AGENT_SKILL_MARKER,
    `以下规则来自项目内置 agent-skills 技能库，优先作为当前模块的专业增强规范执行；若与输出 JSON 格式冲突，以当前接口要求的输出格式为准。`,
    '',
    ...sections,
  ].join('\n\n');
}

export function appendAgentSkillPrompt(promptCode: string, systemPrompt: string, context?: AgentSkillPromptContext): string {
  const base = systemPrompt || '';
  if (base.includes(AGENT_SKILL_MARKER)) return base;
  const appendix = buildAgentSkillAppendix(promptCode, context);
  if (!appendix) return base;
  return `${base.trim()}\n\n${appendix}`.trim();
}
