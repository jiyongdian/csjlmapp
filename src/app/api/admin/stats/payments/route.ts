import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { memberOrderManager } from '@/storage/database';

export async function GET(request: NextRequest) {
  try {
    // 检查管理员权限
    const authHeader = request.headers.get('authorization');
    const payload = getUserFromToken(authHeader);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const stats = await memberOrderManager.getPaymentStats();

    return NextResponse.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('获取支付统计失败:', error);
    return NextResponse.json({ error: '获取支付统计失败' }, { status: 500 });
  }
}