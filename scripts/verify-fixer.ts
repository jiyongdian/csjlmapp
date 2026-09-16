/**
 * 剧本修复器库 qa-5a 验证脚本
 *
 *   cd proj
 *   npx tsx scripts/verify-fixer.ts
 */
import Database from 'better-sqlite3';
import path from 'path';
import { validateScreenplay, type SceneContent } from '../src/lib/screenplay/quality-validator';
import { applyQualityFixes, mapIssueTypeToDimensions, issueTypeIsDimension } from '../src/lib/screenplay/quality-fixer';

const DB_PATH = path.resolve(process.cwd(), 'novel.db');
const TARGET_ID = 'novel_1788199340026_d6gzoslyk'; // 《我在仙界卷成仙》

function pad(n: number, w = 4): string { return String(n).padStart(w, ' '); }

function normalizeScenes(rawScenes: any[]): SceneContent[] {
  return rawScenes.map((s, i) => ({
    sceneIndex: s.sceneIndex ?? i + 1,
    sceneTitle: s.sceneTitle ?? '',
    description: s.description ?? '',
    actions: s.actions ?? '',
    dialogues: Array.isArray(s.dialogues) ? s.dialogues : [],
    stageDirections: s.stageDirections ?? '',
    sourceBeat: s.sourceBeat ?? '',
    sceneTransition: s.sceneTransition ?? '',
    location: s.location ?? undefined,
    shotType: s.shotType ?? undefined,
    cameraAngle: s.cameraAngle ?? undefined,
    duration: s.duration ?? undefined,
    cameraMovement: s.cameraMovement ?? undefined,
    visual: s.visual ?? undefined,
    soundDesign: s.soundDesign ?? undefined,
  }));
}

