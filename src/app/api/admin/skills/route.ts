import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { skillManager } from '@/storage/database';
import { skillLearningManager } from '@/storage/database/skillLearningManager';
import { SKILL_STAGES, SYSTEM_SKILL_USER, getStageDef } from '@/lib/skill-stage';
import { invalidateSkillCache } from '@/lib/skill-service';

export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const skills = await skillManager.listAllByUser(SYSTEM_SKILL_USER);
    const usage = await skillLearningManager.usageSummary();
    const rows = [];
    for (const skill of skills) {
      rows.push({
        ...skill,
        usageCount: usage[skill.id]?.count ?? 0,
        lastUsedAt: usage[skill.id]?.lastUsedAt ?? null,
        versionCount: await skillLearningManager.versionCount(skill.id),
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        skills: rows,
        stages: SKILL_STAGES.map((s) => ({ key: s.key, label: s.label, icon: s.icon, desc: s.desc, codes: s.codes })),
      },
    });
  } catch (error: any) {
    console.error('[AdminSkills] GET error:', error);
    return NextResponse.json({ error: error.message || '获取技能失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const body = await request.json();
    const stage = String(body.stage || '');
    const name = String(body.name || '').trim();
    const systemPrompt = String(body.systemPrompt || '').trim();
    if (!getStageDef(stage) || !name || !systemPrompt) {
      return NextResponse.json({ error: '缺少必填字段：stage、name、systemPrompt' }, { status: 400 });
    }

    const skill = await skillManager.create({
      userId: SYSTEM_SKILL_USER,
      name,
      description: body.description ? String(body.description) : '',
      category: stage as any,
      systemPrompt,
      userPrompt: body.userPrompt ? String(body.userPrompt) : '',
      parameters: body.parameters ?? { autoOptimize: false, optimizeThreshold: 20 },
      isDefault: false,
      isActive: body.isActive !== false,
      sortOrder: Number(body.sortOrder) || 0,
    });

    const version = await skillLearningManager.createVersion({
      skillId: skill.id,
      systemPrompt: skill.systemPrompt,
      userPrompt: skill.userPrompt,
      note: '手动创建技能',
      source: 'manual',
    });
    await skillLearningManager.activateVersion(version.id);

    invalidateSkillCache();
    return NextResponse.json({ success: true, data: skill });
  } catch (error: any) {
    console.error('[AdminSkills] POST error:', error);
    return NextResponse.json({ error: error.message || '创建技能失败' }, { status: 500 });
  }
}
