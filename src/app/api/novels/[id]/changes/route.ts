import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { novelManager } from '@/storage/database';
import { listNovelChanges } from '@/lib/agent/agent-store';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const { id } = await params;
    const novel = await novelManager.getById(id);
    if (!novel || novel.userId !== payload.userId) return NextResponse.json({ error: '无权访问' }, { status: 403 });
    return NextResponse.json({ success: true, data: listNovelChanges(id, payload.userId) });
  } catch (e) {
    console.error('[Studio] changes failed:', e);
    return NextResponse.json({ error: '获取变更记录失败' }, { status: 500 });
  }
}
