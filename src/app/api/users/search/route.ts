import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { sqlite } from '@/storage/database/sqlite';

export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
    if (!q) return NextResponse.json({ success: true, data: [] });
    const rows = sqlite.prepare(
      'SELECT id, nickname, username, avatar FROM users WHERE nickname LIKE ? OR username LIKE ? OR id = ? LIMIT 10'
    ).all('%' + q + '%', '%' + q + '%', q) as { id: string; nickname: string | null; username: string | null; avatar: string | null }[];
    return NextResponse.json({
      success: true,
      data: rows.map((u) => ({ id: u.id, nickname: u.nickname || u.username || '用户', username: u.username || '', avatar: u.avatar ?? null })),
    });
  } catch (e) {
    console.error('[Users] search failed:', e);
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}
