import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { optimizeSkill } from '@/lib/skill-service';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { id } = await params;
    const result = await optimizeSkill(id, 'manual');
    if (!result) {
      return NextResponse.json({ error: '技能不存在或阶段无效' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[AdminSkills] optimize error:', error);
    return NextResponse.json({ error: error.message || '优化失败' }, { status: 500 });
  }
}
