import { NextRequest, NextResponse } from 'next/server';
import { getBookDetail } from '@/lib/books/book-store';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const detail = getBookDetail(id);
    if (!detail) return NextResponse.json({ error: '作品不存在或未发布' }, { status: 404 });
    return NextResponse.json({ success: true, data: detail });
  } catch (e) {
    console.error('[Books] detail failed:', e);
    return NextResponse.json({ error: '获取详情失败' }, { status: 500 });
  }
}
