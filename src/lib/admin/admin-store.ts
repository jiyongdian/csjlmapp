// 管理后台数据层（better-sqlite3 原生）
import { sqlite } from '@/storage/database/sqlite';

function genId(prefix: string): string {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}
function now(): string { return new Date().toISOString(); }

// ---------- 概览统计 ----------
export function getStats() {
  const count = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
  const totalChapters = (sqlite.prepare('SELECT COALESCE(SUM(current_chapters),0) AS n FROM novels').get() as { n: number }).n;
  const activeUsers = (sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE is_active = 1").get() as { n: number }).n;
  const unreadMsgs = count('SELECT COUNT(*) AS n FROM messages WHERE is_read = 0');
  return {
    users: count('SELECT COUNT(*) AS n FROM users'),
    activeUsers,
    novels: count('SELECT COUNT(*) AS n FROM novels'),
    totalChapters,
    posts: count('SELECT COUNT(*) AS n FROM community_posts'),
    comments: count('SELECT COUNT(*) AS n FROM community_comments'),
    messages: count('SELECT COUNT(*) AS n FROM messages'),
    unreadMsgs,
    auditLogs: count('SELECT COUNT(*) AS n FROM admin_audit_log'),
    novelImages: 0,
    communityImageBytes: 0,
  };
}

// ---------- 用户管理 ----------
export interface AdminUser {
  id: string; username: string; email: string; nickname: string; role: string;
  isActive: boolean; memberLevelId: string; memberStatus: string; chapterLimit: number;
  novelCount: number; chapterCount: number; createdAt: string;
}
export function listUsers(input: { q?: string; page?: number; pageSize?: number; role?: string } = {}) {
  const { q, page = 1, pageSize = 20, role } = input;
  const conds: string[] = []; const args: unknown[] = [];
  if (q) { conds.push('(u.username LIKE ? OR u.email LIKE ? OR u.nickname LIKE ?)'); args.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
  if (role) { conds.push('u.role = ?'); args.push(role); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const total = (sqlite.prepare('SELECT COUNT(*) AS n FROM users u ' + where).get(...args) as { n: number }).n;
  const rows = sqlite.prepare(
    `SELECT u.*,
      (SELECT COUNT(*) FROM novels n WHERE n.user_id = u.id) AS novel_count,
      (SELECT COALESCE(SUM(n.current_chapters),0) FROM novels n WHERE n.user_id = u.id) AS chapter_count
    FROM users u ` + where + ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?'
  ).all(...args, pageSize, (page - 1) * pageSize) as unknown as (Record<string, unknown> & {
    id: string; username: string; email: string; nickname: string | null; role: string;
    is_active: number; member_level_id: string | null; member_status: string | null; chapter_limit: number | null;
    novel_count: number; chapter_count: number; created_at: string;
  })[];
  return {
    total,
    items: rows.map((r) => ({
      id: r.id, username: r.username, email: r.email, nickname: r.nickname ?? r.username,
      role: r.role, isActive: !!r.is_active, memberLevelId: r.member_level_id ?? '',
      memberStatus: r.member_status ?? 'inactive', chapterLimit: r.chapter_limit ?? 0,
      novelCount: r.novel_count, chapterCount: r.chapter_count, createdAt: r.created_at,
    })),
  };
}

export function toggleUserActive(userId: string, active: boolean): boolean {
  const r = sqlite.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(active ? 1 : 0, userId);
  return r.changes > 0;
}
export function setUserRole(userId: string, role: string): boolean {
  const r = sqlite.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  return r.changes > 0;
}

// ---------- 书城作品管理 ----------
export function listAdminNovels(input: { q?: string; page?: number; pageSize?: number } = {}) {
  const { q, page = 1, pageSize = 20 } = input;
  const conds: string[] = []; const args: unknown[] = [];
  if (q) { conds.push('n.title LIKE ?'); args.push('%' + q + '%'); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const total = (sqlite.prepare('SELECT COUNT(*) AS n FROM novels n ' + where).get(...args) as { n: number }).n;
  const rows = sqlite.prepare(
    `SELECT n.id, n.title, n.user_id, n.category, n.status, n.current_chapters, n.total_chapters, n.cover_image, n.created_at, n.updated_at,
      u.nickname, u.username
    FROM novels n LEFT JOIN users u ON u.id = n.user_id ` + where + ' ORDER BY n.updated_at DESC LIMIT ? OFFSET ?'
  ).all(...args, pageSize, (page - 1) * pageSize) as unknown as {
    id: string; title: string; user_id: string; category: string | null; status: string | null;
    current_chapters: number; total_chapters: number; cover_image: string | null; created_at: string; updated_at: string | null;
    nickname: string | null; username: string | null;
  }[];
  return {
    total,
    items: rows.map((r) => ({
      id: r.id, title: r.title, ownerId: r.user_id, category: r.category ?? '', status: r.status ?? 'draft',
      currentChapters: r.current_chapters, totalChapters: r.total_chapters, coverImage: r.cover_image,
      createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at,
      ownerName: r.nickname ?? r.username ?? '未知',
    })),
  };
}
export function setNovelStatus(novelId: string, status: string): boolean {
  const r = sqlite.prepare('UPDATE novels SET status = ? WHERE id = ?').run(status, novelId);
  return r.changes > 0;
}

// ---------- 社区帖子 / 评论管理 ----------
export function listPosts(input: { q?: string; page?: number; pageSize?: number } = {}) {
  const { q, page = 1, pageSize = 20 } = input;
  const conds: string[] = []; const args: unknown[] = [];
  if (q) { conds.push('(p.title LIKE ? OR p.content LIKE ?)'); args.push('%' + q + '%', '%' + q + '%'); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const total = (sqlite.prepare('SELECT COUNT(*) AS n FROM community_posts p ' + where).get(...args) as { n: number }).n;
  const rows = sqlite.prepare(
    `SELECT p.id, p.title, p.content, p.topic_key, p.created_at, p.user_id,
      (SELECT COUNT(*) FROM community_post_likes l WHERE l.post_id = p.id) AS likes,
      (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id) AS comments,
      u.nickname, u.username
    FROM community_posts p LEFT JOIN users u ON u.id = p.user_id ` + where + ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?'
  ).all(...args, pageSize, (page - 1) * pageSize) as unknown as {
    id: string; title: string; content: string; topic_key: string | null; created_at: string; user_id: string;
    likes: number; comments: number; nickname: string | null; username: string | null;
  }[];
  return {
    total,
    items: rows.map((r) => ({
      id: r.id, title: r.title, content: r.content, topicKey: r.topic_key ?? '', createdAt: r.created_at,
      ownerId: r.user_id, ownerName: r.nickname ?? r.username ?? '未知', likes: r.likes, comments: r.comments,
    })),
  };
}
export function listComments(input: { q?: string; page?: number; pageSize?: number } = {}) {
  const { q, page = 1, pageSize = 20 } = input;
  const conds: string[] = []; const args: unknown[] = [];
  if (q) { conds.push('c.content LIKE ?'); args.push('%' + q + '%'); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const total = (sqlite.prepare('SELECT COUNT(*) AS n FROM community_comments c ' + where).get(...args) as { n: number }).n;
  const rows = sqlite.prepare(
    `SELECT c.id, c.content, c.created_at, c.user_id, c.post_id, u.nickname, u.username
    FROM community_comments c LEFT JOIN users u ON u.id = c.user_id ` + where + ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?'
  ).all(...args, pageSize, (page - 1) * pageSize) as unknown as {
    id: string; content: string; created_at: string; user_id: string; post_id: string;
    nickname: string | null; username: string | null;
  }[];
  return {
    total,
    items: rows.map((r) => ({ id: r.id, content: r.content, createdAt: r.created_at, ownerId: r.user_id, postId: r.post_id, ownerName: r.nickname ?? r.username ?? '未知' })),
  };
}

// ---------- 审计日志 ----------
export function addAuditLog(adminUserId: string, action: string, targetType: string, targetId: string, detail?: string) {
  sqlite.prepare('INSERT INTO admin_audit_log (id, admin_user_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(genId('audit'), adminUserId, action, targetType, targetId, detail ?? null, now());
}
export function listAuditLogs(input: { page?: number; pageSize?: number } = {}) {
  const { page = 1, pageSize = 30 } = input;
  const total = (sqlite.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get() as { n: number }).n;
  const rows = sqlite.prepare(
    `SELECT a.*, u.nickname, u.username FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
  ).all(pageSize, (page - 1) * pageSize) as unknown as {
    id: string; admin_user_id: string; action: string; target_type: string; target_id: string; detail: string | null; created_at: string;
    nickname: string | null; username: string | null;
  }[];
  return {
    total,
    items: rows.map((r) => ({
      id: r.id, adminName: r.nickname ?? r.username ?? r.admin_user_id, action: r.action,
      targetType: r.target_type, targetId: r.target_id, detail: r.detail ?? '', createdAt: r.created_at,
    })),
  };
}
