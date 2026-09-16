import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { getAgentSkillCodesForPrompt, getAgentSkills, PROMPT_SKILL_MAP } from '@/lib/agent-skills';

type AgentPromptTarget = {
  area: string;
  label: string;
  href: string;
  accent: string;
};

const PROMPT_TARGETS: Record<string, AgentPromptTarget> = {
  'idea-options-system': { area: '小说', label: '创意方向', href: '/novel-generator', accent: 'cyan' },
  'idea-system': { area: '小说', label: '核心创意', href: '/novel-generator', accent: 'cyan' },
  'structure-system': { area: '小说', label: '结构大纲', href: '/novel-generator', accent: 'emerald' },
  'trial-read-system': { area: '小说', label: '试读段落', href: '/novel-generator', accent: 'emerald' },
  'chapter-title-system': { area: '小说', label: '章节标题', href: '/novel-generator', accent: 'amber' },
  'chapter-stream-system': { area: '小说', label: '章节正文', href: '/novel-generator', accent: 'amber' },
  'chapter-regenerate-system': { area: '小说', label: '章节重写', href: '/novel-generator', accent: 'amber' },
  'novel-cover-prompt-system': { area: '小说', label: '封面提示词', href: '/novel-generator', accent: 'sky' },
  'script-generate-system': { area: '剧本', label: '剧本生成', href: '/scripts', accent: 'orange' },
  'extract-characters-system': { area: '短剧', label: '角色场景提取', href: '/short-dramas', accent: 'rose' },
  'storyboard-breakdown-system': { area: '短剧', label: '分镜拆解', href: '/short-dramas', accent: 'violet' },
  'image-prompts-system': { area: '短剧', label: '图片提示词', href: '/short-dramas', accent: 'sky' },
  'video-prompts-system': { area: '短剧', label: '视频提示词', href: '/short-dramas', accent: 'indigo' },
  'tts-voice-assign-system': { area: '配音', label: '角色配音', href: '/short-dramas', accent: 'teal' },
};

const CATEGORY_LABELS: Record<string, string> = {
  ai_dehumanizer: '文本润色',
  drama_cast_scene_extract: '短剧角色场景',
  drama_development_reader: '剧本审读',
  drama_image_prompt: '图片分镜',
  drama_script_formatter: '剧本格式',
  drama_storyboard_breakdown: '短剧分镜',
  drama_video_director: '视频导演',
  drama_voice_assign: '角色配音',
  martial_action_director: '动作设计',
  novel_chapter_writer: '小说章节',
  novel_cover_prompt: '小说封面',
  novel_market_research: '市场定位',
  novel_outline: '小说大纲',
  novel_premise: '小说创意',
  novel_story_dissection: '故事拆解',
  novel_writing_brief: '写作规范',
};

function exactPromptCodesForSkill(skillCode: string) {
  return Object.entries(PROMPT_SKILL_MAP)
    .filter(([, skillCodes]) => skillCodes.includes(skillCode))
    .map(([promptCode]) => promptCode);
}

function inferredPromptCodesForSkill(skillCode: string) {
  if (skillCode.startsWith('agent-skill-novel-premise')) return ['idea-options-system', 'idea-system'];
  if (skillCode.startsWith('agent-skill-novel-market-research')) return ['idea-options-system', 'idea-system'];
  if (skillCode.startsWith('agent-skill-novel-writing-brief')) return ['idea-system', 'trial-read-system'];
  if (skillCode.startsWith('agent-skill-novel-outline')) return ['structure-system', 'chapter-title-system'];
  if (skillCode.startsWith('agent-skill-novel-story-dissection')) return ['structure-system'];
  if (skillCode.startsWith('agent-skill-novel-chapter-writer')) return ['chapter-stream-system', 'chapter-regenerate-system'];
  if (skillCode.startsWith('agent-skill-novel-cover-prompt')) return ['novel-cover-prompt-system'];
  if (skillCode.startsWith('agent-skill-ai-dehumanizer')) return ['trial-read-system', 'chapter-stream-system', 'chapter-regenerate-system'];
  if (skillCode.startsWith('agent-skill-drama-script-formatter')) return ['script-generate-system'];
  if (skillCode.startsWith('agent-skill-drama-development-reader')) return ['script-generate-system'];
  if (skillCode.startsWith('agent-skill-drama-cast-scene-extract')) return ['extract-characters-system'];
  if (skillCode.startsWith('agent-skill-drama-storyboard-breakdown')) return ['storyboard-breakdown-system'];
  if (skillCode.startsWith('agent-skill-drama-image-prompt')) return ['image-prompts-system'];
  if (skillCode.startsWith('agent-skill-drama-video-director')) return ['video-prompts-system'];
  if (skillCode.startsWith('agent-skill-drama-voice-assign')) return ['tts-voice-assign-system'];
  if (skillCode.startsWith('agent-skill-martial-action-director')) return ['script-generate-system', 'video-prompts-system'];
  return [];
}

