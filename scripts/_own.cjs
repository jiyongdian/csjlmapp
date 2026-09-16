const D = require('better-sqlite3');
const db = new D('novel.db');
const r = db.prepare("SELECT id, user_id, title FROM novels WHERE id=?").get('novel_1788199340026_d6gzoslyk');
console.log('novel=', r);
