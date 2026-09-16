import { NextResponse } from 'next/server';
import { modelPromptManager } from '@/storage/database';

/** GET /api/model-prompts?codes=code1,code2 - 获取指定提示词（供生成模块内部调用，不需要前端访问） */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const codesParam = searchParams.get('codes');

    if (!codesParam) {
      // 无codes参数时返回所有提示词
      const prompts = await modelPromptManager.getAllPrompts();
      return NextResponse.json({ success: true, data: prompts });
    }

    const codes = codesParam.split(',').map(c => c.trim()).filter(Boolean);
    const prompts = await modelPromptManager.getPrompts(codes);

    return NextResponse.json({ success: true, data: prompts });
  } catch (error: any) {
    console.error('[ModelPrompts] Public GET error:', error);
    return NextResponse.json({ error: error.message || '获取提示词失败' }, { status: 500 });
  }
}
