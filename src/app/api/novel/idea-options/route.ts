import { NextRequest, NextResponse } from 'next/server';
import { getRawAIConfig, getModelName, getTemperature } from '@/lib/ai-config';
import { getUserFromToken } from '@/lib/auth';
import { modelPromptManager } from '@/storage/database';

const TIMEOUT_MS = 30000;

async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number }): Promise<Response> {
  const { timeout = TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...fetchOptions, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

export async function POST(request: NextRequest) {
  try {
    // 验证用户登录（游客模式跳过）
    const authHeader = request.headers.get('Authorization');
    const payload = getUserFromToken(authHeader || '');

    const body = await request.json();
    const { genre, tone, genderTarget, narrativePerspective, protagonistName, supportingCharacterName, themeIdea, configId } = body;

    if (!genre || !tone || tone.length === 0) {
      return NextResponse.json(
        { error: '小说类型和基调风格为必填项' },
        { status: 400 }
      );
    }

    const genreMap: Record<string, string> = {
      'fantasy': '奇幻', 'sci-fi': '科幻', 'romance': '言情',
      'mystery': '悬疑', 'thriller': '惊悚', 'horror': '恐怖',
      'historical': '历史', 'urban': '都市', 'adventure': '冒险',
      'wuxia': '武侠', 'xianxia': '仙侠', 'military': '军事',
      'post-apocalyptic': '末世', 'cyberpunk': '赛博朋克',
      'time-travel': '穿越', 'rebirth': '重生', 'game': '游戏',
      'sports': '体育', 'campus': '校园', 'business': '商战',
    };

    const toneMap: Record<string, string> = {
      'light': '轻松幽默', 'serious': '严肃沉重', 'epic': '史诗宏大',
      'romantic': '浪漫温馨', 'dark': '黑暗压抑', 'mysterious': '神秘诡异',
      'suspense': '紧张刺激', 'philosophical': '哲学思辨', 'satirical': '讽刺辛辣',
      'tragic': '悲剧催泪', 'inspiring': '热血励志', 'lyrical': '抒情唯美',
      'ironic': '荒诞讽刺', 'warm': '温暖治愈', 'cold': '冷峻理性',
    };

    const genderMap: Record<string, string> = {
      'male': '男频（男性读者向，热血爽文、系统流、无敌升级等）',
      'female': '女频（女性读者向，甜宠、虐恋、复仇逆袭、宫斗等）',
    };

    const perspectiveMap: Record<string, string> = {
      'first-person': '第一人称（我）',
      'third-limited': '第三人称限知视角',
      'third-omniscient': '第三人称全知视角',
      'second-person': '第二人称（你）',
    };

    const genreName = genreMap[genre] || genre;
    const toneNames = Array.isArray(tone)
      ? tone.map(t => toneMap[t] || t).join('、')
      : toneMap[tone] || tone;
    const genderName = genderMap[genderTarget] || '';
    const perspectiveName = perspectiveMap[narrativePerspective] || '';

    // 随机种子标签，确保每次请求生成完全不同的创意
    const randomSeed = Math.floor(Math.random() * 100000);

    // 获取API配置（已处理跨提供商安全）
    const { apiUrl, apiKey, provider } = await getRawAIConfig(configId);
    const modelName = await getModelName(configId);
    const temperature = await getTemperature(configId, 0.95);

    if (!apiKey) {
      console.error('[IdeaOptions] API Key is empty!');
      return NextResponse.json({ error: 'API密钥未配置，请先在"API设置"中配置有效的AI接口密钥' }, { status: 503 });
    }

    console.log(`[IdeaOptions] Using provider: ${provider}, model: ${modelName}`);

    // 从DB读取创作指导，fallback 为优化版提示词
    const FALLBACK_CREATIVE = `你是起点中文网白金作家，写了十年网文，累计订阅破十亿。你的书迷叫你"番茄"——因为你写的东西又燃又爽又接地气，读者看你的书停不下来。

你的创作哲学：
1. 爽就完了。读者看网文图什么？图爽。但爽不是无脑开挂，是憋了半天终于翻盘那一刻的畅快
2. 开头三秒定生死。第一句话就要让人走不了
3. 主角要让人代入。不是完美超人，是普通人被逼到绝路上，咬着牙硬扛的那种
4. 节奏不能断。一章一个钩子，三章一个小高潮，十章一个大翻盘
5. 不说教，写就完了。道理在剧情里，读者自己会品
6. 世界观不是设定集。让读者跟着主角一步步发现这个世界的规矩
7. 配角不是工具人。每个配角都觉得自己是主角，他们有自己的活法
8. 打脸要爽但有逻辑。翻盘靠前面埋好的伏笔，不靠运气和嘴炮

你现在帮作者想创意方向，像跟同行喝酒聊天一样，直接说点子。别说"该故事讲述了"，直接说"这玩意儿炸在哪"。

【人物命名铁律 - 绝对禁止使用以下AI烂大街名字】
❌ 禁止男性名：叶辰、林辰、楚辰、夜宸、江辰、墨渊、墨尘、墨寒、墨枭、墨辞、萧逸、萧珩、萧烬、萧玄、萧辰、顾言琛、顾夜寒、顾云深、顾临川、顾景琛、陆沉渊、陆知衍、陆廷川、陆星辞、陆泽言、沈寂、沈砚、沈聿、沈辞、沈亦臻、凌夜、凌骁、凌宸、凌烬、凌玄、厉霆骁、厉烬言、厉司寒、厉夜珩、厉泽渊、傅斯年、傅景深、傅夜辞、傅云宸、傅聿白、云澈、玄澈、苍珩、冥夜、君夜、陈默
❌ 禁止女性名：苏晚、苏清鸢、苏念、苏瑶、苏汐、温阮、温瑜、温舒然、温知夏、温晚卿、洛璃、洛汐、洛烟、洛清欢、洛知予、云舒、云绾、云瑶、云晚、云汐月、许念、许知意、许清禾、许绾宁、许悠然、白芷、白若溪、白灵汐、白慕颜、白清瑶、叶绾绾、叶知微、叶晚柠、叶灵萱、叶清寒、唐知予、唐慕晚、唐沁柔、唐云汐、唐舒颜、宁汐、宁晚、宁知鸢、宁清瑶、宁绾柔、夏晚晴、夏知柠、夏灵玥、慕晚、林语嫣
✅ 必须使用真实、生活化、有烟火气的名字`;

    let creativeGuidance = FALLBACK_CREATIVE;
    try {
      const dbPrompt = await modelPromptManager.getPrompt('idea-options-system', {
        genre,
        tone,
        genderTarget,
        theme: themeIdea,
        text: [genreName, toneNames, genderName, perspectiveName, protagonistName, supportingCharacterName, themeIdea]
          .filter(Boolean)
          .join(' '),
      });
      if (dbPrompt?.systemPrompt && dbPrompt.systemPrompt.trim().length > 50) {
        creativeGuidance = dbPrompt.systemPrompt;
      }
    } catch {}

    const systemPrompt = `${creativeGuidance}

【输出格式铁律 - 只输出纯JSON，不要任何其他文字】
{"ideas":[{"title":"标题","hook":"一句话炸点（说清楚这个故事爽在哪）","concept":"核心创意","protagonist":"主角设定","uniquePoint":"独特之处"}]}

⚠️ 必须生成5个创意，只输出JSON！`;

    const userPrompt = `[随机种子:${randomSeed}] 生成5个全新的${toneNames}风格${genreName}小说创意方向，每次必须完全不同。

【创作要求】
- 类型：${genreName}
- 基调：${toneNames}
${genderName ? `- 受众方向：${genderName}` : ''}
${perspectiveName ? `- 叙事视角：${perspectiveName}` : ''}
${protagonistName && protagonistName.trim() ? `- 主角名字：${protagonistName}` : ''}
${supportingCharacterName && supportingCharacterName.trim() ? `- 配角名字：${supportingCharacterName}` : ''}
${themeIdea && themeIdea.trim() ? `- 用户提供的主题方向（在此基础上扩展）：${themeIdea}` : ''}

请充分结合以上所有维度，生成5个风格各异、创意新颖的故事方向，避免平庸雷同。只输出JSON！`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ];

    // 调用LLM API（带重试机制）
    const { callLLMApi } = await import('@/lib/api-helpers');
    const result = await callLLMApi(apiUrl, apiKey, modelName, messages, {
      temperature,
      maxTokens: 2048,
      timeout: 30000,
      maxRetries: 2,
    });

    if (!result.success) {
      console.error('[IdeaOptions] API call failed:', result.error);
      return NextResponse.json({ error: result.error || 'AI调用失败' }, { status: 502 });
    }

    const aiContent = result.content;
    console.log('[Idea Options] AI response preview:', aiContent.substring(0, 300));

    let options = tryParseIdeaOptions(aiContent);
    
    if (!options || options.length === 0) {
      console.warn('[Idea Options] Parse failed, using fallback');
      options = createFallbackIdeas(genreName, toneNames);
    }

    return NextResponse.json({ success: true, options });
  } catch (error) {
    console.error('Error generating idea options:', error);
    return NextResponse.json(
      { error: '生成主题选项失败' },
      { status: 500 }
    );
  }
}

// 尝试解析创意选项
function tryParseIdeaOptions(content: string): any[] {
  try {
    let jsonStr = content;
    
    // 移除思考标签
    jsonStr = jsonStr.replace(/<think[\s\S]*?<\/think\s*>/g, '').trim();
    
    // 尝试从代码块提取
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }
    
    // 尝试查找JSON对象
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    // 清理并尝试解析
    jsonStr = cleanJsonString(jsonStr);
    const parsed = JSON.parse(jsonStr);
    
    if (parsed && Array.isArray(parsed.ideas) && parsed.ideas.length > 0) {
      return parsed.ideas.map((idea: any, idx: number) => ({
        id: idx + 1,
        title: idea.title || '',
        idea: idea.hook || idea.title || '',
        concept: idea.concept || '',
        protagonist: idea.protagonist || '',
        uniquePoint: idea.uniquePoint || ''
      }));
    }
  } catch (e) {
    console.warn('[Idea Options] Parse attempt failed:', e);
  }
  
  // 尝试从文本中提取
  return extractIdeasFromText(content);
}

