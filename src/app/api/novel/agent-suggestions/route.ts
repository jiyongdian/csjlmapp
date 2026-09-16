import { NextRequest, NextResponse } from 'next/server';
import { getRawAIConfig, getModelName, getTemperature } from '@/lib/ai-config';
import {
  HOT_GENRES,
  OPENING_HOOKS,
  CHARACTER_ARCHETYPES,
  getRecommendedCombos,
} from '@/lib/creative-hub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AI_ASK = 18;        // 让 AI 一次产出的条数
const FB_SIZE = 24;       // 兜底池条数
const AI_TTL_MS = 3 * 60 * 1000;
const AI_POOL_MAX = 36;

let aiPool: string[] = [];   // AI 分析热门短剧产出的池
let fbPool: string[] = [];   // 热门题材兜底池（即时可用）
let aiPoolAt = 0;
let aiBuilding = false;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function sample<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

// 从「热门短剧」知识库抽取一份随机趋势快照，作为 AI 分析依据
function buildTrendContext() {
  const genres = sample(HOT_GENRES, 4).map((g) => ({
    name: g.name,
    emotions: g.coreEmotions,
    plot: g.typicalPlot,
    elements: g.goldenElements.slice(0, 3),
    innovation: g.microInnovationIdeas.slice(0, 2),
  }));
  const archetypes = sample(CHARACTER_ARCHETYPES, 4).map((a) => ({ name: a.name, tagline: a.tagline }));
  const hooks = sample(
    OPENING_HOOKS.flatMap((h) => h.formulas.map((f) => f.example)),
    5
  );
  const combos = sample(getRecommendedCombos(), 3).map((c) => ({
    title: c.title,
    pitch: c.oneLinePitch,
    gap: c.marketGap,
    innovation: c.microInnovation,
  }));
  return { genres, archetypes, hooks, combos };
}

// 兜底池：用「热门短剧题材 + 主角弧光」随机组合，保证即时可用且每次不同
function buildFallbackPool(): string[] {
  const chaptersPool = [20, 30, 40, 50, 60, 80, 100];
  const roleTemplates = [
    '主角从普通职员逆袭成行业大佬',
    '主角从被抛弃的弃女翻身成商业女王',
    '主角从废物赘婿变成家族掌权人',
    '主角从乡野郎中成长为一代神医',
    '主角从幸存者变成末世基地领袖',
    '主角从杂役弟子修成一代仙尊',
    '主角从底层庶女登顶当家主母',
    '主角从卑微暗恋走到双向奔赴',
    '主角从实习警员成长为传奇神探',
    '主角从废柴少年觉醒成天道之主',
    '主角从落魄千金重回豪门巅峰',
    '主角从外卖小哥做到上市公司老板',
  ];
  const out: string[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (out.length < FB_SIZE && guard++ < 500) {
    const g = HOT_GENRES[Math.floor(Math.random() * HOT_GENRES.length)];
    const role = roleTemplates[Math.floor(Math.random() * roleTemplates.length)];
    const ch = chaptersPool[Math.floor(Math.random() * chaptersPool.length)];
    const text = '生成一部' + ch + '章小说：' + g.name + '，' + role;
    if (used.has(text)) continue;
    used.add(text);
    out.push(text);
  }
  return out;
}

// 让 AI 基于「热门短剧趋势」产出可直接执行的写小说指令
async function buildAiPool(): Promise<string[] | null> {
  try {
    const { apiUrl, apiKey } = await getRawAIConfig();
    if (!apiKey) return null;
    const modelName = await getModelName();
    const temperature = await getTemperature(undefined, 1.0);
    const ctx = buildTrendContext();

    const system = '你是短剧与网文的爆款策划。基于给定的「热门短剧趋势数据」，产出可直接让 AI 写作助手执行的「写小说」指令。只输出纯 JSON，不要任何多余文字。';

    const user = '【热门短剧趋势数据】\n' + JSON.stringify(ctx) + '\n\n' +
      '请产出 ' + AI_ASK + ' 条彼此完全不同的「写小说」指令，每条必须严格符合格式：\n' +
      '生成一部{N}章小说：{题材或套路}，{主角}从{A}到{B}\n' +
      '要求：\n' +
      '- 必须以「生成一部N章小说：」开头，前缀照抄不要省略\n' +
      '- N 取 20/30/40/50/60/80/100 之一，写在前缀里\n' +
      '- 前缀之后接：{题材或套路}，{主角}从{A}到{B}，整条 15~40 字\n' +
      '- 示例：生成一部20章小说：都市逆袭，主角从职员到行业大佬\n' +
      '- 中文、口语化、有爆点，不要书名号与引号\n' +
      '- 紧扣上面的热门题材、情绪点与人设，避免重复与烂大街\n' +
      '- 只输出 JSON：{"suggestions":["...","..."]}';

    const { callLLMApi } = await import('@/lib/api-helpers');
    const result = await callLLMApi(apiUrl, apiKey, modelName, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { temperature, maxTokens: 1400, timeout: 30000, maxRetries: 1 });

    if (!result.success) {
      console.warn('[AgentSuggestions] AI 调用失败:', result.error);
      return null;
    }
    const text = String(result.content || '').replace(/<think[\s\S]*?<\/think\s*>/g, '');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const list = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    const cleaned = list
      .map((s: unknown) => String(s || '').trim())
      .filter((s: string) => s.length >= 6 && s.length <= 80);
    return cleaned.length >= 6 ? Array.from(new Set(cleaned)) : null;
  } catch (e) {
    console.warn('[AgentSuggestions] AI 生成异常，保留兜底池:', e);
    return null;
  }
}

// 后台异步刷新 AI 池（不阻塞请求）
function maybeBuildAi(force: boolean) {
  const now = Date.now();
  const stale = force || aiPoolAt === 0 || (now - aiPoolAt) > AI_TTL_MS;
  if (aiBuilding || !stale) return;
  aiBuilding = true;
  void buildAiPool()
    .then((ai) => {
      if (ai && ai.length) aiPool = Array.from(new Set(ai.concat(aiPool))).slice(0, AI_POOL_MAX);
      aiPoolAt = Date.now();
    })
    .catch(() => { aiPoolAt = Date.now(); })
    .finally(() => { aiBuilding = false; });
}

/**
 * GET /api/novel/agent-suggestions?count=6&fresh=1
 * 立即返回「热门短剧」风格的写小说指令（随机取子集 → 每次都不一样）。
 * 优先返回 AI 分析热门短剧趋势生成的池；AI 未就绪时用兜底池，后台异步升级。
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let count = parseInt(searchParams.get('count') || '6', 10);
    if (!Number.isFinite(count)) count = 6;
    count = Math.min(Math.max(count, 1), 12);

    maybeBuildAi(searchParams.get('fresh') === '1');
    if (fbPool.length === 0) fbPool = buildFallbackPool();

    const source = aiPool.length >= count ? aiPool : aiPool.concat(fbPool);
    return NextResponse.json({ success: true, data: shuffle(source).slice(0, count) });
  } catch (e) {
    console.warn('[AgentSuggestions] 兜底返回:', e);
    return NextResponse.json({ success: true, data: buildFallbackPool().slice(0, 6) });
  }
}
