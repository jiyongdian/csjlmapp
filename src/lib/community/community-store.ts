// 社区 + 私信数据层（better-sqlite3 原生）
import { sqlite } from '@/storage/database/sqlite';
import { publishToUser } from '@/lib/realtime/event-bus';

function genId(prefix: string): string {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}
function now(): string { return new Date().toISOString(); }

// ---------- 公共 ----------
export interface Author { id: string; nickname: string; username: string; }

function authorFrom(row: { user_id: string; nickname: string | null; username: string | null }): Author {
  return { id: row.user_id, nickname: row.nickname || row.username || '作者', username: row.username || '' };
}

// ---------- 帖子 ----------
export interface PostRow {
  id: string; user_id: string; title: string; content: string; images: string | null;
  topic_key: string | null; created_at: string; updated_at: string;
  nickname: string | null; username: string | null;
  likes: number; comments: number; liked: number;
}
function mapPost(r: PostRow) {
  let images: string[] = [];
  if (r.images) { try { images = JSON.parse(r.images); } catch { images = []; } }
  return {
    id: r.id, title: r.title, content: r.content, images,
    topicKey: r.topic_key ?? '', createdAt: r.created_at, updatedAt: r.updated_at,
    author: authorFrom(r), likes: r.likes, comments: r.comments, liked: !!r.liked,
  };
}

const POST_SELECT = `
  SELECT p.*, u.nickname, u.username,
    (SELECT COUNT(*) FROM community_post_likes l WHERE l.post_id = p.id) AS likes,
    (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id) AS comments,
    0 AS liked
  FROM community_posts p
  LEFT JOIN users u ON u.id = p.user_id`;

