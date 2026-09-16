import { NextRequest, NextResponse } from 'next/server';
import { getRawAIConfig, getModelName, getTemperature } from '@/lib/ai-config';
import { sanitizeChapterText } from '@/lib/chapter-text-cleaner';

const TIMEOUT_MS = 120000;
const MAX_RETRIES = 2;

async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number }): Promise<Response> {
  const { timeout = TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...fetchOptions, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

type ReviewDimension = {
  name: string;
  score: number;
  issues: { description: string; severity: 'critical' | 'high' | 'medium' | 'low' }[];
};

type ReviewPerspective = {
  name: string;
  summary: string;
  dimensions: ReviewDimension[];
  overallScore: number;
  keySuggestions: string[];
};

type ReviewResult = {
  overallScore: number;
  pass: boolean;
  perspectives: ReviewPerspective[];
  fiveDimensionScores: {
    consistency: number;      // 核心一致度
    originality: number;      // 表层重写度
    formatting: number;       // 格式一致度
    readability: number;      // 可读性
    logic: number;            // 逻辑连贯
  };
  summary: string;
  contractStatus: 'safe' | 'needs_boost' | 'broken';  // 读者契约状态
  revisionStrategy: 'rewrite' | 'compress' | 'de_ai' | 'polish' | 'pass';
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      content,
      configId,
      mode = 'standard',    // quick | standard | deep
      genre,
      title,
      idea,
      structure,
      chapterIndex,
    } = body;

    if (!content || typeof content !== 'string' || content.trim().length < 100) {
      return NextResponse.json({ error: '请提供至少100字的章节内容' }, { status: 400 });
    }

    const { apiUrl, apiKey } = await getRawAIConfig(configId);
    const modelName = await getModelName(configId);
    const temperature = await getTemperature(configId, 0.2);

    if (!apiKey) {
      return NextResponse.json({ error: 'API密钥未配置' }, { status: 503 });
    }

    const originalContent = sanitizeChapterText(content);
    console.log(`[Review] Start: content length: ${originalContent.length}, mode: ${mode}, genre: ${genre || '通用'}`);

    // 构建多视角审查系统提示词
    const systemPrompt = buildReviewSystemPrompt(mode, genre);

    // 构建用户提示词（含上下文信息）
    const userPrompt = buildReviewUserPrompt(originalContent, {
      title,
      idea,
      structure,
      chapterIndex,
      mode,
      genre,
    });

    // 带重试的API调用
    const apiUrlFull = apiUrl.endsWith('/chat/completions') ? apiUrl : `${apiUrl}/chat/completions`;
    let aiContent = '';
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      try {
        console.log(`[Review] Attempt ${attempt}/${MAX_RETRIES + 1}`);
        const response = await fetchWithTimeout(apiUrlFull, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: Math.min(temperature, 0.2),
            max_tokens: Math.min(8192, originalContent.length * 4 + 1000),
            stream: false,
          }),
          timeout: TIMEOUT_MS,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          console.error(`[Review] Attempt ${attempt} API error ${response.status}: ${errText.substring(0, 200)}`);
          lastError = new Error(`API错误 ${response.status}`);
          continue;
        }

        const data = await response.json() as any;
        aiContent = data?.choices?.[0]?.message?.content || '';
        console.log(`[Review] Attempt ${attempt} response length: ${aiContent.length}`);

        if (aiContent && aiContent.trim().length > 20) {
          break;
        }
        lastError = new Error('AI返回内容过短');
      } catch (error: any) {
        lastError = error;
        console.error(`[Review] Attempt ${attempt} failed:`, error?.message || error);
      }

      if (attempt <= MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }

    if (!aiContent || aiContent.trim().length < 20) {
      console.warn('[Review] All attempts failed');
      return NextResponse.json(buildFallbackResult(originalContent));
    }

    const result = parseReviewResponse(aiContent);
    console.log(`[Review] Complete: score: ${result.overallScore}, pass: ${result.pass}`);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Review] Failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '质量审查失败' },
      { status: 500 },
    );
  }
}

