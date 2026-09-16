import { NextRequest } from 'next/server';
import { getModelName, getTemperature, getRawAIConfig } from '@/lib/ai-config';
import { appendAgentSkillPrompt } from '@/lib/agent-skills';
import { getPromptWithFallback } from '@/lib/prompt-helper';

export const maxDuration = 300;

// ============ 类型定义 ============

type ReviewType = 'skeleton' | 'strategy' | 'script';
type RatingLevel = 'A' | 'B' | 'C' | 'D';

interface SupervisionIssue {
  severity: '🔴 严重' | '🟡 中等' | '⚪ 轻微';
  item: string;
  problem: string;
  suggestion: string;
}

interface SupervisionReport {
  rating: RatingLevel;
  summary: string;
  issues: SupervisionIssue[];
  decisions?: string[];
  reviewType: ReviewType;
}

// ============ 审核配置 ============

const SKELETON_REVIEW_DIMENSIONS = [
  { item: '结构完整性', severity: '🔴 严重' as const, standard: '故事核存在且聚焦主角内在冲突；隐线清晰；三幕均有功能' },
  { item: '分集与时长', severity: '🟡 中等' as const, standard: '分集数等于配置集数；每集时长符合±10秒' },
  { item: '章节全覆盖', severity: '🔴 严重' as const, standard: '指定原著章节全部分配到具体集数' },
  { item: '付费点分布', severity: '🔴 严重' as const, standard: '按≈10%/30%/50%/70%/90%比例分布' },
  { item: '股价级反转登记', severity: '🔴 严重' as const, standard: '约3个反转；预埋集早于揭晓集；三式合规' },
  { item: '矛盾强度', severity: '🔴 严重' as const, standard: '大三角立在真矛盾上，达高级/升级级别' },
  { item: '三大密度结构', severity: '🟡 中等' as const, standard: '单一核心情绪主线、信息前置、每集为真情节' },
  { item: '心理级爽点/金手指', severity: '🔴 严重' as const, standard: '锁定核心爽点；金手指新颖非同质化' },
  { item: '投放素材', severity: '🟡 中等' as const, standard: '前10集约10个投流素材爆点' },
  { item: '前10%黄金结构', severity: '🟡 中等' as const, standard: '完成一秒入坑→目标明确→多方施压→首次卡点' },
  { item: '情绪布局', severity: '🟡 中等' as const, standard: '波浪上升、与类型匹配、无连续3集同强度' },
  { item: '信息差标注', severity: '🟡 中等' as const, standard: '关键集数标注了信息差类型' },
  { item: '集末钩子', severity: '🟡 中等' as const, standard: '每集有钩子、类型多样化、永不收尾' },
  { item: '节奏框架', severity: '⚪ 轻微' as const, standard: '与该类型通用节奏框架吻合' },
];

const ADAPTATION_REVIEW_DIMENSIONS = [
  { item: '8大要点覆盖', severity: '🟡 中等' as const, standard: '强画面感/台词精简/节奏极致快/只沿主线/降低理解成本/情绪大于一切/开篇给足期待感/展示不要告诉' },
  { item: '情绪基调一致性', severity: '🟡 中等' as const, standard: '与骨架类型匹配，无中途大幅偏离' },
  { item: '人物弧光保留', severity: '🟡 中等' as const, standard: '主角和重要配角弧光完整，保留设定记忆点' },
  { item: '删减合理性', severity: '🟡 中等' as const, standard: '遵循优先级原则，优先保留情绪点/关系拉扯/付费铺垫' },
  { item: '世界观呈现', severity: '🟡 中等' as const, standard: '有渐进式呈现方案，通过对话/OS/VO逐步透露' },
  { item: '语言适配', severity: '⚪ 轻微' as const, standard: '称谓符合短剧规范，台词口语化' },
  { item: '用户意图一致性', severity: '🔴 严重' as const, standard: '策略以用户指定方向为最高优先级' },
  { item: '三大密度策略', severity: '🟡 中等' as const, standard: '以三大密度为删/留标尺' },
  { item: '原创性/反洗稿', severity: '🔴 严重' as const, standard: '非同质化，未落入模仿/抄桥段/洗稿三条死路' },
  { item: '心理级爽点锁定', severity: '🟡 中等' as const, standard: '锁定核心心理级爽点' },
  { item: '股价级反转来源一致', severity: '🔴 严重' as const, standard: '与骨架登记表一一对应、不冲突' },
  { item: 'AI形态适配', severity: '🟡 中等' as const, standard: '画面优先、可被AI稳定生成、规避重复/跳脸' },
];

