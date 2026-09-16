import { NextRequest } from 'next/server';
import { getModelName, getTemperature, getRawAIConfig } from '@/lib/ai-config';
import { appendAgentSkillPrompt } from '@/lib/agent-skills';
import { getPromptWithFallback } from '@/lib/prompt-helper';

export const maxDuration = 120;

// ============ 类型定义 ============

interface ProjectConfig {
  totalEpisodes: number;
  episodeDuration: number;
  startChapter?: number;
  endChapter?: number;
  chapterIds?: string[];
  platform?: string;
  style?: string;
  paywall?: string;
  audience?: string;
  budget?: string;
  keyMoments?: string;
  adaptations?: string;
}

interface DecisionTask {
  phase: 'skeleton' | 'strategy' | 'script';
  status: 'pending' | 'in_progress' | 'completed';
  input: string[];
  output: string[];
  dependencies: string[];
}

interface DecisionResponse {
  projectId: string;
  config: ProjectConfig;
  pipeline: DecisionTask[];
  warnings: string[];
  estimatedRounds: number;
}

// ============ 主API ============

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      novelId,
      projectConfig,
      mode = 'initialize', // initialize | evaluate_inputs | generate_skeleton_plan
    } = body;

    if (!novelId) {
      return Response.json(
        { success: false, error: '小说ID不能为空' },
        { status: 400 }
      );
    }

    const config: ProjectConfig = {
      totalEpisodes: projectConfig?.totalEpisodes || 20,
      episodeDuration: projectConfig?.episodeDuration || 2,
      startChapter: projectConfig?.startChapter,
      endChapter: projectConfig?.endChapter,
      chapterIds: projectConfig?.chapterIds || [],
      platform: projectConfig?.platform || '竖屏',
      style: projectConfig?.style || '',
      paywall: projectConfig?.paywall || '',
      audience: projectConfig?.audience || '女频',
      budget: projectConfig?.budget || '',
      keyMoments: projectConfig?.keyMoments || '',
      adaptations: projectConfig?.adaptations || '',
    };

    const modelName = await getModelName();
    const temperature = await getTemperature(0.3);
    const { apiUrl, apiKey, provider } = await getRawAIConfig();

    if (!apiKey) {
      // 即使没有API也可以做基础验证
      return Response.json({
        success: true,
        data: buildDecisionResponse(novelId, config, mode, null),
      });
    }

    console.log(`[Script Agent Decision] Using provider: ${provider}, model: ${modelName}, mode: ${mode}`);

    const systemPrompt = await buildDecisionSystemPrompt();
    const userPrompt = buildDecisionUserPrompt(novelId, config, mode);

    // 调用AI
    const resp = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature,
        max_tokens: 4096,
        reasoning_effort: 'none',
      }),
      signal: AbortSignal.timeout(60000),
    });

    let aiAnalysis: any = null;
    if (resp.ok) {
      const result = await resp.json();
      const content = result.choices?.[0]?.message?.content || '';
      aiAnalysis = parseAIResponse(content);
    }

    const decisionResponse = buildDecisionResponse(novelId, config, mode, aiAnalysis);

    return Response.json({
      success: true,
      data: decisionResponse,
    });
  } catch (error: any) {
    console.error('[Script Agent Decision] Error:', error);
    return Response.json(
      { success: false, error: error.message || '决策初始化失败' },
      { status: 500 }
    );
  }
}

// ============ 构建函数 ============

async function buildDecisionSystemPrompt(): Promise<string> {
  const skillKey = 'script-agent-decision-system';
  const defaultPrompt = `你是短剧项目的决策层Agent。你的职责：

## 角色定位
你是项目的"总指挥"——负责把一个模糊的小说改编想法，拆解成清晰的三阶段流水线。

## 三阶段流水线
1. **阶段1 - 故事骨架搭建**：结构→人物→分集
2. **阶段2 - 改编策略制定**：改编原则→素材选择→节奏设计
3. **阶段3 - 剧本编写**：分集内容→画面说明→台词

## 决策原则
- 每个阶段必须等前一阶段完成并通过审核后才能启动
- 阶段1是基础，没有合格骨架就没有后续
- 用户输入不清晰时，提出具体问题而非猜测
- 每阶段产出必须有明确的"通过标准"

## 任务拆分
对于每个阶段，需要明确：
- 输入数据：需要哪些前置产出
- 输出产物：本阶段的交付物
- 审核标准：如何判断质量达标
- 最大重试次数：避免无限循环

## 红线
- 不跳过任何阶段
- 不降低审核标准
- 不合并三阶段为一步

## 输出格式
输出JSON，包含：
- projectId: 项目ID
- config: 项目配置摘要
- pipeline: 三阶段任务列表，每阶段含 phase/input/output/dependencies/status
- warnings: 需要用户注意的问题
- estimatedRounds: 预估总轮次数`;

  const baseSystemPrompt = await getPromptWithFallback(skillKey, defaultPrompt, {});
  return appendAgentSkillPrompt(skillKey, baseSystemPrompt, {});
}

