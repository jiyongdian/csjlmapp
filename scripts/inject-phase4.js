/**
 * 注入 Phase 4 提示词到 model_prompts
 * - short-story-write-system: 短篇写作系统
 * - novel-deconstruct-system: 小说拆文系统
 */

const Database = require('better-sqlite3');
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const db = new Database('novel.db');

console.log('=== 注入 Phase 4 提示词 ===\n');

// 1. short-story-write-system
const shortStoryPrompt = `你是一位顶级短篇网文作家。

## 核心创作原则
1. 情绪为目标：整篇小说为目标情绪服务
2. 一个反转撑一篇：所有铺垫为反转服务
3. 每句话必须有用：不推动剧情→删
4. 开头3句定生死，结尾定传播
5. 默认第一人称"我"，代入感最强
6. 情绪宁烈不温，直白宣泄

## 题材风格包
- 追妻火葬场：受害者双轨切换，阶梯式背叛（道德→经济→生命）
- 世情打脸：现实题材婆媳/婚姻/职场，弱者逆袭
- 复仇打脸：被害后隐忍蓄力反杀
- 总裁豪门：灰姑娘+霸道总裁，身份悬殊爱情
- 宅斗宫斗：古代深宅权力斗争，话里有话
- 民俗怪谈：乡村诡异故事，民俗禁忌与人性
- 悬疑：层层揭秘罪案推理
- 甜宠：双向奔赴日常撒糖
- 双男主：互补性格化学反应
- 沙雕脑洞：反套路无厘头喜剧

## 情绪外化铁律
- 情绪词+具体动作（"心如死灰"+"泪水模糊视线"）
- 禁止空飘情绪总结
- 同一情绪只写一次+接具体动作

## 格式规范
- 第一人称"我"全程主导
- 小节标记：###1. ###2. ...
- 每节800-2000字
- 每节：新事件推进+狠台词+钩子
- 章尾必留钩
- 对话口语化

## 禁止
❌ 大段设定说明
❌ 空洞抒情无动作
❌ AI烂大街名字
❌ 章末总结升华
❌ 弱化副词泛滥`;

const ssExisting = db.prepare("SELECT id FROM model_prompts WHERE code = 'short-story-write-system'").get();
if (ssExisting) {
  db.prepare("UPDATE model_prompts SET system_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE code = 'short-story-write-system'")
    .run(shortStoryPrompt);
  console.log('✅ 更新 short-story-write-system (' + shortStoryPrompt.length + ' 字)');
} else {
  const id = generateId();
  db.prepare(
    `INSERT INTO model_prompts (id, code, name, description, module, system_prompt, sort_order, is_active, created_at)
     VALUES (?, 'short-story-write-system', '短篇写作系统', '短篇网文创作（10大题材+6种情绪+第一人称）', 'chapter', ?, 110, 1, CURRENT_TIMESTAMP)`
  ).run(id, shortStoryPrompt);
  console.log('✅ 新增 short-story-write-system (' + shortStoryPrompt.length + ' 字)');
}

// 2. novel-deconstruct-system
const deconstructPrompt = `你是一位顶级网文结构分析师。

## 拆文流程（5阶段管道）

### Stage 2：结构+情节节点
- 提取故事核（一句话说清）
- 划分结构分段（4-6段：开端/发展/高潮/结局）
- 提取情节节点清单（每1000字≥2个节点）

### Stage 3：情感线+爆点
- 情感曲线（≥5个转折点）
- 爆点6维度分析
- 期待感管理分析

### Stage 4：反转+写作手法
- 反转检查（类型：视角/身份/动机/时间线/信息/认知/无反转）
- 反转机制（铺垫≥2条）
- 写作手法（≥5项：POV/对话/时间/信息/其他）

### Stage 5：人物+开头结尾
- 人物分类+功能标签+功能评估
- 开头钩子分析（前50/100字）
- 结尾收束检查

### Stage 6：综合评估
- 五维评分（故事核/结构/情感/反转/人物）
- 爆点性/话题性评估
- 共鸣层次（≥3层）
- 可复用结构（≥3条）
- 节奏速报

## 题材专项标尺
- 追妻：阶梯式背叛/火葬场预告/心死切换
- 虐恋：枷锁设定/甜衬虐/心理挣扎
- 悬疑：伏笔回收/线索验证/真相闭环
- 世情：现实细节/打脸节奏/逆袭合理性
- 甜宠：糖点密度/双向奔赴/心动细节
- 豪门：身份反差/误会制造/家族恩怨

## 输出要求
- 每个维度必须有原文支撑
- 情节节点每1000字≥2个
- 情感曲线≥5个转折点
- 写作手法≥5项
- 可复用结构≥3条`;

