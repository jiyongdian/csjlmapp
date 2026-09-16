import { NextRequest, NextResponse } from 'next/server';
import { listBooks, listCategories } from '@/lib/books/book-store';

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') || '24', 10)));
    const sort = (sp.get('sort') || 'updated') as 'updated' | 'new' | 'hot';
    const result = listBooks({
      category: sp.get('category') || undefined,
      q: sp.get('q') || undefined,
      sort,
      page,
      pageSize,
    });
    return NextResponse.json({ success: true, data: result, categories: listCategories() });
  } catch (e) {
    console.error('[Books] list failed:', e);
    return NextResponse.json({ error: '获取书城失败' }, { status: 500 });
  }
}