function buildDecisionUserPrompt(
  novelId: string,
  config: ProjectConfig,
  mode: string
): string {
  const { totalEpisodes, episodeDuration, startChapter, endChapter, platform, style, paywall, audience, keyMoments, adaptations } = config;

  return `请为以下短剧项目进行决策分析。

【项目ID】${novelId}

【项目配置】
- 集数：${totalEpisodes}集
- 单集时长：${episodeDuration}分钟
- 章节范围：${startChapter || '?'} - ${endChapter || '?'}
- 平台规格：${platform}
- 风格定位：${style || '未指定'}
- 付费策略：${paywall || '未指定'}
- 受众：${audience || '未指定'}
- 关键时刻：${keyMoments || '未指定'}
- 改编要求：${adaptations || '未指定'}

【执行模式】${mode}

请输出项目初始化决策：
1. 验证输入信息的完整性
2. 识别潜在风险和缺失信息
3. 规划三阶段流水线（骨架→策略→剧本）
4. 为每阶段明确输入/输出/依赖关系
5. 给出整体预估轮次

特别关注：
- 章节范围是否合理覆盖原著核心情节
- 集数与时长是否匹配
- 风格定位是否明确
- 是否需要用户补充关键信息`;
}

function parseAIResponse(content: string): any {
  try {
    return JSON.parse(content);
  } catch {
    return { rawContent: content };
  }
}

function buildDecisionResponse(
  projectId: string,
  config: ProjectConfig,
  mode: string,
  aiAnalysis: any
): DecisionResponse {
  // 根据配置调整流水线参数
  const warnings: string[] = [];

  // 检查配置合理性
  if (!config.style) warnings.push('风格定位未指定，建议明确类型（如：甜宠/复仇/穿越/重生）');
  if (!config.paywall) warnings.push('付费策略未指定，建议确认前10集约前5集免费');
  if (config.totalEpisodes < 10) warnings.push('集数建议≥10，否则节奏难以展开');
  if (config.totalEpisodes > 100) warnings.push('集数建议≤100，过长会影响质量');
  if (config.episodeDuration < 1) warnings.push('单集时长建议≥1分钟');
  if (config.episodeDuration > 5) warnings.push('单集时长建议≤5分钟，短剧节奏要快');
  if (!config.startChapter || !config.endChapter) warnings.push('章节范围未指定，建议明确原著改编范围');
  if (config.startChapter && config.endChapter && config.startChapter > config.endChapter) {
    warnings.push('章节范围异常：起始章大于结束章');
  }

  // 计算预估轮次
  const baseRounds = 3; // 骨架 + 策略 + 剧本 各1轮
  const reviewRounds = 1; // 每阶段审核1轮
  const retryBuffer = warnings.length > 3 ? 2 : 1; // 问题多则可能需要重试
  const estimatedRounds = (baseRounds + reviewRounds) * retryBuffer;

  return {
    projectId,
    config,
    pipeline: [
      {
        phase: 'skeleton',
        status: 'pending',
        input: ['novel_content', 'project_config', 'chapter_range'],
        output: ['story_skeleton', 'character_profiles', 'episode_breakdown', 'paywall_points', 'reversal_register'],
        dependencies: [],
      },
      {
        phase: 'strategy',
        status: 'pending',
        input: ['story_skeleton', 'character_profiles', 'episode_breakdown'],
        output: ['adaptation_principles', 'material_selection', 'rhythm_design', 'information_gap_strategy'],
        dependencies: ['skeleton'],
      },
      {
        phase: 'script',
        status: 'pending',
        input: ['story_skeleton', 'adaptation_principles', 'material_selection', 'rhythm_design'],
        output: ['episode_scripts', 'scene_descriptions', 'dialogues', 'paywall_cliffhangers'],
        dependencies: ['skeleton', 'strategy'],
      },
    ],
    warnings,
    estimatedRounds,
  };
}