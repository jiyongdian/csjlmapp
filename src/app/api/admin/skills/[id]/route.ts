import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { skillManager } from '@/storage/database';
import { skillLearningManager } from '@/storage/database/skillLearningManager';
import { invalidateSkillCache } from '@/lib/skill-service';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { id } = await params;
    const skill = await skillManager.getById(id);
    if (!skill) return NextResponse.json({ error: '技能不存在' }, { status: 404 });

    const body = await request.json();
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = String(body.name);
    if (body.description !== undefined) data.description = String(body.description);
    if (body.systemPrompt !== undefined) data.systemPrompt = String(body.systemPrompt);
    if (body.userPrompt !== undefined) data.userPrompt = String(body.userPrompt);
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder) || 0;
    if (body.parameters !== undefined) data.parameters = body.parameters;

    const updated = await skillManager.update(id, skill.userId, data as any);

    if (data.systemPrompt !== undefined || data.userPrompt !== undefined) {
      const version = await skillLearningManager.createVersion({
        skillId: id,
        systemPrompt: (updated?.systemPrompt as string) ?? '',
        userPrompt: (updated?.userPrompt as string) ?? '',
        note: '手动编辑',
        source: 'manual',
      });
      await skillLearningManager.activateVersion(version.id);
    }

    invalidateSkillCache();
    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('[AdminSkills] PUT error:', error);
    return NextResponse.json({ error: error.message || '更新技能失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { id } = await params;
    const skill = await skillManager.getById(id);
    if (!skill) return NextResponse.json({ error: '技能不存在' }, { status: 404 });

    await skillManager.delete(id, skill.userId);
    invalidateSkillCache();
    return NextResponse.json({ success: true, message: '删除成功' });
  } catch (error: any) {
    console.error('[AdminSkills] DELETE error:', error);
    return NextResponse.json({ error: error.message || '删除技能失败' }, { status: 500 });
  }
}
