import { formatChapterTitle } from '@/lib/chapter-title';
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

type ShortStoryResult = {
  emotion: string;
  genre: string;
  title: string;
  outline: {
    synopsis: string;
    sections: { index: number; title: string; summary: string; hook: string }[];
  };
  content: string;
  wordCount: number;
  writingStyle: string;
  platform: string;
};

const EMOTION_OPTIONS = [
  { key: 'sad_regret', name: '意难平', scene: '虐恋、遗憾、错过', genres: ['追妻火葬场', '甜宠', '世情打脸'] },
  { key: 'shock_reversal', name: '反转震撼', scene: '悬疑、身份错位、沙雕脑洞', genres: ['悬疑', '沙雕脑洞'] },
  { key: 'satisfying_revenge', name: '爽感释放', scene: '打脸、逆袭、复仇', genres: ['世情打脸', '复仇打脸', '总裁豪门', '宅斗宫斗'] },
  { key: 'healing_warm', name: '治愈温暖', scene: '成长、亲情、友情、救赎', genres: ['甜宠', '双男主'] },
  { key: 'creepy_thought', name: '细思极恐', scene: '悬疑、心理、民俗怪谈', genres: ['悬疑', '民俗怪谈'] },
  { key: 'touched_moved', name: '共鸣感动', scene: '现实、职场、婚姻、家庭', genres: ['世情打脸', '追妻火葬场'] },
];

