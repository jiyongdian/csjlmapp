import { NextRequest } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { scriptManager } from '@/storage/database';

/**
 * GET /api/novel/script/history?scriptId=xxx - 获取剧本历史版本列表
 * GET /api/novel/script/history?historyId=xxx - 获取单个历史版本详情
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const payload = getUserFromToken(authHeader || '');
    if (!payload) {
      return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const { searchParams } = new URL(request.url);
    const scriptId = searchParams.get('scriptId');
    const historyId = searchParams.get('historyId');

    if (historyId) {
      const history = await scriptManager.getHistory(historyId);
      if (!history) {
        return new Response(JSON.stringify({ error: '历史版本不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      const script = await scriptManager.getScriptById(history.scriptId);
      if (!script || (script.userId !== payload.userId && payload.role !== 'admin')) {
        return new Response(JSON.stringify({ error: '无权访问' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true, data: history }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (!scriptId) {
      return new Response(JSON.stringify({ error: '缺少 scriptId' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const script = await scriptManager.getScriptById(scriptId);
    if (!script || (script.userId !== payload.userId && payload.role !== 'admin')) {
      return new Response(JSON.stringify({ error: '无权访问' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const list = await scriptManager.listHistory(scriptId);
    return new Response(JSON.stringify({ success: true, data: list }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : '服务器错误';
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * POST /api/novel/script/history - 恢复到某个历史版本
 * Body: { historyId }
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const payload = getUserFromToken(authHeader || '');
    if (!payload) {
      return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const body = await request.json();
    const { historyId } = body;
    if (!historyId) {
      return new Response(JSON.stringify({ error: '缺少 historyId' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const history = await scriptManager.getHistory(historyId);
    if (!history) {
      return new Response(JSON.stringify({ error: '历史版本不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const script = await scriptManager.getScriptById(history.scriptId);
    if (!script || (script.userId !== payload.userId && payload.role !== 'admin')) {
      return new Response(JSON.stringify({ error: '无权访问' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const restored = await scriptManager.restoreFromHistory(historyId);
    return new Response(JSON.stringify({ success: true, data: restored }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : '服务器错误';
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * DELETE /api/novel/script/history?historyId=xxx - 删除某个历史版本
 */
export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const payload = getUserFromToken(authHeader || '');
    if (!payload) {
      return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const { searchParams } = new URL(request.url);
    const historyId = searchParams.get('historyId');
    if (!historyId) {
      return new Response(JSON.stringify({ error: '缺少 historyId' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const history = await scriptManager.getHistory(historyId);
    if (!history) {
      return new Response(JSON.stringify({ error: '历史版本不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const script = await scriptManager.getScriptById(history.scriptId);
    if (!script || (script.userId !== payload.userId && payload.role !== 'admin')) {
      return new Response(JSON.stringify({ error: '无权访问' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    await scriptManager.deleteHistory(historyId);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : '服务器错误';
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
