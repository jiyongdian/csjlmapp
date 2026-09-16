import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 120;

/**
 * ComfyUI 文件代理端点
 * 将 ComfyUI 服务器的文件代理到客户端，解决跨域/网络访问问题
 * 
 * 用法: /api/comfyui/proxy?server=xxx&filename=xxx&subfolder=xxx&type=output
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const server = searchParams.get('server');
    const filename = searchParams.get('filename');
    const subfolder = searchParams.get('subfolder') || '';
    const type = searchParams.get('type') || 'output';

    if (!server || !filename) {
      return NextResponse.json({ error: '缺少 server 或 filename 参数' }, { status: 400 });
    }

    const comfyBase = server.replace(/\/+$/, '');
    const params = new URLSearchParams({ filename, subfolder, type });
    const fileUrl = `${comfyBase}/view?${params.toString()}`;

    console.log(`[ComfyUI Proxy] 代理请求: ${fileUrl}`);

    const res = await fetch(fileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ComfyUI-Proxy/1.0)',
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `获取文件失败: ${res.status}` },
        { status: res.status }
      );
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const contentLength = res.headers.get('content-length');
    const arrayBuffer = await res.arrayBuffer();

    // 转换为 Response 返回
    const response = new Response(arrayBuffer, {
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
        ...(contentLength ? { 'Content-Length': contentLength } : {}),
      },
    });

    return response;
  } catch (err: any) {
    console.error('[ComfyUI Proxy] 错误:', err);
    return NextResponse.json(
      { error: `代理请求失败: ${err.message}` },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
