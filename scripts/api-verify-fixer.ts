/**
 * QA: 端到端调用 apply-quality-fixes API（saveToDB=false 仅验证）
 *   cd proj
 *   npx tsx scripts/api-verify-fixer.ts
 */
import jwt from 'jsonwebtoken';
import axios from 'axios';

const JWT_SECRET = process.env.JWT_SECRET || 'novel-system-secret-key-2024-chuang-shi-ji-lian-meng';
const token = jwt.sign(
  { userId: 'fb49c47a-8b3f-4705-bc53-ac6b1ac5bcf9', email: 'jiyongdian@gmail.com', username: 'admin', role: 'admin' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

const ENDPOINT = 'http://127.0.0.1:5000/api/novel/script/apply-quality-fixes';
const scriptId = 'script_1788201416648_7z08r3u7l';

async function main() {
  try {
    console.log('→ POST', ENDPOINT, { scriptId });
    const res = await axios.post(ENDPOINT, {
      scriptId,
      scope: 'all',
      saveToDB: false,
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 180_000,
    });
    const d = res.data;
    console.log('\n=== API apply-quality-fixes 结果（saveToDB=false 预览模式）===');
    console.log('ok     =', d.ok, d.note ?? '');
    console.log('saved  =', d.saved);
    console.log('overall=');
    console.log(JSON.stringify(d.overall, null, 2));
    console.log('\naggregatePerFixer=');
    for (const f of (d.aggregatePerFixer || [])) {
      console.log(`   ${f.fixerKey}·${f.fixerName.padEnd(20)}  成功 ${String(f.successCount).padStart(5)} 次    跳过 ${String(f.skipCount).padStart(5)}`);
    }
    console.log('\n逐章：');
    for (const c of (d.chapters || [])) {
      const gain = c.scoreAfter - c.scoreBefore;
      const sym = gain >= 20 ? '★★★' : gain >= 10 ? '★★' : gain >= 5 ? '★' : '·';
      console.log(`   第${c.chapterIndex+1}章·${c.chapterTitle.slice(0,18).padEnd(20)} ${c.scoreBefore} → ${c.scoreAfter}（${gain>=0?'+':''}${gain}）   问题${c.issuesBefore}→${c.issuesAfter}    ${sym}`);
    }
    const passed = [
      d.ok,
      (d.overall?.scoreAfter ?? 0) >= 85,
      (d.overall?.scoreGain ?? 0) >= 15,
      (d.overall?.highCleared ?? 0) > 0,
    ];
    console.log('\n检查：', passed.map(p => p ? '✅' : '❌').join(' '));
    process.exit(passed.every(Boolean) ? 0 : 3);
  } catch (e: any) {
    console.error('❌ 调用失败:', e.message);
    if (e.response) console.error('status', e.response.status, e.response.data);
    process.exit(4);
  }
}
main();
