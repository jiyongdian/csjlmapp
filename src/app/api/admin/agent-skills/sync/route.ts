import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { clearAgentSkillCache } from '@/lib/agent-skills';
import { seedAgentSkillsToModelPrompts } from '@/storage/database/agentSkillPromptSeed';

export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    clearAgentSkillCache();
    const result = await seedAgentSkillsToModelPrompts();
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[AgentSkills] sync error:', error);
    return NextResponse.json({ error: error.message || '同步 Agent 技能失败' }, { status: 500 });
  }
}

