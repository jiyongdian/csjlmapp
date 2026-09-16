import { NextRequest, NextResponse } from 'next/server';
import { getRawAIConfig, getModelName, getTemperature } from '@/lib/ai-config';

const TIMEOUT_MS = 180000;
const MAX_RETRIES = 2;

async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number }): Promise<Response> {
  const { timeout = TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...fetchOptions, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

type DeconstructResult = {
  type: 'short' | 'long';
  wordCount: number;
  genreDetected: string;
  title: string;
  // Stage 2: 结构+情节节点
  storyCore: string;
  structureSegments: { phase: string; summary: string; wordCount: number }[];
  plotNodes: { index: number; type: string; description: string; position: string }[];
  // Stage 3: 情感线+爆点
  emotionCurve: { point: string; description: string; intensity: number }[];
  climaxAnalysis: {
    type: string;
    setup: string;
    payoff: string;
    dimensions: string[];
  };
  // Stage 4: 反转+写作手法
  reversalAnalysis: {
    type: string;
    setupClues: string[];
    mechanism: string;
  };
  writingTechniques: { category: string; technique: string; example: string }[];
  // Stage 5: 人物+首尾
  characterAnalysis: { name: string; role: string; archetype: string; function: string }[];
  openingAnalysis: { hook: string; effectiveness: string; suggestion: string };
  endingAnalysis: { type: string; effectiveness: string; suggestion: string };
  // Stage 6: 综合评估
  overallScores: {
    storyCore: number;
    structure: number;
    emotion: number;
    reversal: number;
    character: number;
  };
  topicScore: number;
  resonanceLevels: string[];
  reusableStructures: string[];
  rhythmReport: string;
  summary: string;
};

const GENRE_KEYWORDS: Record<string, string[]> = {
  '追妻': ['追妻', '火葬场', '渣男后悔', '前任'],
  '虐恋': ['虐恋', '虐文', '虐心', '心碎'],
  '重生复仇': ['重生', '穿越', '复仇', '前世'],
  '死人文学': ['死后', '灵魂', '旁观', '鬼'],
  '小三': ['小三', '出轨', '知三当三', '白月光'],
  '世情': ['世情', '现实', '婆媳', '打脸', '虐渣'],
  '豪门': ['总裁', '豪门', '联姻', '富二代'],
  '宫斗宅斗': ['宫斗', '宅斗', '嫡庶', '后宫'],
  '民俗': ['冥婚', '纸人', '风水', '怪谈', '民俗'],
  '悬疑': ['悬疑', '推理', '凶手', '惊悚', '破案'],
  '甜宠': ['甜宠', '先虐后甜', '先婚后爱', '暗恋', '撒糖'],
  '双男主': ['双男主', '宿敌', 'BL', '兄弟'],
  '沙雕': ['沙雕', '脑洞', '弹幕', '系统', '反套路'],
  '仙侠': ['仙侠', '修仙', '门派', '境界'],
  '都市': ['都市', '现代', '职场', '创业'],
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      content,
      configId,
      type, // short | long | auto
      title,
      explicitGenre,
    } = body;

    if (!content || typeof content !== 'string' || content.trim().length < 500) {
      return NextResponse.json({ error: '请提供至少500字的小说内容用于拆文' }, { status: 400 });
    }

    const wordCount = content.trim().length;
    const detectedType = type === 'short' || type === 'long'
      ? type
      : wordCount < 15000 ? 'short' : wordCount > 20000 ? 'long' : 'short';

    if (type === 'auto' && wordCount >= 15000 && wordCount <= 20000) {
      // 灰区，默认按短篇拆
      console.log(`[Deconstruct] 字数${wordCount}处于灰区，默认按短篇拆文`);
    }

    // 题材识别
    const genreDetected = explicitGenre || detectGenre(content);
    console.log(`[Deconstruct] Start: type=${detectedType}, words=${wordCount}, genre=${genreDetected}`);

    const { apiUrl, apiKey } = await getRawAIConfig(configId);
    const modelName = await getModelName(configId);
    const temperature = await getTemperature(configId, 0.3);

    if (!apiKey) {
      return NextResponse.json({ error: 'API密钥未配置' }, { status: 503 });
    }

    const systemPrompt = buildDeconstructSystemPrompt(detectedType, genreDetected);
    const userPrompt = buildDeconstructUserPrompt(content, {
      title: title || '未命名',
      wordCount,
      type: detectedType,
      genre: genreDetected,
    });

    const apiUrlFull = apiUrl.endsWith('/chat/completions') ? apiUrl : `${apiUrl}/chat/completions`;
    let aiContent = '';
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      try {
        console.log(`[Deconstruct] Attempt ${attempt}/${MAX_RETRIES + 1}`);
        const response = await fetchWithTimeout(apiUrlFull, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: Math.min(temperature, 0.3),
            max_tokens: Math.min(16384, Math.floor(wordCount * 3 + 2000)),
            stream: false,
          }),
          timeout: TIMEOUT_MS,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          console.error(`[Deconstruct] Attempt ${attempt} API error ${response.status}: ${errText.substring(0, 200)}`);
          lastError = new Error(`API错误 ${response.status}`);
          continue;
        }

        const data = await response.json() as any;
        aiContent = data?.choices?.[0]?.message?.content || '';
        console.log(`[Deconstruct] Attempt ${attempt} response length: ${aiContent.length}`);

        if (aiContent && aiContent.trim().length > 100) {
          break;
        }
        lastError = new Error('AI返回内容过短');
      } catch (error: any) {
        lastError = error;
        console.error(`[Deconstruct] Attempt ${attempt} failed:`, error?.message || error);
      }

      if (attempt <= MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }

    if (!aiContent || aiContent.trim().length < 100) {
      console.warn('[Deconstruct] All attempts failed');
      return NextResponse.json({ error: lastError?.message || '拆文分析失败，请重试' }, { status: 500 });
    }

    const result = parseDeconstructResponse(aiContent, {
      type: detectedType,
      wordCount,
      genreDetected,
      title: title || '未命名',
    });

    console.log(`[Deconstruct] Complete: genre=${result.genreDetected}, core=${result.storyCore?.substring(0, 50)}...`);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Deconstruct] Failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '拆文分析失败' },
      { status: 500 },
    );
  }
}

