import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { scriptManager } from '@/storage/database';

/** POST /api/admin/scripts/batch-delete — 批量删除（管理员） */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
    if (payload.role !== 'admin') return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === 'string' && x) : [];
    if (!ids.length) return NextResponse.json({ error: '未选择任何条目' }, { status: 400 });
    if (ids.length > 200) return NextResponse.json({ error: '单次最多删除 200 条' }, { status: 400 });

    let deleted = 0;
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await scriptManager.deleteScript(id);
        deleted++;
      } catch (e) {
        console.error('[Admin Scripts] 删除失败 id=' + id + ':', e);
        failed.push(id);
      }
    }

    return NextResponse.json({
      success: true,
      message: '已删除 ' + deleted + ' 条' + (failed.length ? '，失败 ' + failed.length + ' 条' : ''),
      data: { deleted, failed, total: ids.length },
    });
  } catch (error: any) {
    console.error('[Admin Scripts] 批量删除失败:', error);
    return NextResponse.json({ error: '批量删除失败: ' + (error?.message || '未知错误') }, { status: 500 });
  }
}