function promptCodesForSkill(skillCode: string) {
  return Array.from(new Set([...exactPromptCodesForSkill(skillCode), ...inferredPromptCodesForSkill(skillCode)]))
    .filter(promptCode => PROMPT_TARGETS[promptCode]);
}

function alwaysPromptCodesForSkill(skillCode: string) {
  return Object.keys(PROMPT_TARGETS)
    .filter(promptCode => getAgentSkillCodesForPrompt(promptCode).includes(skillCode));
}

export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) {
      return NextResponse.json({ success: false, error: '请先登录后再查看 Agent 工作台' }, { status: 401 });
    }
    if (payload.role !== 'admin') {
      return NextResponse.json({ success: false, error: '仅管理员可以查看 Agent 工作台' }, { status: 403 });
    }

    const skills = getAgentSkills().map(skill => {
      const promptCodes = promptCodesForSkill(skill.code);
      const alwaysPromptCodes = new Set(alwaysPromptCodesForSkill(skill.code));
      const targets = promptCodes.map(promptCode => ({
        promptCode,
        mode: alwaysPromptCodes.has(promptCode) ? 'always' : 'contextual',
        modeLabel: alwaysPromptCodes.has(promptCode) ? '默认接入' : '按题材触发',
        ...PROMPT_TARGETS[promptCode],
      }));
      const primaryArea = targets[0]?.area || (skill.code.includes('novel') ? '小说' : skill.code.includes('drama') ? '短剧' : '通用');

      return {
        code: skill.code,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        categoryLabel: CATEGORY_LABELS[skill.category] || skill.category.replace(/_/g, ' '),
        relativePath: skill.relativePath,
        contentLength: skill.content.length,
        area: primaryArea,
        targets,
      };
    });

    const modules = Object.entries(PROMPT_TARGETS).map(([promptCode, target]) => ({
      promptCode,
      ...target,
      skillCount: skills.filter(skill => skill.targets.some(item => item.promptCode === promptCode && item.mode === 'always')).length,
      contextualSkillCount: skills.filter(skill => skill.targets.some(item => item.promptCode === promptCode && item.mode === 'contextual')).length,
    }));

    const areas = Array.from(new Set(skills.flatMap(skill => [skill.area, ...skill.targets.map(target => target.area)])))
      .filter(Boolean)
      .map(area => ({
        area,
        skillCount: skills.filter(skill => skill.area === area || skill.targets.some(target => target.area === area)).length,
      }));

    return NextResponse.json({
      success: true,
      data: {
        skills,
        modules,
        areas,
        totals: {
          skills: skills.length,
          modules: modules.length,
          linkedSkills: skills.filter(skill => skill.targets.some(target => target.mode === 'always')).length,
          contextualSkills: skills.filter(skill => !skill.targets.some(target => target.mode === 'always') && skill.targets.length > 0).length,
          possibleLinkedSkills: skills.filter(skill => skill.targets.length > 0).length,
        },
      },
    });
  } catch (error) {
    console.error('[AgentSkills] frontend GET error:', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '获取 Agent 技能失败' }, { status: 500 });
  }
}