function detectGenre(content: string): string {
  const text = content.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      const regex = new RegExp(kw, 'gi');
      const matches = text.match(regex);
      if (matches) score += matches.length;
    }
    scores[genre] = score;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted[0] && sorted[0][1] > 0) {
    return sorted[0][0];
  }
  return '通用';
}

function buildDeconstructSystemPrompt(type: string, genre: string): string {
  const base = `你是一位顶级网文结构分析师。你的任务是深度拆解一篇网文小说，产出完整的结构化分析报告。

## 拆文流程（5阶段管道）

### Stage 2：结构+情节节点
- 提取故事核（一句话说清这篇讲什么）
- 划分结构分段（4-6段：开端/发展/高潮/结局）
- 提取情节节点清单（按字数分档）

### Stage 3：情感线+爆点
- 绘制情感曲线（≥5个情感转折点）
- 分析爆点（6维度：类型/位置/强度/铺垫/交付/余波）
- 分析读者期待感管理

### Stage 4：反转+写作手法
- 反转前置检查（是否有反转/反转类型）
- 分析反转机制（铺垫≥2条）
- 识别写作手法（≥5项维度：POV/对话/时间/信息/其他）

### Stage 5：人物+开头结尾
- 所有人物分类+功能标签+功能评估
- 开头分析（前50/100字钩子效果）
- 结尾分析（收束检查）

### Stage 6：综合评估
- 五维评分（故事核/结构/情感/反转/人物）
- 爆点性评估
- 话题性评估
- 共鸣层次分析（≥3层）
- 可复用结构（≥3条）
- 节奏速报

## 题材专项标尺：${genre}

${getGenreDeconstructChecks(genre)}

## 输出格式 - 严格JSON
返回一个JSON对象，包含完整的拆文分析：
{
  "storyCore": "故事核（一句话）",
  "structureSegments": [
    { "phase": "开端", "summary": "本段摘要", "wordCount": 500 }
  ],
  "plotNodes": [
    { "index": 1, "type": "触发事件", "description": "节点描述", "position": "位置" }
  ],
  "emotionCurve": [
    { "point": "开篇", "description": "情感描述", "intensity": 5 }
  ],
  "climaxAnalysis": {
    "type": "爆点类型",
    "setup": "铺垫方式",
    "payoff": "交付方式",
    "dimensions": ["维度1", "维度2"]
  },
  "reversalAnalysis": {
    "type": "反转类型",
    "setupClues": ["线索1", "线索2"],
    "mechanism": "反转机制"
  },
  "writingTechniques": [
    { "category": "POV", "technique": "手法名称", "example": "原文示例" }
  ],
  "characterAnalysis": [
    { "name": "角色名", "role": "主角/配角/反派", "archetype": "原型", "function": "功能" }
  ],
  "openingAnalysis": {
    "hook": "钩子分析",
    "effectiveness": "有效性评估",
    "suggestion": "改进建议"
  },
  "endingAnalysis": {
    "type": "结尾类型",
    "effectiveness": "有效性评估",
    "suggestion": "改进建议"
  },
  "overallScores": {
    "storyCore": 85,
    "structure": 80,
    "emotion": 90,
    "reversal": 75,
    "character": 70
  },
  "topicScore": 80,
  "resonanceLevels": ["共鸣层1", "共鸣层2", "共鸣层3"],
  "reusableStructures": ["可复用结构1", "可复用结构2", "可复用结构3"],
  "rhythmReport": "节奏速报",
  "summary": "综合总结"
}

规则：
- 每个维度必须有具体数据和原文支撑
- 情节节点密度：每1000字至少2个节点
- 情感曲线至少5个转折点
- 写作手法至少5项
- 可复用结构至少3条
- 直接输出JSON，禁止额外文字`;

  return base;
}

