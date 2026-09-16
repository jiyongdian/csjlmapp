import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { modelPromptManager } from '@/storage/database';

/** GET /api/admin/model-prompts - 获取所有提示词配置 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const module = searchParams.get('module');

    const prompts = module
      ? await modelPromptManager.getByModule(module)
      : await modelPromptManager.getAll();

    return NextResponse.json({ success: true, data: prompts });
  } catch (error: any) {
    console.error('[ModelPrompts] GET error:', error);
    return NextResponse.json({ error: error.message || '获取提示词配置失败' }, { status: 500 });
  }
}

/** POST /api/admin/model-prompts - 创建提示词配置 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const body = await request.json();
    const { code, name, description, module, systemPrompt, userPrompt, sortOrder, isActive } = body;

    if (!code || !name || !module || !systemPrompt) {
      return NextResponse.json({ error: '缺少必填字段：code, name, module, systemPrompt' }, { status: 400 });
    }

    // 检查 code 是否已存在
    const existing = await modelPromptManager.getByCode(code);
    if (existing) {
      return NextResponse.json({ error: '提示词代码已存在' }, { status: 409 });
    }

    const prompt = await modelPromptManager.create({
      code,
      name,
      description,
      module,
      systemPrompt,
      userPrompt,
      sortOrder: sortOrder ?? 0,
      isActive: isActive ?? true,
    } as any);

    return NextResponse.json({ success: true, data: prompt });
  } catch (error: any) {
    console.error('[ModelPrompts] POST error:', error);
    return NextResponse.json({ error: error.message || '创建提示词配置失败' }, { status: 500 });
  }
}
