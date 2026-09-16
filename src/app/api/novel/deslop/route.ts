import { NextRequest, NextResponse } from 'next/server';
import { getRawAIConfig, getModelName, getTemperature } from '@/lib/ai-config';
import { sanitizeChapterText } from '@/lib/chapter-text-cleaner';

const TIMEOUT_MS = 120000;
const MAX_RETRIES = 2;

/** 去AI味的统一调用返回值（前后端通用） */
export type DeslopResult = {
  status: 'pass' | 'fixed';
  /** 0-100 分（AI味程度：0=完全AI味，100=完全真人味）注意：和localReport.finalScore方向相反！ */
  score: number;
  issues: { pattern: string; count: number; severity: 'high' | 'medium' | 'low'; example: string }[];
  summary: string;
  revisedContent: string;
  /** 兼容旧版前端：UI里 ChapterDeslopPanel 字段名 rewrittenContent */
  rewrittenContent?: string;
  diffStats: { originalLength: number; revisedLength: number; changes: number };
};

/** 可复用 runDeslopPipeline 的参数；被 chapters/stream 生成链路的 auto-deslop 直接调用 */
export type DeslopOpts = {
  configId?: string;
  /** standard = 平衡；aggressive = 主动润色；conservative = 只改硬伤 */
  mode?: 'standard' | 'aggressive' | 'conservative';
  /** 题材名（言情/玄幻/悬疑/都市…）会影响去AI味策略 */
  genre?: string;
};