const GENRE_STYLES: Record<string, string> = {
  '追妻火葬场': `核心：主角被最亲密的人为白月光牺牲，心死后冷静决裂，对方追悔莫及。
腔调：第一人称受害者+双轨切换（受虐段直白宣泄/反击段冷静审判）。
开篇：结果倒序黄金简介150-300字，把背叛+心死+火葬场剧透一次性抛出。
钩子：阶梯式背叛（道德→经济→生命），每节至少一个新背叛升级。
情绪：直白命名+身体反应叠加（心如死灰+指甲扣进掌心）。
对话：狠句金句频出，"呵""我纯粹觉得你比较可笑"式冷刀。`,
  '世情打脸': `核心：现实题材，婆媳/婚姻/职场/家庭中的弱者逆袭打脸。
腔调：第一人称+直白宣泄+冷静反杀双轨。
开篇：生活场景切入（做饭/带娃/加班），直接遭遇不公对待。
钩子：每节一个打脸升级，从忍到不忍，从被动到主动。
情绪：委屈→爆发→爽感三段式推进。
对话：生活化口语，"你凭什么""我今天就让你看看"。`,
  '复仇打脸': `核心：主角被害后隐忍蓄力，最终反杀仇人。
腔调：第一人称+表面顺从暗中布局。
开篇：被害场景直接开场（被推下楼/被诬陷/被夺走一切）。
钩子：隐忍中的小动作暗示反转（攒证据/练身手/联络人脉）。
情绪：仇恨→忍耐→释放。
对话：表面客气暗露锋芒，"多谢你今天所做的一切"。`,
  '总裁豪门': `核心：灰姑娘+霸道总裁，身份悬殊下的爱情博弈。
腔调：第一人称女主视角+代入感强。
开篇：偶然相遇（撞满怀/洒咖啡/误闯会议室），身份反差立钩。
钩子：误会→解开心结→身份揭露→大团圆。
情绪：心动→纠结→甜蜜。
对话：总裁台词霸道宠溺，女主台词倔强可爱。`,
  '宅斗宫斗': `核心：古代深宅/后宫中的权力斗争与生存智慧。
腔调：第一人称+古风文言感+细腻心理描写。
开篇：请安/家宴/进宫觐见，场面即战场。
钩子：每节一个阴谋揭露或反制措施，节奏密集。
情绪：警惕→智斗→胜利。
对话：话里有话，"姐姐说笑了""娘娘谬赞"。`,
  '民俗怪谈': `核心：乡村/民间的诡异故事，民俗禁忌与人性黑暗。
腔调：第一人称亲历+惊悚氛围+心理恐惧。
开篇：乡村场景（老宅/村口/庙会），诡异事件直接发生。
钩子：每节一个新诡异发现，层层递进。
情绪：好奇→恐惧→毛骨悚然。
对话：村民的警告+主角的疑问+无法解释的现象。`,
  '悬疑': `核心：罪案推理，层层揭秘，真相反转。
腔调：第一人称侦探/嫌疑人视角+紧张节奏。
开篇：案发现场或收到匿名线索。
钩子：每节一个新线索或新嫌疑人，真相越来越近又越来越远。
情绪：好奇→紧张→震惊。
对话：推理对话+嫌疑人闪烁其词+关键证人口供。`,
  '甜宠': `核心：双向奔赴的甜蜜爱情，日常撒糖。
腔调：第一人称+轻松甜蜜+生活细节。
开篇：意外邂逅或重遇，心动瞬间。
钩子：每节一个新甜蜜互动，读者嘴角上扬。
情绪：心动→甜蜜→幸福。
对话：撒娇+宠溺+打情骂俏。`,
  '双男主': `核心：两个男人之间的友情/救赎/爱情。
腔调：双视角切换+互补性格+化学反应。
开篇：不打不相识或久别重逢。
钩子：每节一个配合默契或情感升温的节点。
情绪：对立→理解→羁绊。
对话：互怼+关心+默契配合。`,
  '沙雕脑洞': `核心：反套路、无厘头、脑洞大开的喜剧。
腔调：第一人称+吐槽体+网络梗密集。
开篇：荒诞设定直接抛（系统绑定/重生穿书/金手指觉醒）。
钩子：每节一个新脑洞展开，不按常理出牌。
情绪：好奇→爆笑→惊喜。
对话：吐槽+弹幕体+打破第四面墙。`,
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      emotion,
      genre,
      title,
      keywords,
      configId,
      wordCount = 8000,
      platform = '番茄',
    } = body;

    if (!emotion || typeof emotion !== 'string') {
      return NextResponse.json({ error: '请选择情绪目标' }, { status: 400 });
    }
    if (!genre || typeof genre !== 'string') {
      return NextResponse.json({ error: '请选择题材方向' }, { status: 400 });
    }

    const emotionMeta = EMOTION_OPTIONS.find(e => e.key === emotion);
    const emotionName = emotionMeta?.name || emotion;
    const genreStyle = GENRE_STYLES[genre] || `通用短篇写法：情绪宁烈不温，每句话必须有用，开头3句定生死，结尾定传播。`;

    const { apiUrl, apiKey } = await getRawAIConfig(configId);
    const modelName = await getModelName(configId);
    const temperature = await getTemperature(configId, 0.8);

    if (!apiKey) {
      return NextResponse.json({ error: 'API密钥未配置' }, { status: 503 });
    }

    console.log(`[ShortStory] Start: emotion=${emotionName}, genre=${genre}, targetWords=${wordCount}, platform=${platform}`);

    const systemPrompt = buildShortStorySystemPrompt(emotionName, genre, genreStyle);
    const userPrompt = buildShortStoryUserPrompt({
      emotion: emotionName,
      genre,
      title: title || '',
      keywords: keywords || '',
      wordCount,
      platform,
    });

    const apiUrlFull = apiUrl.endsWith('/chat/completions') ? apiUrl : `${apiUrl}/chat/completions`;
    let aiContent = '';
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      try {
        console.log(`[ShortStory] Attempt ${attempt}/${MAX_RETRIES + 1}`);
        const response = await fetchWithTimeout(apiUrlFull, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: Math.min(temperature, 0.9),
            max_tokens: Math.min(16384, Math.floor(wordCount * 2.5)),
            stream: false,
          }),
          timeout: TIMEOUT_MS,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          console.error(`[ShortStory] Attempt ${attempt} API error ${response.status}: ${errText.substring(0, 200)}`);
          lastError = new Error(`API错误 ${response.status}`);
          continue;
        }

        const data = await response.json() as any;
        aiContent = data?.choices?.[0]?.message?.content || '';
        console.log(`[ShortStory] Attempt ${attempt} response length: ${aiContent.length}`);

        if (aiContent && aiContent.trim().length > 50) {
          break;
        }
        lastError = new Error('AI返回内容过短');
      } catch (error: any) {
        lastError = error;
        console.error(`[ShortStory] Attempt ${attempt} failed:`, error?.message || error);
      }

      if (attempt <= MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }

    if (!aiContent || aiContent.trim().length < 50) {
      console.warn('[ShortStory] All attempts failed');
      return NextResponse.json({ error: lastError?.message || '短篇生成失败，请重试' }, { status: 500 });
    }

    const result = parseShortStoryResponse(aiContent, emotionName, genre, platform);
    console.log(`[ShortStory] Complete: title="${result.title}", words=${result.wordCount}`);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[ShortStory] Failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '短篇生成失败' },
      { status: 500 },
    );
  }
}

