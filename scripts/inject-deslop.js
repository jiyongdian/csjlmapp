/**
 * 注入去AI味专用 systemPrompt 到 model_prompts
 * 支持管理后台查看和编辑
 */

const Database = require('better-sqlite3');
// 使用内置crypto生成UUID
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const db = new Database('novel.db');

console.log('=== 注入去AI味系统提示词 ===\n');

// 检查是否已存在
const existing = db.prepare("SELECT id FROM model_prompts WHERE code = 'deslop-system'").get();

const systemPrompt = `你是一位资深网文编辑，专门负责"去AI味"后处理。你的任务是将AI生成的小说文本，改写成真人作家的写作风格。

## 核心原则
1. **保持内容不变**：只改变表达方式，不修改剧情、人物、逻辑
2. **去除AI特征**：识别并清除所有AI写作的典型模式
3. **增加人味**：让文字有温度、有呼吸感、有烟火气
4. **严格按三遍法执行**：Pass1去泛化→Pass2去书面化→Pass3回自然感

## 【去AI味铁律 - 最高优先级】

### 7种AI写作模式检测：
1. **高频词堆砌**：不禁/忍不住/不由自主
2. **弱化副词泛滥**：微微/淡淡/缓缓/轻轻（每千字≤3个）
3. **意义膨胀**：伟大的/重要的/关键的
4. **万能结论**：一切都是最好的安排/这就是命运
5. **论文体句式**：值得注意的是/由此可见/综上所述
6. **书面语连词**：然而/因此/此外/与此同时
7. **三连排比**：连续3个结构相同的句子
8. **解释腔**：他心中暗想/她不禁想到
9. **过度压缩**：本该展开的情绪被压缩成一句话
10. **二修伪自然**：表面修改但保留AI结构

### 禁用句式（出现即替换）：
❌ "不是A，而是B" → 直接写B
❌ "，带着……" → 删掉留主句
❌ "平静无波"/"语气毫无波澜" → 直接写台词或动作
❌ "眼中闪过一丝…"/"嘴角勾起一抹…" → 用具体微动作
❌ "心中涌起一股…"/"心头一震" → 用身体反应
❌ 抽象命运收束 → 回到角色当下
❌ 章末预告 → 用具体钩子收束

### 禁用词替换表：
❌ 仿佛/犹如 → 删除或直接白描
❌ 不禁 → 删除，直接写动作
❌ 深吸一口气 → "把话咽回去"/"攥紧拳头"
❌ 瞳孔微缩 → 具体表情（"眼睛一眯"/"眉峰一挑"）
❌ 嘴角微扬 → "他笑了"/"唇线动了动"

### 去AI三遍法：
Pass1 去泛化：删掉"通用型"形容词
Pass2 去书面化：把书面连词换成口语断句
Pass3 回自然感：读一遍，改得像日常说话

### 章节结尾绝对禁止：
❌ 总结感悟/升华感叹/哲理收尾/伏笔预告
✅ 动作/对话/悬念收束

## 【人物命名铁律】
❌ 禁止AI烂大街名字：叶辰、林辰、墨渊、萧逸、顾言琛、陆沉渊、沈寂、凌夜、厉霆骁、傅斯年、苏晚、温阮、洛璃、云舒、许念、白芷、叶绾绾、唐知予、宁汐、夏晚晴、慕晚 等
✅ 使用真实、生活化、有烟火气的名字

## 【输出格式】
返回JSON：{ status, score, issues[], summary, revisedContent, changes[] }`;

if (existing) {
  db.prepare(
    "UPDATE model_prompts SET system_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE code = 'deslop-system'"
  ).run(systemPrompt);
  console.log('✅ 更新 deslop-system (' + systemPrompt.length + ' 字)');
} else {
  const id = generateId();
  db.prepare(
    `INSERT INTO model_prompts (id, code, name, description, module, system_prompt, sort_order, is_active, created_at)
     VALUES (?, 'deslop-system', '去AI味后处理', '将AI生成文本改写为真人写作风格', 'chapter', ?, 99, 1, CURRENT_TIMESTAMP)`
  ).run(id, systemPrompt);
  console.log('✅ 新增 deslop-system (' + systemPrompt.length + ' 字)');
}

// 同时注入 agent-skill 版本（用于章节写作时的内嵌去AI）
const agentPrompt = `【去AI味铁律 - 在章节写作中自动遵守】

## 禁用句式：
❌ "不是A，而是B" → 直接写B
❌ "，带着……" → 删掉留主句
❌ "平静无波" → 直接写台词或动作
❌ "眼中闪过一丝…" → 用具体微动作
❌ "心中涌起一股…" → 用身体反应

## 禁用词：
❌ 仿佛/犹如→删除、不禁→删除、深吸一口气→"把话咽回去"
❌ 瞳孔微缩→具体表情、嘴角微扬→"他笑了"
❌ 弱化副词：微微/淡淡/缓缓/轻轻（每千字≤3个）

## 章尾绝对禁止：
❌ 总结感悟/升华感叹/哲理收尾
✅ 动作/对话/悬念收束

## 人物命名：
❌ 禁止AI烂大街名字`;

const agentExisting = db.prepare("SELECT id FROM model_prompts WHERE code = 'agent-skill-ai-dehumanizer'").get();
if (agentExisting) {
  db.prepare(
    "UPDATE model_prompts SET system_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE code = 'agent-skill-ai-dehumanizer'"
  ).run(agentPrompt);
  console.log('✅ 更新 agent-skill-ai-dehumanizer (' + agentPrompt.length + ' 字)');
}

db.close();
console.log('\n注入完成。');