function buildReviewSystemPrompt(mode: string, genre?: string): string {
  const base = `你是一位资深网文编辑团队，由三位专业审稿人组成。你的任务是从多个视角审查小说章节的文学质量。

## 审稿人角色

### 审稿人A：资深网文编辑（结构/节奏/爽点视角）
- 检查章节结构（开头钩子→中段推进→结尾落点）
- 检查节奏（事件密度/状态变化/读者翻页动力）
- 检查爽点密度与类型
- 检查钩子质量与类型轮换
- 检查读者契约兑现（承诺的卖点是否兑现）

### 审稿人B：网文读者（代入感/情绪/契约视角）
- 检查是否能快速代入
- 检查情绪交付是否到位
- 检查期待是否被偿还/延期/吞掉
- 检查主角代理权（主角是否推动剧情还是被剧情推动）
- 检查终局储备（是否动用了不该动用的底牌）

### 审稿人C：文学编辑（技术/去AI味/格式视角）
- 检查AI味特征（7种模式检测）
- 检查对话质量（口语化/差异化/情绪递进）
- 检查人物命名（AI烂大街名字检测）
- 检查格式（段落/断句/标题）
- 检查可读性（啰嗦/空泛/套路修辞）

## 【五维评分标准】

### 维度1：核心一致度（0-100）
检查：关键冲突、关键行动、人物动机是否前后一致
- >90分：完美一致
- 70-90分：基本一致，小问题可接受
- <70分：存在严重矛盾

### 维度2：表层重写度（0-100）
检查：句式与措辞是否原创，AI腔程度
- >80分：真人写作风格
- 60-80分：轻度AI腔
- <60分：严重AI腔

### 维度3：格式一致度（0-100）
检查：段落断句、角色名节奏、格式统一性
- >80分：格式规范
- 60-80分：基本规范
- <60分：格式混乱

### 维度4：可读性（0-100）
检查：啰嗦、AI腔、空泛总结、套路修辞
- >80分：可读性强
- 60-80分：基本可读
- <60分：需要大幅修改

### 维度5：逻辑连贯（0-100）
检查：句间/段间通顺，设定冲突
- >80分：逻辑通顺
- 60-80分：基本通顺
- <60分：存在逻辑断裂

## 【通用检查清单】
- [ ] 开头有钩子（不是天气/风景/日常开场）
- [ ] 中段有推进（有可见事件或状态变化）
- [ ] 局势有变化（读完这章世界跟之前不一样）
- [ ] 结尾落在变化上（不是总结）
- [ ] 没有大段设定说明文
- [ ] 信息跟着冲突走
- [ ] 对话符合人物身份
- [ ] 情绪通过动作落地
- [ ] 没有空洞抒情段落
- [ ] 没有可删除的水字数段落

## 【钩子质量检查】
- 章尾钩子是否有效（13式中至少一种）
- 钩子类型是否轮换（不要重复同一类型）
- 钩子是否能拉住读者翻下一页
- 章首钩子是否3秒抓人

## 【读者契约审查】
- 契约安全：本章兑现开篇承诺了吗？
- 需补强：核心卖点被延期或弱化了吗？
- 契约破坏：核心卖点被交给配角或偶然性了吗？

## 【精修策略映射】
根据问题选择策略：
- rewrite：核心一致度低→围绕核心冲突重写
- compress：字数超标/无意义卡点→删减不推动剧情的内容
- de_ai：AI腔重→替换禁用词、改写句式
- polish：小问题多→打磨语言细节
- pass：无需修改

## 【输出格式 - 严格JSON】
返回一个JSON对象，包含三位审稿人的独立评审结果：
{
  "overallScore": 0-100,
  "pass": boolean,
  "perspectives": [
    {
      "name": "资深网文编辑",
      "summary": "审稿总结",
      "overallScore": 0-100,
      "dimensions": [
        { "name": "章节结构", "score": 0-100, "issues": [{ "description": "问题", "severity": "high" }] },
        { "name": "节奏与爽点", "score": 0-100, "issues": [] },
        { "name": "钩子质量", "score": 0-100, "issues": [] },
        { "name": "读者契约", "score": 0-100, "issues": [] }
      ],
      "keySuggestions": ["建议1", "建议2"]
    },
    {
      "name": "网文读者",
      "summary": "读者视角总结",
      "overallScore": 0-100,
      "dimensions": [
        { "name": "代入感", "score": 0-100, "issues": [] },
        { "name": "情绪交付", "score": 0-100, "issues": [] },
        { "name": "期待兑现", "score": 0-100, "issues": [] },
        { "name": "主角代理权", "score": 0-100, "issues": [] }
      ],
      "keySuggestions": []
    },
    {
      "name": "文学编辑",
      "summary": "技术视角总结",
      "overallScore": 0-100,
      "dimensions": [
        { "name": "去AI味", "score": 0-100, "issues": [] },
        { "name": "对话质量", "score": 0-100, "issues": [] },
        { "name": "人物命名", "score": 0-100, "issues": [] },
        { "name": "可读性", "score": 0-100, "issues": [] }
      ],
      "keySuggestions": []
    }
  ],
  "fiveDimensionScores": {
    "consistency": 0-100,
    "originality": 0-100,
    "formatting": 0-100,
    "readability": 0-100,
    "logic": 0-100
  },
  "summary": "整体总结",
  "contractStatus": "safe" | "needs_boost" | "broken",
  "revisionStrategy": "rewrite" | "compress" | "de_ai" | "polish" | "pass"
}

规则：
- 三位审稿人必须独立评审，观点可以不同
- 每个维度必须给出具体分数和问题
- pass = overallScore >= 75 且 contractStatus != "broken"
- 直接输出JSON，禁止额外文字`;

  const modeNote: Record<string, string> = {
    quick: '\n\n## 快速模式说明\n只检查核心问题，减少详细分析。跳过"读者契约审查"和"精修策略映射"的详细分析。',
    standard: '\n\n## 标准模式说明\n完整执行所有检查维度。',
    deep: '\n\n## 深度模式说明\n额外增加：逐段审查、伏笔账本检查、终局储备检查、读者契约深度审查。',
  };

  const genreAddition = genre ? `\n\n## 【题材专项 - ${genre}】\n请根据"${genre}"题材特点调整审查标准：\n${getGenreSpecificChecks(genre)}` : '';

  return base + (modeNote[mode] || modeNote.standard) + genreAddition;
}

