/**
 * 深度知识库注入 - 大纲/写作说明题材模块
 * 注入各题材的大纲和写作说明模块
 */

const Database = require('better-sqlite3');
const db = new Database('novel.db');

console.log('=== 大纲/写作说明题材模块注入 ===\n');

const PROMPTS = {};

// ========== 大纲类 ==========
PROMPTS['agent-skill-novel-outline-romance'] = `# 言情文 · 大纲结构 Skill

撰写**言情文大纲**。感情线为核心，事业线为支撑。

## 大纲结构要求
1. **感情递进**：陌生→试探→暧昧→确认→考验→稳定
2. **甜虐节奏**：3甜1虐，虐后必甜
3. **双向奔赴**：双方都有成长线
4. **细节规划**：关键感情节点有细节设计

## 【言情关键节点】
初遇→心动→误会→坦白→考验→圆满

## 【言情钩子规划】
每章：感情进展→甜/虐点→章尾关系变化钩子

## 【人物命名铁律】
❌ 禁止AI烂大街名字：叶辰、林辰、墨渊、萧逸、顾言琛、陆沉渊、沈寂、凌夜、厉霆骁、傅斯年、苏晚、温阮、洛璃、云舒、许念、白芷、叶绾绾、唐知予、宁汐、夏晚晴、慕晚 等`;

PROMPTS['agent-skill-novel-outline-angst'] = `# 虐恋文 · 大纲结构 Skill

撰写**虐恋文大纲**。有枷锁的爱情，甜虐交织。

## 大纲结构要求
1. **枷锁设定**：宿命/现实/身份/仇恨一致
2. **甜虐节奏**：先甜后虐，虐中有甜
3. **心理刻画**：内心挣扎是核心
4. **成长弧线**：心理成长/堕落/救赎

## 【虐恋关键节点】
甜蜜时光→误会/伤害→心死/离开→真相/后悔→救赎/遗憾

## 【虐恋情绪曲线】
甜→裂→虐→痛→麻木→真相→后悔→救赎

## 【人物命名铁律】
❌ 禁止AI烂大街名字`;

PROMPTS['agent-skill-novel-outline-xuanhuan'] = `# 玄幻文 · 大纲结构 Skill

撰写**玄幻文大纲**。境界自洽，升级有代价。

## 大纲结构要求
1. **境界体系**：等级/能力/权力自洽
2. **升级节奏**：突破→巩固→再突破
3. **双线推进**：战力线+恩怨线并行
4. **冲突升级**：家族→势力→种族→天道

## 【玄幻关键节点】
废柴开局→金手指→首次突破→遭遇强敌→历练成长→血脉觉醒

## 【玄幻节奏】
每3000-5000字一个爽点，每5-8章一个大反转

## 【人物命名铁律】
❌ 禁止AI烂大街名字`;

PROMPTS['agent-skill-novel-outline-mystery'] = `# 悬疑文 · 大纲结构 Skill

撰写**悬疑文大纲**。伏笔密布，层层递进。

## 大纲结构要求
1. **伏笔体系**：浅中深三层伏笔
2. **信息控制**：读者/角色信息差设计
3. **反转规划**：每5-8章一次反转，3处以上铺垫
4. **真相闭环**：所有线索形成闭环

## 【悬疑关键节点】
离奇事件→线索发现→嫌疑人浮现→推理受阻→真相碎片→终极真相

## 【悬疑悬念规划】
微悬念→小悬念→中悬念→大悬念→极悬念

## 【人物命名铁律】
❌ 禁止AI烂大街名字`;

// 其他大纲
const outlineGenres = ['apocalypse','brainhole','campus','farming','game','isekai','officialdom','scifi','spy','superpower','weird','wuxia','xianxia'];
for (const g of outlineGenres) {
  PROMPTS['agent-skill-novel-outline-' + g] = `# ${g}文 · 大纲结构 Skill

撰写**${g}文大纲**。遵循题材核心要素。

## 大纲结构要求
1. 符合${g}题材的核心要素
2. 节奏递进，冲突升级
3. 每章标注：情绪目标/冲突功能/钩子类型
4. 伏笔账本：埋下/升级/回收对应

## 【关键节点设计】
按${g}题材的典型结构设计关键转折点。

## 【人物命名铁律】
❌ 禁止AI烂大街名字`;
}

// ========== 写作说明类 ==========
PROMPTS['agent-skill-novel-writing-brief-romance'] = `# 言情文 · 本章写作说明

撰写**言情文章节写作说明**。聚焦感情进展。

## 必须包含
1. 本章感情进展阶段
2. 甜/虐点设计
3. 关键对话/心动场景
4. 章尾关系变化钩子
5. 情绪目标

## 【言情细节提醒】
偏爱/破例/专属对待等细节
口是心非/欲言又止等情绪
身体反应代替形容词

## 【人物命名铁律】
❌ 禁止AI烂大街名字`;

