import { NextRequest, NextResponse } from 'next/server';
import { getRawAIConfig, getModelName, getTemperature } from '@/lib/ai-config';
import { getPromptWithFallback } from '@/lib/prompt-helper';

const TIMEOUT_MS = 360_000; // T360: 标题生成也跟随 360s 超时
const MAX_RETRIES = 2;

async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number }): Promise<Response> {
  const { timeout = TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...fetchOptions, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { idea, structure, chapters, tone, configId } = body;

    if (!idea || !structure || !chapters || chapters.length === 0) {
      return NextResponse.json(
        { error: '小说信息不完整，需要主题创意、结构分析和章节内容' },
        { status: 400 }
      );
    }

    // 获取API配置（现在返回{apiUrl, apiKey, provider}）
    const { apiUrl, apiKey, provider } = await getRawAIConfig(configId);
    const modelName = await getModelName(configId);
    const temperature = await getTemperature(configId, 0.7);

    if (!apiKey) {
      return NextResponse.json({ error: 'API密钥未配置，请先在"API设置"中配置有效的AI接口密钥' }, { status: 503 });
    }

    console.log(`[Title] Using provider: ${provider}, model: ${modelName}, url: ${apiUrl}`);

    // 获取章节摘要（取前几章和后几章的钩子）
    const chapterHooks = structure.chapterHooks || structure.chapterOutlines || [];
    const chapterSummary = chapterHooks.length > 0
      ? chapterHooks
          .map((hook: string, index: number) => `第${index + 1}章：${hook}`)
          .slice(0, 5)
          .join('\n')
      : '无章节钩子信息';

    // 获取正文片段（从几章中提取部分内容）
    const validChapters = chapters.filter((ch: any) => ch && ch.content && ch.content.trim());
    const sampleContent = validChapters.length > 0
      ? validChapters
          .slice(0, 3)
          .map((ch: any) => `第${ch.index || ch.chapterNumber || '?'}章：${(ch.content || '').slice(0, 200)}`)
          .join('\n\n')
      : '无章节内容';

    const systemPrompt = await getPromptWithFallback('novel-title-system', `你是一位资深的文学编辑，擅长为小说创作能抓住读者眼球、令人过目不忘的标题。

【输出格式要求】
请严格按照以下格式输出，标题必须用《》包裹：

## 核心推荐
1. **《标题1》**
2. **《标题2》**
3. **《标题3》**
4. **《标题4》**
5. **《标题5》**

## 备选推荐
6. 《标题6》
7. 《标题7》
8. 《标题8》
9. 《标题9》
10. 《标题10》

## 最终推荐
《最佳标题》

【标题创作原则】
1. **书名号包裹**：所有标题都要放在《》里面
2. **双关隐喻**：优先使用有双重含义的标题
3. **抓眼球**：标题要有悬念感、画面感或情感冲击力
4. **有故事感**：暗示故事的核心冲突或人物关系
5. **文学性**：可以使用比喻、象征等文学手法
6. **长度合适**：标题长度控制在4-10个字之间
7. **避免俗套**：不要用"时空"、"之旅"、"之路"等烂大街词汇
8. **不要添加解释**：标题列表只输出标题本身，不要加解释说明`);

    const userPrompt = `请为以下小说创作10个书名标题：

【小说信息】
主题：${idea.theme}
创意：${idea.concept || '未提供'}
主要人物：${idea.characters || '未提供'}
核心情节：${structure.mainPlot || '未提供'}
情感基调：${structure.emotionalCurve || '未提供'}
章节钩子：${chapterSummary}
正文片段：${sampleContent || '无'}
风格：${tone || '默认'}

【要求】
- 严格按照格式输出
- 每个标题用《》包裹
- 输出10个标题（5个核心推荐 + 5个备选）
- 最后给出1个最终推荐
- 不要输出任何额外解释`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ];

    // 直接调用LLM API，带重试机制
    const apiUrlFull = apiUrl.endsWith('/chat/completions') ? apiUrl : `${apiUrl}/chat/completions`;
    console.log(`[Title] Calling ${apiUrlFull} with model ${modelName}`);
    let aiContent: string = '';
    let currentKey = apiKey;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      try {
        console.log(`[Title] Attempt ${attempt}/${MAX_RETRIES + 1}`);
        const response = await fetchWithTimeout(apiUrlFull, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentKey}` },
          body: JSON.stringify({ model: modelName, messages, temperature, max_tokens: 2048 }),
          timeout: TIMEOUT_MS,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          console.error(`[Title] API error ${response.status}:`, errText.substring(0, 200));
          
          if (attempt <= MAX_RETRIES) {
            const waitTime = 1000 * attempt;
            console.log(`[Title] Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          
          // 最后一次失败，返回详细错误信息
          const errMsg = response.status === 401 
            ? 'AI接口认证失败：API密钥无效或已过期' 
            : response.status === 404
            ? 'AI接口地址错误：请检查API URL配置'
            : `AI接口错误 ${response.status}`;
          return NextResponse.json({ error: errMsg }, { status: 502 });
        }
        const data = await response.json() as any;
        aiContent = data?.choices?.[0]?.message?.content || '';

        if (aiContent && aiContent.trim().length > 5) {
          break; // 成功获取内容
        }

        console.warn(`[Title] Attempt ${attempt} returned empty content`);
      } catch (error: any) {
        console.error(`[Title] Attempt ${attempt} failed:`, error?.message || error);
        if (error?.name === 'AbortError') {
          if (attempt <= MAX_RETRIES) {
            console.warn(`[Title] Timeout on attempt ${attempt}, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
          return NextResponse.json({ error: `AI请求超时（${TIMEOUT_MS / 1000}秒）` }, { status: 504 });
        }
        if (attempt <= MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        return NextResponse.json({ error: 'AI调用失败: ' + (error?.message || '未知错误') }, { status: 500 });
      }
    }

    if (!aiContent?.trim()) {
      return NextResponse.json({ error: 'AI返回内容为空' }, { status: 500 });
    }

    let rawContent = aiContent.trim();

    // 过滤AI思考过程（<think...>...</think >标签内容）
    rawContent = rawContent.replace(/<think[\s\S]*?<\/think\s*>/g, '').trim();

    // 解析返回的内容，提取标题
    const parsedResult = parseTitleRecommendations(rawContent);

    return NextResponse.json(parsedResult);
  } catch (error) {
    console.error('Error generating title:', error);
    return NextResponse.json(
      { error: '生成标题失败' },
      { status: 500 }
    );
  }
}

// 解析标题推荐内容
function parseTitleRecommendations(content: string) {
  const result = {
    coreRecommendations: [] as string[],
    alternativeRecommendations: [] as string[],
    finalRecommendation: '',
    raw: content,
  };

  // 清理内容
  const cleaned = content.trim();

  // 尝试多种格式匹配方式提取标题
  // 格式1: **《标题》** 或 **《标题》** - 说明
  // 格式2: 《标题》
  // 格式3: 数字. 《标题》
  
  // 先尝试提取所有包含书名号的标题
  const allTitleMatches: string[] = [];
  
  // 匹配 **《标题》** 格式
  const boldTitleRegex = /\*\*《([^》]+)》\*\*/g;
  let match;
  while ((match = boldTitleRegex.exec(cleaned)) !== null) {
    if (match[1].trim()) allTitleMatches.push(match[1].trim());
  }
  
  // 如果没有粗体格式，尝试普通的 《标题》 格式
  if (allTitleMatches.length === 0) {
    const simpleTitleRegex = /《([^》]+)》/g;
    while ((match = simpleTitleRegex.exec(cleaned)) !== null) {
      if (match[1].trim()) allTitleMatches.push(match[1].trim());
    }
  }

  // 根据内容分段分配标题
  if (allTitleMatches.length >= 10) {
    // 有10个以上标题
    result.coreRecommendations = allTitleMatches.slice(0, 5);
    result.alternativeRecommendations = allTitleMatches.slice(5, 10);
  } else if (allTitleMatches.length >= 5) {
    result.coreRecommendations = allTitleMatches.slice(0, 5);
    result.alternativeRecommendations = allTitleMatches.slice(5);
  } else if (allTitleMatches.length > 0) {
    result.coreRecommendations = allTitleMatches;
  }

  // 提取最终推荐（优先从 "最终推荐" 或 "推荐" 关键词附近找）
  const finalMatch1 = cleaned.match(/(?:最终推荐|最佳推荐|推荐标题|最终选择)[\s\S]*?《([^》]+)》/);
  const finalMatch2 = cleaned.match(/(?:Final|Best|Recommended)[\s\S]*?《([^》]+)》/i);
  
  if (finalMatch1 && finalMatch1[1]) {
    result.finalRecommendation = finalMatch1[1].trim();
  } else if (finalMatch2 && finalMatch2[1]) {
    result.finalRecommendation = finalMatch2[1].trim();
  } else if (result.coreRecommendations.length > 0) {
    result.finalRecommendation = result.coreRecommendations[0];
  }

  // 如果还是没有结果，尝试按行分割提取
  if (result.coreRecommendations.length === 0) {
    const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l);
    for (const line of lines) {
      // 跳过标题行和说明行
      if (/^(#|##|---)/.test(line)) continue;
      // 提取标题
      const lineMatch = line.match(/《([^》]+)》/);
      if (lineMatch && lineMatch[1].trim()) {
        allTitleMatches.push(lineMatch[1].trim());
      }
    }
    if (allTitleMatches.length > 0) {
      result.coreRecommendations = allTitleMatches.slice(0, Math.min(5, allTitleMatches.length));
      result.alternativeRecommendations = allTitleMatches.slice(5, Math.min(10, allTitleMatches.length));
    }
  }

  // 确保至少有一个标题
  if (result.coreRecommendations.length === 0) {
    // 最后兜底：尝试提取任何看起来像标题的内容
    const fallbackTitles = extractFallbackTitles(cleaned);
    if (fallbackTitles.length > 0) {
      result.coreRecommendations = fallbackTitles.slice(0, 5);
      result.alternativeRecommendations = fallbackTitles.slice(5, 10);
      result.finalRecommendation = fallbackTitles[0];
    } else {
      result.coreRecommendations = ['未命名小说'];
      result.finalRecommendation = '未命名小说';
    }
  } else if (!result.finalRecommendation) {
    result.finalRecommendation = result.coreRecommendations[0];
  }

  return result;
}

// 兜底标题提取：从无格式文本中提取可能的标题
function extractFallbackTitles(text: string): string[] {
  const titles: string[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  
  for (const line of lines) {
    // 跳过 markdown 标题和分隔线
    if (/^(#|##|---|\*)/.test(line)) continue;
    // 跳过说明文字（太长的不是标题）
    if (line.length > 50) continue;
    // 跳过以解释开头的行
    if (/^(这|那|此|该|因为|由于|说明|解释|Why|Because)/.test(line)) continue;
    
    // 清理序号和格式
    let cleaned = line
      .replace(/^\d+[\.\、\)\s]+/, '')  // 移除序号
      .replace(/^\*+|\*+$/g, '')         // 移除加粗标记
      .replace(/^[-•]\s*/, '')           // 移除列表标记
      .trim();
    
    if (cleaned.length >= 4 && cleaned.length <= 30) {
      titles.push(cleaned);
    }
  }
  
  return titles.slice(0, 10);
}
