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

type OpenBookResult = {
  title: string;
  genre: string;
  emotionCore: string;
  coreSetup: {
    worldBuilding: string;
    powerSystem: string;
    protagonist: { name: string; archetype: string; motivation: string; flaw: string };
    characters: { name: string; role: string; archetype: string; relationship: string }[];
    forces: { name: string; type: string; description: string }[];
    goldenFinger: string;
    endingPlan: string;
  };
  volumeOutline: {
    totalVolumes: number;
    volumes: { index: number; title: string; summary: string; keyEvents: string[]; emotionArc: string }[];
  };
  chapterDetails: {
    totalChapters: number;
    chapters: { index: number; title: string; positioning: string; event: string; hook: string; emotionalBeat: string }[];
  };
  readerContract: {
    corePromise: string;
    payoffType: string;
    escalationPath: string;
  };
  summary: string;
};

const GENRE_EMOTIONS: Record<string, { core: string; arcs: string[]; payoffs: string[] }> = {
  '打脸逆袭': { core: '爽感释放', arcs: ['被欺压→反打脸', '低谷→爆发', '隐忍→亮剑'], payoffs: ['当众打脸', '身份揭露', '权势碾压'] },
  '身份反转': { core: '震撼+痛快', arcs: ['假身份→真身份', '弱者→大佬', '被轻视→被仰望'], payoffs: ['身份揭露', '实力碾压', '打脸全场'] },
  '感情拉扯': { core: '意难平', arcs: ['误会→和解', '伤害→救赎', '分离→重聚'], payoffs: ['双向奔赴', '破镜重圆', '虐后甜蜜'] },
  '升级打怪': { core: '期待感', arcs: ['弱→强', '凡人→超凡', '入门→巅峰'], payoffs: ['突破境界', '越级挑战', '登顶之路'] },
  '悬疑惊悚': { core: '紧张+好奇', arcs: ['谜团→线索', '线索→真相', '真相→反转'], payoffs: ['真凶揭露', '动机曝光', '意外反转'] },
  '日常装逼': { core: '期待感', arcs: ['隐藏→暴露', '低调→高调', '幕后→台前'], payoffs: ['实力展示', '身份曝光', '追随者众'] },
  '种田经营': { core: '成就感', arcs: ['一无所有→小有成就', '小规模→大产业', '个人→团队'], payoffs: ['产业扩张', '人才归附', '成功表彰'] },
  '竞技热血': { core: '燃+爽', arcs: ['弱队→强队', '新人→冠军', '失败→胜利'], payoffs: ['夺冠时刻', '绝招制胜', '队友认可'] },
  '虐恋救赎': { core: '意难平+治愈', arcs: ['伤害→救赎', '误解→真心', '分离→团圆'], payoffs: ['真心告白', '冰释前嫌', '携手余生'] },
  '沙雕搞笑': { core: '爆笑+解压', arcs: ['日常→奇遇', '平凡→非凡', '普通人→天选之子'], payoffs: ['爆笑场面', '意外收获', '皆大欢喜'] },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      genre,
      direction,
      configId,
      chapterCount = 30,
      volumeCount,
      keywords,
    } = body;

    if (!genre || typeof genre !== 'string') {
      return NextResponse.json({ error: '请选择题材方向' }, { status: 400 });
    }

    const genreMeta = GENRE_EMOTIONS[genre];
    const emotionCore = genreMeta?.core || '爽感释放';

    const { apiUrl, apiKey } = await getRawAIConfig(configId);
    const modelName = await getModelName(configId);
    const temperature = await getTemperature(configId, 0.7);

    if (!apiKey) {
      return NextResponse.json({ error: 'API密钥未配置' }, { status: 503 });
    }

    console.log(`[OpenBook] Start: genre=${genre}, title=${title || '未命名'}, chapters=${chapterCount}`);

    const systemPrompt = buildOpenBookSystemPrompt(genre, emotionCore, chapterCount);
    const userPrompt = buildOpenBookUserPrompt({
      title: title || '未命名',
      genre,
      direction: direction || '',
      emotionCore,
      chapterCount,
      volumeCount,
      keywords: keywords || '',
      genreMeta: genreMeta || { core: emotionCore, arcs: [], payoffs: [] },
    });

    const apiUrlFull = apiUrl.endsWith('/chat/completions') ? apiUrl : `${apiUrl}/chat/completions`;
    let aiContent = '';
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      try {
        console.log(`[OpenBook] Attempt ${attempt}/${MAX_RETRIES + 1}`);
        const response = await fetchWithTimeout(apiUrlFull, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: Math.min(temperature, 0.8),
            max_tokens: Math.min(16384, chapterCount * 400 + 2000),
            stream: false,
          }),
          timeout: TIMEOUT_MS,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          console.error(`[OpenBook] Attempt ${attempt} API error ${response.status}: ${errText.substring(0, 200)}`);
          lastError = new Error(`API错误 ${response.status}`);
          continue;
        }

        const data = await response.json() as any;
        aiContent = data?.choices?.[0]?.message?.content || '';
        console.log(`[OpenBook] Attempt ${attempt} response length: ${aiContent.length}`);

        if (aiContent && aiContent.trim().length > 100) {
          break;
        }
        lastError = new Error('AI返回内容过短');
      } catch (error: any) {
        lastError = error;
        console.error(`[OpenBook] Attempt ${attempt} failed:`, error?.message || error);
      }

      if (attempt <= MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }

    if (!aiContent || aiContent.trim().length < 100) {
      console.warn('[OpenBook] All attempts failed');
      return NextResponse.json({ error: lastError?.message || '开书失败，请重试' }, { status: 500 });
    }

    const result = parseOpenBookResponse(aiContent, { genre, emotionCore, chapterCount, title: title || '未命名' });
    console.log(`[OpenBook] Complete: title="${result.title}", chapters=${result.chapterDetails.chapters.length}`);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[OpenBook] Failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '开书失败' },
      { status: 500 },
    );
  }
}