PROMPTS['agent-skill-novel-writing-brief-angst'] = `# 虐恋文 · 本章写作说明

撰写**虐恋文章节写作说明**。聚焦心理挣扎。

## 必须包含
1. 本章心理变化
2. 甜/虐点（甜衬虐）
3. 关键对话/伤害场景
4. 章尾情绪钩子
5. 情绪目标

## 【虐恋细节提醒】
甜蜜回忆的刺痛对比
内心挣扎的身体反应
有苦衷的伤害

## 【人物命名铁律】
❌ 禁止AI烂大街名字`;

PROMPTS['agent-skill-novel-writing-brief-xuanhuan'] = `# 玄幻文 · 本章写作说明

撰写**玄幻文章节写作说明**。聚焦战力升级。

## 必须包含
1. 本章战力进展
2. 战斗/升级细节
3. 关键招式/突破场景
4. 章尾境界变化钩子
5. 情绪目标

## 【玄幻细节提醒】
境界/修为的具体数值
功法/招式的名称和效果
对手的实力和威胁

## 【人物命名铁律】
❌ 禁止AI烂大街名字`;

PROMPTS['agent-skill-novel-writing-brief-mystery'] = `# 悬疑文 · 本章写作说明

撰写**悬疑文章节写作说明**。聚焦线索推进。

## 必须包含
1. 本章线索进展
2. 伏笔/回收动作
3. 关键推理/发现场景
4. 章尾悬念钩子
5. 情绪目标

## 【悬疑细节提醒】
线索的具体位置和内容
嫌疑人的行为和证词
推理的逻辑链条

## 【人物命名铁律】
❌ 禁止AI烂大街名字`;

// 其他写作说明
const briefGenres = ['apocalypse','brainhole','campus','farming','game','isekai','officialdom','scifi','spy','superpower','weird','wuxia','xianxia'];
for (const g of briefGenres) {
  PROMPTS['agent-skill-novel-writing-brief-' + g] = `# ${g}文 · 本章写作说明

撰写**${g}文章节写作说明**。聚焦${g}题材核心要素。

## 必须包含
1. 本章核心进展
2. 关键场景/冲突
3. 章尾钩子
4. 情绪目标
5. 一致性账本

## 【${g}题材细节提醒】
符合${g}题材的核心要素和写作特点。

## 【人物命名铁律】
❌ 禁止AI烂大街名字`;
}

// ========== 写作说明continuity ==========
PROMPTS['agent-skill-novel-writing-brief-continuity'] = `# 网文写作 · 15项一致性 Skill（本章写作说明）

## 核心总纲
> 所有细节不凭空变、不反向变、不遗忘变；只允许有铺垫的渐变。

## 写作说明必增：【一致性账本】
### 1. 环境场景
时间、天气、地点、空间、氛围基调
### 2. 人物位置
谁在哪、距离多远、朝向
### 3. 境界修为
等级、状态、消耗
### 4. 资源物品
身上有什么、消耗了什么、获得了什么
### 5. 人设性格
说话方式、行为模式
### 6. 伤势状态
哪里受伤、程度、影响
### 7. 关系变化
与谁什么关系、变化趋势
### 8. 时间流逝
过了多久
### 9. 信息掌握
谁知道什么、不知道什么
### 10. 伏笔状态
哪个伏笔已埋/已收

## 【钩子设计要求】
必须标注：章首钩子类型 + 章尾钩子类型

## 【去AI味前置提醒】
禁用句式清单 + 禁用词替换表 + 弱化副词限制

## 【人物命名铁律】
❌ 禁止AI烂大街名字`;

// ========== 执行注入 ==========
let success = 0, failed = 0, skipped = 0;

for (const [code, prompt] of Object.entries(PROMPTS)) {
  try {
    const existing = db.prepare('SELECT id FROM model_prompts WHERE code = ?').get(code);
    if (!existing) {
      console.log(`⚠️  [跳过] ${code}`);
      skipped++;
      continue;
    }
    const result = db.prepare(
      'UPDATE model_prompts SET system_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?'
    ).run(prompt, code);
    if (result.changes > 0) {
      console.log(`✅ [成功] ${code} (${prompt.length} 字)`);
      success++;
    }
  } catch (err) {
    console.log(`❌ [错误] ${code} - ${err.message}`);
    failed++;
  }
}

console.log(`\n大纲/写作说明模块注入完成: 成功${success}, 跳过${skipped}, 失败${failed}`);
db.close();
