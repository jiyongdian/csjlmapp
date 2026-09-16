import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';

import { listTopics } from '@/lib/community/community-store';

export async function GET() {
  try {
    return NextResponse.json({ success: true, data: listTopics() });
  } catch (e) {
    console.error('[Community] topics failed:', e);
    return NextResponse.json({ error: '获取话题失败' }, { status: 500 });
  }
}