function buildOpenBookSystemPrompt(genre: string, emotionCore: string, chapterCount: number): string {
  return `你是一位顶级网文策划编辑。你的任务是为一部长篇网络小说做"一键开书"——一次性产出完整的核心设定、卷纲和章节细纲。

## 核心原则

1. **情绪为核心**：全书围绕"${emotionCore}"这个核心情绪设计
2. **读者契约**：开篇承诺必须兑现，不得破坏
3. **模块组装**：用验证过的剧情模式组装，不重新发明
4. **可续性**：设定必须支撑至少${chapterCount}章，不写无可写

## 题材专属设计：${genre}

## 输出内容（必须完整）

### 1. 核心设定
- 世界观/背景
- 力量体系/金手指
- 主角设定（名字、原型、动机、缺陷）
- 核心配角（名字、角色、原型、关系）
- 主要势力/组织
- 终局底牌/升级台阶（防写无可写）

### 2. 卷级大纲
- 分${Math.ceil(chapterCount / 10)}卷，每卷有独立主题
- 每卷：标题、摘要、关键事件、情绪弧线

### 3. 章节细纲（前${Math.min(chapterCount, 30)}章）
- 每章：标题、定位、事件、钩子、情绪节拍
- 每章必须推进：一个新事件+一个钩子+情绪推进

### 4. 读者契约
- 核心承诺（读者为什么要看这本书）
- 兑现方式
- 升级路径（如何越看越爽）

## 写作红线
- 开篇3章必须抓住读者（钩子/冲突/金手指展示）
- 每5章一个小高潮
- 每10章一个大高潮
- 不写无意义的水字数章节
- 人物行为必须符合设定

## 输出格式 - 严格JSON
返回一个JSON对象，包含完整的开书设定：
{
  "title": "小说标题",
  "genre": "题材",
  "emotionCore": "核心情绪",
  "coreSetup": {
    "worldBuilding": "世界观",
    "powerSystem": "力量体系",
    "protagonist": { "name": "", "archetype": "", "motivation": "", "flaw": "" },
    "characters": [{ "name": "", "role": "", "archetype": "", "relationship": "" }],
    "forces": [{ "name": "", "type": "", "description": "" }],
    "goldenFinger": "金手指",
    "endingPlan": "结局规划"
  },
  "volumeOutline": {
    "totalVolumes": 3,
    "volumes": [{ "index": 1, "title": "", "summary": "", "keyEvents": [""], "emotionArc": "" }]
  },
  "chapterDetails": {
    "totalChapters": 30,
    "chapters": [{ "index": 1, "title": "", "positioning": "", "event": "", "hook": "", "emotionalBeat": "" }]
  },
  "readerContract": {
    "corePromise": "核心承诺",
    "payoffType": "兑现方式",
    "escalationPath": "升级路径"
  },
  "summary": "全书简介"
}`;
}

