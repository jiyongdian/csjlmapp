import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { modelPromptManager } from '@/storage/database';

/** PUT /api/admin/model-prompts/[id] - 更新提示词配置 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.module !== undefined) updateData.module = body.module;
    if (body.systemPrompt !== undefined) updateData.systemPrompt = body.systemPrompt;
    if (body.userPrompt !== undefined) updateData.userPrompt = body.userPrompt;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const prompt = await modelPromptManager.update(id, updateData as any);
    if (!prompt) {
      return NextResponse.json({ error: '提示词配置不存在' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: prompt });
  } catch (error: any) {
    console.error('[ModelPrompts] PUT error:', error);
    return NextResponse.json({ error: error.message || '更新提示词配置失败' }, { status: 500 });
  }
}

/** DELETE /api/admin/model-prompts/[id] - 删除提示词配置 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { id } = await params;
    const prompt = await modelPromptManager.delete(id);
    if (!prompt) {
      return NextResponse.json({ error: '提示词配置不存在' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: '删除成功' });
  } catch (error: any) {
    console.error('[ModelPrompts] DELETE error:', error);
    return NextResponse.json({ error: error.message || '删除提示词配置失败' }, { status: 500 });
  }
}
