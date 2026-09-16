import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import {
  analyzeExtractTemplate,
  EXTRACT_TEMPLATE_VARIABLES,
  EXTRACT_KIND_META,
  normalizeExtractKind,
  type ExtractKind,
} from '@/lib/extract-template';
import { extractTemplateManager, shortDramaManager } from '@/storage/database';

const MAX_TEMPLATE_LENGTH = 30000;

function toTemplateBrief(row: any) {
  return { id: row.id, name: row.name, template: row.template, isActive: row.isActive, updatedAt: row.updatedAt };
}

function toLevelInfo(row: any) {
  if (!row) return null;
  return { id: row.id, name: row.name, template: row.template, isActive: row.isActive, updatedAt: row.updatedAt };
}

/**
 * 保存到「系统默认」之后，顺手取消当前用户「我的通用 / 仅本作品」的「当前使用」。
 * 三层优先级是 仅本作品 > 我的通用 > 系统默认，上层只要有一条标着「使用中」，
 * 系统默认就会被默默压住——管理员看到「保存成功」，但提取实际用的还是旧模版。
 * 这里只取消「使用中」标记，模版一条都不删，随时可以再「设为当前使用」启用回来。
 */
async function dropUserOverridesForSystem(kind: ExtractKind, userId: string, dramaId: string | null) {
  try {
    return await extractTemplateManager.deactivate(kind, { userId, dramaId, level: 'both' });
  } catch (e) {
    console.warn('[extract-templates] 取消上层覆盖失败（不影响保存结果）:', e);
    return 0;
  }
}

/**
 * GET /api/short-dramas/extract-templates?kind=character&dramaId=xxx
 * 返回某类型提取模版的「当前生效版本」+ 各层级内容（系统 / 用户 / 作品），供编辑弹窗展示。
 */
export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const kind = normalizeExtractKind(request.nextUrl.searchParams.get('kind') || '');
    if (!kind) return NextResponse.json({ error: 'kind 必须为 character、scene 或 item' }, { status: 400 });
    const dramaId = request.nextUrl.searchParams.get('dramaId') || null;

    const resolved = await extractTemplateManager.resolve(kind, { userId: payload.userId, dramaId });
    if (!resolved) {
      return NextResponse.json({ error: '未找到可用的提取模版，请先执行初始化' }, { status: 404 });
    }

    const rows = await extractTemplateManager.list(kind, { userId: payload.userId, dramaId });
    // 只有标记「使用中」的那条才算生效；全部取消后该层回落到上一层，与 resolve 保持一致
    const pickActive = (list: any[]) => list.find((r) => r.isActive === 1) || null;
    const userRows = rows.filter((r) => r.userId === payload.userId && r.dramaId === null);
    const dramaRows = dramaId ? rows.filter((r) => r.userId === payload.userId && r.dramaId === dramaId) : [];
    const levels = {
      system: toLevelInfo(rows.find((r) => r.userId === null)),
      user: toLevelInfo(pickActive(userRows)),
      drama: dramaId ? toLevelInfo(pickActive(dramaRows)) : null,
    };
    /** 模版库：该层级下保存的全部模版，供弹窗列表展示、切换与删除 */
    const library = { user: userRows.map(toTemplateBrief), drama: dramaRows.map(toTemplateBrief) };

    return NextResponse.json({
      success: true,
      data: {
        kind,
        meta: EXTRACT_KIND_META[kind],
        resolved: { template: resolved.template, name: resolved.name, source: resolved.source, id: resolved.id },
        levels,
        library,
        variables: EXTRACT_TEMPLATE_VARIABLES,
        analysis: analyzeExtractTemplate(resolved.template, kind),
        /** 系统默认层所有用户共用，只有管理员可直接编辑 */
        canEditSystem: payload.role === 'admin',
      },
    });
  } catch (e: any) {
    console.error('[extract-templates] 读取失败:', e);
    return NextResponse.json({ error: e?.message || '读取提取模版失败' }, { status: 500 });
  }
}