function buildOpenBookUserPrompt(params: {
  title: string; genre: string; direction: string; emotionCore: string;
  chapterCount: number; volumeCount?: number; keywords: string;
  genreMeta: { core: string; arcs: string[]; payoffs: string[] };
}): string {
  const { title, genre, direction, emotionCore, chapterCount, volumeCount, keywords, genreMeta } = params;

  return `【开书参数】
书名：${title}
题材：${genre}
核心情绪：${emotionCore}
方向说明：${direction || '无'}
关键词/灵感：${keywords || '无'}
规划章节：${chapterCount}${volumeCount ? '，分' + volumeCount + '卷' : ''}

【题材情绪曲线】
情绪核心：${genreMeta.core}
情绪弧线：${genreMeta.arcs.join(' → ')}
兑现方式：${genreMeta.payoffs.join('、')}

【要求】
1. 生成完整的核心设定（世界观+力量体系+主角+配角+势力）
2. 生成${Math.ceil(chapterCount / 10)}卷大纲
3. 生成前${Math.min(chapterCount, 30)}章细纲（每章含标题、事件、钩子）
4. 确保每章都有推进和钩子
5. 金手指/升级体系必须可持续${chapterCount}章以上

直接输出JSON。`;
}

function parseOpenBookResponse(content: string, meta: { genre: string; emotionCore: string; chapterCount: number; title: string }): OpenBookResult {
  const fallback: OpenBookResult = {
    title: meta.title,
    genre: meta.genre,
    emotionCore: meta.emotionCore,
    coreSetup: {
      worldBuilding: 'AI开书服务繁忙',
      powerSystem: '',
      protagonist: { name: '', archetype: '', motivation: '', flaw: '' },
      characters: [],
      forces: [],
      goldenFinger: '',
      endingPlan: '',
    },
    volumeOutline: { totalVolumes: 1, volumes: [] },
    chapterDetails: { totalChapters: meta.chapterCount, chapters: [] },
    readerContract: { corePromise: '', payoffType: '', escalationPath: '' },
    summary: '开书服务繁忙，请重试',
  };

  try {
    let jsonText = String(content || '');
    jsonText = jsonText.replace(/<think[\s\S]*?<\/think\s*>/g, '');
    jsonText = jsonText.replace(/<thought[\s\S]*?<\/thought\s*>/g, '');
    jsonText = jsonText.replace(/^```(?:json)?\s*\n?/i, '');
    jsonText = jsonText.replace(/\n?```\s*$/m, '').trim();

    let parsed: any = null;

    // Method 1: Direct parse
    try { parsed = JSON.parse(jsonText); } catch (_) { /* skip */ }

    // Method 2: Brace-matched extraction
    if (!parsed) {
      try {
        const start = jsonText.indexOf('{');
        if (start >= 0) {
          let depth = 0;
          let end = -1;
          for (let i = start; i < jsonText.length; i++) {
            if (jsonText[i] === '{') depth++;
            if (jsonText[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
          }
          if (end > start) {
            const candidate = jsonText.substring(start, end).replace(/,\s*([}\]])/g, '$1');
            parsed = JSON.parse(candidate);
          }
        }
      } catch (_) { /* skip */ }
    }

    // Method 3: Regex extraction
    if (!parsed) {
      const match = jsonText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1'));
        } catch (_) { /* skip */ }
      }
    }

    // Method 4: Field-level regex extraction (fallback)
    if (!parsed || typeof parsed !== 'object') {
      console.warn('[OpenBook] Standard JSON parse failed, using field extraction');
      parsed = extractOpenBookFields(jsonText);
    }

    if (!parsed || typeof parsed !== 'object') {
      console.warn('[OpenBook] Could not parse JSON, using fallback');
      return fallback;
    }

    return {
      title: String(parsed.title || meta.title),
      genre: meta.genre,
      emotionCore: String(parsed.emotionCore || meta.emotionCore),
      coreSetup: {
        worldBuilding: String(parsed.coreSetup?.worldBuilding || ''),
        powerSystem: String(parsed.coreSetup?.powerSystem || ''),
        protagonist: {
          name: String(parsed.coreSetup?.protagonist?.name || ''),
          archetype: String(parsed.coreSetup?.protagonist?.archetype || ''),
          motivation: String(parsed.coreSetup?.protagonist?.motivation || ''),
          flaw: String(parsed.coreSetup?.protagonist?.flaw || ''),
        },
        characters: Array.isArray(parsed.coreSetup?.characters)
          ? parsed.coreSetup.characters.map((c: any) => ({
              name: String(c?.name || ''),
              role: String(c?.role || ''),
              archetype: String(c?.archetype || ''),
              relationship: String(c?.relationship || ''),
            }))
          : [],
        forces: Array.isArray(parsed.coreSetup?.forces)
          ? parsed.coreSetup.forces.map((f: any) => ({
              name: String(f?.name || ''),
              type: String(f?.type || ''),
              description: String(f?.description || ''),
            }))
          : [],
        goldenFinger: String(parsed.coreSetup?.goldenFinger || ''),
        endingPlan: String(parsed.coreSetup?.endingPlan || ''),
      },
      volumeOutline: {
        totalVolumes: Number(parsed.volumeOutline?.totalVolumes) || 1,
        volumes: Array.isArray(parsed.volumeOutline?.volumes)
          ? parsed.volumeOutline.volumes.map((v: any) => ({
              index: Number(v?.index) || 0,
              title: String(v?.title || ''),
              summary: String(v?.summary || ''),
              keyEvents: Array.isArray(v?.keyEvents) ? v.keyEvents.map(String) : [],
              emotionArc: String(v?.emotionArc || ''),
            }))
          : [],
      },
      chapterDetails: {
        totalChapters: Number(parsed.chapterDetails?.totalChapters) || meta.chapterCount,
        chapters: Array.isArray(parsed.chapterDetails?.chapters)
          ? parsed.chapterDetails.chapters.map((ch: any) => ({
              index: Number(ch?.index) || 0,
              title: String(ch?.title || ''),
              positioning: String(ch?.positioning || ''),
              event: String(ch?.event || ''),
              hook: String(ch?.hook || ''),
              emotionalBeat: String(ch?.emotionalBeat || ''),
            }))
          : [],
      },
      readerContract: {
        corePromise: String(parsed.readerContract?.corePromise || ''),
        payoffType: String(parsed.readerContract?.payoffType || ''),
        escalationPath: String(parsed.readerContract?.escalationPath || ''),
      },
      summary: String(parsed.summary || ''),
    };
  } catch (error) {
    console.warn('[OpenBook] Parse error:', error);
    return fallback;
  }
}