async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number }): Promise<Response> {
  const { timeout = TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...fetchOptions, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

/** 构建去AI味 system prompt（单独 export，便于其它链路复用/注入写作 prompt 作为规则） */
export function buildDeslopSystemPrompt(mode: string = 'standard', genre?: string): string {
  const base = `你是一位资深网文编辑，专门负责"去AI味"后处理。你的任务是将AI生成的小说文本，改写成真人作家的写作风格。

## 核心原则
1. **保持内容不变**：只改变表达方式，不修改剧情、人物、逻辑
2. **去除AI特征**：识别并清除所有AI写作的典型模式
3. **增加人味**：让文字有温度、有呼吸感、有烟火气
4. **严格按三遍法执行**：Pass1去泛化→Pass2去书面化→Pass3回自然感

## 【10种AI写作模式检测与清理】
1. **高频词堆砌**："不禁"/"忍不住"/"不由自主"等AI高频词，出现即替换为具体动作
2. **弱化副词泛滥**："微微"/"淡淡"/"缓缓"/"轻轻"每千字超过3个就删/换
3. **意义膨胀**：用"伟大的"/"重要的"/"关键的"等抽象形容词 → 换具体白描
4. **万能结论**："一切都是最好的安排"/"这就是命运"/"命运的齿轮开始转动"等空洞总结 → 删
5. **论文体句式**："值得注意的是"/"由此可见"/"综上所述" → 删
6. **书面语连词**："然而"/"因此"/"此外"/"与此同时"的过度使用 → 口语断句
7. **三连排比**：连续3个结构相同的排比句 → 打破平衡
8. **解释腔**：作者替读者解释人物心理（"他心中暗想"/"她不禁想到"）→ 用动作/微表情替
9. **过度压缩**：把本该展开的情绪压缩成一句话（"他很伤心。"→展开身体反应）
10. **二修伪自然**：表面修改但仍保留AI结构（"瞳孔微缩"→"手一抖，茶盏差点掉了"）`;

  const modeSettings: Record<string, { extra: string }> = {
    aggressive: {
      extra: `

## 【激进模式 - 强化处理】
- 即使AI味较轻，也主动进行润色
- 增加口语化程度，多用短句
- 增加生活化细节描写
- 调整段落结构，打破AI式工整
- 允许适度增删语句以改善自然度`,
    },
    conservative: {
      extra: `

## 【保守模式 - 最小改动】
- 只修改明显的AI特征（禁用词/句式）
- 保留原文风格和节奏
- 不主动增加新内容
- 改动控制在最少范围`,
    },
    standard: {
      extra: `

## 【标准模式 - 推荐】
- 平衡去AI效果和内容保留
- 修正典型AI模式，同时保留原文特色
- 适度增加自然感调整`,
    },
  };

  const setting = modeSettings[mode] || modeSettings.standard;

  const genreAddition = genre ? `

## 【题材特殊处理 - ${genre}】
根据"${genre}"题材特点调整：
- 言情文：增加细腻情绪描写和口语化对话
- 玄幻文：保留专业术语但去除AI式总结
- 悬疑文：保持紧张氛围，去除过度解释
- 都市文：增加生活化细节和口语感
- 历史文：保持时代感，去除现代书面语
- 科幻文：保留技术概念，去除AI式术语堆砌` : '';

  return base + setting.extra + genreAddition;
}

/** 解析 LLM 返回的 JSON 为 DeslopResult（单独 export，便于单测和链路复用） */
export function parseDeslopResponse(content: string, originalContent: string): DeslopResult {
  const fallback: DeslopResult = {
    status: 'pass',
    score: 70,
    issues: [],
    summary: '内容自然，无需修改',
    revisedContent: originalContent,
    rewrittenContent: originalContent,
    diffStats: { originalLength: originalContent.length, revisedLength: originalContent.length, changes: 0 },
  };

  try {
    let jsonText = String(content || '');

    // 清理思考标签和代码块
    jsonText = jsonText.replace(/<think[\s\S]*?<\/think\s*>/g, '');
    jsonText = jsonText.replace(/<thought[\s\S]*?<\/thought\s*>/g, '');
    const codeBlock = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock) jsonText = codeBlock[1].trim();

    // 尝试多种方式解析JSON
    let parsed: any = null;
    const parseAttempts = [
      () => JSON.parse(jsonText),
      () => {
        const match = jsonText.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1')) : null;
      },
      () => {
        const cleaned = jsonText.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/,\s*([}\]])/g, '$1');
        const match = cleaned.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : null;
      },
    ];

    for (const attempt of parseAttempts) {
      try {
        parsed = attempt();
        if (parsed && typeof parsed === 'object') break;
      } catch (e) {
        continue;
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      console.warn('[Deslop] Could not parse JSON from response');
      return fallback;
    }

    const status: 'pass' | 'fixed' = String(parsed.status || '').toLowerCase() === 'fixed' ? 'fixed' : 'pass';
    let revisedContent = sanitizeChapterText(String(parsed.revisedContent || originalContent));

    // 如果fixed但内容太短，回退
    if (status === 'fixed' && revisedContent.length < originalContent.length * 0.3) {
      console.warn('[Deslop] Revised content too short, keeping original');
      revisedContent = originalContent;
    }

    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map((item: any) => ({
          pattern: String(item?.pattern || '未命名模式'),
          count: Number(item?.count) || 1,
          severity: (['high', 'medium', 'low'] as const).includes(item?.severity) ? item.severity : 'medium',
          example: String(item?.example || ''),
        })).filter((i: { pattern: string }) => i.pattern).slice(0, 15)
      : [];

    const score = Number.isFinite(Number(parsed.score))
      ? Math.max(0, Math.min(100, Number(parsed.score)))
      : (status === 'fixed' ? 60 : 85);

    // 计算修改统计
    const changes = Array.isArray(parsed.changes) ? parsed.changes.length : issues.length;

    return {
      status: revisedContent === originalContent ? 'pass' : status,
      score,
      issues,
      summary: String(parsed.summary || (status === 'fixed' ? '已完成去AI味处理' : '内容自然，无需修改')),
      revisedContent: revisedContent || originalContent,
      rewrittenContent: revisedContent || originalContent,
      diffStats: {
        originalLength: originalContent.length,
        revisedLength: (revisedContent || originalContent).length,
        changes: Math.max(0, changes),
      },
    };
  } catch (error) {
    console.warn('[Deslop] Parse error:', error);
    return fallback;
  }
}

/**
 * 可复用的「去AI味全流程」函数。被 POST handler 及 chapters/stream 生成链路（auto-deslop）共用。
 * - 自动 retry（MAX_RETRIES + 1 次）
 * - 失败兜底：返回 status=pass + revisedContent=原文
 */