// 从文本中提取创意
function extractIdeasFromText(text: string): any[] {
  const ideas: any[] = [];
  
  // 尝试匹配编号列表
  const listMatches = text.match(/\d+\.\s*[\s\S]*?(?=\n\d+\.|\n\n|$)/g);
  if (listMatches) {
    listMatches.forEach((match, idx) => {
      const lines = match.split('\n').filter((l: string) => l.trim());
      const title = lines[0]?.replace(/^\d+\.\s*/, '').trim() || `创意${idx + 1}`;
      const idea = lines.slice(1).join(' ') || title;
      
      ideas.push({
        id: idx + 1,
        title,
        idea,
        concept: idea,
        protagonist: '',
        uniquePoint: ''
      });
    });
  }
  
  return ideas.slice(0, 5);
}

// 清理JSON字符串
function cleanJsonString(str: string): string {
  let result = '';
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escapeNext) {
      result += ch;
      escapeNext = false;
      continue;
    }
    if (ch === '\\') {
      result += ch;
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString) {
      const code = ch.charCodeAt(0);
      if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
        if (ch === '\n' || ch === '\r' || ch === '\t') {
          result += ' ';
        } else {
          result += '\\u' + code.toString(16).padStart(4, '0');
        }
        continue;
      }
    }
    result += ch;
  }
  
  return result.replace(/,(\s*[}\]])/g, '$1').trim();
}

