import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import Database from 'better-sqlite3';

export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const sqlite = new Database(String(process.env.DB_PATH || '').trim() || 'novel.db', { readonly: true });
    
    const scriptsCount = sqlite.prepare('SELECT count(*) as cnt FROM scripts').get() as any;
    const scriptsSample = sqlite.prepare('SELECT id, novel_id, user_id, status, created_at FROM scripts LIMIT 5').all();
    
    const dramasCount = sqlite.prepare('SELECT count(*) as cnt FROM short_dramas').get() as any;
    const dramasSample = sqlite.prepare('SELECT * FROM short_dramas LIMIT 5').all();
    
    const novelsCount = sqlite.prepare('SELECT count(*) as cnt FROM novels').get() as any;
    const novelsSample = sqlite.prepare('SELECT id, user_id, title, status FROM novels LIMIT 5').all();

    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();

    // 获取 short_dramas 表的实际列信息
    const dramaColumns = sqlite.prepare("PRAGMA table_info(short_dramas)").all();
    const episodeColumns = sqlite.prepare("PRAGMA table_info(short_drama_episodes)").all();

    sqlite.close();

    return NextResponse.json({
      success: true,
      data: {
        tables: tables.map((t: any) => t.name),
        scripts: { count: scriptsCount?.cnt, sample: scriptsSample },
        shortDramas: { count: dramasCount?.cnt, sample: dramasSample, columns: dramaColumns },
        shortDramaEpisodes: { columns: episodeColumns },
        novels: { count: novelsCount?.cnt, sample: novelsSample },
        dbPath: 'novel.db (relative to CWD)',
      },
    });
  } catch (error: any) {
    console.error('Debug data error:', error);
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}