/**
 * PUT /api/short-dramas/extract-templates
 * body: { kind, level?, dramaId?, name?, template, validateOnly? }
 * level：'system'（系统默认，仅管理员）/ 'user'（用户级）/ 'drama'（作品级）。
 * 不传 level 时向后兼容：带 dramaId 视为作品级，否则用户级。
 */
export async function PUT(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const body = await request.json().catch(() => ({} as any));
    const kind = normalizeExtractKind(body?.kind);
    if (!kind) return NextResponse.json({ error: 'kind 必须为 character、scene 或 item' }, { status: 400 });

    const template = String(body?.template ?? '');
    if (!template.trim()) return NextResponse.json({ error: '模版内容不能为空' }, { status: 400 });
    if (template.length > MAX_TEMPLATE_LENGTH) {
      return NextResponse.json({ error: `模版过长（上限 ${MAX_TEMPLATE_LENGTH} 字）` }, { status: 400 });
    }

    const analysis = analyzeExtractTemplate(template, kind as ExtractKind);
    if (body?.validateOnly === true) {
      return NextResponse.json({ success: true, data: { analysis } });
    }

    const rawLevel = String(body?.level || '').trim().toLowerCase();
    const level: 'system' | 'user' | 'drama' =
      rawLevel === 'system' || rawLevel === 'drama' || rawLevel === 'user'
        ? rawLevel
        : body?.dramaId
          ? 'drama'
          : 'user';

    // 系统默认层所有用户共用，只有管理员能改
    if (level === 'system' && payload.role !== 'admin') {
      return NextResponse.json({ error: '只有管理员可以修改系统默认模版' }, { status: 403 });
    }

    const dramaId = body?.dramaId ? String(body.dramaId) : null;
    if (level === 'drama') {
      if (!dramaId) return NextResponse.json({ error: '保存作品级模版时必须提供 dramaId' }, { status: 400 });
      const drama = await shortDramaManager.getById(dramaId);
      if (!drama) return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
      if (drama.userId !== payload.userId && payload.role !== 'admin') {
        return NextResponse.json({ error: '无权限修改该作品的模版' }, { status: 403 });
      }
    }
    if (analysis.missingRequired.length > 0) {
      return NextResponse.json(
        { error: `模版缺少必备变量：${analysis.missingRequired.map((v) => '{{' + v + '}}').join('、')}，否则模型拿不到正文`, analysis },
        { status: 400 },
      );
    }
    if (analysis.unknown.length > 0) {
      return NextResponse.json(
        { error: `模版包含不支持的变量：${analysis.unknown.map((v) => '{{' + v + '}}').join('、')}`, analysis },
        { status: 400 },
      );
    }

    const templateId = body?.templateId ? String(body.templateId) : null;
    const wantCreate = body?.createNew === true;

    // 更新已有模版：归属校验后再写
    if (templateId) {
      const existing = await extractTemplateManager.getById(templateId);
      if (!existing) return NextResponse.json({ error: '模版不存在' }, { status: 404 });
      if (existing.userId === null && payload.role !== 'admin') {
        return NextResponse.json({ error: '只有管理员可以修改系统默认模版' }, { status: 403 });
      }
      if (existing.userId !== null && existing.userId !== payload.userId && payload.role !== 'admin') {
        return NextResponse.json({ error: '无权限修改该模版' }, { status: 403 });
      }
      const saved = await extractTemplateManager.updateById(templateId, { name: body?.name, template });
      const targetIsSystem = level === 'system' || existing.userId === null;
      const cleared = targetIsSystem ? await dropUserOverridesForSystem(kind, payload.userId, dramaId) : 0;
      return NextResponse.json({
        success: true,
        message: targetIsSystem
          ? `已保存模版「${saved?.name || ''}」${cleared > 0 ? '，并取消了你上层的「当前使用」，系统默认立即生效' : ''}`
          : `已保存模版「${saved?.name || ''}」`,
        data: { id: saved?.id, name: saved?.name, kind, level, dramaId: saved?.dramaId, analysis, clearedOverrides: cleared },
      });
    }

    // 新建一条模版：同层可以有多个，互不覆盖
    if (wantCreate && level !== 'system') {
      const created = await extractTemplateManager.create({
        userId: payload.userId,
        dramaId: level === 'drama' ? dramaId : null,
        kind: kind as ExtractKind,
        name: body?.name ? String(body.name) : null,
        template,
      });
      return NextResponse.json({
        success: true,
        message: `已新建模版「${created.name}」`,
        data: { id: created.id, name: created.name, kind, level, dramaId: created.dramaId, analysis },
      });
    }

    const saved = await extractTemplateManager.upsert({
      userId: level === 'system' ? null : payload.userId,
      dramaId: level === 'drama' ? dramaId : null,
      kind: kind as ExtractKind,
      name: body?.name ? String(body.name) : null,
      template,
    });

    // 存的是系统默认，就把自己上层的「当前使用」撤掉，否则这次保存等于白存
    const cleared = level === 'system' ? await dropUserOverridesForSystem(kind, payload.userId, dramaId) : 0;

    return NextResponse.json({
      success: true,
      message:
        level === 'system'
          ? cleared > 0
            ? '已保存为系统默认模版（所有用户共用），并取消了你「我的通用 / 仅本作品」的当前使用，系统默认立即生效'
            : '已保存为系统默认模版（所有用户共用）'
          : level === 'drama'
            ? '已保存为本作品模版'
            : '已保存为我的模版',
      data: { id: saved.id, name: saved.name, kind: saved.kind, level, dramaId: saved.dramaId, analysis, clearedOverrides: cleared },
    });
  } catch (e: any) {
    console.error('[extract-templates] 保存失败:', e);
    return NextResponse.json({ error: e?.message || '保存提取模版失败' }, { status: 500 });
  }
}

