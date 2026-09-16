import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import {
  stylePromptManager,
  normalizeStylePromptKind,
  normalizeStylePromptCategory,
  DEFAULT_STYLE_PROMPT_CATEGORY,
  MAX_STYLE_PROMPT_CATEGORY,
} from '@/storage/database';

const MAX_NAME = 60;
const MAX_PROMPT = 4000;
const MAX_THUMBNAIL = 400_000;

function toItem(row: any, isAdmin: boolean) {
  const scope = row.userId === null ? 'system' : 'user';
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    category: row.category || DEFAULT_STYLE_PROMPT_CATEGORY,
    thumbnail: row.thumbnail || null,
    scope,
    sortOrder: row.sortOrder,
    editable: scope === 'system' ? isAdmin : true,
    isMine: scope === 'user',
  };
}

/** 按出现顺序汇总分类及条数（内置「风格」永远排第一） */
function collectCategories(items: Array<{ category: string }>) {
  const order: string[] = [];
  const count = new Map<string, number>();
  for (const item of items) {
    if (!count.has(item.category)) order.push(item.category);
    count.set(item.category, (count.get(item.category) || 0) + 1);
  }
  order.sort((a, b) => {
    if (a === DEFAULT_STYLE_PROMPT_CATEGORY) return -1;
    if (b === DEFAULT_STYLE_PROMPT_CATEGORY) return 1;
    return 0;
  });
  return order.map((name) => ({ name, count: count.get(name) || 0 }));
}

/**
 * GET /api/short-dramas/style-prompts?kind=character
 * 返回当前用户可见的提示词（管理员级 + 自己私有的），以及按分类汇总的清单。
 */
export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const kind = normalizeStylePromptKind(request.nextUrl.searchParams.get('kind'));
    if (!kind) return NextResponse.json({ error: 'kind 必须为 character、scene、item、image-storyboard 或 video-storyboard' }, { status: 400 });

    const isAdmin = payload.role === 'admin';
    const rows = await stylePromptManager.list(kind, payload.userId);
    const items = rows.map((row) => toItem(row, isAdmin));

    return NextResponse.json({
      success: true,
      data: {
        kind,
        canManageSystem: isAdmin,
        defaultCategory: DEFAULT_STYLE_PROMPT_CATEGORY,
        categories: collectCategories(items),
        prompts: items,
      },
    });
  } catch (e: any) {
    console.error('[style-prompts] 读取失败:', e);
    return NextResponse.json({ error: e?.message || '读取风格提示词失败' }, { status: 500 });
  }
}

/**
 * POST /api/short-dramas/style-prompts
 * body: { kind, name, prompt, category?, thumbnail? }
 * 管理员新建的是「管理员级」（所有人可用）；会员新建的只有自己可用。
 * category 传新名字即等于新建一个自定义分类。
 */
export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const body = await request.json().catch(() => ({} as any));
    const kind = normalizeStylePromptKind(body?.kind);
    if (!kind) return NextResponse.json({ error: 'kind 不合法' }, { status: 400 });

    const name = String(body?.name ?? '').trim();
    const prompt = String(body?.prompt ?? '').trim();
    const rawCategory = String(body?.category ?? '').replace(/\s+/g, ' ').trim();
    if (rawCategory && Array.from(rawCategory).length > MAX_STYLE_PROMPT_CATEGORY) {
      return NextResponse.json({ error: `分类名过长（上限 ${MAX_STYLE_PROMPT_CATEGORY} 字）` }, { status: 400 });
    }
    const category = normalizeStylePromptCategory(rawCategory);
    const thumbnail = body?.thumbnail ? String(body.thumbnail) : null;
    if (!name) return NextResponse.json({ error: '请填写风格名称' }, { status: 400 });
    if (name.length > MAX_NAME) return NextResponse.json({ error: `风格名称过长（上限 ${MAX_NAME} 字）` }, { status: 400 });
    if (!prompt) return NextResponse.json({ error: '请填写提示词内容' }, { status: 400 });
    if (prompt.length > MAX_PROMPT) return NextResponse.json({ error: `提示词过长（上限 ${MAX_PROMPT} 字）` }, { status: 400 });
    if (thumbnail && thumbnail.length > MAX_THUMBNAIL) return NextResponse.json({ error: '缩略图太大，请换一张更小的图片' }, { status: 400 });

    const isAdmin = payload.role === 'admin';
    const created = await stylePromptManager.create({
      userId: isAdmin ? null : payload.userId,
      kind,
      name,
      prompt,
      category,
      thumbnail,
    });

    return NextResponse.json({
      success: true,
      message: `${isAdmin ? '已新建（所有用户可用）' : '已新建（仅自己可用）'}：「${created.name}」 · 分类「${created.category}」`,
      data: { item: toItem(created, isAdmin) },
    });
  } catch (e: any) {
    console.error('[style-prompts] 新建失败:', e);
    return NextResponse.json({ error: e?.message || '新建风格提示词失败' }, { status: 500 });
  }
}