const SCRIPT_REVIEW_DIMENSIONS = [
  { item: '三大情绪要点', severity: '🔴 严重' as const, standard: '每集至少覆盖爆点/虐点/爽点之一' },
  { item: '三大密度', severity: '🔴 严重' as const, standard: '情绪密度/信息密度/情节密度均不低' },
  { item: '节奏3-15-45', severity: '🟡 中等' as const, standard: '3秒情绪冲击/15秒剧情变化/45秒强期待' },
  { item: '黄金单集公式', severity: '🔴 严重' as const, standard: '情节承接+冲突升级+价值币环+下集勾连' },
  { item: '钩子设计', severity: '🟡 中等' as const, standard: '集末钩子类型多样，永不收尾' },
  { item: '台词规范', severity: '🟡 中等' as const, standard: '展示不要告诉/单句≤20字/角色可辨' },
  { item: '画面感', severity: '🟡 中等' as const, standard: '场景/细节/动作/镜头描写到位' },
  { item: '时长控制', severity: '⚪ 轻微' as const, standard: '符合单集时长±10秒' },
  { item: '转场标注', severity: '⚪ 轻微' as const, standard: '转场方式标注准确' },
];

const GENERAL_REDLINES = [
  '连续3集以上无情绪爆点（爽点/虐点/甜点任一）',
  '出现多线并行叙事（短剧必须单线型）',
  '第1集无强冲突/强情绪场景',
  '出现"市长""县长"等现实官职称谓',
  '大段旁白解说世界观（应通过对话/OS/VO逐步透露）',
  '金手指同质化（市面出现>10次/换汤不换药），无原创卖点',
  '全剧无明确股价级反转，或反转空降硬凹',
  '开篇踩三天坑（上来铺背景/讲世界观、一群人开会、慢悠悠写景扯前情）',
  '大三角只堆吵架冲突、无底层欲望—阻碍的真矛盾',
];

// ============ 主API ============

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      novelId,
      reviewType = 'skeleton',
      skeleton,
      adaptationStrategy,
      scriptContent,
      totalEpisodes = 20,
      episodeDuration = 2,
      platform = '竖屏',
      style = '',
      paywall = '',
      chapters,
    } = body;

    if (!novelId) {
      return Response.json(
        { success: false, error: '小说ID不能为空' },
        { status: 400 }
      );
    }

    const reviewTypeSafe: ReviewType = (['skeleton', 'strategy', 'script'] as const).includes(reviewType)
      ? reviewType
      : 'skeleton';

    const modelName = await getModelName();
    const temperature = await getTemperature(0.2);
    const { apiUrl, apiKey, provider } = await getRawAIConfig();

    if (!apiKey) {
      return Response.json(
        { success: false, error: 'API密钥未配置' },
        { status: 503 }
      );
    }

    console.log(`[Script Supervision] Using provider: ${provider}, model: ${modelName}, type: ${reviewTypeSafe}`);

    // 获取系统提示词（使用增强的监督层skill）
    const systemPrompt = await buildSupervisionSystemPrompt(reviewTypeSafe);

    // 构建用户提示词
    const userPrompt = buildSupervisionUserPrompt(
      reviewTypeSafe,
      skeleton,
      adaptationStrategy,
      scriptContent,
      { totalEpisodes, episodeDuration, platform, style, paywall },
      chapters
    );

    // 调用AI获取审核结果
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
        max_tokens: 8192,
        reasoning_effort: 'none',
      }),
      signal: AbortSignal.timeout(180000),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`AI 接口错误: ${resp.status} - ${errorText}`);
    }

    const result = await resp.json();
    const content = result.choices?.[0]?.message?.content || '';

    // 解析审核结果
    const report = parseSupervisionReport(content, reviewTypeSafe);

    return Response.json({
      success: true,
      data: {
        report,
        rawContent: content,
        reviewType: reviewTypeSafe,
      },
    });
  } catch (error: any) {
    console.error('[Script Supervision] Error:', error);
    return Response.json(
      { success: false, error: error.message || '监督审核失败' },
      { status: 500 }
    );
  }
}