function getGenreSpecificChecks(genre: string): string {
  const checks: Record<string, string> = {
    '言情': '- 检查糖点/虐点密度与分布\n- 检查感情递进自然度\n- 检查双向奔赴还是单方追求\n- 检查心动细节是否到位',
    '虐恋': '- 检查枷锁设定一致性\n- 检查甜衬虐的反差效果\n- 检查心理挣扎的真实感\n- 检查和解/救赎的合理性',
    '玄幻': '- 检查境界/战力体系自洽\n- 检查升级节奏与代价\n- 检查爽点密度（每3000字至少1个）\n- 检查越级挑战的合理性',
    '悬疑': '- 检查伏笔可回收性\n- 检查线索可验证性\n- 检查误导的真实性\n- 检查真相闭环',
    '末世': '- 检查生存压力的真实感\n- 检查人性在极端环境下的表现\n- 检查资源管理的合理性\n- 检查希望与绝望的平衡',
    '都市': '- 检查贴近现实程度\n- 检查社会规则的真实性\n- 检查金手指的合理性\n- 检查角色行为的社会逻辑性',
    '武侠': '- 检查江湖规矩的一致性\n- 检查武功体系的自洽性\n- 检查侠义精神的体现\n- 检查恩怨情仇的合理性',
    '仙侠': '- 检查境界体系的自洽\n- 检查天道规则的一致性\n- 检查道心的重要性体现\n- 检查逆天改命的合理性',
  };
  return checks[genre] || '- 根据题材特点调整审查维度';
}

function buildReviewUserPrompt(content: string, context: {
  title?: string; idea?: any; structure?: any; chapterIndex?: number; mode: string; genre?: string;
}): string {
  const { title, idea, structure, chapterIndex, mode, genre } = context;

  return `【待审查章节】
${title ? `标题：${title}\n` : ''}${chapterIndex ? `章节：第${chapterIndex}章\n` : ''}${genre ? `题材：${genre}\n` : ''}
${idea?.theme ? `主题：${idea.theme}\n` : ''}${idea?.concept ? `创意：${idea.concept}\n` : ''}${structure?.mainPlot ? `主线：${structure.mainPlot}\n` : ''}${structure?.keyConflicts ? `关键冲突：${structure.keyConflicts}\n` : ''}

【章节正文 - 待审查】
${content}

【审查模式：${mode}】
${mode === 'quick' ? '快速审查：仅检查核心问题（结构/节奏/AI味/契约）' : mode === 'deep' ? '深度审查：逐段检查+伏笔+契约+终局储备' : '标准审查：完整五维度+三视角'}

请三位审稿人独立评审以上章节，输出结构化JSON结果。`;
}

