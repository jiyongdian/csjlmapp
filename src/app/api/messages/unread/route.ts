import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';

import { totalUnread } from '@/lib/community/community-store';

export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ success: true, data: 0 });
    return NextResponse.json({ success: true, data: totalUnread(payload.userId) });
  } catch (e) {
    console.error('[Messages] unread failed:', e);
    return NextResponse.json({ success: true, data: 0 });
  }
}
