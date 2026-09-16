import { NextResponse } from 'next/server';
import { initDatabase } from '@/storage/database/init';

export async function POST() {
  try {
    await initDatabase();
    return NextResponse.json({ 
      success: true, 
      message: '数据库初始化完成' 
    });
  } catch (error) {
    console.error('数据库初始化失败:', error);
    return NextResponse.json({ 
      success: false, 
      error: String(error) 
    }, { status: 500 });
  }
}