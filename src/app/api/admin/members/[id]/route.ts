import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { userManager, memberLevelManager, memberOrderManager, novelManager } from '@/storage/database';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { id } = await params;
    const member = await userManager.getUserById(id);

    if (!member) {
      return NextResponse.json({ error: '会员不存在' }, { status: 404 });
    }

    // 获取会员等级信息
    let memberLevelName = '免费用户';
    let memberLevelCode = null;
    let memberLevel = null;
    if (member.memberLevelId) {
      const level = await memberLevelManager.getById(member.memberLevelId);
      if (level) {
        memberLevelName = level.name;
        memberLevelCode = level.code;
        memberLevel = level;
      }
    }

    // 获取会员订单历史
    const orders = await memberOrderManager.getUserOrders(id);
    
    // 获取会员的小说数量
    const novels = await novelManager.getUserNovels(id);
    
    // 获取章节使用情况
    const totalChaptersUsed = await novelManager.getUserTotalChapters(id);
    // 计算有效章节上限
    const rawChapterLimit = member.chapterLimit;
    const effectiveChapterLimit = rawChapterLimit === 0 ? 99999 : (rawChapterLimit ?? memberLevel?.chapterLimit ?? 11);

    // 返回完整会员信息
    return NextResponse.json({
      success: true,
      data: {
        ...member,
        memberLevelName,
        memberLevelCode,
        memberLevel,
        orders,
        novelsCount: novels.total,
        totalChaptersUsed,
        _originalChapterLimit: rawChapterLimit, // 用户原始设置（null=默认，0=无限制）
        chapterLimit: effectiveChapterLimit,
        remainingChapters: rawChapterLimit === 0 ? 99999 : Math.max(0, effectiveChapterLimit - totalChaptersUsed),
        createdAt: member.createdAt,
      },
    });
  } catch (error) {
    console.error('获取会员详情失败:', error);
    return NextResponse.json({ error: '获取会员详情失败' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const member = await userManager.getUserById(id);
    if (!member) {
      return NextResponse.json({ error: '会员不存在' }, { status: 404 });
    }

    // 构建更新对象，确保数据类型正确
    const updateData: any = {};
    
    if (body.nickname !== undefined) {
      updateData.nickname = body.nickname;
    }
    
    // 转换 isActive: boolean -> number
    if (body.isActive !== undefined) {
      updateData.isActive = body.isActive ? 1 : 0;
    }
    
    if (body.memberStatus !== undefined) {
      updateData.memberStatus = body.memberStatus;
    }
    
    // 设置会员等级
    if (body.memberLevelId !== undefined) {
      if (body.memberLevelId) {
        const level = await memberLevelManager.getById(body.memberLevelId);
        if (level) {
          updateData.memberLevelId = body.memberLevelId;
          updateData.memberStatus = 'active';
          // 计算会员到期时间
          const expireDate = new Date();
          expireDate.setDate(expireDate.getDate() + level.duration);
          // 转换 memberExpireAt: Date -> ISO string
          updateData.memberExpireAt = expireDate.toISOString();
        }
      } else {
        // 清除会员等级
        updateData.memberLevelId = null;
        updateData.memberStatus = 'inactive';
        updateData.memberExpireAt = null;
      }
    }

    // 设置章节上限（0表示无限制）
    if (body.chapterLimit !== undefined) {
      updateData.chapterLimit = body.chapterLimit === 0 ? 0 : (body.chapterLimit || null);
    }

    // 更新会员信息
    await userManager.updateUser(id, updateData);

    // 获取更新后的会员信息
    const updatedMember = await userManager.getUserById(id);
    
    return NextResponse.json({ 
      success: true, 
      message: '会员信息更新成功',
      data: updatedMember 
    });
  } catch (error) {
    console.error('更新会员失败:', error);
    return NextResponse.json({ error: '更新会员失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { id } = await params;
    
    // 不允许删除自己
    if (payload.userId === id) {
      return NextResponse.json({ error: '不能删除自己' }, { status: 400 });
    }

    await userManager.deleteUser(id);

    return NextResponse.json({ success: true, message: '会员删除成功' });
  } catch (error) {
    console.error('删除会员失败:', error);
    return NextResponse.json({ error: '删除会员失败' }, { status: 500 });
  }
}