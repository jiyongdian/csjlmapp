import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { serverUrl } = body;

    if (!serverUrl) {
      return NextResponse.json({ success: false, error: '缺少服务器地址' }, { status: 400 });
    }

    const baseUrl = serverUrl.replace(/\/+$/, '');
    
    // 测试连接 - 尝试获取系统状态
    const startTime = Date.now();
    let systemStats: any = null;
    let error: string | null = null;
    let status = 'offline';

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const res = await fetch(`${baseUrl}/system_stats`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        systemStats = await res.json();
        status = 'online';
      } else {
        error = `服务器返回错误状态: ${res.status}`;
        status = 'error';
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        error = '连接超时（10秒）';
      } else {
        error = `连接失败: ${err.message}`;
      }
      status = 'offline';
    }

    const responseTime = Date.now() - startTime;

    // 尝试获取队列状态
    let queueStatus: any = null;
    try {
      const queueRes = await fetch(`${baseUrl}/queue`, { signal: AbortSignal.timeout(5000) });
      if (queueRes.ok) {
        queueStatus = await queueRes.json();
      }
    } catch {}

    // 获取扩展信息
    let extensions: string[] = [];
    try {
      const extRes = await fetch(`${baseUrl}/extensions`, { signal: AbortSignal.timeout(5000) });
      if (extRes.ok) {
        extensions = await extRes.json();
      }
    } catch {}

    return NextResponse.json({
      success: status === 'online',
      data: {
        status,
        serverUrl: baseUrl,
        responseTime,
        systemStats: systemStats ? {
          devices: systemStats.devices?.length || 0,
          vramTotal: systemStats.devices?.[0]?.vram_total || 0,
          vramUsed: systemStats.devices?.[0]?.vram_used || 0,
          os: systemStats.os,
          pythonVersion: systemStats.python_version,
        } : null,
        queueStatus: queueStatus ? {
          running: queueStatus.queue_running?.length || 0,
          pending: queueStatus.queue_pending?.length || 0,
        } : null,
        extensions: extensions.slice(0, 50),
        error,
      }
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `测试连接失败: ${err.message}` },
      { status: 500 }
    );
  }
}
