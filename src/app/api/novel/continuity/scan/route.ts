/**
 * /api/novel/continuity/scan — 全本跨章衔接扫描接口
 *
 * 输入（POST body，二选一）：
 *   1. novelId + userId — 从 DB 读取 novels.chapters 进行扫描（推荐，有鉴权）
 *   2. chapters[] — 直接传入 [{index,title,content}] 数组（调试/离线模式）
 *
 * 输出：
 *   - overall: { totalPairs, errorCount, warnCount, passCount, avgScore, minScore }
 *   - pairs:   Array<{prevIndex,nextIndex,summaryHeadline,similarityPct,endingClosed,report}>
 *     其中 report = continuity-checker 的 ContinuityReport（4 维 finalScore / pass / hardBreak / columns / issues / failureSection）
 */
import { NextRequest } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { novelManager } from '@/storage/database';
import {
  scanFullBookContinuity,
  scanAndRepairClosingPhrases,
} from '@/lib/chapter-pipeline/continuity-checker';

type ChapterLike = { index: number; title?: string; content?: string };

export async function POST(request: NextRequest) {
  try {
    let body: any;
    try { body = await request.json(); } catch { body = {}; }

    let chaptersIn: ChapterLike[] = [];
    const { novelId, chapters } = body ?? {};

    if (Array.isArray(chapters) && chapters.length > 0) {
      chaptersIn = chapters
        .filter((c: any) => c && typeof c === 'object')
        .map((c: any, idx: number) => ({
          index: typeof c.index === 'number' ? c.index : (Number(c.chapterIndex ?? c.chapterNum ?? c.number ?? (idx + 1))),
          title: String(c.title ?? c.chapterTitle ?? ''),
          content: String(c.content ?? c.body ?? c.text ?? ''),
        }));
    } else if (novelId) {
      // 鉴权：从 Authorization 头解析 userId，校验归属
      let resolvedUserId: string | undefined;
      try {
        const auth = request.headers.get('authorization') || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : (request.headers.get('x-token') || '');
        if (token) {
          const u = await getUserFromToken(token);
          if (u?.userId) resolvedUserId = String(u.userId);
        }
      } catch { /* ignore */ }
      if (!resolvedUserId) {
        return new Response(JSON.stringify({ error: '未登录或登录状态过期（novelId 模式需要鉴权）' }), { status: 401 });
      }
      // 读取小说
      const all = await novelManager.getAllNovels({ limit: 10_000 });
      const novel = all.novels.find(n => n.id === String(novelId) && n.userId === resolvedUserId);
      if (!novel) {
        return new Response(JSON.stringify({ error: '找不到对应小说，或无权读取（novelId=' + novelId + '）' }), { status: 404 });
      }
      const cs: any = (novel as any).chapters;
      if (!Array.isArray(cs)) {
        return new Response(JSON.stringify({ error: '该小说尚无章节正文内容（chapters 为空）' }), { status: 400 });
      }
      chaptersIn = cs.map((c: any, idx: number) => ({
        index: typeof c.index === 'number' ? c.index : (Number(c.chapterIndex ?? c.chapterNum ?? c.number ?? (idx + 1))),
        title: String(c.title ?? c.chapterTitle ?? ''),
        content: String(c.content ?? c.body ?? c.text ?? ''),
      }));
    } else {
      return new Response(JSON.stringify({ error: '参数不完整：请传入 novelId 或 chapters 数组之一' }), { status: 400 });
    }

    // 清洗章节：仅保留正文 ≥ 200 字的章节（避免空白章拉低报告）
    const valid = chaptersIn
      .filter(c => c.content && String(c.content).replace(/\s+/g, '').length >= 200)
      .sort((a, b) => (a.index || 0) - (b.index || 0));

    if (valid.length < 2) {
      return Response.json({
        overall: { totalPairs: 0, errorCount: 0, warnCount: 0, passCount: 0, avgScore: 0, minScore: 0 },
        pairs: [],
        notice: valid.length < 1
          ? '没有任何 ≥200 字的章节可供扫描'
          : '仅有 1 章正文，跨章衔接需要至少 2 章才能比对',
      });
    }

    // ★ 核心：调用 scanFullBookContinuity
    const typedValid = valid.map(c => ({ index: c.index, title: String(c.title ?? '第' + c.index + '章'), content: String(c.content ?? '') }));
    const pairs = scanFullBookContinuity(typedValid);

    // 总体统计
    const totalPairs = pairs.length;
    let errorCount = 0, warnCount = 0, passCount = 0;
    let sum = 0, min = 100;
    for (const p of pairs) {
      const s = p.report.finalScore;
      sum += s;
      if (s < min) min = s;
      if (p.report.hardBreak || p.report.issues.some(i => i.level === 'ERROR')) errorCount++;
      else if (!p.report.pass) warnCount++;
      else passCount++;
    }
    // 全书收束句命中统计（额外给前端一个"章末闭合/开放比例"面板）
    const closingStats = valid.map((c, i) => {
      const r = scanAndRepairClosingPhrases(c.content || '');
      return { index: c.index, title: c.title || '第' + (i + 1) + '章', hits: r.hits, anyHit: r.anyHit, needRewriteTail: r.needRewriteTail };
    });
    const closedCount = closingStats.filter(c => c.anyHit).length;

    return Response.json({
      overall: {
        totalPairs,
        errorCount,
        warnCount,
        passCount,
        avgScore: totalPairs > 0 ? Math.round((sum / totalPairs) * 10) / 10 : 0,
        minScore: totalPairs > 0 ? min : 0,
        closedChapterCount: closedCount,
        totalChapterCount: valid.length,
      },
      pairs: pairs.map(p => ({
        prevIndex: p.prevIndex,
        nextIndex: p.nextIndex,
        summaryHeadline: p.summaryHeadline,
        similarityPct: p.similarityPct,
        endingClosed: p.endingClosed,
        sharedGrams: p.sharedGrams,
        // 结构化分 & 问题（便于前端画卡片）
        finalScore: p.report.finalScore,
        pass: p.report.pass,
        hardBreak: p.report.hardBreak,
        columns: [
          { name: '状态词承接', score: p.report.columns.stateScore,    maxScore: 25 },
          { name: '实体共享度', score: p.report.columns.ngramScore,    maxScore: 25 },
          { name: '复述警戒',   score: p.report.columns.repeatScore,   maxScore: 25 },
          { name: '过渡合法性', score: p.report.columns.transitionScore,maxScore: 25 },
        ],
        issues: p.report.issues.map(i => ({
          id: i.id, level: i.level, title: i.title, detail: i.detail.slice(0, 220),
          penalty: i.penalty, suggestion: i.suggestion,
        })),
      })),
      closingStats,
    });
  } catch (error) {
    console.error('[Continuity-Scan-API] Error:', error);
    return new Response(
      JSON.stringify({ error: '扫描失败：' + (error instanceof Error ? error.message : String(error)) }),
      { status: 500 }
    );
  }
}
