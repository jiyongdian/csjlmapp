import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { getPromptWithFallback } from '@/lib/prompt-helper';
import { stageByPromptCode } from '@/lib/skill-stage';

export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code') || '';
    if (!code) return NextResponse.json({ error: '缺少 code' }, { status: 400 });

    const prompt = await getPromptWithFallback(code, '');
    return NextResponse.json({
      success: true,
      data: { code, stage: stageByPromptCode(code), prompt },
    });
  } catch (error: any) {
    console.error('[AdminSkills] preview error:', error);
    return NextResponse.json({ error: error.message || '预览失败' }, { status: 500 });
  }
}