function getGenreDeconstructChecks(genre: string): string {
  const checks: Record<string, string> = {
    '追妻': '- 检查阶梯式背叛是否到位（道德→经济→生命）\n- 检查火葬场预告钩子\n- 检查心死切换的时机和力度\n- 检查白月光触发链',
    '虐恋': '- 检查枷锁设定一致性\n- 检查甜衬虐的反差效果\n- 检查心理挣扎的真实感\n- 检查和解/救赎的合理性',
    '重生复仇': '- 检查重生前后的信息差设计\n- 检查复仇节奏与代价\n- 检查伏笔回收\n- 检查前世记忆的利用',
    '悬疑': '- 检查伏笔可回收性\n- 检查线索可验证性\n- 检查误导的真实性\n- 检查真相闭环',
    '世情': '- 检查现实感与共鸣点\n- 检查婆媳/婚姻/职场的真实细节\n- 检查打脸节奏\n- 检查弱者逆袭的合理性',
    '豪门': '- 检查身份反差设计\n- 检查误会制造与解除\n- 检查霸道总裁/灰姑娘设定\n- 检查家族恩怨线',
    '甜宠': '- 检查糖点密度与分布\n- 检查双向奔赴还是单方追求\n- 检查心动细节\n- 检查误会制造的合理性',
    '都市': '- 检查贴近现实程度\n- 检查社会规则真实性\n- 检查金手指合理性\n- 检查角色行为的社会逻辑性',
    '仙侠': '- 检查境界体系自洽\n- 检查天道规则一致性\n- 检查道心重要性\n- 检查逆天改命合理性',
    '沙雕': '- 检查脑洞创意\n- 检查反套路设计\n- 检查笑点密度\n- 检查系统/弹幕/金手指设定',
  };
  return checks[genre] || '- 根据题材特点调整拆解维度';
}

function buildDeconstructUserPrompt(content: string, context: {
  title: string; wordCount: number; type: string; genre: string;
}): string {
  const { title, wordCount, type, genre } = context;

  // 截取部分文本以控制 token 长度
  const maxContentLen = 6000;
  const displayContent = content.length > maxContentLen
    ? content.substring(0, 3000) + '\n...[中间省略]...\n' + content.substring(content.length - 3000)
    : content;

  return `【拆文任务】
书名：${title}
字数：${wordCount}
拆文类型：${type === 'short' ? '短篇拆文' : '长篇拆文'}
题材：${genre}

【原文 - 待拆解】
${displayContent}

请按照5阶段管道完整拆解这篇小说，输出结构化JSON结果。`;
}

