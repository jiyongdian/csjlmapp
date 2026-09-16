import { NextRequest, NextResponse } from 'next/server';
import { computeHotnessScore } from '@/lib/creative-hub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/creative-hub/score
 * 输入一段剧本/小说文本，返回基于爆款知识库计算的「市场热度分」
 *
 * body: {
 *   text: string;                        // 必填，剧本文本/大纲（≥5字）
 *   openingFirst1000Chars?: string;      // 开场前1000字（如果不传，取text的前1000字）
 *   characterKeywords?: string[];        // 人设关键词数组，提升"人设流行度"维度
 *   structureHint?: {                    // 结构信息，提升"节奏适配性"维度
 *     totalEpisodes?: number;
 *     acts?: number;
 *   };
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, openingFirst1000Chars, characterKeywords, structureHint } = body;

    if (typeof text !== 'string' || text.trim().length < 5) {
      return NextResponse.json({ ok: false, error: '缺少 text 字段或内容过短（需要剧本文本/大纲≥5字）' }, { status: 400 });
    }

    const result = computeHotnessScore(text, {
      openingFirst1000Chars: openingFirst1000Chars || text.slice(0, 1000),
      characterKeywords: Array.isArray(characterKeywords) ? characterKeywords : [],
      structureHint: structureHint && typeof structureHint === 'object' ? structureHint : undefined,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      matchedGenresSummary: result.matchedGenres.map((g) => ({
        id: g.id,
        name: g.name,
        heatValue: g.heatValue,
        color: g.color,
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || '请求解析失败' },
      { status: 400 }
    );
  }
}
