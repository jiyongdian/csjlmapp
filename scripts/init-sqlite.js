// 简单的数据库初始化脚本
require('dotenv').config();
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

async function init() {
  const db = new Database('novel.db');
  
  // 删除旧表（重新初始化）
  db.exec(`DROP TABLE IF EXISTS users`);
  db.exec(`DROP TABLE IF EXISTS member_levels`);
  db.exec(`DROP TABLE IF EXISTS member_orders`);
  db.exec(`DROP TABLE IF EXISTS novels`);
  db.exec(`DROP TABLE IF EXISTS ai_configs`);
  db.exec(`DROP TABLE IF EXISTS invite_codes`);
  
  // 创建用户表（使用蛇形命名，匹配Drizzle ORM默认转换）
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT,
      avatar TEXT,
      role TEXT DEFAULT 'user',
      member_level_id TEXT,
      member_expire_at TEXT,
      member_status TEXT DEFAULT 'inactive',
      chapter_limit INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  
  // 创建会员等级表
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_levels (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price INTEGER DEFAULT 0,
      duration INTEGER DEFAULT 0,
      features TEXT,
      chapter_limit INTEGER DEFAULT 11,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  
  // 创建会员订单表
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      member_level_id TEXT NOT NULL,
      order_no TEXT UNIQUE NOT NULL,
      amount INTEGER DEFAULT 0,
      payment_method TEXT,
      payment_status TEXT DEFAULT 'pending',
      payment_time TEXT,
      start_time TEXT,
      end_time TEXT,
      created_at TEXT NOT NULL
    )
  `);
  
  // 创建小说表
  db.exec(`
    CREATE TABLE IF NOT EXISTS novels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      gender_target TEXT,
      tone TEXT,
      protagonist TEXT,
      total_chapters INTEGER DEFAULT 0,
      current_chapters INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      idea TEXT,
      structure TEXT,
      chapters TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  
  // 创建AI配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_configs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      provider TEXT,
      api_url TEXT,
      api_key TEXT,
      model TEXT,
      temperature INTEGER DEFAULT 85,
      max_tokens INTEGER DEFAULT 8192,
      scope TEXT DEFAULT 'system',
      is_default INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  
  // 创建邀请码表
  db.exec(`
    CREATE TABLE IF NOT EXISTS invite_codes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      description TEXT,
      level_type TEXT,
      member_level_id TEXT NOT NULL,
      max_uses INTEGER DEFAULT 1,
      current_uses INTEGER DEFAULT 0,
      used_by TEXT,
      is_used INTEGER DEFAULT 0,
      is_used_up INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      expires_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  
  const now = new Date().toISOString();
  
  // 创建会员等级
  const freeLevelId = 'free-level-1';
  const vipLevelId = 'vip-level-1';
  const svipLevelId = 'svip-level-1';
  
  db.prepare(`
    INSERT INTO member_levels (id, code, name, description, price, duration, features, chapter_limit, sort_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(freeLevelId, 'free', '免费用户', '免费体验会员', 0, 0, JSON.stringify(['基础小说生成', '最多11章']), 11, 1, 1, now, now);
  
  db.prepare(`
    INSERT INTO member_levels (id, code, name, description, price, duration, features, chapter_limit, sort_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(vipLevelId, 'vip', 'VIP会员', '高级会员', 9900, 30, JSON.stringify(['高级小说生成', '最多999章', '优先AI处理']), 999, 2, 1, now, now);
  
  db.prepare(`
    INSERT INTO member_levels (id, code, name, description, price, duration, features, chapter_limit, sort_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(svipLevelId, 'svip', 'SVIP会员', '超级会员', 29900, 30, JSON.stringify(['顶级小说生成', '最多9999章', '优先AI处理', '专属客服']), 9999, 3, 1, now, now);
  
  // 创建管理员账号
  const passwordHash = bcrypt.hashSync('Admin@123456', 10);
  const expireDate = new Date('2099-12-31T00:00:00.000Z').toISOString();
  
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, nickname, role, member_level_id, member_expire_at, member_status, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('admin-1', 'admin', 'admin@example.com', passwordHash, '系统管理员', 'admin', svipLevelId, expireDate, 'active', 1, now, now);
  
  // 创建默认AI配置
  db.prepare(`
    INSERT INTO ai_configs (id, name, provider, api_url, api_key, model, temperature, max_tokens, scope, is_default, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('ai-config-1', '创世纪联盟', 'deepseek', 'https://api.deepseek.com/v1', '', 'deepseek-chat', 85, 8192, 'system', 1, 1, now, now);
  
  console.log('✅ 数据库初始化完成!');
  console.log('📧 管理员邮箱: admin@example.com');
  console.log('🔑 管理员密码: Admin@123456');
  
  db.close();
}

init();
