import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { novelManager, userManager } from '@/storage/database';
import { syncNovelDetails } from '@/lib/novel-detail-sync';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    if (payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const { id } = await params;
    const novel = await novelManager.getById(id);
    if (!novel) {
      return NextResponse.json({ error: '小说不存在' }, { status: 404 });
    }

    // 获取所有者信息
    const owner = await userManager.getUserById(novel.userId);

    return NextResponse.json({
      success: true,
      data: {
        ...novel,
        ownerName: owner?.username || '未知用户',
        ownerEmail: owner?.email || '',
      },
    });
  } catch (error) {
    console.error('获取小说详情失败:', error);
    return NextResponse.json({ error: '获取小说详情失败' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    if (payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    // 只允许管理员更新的字段
    const allowedFields: Record<string, unknown> = {};
    if (body.title !== undefined) allowedFields.title = body.title;
    if (body.description !== undefined) allowedFields.description = body.description;
    if (body.category !== undefined) allowedFields.category = body.category;
    if (body.status !== undefined) allowedFields.status = body.status;
    if (body.isPublic !== undefined) allowedFields.isPublic = body.isPublic;
    if (body.totalChapters !== undefined) allowedFields.totalChapters = body.totalChapters;
    if (body.currentChapters !== undefined) allowedFields.currentChapters = body.currentChapters;
    if (body.chapters !== undefined) allowedFields.chapters = body.chapters;
    if (body.idea !== undefined) allowedFields.idea = body.idea;
    if (body.structure !== undefined) allowedFields.structure = body.structure;
    if (body.genderTarget !== undefined) allowedFields.genderTarget = body.genderTarget;
    if (body.narrativePerspective !== undefined) allowedFields.narrativePerspective = body.narrativePerspective;
    if (body.tone !== undefined) allowedFields.tone = body.tone;
    if (body.protagonist !== undefined) allowedFields.protagonist = body.protagonist;
    if (body.supportingCharacterName !== undefined) allowedFields.supportingCharacterName = body.supportingCharacterName;

    const updated = await novelManager.adminUpdate(id, allowedFields);
    if (!updated) {
      return NextResponse.json({ error: '小说不存在' }, { status: 404 });
    }

    // 异步同步到子表
    const novel = await novelManager.getById(id);
    if (novel) {
      syncNovelDetails(id, novel.userId, body).catch((e: unknown) =>
        console.warn('[Admin Novels PUT] Detail sync failed:', e)
      );
    }

    return NextResponse.json({
      success: true,
      data: updated,
      message: '小说更新成功',
    });
  } catch (error) {
    console.error('更新小说失败:', error);
    return NextResponse.json({ error: '更新小说失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    if (payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const { id } = await params;
    const novel = await novelManager.getById(id);
    if (!novel) {
      return NextResponse.json({ error: '小说不存在' }, { status: 404 });
    }

    await novelManager.delete(id, novel.userId);

    return NextResponse.json({
      success: true,
      message: '小说已删除',
    });
  } catch (error) {
    console.error('删除小说失败:', error);
    return NextResponse.json({ error: '删除小说失败' }, { status: 500 });
  }
}