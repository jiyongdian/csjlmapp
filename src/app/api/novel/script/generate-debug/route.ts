import { NextRequest, NextResponse } from 'next/server';
import { getRawAIConfig, getModelName, getTemperature } from '@/lib/ai-config';
import { scriptManager } from '@/storage/database/scriptManager';
import { novelManager } from '@/storage/database/novelManager';
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
  
  const { novelId, configId, customPromptEnabled, customSystemPrompt } = await request.json();
  
  console.log(`[Generate-Debug] 收到请求 - novelId: ${novelId}, configId: ${configId}`);
  
  try {
    // 获取AI配置
    const { apiUrl, apiKey, provider } = await getRawAIConfig(configId);
    console.log(`[Generate-Debug] Using provider: ${provider}, URL: ${apiUrl}`);
    console.log(`[Generate-Debug] API密钥 - 长度: ${apiKey ? apiKey.length : 0}`);
    
    if (!apiKey) {
      console.error('[Generate-Debug] ❌ API密钥为空！');
      return NextResponse.json({ 
        error: '请在后台管理页面设置有效的API密钥: http://localhost:5000/admin/api-settings' 
      }, { status: 400 });
    }
    
    // 获取模型名称
    const model = await getModelName(configId);
    console.log(`[Generate-Debug] 使用模型: ${model}`);
    
    // 获取小说信息
    const novel = await novelManager.getById(novelId);
    if (!novel) {
      console.error('[Generate-Debug] ❌ 小说不存在');
      return NextResponse.json({ error: '小说不存在' }, { status: 404 });
    }
    
    console.log(`[Generate-Debug] ✅ 小说: ${novel.title}`);
    
    // 获取剧本
    const script = await scriptManager.getScriptByNovelId(novelId, novel.userId);
    console.log(`[Generate-Debug] 剧本: ${script ? '已存在' : '新建'}`);
    
    // 开始流式生成
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 发送开始事件
          const chapters = novel.chapters ? JSON.parse(novel.chapters) : [];
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'start', 
            totalChapters: chapters.length || 3,
            novelTitle: novel.title 
          })}\n\n`));
          
          // 发送章节标题
          for (let i = 0; i < (chapters.length || 3); i++) {
            const chapterTitle = chapters[i]?.title || `第${i + 1}章`;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'content', 
              chapterTitle,
              content: `# ${chapterTitle}\n\n（等待AI生成）\n` 
            })}\n\n`));
          }
          
          // 发送完成事件
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'complete',
            message: '生成成功（调试模式）'
          })}\n\n`));
          
          controller.close();
          console.log('[Generate-Debug] ✅ 流式生成完成');
        } catch (error) {
          console.error('[Generate-Debug] ❌ 生成失败:', error);
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
    console.error('[Generate-Debug] ❌ 严重错误:', error);
    return NextResponse.json({ 
      error: `生成失败: ${error instanceof Error ? error.message : String(error)}` 
    }, { status: 500 });
  }
}
