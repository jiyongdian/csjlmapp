import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { memberLevelManager, userManager } from '@/storage/database';

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
    const { memberLevelId, memberExpireAt } = body;

    // 获取用户
    const member = await userManager.getUserById(id);
    if (!member) {
      return NextResponse.json({ error: '会员不存在' }, { status: 404 });
    }

    // 获取等级信息
    if (memberLevelId) {
      const level = await memberLevelManager.getById(memberLevelId);
      if (!level) {
        return NextResponse.json({ error: '会员等级不存在' }, { status: 404 });
      }

      // 计算到期时间
      const now = new Date();
      const expireAt = new Date(memberExpireAt || now);
      if (!memberExpireAt) {
        expireAt.setDate(expireAt.getDate() + level.duration);
      }

      // 更新用户会员等级
      await userManager.updateUser(id, {
        memberLevelId,
        memberExpireAt: expireAt.toISOString(),
        memberStatus: 'active',
      } as any);
    } else {
      // 移除会员等级
      await userManager.updateUser(id, {
        memberLevelId: null,
        memberExpireAt: null,
        memberStatus: 'inactive',
      } as any);
    }

    return NextResponse.json({ success: true, message: '会员等级更新成功' });
  } catch (error) {
    console.error('更新会员等级失败:', error);
    return NextResponse.json({ error: '更新会员等级失败' }, { status: 500 });
  }
}
