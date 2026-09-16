import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { getGeneration } from '@/lib/agent/agent-store';

type Ctx = { params: Promise<{ sessionId: string }> };

/** 查询某会话的生成任务状态（进度 + 已产出章节），供前端轮询与历史恢复 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const { sessionId } = await params;
    const gen = getGeneration(sessionId);
    if (!gen) return NextResponse.json({ success: true, data: null });
    if (gen.userId !== payload.userId) return NextResponse.json({ error: '无权访问' }, { status: 403 });
    return NextResponse.json({ success: true, data: gen });
  } catch (e) {
    console.error('[Agent] get generation failed:', e);
    return NextResponse.json({ error: '读取生成状态失败' }, { status: 500 });
  }
}