/**
 * 字段级正则提取（JSON解析完全失败时的最后手段）
 */
function extractOpenBookFields(text: string): any {
  const result: any = {};

  // 基础字段
  result.title = extractString(text, 'title') || '未命名';
  result.emotionCore = extractString(text, 'emotionCore') || '';

  // coreSetup
  const worldBuilding = extractString(text, 'worldBuilding');
  const powerSystem = extractString(text, 'powerSystem');
  const goldenFinger = extractString(text, 'goldenFinger');
  const endingPlan = extractString(text, 'endingPlan');
  const protName = extractString(text, 'protagonist_name') || extractNestedString(text, 'protagonist', 'name');
  const protArchetype = extractNestedString(text, 'protagonist', 'archetype');
  const protMotivation = extractNestedString(text, 'protagonist', 'motivation');

  result.coreSetup = {
    worldBuilding,
    powerSystem,
    protagonist: {
      name: protName,
      archetype: protArchetype,
      motivation: protMotivation,
      flaw: extractNestedString(text, 'protagonist', 'flaw'),
    },
    characters: [],
    forces: [],
    goldenFinger,
    endingPlan,
  };

  // volumeOutline
  result.volumeOutline = {
    totalVolumes: 1,
    volumes: [],
  };

  // chapterDetails
  result.chapterDetails = {
    totalChapters: 15,
    chapters: [],
  };

  // readerContract
  result.readerContract = {
    corePromise: extractNestedString(text, 'readerContract', 'corePromise'),
    payoffType: extractNestedString(text, 'readerContract', 'payoffType'),
    escalationPath: extractNestedString(text, 'readerContract', 'escalationPath'),
  };

  result.summary = extractString(text, 'summary');

  return result;
}

function extractString(text: string, key: string): string {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const m = text.match(re);
  return m ? unescapeStr(m[1]) : '';
}

function extractNestedString(text: string, parentKey: string, childKey: string): string {
  // Try to find "parentKey" block and then extract child
  const parentIdx = text.indexOf(`"${parentKey}"`);
  if (parentIdx < 0) return '';
  const after = text.substring(parentIdx, parentIdx + 2000);
  const re = new RegExp(`"${childKey}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const m = after.match(re);
  return m ? unescapeStr(m[1]) : '';
}

function unescapeStr(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
}