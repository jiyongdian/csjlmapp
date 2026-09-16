import { NextRequest, NextResponse } from 'next/server';
import { getRawAIConfig, getModelName, getTemperature } from '@/lib/ai-config';
import { modelPromptManager } from '@/storage/database';
import { getUserFromToken } from '@/lib/auth';

const TIMEOUT_MS = 90000; // 90秒超时（创意生成需要较长时间）

/** 带超时的fetch */
async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number }): Promise<Response> {
  const { timeout = TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 清理JSON字符串中的非法字符 */
function cleanJsonString(str: string): string {
  let result = '';
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escapeNext) { result += ch; escapeNext = false; continue; }
    if (ch === '\\') { result += ch; escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString && (ch === '\n' || ch === '\r' || ch === '\t')) { result += ' '; continue; }
    if (inString) {
      const code = ch.charCodeAt(0);
      if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
        result += '\\u' + code.toString(16).padStart(4, '0');
      } else {
        result += ch;
      }
      continue;
    }
    result += ch;
  }
  return result.replace(/,(\s*[}\]])/g, '$1').trim();
}

/** 多级JSON解析 */
function tryParseJson(str: string): any {
  // 1级：标准清理后解析
  try { return JSON.parse(cleanJsonString(str)); } catch (e) {}
  // 2级：替换单引号
  try { return JSON.parse(cleanJsonString(str).replace(/'/g, '"')); } catch (e) {}
  // 3级：逐字段提取
  try {
    const fields = ['theme', 'concept', 'characters', 'supportingCharacters', 'characterRelationships', 'setting'];
    const result: any = {};
    for (const field of fields) {
      const regex = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 's');
      const match = str.match(regex);
      if (match) result[field] = match[1].replace(/\\n/g, '\n');
    }
    if (Object.keys(result).length > 0) return result;
  } catch (e) {}
  // 4级：贪婪匹配
  try {
    const fields = ['theme', 'concept', 'characters', 'supportingCharacters', 'characterRelationships', 'setting'];
    const result: any = {};
    let remaining = str;
    for (const field of fields) {
      const regex = new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)"(?:,|\\s*})`);
      const match = remaining.match(regex);
      if (match) {
        result[field] = match[1].replace(/\\n/g, '\n');
        remaining = remaining.replace(regex, '');
      }
    }
    if (Object.keys(result).length > 0) return result;
  } catch (e) {}
  return null;
}

const GENRE_MAP: Record<string, string> = {
  'fantasy': '奇幻', 'sci-fi': '科幻', 'romance': '言情',
  'mystery': '悬疑', 'thriller': '惊悚', 'horror': '恐怖',
  'historical': '历史', 'urban': '都市', 'adventure': '冒险',
  'wuxia': '武侠', 'xianxia': '仙侠', 'military': '军事',
  'post-apocalyptic': '末世', 'cyberpunk': '赛博朋克',
  'time-travel': '穿越', 'rebirth': '重生', 'game': '游戏',
  'sports': '体育', 'campus': '校园', 'business': '商战',
};

const TONE_MAP: Record<string, string> = {
  'light': '轻松幽默', 'serious': '严肃沉重', 'epic': '史诗宏大',
  'romantic': '浪漫温馨', 'dark': '黑暗压抑', 'mysterious': '神秘诡异',
  'suspense': '紧张刺激', 'philosophical': '哲学思辨', 'satirical': '讽刺辛辣',
  'tragic': '悲剧催泪', 'inspiring': '热血励志', 'lyrical': '抒情唯美',
  'ironic': '荒诞讽刺', 'warm': '温暖治愈', 'cold': '冷峻理性',
};

const AUTHOR_PERSONA: Record<string, string> = {
  'fantasy': '你是起点白金作家，写过十本奇幻，每本订阅破万。你的套路：开局最惨，成长最燃，翻盘最爽。',
  'sci-fi': '你是科幻圈的老人，刘慈欣的同行。你的脑洞有硬核逻辑，先恐惧再敬畏最后让人沉默。',
  'romance': '你是晋江顶流作者，你写的爱情不甜却让读者磕得死去活来。写爱情的笨拙，不是完美。',
  'mystery': '你是推理圈硬核玩家，东野圭吾式写法。悬念藏在读者眼前，但就是看不见。',
  'thriller': '你是写惊悚的狠人，读者看你的书要开灯睡觉。你用人吓人，不是鬼。',
  'horror': '你是民间怪谈收藏者，恐怖来自日常生活裂缝。不写"有一个鬼"，写"那个房间总有人住，但从来没有人见过住客"。',
  'historical': '你是历史系博士，能正史缝隙里塞进可信的虚构人物。细节考究到教授挑不出毛病。',
  'urban': '你是混过社会也写过社会的人。写凌晨三点便利店的热柜、出租屋漏水的墙角。再苦的日子也要写出翻盘的痛快。',
  'adventure': '你是户外探险狂热者，爬过雪山穿过沙漠。冒险不是开挂闯关，是让读者喘不上气。',
  'wuxia': '你是古龙和金庸都读烂了的人。写刀光背后的人心，江湖不是快意恩仇的童话。',
  'xianxia': '你修仙文写了八年，凡人修仙不是靠天赋靠血统，是靠那股不服输的狠劲。',
  'military': '你是退伍老兵，写战壕里兄弟间的那根烟。战场是士兵鞋底的泥和枪管的温度。',
  'post-apocalyptic': '你是末世专业户，写文明废墟上人性重建还是崩塌。',
  'cyberpunk': '你是赛博朋克死忠，写技术吞噬人性时人类最后那点倔强。',
  'time-travel': '你是穿越文老炮，写现代人到了古代的孤独和无力。',
  'rebirth': '你是重生文行家，写"如果重来一次，我真的能做出不同的选择吗"。',
  'game': '你是游戏策划转行的作家，系统有灵魂，不是冰冷弹窗。',
  'sports': '你是退役运动员，写最后一秒心跳加速到极限的瞬间。',
  'campus': '你是青春文学清新派，写课桌下偷偷递纸条的心跳、毕业那天说不出口的话。',
  'business': '你是商战文老狐狸，写谈判桌上眼神交锋、合同条款里藏的刀子。',
};

const NARRATIVE_PERSPECTIVE_MAP: Record<string, { name: string; guide: string }> = {
  'first-person': {
    name: '第一人称',
    guide: '第一人称视角：全文以"我"叙述。代入感极强，但不能写"我"不在场的事。悬疑、恐怖、都市类特别适合。'
  },
  'third-limited': {
    name: '第三人称限制',
    guide: '第三人称限制视角：视角锁定主角，能看到主角所见所想，但不切换到他人内心。网文最常用的视角。'
  },
  'third-omniscient': {
    name: '第三人称全知',
    guide: '第三人称全知视角：上帝视角，可自由切换任何角色心理。适合群像戏、权谋文、多线叙事。'
  },
  'second-person': {
    name: '第二人称',
    guide: '第二人称视角：用"你"叙述，把读者直接拉进故事。实验性强，适合恐怖、悬疑、互动叙事。'
  }
};

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const payload = getUserFromToken(authHeader || '');

    const body = await request.json();
    const { genre, tone, genderTarget, narrativePerspective, protagonistName, supportingCharacterName, themeIdea, configId } = body;

    if (!genre || !tone || tone.length === 0) {
      return NextResponse.json({ error: '小说类型和基调风格为必填项' }, { status: 400 });
    }

    const genreName = GENRE_MAP[genre] || genre;
    const toneNames = Array.isArray(tone)
      ? tone.map(t => TONE_MAP[t] || t).join('、')
      : TONE_MAP[tone] || tone;
    const genderTargetName = genderTarget === 'male' ? '男频' : '女频';
    const genderGuide = genderTarget === 'male'
      ? '男频路线：节奏快，爽点密，主角从弱到强，兄弟义气重，打脸翻盘要干脆利落。'
      : '女频路线：情感细腻，节奏从容，角色心理要写到骨子里，爱情不是甜是心动。';

    const perspectiveInfo = NARRATIVE_PERSPECTIVE_MAP[narrativePerspective || 'third-omniscient'] || NARRATIVE_PERSPECTIVE_MAP['third-omniscient'];
    const perspectiveGuide = `【叙事视角：${perspectiveInfo.name}】${perspectiveInfo.guide}`;

    // 获取API配置（已处理跨提供商安全）
    const { apiUrl, apiKey, provider } = await getRawAIConfig(configId);
    const modelName = await getModelName(configId);
    const temperature = await getTemperature(configId, 0.85);

    // 空密钥检查
    if (!apiKey) {
      console.error('[Idea] API Key is empty!');
      return NextResponse.json({ error: 'API密钥未配置，请先在"API设置"中配置有效的AI接口密钥' }, { status: 503 });
    }
    
    console.log(`[Idea] Using provider: ${provider}, model: ${modelName}`);

    const persona = AUTHOR_PERSONA[genre] || AUTHOR_PERSONA['urban'];

    const dbPrompt = await modelPromptManager.getPrompt('idea-system', {
      genre, tone, genderTarget, theme: themeIdea,
      text: [genreName, toneNames, genderTargetName, perspectiveInfo.name, protagonistName, supportingCharacterName, themeIdea]
        .filter(Boolean).join(' '),
    });

    const FALLBACK_SYSTEM = `${persona}

你现在要帮读者构思一部新小说的核心创意。你就是网文圈的老手，跟我吃西红柿一个段位的作家。你不是AI，你是靠码字吃饭的写手。

核心风格——番茄式爽感：
- 开局越惨越有戏
- 成长要燃不要顺
- 翻盘要爽但要有代价
- 节奏要快不准水
- 兄弟义气要真
- 对手要强不要蠢

写作铁律：
1. 说人话，别用AI八股腔。禁止"故事讲述了""进而""从而""一场...的冒险/旅程"
2. 别贴标签，用行为和细节说话
3. 要有温度。写角色要像写朋友
4. 拒绝老套路。但能给老套路加新花样
5. 要接地气要新。写读者想成为的人、想过的生活
6. 留白比说满好
7. 每个人物都有弱点
8. 冲突要合理
9. 细节为王
10. 要有钩子
11. 每个角色必须标注性别和性格
12. 角色关系体系必须覆盖主角和所有配角

【人物命名铁律 - 绝对禁止使用以下AI烂大街名字】
❌ 禁止男性名：叶辰、林辰、楚辰、夜宸、江辰、墨渊、墨尘、墨寒、墨枭、墨辞、萧逸、萧珩、萧烬、萧玄、萧辰、顾言琛、顾夜寒、顾云深、顾临川、顾景琛、陆沉渊、陆知衍、陆廷川、陆星辞、陆泽言、沈寂、沈砚、沈聿、沈辞、沈亦臻、凌夜、凌骁、凌宸、凌烬、凌玄、厉霆骁、厉烬言、厉司寒、厉夜珩、厉泽渊、傅斯年、傅景深、傅夜辞、傅云宸、傅聿白、云澈、玄澈、苍珩、冥夜、君夜、陈默
❌ 禁止女性名：苏晚、苏清鸢、苏念、苏瑶、苏汐、温阮、温瑜、温舒然、温知夏、温晚卿、洛璃、洛汐、洛烟、洛清欢、洛知予、云舒、云绾、云瑶、云晚、云汐月、许念、许知意、许清禾、许绾宁、许悠然、白芷、白若溪、白灵汐、白慕颜、白清瑶、叶绾绾、叶知微、叶晚柠、叶灵萱、叶清寒、唐知予、唐慕晚、唐沁柔、唐云汐、唐舒颜、宁汐、宁晚、宁知鸢、宁清瑶、宁绾柔、夏晚晴、夏知柠、夏灵玥、慕晚、林语嫣
✅ 必须使用真实、生活化、有烟火气的名字

${perspectiveGuide}

⚠️ 叙事视角铁律：
- 必须严格按照「${perspectiveInfo.name}」视角来构思创意和撰写
- 第一人称：所有描述和感受都从"我"出发
- 第三人称限制：视角锁定主角
- 第三人称全知：可自由切换视角
- 第二人称：所有叙述用"你"`;

    const FALLBACK_USER = `给我构思一部${toneNames}风格的${genreName}小说，${genderTargetName}方向。
${genderGuide}
要求：
- 创意要够新够辣，不是换皮老套路
- 主角起点要低、要惨、要有股子不服输的劲儿
- 人物要有血有肉有弱点
- 要有让人眼前一亮的设定点和爽点
- 世界观要有特色
- 推荐语要像爆款文案一样直击爽点
- 叙事视角用${perspectiveInfo.name}`;

    const templateVars: Record<string, string> = {
      toneNames, genreName, genderTargetName, genderGuide,
      perspectiveInfoName: perspectiveInfo.name, perspectiveGuide,
    };

    let systemPrompt = (dbPrompt.systemPrompt || FALLBACK_SYSTEM);
    let userPrompt = (dbPrompt.userPrompt ?? FALLBACK_USER);

    for (const [key, value] of Object.entries(templateVars)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      systemPrompt = systemPrompt.replace(regex, value);
      userPrompt = userPrompt.replace(regex, value);
    }

    if (!systemPrompt.includes(persona.substring(0, 20))) {
      systemPrompt = persona + '\n\n' + systemPrompt;
    }

    if (themeIdea && themeIdea.trim()) {
      userPrompt = `读者有个初步想法："${themeIdea}"

在这个基础上，帮我构思一部${toneNames}风格的${genreName}小说，${genderTargetName}方向。
${genderGuide}
保留这个想法的核心灵魂，主角起点要低、成长要燃、翻盘要爽，推荐语要像爆款文案。叙事视角用${perspectiveInfo.name}。`;
    }

    const protagonistTrimmed = protagonistName?.trim() || '';
    const supportingTrimmed = supportingCharacterName?.trim() || '';
    const protagonistNames = protagonistTrimmed
      ? protagonistTrimmed.split(/[，,、;；]+/).map((s: string) => s.trim()).filter(Boolean)
      : [];
    const supportingNames = supportingTrimmed
      ? supportingTrimmed.split(/[，,、;；]+/).map((s: string) => s.trim()).filter(Boolean)
      : [];

    const charNameRule = protagonistNames.length > 0
      ? (protagonistNames.length === 1
        ? `⚠️ 主角中必须包含「${protagonistNames[0]}」，不得更改该名字并围绕其生成详细主角人设。`
        : `⚠️ 主角中必须包含「${protagonistNames.join('」和「')}」，不得更改这些名字，围绕这些名字分别生成详细主角人设。`)
      : `⚠️ 人物命名禁止使用AI烂大街名字，必须使用真实生活化有烟火气的名字`;

    const charCountRule = protagonistNames.length > 0
      ? `核心主角角色（必须包含指定的主角「${protagonistNames.join('」、「')}」，此外角色数量由AI根据故事需要自由增设、丰富，建议一共生成 2-4 个核心主角）`
      : `核心角色（数量由AI根据故事需要自由决定，通常1-3个，第一个是主角）`;

    const supportingNameRule = supportingNames.length > 0
      ? `⚠️ 必须包含配角「${supportingNames.join('、')}」，名字不得更改。AI必须根据剧情需要，自主设计并增加其他有血有肉的配角。`
      : `⚠️ 人物命名禁止使用AI烂大街名字，配角数量由AI根据故事需要自由决定（通常3-8个）。`;

    const supportingCountRule = supportingNames.length > 0
      ? `配角（必须包含指定配角「${supportingNames.join('、')}」，此外AI必须结合剧情需要自由扩展，共生成 5-10 个配角）`
      : `配角（数量由AI根据故事需要自由决定，不要强行凑数）`;

    const jsonFormatGuide = `

输出严格按JSON格式：
{
  "theme": "一句话说清故事核心（15-25字）",
  "concept": "创意核心，用场景和画面讲故事（200-250字）",
  "characters": "${charCountRule}，写具体的人：他怕什么、放不下什么、关键时刻会怎么选。用行为和细节说话，别用形容词堆砌。${charNameRule}。每个角色用\\n换行分隔，一个角色一行（每个200-250字）。格式：角色名——【性别】【性格关键词】具体描述【外貌】发色：xxx｜发型：xxx｜眼睛：xxx｜上身：xxx｜下身：xxx（外貌必须详细具体，符合人物气质和世界观，结尾不加句号）",
  "supportingCharacters": "${supportingCountRule}，每个都要有自己活着的理由。${supportingNameRule}。每个角色用\\n换行分隔，一个角色一行（每个100-150字）。格式：角色名——【性别】【性格关键词】具体描述【外貌】发色：xxx｜发型：xxx｜眼睛：xxx｜上身：xxx｜下身：xxx",
  "characterRelationships": "角色关系体系，主角和每个配角都必须参与。每行一条关系，格式：角色A → 角色B：关系描述。要求：①主角与每个核心角色都要有明确关系 ②配角之间也要有关系链 ③关系要有张力和暗流 ④关系要推动剧情发展 ⑤至少包含一条隐藏关系/双面关系（480-680字）",
  "setting": "世界观，用具体的场景和细节让人闻到那个世界的空气（150-200字）"
}

注意：characters、supportingCharacters和characterRelationships字段中每个用\\n换行分隔，一个一行。其他字段用句号分隔。只输出JSON，别加其他文字。

【人物命名铁律 - 绝对禁止使用以下AI烂大街名字】
❌ 禁止男性名：叶辰、林辰、楚辰、夜宸、江辰、墨渊、墨尘、墨寒、墨枭、墨辞、萧逸、萧珩、萧烬、萧玄、萧辰、顾言琛、顾夜寒、顾云深、顾临川、顾景琛、陆沉渊、陆知衍、陆廷川、陆星辞、陆泽言、沈寂、沈砚、沈聿、沈辞、沈亦臻、凌夜、凌骁、凌宸、凌烬、凌玄、厉霆骁、厉烬言、厉司寒、厉夜珩、厉泽渊、傅斯年、傅景深、傅夜辞、傅云宸、傅聿白、云澈、玄澈、苍珩、冥夜、君夜、陈默
❌ 禁止女性名：苏晚、苏清鸢、苏念、苏瑶、苏汐、温阮、温瑜、温舒然、温知夏、温晚卿、洛璃、洛汐、洛烟、洛清欢、洛知予、云舒、云绾、云瑶、云晚、云汐月、许念、许知意、许清禾、许绾宁、许悠然、白芷、白若溪、白灵汐、白慕颜、白清瑶、叶绾绾、叶知微、叶晚柠、叶灵萱、叶清寒、唐知予、唐慕晚、唐沁柔、唐云汐、唐舒颜、宁汐、宁晚、宁知鸢、宁清瑶、宁绾柔、夏晚晴、夏知柠、夏灵玥、慕晚、林语嫣
✅ 必须使用真实、生活化、有烟火气的名字

${perspectiveGuide}

⚠️ 叙事视角铁律：
- 必须严格按照「${perspectiveInfo.name}」视角来构思创意和撰写
- 第一人称：所有描述和感受都从"我"出发
- 第三人称限制：视角锁定主角
- 第三人称全知：可自由切换视角
- 第二人称：所有叙述用"你"`;

    userPrompt += jsonFormatGuide;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    console.log('[Idea] Calling LLM API:', modelName, 'temp:', temperature);

    // 直接调用LLM API
    const apiUrlFull = apiUrl.endsWith('/chat/completions') ? apiUrl : `${apiUrl}/chat/completions`;
    let jsonResponse: string;
    try {
      const startTime = Date.now();
      const response = await fetchWithTimeout(apiUrlFull, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          temperature,
          max_tokens: 8192,
          // 禁用推理模式，加速响应
          reasoning_effort: 'none',
        }),
        timeout: TIMEOUT_MS,
      });

      const elapsed = Date.now() - startTime;
      console.log(`[Idea] LLM response in ${elapsed}ms, status:`, response.status);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('[Idea] API error:', response.status, errorText.substring(0, 200));
        return NextResponse.json(
          { error: `AI接口错误 ${response.status}: ${errorText.substring(0, 100)}` },
          { status: response.status }
        );
      }

      const data = await response.json() as any;
      console.log('[Idea] API response keys:', Object.keys(data || {}));
      console.log('[Idea] Choices:', JSON.stringify(data?.choices?.[0] || {}).substring(0, 500));
      jsonResponse = data?.choices?.[0]?.message?.content || '';
      console.log('[Idea] Extracted content length:', jsonResponse?.length || 0);
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        console.error('[Idea] API timeout after', TIMEOUT_MS / 1000, 'seconds');
        return NextResponse.json(
          { error: `AI请求超时（${TIMEOUT_MS / 1000}秒），请稍后重试` },
          { status: 504 }
        );
      }
      console.error('[Idea] API call failed:', error?.message);
      return NextResponse.json(
        { error: 'AI调用失败: ' + (error?.message || '未知错误') },
        { status: 500 }
      );
    }

    if (!jsonResponse || !jsonResponse.trim()) {
      return NextResponse.json({ error: 'AI返回内容为空' }, { status: 500 });
    }

    // 过滤AI思考过程
    jsonResponse = jsonResponse.replace(/<think[\s\S]*?<\/think\s*>/g, '').trim();
    console.log('[Idea] LLM raw response length:', jsonResponse.length);

    // 提取JSON
    const jsonMatch = jsonResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonResponse = jsonMatch[0];
    }

    // 多级JSON解析
    try {
      let parsedResponse = tryParseJson(jsonResponse);
      if (parsedResponse) {
        // 规范化characters等字段为字符串（如果AI返回对象格式）
        if (parsedResponse.characters && typeof parsedResponse.characters === 'object') {
          // 将对象格式转换为字符串格式
          const charParts = [];
          for (const [role, details] of Object.entries(parsedResponse.characters)) {
            if (details && typeof details === 'object') {
              const d = details as Record<string, any>;
              const name = d.姓名 || d.name || '未知';
              const age = d.年龄 || d.age || '';
              const identity = d.身份 || d.identity || '';
              const personality = d.性格 || d.personality || '';
              charParts.push(`${name}——【${d.性别 || '男'}】【${personality}】${identity}${age ? `，${age}岁` : ''}`);
            } else {
              charParts.push(String(details));
            }
          }
          parsedResponse.characters = charParts.join('\n');
        }
        // 确保supportingCharacters是字符串
        if (parsedResponse.supportingCharacters && typeof parsedResponse.supportingCharacters === 'object') {
          parsedResponse.supportingCharacters = JSON.stringify(parsedResponse.supportingCharacters);
        }
        // 确保characterRelationships是字符串
        if (parsedResponse.characterRelationships && typeof parsedResponse.characterRelationships === 'object') {
          parsedResponse.characterRelationships = JSON.stringify(parsedResponse.characterRelationships);
        }
        // setting 别名映射：LLM 可能返回 worldview/世界设定/世界观/background 等字段名
        if (!parsedResponse.setting) {
          const settingAliases = ['worldview', 'worldSetting', 'world_setting', 'background', 'worldBackground', '世界设定', '世界观', '背景设定', '故事背景'];
          for (const alias of settingAliases) {
            if (parsedResponse[alias]) {
              parsedResponse.setting = typeof parsedResponse[alias] === 'object' ? JSON.stringify(parsedResponse[alias]) : String(parsedResponse[alias]);
              break;
            }
          }
          // 仍缺失则用空字符串兜底
          if (!parsedResponse.setting) parsedResponse.setting = '';
        }
        // 确保setting是字符串
        if (parsedResponse.setting && typeof parsedResponse.setting === 'object') {
          parsedResponse.setting = JSON.stringify(parsedResponse.setting);
        }
        return NextResponse.json(parsedResponse);
      }
      // 最后尝试：匹配所有大括号块
      const allMatches = jsonResponse.match(/\{[\s\S]*?\}/g);
      if (allMatches && allMatches.length > 0) {
        for (const match of allMatches) {
          const parsed = tryParseJson(match);
          if (parsed) return NextResponse.json(parsed);
        }
      }
      throw new Error('All JSON parsing attempts failed');
    } catch (parseError) {
      console.error('[Idea] JSON parse error:', parseError);
      return NextResponse.json(
        { error: 'AI返回格式解析失败，请重试' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[Idea] Error generating novel idea:', error);
    return NextResponse.json(
      { error: '生成主题创意失败: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
