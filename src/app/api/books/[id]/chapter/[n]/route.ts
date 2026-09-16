import { NextRequest, NextResponse } from 'next/server';
import { getBookChapter } from '@/lib/books/book-store';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  try {
    const { id, n } = await params;
    const idx = parseInt(n, 10);
    if (!Number.isInteger(idx) || idx < 1) return NextResponse.json({ error: '章节序号无效' }, { status: 400 });
    const chapter = getBookChapter(id, idx);
    if (!chapter) return NextResponse.json({ error: '章节不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data: chapter });
  } catch (e) {
    console.error('[Books] chapter failed:', e);
    return NextResponse.json({ error: '获取章节失败' }, { status: 500 });
  }
}