function buildShortStorySystemPrompt(emotionName: string, genre: string, genreStyle: string): string {
  return `你是一位顶级短篇网文作家。你的任务是创作一篇完整的短篇小说。

## 核心创作原则

1. **情绪为目标**：整篇小说为"${emotionName}"这个情绪服务，所有内容为情绪铺垫
2. **一个反转撑一篇**：所有铺垫为反转服务，所有情绪为反转蓄力。不多线、不铺世界观
3. **每句话必须有用**：不推动剧情、不铺垫反转、不推高情绪的句子→删
4. **开头3句定生死，结尾定传播**：开头必须含钩子，结尾必须有余韵
5. **默认第一人称**：用"我"叙述，代入感最强
6. **情绪宁烈不温**：直白宣泄，不靠克制留白

## 题材专属写法：${genre}

${genreStyle}

## 情绪外化铁律

- 情绪词后面接具体动作或物件（"心如死灰"+"泪水早已模糊了视线"）
- 禁止空飘的情绪总结（"一丝悲伤涌上心头"→替换为具体动作）
- 同一情绪只写一次+接具体动作，不反复解释

## 叙述姿态

- 允许主角主观审判句（"原来我以为的爱只是一场笑话"）
- 允许复仇者剧透钩子（"他们不知道，我已经是西域摄政王"）
- 允许火葬场前瞻预告（"可后来他后悔了"）

## 格式规范

- 第一人称"我"全程主导
- 小节标记：###1. ###2. ###3. ...
- 每节800-2000字（番茄/七猫），古言2000-4000字
- 每节：一个背叛升级/一次态度反转+一句更狠的台词+一条读者新获知信息
- 章尾必留钩，不收束情绪
- 对话口语化，有语气词

## 禁止事项

❌ 大段设定说明文
❌ 空洞抒情无具体动作
❌ 通用生理反应（"指甲掐进掌心"→需要此刻特有的动作）
❌ AI烂大街名字（叶辰/林辰/墨渊/萧逸等）
❌ 章末总结感悟/升华感叹
❌ 弱化副词泛滥（微微/淡淡/缓缓/轻轻每千字≤3个）

## 输出格式 - 严格JSON
返回一个JSON对象：
{
  "title": "小说标题",
  "synopsis": "150-300字黄金简介（结果倒序，含核心事件+情绪+反转钩子）",
  "sections": [
    { "index": 1, "title": "纸条", "summary": "本节摘要", "hook": "本节结尾钩子" }
  ],
  "content": "完整正文（含小节标记###1. ###2. ...）",
  "wordCount": 正文字数
}`;
}

function buildShortStoryUserPrompt(params: {
  emotion: string; genre: string; title: string; keywords: string;
  wordCount: number; platform: string;
}): string {
  const { emotion, genre, title, keywords, wordCount, platform } = params;

  return `【创作参数】
情绪目标：${emotion}
题材：${genre}
${title ? `标题：${title}\n` : ''}${keywords ? `关键词/灵感：${keywords}\n` : ''}
目标字数：${wordCount}
平台：${platform}

【创作要求】
1. 先写150-300字黄金简介（结果倒序，一次性抛出核心事件+情绪类型+反转钩子）
2. 再分节写完整正文，每节800-2000字
3. 每节必须包含：一个新事件推进+一句狠台词+一个钩子
4. 开头3句必须有钩子，3秒抓住读者
5. 结尾必须留余韵或钩子，不让读者轻松放下

现在请创作这篇以"${emotion}"为核心情绪的${genre}短篇小说。直接输出JSON。`;
}

