/**
 * ComfyUI 工作流 API - 获取列表
 * GET /api/comfyui/workflows
 */
import { NextRequest, NextResponse } from 'next/server';
import { ComfyWorkflowManager } from '@/storage/database/comfyWorkflowManager';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const active = searchParams.get('active');
    const type = searchParams.get('type');

    const workflows = await ComfyWorkflowManager.list({
      active: active ? active === 'true' : undefined,
      type: type || undefined,
    });

    // 返回列表（包含基础信息 + JSON 内容用于编辑）
    const list = workflows.map(w => ({
      id: w.id,
      name: w.name,
      description: w.description,
      fileName: w.fileName,
      workflowPath: w.workflowPath,
      workflowJson: w.workflowJson,
      workflowType: w.workflowType,
      modelType: w.modelType,
      isDefault: w.isDefault,
      isActive: w.isActive,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    }));

    return NextResponse.json({ success: true, data: list });
  } catch (err: any) {
    console.error('[ComfyUI Workflows] 获取列表失败:', err);
    return NextResponse.json({ success: false, error: err.message || '获取工作流列表失败' }, { status: 500 });
  }
}

/**
 * 创建工作流
 * POST /api/comfyui/workflows
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, workflowJson, workflowType, modelType, isDefault, filePath } = body;

    if (!name) {
      return NextResponse.json({ success: false, error: '工作流名称不能为空' }, { status: 400 });
    }
    if (!workflowJson && !filePath) {
      return NextResponse.json({ success: false, error: '工作流内容不能为空' }, { status: 400 });
    }

    let finalJson = workflowJson;
    // 如果传入的是文件路径，读取文件
    if (!finalJson && filePath) {
      const fs = require('fs');
      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ success: false, error: '文件不存在' }, { status: 400 });
      }
      finalJson = fs.readFileSync(filePath, 'utf-8');
    }

    const workflow = await ComfyWorkflowManager.create({
      name,
      description,
      workflowJson: finalJson,
      workflowType,
      modelType,
      isDefault,
    });

    console.log('[ComfyUI Workflows] 创建成功:', workflow.name, workflow.id);

    return NextResponse.json({
      success: true,
      data: {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        fileName: workflow.fileName,
        workflowType: workflow.workflowType,
        modelType: workflow.modelType,
        isDefault: workflow.isDefault,
        isActive: workflow.isActive,
        createdAt: workflow.createdAt,
      },
    });
  } catch (err: any) {
    console.error('[ComfyUI Workflows] 创建失败:', err);
    return NextResponse.json({ success: false, error: err.message || '创建工作流失败' }, { status: 500 });
  }
}
