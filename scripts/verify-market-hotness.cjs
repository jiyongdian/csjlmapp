/**
 * 快速验证：剧本质检系统集成市场热度评分
 * 用法: node scripts/verify-market-hotness.cjs
 */
const path = require('path');
const Module = require('module');
const originalResolve = Module._resolveFilename;
let tsRegistered = false;
try { require('ts-node/register'); tsRegistered = true; } catch (_) {}

async function main() {
  console.log('=== 📊 剧本质检 × 市场热度评分 验证 ===\n');

  // 动态加载 ts 模块（兼容 ts-node / 未注册两种情况）
  let validator;
  try {
    if (!tsRegistered) {
      // 简易 ts 解析：用 esbuild-register 或直接读源码手动 eval 太复杂，
      // 简化处理：读取 quality-validator.ts 并检查关键修改是否落地
      const fs = require('fs');
      const src = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'lib', 'screenplay', 'quality-validator.ts'),
        'utf8'
      );
      console.log('✅ 1. 代码静态检查：');
      const checks = [
        ['import computeHotnessScore from creative-hub', /import\s*\{\s*computeHotnessScore\s*\}\s*from\s*['"]\.\.\/creative-hub['"]/],
        ['HotnessBreakdown 接口', /interface\s+HotnessBreakdown/],
        ['marketScore 字段', /marketScore\?:\s*number/],
        ['hotness 字段', /hotness\?:\s*HotnessBreakdown/],
        ['finalScore 字段', /finalScore\?:\s*number/],
        ['IssueType.market', /\| 'market'/],
        ['QualityIssue.dimension', /dimension\?:\s*'genreMatch'\s*\|\s*'hookPower'\s*\|\s*'rhythmFit'\s*\|\s*'archetypePop'/],
        ['市场维度 issues 生成循环', /for\s*\(const dim of marketDimensions\)/],
        ['综合分 = 创作70% + 市场30%', /creativePart\s*=\s*score\s*\*\s*0\.7/],
      ];
      let pass = 0;
      for (const [name, re] of checks) {
        const ok = re.test(src);
        console.log(`   ${ok ? '✅' : '❌'} ${name}`);
        if (ok) pass++;
      }
      console.log(`\n   静态检查结果: ${pass}/${checks.length} 通过`);
      if (pass < checks.length) {
        console.log('❌ 有代码修改未落地，请检查 quality-validator.ts');
        process.exit(1);
      }
    } else {
      validator = require(path.join(__dirname, '..', 'src', 'lib', 'screenplay', 'quality-validator.ts'));
      const hub = require(path.join(__dirname, '..', 'src', 'lib', 'creative-hub.ts'));
      console.log('✅ 1. 模块加载成功');
      console.log(`   - validateScreenplay = ${typeof validator.validateScreenplay}`);
      console.log(`   - computeHotnessScore = ${typeof hub.computeHotnessScore}`);
      console.log(`   - HOT_GENRES 数量 = ${hub.HOT_GENRES.length}`);
      console.log(`   - OPENING_HOOKS 数量 = ${hub.OPENING_HOOKS.length}`);
      console.log(`   - CHARACTER_ARCHETYPES 数量 = ${hub.CHARACTER_ARCHETYPES.length}`);

      // 构造测试场景：一个"爆款重生复仇"风格的剧本
      const hotScenes = [
        {
          sceneIndex: 1,
          sceneTitle: '婚礼现场 / 当众离婚',
          visual: '五星级酒店婚礼大厅，水晶吊灯下几百宾客注视，新娘穿着白纱，对面新郎冷笑。离婚协议书被甩在红毯上，孕检单贴在最上面。全场倒抽冷气。',
          actions: '新郎抬手要扇耳光，新娘侧身躲开，掏出手机投屏。',
          dialogues: [
            { character: '新郎', line: '你这种女人，不配怀我的孩子！滚出陆家，永远别回来！' },
            { character: '新娘', line: '（微笑擦嘴角血）爸，可以宣布了，收购陆家。' },
          ],
          shotType: '近景',
          cameraAngle: '正面',
          duration: '10秒',
          cameraMovement: '推镜',
          soundDesign: '耳光清脆回响 + 宾客哗然 + 手机投屏的信号音效 + BGM鼓点',
          sceneTransition: '承接上门嘲讽 → 推进下一场陆家集团崩盘 / 道具转移：手机从口袋到手上 / 情绪增量：新娘从隐忍到反转的笑意',
          sourceBeat: '第一章末：重生回婚礼当天，婚礼前一夜被迷奸，前世被陆家全家害死',
          location: '上海陆家五星酒店',
        },
        {
          sceneIndex: 2,
          sceneTitle: '陆家集团会议室 / 身份亮明',
          visual: '陆家上市总部顶层会议室，几十个陆家董事面面相觑，屏幕上是收购公告。新娘换上一身黑西装走进来，特助们跟在身后。董事长当场瘫在椅子上。',
          actions: '她把那份签好的离婚协议拍在桌上，冷眼看着瘫倒的前公婆。',
          dialogues: [
            { character: '新娘', line: '各位董事早——自我介绍下，我是南方资本控股的实际控制人，阮红袖。陆家，从今天起改姓阮了。' },
            { character: '董事长', line: '不、不可能……你不是乡下来的穷丫头吗？！' },
          ],
          shotType: '全景转近景',
          cameraAngle: '俯拍',
          duration: '12秒',
          cameraMovement: '拉镜→推镜',
          soundDesign: '会议室空调声 + 文件拍桌的巨响 + 众人呼吸急促 + 大提琴低沉BGM',
          sceneTransition: '承接上一场投屏收购 → 推进董事集体下跪 / 道具转移：收购文件袋从特助手到桌面 / 情绪增量：陆家惊恐绝望达到顶点',
          sourceBeat: '第二章：用前世记忆，提前三个月狙击陆家现金流缺口，一举收购。',
          location: '上海陆家五星酒店',
        },
      ];

      const chapterContent = `《好一个乖乖女》第一章：我前世在陆家做牛做马五年，最后被他们全家联手推下天台。临死前，我看着我最好的闺蜜和我老公在阳台喝红酒庆祝："那个傻子终于死了，陆家的家产都是我们的了。"我再睁眼——回到了结婚当天，化妆师正给我梳头，司仪在外面催："新娘子准备好了吗？新郎家的车队到楼下了。"我摸了摸手腕上那道前世被他们打断的疤，笑了。这一世，我不会再做那个乖乖女。我要让陆家所有人，跪着，求我。`;

      console.log('\n✅ 2. 执行剧本质检（含市场热度）：');
      const report = validator.validateScreenplay(hotScenes, chapterContent);
      console.log(`   - ok = ${report.ok}`);
      console.log(`   - 创作分 score = ${report.score}/100`);
      console.log(`   - 市场热度分 marketScore = ${report.marketScore}/100`);
      console.log(`   - 综合分 finalScore = ${report.finalScore}/100`);
      console.log(`   - 评级 grade = ${report.hotness?.grade || 'N/A'}`);
      console.log(`   - 匹配题材 = ${report.hotness?.matchedGenreNames?.join('、') || '无'}`);
      console.log(`   - 4维度拆解:`);
      if (report.hotness) {
        const d = report.hotness.dimension;
        const bar = (v) => {
          const filled = Math.round(v / 5);
          return '█'.repeat(filled) + '░'.repeat(20 - filled);
        };
        console.log(`     · 题材匹配度  ${bar(d.genreMatch)} ${d.genreMatch}/100`);
        console.log(`     · 钩子强度    ${bar(d.hookPower)} ${d.hookPower}/100`);
        console.log(`     · 节奏适配性  ${bar(d.rhythmFit)} ${d.rhythmFit}/100`);
        console.log(`     · 人设流行度  ${bar(d.archetypePop)} ${d.archetypePop}/100`);
      }
      console.log(`   - 总issues数 = ${report.issues.length}`);
      const marketIssues = report.issues.filter((i) => i.type === 'market');
      console.log(`     · 其中市场维度issues = ${marketIssues.length}`);
      marketIssues.forEach((i) => console.log(`       · [${i.severity}] ${i.message}`));
      console.log(`   - 市场建议数 = ${report.hotness?.suggestions?.length || 0}`);
      console.log(`   - 连贯性扣分 = ${report.continuityDeduct}`);
      console.log(`   - 市场修正分 = ${report.marketDeduct}`);

      console.log('\n✅ 3. 评分校验：');
      const expectPass = report.finalScore >= 70;
      console.log(`   ${expectPass ? '✅' : '⚠️'} 综合分 ≥70 及格线：${report.finalScore} ${expectPass ? '通过' : '(非致命，仅提示)'}`);
      const marketPass = (report.marketScore || 0) >= 60;
      console.log(`   ${marketPass ? '✅' : '⚠️'} 市场分 ≥60：${report.marketScore} ${marketPass ? '通过' : '(爆款元素偏少，建议补充)'}`);
    }

    console.log('\n=== ✅ 全部检查完成 ===');
  } catch (e) {
    console.error('❌ 运行失败:', e);
    process.exit(1);
  }
}
main();
