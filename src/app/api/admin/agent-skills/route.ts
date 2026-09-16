import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { getAgentSkills } from '@/lib/agent-skills';

export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const skills = getAgentSkills().map(skill => ({
      code: skill.code,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      relativePath: skill.relativePath,
      contentLength: skill.content.length,
    }));

    return NextResponse.json({ success: true, data: skills });
  } catch (error: any) {
    console.error('[AgentSkills] GET error:', error);
    return NextResponse.json({ error: error.message || '获取 Agent 技能失败' }, { status: 500 });
  }
}

