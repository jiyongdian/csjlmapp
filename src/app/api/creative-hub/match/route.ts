import { NextRequest, NextResponse } from 'next/server';
import { HOT_GENRES, getRecommendedCombos } from '@/lib/creative-hub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/creative-hub/match
 * 根据文本关键词匹配热门题材 & 创意组合推荐。
 * 用于：用户把自己的小说/想法输入 → 系统告诉他"你这个点子最接近哪个爆款赛道"
 *       + "最接近的爆款创意组合是哪几个"
 *
 * body: { text: string; topK?: number; }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, topK = 3 } = body;

    if (typeof text !== 'string' || text.trim().length < 2) {
      return NextResponse.json({ ok: false, error: '缺少 text 字段或内容过短' }, { status: 400 });
    }
    const t = text.toLowerCase();

    // 1) 题材打分匹配
    const scored = HOT_GENRES.map((g) => {
      let score = 0;
      if (t.includes(g.name.toLowerCase())) score += 20;
      g.aliases.forEach((a) => { if (t.includes(a.toLowerCase())) score += 7; });
      g.goldenElements.forEach((e) => { if (t.includes(e.slice(0, 6).toLowerCase())) score += 6; });
      return { genre: g, score };
    }).sort((a, b) => b.score - a.score);

    const topGenres = scored.filter((s) => s.score >= 15).slice(0, topK);

    // 2) 创意组合：根据题材ID重合 + 关键词重合 打分
    const allCombos = getRecommendedCombos();
    const comboScores = allCombos.map((c) => {
      const genreOverlap = scored.find((s) => s.genre.id === c.genre.id)?.score ?? 0;
      let kw = 0;
      const hay = `${c.title} ${c.oneLinePitch} ${c.marketGap} ${c.microInnovation}`.toLowerCase();
      c.genre.aliases.forEach((a) => { if (t.includes(a.toLowerCase()) && hay.includes(a.toLowerCase())) kw += 5; });
      return { combo: c, total: genreOverlap * 2 + kw };
    }).sort((a, b) => b.total - a.total);

    const suggestedCombos = comboScores.slice(0, topK).map((m) => ({
      id: m.combo.id,
      title: m.combo.title,
      genreName: m.combo.genre.name,
      oneLinePitch: m.combo.oneLinePitch,
      hotnessEstimate: m.combo.hotnessEstimate,
      microInnovation: m.combo.microInnovation,
      marketGap: m.combo.marketGap,
      archetypeNames: m.combo.archetypes.map((a) => a.name),
      matchScore: m.total,
    }));

    return NextResponse.json({
      ok: true,
      textLength: text.length,
      topGenres: topGenres.map((s) => ({
        id: s.genre.id,
        name: s.genre.name,
        heatValue: s.genre.heatValue,
        color: s.genre.color,
        matchScore: s.score,
        audience: `${s.genre.audienceGender === 'female' ? '女频' : s.genre.audienceGender === 'male' ? '男频' : '男女通吃'}·${s.genre.audienceAge}`,
        coreEmotions: s.genre.coreEmotions,
        goldenElements: s.genre.goldenElements,
        microInnovationIdeas: s.genre.microInnovationIdeas.slice(0, 3),
        avoidTraps: s.genre.avoidTraps,
        representativeWorks: s.genre.representativeWorks,
      })),
      suggestedCombos,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || '请求解析失败' },
      { status: 400 }
    );
  }
}
