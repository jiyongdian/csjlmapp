/**
 * ComfyUI 工作流清理 API
 * POST /api/comfyui/workflows/cleanup - 清理孤儿记录
 */
import { NextResponse } from 'next/server';
import { ComfyWorkflowManager } from '@/storage/database/comfyWorkflowManager';

export async function POST() {
  try {
    const result = await ComfyWorkflowManager.cleanupOrphans();
    return NextResponse.json({ 
      success: true, 
      data: result,
      message: `清理完成: 恢复${result.restored}个文件, 删除${result.cleaned}个孤儿记录`
    });
  } catch (err: any) {
    console.error('[ComfyUI Workflows] 清理失败:', err);
    return NextResponse.json({ success: false, error: err.message || '清理失败' }, { status: 500 });
  }
}
