import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { novels, novelChapterHooks } from '@/storage/database/shared/schema';
import { getDb } from '@/storage/database/sqlite';

/**
 * DELETE /api/novels/[id]/chapters
 * 删除小说章节（单章 / 批量），并重排剩余章节号
 *
 * body:
 *   { chapterNumbers: number[] }   // 要删除的 1-based 章节号数组
 *   { chapterNumber: number }      // 兼容单章删除
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const payload = getUserFromToken(authHeader);
    if (!payload) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const { id } = await params;
    const db = await getDb();

    // 校验归属
    const [existing] = await db
      .select()
      .from(novels)
      .where(eq(novels.id, id))
      .limit(1);
    if (!existing) {
      return NextResponse.json({ error: '小说不存在' }, { status: 404 });
    }
    if (existing.userId !== payload.userId) {
      return NextResponse.json({ error: '无权操作此小说' }, { status: 403 });
    }

    // 解析 body
    let body: any;
    try { body = await request.json(); } catch { body = {}; }

    let chapterNumbers: number[] = [];
    if (Array.isArray(body.chapterNumbers)) {
      chapterNumbers = body.chapterNumbers
        .map((n: any) => Number(n))
        .filter((n: number) => Number.isInteger(n) && n >= 1);
    } else if (body.chapterNumber !== undefined && body.chapterNumber !== null) {
      const n = Number(body.chapterNumber);
      if (Number.isInteger(n) && n >= 1) chapterNumbers = [n];
    }

    if (chapterNumbers.length === 0) {
      return NextResponse.json(
        { error: 'chapterNumbers 或 chapterNumber 参数不能为空且必须为 ≥1 的章节号' },
        { status: 400 }
      );
    }
    chapterNumbers = Array.from(new Set(chapterNumbers)).sort((a, b) => a - b);

    // 解析现有 chapters JSON
    let chaptersArr: any[] = [];
    if (existing.chapters) {
      try {
        chaptersArr = typeof existing.chapters === 'string'
          ? JSON.parse(existing.chapters)
          : existing.chapters;
        if (!Array.isArray(chaptersArr)) chaptersArr = [];
      } catch { chaptersArr = []; }
    }

    // 探测现有 index 是 0-based 还是 1-based：若第 0 项 index 是 0 且总章数 > 1 则认为是 0-based
    const firstIdxRaw = chaptersArr.length > 0
      ? Number(chaptersArr[0]?.index ?? chaptersArr[0]?.number ?? chaptersArr[0]?.chapterNumber ?? null)
      : null;
    const isZeroBased = firstIdxRaw === 0 && chaptersArr.length > 1;

    const deletedSet = new Set(chapterNumbers);
    const keptChapters = chaptersArr
      .filter((ch) => {
        const rawIdx = Number(ch.index ?? ch.number ?? ch.chapterNumber ?? 0);
        const norm1 = isZeroBased ? rawIdx + 1 : rawIdx;
        return !deletedSet.has(norm1);
      })
      .map((ch, i) => {
        const new1based = i + 1;
        const newIdx = isZeroBased ? i : new1based;
        return {
          ...ch,
          index: newIdx,
          number: new1based,
          chapterNumber: new1based,
        };
      });

    // better-sqlite3 同步事务：db.transaction(fn) 在 drizzle 0.45.x 同步驱动下立即执行并返回值
    const runTx = () => {
      return db.transaction(() => {
        // 1. 删除目标 chapter hooks
        db.delete(novelChapterHooks)
          .where(and(
            eq(novelChapterHooks.novelId, id),
            inArray(novelChapterHooks.chapterNumber, chapterNumbers)
          )).run();

        // 2. 查询剩余 hooks 并按原 chapterNumber 排序重编号
        const remainingHooks = db
          .select()
          .from(novelChapterHooks)
          .where(eq(novelChapterHooks.novelId, id))
          .orderBy(asc(novelChapterHooks.chapterNumber))
          .all();

        for (let i = 0; i < remainingHooks.length; i++) {
          const newNum = i + 1;
          const old = remainingHooks[i];
          if (old.chapterNumber !== newNum) {
            db.update(novelChapterHooks)
              .set({ chapterNumber: newNum, updatedAt: new Date().toISOString() })
              .where(eq(novelChapterHooks.id, old.id))
              .run();
          }
        }

        // 3. 更新 novels 主表
        const newCurrent = keptChapters.length;
        db.update(novels)
          .set({
            chapters: JSON.stringify(keptChapters),
            currentChapters: newCurrent,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(novels.id, id))
          .run();

        return {
          deletedCount: chapterNumbers.length,
          remainingChapters: newCurrent,
          removedNumbers: chapterNumbers,
        };
      });
    };

    const result = runTx();

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[DeleteChapters] Error:', error);
    return NextResponse.json(
      { error: error.message || '删除章节失败' },
      { status: 500 }
    );
  }
}