export async function runDeslopPipeline(
  content: string,
  opts: DeslopOpts = {},
): Promise<DeslopResult> {
  const { configId, mode = 'standard', genre } = opts;

  if (!content || typeof content !== 'string' || content.trim().length < 50) {
    return {
      status: 'pass',
      score: 100,
      issues: [],
      summary: '内容过短，跳过去AI味',
      revisedContent: content,
      rewrittenContent: content,
      diffStats: { originalLength: (content || '').length, revisedLength: (content || '').length, changes: 0 },
    };
  }

  const { apiUrl, apiKey } = await getRawAIConfig(configId);
  const modelName = await getModelName(configId);
  const temperature = await getTemperature(configId, 0.3);

  const originalContent = sanitizeChapterText(content);
  console.log(`[Deslop.run] len=${originalContent.length} mode=${mode} genre=${genre ?? 'none'}`);

  if (!apiKey) {
    console.warn('[Deslop.run] No API key configured, pass-through');
    return {
      status: 'pass',
      score: 75,
      issues: [],
      summary: 'API密钥未配置，已保留原文（请先在设置页配置有效AI接口密钥）',
      revisedContent: originalContent,
      rewrittenContent: originalContent,
      diffStats: { originalLength: originalContent.length, revisedLength: originalContent.length, changes: 0 },
    };
  }

  const systemPrompt = buildDeslopSystemPrompt(mode, genre);

  const userPrompt = `【待处理内容】
${originalContent}

【去AI味处理要求 - 严格执行】

请使用"去AI三遍法"处理以上内容：

## Pass 1：去泛化
删除任何"通用型"形容词和套话：
- "美丽的"/"强大的"/"重要的"/"关键的" → 用具体描述替换
- "不禁"/"忍不住"/"不由自主" → 直接写动作
- "仿佛"/"犹如"/"好像" → 删除或直接白描
- "深吸一口气" → "把话咽回去"/"攥紧拳头"
- "瞳孔微缩" → 具体表情描述
- "嘴角微扬" → "他笑了"/"唇线动了动"

## Pass 2：去书面化
把书面表达换成自然口语：
- 删除弱化副词：微微/淡淡/缓缓/轻轻（每千字≤3个）
- 书面连词（然而/因此/此外/与此同时）→ 口语断句
- "不是A，而是B" → 直接写B，删掉对比结构
- "，带着……"（万能状语）→ 删掉留主句
- "平静无波"/"语气毫无波澜" → 直接写台词或动作
- "眼中闪过一丝…"/"嘴角勾起一抹…" → 用具体微动作
- "心中涌起一股…"/"心头一震" → 用身体反应
- 抽象命运收束 → 回到角色当下
- 章末预告 → 用具体钩子收束

## Pass 3：回自然感
读一遍，把"太刻意"的句子改得像真人说话：
- 短句为主，长短交错
- 对话口语化，有语气词（吧、呢、啊、嗯、啧）
- 叙述有逗号长句（逗号间8-12字，整句20-30字）
- 段落长短自然变化（对话1句成段，叙述2-3句）
- 去掉排比三连和过度工整的句式

## 【🚨 排版风格硬规则 · revisedContent 必须严格按此格式】
做不到 AI味分直接扣 30：
1. **顶格对齐，段首不加任何空格**。不要段首空两格。
2. **所有人物对白一律使用直角引号「」**。禁止用 ""、""、''、''、『』任何其它引号。
3. **一句对白 + 提示语（XX说/道/冷笑/沉声…）必须单独成段**，绝不能和前后叙事挤在同一段。
4. **人物内心想法用 *星号夹起来* 并单独成段**，示例：*当前处境：极度危险。对方要钱。我的筹码：一张丑脸？*
5. **段落长短交错**：短到一句话一段，长叙事不超过 3-4 句就分一段，绝不写 200 字以上的长坨子段。
6. **段与段之间空一行**（输出两段之间一个空行，不要三行空行）。
7. **章末绝对用具体悬念收束，不要任何总结**：比如用道具、动作半截、台词截断、细节出现。

### 【排版样板 · revisedContent 照着这个节奏】
夜露凉，像细针往骨头缝里钻。云小汐裹紧身上那件粗布短褐，指腹无意识地摩挲口袋里那块硬邦邦的塑料吊牌。

「侯府的人找过来了。」男人吐出一口酒气，眼神浑浊又贪婪，「小娘子，那三皇子虽然是个疯子，但好歹是皇子。把你交给他，老子能赚不少赏银。」

云小汐没尖叫，也没哭。脑子里飞快转着念头：
*当前处境：极度危险。对方诉求：钱。我的筹码：一张丑到能吓退任何人的脸，外加一个还没用的二维码？*

恐惧像冰水浇透全身，但她强行压下颤音，挤出一个比哭还难看的笑：「这位大哥，您看我这模样，就算交上去，三皇子嫌脏，您的银子也拿不稳啊。」

陆离沉默了一瞬，刀背稍微撤开一些：「你倒是识相。」

就在这时，一张雪白的纸片从门缝里被塞了进来，飘飘悠悠落在她脚边。纸上只有三个字，笔锋凌厉，像是用血写成的：

快逃。

## 【章节结尾绝对禁止】
❌ 总结感悟/升华感叹/哲理收尾/伏笔预告
✅ 正确做法：动作/对话/悬念收束

## 【人物命名检查】
❌ 禁止AI烂大街名字：叶辰、林辰、墨渊、萧逸、顾言琛、陆沉渊、沈寂、凌夜、厉霆骁、傅斯年、苏晚、温阮、洛璃、云舒、许念、白芷、叶绾绾、唐知予、宁汐、夏晚晴、慕晚 等
✅ 确保名字真实、生活化、有烟火气

## 【输出格式 - 严格JSON】
{
  "status": "pass" 或 "fixed",
  "score": 0-100（AI味程度：0=完全AI味，100=完全真人味）,
  "issues": [
    {
      "pattern": "检测到的AI模式名称",
      "count": 出现次数,
      "severity": "high" | "medium" | "low",
      "example": "原文中的一个例子"
    }
  ],
  "summary": "简短总结处理情况",
  "revisedContent": "完整的去AI味后正文",
  "changes": [
    "具体修改说明1",
    "具体修改说明2"
  ]
}

规则：
- pass：AI味≤20分（已自然），revisedContent为原文
- fixed：AI味>20分，必须重写revisedContent去除AI味
- 修改时保持原文剧情、人物、逻辑完全不变，只改变表达方式
- 禁止修改剧情走向和人物设定
- 处理后字数与原文相差不超过10%
- 直接输出JSON，禁止输出任何额外文字`;

  const apiUrlFull = apiUrl.endsWith('/chat/completions') ? apiUrl : `${apiUrl}/chat/completions`;
  let aiContent = '';
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      console.log(`[Deslop.run] attempt=${attempt}/${MAX_RETRIES + 1}`);
      const response = await fetchWithTimeout(apiUrlFull, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: Math.min(temperature, 0.3),
          max_tokens: Math.min(8192, originalContent.length * 3 + 500),
          stream: false,
        }),
        timeout: TIMEOUT_MS,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error(`[Deslop.run] attempt=${attempt} API ${response.status}: ${errText.substring(0, 200)}`);
        lastError = new Error(`API错误 ${response.status}`);
        continue;
      }

      const data = await response.json() as any;
      aiContent = data?.choices?.[0]?.message?.content || '';
      console.log(`[Deslop.run] attempt=${attempt} respLen=${aiContent.length}`);

      if (aiContent && aiContent.trim().length > 10) break;

      console.warn(`[Deslop.run] attempt=${attempt} returned empty/short`);
      lastError = new Error('AI返回内容过短');
    } catch (error: any) {
      lastError = error;
      console.error(`[Deslop.run] attempt=${attempt} failed:`, error?.message || error);
    }

    if (attempt <= MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  if (!aiContent || aiContent.trim().length < 10) {
    console.warn('[Deslop.run] All attempts failed, pass-through original');
    return {
      status: 'pass',
      score: 60,
      issues: [],
      summary: lastError ? `去AI味API异常：${lastError.message}，已保留原文` : '去AI味服务繁忙，已保留原文',
      revisedContent: originalContent,
      rewrittenContent: originalContent,
      diffStats: { originalLength: originalContent.length, revisedLength: originalContent.length, changes: 0 },
    };
  }

  const result = parseDeslopResponse(aiContent, originalContent);
  console.log(`[Deslop.run] done: status=${result.status} score=${result.score} issues=${result.issues.length}`);
  return result;
}

// ========== HTTP handler（前端手动点"去AI味"按钮用；auto-deslop内部链路直接调 runDeslopPipeline 不经过 HTTP）==========
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      content,
      configId,
      mode = 'standard',
      genre,
    } = body;

    if (!content || typeof content !== 'string' || content.trim().length < 50) {
      return NextResponse.json({ error: '请提供至少50字的章节内容' }, { status: 400 });
    }

    const result = await runDeslopPipeline(content, { configId, mode, genre });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Deslop.POST] Failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '去AI味处理失败' },
      { status: 500 },
    );
  }
}
