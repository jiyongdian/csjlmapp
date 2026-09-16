import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { memberOrderManager, userManager, memberLevelManager } from '@/storage/database';

export async function GET(request: NextRequest) {
  try {
    // 检查管理员权限
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status') || undefined;
    const userId = searchParams.get('userId') || undefined;

    // 获取订单列表
    const result = await memberOrderManager.getOrders({
      page,
      limit,
      status,
      userId,
    });

    // 获取用户信息映射
    const users = await userManager.getAllUsers();
    const usersMap = new Map(users.map(u => [u.id, u]));

    // 获取会员等级映射
    const levels = await memberLevelManager.getAll();
    const levelsMap = new Map(levels.map(l => [l.id, l]));

    // 完善订单信息
    const ordersWithDetails = result.orders.map(order => {
      const user = usersMap.get(order.userId);
      const level = levelsMap.get(order.memberLevelId);
      return {
        ...order,
        username: user?.username || '未知用户',
        email: user?.email || '',
        levelName: level?.name || '未知等级',
        levelCode: level?.code || null,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        orders: ordersWithDetails,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit),
        },
      },
    });
  } catch (error) {
    console.error('获取订单列表失败:', error);
    return NextResponse.json({ error: '获取订单列表失败' }, { status: 500 });
  }
}
