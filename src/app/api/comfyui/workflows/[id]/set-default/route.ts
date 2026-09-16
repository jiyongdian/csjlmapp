/**
 * ComfyUI 工作流 API - 设置默认工作流
 * POST /api/comfyui/workflows/[id]/set-default
 */
import { NextRequest, NextResponse } from 'next/server';
import { ComfyWorkflowManager } from '@/storage/database/comfyWorkflowManager';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { workflowType } = body;
    await ComfyWorkflowManager.setDefault(id, workflowType);
    return NextResponse.json({ success: true, message: '已设置为默认工作流' });
  } catch (err: any) {
    console.error('[ComfyUI Workflow] 设置默认失败:', err);
    return NextResponse.json({ success: false, error: err.message || '设置默认失败' }, { status: 500 });
  }
}
