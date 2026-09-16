import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { aiConfigManager } from '@/storage/database/aiConfigManager';

/** POST /api/media-configs/mine/[id]/default — 设为该类型的默认配置 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get('Authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const { id } = await params;
    const updated = await aiConfigManager.setUserMediaDefaultConfigById(id, payload.userId);
    if (!updated) return NextResponse.json({ error: '配置不存在或无权操作' }, { status: 404 });
    return NextResponse.json({ success: true, data: { id: updated.id, modelType: updated.modelType } });
  } catch (e: any) {
    console.error('[media-configs/mine] 设为默认失败:', e);
    return NextResponse.json({ error: e?.message || '设为默认失败' }, { status: 500 });
  }
}
