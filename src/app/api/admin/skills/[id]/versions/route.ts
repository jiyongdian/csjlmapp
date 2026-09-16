import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { skillLearningManager } from '@/storage/database/skillLearningManager';
import { applySkillVersion } from '@/lib/skill-service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    const { id } = await params;
    const versions = await skillLearningManager.listVersions(id);
    return NextResponse.json({ success: true, data: versions });
  } catch (error: any) {
    console.error('[AdminSkills] versions GET error:', error);
    return NextResponse.json({ error: error.message || '获取版本失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    await params;
    const body = await request.json();
    const versionId = String(body.versionId || '');
    if (!versionId) return NextResponse.json({ error: '缺少 versionId' }, { status: 400 });

    const skill = await applySkillVersion(versionId);
    if (!skill) return NextResponse.json({ error: '版本不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data: skill });
  } catch (error: any) {
    console.error('[AdminSkills] versions POST error:', error);
    return NextResponse.json({ error: error.message || '应用版本失败' }, { status: 500 });
  }
}