function parseDeconstructResponse(content: string, meta: {
  type: string; wordCount: number; genreDetected: string; title: string;
}): DeconstructResult {
  const fallback: DeconstructResult = {
    type: meta.type as 'short' | 'long',
    wordCount: meta.wordCount,
    genreDetected: meta.genreDetected,
    title: meta.title,
    storyCore: 'AI拆解服务繁忙，请重试',
    structureSegments: [],
    plotNodes: [],
    emotionCurve: [],
    climaxAnalysis: { type: '', setup: '', payoff: '', dimensions: [] },
    reversalAnalysis: { type: '无反转', setupClues: [], mechanism: '' },
    writingTechniques: [],
    characterAnalysis: [],
    openingAnalysis: { hook: '', effectiveness: '', suggestion: '' },
    endingAnalysis: { type: '', effectiveness: '', suggestion: '' },
    overallScores: { storyCore: 70, structure: 70, emotion: 70, reversal: 70, character: 70 },
    topicScore: 60,
    resonanceLevels: [],
    reusableStructures: [],
    rhythmReport: '',
    summary: '拆文服务繁忙，请稍后重试',
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
      console.warn('[Deconstruct] Could not parse JSON');
      return fallback;
    }

    const scores = parsed.overallScores || {};
    const s = {
      storyCore: clampScore(scores.storyCore),
      structure: clampScore(scores.structure),
      emotion: clampScore(scores.emotion),
      reversal: clampScore(scores.reversal),
      character: clampScore(scores.character),
    };

    return {
      type: meta.type as 'short' | 'long',
      wordCount: meta.wordCount,
      genreDetected: meta.genreDetected,
      title: meta.title,
      storyCore: String(parsed.storyCore || ''),
      structureSegments: Array.isArray(parsed.structureSegments) ? parsed.structureSegments.map((seg: any) => ({
        phase: String(seg?.phase || ''),
        summary: String(seg?.summary || ''),
        wordCount: Number(seg?.wordCount) || 0,
      })) : [],
      plotNodes: Array.isArray(parsed.plotNodes) ? parsed.plotNodes.map((node: any, i: number) => ({
        index: Number(node?.index) || (i + 1),
        type: String(node?.type || ''),
        description: String(node?.description || ''),
        position: String(node?.position || ''),
      })) : [],
      emotionCurve: Array.isArray(parsed.emotionCurve) ? parsed.emotionCurve.map((p: any) => ({
        point: String(p?.point || ''),
        description: String(p?.description || ''),
        intensity: clampScore(p?.intensity),
      })) : [],
      climaxAnalysis: {
        type: String(parsed.climaxAnalysis?.type || ''),
        setup: String(parsed.climaxAnalysis?.setup || ''),
        payoff: String(parsed.climaxAnalysis?.payoff || ''),
        dimensions: Array.isArray(parsed.climaxAnalysis?.dimensions) ? parsed.climaxAnalysis.dimensions.map(String) : [],
      },
      reversalAnalysis: {
        type: String(parsed.reversalAnalysis?.type || '无反转'),
        setupClues: Array.isArray(parsed.reversalAnalysis?.setupClues) ? parsed.reversalAnalysis.setupClues.map(String) : [],
        mechanism: String(parsed.reversalAnalysis?.mechanism || ''),
      },
      writingTechniques: Array.isArray(parsed.writingTechniques) ? parsed.writingTechniques.map((t: any) => ({
        category: String(t?.category || ''),
        technique: String(t?.technique || ''),
        example: String(t?.example || ''),
      })) : [],
      characterAnalysis: Array.isArray(parsed.characterAnalysis) ? parsed.characterAnalysis.map((c: any) => ({
        name: String(c?.name || ''),
        role: String(c?.role || ''),
        archetype: String(c?.archetype || ''),
        function: String(c?.function || ''),
      })) : [],
      openingAnalysis: {
        hook: String(parsed.openingAnalysis?.hook || ''),
        effectiveness: String(parsed.openingAnalysis?.effectiveness || ''),
        suggestion: String(parsed.openingAnalysis?.suggestion || ''),
      },
      endingAnalysis: {
        type: String(parsed.endingAnalysis?.type || ''),
        effectiveness: String(parsed.endingAnalysis?.effectiveness || ''),
        suggestion: String(parsed.endingAnalysis?.suggestion || ''),
      },
      overallScores: s,
      topicScore: clampScore(parsed.topicScore),
      resonanceLevels: Array.isArray(parsed.resonanceLevels) ? parsed.resonanceLevels.map(String) : [],
      reusableStructures: Array.isArray(parsed.reusableStructures) ? parsed.reusableStructures.map(String) : [],
      rhythmReport: String(parsed.rhythmReport || ''),
      summary: String(parsed.summary || ''),
    };
  } catch (error) {
    console.warn('[Deconstruct] Parse error:', error);
    return fallback;
  }
}

function clampScore(val: unknown): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return 70;
  return Math.max(0, Math.min(100, Math.round(n)));
}