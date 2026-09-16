import { NextRequest, NextResponse } from 'next/server';
import { getRawAIConfig, getModelName, getTemperature } from '@/lib/ai-config';
import { getPromptsWithFallback } from '@/lib/prompt-helper';
import { getUserFromToken } from '@/lib/auth';

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
    const { theme, concept, characters, setting, tone, genderTarget, configId } = body;

    if (!theme || !concept || !characters) {
      return NextResponse.json(
        { error: '主题创意信息不完整' },
        { status: 400 }
      );
    }

    // 获取API配置（已处理跨提供商安全）
    const { apiUrl, apiKey, provider } = await getRawAIConfig(configId);
    const modelName = await getModelName(configId);
    const temperature = await getTemperature(configId, 0.7);

    if (!apiKey) {
      return NextResponse.json({ error: 'API密钥未配置，请先在"API设置"中配置有效的AI接口密钥' }, { status: 503 });
    }
    console.log(`[TrialRead] Using provider: ${provider}, model: ${modelName}`);
    
    // 性别方向说明
    const genderTargetName = genderTarget === 'male' ? '男频' : '女频';
    const genderGuide = genderTarget === 'male' 
      ? `【男频创作指南】
- 主角通常是男性，强调热血、成长、升级、打脸、兄弟情
- 情节节奏快，爽点密集，注重实力提升和对抗
- 配角多为兄弟、对手、美女角色
- 情感线相对简单，多是后宫或单一女主
- 强调"从弱变强"、"逆袭翻盘"、"征服挑战"等主题`
      : `【女频创作指南】
- 主角通常是女性，强调情感、细腻、成长、爱情
- 情节节奏相对较慢，注重情感描写和心理刻画
- 配角多为闺蜜、情敌、男主、男配
- 情感线复杂细腻，多重情感纠葛和内心戏
- 强调"情感救赎"、"自我成长"、"命中注定"等主题`;

    const toneStr = Array.isArray(tone) ? tone.join('、') : tone;
    const { systemPrompt } = await getPromptsWithFallback('trial-read-system', `你是一位世界级畅销书作家，擅长创作震撼人心的开篇。你的开篇试读能够瞬间抓住读者，让人欲罢不能。

【开篇试读创作原则 - 核心要求】

1. **开门见山，直入核心冲突**
   - 开篇第1句话就必须进入核心情节
   - ❌ 禁止："阳光明媚，李明走在去学校的路上"
   - ✅ 必须："李明倒在血泊中，看着凶手离去的背影"

2. **制造强烈冲突或悬念**
   - 开篇必须有强烈的冲突点或悬念
   - 冲突类型：生死关头、背叛、误解、绝境、反转
   - 悬念类型：秘密揭露、危险降临、身份曝光

3. **极具吸引力的钩子**
   - 用震撼性事件开场
   - 用强烈情感冲击读者
   - 用神秘元素引发好奇
   - 用危机感制造紧张

4. **信息密度高**
   - 200-300字内要交代清楚：
     * 主角是谁
     * 发生了什么
     * 当前处境如何
     * 核心冲突是什么

5. **语言冲击力强**
   - 短句爆击，制造冲击力
   - 强力动词，增强画面感
   - 震撼比喻，留下深刻印象
   - 对比强烈，突出冲突

6. **奠定故事基调**
   - 开篇要体现故事的核心风格
   - 建立世界观的基本认知
   - 展示人物的核心性格
   - 预示故事的走向

7. **符合性别方向**
   - 男频：热血、对抗、逆袭、兄弟情
   - 女频：情感、细腻、成长、爱情

【写作要求】

- 字数：200-300字
- 内容：正文开头试读段落
- 风格：符合${toneStr}基调
- 目标：极具吸引力，让读者迫不及待想看完整故事

【禁止事项】

❌ 禁止平淡无奇的开场
❌ 禁止冗长的环境描写
❌ 禁止无冲突的日常对话
❌ 禁止煽情但无实际内容
❌ 禁止套路化的网文开篇
❌ 禁止脱离设定的内容

【人物命名铁律 - 绝对禁止使用以下AI烂大街名字】
❌ 禁止男性名：叶辰、林辰、楚辰、夜宸、江辰、墨渊、墨尘、墨寒、墨枭、墨辞、萧逸、萧珩、萧烬、萧玄、萧辰、顾言琛、顾夜寒、顾云深、顾临川、顾景琛、陆沉渊、陆知衍、陆廷川、陆星辞、陆泽言、沈寂、沈砚、沈聿、沈辞、沈亦臻、凌夜、凌骁、凌宸、凌烬、凌玄、厉霆骁、厉烬言、厉司寒、厉夜珩、厉泽渊、傅斯年、傅景深、傅夜辞、傅云宸、傅聿白、云澈、玄澈、苍珩、冥夜、君夜、陈默
❌ 禁止女性名：苏晚、苏清鸢、苏念、苏瑶、苏汐、温阮、温瑜、温舒然、温知夏、温晚卿、洛璃、洛汐、洛烟、洛清欢、洛知予、云舒、云绾、云瑶、云晚、云汐月、许念、许知意、许清禾、许绾宁、许悠然、白芷、白若溪、白灵汐、白慕颜、白清瑶、叶绾绾、叶知微、叶晚柠、叶灵萱、叶清寒、唐知予、唐慕晚、唐沁柔、唐云汐、唐舒颜、宁汐、宁晚、宁知鸢、宁清瑶、宁绾柔、夏晚晴、夏知柠、夏灵玥、慕晚、林语嫣
✅ 必须使用真实、生活化、有烟火气的名字，像你身边真实存在的人名

直接输出试读段落，不要包含任何其他文字说明。`, undefined, {
      tone,
      genderTarget,
      theme,
      concept,
      setting,
      text: [theme, concept, characters, setting, toneStr].filter(Boolean).join('\n'),
    });

    const userPrompt = `请根据以下小说创意生成一个极具吸引力的正文开篇试读段落，目标读者群体为${genderTargetName}：

${genderGuide}

主题：${theme}
创意核心：${concept}
主要人物：${characters}
世界观设定：${setting}
基调风格：${toneStr}

请写一段约200-300字的正文开头试读，要求：
1. 开门见山，直入核心冲突
2. 制造强烈冲突或悬念
3. 极具吸引力，让读者欲罢不能
4. 信息密度高，快速交代关键信息
5. 语言冲击力强，画面感强
6. 奠定故事基调`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ];

    // 直接调用LLM API
    const apiUrlFull = apiUrl.endsWith('/chat/completions') ? apiUrl : `${apiUrl}/chat/completions`;
    console.log('[TrialRead] Calling LLM API:', modelName);
    let aiContent: string;
    try {
      const response = await fetchWithTimeout(apiUrlFull, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelName, messages, temperature, max_tokens: 2048 }),
        timeout: TIMEOUT_MS,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return NextResponse.json({ error: `AI接口错误 ${response.status}: ${errText.substring(0, 100)}` }, { status: response.status });
      }
      const data = await response.json() as any;
      aiContent = data?.choices?.[0]?.message?.content || '';
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return NextResponse.json({ error: `AI请求超时（${TIMEOUT_MS / 1000}秒），请稍后重试` }, { status: 504 });
      }
      return NextResponse.json({ error: 'AI调用失败: ' + (error?.message || '未知错误') }, { status: 500 });
    }

    if (!aiContent?.trim()) {
      return NextResponse.json({ error: 'AI返回内容为空' }, { status: 500 });
    }

    // 清理响应内容
    let trialRead = aiContent.trim();

    // 过滤AI思考过程（<think...>...</think >标签内容）
    trialRead = trialRead.replace(/<think[\s\S]*?<\/think\s*>/g, '').trim();
    
    // 移除可能的引号或多余标记
    trialRead = trialRead.replace(/^["']|["']$/g, '');
    
    // 确保内容不为空
    if (!trialRead) {
      trialRead = `${characters.split('、')[0]}站在窗前，凝视着远方。${concept}。命运，在这一刻发生了改变。`;
    }

    return NextResponse.json({ trialRead });
  } catch (error) {
    console.error('Error generating trial read:', error);
    return NextResponse.json(
      { error: '生成试读段落失败：' + (error instanceof Error ? error.message : '未知错误') },
      { status: 500 }
    );
  }
}