function main() {
  const db = new Database(DB_PATH, { readonly: true });

  const row = db.prepare(`SELECT id, novel_id, chapters FROM scripts WHERE novel_id = ? OR id = ? LIMIT 1`).bind(TARGET_ID, TARGET_ID).get() as any;
  if (!row) {
    console.error(`❌ 找不到剧本 id=${TARGET_ID}，DB=${DB_PATH}`);
    const sample = db.prepare(`SELECT id, novel_id FROM scripts LIMIT 5`).all() as any[];
    console.error('  DB 中的样本剧本：', sample);
    process.exit(1);
  }
  const nov = (db.prepare(`SELECT title FROM novels WHERE id = ?`).get(row.novel_id) as any)?.title ?? '';
  const title = nov;
  const chapters = JSON.parse(row.chapters || '[]') as any[];
  console.log(`\n📖 剧本《${title ?? '(无)'}》  剧本ID=${row.id}  novelId=${row.novel_id}  共${chapters.length}章\n`);

  let sumBefore = 0, sumAfter = 0, totalFixed = 0;
  const cleared = { high: 0, medium: 0, low: 0 };
  const fixerAgg: Record<string, { name: string; succ: number; skip: number }> = {};
  const unmappedSamples: Array<[number, string]> = [];

  console.log('┌' + '─'.repeat(170) + '┐');
  console.log(
    '│' + '章'.padEnd(5) +
    '│' + '场景数'.padStart(7) +
    '│' + '修复前'.padStart(8) +
    '│' + '修复后'.padStart(8) +
    '│' + 'Δ分'.padStart(6) +
    '│' + '连贯扣 前→后'.padStart(14) +
    '│' + '问题 前→后'.padStart(13) +
    '│' + '清除 高/中/轻'.padStart(15) +
    ' │ 修复器（成功数）'
  );
  console.log('├' + '─'.repeat(170) + '┤');

  for (let ci = 0; ci < chapters.length; ci++) {
    const ch = chapters[ci];
    const rawScenes: any[] = ch?.screenplay?.scenes ?? [];
    const scenes = normalizeScenes(rawScenes);
    if (scenes.length === 0) {
      console.log(`│ ${String(ci + 1).padEnd(4)} │ (空章节)`);
      continue;
    }

    const before = validateScreenplay(scenes, '');

    for (const iss of before.issues) {
      if (!issueTypeIsDimension(iss.type as string)) {
        const dims = mapIssueTypeToDimensions(iss as any);
        if (dims.length === 0 && unmappedSamples.length < 10) {
          unmappedSamples.push([ci + 1, `${iss.type}|${iss.message.slice(0, 30)}`]);
        }
      }
    }

    const batch = applyQualityFixes(scenes, before.issues as any, { scope: 'all', chapterIndex: ci });

    sumBefore += batch.scoreBefore;
    sumAfter += batch.scoreAfter;
    totalFixed += batch.totalFixed;
    cleared.high += batch.severityCleared.high;
    cleared.medium += batch.severityCleared.medium;
    cleared.low += batch.severityCleared.low;
    for (const st of batch.stats) {
      if (!fixerAgg[st.fixerKey]) fixerAgg[st.fixerKey] = { name: st.fixerName, succ: 0, skip: 0 };
      fixerAgg[st.fixerKey].succ += st.successCount;
      fixerAgg[st.fixerKey].skip += st.skipCount;
    }

    const afterRep = validateScreenplay(batch.scenes, '');
    const gain = batch.scoreAfter - batch.scoreBefore;
    const g = (gain >= 0 ? '+' : '') + gain;
    const keys = batch.stats.filter(s => s.successCount > 0 || s.totalAttempts > 0)
      .map(s => `${s.fixerKey}(${s.successCount})`).join(' ') || '-';
    const stars = gain >= 25 ? '★★★' : gain >= 15 ? '★★' : gain >= 5 ? '★' : '·';
    console.log(
      '│' + String(ci + 1).padEnd(5) +
      '│' + pad(scenes.length, 6) + ' ' +
      '│' + pad(batch.scoreBefore, 7) + ' ' +
      '│' + pad(batch.scoreAfter, 7) + ' ' +
      '│' + g.padStart(5) + ' ' +
      '│' + `${batch.continuityDeductBefore} → ${batch.continuityDeductAfter}`.padStart(13) + ' ' +
      '│' + `${before.issues.length} → ${afterRep.issues.length}`.padStart(12) + ' ' +
      '│' + `${batch.severityCleared.high}/${batch.severityCleared.medium}/${batch.severityCleared.low}`.padStart(14) + ' ' +
      `│ ${stars} ${keys.slice(0, 70)}`
    );
  }
  console.log('└' + '─'.repeat(170) + '┘\n');

  const N = Math.max(1, chapters.length);
  const avgBefore = Math.round(sumBefore / N);
  const avgAfter = Math.round(sumAfter / N);

  console.log(`📊 汇总：平均分 ${avgBefore} → ${avgAfter}   Δ = ${avgAfter - avgBefore >= 0 ? '+' : ''}${avgAfter - avgBefore}`);
  console.log(`🧰 程序化修复总成功次数：${totalFixed}`);
  console.log(`🧹 问题清除量：高=${cleared.high}　中=${cleared.medium}　轻=${cleared.low}`);
  if (unmappedSamples.length) {
    console.log('⚠️  未被维度映射命中的 issue（需补充 RAW_TYPE_HINTS）：');
    for (const [ch, txt] of unmappedSamples) console.log(`   第${ch}章  ${txt}`);
  } else {
    console.log('✅ 所有 issue 都被维度映射命中。');
  }

  console.log('\n🔧 各修复器命中统计（按执行顺序）：');
  const ORDER = ['F4', 'F5', 'F1', 'F8', 'F6', 'F3', 'F2', 'F7'];
  for (const k of ORDER) {
    const f = fixerAgg[k];
    if (!f) { console.log(`   ${k}·(未命中)`); continue; }
    console.log(`   ${k}·${f.name.padEnd(20)}  成功 ${String(f.succ).padStart(6)} 次    跳过 ${String(f.skip).padStart(6)}`);
  }

  console.log('\n🎯 目标达成核对：');
  const rows: Array<[string, boolean, string]> = [
    ['修复后均分 ≥ 85',         avgAfter >= 85,                               `${avgAfter}`],
    ['均分提升 ≥ 15',            avgAfter - avgBefore >= 15,                    `${avgAfter - avgBefore}`],
    ['严重问题(high)有清除',     cleared.high > 0,                               `${cleared.high}`],
    ['F1(补6字段)有命中',        (fixerAgg.F1?.succ ?? 0) > 0,                   `${fixerAgg.F1?.succ ?? 0}`],
    ['F2(衔接4行)有命中',        (fixerAgg.F2?.succ ?? 0) > 0,                   `${fixerAgg.F2?.succ ?? 0}`],
    ['F3(sourceBeat)有命中',     (fixerAgg.F3?.succ ?? 0) > 0,                   `${fixerAgg.F3?.succ ?? 0}`],
    ['F5(标题规范)有命中',       (fixerAgg.F5?.succ ?? 0) > 0,                   `${fixerAgg.F5?.succ ?? 0}`],
    ['F8(短字段扩展)有命中',     (fixerAgg.F8?.succ ?? 0) > 0,                   `${fixerAgg.F8?.succ ?? 0}`],
    ['问题总数有下降',            cleared.high + cleared.medium + cleared.low > 0, `清除问题${cleared.high + cleared.medium + cleared.low}项`],
  ];
  let pass = 0;
  for (const [label, ok, v] of rows) {
    console.log(`   ${ok ? '✅' : '❌'}  ${label.padEnd(24)}  (${v})`);
    if (ok) pass++;
  }
  console.log(`\n   通过 ${pass}/${rows.length} 项`);
  if (pass === rows.length) console.log('   🎉 全部通过！修复器库可投入使用。');
  process.exit(pass === rows.length ? 0 : 2);
}

main();