function parseShortStoryResponse(content: string, emotion: string, genre: string, platform: string): ShortStoryResult {
  const fallback: ShortStoryResult = {
    emotion,
    genre,
    title: '未命名短篇',
    outline: { synopsis: '内容生成中，请重试', sections: [] },
    content: '',
    wordCount: 0,
    writingStyle: '默认',
    platform,
  };

  try {
    let jsonText = String(content || '');
    jsonText = jsonText.replace(/<think[\s\S]*?<\/think\s*>/g, '');
    jsonText = jsonText.replace(/<thought[\s\S]*?<\/thought\s*>/g, '');

    // Strip markdown code block markers
    jsonText = jsonText.replace(/^```(?:json)?\s*\n?/i, '');
    jsonText = jsonText.replace(/\n?```\s*$/m, '').trim();

    // Try to find and parse JSON
    let parsed: any = null;

    // Method 1: Direct parse
    try { parsed = JSON.parse(jsonText); } catch (_) { /* skip */ }

    // Method 2: Extract JSON with brace matching, then clean up common issues
    if (!parsed) {
      try {
        const { jsonObj } = extractJsonObject(jsonText);
        if (jsonObj) parsed = jsonObj;
      } catch (_) { /* skip */ }
    }

    // Method 3: Regex field extraction fallback
    if (!parsed || typeof parsed !== 'object') {
      console.warn('[ShortStory] Standard JSON parse failed, using regex extraction');
      parsed = extractFieldsByRegex(jsonText);
    }

    if (!parsed || typeof parsed !== 'object') {
      console.warn('[ShortStory] Could not parse JSON, using raw content');
      const rawContent = String(content || '').replace(/<think[\s\S]*?<\/think\s*>/g, '').replace(/^```(?:json)?\s*\n?/im, '').replace(/\n?```\s*$/m, '').trim();
      return {
        ...fallback,
        title: '未命名短篇',
        content: rawContent,
        wordCount: rawContent.length,
      };
    }

    const content_text = String(parsed.content || '').trim();
    const wordCount = content_text.length;
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections.map((s: any, i: number) => ({
          index: Number(s?.index) || (i + 1),
          title: formatChapterTitle(i + 1, s?.title),
          summary: String(s?.summary || ''),
          hook: String(s?.hook || ''),
        }))
      : [];

    return {
      emotion,
      genre,
      title: String(parsed.title || '未命名短篇'),
      outline: {
        synopsis: String(parsed.synopsis || ''),
        sections,
      },
      content: content_text,
      wordCount,
      writingStyle: genre,
      platform,
    };
  } catch (error) {
    console.warn('[ShortStory] Parse error:', error);
    return fallback;
  }
}

/**
 * 从文本中提取 JSON 对象（大括号匹配 + 清理常见问题）
 */
function extractJsonObject(text: string): { jsonObj: any } {
  const start = text.indexOf('{');
  if (start === -1) return { jsonObj: null };

  // 找到匹配的 }
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) return { jsonObj: null };

  let jsonStr = text.substring(start, end);

  // 清理常见 JSON 问题
  // 1. 移除尾部逗号
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');

  // 2. 修复字符串内未转义的双引号
  // 逐个处理字符串值中的引号
  jsonStr = fixUnescapedQuotes(jsonStr);

  try {
    return { jsonObj: JSON.parse(jsonStr) };
  } catch {
    return { jsonObj: null };
  }
}

/**
 * 修复 JSON 字符串值中未转义的双引号
 */
