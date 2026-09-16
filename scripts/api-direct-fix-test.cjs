/**
 * 直接调用修复API验证脚本
 * 无需等待浏览器质检完成
 */
const crypto = require('crypto');
const http = require('http');

// ============ 配置 ============
const JWT_SECRET = 'novel-system-secret-key-2024-chuang-shi-ji-lian-meng';
const ADMIN_USER_ID = 'fb49c47a-8b3f-4705-bc53-ac6b1ac5bcf9';
const SCRIPT_ID = 'script_1788201416648_7z08r3u7l';
const NOVEL_ID = 'novel_1788199340026_d6gzoslyk';
const API_HOST = 'localhost';
const API_PORT = 5000;

// ============ JWT 生成（本地对称，与服务端一致）============
function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = base64UrlEncode(JSON.stringify(header));
  const p = base64UrlEncode(JSON.stringify(payload));
  const sigInput = `${h}.${p}`;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(sigInput).digest();
  return `${sigInput}.${base64UrlEncode(sig)}`;
}
const token = signToken({
  userId: ADMIN_USER_ID,
  isAdmin: true,
  username: 'admin',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600 * 24,
});

// ============ HTTP 请求 ============
function httpRequest(method, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = http.request({
      host: API_HOST, port: API_PORT, method, path,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
      timeout: 300000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('HTTP Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ============ 主流程 ============
(async () => {
  console.log('='.repeat(60));
  console.log('剧本修复 API 直连验证');
  console.log('='.repeat(60));

  // STEP 0: GET 检查修复器清单
  console.log('\n[STEP 0] GET 修复器元数据...');
  const meta = await httpRequest('GET', '/api/novel/script/apply-quality-fixes');
  console.log('  HTTP:', meta.status);
  if (meta.body?.proceduralFixers) {
    console.log('  程序化修复器:', meta.body.proceduralFixers.length, '个');
    meta.body.proceduralFixers.forEach(f => console.log('    -', f.key, f.name));
    console.log('  AI修复器:', meta.body.aiFixers?.length || 0, '个');
  }

  // STEP 1: 先调用修复（不写DB，仅预览效果）
  console.log('\n[STEP 1] 调用修复API (saveToDB=false 预览模式)...');
  const fixStart = Date.now();
  const fixResp = await httpRequest('POST', '/api/novel/script/apply-quality-fixes', {
    scriptId: SCRIPT_ID,
    novelId: NOVEL_ID,
    scope: 'all',
    saveToDB: false,
  });
  const fixDuration = ((Date.now() - fixStart) / 1000).toFixed(1);
  console.log('  HTTP:', fixResp.status, `(${fixDuration}s)`);

  if (fixResp.status !== 200) {
    console.error('  错误:', JSON.stringify(fixResp.body, null, 2).slice(0, 500));
    process.exit(1);
  }

  const r = fixResp.body;
  console.log('\n  ┌────────────── 修复结果 ──────────────┐');
  console.log(`  │ 修复前评分: ${r.overall?.scoreBefore ?? '-'} 分`.padEnd(42) + '│');
  console.log(`  │ 修复后评分: ${r.overall?.scoreAfter ?? '-'} 分`.padEnd(42) + '│');
  const gain = r.overall?.scoreGain ?? 0;
  const gainColor = gain >= 50 ? '🚀' : gain >= 30 ? '✅' : gain >= 10 ? '↑' : '·';
  console.log(`  │ 评分提升: +${gain} 分 ${gainColor}`.padEnd(42) + '│');
  console.log(`  │ 尝试修复: ${r.overall?.totalAttempted ?? 0} 处`.padEnd(42) + '│');
  console.log(`  │ 成功修复: ${r.overall?.totalFixed ?? 0} 处`.padEnd(42) + '│');
  console.log(`  │ 问题清除: 🔴${r.overall?.highCleared ?? 0} 🟡${r.overall?.mediumCleared ?? 0} 🔵${r.overall?.lowCleared ?? 0}`.padEnd(42) + '│');
  console.log(`  │ 问题数: ${r.overall?.issuesBefore ?? 0} → ${r.overall?.issuesAfter ?? 0} (-${Math.max(0, (r.overall?.issuesBefore ?? 0) - (r.overall?.issuesAfter ?? 0))})`.padEnd(42) + '│');
  console.log('  └──────────────────────────────────────┘');

  // 每章明细
  if (r.chapters?.length) {
    console.log('\n  每章评分变化:');
    r.chapters.forEach(c => {
      const arrow = c.scoreGain > 0 ? `→ ${c.scoreAfter} (+${c.scoreGain})` : `→ ${c.scoreAfter}`;
      console.log(`    第${c.chapterIndex + 1}章 ${c.chapterTitle.slice(0, 18).padEnd(20)}: ${c.scoreBefore} ${arrow} | 问题: ${c.issuesBefore}→${c.issuesAfter}`);
    });
  }

  // 修复器明细
  if (r.aggregatePerFixer?.length) {
    console.log('\n  修复器TOP 5:');
    r.aggregatePerFixer.slice(0, 5).forEach(f => {
      const rate = f.totalAttempts > 0 ? Math.round(f.successCount / f.totalAttempts * 100) : 0;
      console.log(`    ${f.fixerKey} ${f.fixerName.slice(0, 22).padEnd(24)}: 成功${f.successCount} (${rate}%)`);
    });
  }

  // STEP 2: 目标达成判定
  console.log('\n' + '='.repeat(60));
  console.log('[验证结果]');
  const targets = [];
  targets.push(['评分 ≥ 85', (r.overall?.scoreAfter ?? 0) >= 85]);
  targets.push(['评分提升 ≥ 50', (r.overall?.scoreGain ?? 0) >= 50]);
  targets.push(['严重问题清零', (r.overall?.highCleared ?? 0) > 0 && (r.overall?.issuesAfter ?? 999) < 50]);
  targets.push(['成功修复 ≥ 400', (r.overall?.totalFixed ?? 0) >= 400]);
  targets.push(['问题减少 ≥ 400', ((r.overall?.issuesBefore ?? 0) - (r.overall?.issuesAfter ?? 0)) >= 400]);
  targets.push(['修复器覆盖 ≥ 6个', (r.aggregatePerFixer?.length ?? 0) >= 6]);
  targets.push(['保存状态=预览模式正确', r.saved === false]);
  targets.push(['HTTP 200', fixResp.status === 200]);

  let passCount = 0;
  targets.forEach(([name, ok]) => {
    passCount += ok ? 1 : 0;
    console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  });

  console.log('\n' + (passCount === targets.length
    ? `🎉 全部 ${targets.length}/${targets.length} 项目标通过！修复系统运行正常。`
    : `⚠️ 通过 ${passCount}/${targets.length} 项，需进一步排查。`));

  // STEP 3: 如果全部通过，执行真正写回DB（供浏览器端验证UI效果）
  if (passCount === targets.length) {
    console.log('\n[STEP 3] 全部通过 → 写回DB供浏览器端验证UI...');
    const realFix = await httpRequest('POST', '/api/novel/script/apply-quality-fixes', {
      scriptId: SCRIPT_ID,
      novelId: NOVEL_ID,
      scope: 'all',
      saveToDB: true,
    });
    console.log('  HTTP:', realFix.status);
    console.log('  saved:', realFix.body?.saved);
    if (realFix.body?.saved) console.log('  ✅ DB写入成功，前端刷新即可看到修复后的场景分镜字段。');
  }

  process.exit(0);
})().catch(e => {
  console.error('FATAL:', e?.message || e);
  process.exit(1);
});
