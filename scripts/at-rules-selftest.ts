/**
 * @ 规则自检脚本（只读，不写库）
 *
 * 用真实分镜提示词对比 v1 / v2 规则的 @ 解析率，并输出资产登记名冲突清单。
 *
 * 用法：
 *   npx tsx scripts/at-rules-selftest.ts [dramaId]
 *   不传 dramaId 时自动选取分镜最多的一部剧。
 */

import Database from 'better-sqlite3';
import {
  AtMentionIndex,
  buildAtAssets,
  applyAtRules,
  detectNameConflicts,
  formatAssetGlossary,
  rankRelevantAssets,
  type AtAsset,
} from '../src/lib/at-mentions';

// ── v1 规则复刻（用于对比基线，勿改）────────────────────────────
const V1_AT = /@([^\s@,，。．\.！？!？（）()\[\]【】{}、;；:："'“”‘’<>«»\/／|｜]+)/g;
function v1Normalize(input: string): string {
  let s = String(input || '');
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.replace(/　/g, ' ');
  s = s.replace(/[（(\[【][^）)\]】]*[）)\]】]/g, '');
  s = s.split(/[\/／|｜]/)[0];
  s = s.replace(/[\s,，。、；;：:!！?？"'“”‘’~～·…—\-_]/g, '');
  return s.toLowerCase();
}
function v1Resolve(token: string, names: { norm: string }[]): boolean {
  const t = v1Normalize(token);
  if (!t) return false;
  if (names.some((n) => n.norm === t)) return true;
  if (t.length < 2) return false;
  const scored: number[] = [];
  for (const n of names) {
    if (n.norm.length < 2) continue;
    if (!n.norm.includes(t)) continue;
    scored.push(t.length / n.norm.length);
  }
  if (!scored.length) return false;
  scored.sort((a, b) => b - a);
  const best = scored[0];
  const second = scored[1] ?? 0;
  if (scored.length === 1) return best >= 0.4;
  return best >= 0.5 && best - second >= 0.2;
}

// ── 主流程 ────────────────────────────────────────────────────
function main() {
  const db = new Database('novel.db', { readonly: true });
  const dramaId = process.argv[2] || (db.prepare(
    'SELECT drama_id FROM drama_storyboards GROUP BY drama_id ORDER BY COUNT(*) DESC LIMIT 1'
  ).get() as any)?.drama_id;

  if (!dramaId) { console.error('未找到任何分镜数据'); return; }

  const q = (sql: string) => db.prepare(sql).all(dramaId) as any[];
  const characters = q('SELECT * FROM drama_characters WHERE drama_id = ?');
  const scenes = q('SELECT * FROM drama_scenes WHERE drama_id = ?');
  const items = q('SELECT * FROM drama_items WHERE drama_id = ?');
  const shots = db.prepare(
    'SELECT * FROM drama_storyboards WHERE drama_id = ? ORDER BY shot_number'
  ).all(dramaId) as any[];

  console.log('='.repeat(72));
  console.log(` @ 规则自检  drama=${dramaId}`);
  console.log(` 资产：角色 ${characters.length} / 场景 ${scenes.length} / 物品 ${items.length}，分镜 ${shots.length}`);
  console.log('='.repeat(72));

  const assets = buildAtAssets(characters, scenes, items);
  const index = new AtMentionIndex(assets);

  // ── 1. 登记名冲突 ──
  const conflicts = detectNameConflicts(assets);
  console.log('\n【1】资产登记名冲突（@ 不严谨的源头）');
  if (!conflicts.length) { console.log('  ✅ 无冲突'); }
  else {
    console.log(`  ⚠️  ${conflicts.length} 组冲突：`);
    for (const c of conflicts) {
      const lt = c.longer.type === 'character' ? '角色' : c.longer.type === 'scene' ? '场景' : '物品';
      const st = c.shorter.type === 'character' ? '角色' : c.shorter.type === 'scene' ? '场景' : '物品';
      console.log(`   - ${c.kind === 'same' ? '同名' : '包含'}：${lt}「${c.longer.name}」 ↔ ${st}「${c.shorter.name}」`);
    }
  }

  // ── 2. @ 解析率对比 ──
  const v1Names = assets.map((a) => ({ norm: v1Normalize(a.name) }));
  let total = 0, v1Ok = 0, v2Ok = 0, v2Ambig = 0;
  const stillBad = new Map<string, number>();
  const fixedSamples: string[] = [];

  for (const s of shots) {
    const fields = [s.image_prompt, s.video_prompt].filter((x) => typeof x === 'string' && x.trim());
    for (const field of fields) {
      // v1：直接对原文统计 token 命中
      V1_AT.lastIndex = 0;
      let m1: RegExpExecArray | null;
      while ((m1 = V1_AT.exec(field)) !== null) {
        total++;
        if (v1Resolve(m1[1], v1Names)) v1Ok++;
      }
      // v2：走完整管线后重新统计
      const r = applyAtRules(field, index);
      V1_AT.lastIndex = 0;
      let m2: RegExpExecArray | null;
      while ((m2 = V1_AT.exec(r.text)) !== null) {
        const tok = m2[1];
        if (v1Resolve(tok, v1Names)) v2Ok++;
        else stillBad.set(tok, (stillBad.get(tok) || 0) + 1);
      }
      for (const iss of r.issues) {
        if (iss.kind === 'ambiguous') v2Ambig++;
        if (iss.kind === 'unresolved') stillBad.set('@' + iss.token, (stillBad.get('@' + iss.token) || 0) + 1);
      }
      if (r.changed && fixedSamples.length < 8 && field !== r.text) {
        fixedSamples.push(`  原文：${field.slice(0, 110)}\n  修正：${r.text.slice(0, 110)}`);
      }
    }
  }

  const pct = (n: number) => (total ? ((n / total) * 100).toFixed(1) : '0.0');
  console.log('\n【2】@ 解析率（v1 旧规则 → v2 新规则）');
  console.log(`  @ 总数：${total}`);
  console.log(`  v1 可解析：${v1Ok}（${pct(v1Ok)}%）`);
  console.log(`  v2 可解析：${v2Ok}（${pct(v2Ok)}%）   歧义未决：${v2Ambig}`);
  console.log(`  提升：+${v2Ok - v1Ok}（+${(((v2Ok - v1Ok) / (total || 1)) * 100).toFixed(1)} 个百分点）`);

  if (stillBad.size) {
    console.log('\n  仍未解析的 @（Top 15，需补别名或修正登记名）：');
    [...stillBad.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
      .forEach(([t, n]) => console.log(`   ${String(n).padStart(4)}  ${t}`));
  }

  if (fixedSamples.length) {
    console.log('\n【3】规范化改写样例');
    fixedSamples.forEach((s) => console.log(s));
  }

  // ── 4. 幂等性 ──
  let idempotentFail = 0;
  for (const s of shots.slice(0, 120)) {
    const f = s.image_prompt || s.video_prompt;
    if (typeof f !== 'string' || !f.trim()) continue;
    const once = applyAtRules(f, index).text;
    const twice = applyAtRules(once, index).text;
    if (once !== twice) idempotentFail++;
  }
  console.log(`\n【4】幂等性检查：${idempotentFail === 0 ? '✅ 通过（二次执行结果不变）' : `❌ ${idempotentFail} 条不满足幂等`}`);

  // ── 5. 资产清单注入规模 ──
  const sampleShot = shots[0];
  const ctx = `${sampleShot?.scene_description || ''}${sampleShot?.image_prompt || ''}`;
  const relevant = rankRelevantAssets(ctx, assets, 24);
  console.log(`\n【5】提示词注入规模：全量 ${assets.length} → 相关召回 ${relevant.length}`);
  console.log('  清单预览：');
  console.log(formatAssetGlossary(relevant, conflicts).split('\n').slice(0, 12).map((l) => '   ' + l).join('\n'));

  console.log('\n' + '='.repeat(72));
  db.close();
}

main();