// ============ 构建函数 ============

async function buildSupervisionSystemPrompt(reviewType: ReviewType): Promise<string> {
  const skillKey = 'script-supervision-system';
  const defaultPrompt = getDefaultSupervisionPrompt(reviewType);
  const baseSystemPrompt = await getPromptWithFallback(skillKey, defaultPrompt, {});
  return appendAgentSkillPrompt(skillKey, baseSystemPrompt, {});
}

function getDefaultSupervisionPrompt(reviewType: ReviewType): string {
  const dimensions = reviewType === 'skeleton'
    ? SKELETON_REVIEW_DIMENSIONS
    : reviewType === 'strategy'
      ? ADAPTATION_REVIEW_DIMENSIONS
      : SCRIPT_REVIEW_DIMENSIONS;

  const dimensionsText = dimensions.map((d, i) => `${i + 1}. **${d.item}** (${d.severity})：${d.standard}`).join('\n');
  const redlinesText = GENERAL_REDLINES.map((r, i) => `${i + 1}. ${r}`).join('\n');

  return `你是短剧改编项目的**监督层 Agent**，负责独立审核产出物质量。你只提出问题和建议，不做任何修改决策。

## 审核对象
当前审核类型：**${reviewType === 'skeleton' ? '故事骨架' : reviewType === 'strategy' ? '改编策略' : '剧本内容'}**

## 审核维度
${dimensionsText}

## 短剧通用红线（违反即为严重问题）
${redlinesText}

## 评分标准
| 评分 | 严重问题 | 中等问题 |
|------|----------|----------|
| A — 可直接使用 | 0 | ≤2 |
| B — 小修后可用 | 0 | ≤5 |
| C — 需较大修改 | 1-2 | 不限 |
| D — 建议重做 | ≥3 | 不限 |

## 审核原则
1. **工具调取优先**：所有审核依据必须通过实际内容读取，不得凭记忆审核
2. **可执行优先**：标准是"能不能用"，不是"完不完美"
3. **问题具体化**：每个问题指向具体位置和内容
4. **建议多元化**：严重问题提供多个可选方案
5. **Skills对照审核**：所有审核项须对照红线清单逐项核对

## 输出格式
输出Markdown审核报告，结构如下：

# 审核报告：{审核对象}

## 总评
- **评分**：{A/B/C/D}
- **概要**：{一句话总评，可顺带肯定亮点}

## 问题清单

| # | 严重程度 | 审核项 | 问题 | 建议方案 |
|---|----------|--------|------|----------|
| 1 | 🔴 严重 | {审核项} | {一句话描述} | {多选方案用"/"分隔} |
| 2 | 🟡 中等 | {审核项} | {一句话描述} | {修复建议} |
| 3 | ⚪ 轻微 | {审核项} | {一句话描述} | {修复建议} |

## 需要您决定（仅 C/D 级或严重问题存在多选方案时输出）
1. {选择题}

## 跨阶段一致性检查
{骨架与策略一致性 / 策略与剧本一致性检查结果}`;
}