/**
 * PUT /api/short-dramas/style-prompts
 * body: { id, name?, prompt?, category?, thumbnail? }
 */
export async function PUT(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const body = await request.json().catch(() => ({} as any));
    const id = String(body?.id ?? '').trim();
    if (!id) return NextResponse.json({ error: '缺少提示词 id' }, { status: 400 });

    const row = await stylePromptManager.getById(id);
    if (!row) return NextResponse.json({ error: '提示词不存在' }, { status: 404 });

    const isAdmin = payload.role === 'admin';
    if (row.userId === null && !isAdmin) return NextResponse.json({ error: '只有管理员可以修改管理员级提示词' }, { status: 403 });
    if (row.userId !== null && row.userId !== payload.userId && !isAdmin) return NextResponse.json({ error: '无权修改该提示词' }, { status: 403 });

    const patch: { name?: string; prompt?: string; category?: string; thumbnail?: string | null } = {};
    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: '请填写风格名称' }, { status: 400 });
      if (name.length > MAX_NAME) return NextResponse.json({ error: `风格名称过长（上限 ${MAX_NAME} 字）` }, { status: 400 });
      patch.name = name;
    }
    if (body?.prompt !== undefined) {
      const prompt = String(body.prompt).trim();
      if (!prompt) return NextResponse.json({ error: '请填写提示词内容' }, { status: 400 });
      if (prompt.length > MAX_PROMPT) return NextResponse.json({ error: `提示词过长（上限 ${MAX_PROMPT} 字）` }, { status: 400 });
      patch.prompt = prompt;
    }
    if (body?.category !== undefined) {
      const category = String(body.category).replace(/\s+/g, ' ').trim();
      if (Array.from(category).length > MAX_STYLE_PROMPT_CATEGORY) {
        return NextResponse.json({ error: `分类名过长（上限 ${MAX_STYLE_PROMPT_CATEGORY} 字）` }, { status: 400 });
      }
      patch.category = normalizeStylePromptCategory(category);
    }
    if (body?.thumbnail !== undefined) {
      const thumbnail = body.thumbnail ? String(body.thumbnail) : '';
      if (thumbnail && thumbnail.length > MAX_THUMBNAIL) return NextResponse.json({ error: '缩略图太大，请换一张更小的图片' }, { status: 400 });
      patch.thumbnail = thumbnail || null;
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: '没有需要更新的内容' }, { status: 400 });

    const saved = await stylePromptManager.updateById(id, patch);
    return NextResponse.json({
      success: true,
      message: `已更新「${saved?.name || ''}」${saved ? ` · 分类「${saved.category || DEFAULT_STYLE_PROMPT_CATEGORY}」` : ''}`,
      data: { item: saved ? toItem(saved, isAdmin) : null },
    });
  } catch (e: any) {
    console.error('[style-prompts] 更新失败:', e);
    return NextResponse.json({ error: e?.message || '更新风格提示词失败' }, { status: 500 });
  }
}

/**
 * DELETE /api/short-dramas/style-prompts?id=xxx
 */
export async function DELETE(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const id = request.nextUrl.searchParams.get('id') || '';
    if (!id) return NextResponse.json({ error: '缺少提示词 id' }, { status: 400 });

    const row = await stylePromptManager.getById(id);
    if (!row) return NextResponse.json({ error: '提示词不存在' }, { status: 404 });

    const isAdmin = payload.role === 'admin';
    if (row.userId === null && !isAdmin) return NextResponse.json({ error: '只有管理员可以删除管理员级提示词' }, { status: 403 });
    if (row.userId !== null && row.userId !== payload.userId && !isAdmin) return NextResponse.json({ error: '无权删除该提示词' }, { status: 403 });

    const removed = await stylePromptManager.removeById(id);
    return NextResponse.json({
      success: true,
      message: `已删除「${removed?.name || ''}」`,
      data: { id },
    });
  } catch (e: any) {
    console.error('[style-prompts] 删除失败:', e);
    return NextResponse.json({ error: e?.message || '删除风格提示词失败' }, { status: 500 });
  }
}