/**
 * POST /api/short-dramas/extract-templates
 * body: { action: 'activate', id }
 * 把某条模版设为其所在层级（我的通用 / 仅本作品）的「当前使用」。
 */
export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const body = await request.json().catch(() => ({} as any));
    const id = body?.id ? String(body.id) : '';
    if (!id) return NextResponse.json({ error: '缺少模版 id' }, { status: 400 });

    const row = await extractTemplateManager.getById(id);
    if (!row) return NextResponse.json({ error: '模版不存在' }, { status: 404 });
    if (row.userId === null) return NextResponse.json({ error: '系统默认模版始终可用，无需设为使用' }, { status: 400 });
    if (row.userId !== payload.userId && payload.role !== 'admin') {
      return NextResponse.json({ error: '无权限操作该模版' }, { status: 403 });
    }

    const saved = await extractTemplateManager.setActive(id);
    return NextResponse.json({
      success: true,
      message: `已把「${saved?.name || ''}」设为当前使用`,
      data: { id, name: saved?.name },
    });
  } catch (e: any) {
    console.error('[extract-templates] 设为使用失败:', e);
    return NextResponse.json({ error: e?.message || '设为使用失败' }, { status: 500 });
  }
}

/**
 * DELETE /api/short-dramas/extract-templates?id=xxx
 * 删除一条模版（系统默认层不可删除）。
 */
export async function DELETE(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const id = request.nextUrl.searchParams.get('id') || '';
    if (!id) return NextResponse.json({ error: '缺少模版 id' }, { status: 400 });

    const row = await extractTemplateManager.getById(id);
    if (!row) return NextResponse.json({ error: '模版不存在' }, { status: 404 });
    if (row.userId === null) return NextResponse.json({ error: '系统默认模版不能删除' }, { status: 400 });
    if (row.userId !== payload.userId && payload.role !== 'admin') {
      return NextResponse.json({ error: '无权限删除该模版' }, { status: 403 });
    }

    const removed = await extractTemplateManager.removeById(id);
    return NextResponse.json({
      success: true,
      message: `已删除模版「${removed?.name || ''}」`,
      data: { id },
    });
  } catch (e: any) {
    console.error('[extract-templates] 删除失败:', e);
    return NextResponse.json({ error: e?.message || '删除模版失败' }, { status: 500 });
  }
}