function fixUnescapedQuotes(json: string): string {
  let result = '';
  let inString = false;
  let escape = false;
  let i = 0;

  while (i < json.length) {
    const ch = json[i];

    if (escape) {
      result += ch;
      escape = false;
      i++;
      continue;
    }

    if (ch === '\\') {
      result += ch;
      escape = true;
      i++;
      continue;
    }

    if (ch === '"') {
      if (inString) {
        // 检查这个引号是否是字符串的结束
        // 如果下一个非空白字符是 , } ] : 或数字/字母的开头，则它是结束引号
        const rest = json.substring(i + 1).trimStart();
        if (rest.length === 0 || /^[,}\]:\s]/.test(rest) || /^[0-9tfn]/.test(rest)) {
          inString = false;
          result += ch;
        } else {
          // 这是字符串内的引号，需要转义
          result += '\\"';
        }
      } else {
        inString = true;
        result += ch;
      }
      i++;
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * 基于正则的字段提取（JSON 解析完全失败时的最后手段）
 */
function extractFieldsByRegex(text: string): any {
  const result: any = {};

  // 提取 title
  const titleMatch = text.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  result.title = titleMatch ? unescapeJsonString(titleMatch[1]) : '';

  // 提取 synopsis
  const synMatch = text.match(/"synopsis"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  result.synopsis = synMatch ? unescapeJsonString(synMatch[1]) : '';

  // 提取 content (大字段，智能追踪引号边界)
  result.content = extractContentField(text);

  // 提取 wordCount
  const wcMatch = text.match(/"wordCount"\s*:\s*(\d+)/);
  result.wordCount = wcMatch ? parseInt(wcMatch[1]) : 0;

  // 提取 sections (简单提取)
  const sections: any[] = [];
  const sectionRegex = /"index"\s*:\s*(\d+)[\s\S]*?"title"\s*:\s*"((?:[^"\\]|\\.)*)"[\s\S]*?"summary"\s*:\s*"((?:[^"\\]|\\.)*)"[\s\S]*?"hook"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let secMatch;
  while ((secMatch = sectionRegex.exec(text)) !== null) {
    sections.push({
      index: parseInt(secMatch[1]),
      title: unescapeJsonString(secMatch[2]),
      summary: unescapeJsonString(secMatch[3]),
      hook: unescapeJsonString(secMatch[4]),
    });
  }
  result.sections = sections;

  return result;
}

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

/**
 * 智能提取 content 字段（处理 AI 返回的各种格式）
 */
function extractContentField(text: string): string {
  // 1. 查找 "content": 关键字位置
  const contentKeyIdx = text.indexOf('"content"');
  if (contentKeyIdx === -1) return '';

  // 从 "content": 之后找到冒号，然后跳过空白找到开头的引号
  const afterKey = text.substring(contentKeyIdx + '"content"'.length);
  const colonIdx = afterKey.indexOf(':');
  if (colonIdx === -1) return '';

  const afterColon = afterKey.substring(colonIdx + 1);
  const trimmed = afterColon.trimStart();

  // 如果以引号开头，追踪引号到结束
  if (trimmed.startsWith('"')) {
    const startPos = afterColon.length - trimmed.length + 1; // 指向引号后第一个字符
    let i = startPos;
    let inStr = true;
    let escaped = false;

    while (i < afterColon.length && inStr) {
      const ch = afterColon[i];
      if (escaped) {
        escaped = false;
        i++;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        i++;
        continue;
      }
      if (ch === '"') {
        // 检查是否真正的字符串结束
        const rest = afterColon.substring(i + 1).trimStart();
        if (rest.length === 0 || /^[,}\]]/.test(rest)) {
          inStr = false;
        } else {
          // 可能是字符串内的未转义引号，跳过
          i++;
          continue;
        }
      }
      i++;
    }

    const raw = afterColon.substring(startPos, i - 1);
    return unescapeJsonString(raw);
  }

  // 2. 可能是 AI 直接输出了 content 值（非标准 JSON）
  // 尝试从 "content": 之后提取直到最后一个 }
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace > contentKeyIdx) {
    const rawContent = text.substring(contentKeyIdx + '"content"'.length, lastBrace);
    // 清理开头的 : 和空白和引号
    const cleaned = rawContent.replace(/^\s*:\s*/, '').trim();
    if (cleaned.startsWith('"')) {
      return unescapeJsonString(cleaned.substring(1, cleaned.length - 1));
    }
    return cleaned.trim();
  }

  return '';
}