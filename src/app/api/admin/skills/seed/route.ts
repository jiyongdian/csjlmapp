import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { seedStageSkills } from '@/lib/skill-service';

export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    const result = await seedStageSkills();
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[AdminSkills] seed error:', error);
    return NextResponse.json({ error: error.message || '初始化技能失败' }, { status: 500 });
  }
}
