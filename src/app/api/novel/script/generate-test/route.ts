import { NextRequest, NextResponse } from 'next/server';
import { getRawAIConfig, getModelName, getTemperature } from '@/lib/ai-config';
import { scriptManager } from '@/storage/database/scriptManager';
import { novelManager } from '@/storage/database/novelManager';
import { getPromptWithFallback } from '@/lib/prompt-helper';
import { verifyAuth } from '@/lib/auth';

export const maxDuration = 600;

async function validateRequest(request: NextRequest): Promise<{ error?: string; status?: number; userId?: string } | null> {
  const auth = verifyAuth(request.headers.get('authorization'));
  if (!auth.success) {
    return { error: '请先登录', status: 401 };
  }
  
  const body = await request.json().catch(() => null);
  if (!body?.novelId) {
    return { error: '缺少必要参数: novelId', status: 400 };
  }
  
  return null;
}

export async function POST(request: NextRequest) {
  const validation = await validateRequest(request);
  if (validation) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }
  
  const { novelId, configId } = await request.json();
  
  console.log(`[Generate-Test] 开始生成剧本 - novelId: ${novelId}, configId: ${configId}`);
  
  try {
    // 获取AI配置
    const { apiUrl, apiKey, provider } = await getRawAIConfig(configId);
    console.log(`[Generate-Test] Using provider: ${provider}, URL: ${apiUrl}`);
    
    if (!apiKey) {
      return NextResponse.json({ 
        error: '请在后台管理页面设置有效的API密钥: http://localhost:5000/admin/api-settings' 
      }, { status: 400 });
    }
    
    // 获取小说信息
    const novel = await novelManager.getById(novelId);
    if (!novel) {
      return NextResponse.json({ error: '小说不存在' }, { status: 404 });
    }
    
    // 获取剧本
    const script = await scriptManager.getScriptByNovelId(novelId, novel.userId);
    
    // 开始流式生成
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 发送开始事件
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'start', 
            totalChapters: 3,
            novelTitle: novel.title 
          })}\n\n`));
          
          // 发送测试内容
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'content', 
            chapterTitle: '测试章节',
            content: '# 测试内容\n\n这是一个简化的测试剧本\n' 
          })}\n\n`));
          
          // 发送完成事件
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'complete',
            message: '生成成功（测试模式）'
          })}\n\n`));
          
          controller.close();
        } catch (error) {
          console.error('[Generate-Test] 生成失败:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'error', 
            error: String(error) 
          })}\n\n`));
          controller.close();
        }
      },
    });
    
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
    
  } catch (error) {
    console.error('[Generate-Test] 严重错误:', error);
    return NextResponse.json({ 
      error: `生成失败: ${error instanceof Error ? error.message : String(error)}` 
    }, { status: 500 });
  }
}
