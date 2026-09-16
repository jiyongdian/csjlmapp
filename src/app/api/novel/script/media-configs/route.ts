import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { listMediaConfigs } from '@/lib/media-gen';

/** GET /api/novel/script/media-configs?type=image|video|tts */
export async function GET(request: NextRequest) {
  try {
    const auth = getUserFromToken(request.headers.get('Authorization') || '');
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    if (type !== 'image' && type !== 'video' && type !== 'tts') {
      return NextResponse.json({ error: 'type 必须是 image、video 或 tts' }, { status: 400 });
    }

    const data = await listMediaConfigs(auth.userId, type);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    console.error('[media-configs] 失败:', e);
    return NextResponse.json({ error: e?.message || '获取配置失败' }, { status: 500 });
  }
}
