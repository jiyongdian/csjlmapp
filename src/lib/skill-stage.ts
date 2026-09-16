export type SkillStage = 'novel' | 'script' | 'image-prompt' | 'video-prompt';

export interface DefaultSkillSeed {
  name: string;
  description: string;
  systemPrompt: string;
  userPrompt: string;
}

export interface SkillStageDef {
  key: SkillStage;
  label: string;
  icon: string;
  desc: string;
  codes: string[];
  defaultSkill: DefaultSkillSeed;
}

export const SYSTEM_SKILL_USER = 'system';

export const SKILL_STAGES: SkillStageDef[] = [
  {
    key: 'novel',
    label: '小说生成',
    icon: '📖',
    desc: '创意 → 结构 → 章节正文的全流程写作技能，注入到小说相关的全部提示词。',
    codes: [
      'idea-options-system',
      'idea-system',
      'structure-system',
      'trial-read-system',
      'chapter-title-system',
      'chapter-stream-system',
      'chapter-regenerate-system',
    ],
    defaultSkill: {
      name: '小说写作核心技能',
      description: '统一约束小说生成的立意、节奏、文风与去 AI 味要求。',
      systemPrompt: [
        '【写作技能：小说生成】',
        '1. 立意优先：每一章都要有明确的目标、冲突与钩子，章末必须留下让人想点下一章的悬念。',
        '2. 节奏控制：三章铺垫推进、一章集中爆发；长段落之间穿插短句与对白，避免匀速叙述。',
        '3. 人物驱动：人物要有欲望、缺陷与代价，行为必须符合已建立的人设，不为了推进剧情而让人物降智。',
        '4. 场景落地：多用具体动作、感官细节与对白推进，少用概括性叙述和形容词堆砌。',
        '5. 去 AI 味：禁用「总而言之」「不禁」「仿佛」「这一刻」「空气中弥漫着」等高频套话；禁止排比式抒情与空洞总结。',
        '6. 一致性：与已有设定、前文伏笔、人物关系保持连贯，不新增与既定设定冲突的信息。',
      ].join('\n'),
      userPrompt: '',
    },
  },
  {
    key: 'script',
    label: '剧本生成',
    icon: '🎬',
    desc: '把小说改编为可拍摄的剧本与分镜剧本，注入到剧本生成提示词。',
    codes: ['script-generate-system', 'agent-script-system'],
    defaultSkill: {
      name: '剧本改编核心技能',
      description: '把小说文本改编成可拍摄、可继续拆分为分镜的剧本。',
      systemPrompt: [
        '【写作技能：剧本生成】',
        '1. 以可拍摄为目标：每个场景写清地点、时间、人物、动作与台词，避免大段心理描写。',
        '2. 台词承担信息与冲突：一句台词要么推进剧情，要么暴露人物，要么制造张力。',
        '3. 场景切分：按戏剧单元切分场景，每场有起承转合，结尾留钩子。',
        '4. 视觉优先：把内心活动转成可拍的动作、表情、道具与场面调度。',
        '5. 格式规范：场景标题、出场人物、动作描述、对白分行输出，便于后续分镜与配音复用。',
      ].join('\n'),
      userPrompt: '',
    },
  },
  {
    key: 'image-prompt',
    label: '图片提示词',
    icon: '🖼️',
    desc: '为分镜生成可直接出图的图片提示词，注入到图片分镜提示词。',
    codes: ['image-prompts-system'],
    defaultSkill: {
      name: '图片提示词核心技能',
      description: '把剧本场景转成具体、可画、风格一致的出图提示词。',
      systemPrompt: [
        '【写作技能：图片提示词生成】',
        '1. 只描述画面：主体、动作、表情、服饰、环境、光线、色调、镜头与构图，不写剧情与心理活动。',
        '2. 结构固定：按「主体 + 动作 + 环境 + 光线色调 + 镜头景别 + 画质风格」的顺序组织。',
        '3. 具体可画：使用可视觉化的名词与形容词，避免抽象概念、比喻与文学化表达。',
        '4. 一致性：同一角色/场景在不同分镜中保持外观特征、服装与风格描述一致。',
        '5. 参考对象：画面中出现的人物、场景、物品按登记名称以 @ 提及，便于参考图匹配。',
      ].join('\n'),
      userPrompt: '',
    },
  },
  {
    key: 'video-prompt',
    label: '视频提示词',
    icon: '🎥',
    desc: '为分镜生成带运镜与时间轴的视频提示词，注入到视频分镜提示词。',
    codes: ['video-prompts-system'],
    defaultSkill: {
      name: '视频提示词核心技能',
      description: '把分镜转成带运镜、时间轴与声音设计的可执行视频提示词。',
      systemPrompt: [
        '【写作技能：视频提示词生成】',
        '1. 以运镜与运动为核心：写明镜头运动（推、拉、摇、移、跟、升降）、主体动作时序与节奏。',
        '2. 时间轴清晰：把镜头拆成若干时间片，逐段描述画面变化，保证可执行、无歧义。',
        '3. 声音与对白：标注对白、音效与音乐情绪，并与画面节奏对齐。',
        '4. 一致性：角色外观、服装、场景与图片分镜保持一致，衔接上一镜头的结尾状态。',
        '5. 结构化输出：按平台要求的字段结构输出，不输出多余解释文字。',
      ].join('\n'),
      userPrompt: '',
    },
  },
];

export function isSkillStage(value: string): value is SkillStage {
  return SKILL_STAGES.some((stage) => stage.key === value);
}

export function getStageDef(key: string): SkillStageDef | null {
  return SKILL_STAGES.find((stage) => stage.key === key) ?? null;
}

export function stageByPromptCode(code: string): SkillStage | null {
  if (!code) return null;
  for (const stage of SKILL_STAGES) {
    if (stage.codes.indexOf(code) !== -1) return stage.key;
  }
  return null;
}