function buildSupervisionUserPrompt(
  reviewType: ReviewType,
  skeleton: string | undefined,
  adaptationStrategy: string | undefined,
  scriptContent: any,
  projectConfig: { totalEpisodes: number; episodeDuration: number; platform: string; style: string; paywall: string },
  chapters: any[] | undefined
): string {
  const { totalEpisodes, episodeDuration, platform, style, paywall } = projectConfig;

  let contentToReview = '';
  if (reviewType === 'skeleton' && skeleton) {
    contentToReview = skeleton;
  } else if (reviewType === 'strategy' && adaptationStrategy) {
    contentToReview = adaptationStrategy;
  } else if (reviewType === 'script' && scriptContent) {
    contentToReview = typeof scriptContent === 'string' ? scriptContent : JSON.stringify(scriptContent, null, 2);
  }

  // 上下文引用
  const contextParts: string[] = [];
  if (reviewType !== 'skeleton' && skeleton) {
    contextParts.push(`【故事骨架参考】\n${skeleton.slice(0, 2000)}`);
  }
  if (reviewType === 'script' && adaptationStrategy) {
    contextParts.push(`【改编策略参考】\n${adaptationStrategy.slice(0, 1500)}`);
  }
  if (chapters && chapters.length > 0) {
    const chapterBriefs = chapters.slice(0, 20).map((ch: any, idx: number) => {
      const title = ch.title || `第${idx + 1}章`;
      const brief = (ch.content || ch.summary || '').slice(0, 100);
      return `${idx + 1}. ${title}：${brief}`;
    }).join('\n');
    contextParts.push(`【章节列表】\n${chapterBriefs}`);
  }

  return `请审核以下**${reviewType === 'skeleton' ? '故事骨架' : reviewType === 'strategy' ? '改编策略' : '剧本内容'}**的产出物。

【项目配置】
- 集数：${totalEpisodes}集
- 单集时长：${episodeDuration}分钟（约${episodeDuration * 150}字台词）
- 平台规格：${platform}
- 风格定位：${style || '未指定'}
- 付费策略：${paywall || '未指定'}

${contextParts.length > 0 ? contextParts.join('\n\n') + '\n\n' : ''}

【待审内容】
${contentToReview.slice(0, 20000)}

请按照审核维度逐项检查，输出完整的审核报告。重点关注：
1. 对照审核维度清单逐项核查
2. 检查短剧通用红线是否违反
3. 跨阶段一致性检查（与前置阶段产出的一致性）
4. 给出A/B/C/D评级和具体改进建议`;
}

function parseSupervisionReport(content: string, reviewType: ReviewType): SupervisionReport {
  const ratingMatch = content.match(/\*\*评分\*\*[:：]\s*([ABCD])/i) || content.match(/评分[:：]\s*([ABCD])/i);
  const rating: RatingLevel = (ratingMatch?.[1]?.toUpperCase() as RatingLevel) || 'C';

  const summaryMatch = content.match(/\*\*概要\*\*[:：]\s*(.+)/);
  const summary = summaryMatch?.[1]?.trim() || '审核完成';

  // 解析问题清单表格
  const issues: SupervisionIssue[] = [];
  const tableRows = content.split('\n').filter(line => /^\|\s*\d+\s*\|/.test(line));
  for (const row of tableRows) {
    const cells = row.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 5) {
      issues.push({
        severity: (cells[1]?.includes('严重') ? '🔴 严重' : cells[1]?.includes('中等') ? '🟡 中等' : '⚪ 轻微') as SupervisionIssue['severity'],
        item: cells[2] || '',
        problem: cells[3] || '',
        suggestion: cells[4] || '',
      });
    }
  }

  // 如果没有解析到表格，尝试用正则提取
  if (issues.length === 0) {
    const issuePattern = /([🔴🟡⚪])\s*(严重|中等|轻微)[：:]\s*(.+?)(?:\n|$)/g;
    let match;
    while ((match = issuePattern.exec(content)) !== null) {
      issues.push({
        severity: (match[1] === '🔴' ? '🔴 严重' : match[1] === '🟡' ? '🟡 中等' : '⚪ 轻微'),
        item: '综合项',
        problem: match[3]?.trim() || '',
        suggestion: '请查看详细审核报告',
      });
    }
  }

  // 解析决策建议
  const decisions: string[] = [];
  const decisionSection = content.match(/需要您决定[：:][\s\S]*?(?=\n##|\n#|$)/);
  if (decisionSection) {
    const decisionLines = decisionSection[0].split('\n').filter(l => /^\d+\.\s/.test(l));
    for (const line of decisionLines) {
      decisions.push(line.replace(/^\d+\.\s*/, '').trim());
    }
  }

  return {
    rating,
    summary,
    issues,
    decisions: decisions.length > 0 ? decisions : undefined,
    reviewType,
  };
}