import { NextRequest, NextResponse } from 'next/server';
import { sqlite } from '@/storage/database/sqlite';

export async function GET(request: NextRequest) {
  try {
    console.log('开始数据库迁移：添加 imageGallery 字段...');

    const migrations = [
      { table: 'drama_characters', field: 'image_gallery' },
      { table: 'drama_scenes', field: 'image_gallery' },
      { table: 'drama_items', field: 'image_gallery' },
    ];

    const results = [];

    for (const { table, field } of migrations) {
      try {
        sqlite.prepare(`ALTER TABLE ${table} ADD COLUMN ${field} TEXT`).run();
        results.push({ table, field, status: 'success', message: `✅ ${table}.${field} 添加成功` });
        console.log(`✅ ${table}.${field} 添加成功`);
      } catch (e: any) {
        if (e.message.includes('duplicate column name')) {
          results.push({ table, field, status: 'skip', message: `⏭️  ${table}.${field} 已存在` });
          console.log(`⏭️  ${table}.${field} 已存在`);
        } else {
          results.push({ table, field, status: 'error', message: e.message });
          console.error(`❌ ${table}.${field} 失败:`, e.message);
        }
      }
    }

    console.log('✅ 数据库迁移完成！');

    return NextResponse.json({
      success: true,
      message: '数据库迁移完成',
      results,
    });
  } catch (error: any) {
    console.error('❌ 迁移失败:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
