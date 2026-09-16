/**
 * ComfyUI 工作流 API - 单个工作流操作
 * GET /api/comfyui/workflows/[id] - 获取详情
 * PUT /api/comfyui/workflows/[id] - 更新
 * DELETE /api/comfyui/workflows/[id] - 软删除（可恢复）
 * DELETE /api/comfyui/workflows/[id]?permanent=true - 永久删除（不可恢复）
 * POST /api/comfyui/workflows/[id] - 设置默认
 */
import { NextRequest, NextResponse } from 'next/server';
import { ComfyWorkflowManager } from '@/storage/database/comfyWorkflowManager';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const workflow = await ComfyWorkflowManager.getById(id);
    if (!workflow) {
      return NextResponse.json({ success: false, error: '工作流不存在' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: workflow });
  } catch (err: any) {
    console.error('[ComfyUI Workflow] 获取详情失败:', err);
    return NextResponse.json({ success: false, error: err.message || '获取工作流详情失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const workflow = await ComfyWorkflowManager.update(id, body);
    if (!workflow) {
      return NextResponse.json({ success: false, error: '工作流不存在' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: workflow });
  } catch (err: any) {
    console.error('[ComfyUI Workflow] 更新失败:', err);
    return NextResponse.json({ success: false, error: err.message || '更新工作流失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const permanent = searchParams.get('permanent') === 'true';
    
    if (permanent) {
      await ComfyWorkflowManager.permanentDelete(id);
      return NextResponse.json({ success: true, message: '永久删除成功' });
    } else {
      await ComfyWorkflowManager.delete(id);
      return NextResponse.json({ success: true, message: '已删除（可恢复）' });
    }
  } catch (err: any) {
    console.error('[ComfyUI Workflow] 删除失败:', err);
    return NextResponse.json({ success: false, error: err.message || '删除工作流失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = body?.action || '';
    
    if (action === 'set-default') {
      await ComfyWorkflowManager.setDefault(id);
      return NextResponse.json({ success: true, message: '设为默认成功' });
    }
    
    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  } catch (err: any) {
    console.error('[ComfyUI Workflow] 操作失败:', err);
    return NextResponse.json({ success: false, error: err.message || '操作失败' }, { status: 500 });
  }
}
