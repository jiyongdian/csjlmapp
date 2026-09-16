import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { aiConfigManager } from '@/storage/database/aiConfigManager';

/**
 * PUT /api/media-configs/mine/[id]  — 更新自己的媒体配置
 * DELETE /api/media-configs/mine/[id]  — 删除自己的媒体配置
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get('Authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const { id } = await params;
    const body = await request.json();
    const { name, provider, model, apiKey, apiUrl, modelType, isDefault, isActive, notes, endpointPath } = body;

    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (provider !== undefined) patch.provider = provider;
    if (model !== undefined) patch.model = model;
    if (apiKey) patch.apiKey = apiKey; // 留空表示不修改
    if (apiUrl !== undefined) patch.apiUrl = apiUrl;
    if (modelType !== undefined) patch.modelType = modelType;
    if (isDefault !== undefined) patch.isDefault = isDefault ? 1 : 0;
    if (isActive !== undefined) patch.isActive = isActive ? 1 : 0;
    if (notes !== undefined || endpointPath !== undefined) {
      patch.extraConfig = JSON.stringify({ notes, endpointPath });
    }

    const updated = await aiConfigManager.updateConfig(id, payload.userId, patch as any);
    if (!updated) return NextResponse.json({ error: '配置不存在或无权修改' }, { status: 404 });

    if (isDefault) {
      await aiConfigManager.setUserMediaDefaultConfigById(id, payload.userId);
    }
    return NextResponse.json({
      success: true,
      data: {
        id: updated.id, name: updated.name, provider: updated.provider, model: updated.model,
        apiUrl: updated.apiUrl, apiKey: updated.apiKey, modelType: updated.modelType,
        isDefault: updated.isDefault, isActive: updated.isActive, extraConfig: updated.extraConfig ?? null,
      },
    });
  } catch (e: any) {
    console.error('[media-configs/mine] 更新失败:', e);
    return NextResponse.json({ error: e?.message || '更新失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get('Authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const { id } = await params;
    const deleted = await aiConfigManager.deleteConfig(id, payload.userId);
    return NextResponse.json({ success: deleted, message: deleted ? '删除成功' : '配置不存在或无权删除' });
  } catch (e: any) {
    console.error('[media-configs/mine] 删除失败:', e);
    return NextResponse.json({ error: e?.message || '删除失败' }, { status: 500 });
  }
}
