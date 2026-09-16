import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { analyzeExtractTemplate, normalizeExtractKind } from '@/lib/extract-template';
import { extractTemplateManager, shortDramaManager } from '@/storage/database';

/**
 * POST /api/short-dramas/extract-templates/reset
 * body: { kind, dramaId?, level? }
 * 用户层 / 作品层：只取消「当前使用」，让该层不再覆盖上一层（用户级 → 系统默认），
 * **已保存的模版全部保留**，可随时在弹窗里点「设为当前使用」重新启用。
 * level: 'user' | 'drama' | 'both'（默认 both，即彻底回落到系统默认）。
 */
export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const body = await request.json().catch(() => ({} as any));
    const kind = normalizeExtractKind(body?.kind);
    if (!kind) return NextResponse.json({ error: 'kind 必须为 character、scene 或 item' }, { status: 400 });

    const rawLevel = String(body?.level || '').trim().toLowerCase();
    const level: 'system' | 'user' | 'drama' | 'both' =
      rawLevel === 'system' || rawLevel === 'user' || rawLevel === 'drama' || rawLevel === 'both' ? rawLevel : 'both';
    if (level === 'drama' && !body?.dramaId) {
      return NextResponse.json({ error: '按作品恢复默认模版时必须提供 dramaId' }, { status: 400 });
    }
    if (level === 'system' && payload.role !== 'admin') {
      return NextResponse.json({ error: '只有管理员可以恢复系统默认模版' }, { status: 403 });
    }

    const dramaId = body?.dramaId ? String(body.dramaId) : null;
    if (dramaId) {
      const drama = await shortDramaManager.getById(dramaId);
      if (!drama) return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
      if (drama.userId !== payload.userId && payload.role !== 'admin') {
        return NextResponse.json({ error: '无权限修改该作品的模版' }, { status: 403 });
      }
    }

    // 系统层没有上一层可回落，所谓「恢复默认」= 写回内置出厂内容
    // 用户层 / 作品层：只把「当前使用」取消掉（模版一条都不删），让该层回落到上一层
    let removed = 0;
    let kept = 0;
    let clearedOverrides = 0;
    if (level === 'system') {
      const restored = await extractTemplateManager.restoreSystemDefault(kind);
      removed = restored ? 1 : 0;
      // 系统默认没有「上一层」可回落，但用户自己「我的通用 / 仅本作品」里若还留着
      // 「当前使用」，系统默认就会被默默压住。这里一并取消，让「恢复默认」真的生效。
      clearedOverrides = await extractTemplateManager.deactivate(kind, {
        userId: payload.userId,
        dramaId,
        level: 'both',
      });
    } else {
      const scopes: (string | null)[] = level === 'user' ? [null] : level === 'drama' ? [dramaId] : [null, dramaId];
      for (const scope of scopes) {
        if (scope === undefined) continue;
        kept += (await extractTemplateManager.listScope(kind, { userId: payload.userId, dramaId: scope })).length;
      }
      removed = await extractTemplateManager.deactivate(kind, { userId: payload.userId, dramaId, level });
    }
    const resolved = await extractTemplateManager.resolve(kind, { userId: payload.userId, dramaId });

    return NextResponse.json({
      success: true,
      message:
        level === 'system'
          ? clearedOverrides > 0
            ? `已把系统默认模版恢复为内置出厂内容，并取消了「我的通用 / 仅本作品」的当前使用（${clearedOverrides} 条模版都保留着），系统默认已生效`
            : '已把系统默认模版恢复为内置出厂内容，系统默认已生效'
          : removed > 0
            ? kept > 0
              ? `已恢复默认模版，你保存的 ${kept} 条模版都保留着，可随时「设为当前使用」重新启用`
              : '已恢复默认模版'
            : '当前没有启用中的自定义模版，已是默认模版',
      data: resolved
        ? {
            kind,
            level,
            removed,
            kept,
            clearedOverrides,
            resolved: { template: resolved.template, name: resolved.name, source: resolved.source, id: resolved.id },
            analysis: analyzeExtractTemplate(resolved.template, kind),
          }
        : { kind, level, removed, kept, clearedOverrides, resolved: null },
    });
  } catch (e: any) {
    console.error('[extract-templates/reset] 失败:', e);
    return NextResponse.json({ error: e?.message || '恢复默认模版失败' }, { status: 500 });
  }
}