function parseReviewResponse(content: string): ReviewResult {
  const fallback: ReviewResult = {
    overallScore: 70,
    pass: true,
    perspectives: [
      { name: '资深网文编辑', summary: '默认评审', overallScore: 70, dimensions: [], keySuggestions: [] },
      { name: '网文读者', summary: '默认评审', overallScore: 70, dimensions: [], keySuggestions: [] },
      { name: '文学编辑', summary: '默认评审', overallScore: 70, dimensions: [], keySuggestions: [] },
    ],
    fiveDimensionScores: { consistency: 70, originality: 70, formatting: 70, readability: 70, logic: 70 },
    summary: 'AI评审服务繁忙，已返回默认评分',
    contractStatus: 'needs_boost',
    revisionStrategy: 'polish',
  };

  try {
    let jsonText = String(content || '');

    jsonText = jsonText.replace(/<think[\s\S]*?<\/think\s*>/g, '');
    jsonText = jsonText.replace(/<thought[\s\S]*?<\/thought\s*>/g, '');
    const codeBlock = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock) jsonText = codeBlock[1].trim();

    let parsed: any = null;
    const parseAttempts = [
      () => JSON.parse(jsonText),
      () => {
        const match = jsonText.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1')) : null;
      },
    ];

    for (const attempt of parseAttempts) {
      try {
        parsed = attempt();
        if (parsed && typeof parsed === 'object') break;
      } catch (e) { continue; }
    }

    if (!parsed || typeof parsed !== 'object') {
      console.warn('[Review] Could not parse JSON');
      return fallback;
    }

    const fiveDim = parsed.fiveDimensionScores || {};
    const scores = {
      consistency: clampScore(fiveDim.consistency),
      originality: clampScore(fiveDim.originality),
      formatting: clampScore(fiveDim.formatting),
      readability: clampScore(fiveDim.readability),
      logic: clampScore(fiveDim.logic),
    };

    // 计算总分：五维平均
    const allScores = Object.values(scores);
    const overallScore = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length);

    const contractStatus = ['safe', 'needs_boost', 'broken'].includes(parsed.contractStatus)
      ? parsed.contractStatus as 'safe' | 'needs_boost' | 'broken'
      : 'needs_boost';

    const pass = overallScore >= 75 && contractStatus !== 'broken';

    return {
      overallScore,
      pass,
      perspectives: Array.isArray(parsed.perspectives) ? parsed.perspectives.map(normalizePerspective).slice(0, 3) : fallback.perspectives,
      fiveDimensionScores: scores,
      summary: String(parsed.summary || '质量审查完成'),
      contractStatus,
      revisionStrategy: determineRevisionStrategy(scores, contractStatus),
    };
  } catch (error) {
    console.warn('[Review] Parse error:', error);
    return fallback;
  }
}

function normalizePerspective(p: any): ReviewPerspective {
  return {
    name: String(p?.name || '审稿人'),
    summary: String(p?.summary || ''),
    overallScore: clampScore(p?.overallScore),
    dimensions: Array.isArray(p?.dimensions) ? p.dimensions.map((d: any) => ({
      name: String(d?.name || '未知维度'),
      score: clampScore(d?.score),
      issues: Array.isArray(d?.issues) ? d.issues.map((i: any) => ({
        description: String(i?.description || ''),
        severity: (['critical', 'high', 'medium', 'low'] as const).includes(i?.severity) ? i.severity : 'medium',
      })) : [],
    })) : [],
    keySuggestions: Array.isArray(p?.keySuggestions) ? p.keySuggestions.map(String).filter(Boolean).slice(0, 5) : [],
  };
}

function clampScore(val: unknown): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return 70;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function determineRevisionStrategy(scores: Record<string, number>, contractStatus: string): ReviewResult['revisionStrategy'] {
  if (contractStatus === 'broken') return 'rewrite';
  if (scores.originality < 60) return 'de_ai';
  if (scores.consistency < 60) return 'rewrite';
  if (scores.readability < 60) return 'polish';
  return 'pass';
}

function buildFallbackResult(content: string): ReviewResult {
  return {
    overallScore: 65,
    pass: false,
    perspectives: [
      { name: '资深网文编辑', summary: '评审服务繁忙，暂未完成评审', overallScore: 65, dimensions: [], keySuggestions: ['稍后重试或调整内容后再试'] },
      { name: '网文读者', summary: '默认评审', overallScore: 65, dimensions: [], keySuggestions: [] },
      { name: '文学编辑', summary: '默认评审', overallScore: 65, dimensions: [], keySuggestions: [] },
    ],
    fiveDimensionScores: { consistency: 70, originality: 60, formatting: 70, readability: 65, logic: 65 },
    summary: '质量审查服务繁忙，请稍后重试',
    contractStatus: 'needs_boost',
    revisionStrategy: 'polish',
  };
}