export function createPost(userId: string, input: { title: string; content: string; images?: string[]; topicKey?: string }) {
  const id = genId('post');
  const images = input.images && input.images.length ? JSON.stringify(input.images) : null;
  sqlite.prepare(
    'INSERT INTO community_posts (id, user_id, title, content, images, topic_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, input.title.trim(), input.content.trim(), images, input.topicKey?.trim() || null, now(), now());
  return getPost(id, userId);
}

export function listPosts(input: { topicKey?: string; q?: string; sort?: 'new' | 'hot'; viewerId?: string; page?: number; pageSize?: number } = {}) {
  const { topicKey, q, sort = 'new', viewerId, page = 1, pageSize = 20 } = input;
  const conds: string[] = []; const args: unknown[] = [];
  if (topicKey) { conds.push('p.topic_key = ?'); args.push(topicKey); }
  if (q) { conds.push('(p.title LIKE ? OR p.content LIKE ?)'); args.push('%' + q + '%', '%' + q + '%'); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const order = sort === 'hot' ? 'ORDER BY likes DESC, p.created_at DESC' : 'ORDER BY p.created_at DESC';
  const viewSel = viewerId
    ? POST_SELECT.replace('0 AS liked', `(SELECT COUNT(*) FROM community_post_likes l2 WHERE l2.post_id = p.id AND l2.user_id = ?) AS liked`)
    : POST_SELECT;
  const viewArgs = viewerId ? [viewerId] : [];
  const total = (sqlite.prepare('SELECT COUNT(*) AS n FROM community_posts p ' + where).get(...args) as { n: number }).n;
  const rows = sqlite.prepare(viewSel + ' ' + where + ' ' + order + ' LIMIT ? OFFSET ?')
    .all(...viewArgs, ...args, pageSize, (page - 1) * pageSize) as unknown as PostRow[];
  return { items: rows.map(mapPost), total };
}

export function getPost(postId: string, viewerId?: string) {
  const viewSel = viewerId
    ? POST_SELECT.replace('0 AS liked', `(SELECT COUNT(*) FROM community_post_likes l2 WHERE l2.post_id = p.id AND l2.user_id = ?) AS liked`)
    : POST_SELECT;
  const row = viewerId
    ? sqlite.prepare(viewSel + ' WHERE p.id = ?').get(viewerId, postId) as unknown as PostRow | undefined
    : sqlite.prepare(viewSel + ' WHERE p.id = ?').get(postId) as unknown as PostRow | undefined;
  return row ? mapPost(row) : null;
}

export function deletePost(postId: string, userId: string): boolean {
  const p = sqlite.prepare('SELECT user_id FROM community_posts WHERE id = ?').get(postId) as { user_id: string } | undefined;
  if (!p || p.user_id !== userId && p.user_id !== 'admin') return false;
  sqlite.prepare('DELETE FROM community_post_likes WHERE post_id = ?').run(postId);
  sqlite.prepare('DELETE FROM community_comments WHERE post_id = ?').run(postId);
  sqlite.prepare('DELETE FROM community_posts WHERE id = ?').run(postId);
  return true;
}

export function toggleLike(userId: string, postId: string): { liked: boolean; likes: number } {
  const exist = sqlite.prepare('SELECT id FROM community_post_likes WHERE post_id = ? AND user_id = ?').get(postId, userId);
  if (exist) {
    sqlite.prepare('DELETE FROM community_post_likes WHERE post_id = ? AND user_id = ?').run(postId, userId);
  } else {
    sqlite.prepare('INSERT INTO community_post_likes (id, post_id, user_id) VALUES (?, ?, ?)').run(genId('like'), postId, userId);
  }
  const likes = (sqlite.prepare('SELECT COUNT(*) AS n FROM community_post_likes WHERE post_id = ?').get(postId) as { n: number }).n;
  return { liked: !exist, likes };
}

export function isPostLiked(userId: string, postId: string): boolean {
  return !!sqlite.prepare('SELECT id FROM community_post_likes WHERE post_id = ? AND user_id = ?').get(postId, userId);
}

// ---------- 评论 ----------
export interface CommentRow {
  id: string; post_id: string; user_id: string; content: string; created_at: string;
  nickname: string | null; username: string | null;
}
export function addComment(postId: string, userId: string, content: string) {
  const id = genId('cmt');
  sqlite.prepare('INSERT INTO community_comments (id, post_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, postId, userId, content.trim(), now());
  return listComments(postId);
}
export function listComments(postId: string) {
  const rows = sqlite.prepare(
    `SELECT c.*, u.nickname, u.username FROM community_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.created_at ASC`
  ).all(postId) as unknown as (CommentRow & { nickname: string | null; username: string | null })[];
  return rows.map((r) => ({
    id: r.id, userId: r.user_id, content: r.content, createdAt: r.created_at,
    author: authorFrom(r),
  }));
}
export function deleteComment(commentId: string, userId: string): boolean {
  const c = sqlite.prepare('SELECT user_id FROM community_comments WHERE id = ?').get(commentId) as { user_id: string } | undefined;
  if (!c || (c.user_id !== userId && c.user_id !== 'admin')) return false;
  sqlite.prepare('DELETE FROM community_comments WHERE id = ?').run(commentId);
  return true;
}

// ---------- 话题 ----------
export function listTopics(): { key: string; count: number }[] {
  const rows = sqlite.prepare(
    `SELECT p.topic_key AS k, COUNT(*) AS n FROM community_posts p WHERE p.topic_key IS NOT NULL AND p.topic_key != '' GROUP BY p.topic_key ORDER BY n DESC`
  ).all() as { k: string; n: number }[];
  return rows.map((r) => ({ key: r.k, count: r.n }));
}

// ---------- 私信 ----------
function ensureThread(userA: string, userB: string): string {
  const existing = sqlite.prepare('SELECT id FROM message_threads WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)')
    .get(userA, userB, userB, userA) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = genId('thread');
  sqlite.prepare('INSERT INTO message_threads (id, user_a, user_b) VALUES (?, ?, ?)').run(id, userA, userB);
  return id;
}

export function sendMessage(senderId: string, otherUserId: string, content: string) {
  const threadId = ensureThread(senderId, otherUserId);
  const msgId = genId('msg');
  const text = content.trim();
  const createdAt = now();
  sqlite.prepare('INSERT INTO messages (id, thread_id, sender_id, content, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    .run(msgId, threadId, senderId, text, createdAt);
  sqlite.prepare('UPDATE message_threads SET updated_at = ? WHERE id = ?').run(now(), threadId);
  // 实时推送给收件人
  publishToUser(otherUserId, {
    type: 'message',
    threadId,
    messageId: msgId,
    senderId,
    recipientId: otherUserId,
    content: text,
    createdAt,
  });
  return { threadId, messageId: msgId };
}

export function listThreads(userId: string) {
  const rows = sqlite.prepare(
    `SELECT t.id, t.user_a, t.user_b, t.updated_at,
      (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.sender_id != ? AND m.is_read = 0) AS unread,
      (SELECT m.content FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
    FROM message_threads t
    WHERE t.user_a = ? OR t.user_b = ?
    ORDER BY t.updated_at DESC`
  ).all(userId, userId, userId) as unknown as {
    id: string; user_a: string; user_b: string; updated_at: string; unread: number; last_message: string | null;
  }[];
  return rows.map((r) => {
    const otherId = r.user_a === userId ? r.user_b : r.user_a;
    const u = sqlite.prepare('SELECT id, nickname, username, avatar FROM users WHERE id = ?').get(otherId) as { id: string; nickname: string | null; username: string | null; avatar: string | null } | undefined;
    return {
      id: r.id, otherUser: u ? { id: u.id, nickname: u.nickname || u.username || '用户', username: u.username || '', avatar: u.avatar ?? null } : { id: otherId, nickname: '用户', username: '', avatar: null },
      unread: r.unread, lastMessage: r.last_message ?? '', updatedAt: r.updated_at,
    };
  });
}

export function listThreadMessages(userId: string, threadId: string): { senderId: string; content: string; createdAt: string; isMine: boolean }[] | null {
  const t = sqlite.prepare('SELECT * FROM message_threads WHERE id = ? AND (user_a = ? OR user_b = ?)').get(threadId, userId, userId) as { id: string } | undefined;
  if (!t) return null;
  sqlite.prepare('UPDATE messages SET is_read = 1 WHERE thread_id = ? AND sender_id != ?').run(threadId, userId);
  const rows = sqlite.prepare('SELECT sender_id, content, created_at FROM messages WHERE thread_id = ? ORDER BY created_at ASC').all(threadId) as { sender_id: string; content: string; created_at: string }[];
  return rows.map((r) => ({ senderId: r.sender_id, content: r.content, createdAt: r.created_at, isMine: r.sender_id === userId }));
}

export function getOtherUserIdOfThread(userId: string, threadId: string): string | null {
  const t = sqlite.prepare('SELECT * FROM message_threads WHERE id = ? AND (user_a = ? OR user_b = ?)').get(threadId, userId, userId) as { user_a: string; user_b: string } | undefined;
  if (!t) return null;
  return t.user_a === userId ? t.user_b : t.user_a;
}

export function totalUnread(userId: string): number {
  return (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM messages m JOIN message_threads t ON t.id = m.thread_id
     WHERE (t.user_a = ? OR t.user_b = ?) AND m.sender_id != ? AND m.is_read = 0`
  ).get(userId, userId, userId) as { n: number }).n;
}