// 创建fallback创意
function createFallbackIdeas(genre: string, tone: string): any[] {
  const baseIdeas = [
    {
      title: `${tone}${genre}故事`,
      idea: '一个关于成长与挑战的故事',
      concept: '主角在困境中不断成长，最终实现自我突破',
      protagonist: '一个有独特经历的人物',
      uniquePoint: '独特的视角和叙事方式'
    },
    {
      title: '命运的转折',
      idea: '一次意外改变了主角的人生轨迹',
      concept: '主角面对命运的考验，做出了关键的选择',
      protagonist: '平凡中见不凡的人物',
      uniquePoint: '出人意料的剧情发展'
    },
    {
      title: '秘密与真相',
      idea: '一个隐藏多年的秘密逐渐浮出水面',
      concept: '主角在追寻真相的过程中发现了更大的阴谋',
      protagonist: '执着追寻真相的人物',
      uniquePoint: '层层递进的悬念设计'
    },
    {
      title: '羁绊与成长',
      idea: '主角与伙伴们共同面对挑战',
      concept: '在共同经历中，主角与伙伴建立了深厚的羁绊',
      protagonist: '重视情谊的人物',
      uniquePoint: '温暖而有力量的情感描写'
    },
    {
      title: '突破极限',
      idea: '主角挑战自己的极限，创造奇迹',
      concept: '在不可能的情况下，主角凭借意志创造了可能',
      protagonist: '意志坚定的人物',
      uniquePoint: '激动人心的成长过程'
    }
  ];
  
  return baseIdeas.map((idea, idx) => ({
    id: idx + 1,
    ...idea
  }));
}