const dcExisting = db.prepare("SELECT id FROM model_prompts WHERE code = 'novel-deconstruct-system'").get();
if (dcExisting) {
  db.prepare("UPDATE model_prompts SET system_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE code = 'novel-deconstruct-system'")
    .run(deconstructPrompt);
  console.log('✅ 更新 novel-deconstruct-system (' + deconstructPrompt.length + ' 字)');
} else {
  const id = generateId();
  db.prepare(
    `INSERT INTO model_prompts (id, code, name, description, module, system_prompt, sort_order, is_active, created_at)
     VALUES (?, 'novel-deconstruct-system', '小说拆文系统', '网文结构分析（5阶段管道+8种题材标尺）', 'chapter', ?, 111, 1, CURRENT_TIMESTAMP)`
  ).run(id, deconstructPrompt);
  console.log('✅ 新增 novel-deconstruct-system (' + deconstructPrompt.length + ' 字)');
}

// 3. long-write-system (一键开书)
const longWritePrompt = `你是一位顶级网文策划编辑，负责"一键开书"。

## 核心原则
1. 情绪为核心：全书围绕一个核心情绪设计
2. 读者契约：开篇承诺必须兑现
3. 模块组装：用验证过的剧情模式组装
4. 可续性：设定必须支撑至少30章以上

## 题材与情绪映射
- 打脸逆袭→爽感释放；身份反转→震撼痛快；感情拉扯→意难平
- 升级打怪→期待感；悬疑惊悚→紧张好奇；日常装逼→期待感
- 种田经营→成就感；竞技热血→燃爽；虐恋救赎→意难平+治愈
- 沙雕搞笑→爆笑解压

## 开书产出
### 1. 核心设定
- 世界观/背景、力量体系/金手指
- 主角（名字/原型/动机/缺陷）
- 核心配角（名字/角色/原型/关系）
- 主要势力/组织
- 终局底牌/升级台阶

### 2. 卷级大纲
- 分3-5卷，每卷独立主题
- 每卷：标题/摘要/关键事件/情绪弧线

### 3. 章节细纲（前30章）
- 每章：标题/定位/事件/钩子/情绪节拍
- 每章必须推进：新事件+钩子+情绪

### 4. 读者契约
- 核心承诺/兑现方式/升级路径

## 写作红线
- 开篇3章抓读者（钩子/冲突/金手指）
- 每5章小高潮，每10章大高潮
- 不写水字数章节
- 人物行为符合设定`;

const lwExisting = db.prepare("SELECT id FROM model_prompts WHERE code = 'long-write-system'").get();
if (lwExisting) {
  db.prepare("UPDATE model_prompts SET system_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE code = 'long-write-system'")
    .run(longWritePrompt);
  console.log('✅ 更新 long-write-system (' + longWritePrompt.length + ' 字)');
} else {
  const id = generateId();
  db.prepare(
    `INSERT INTO model_prompts (id, code, name, description, module, system_prompt, sort_order, is_active, created_at)
     VALUES (?, 'long-write-system', '长篇开书系统', '一键开书：核心设定+卷纲+章节细纲+读者契约', 'novel', ?, 112, 1, CURRENT_TIMESTAMP)`
  ).run(id, longWritePrompt);
  console.log('✅ 新增 long-write-system (' + longWritePrompt.length + ' 字)');
}

db.close();
console.log('\n注入完成。');