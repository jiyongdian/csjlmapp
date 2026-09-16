import { NextRequest, NextResponse } from 'next/server';
import {
  HOT_GENRES,
  OPENING_HOOKS,
  RHYTHM_TEMPLATE_100,
  CHARACTER_ARCHETYPES,
  getRecommendedCombos,
  type HotGenre,
  type OpeningHook,
  type RhythmPhase,
  type CharacterArchetype,
  type CreativeCombo,
} from '@/lib/creative-hub';

/**
 * Creative Hub API · 创意灵感中心后端
 * ===========================================================
 *  GET  /api/creative-hub
 *    ?section=genres|hooks|rhythm|archetypes|combos|all
 *    &q=搜索关键词 &limit=返回数量
 *    热门趋势知识库检索
 *
 *  POST /api/creative-hub/score   市场热度评分（4维度+建议）
 *  POST /api/creative-hub/match   关键词匹配热门题材+创意组合
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cors(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}

function fuzzySearchItems<
  T extends { id: string; name: string; aliases?: string[]; goldenElements?: string[]; coreTraits?: string[] }
>(items: T[], q: string, topK = 5): Array<T & { _score: number }> {
  if (!q) return items.map((i) => ({ ...i, _score: 50 })).slice(0, topK);
  const needle = q.toLowerCase();
  const scored = items
    .map((it) => {
      let s = 0;
      if (it.name.toLowerCase().includes(needle)) s += 50;
      (it.aliases || []).forEach((a) => {
        if (a.toLowerCase().includes(needle)) s += 15;
      });
      (it.goldenElements || []).forEach((e) => {
        if (e.toLowerCase().includes(needle)) s += 8;
      });
      (it.coreTraits || []).forEach((c) => {
        if (c.toLowerCase().includes(needle)) s += 10;
      });
      return { ...(it as any), _score: s };
    })
    .filter((x: any) => x._score > 0);
  scored.sort((a: any, b: any) => b._score - a._score);
  return scored.slice(0, topK);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const section = (searchParams.get('section') || 'all') as
    | 'genres'
    | 'hooks'
    | 'rhythm'
    | 'archetypes'
    | 'combos'
    | 'all';
  const q = searchParams.get('q') || '';
  const limit = parseInt(searchParams.get('limit') || '12', 10);

  const payload: Record<string, any> = {};

  if (section === 'genres' || section === 'all') {
    let genres: (HotGenre & { _score?: number })[] = [...HOT_GENRES];
    if (q) genres = fuzzySearchItems(HOT_GENRES as any, q, limit);
    genres.sort((a, b) => ((b as any)._score ?? b.heatValue) - ((a as any)._score ?? a.heatValue));
    payload.genres = genres;
  }

  if (section === 'hooks' || section === 'all') {
    let hooks: (OpeningHook & { _score?: number })[] = [...OPENING_HOOKS];
    if (q) {
      const flattened = OPENING_HOOKS.flatMap((h) =>
        h.formulas.map((f) => ({ h, hay: `${h.categoryName} ${h.psychology} ${f.template} ${f.example}` }))
      );
      const hit = flattened
        .filter((x) => x.hay.toLowerCase().includes(q.toLowerCase()))
        .slice(0, limit)
        .map((x) => x.h.id);
      hooks = OPENING_HOOKS.filter((h) => hit.includes(h.id));
    }
    payload.hooks = hooks;
  }

  if (section === 'rhythm' || section === 'all') {
    payload.rhythm = RHYTHM_TEMPLATE_100 as RhythmPhase[];
  }

  if (section === 'archetypes' || section === 'all') {
    let archetypes: (CharacterArchetype & { _score?: number })[] = [...CHARACTER_ARCHETYPES];
    if (q) archetypes = fuzzySearchItems(CHARACTER_ARCHETYPES as any, q, limit);
    archetypes.sort((a, b) => ((b as any)._score ?? b.popIndex) - ((a as any)._score ?? a.popIndex));
    payload.archetypes = archetypes;
  }

  if (section === 'combos' || section === 'all') {
    let combos: CreativeCombo[] = getRecommendedCombos();
    if (q) {
      combos = combos.filter((c) => JSON.stringify(c).toLowerCase().includes(q.toLowerCase()));
    }
    combos.sort((a, b) => b.hotnessEstimate - a.hotnessEstimate);
    payload.combos = combos.slice(0, limit);
  }

  payload._meta = {
    generatedAt: new Date().toISOString(),
    dataSource: [
      '红果短剧热播总榜 TOP10 (2026.08)',
      '抖音集团端原生 AI短剧播放增量 TOP50 (DataEye 2026.06)',
      '今日头条 2025-2026 顶流微短剧 TOP5 盘点',
      '澎湃新闻 DataEye 上万部短剧数据分析报告',
      '剧短短 付费卡点与投流点黄金法则白皮书',
    ],
    totalGenres: HOT_GENRES.length,
    totalHookFormulas: OPENING_HOOKS.reduce((n, h) => n + h.formulas.length, 0),
    totalArchetypes: CHARACTER_ARCHETYPES.length,
    totalCombos: getRecommendedCombos().length,
  };

  return cors(NextResponse.json({ ok: true, ...payload }));
}

export async function POST(_req: NextRequest) {
  return cors(
    NextResponse.json(
      {
        ok: false,
        error:
          '主路由只接受 GET 请求（知识库检索）。\n请使用独立子路由：\n· POST /api/creative-hub/score （市场热度评分）\n· POST /api/creative-hub/match （题材匹配+创意组合）',
      },
      { status: 405 }
    )
  );
}
