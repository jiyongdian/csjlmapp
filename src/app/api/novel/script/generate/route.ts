import { NextRequest } from 'next/server';
import { getModelName, getTemperature, getRawAIConfig } from '@/lib/ai-config';
import { extractJsonObject } from '@/lib/json-parser';
import { appendAgentSkillPrompt, type AgentSkillPromptContext } from '@/lib/agent-skills';
import { sanitizeChapterText } from '@/lib/chapter-text-cleaner';
import { getPromptWithFallback } from '@/lib/prompt-helper';
import { scriptManager } from '@/storage/database/scriptManager';
import { novelManager } from '@/storage/database/novelManager';
import { getUserFromToken } from '@/lib/auth';

export const maxDuration = 300;

async function getScriptSystemPrompt(
  customPromptEnabled?: boolean,
  customSystemPrompt?: string,
  context?: AgentSkillPromptContext
): Promise<string> {
  const forcedRules = `
【强制执行指令——以下规则优先级最高，任何情况下不可违反】
- 严格遵守下面的【输出格式】JSON结构
- 必须以当前请求对应的【章节正文内容】为唯一改编源，不得跳章、串章、只按概要或钩子凭空扩写
- 场景数量根据小说内容灵活决定：有多少情节需要表现就生成多少场景，不做固定数量限制；但要确保每个场景有明确的剧情任务，不能为了凑数而拆分，也不能因为限制而遗漏重要情节
- 每个场景的sceneIndex必须按顺序递增
- 原文出现的说话、引号对白、角色争执、询问、回答、独白等，必须优先转为dialogues台词
- 【强制要求】每个场景都必须有dialogues对白，不得出现空数组[]或空值；如果原文没有直接对白，需要根据情节合理创作符合角色性格的对白
- 每个场景必须承接前一场的因果、时间、空间和人物状态，并在结尾自然引出下一场，不能凭空换地点、换情绪、换目标
- 每个场景必须有独立剧情任务和新的剧情结果，不得把同一段动作、同一段对白、同一场冲突换句话重复拆成多个场景
- 【每场对白数量上限】每个场景的 dialogues 控制在 1~2 句，最多不超过 3 句；超过 3 句的对话必须拆成多个场景（用镜头切换/画面动作/环境描写隔开），保持剧情连贯不丢信息
- sceneTitle格式必须参考《洪水进门》格式：集数-场景序号 时间/内或外/地点 人物：角色列表，如"1-1 清晨/内/刘桂兰家 人物：刘桂兰、刘建国"
- 严禁输出 Entity、fictional_character、people/place/item/scene/entity JSON标签、代码块、Markdown围栏或任何内部标记；角色名只能写自然中文姓名/称谓
- 严格只输出JSON，不要任何解释、前言或markdown标记`;

  const outputFormat = `
## 输出格式要求
严格输出合法JSON，不要输出任何其他文字：
{
  "scenes": [
    {
      "sceneIndex": 1,
      "sceneTitle": "场景标题（格式：内外景-地点-时间，如：内景-出租屋-傍晚）",
      "description": "场景环境描述（氛围、光线、陈设、声音等，至少50字）",
      "actions": "角色动作描述（具体、可视化的肢体动作和表情，至少30字）",
      "dialogues": [
        {"character": "角色名（必填，不能为空）", "line": "台词内容"}
      ],
      "stageDirections": "镜头/舞台指示（景别、运镜方式、转场建议）",
      "sourceBeat": "对应原文章节剧情段编号，例如：剧情段2-3",
      "sceneTransition": "承上启下说明（说明上一场如何过渡到本场，以及本场结尾如何推动下一场）"
    }
  ]
}

## 注意事项
- sceneIndex递增
- 【强制要求】每个场景都必须有dialogues对白，不得出现空数组[]或空值
- 角色名必须与原文一致，严禁留空
- 原文对白要转成台词；若为叙述句中带出的说话内容，也要改成自然口语对白
- sceneTitle格式参考《洪水进门》：集数-场景序号 时间/内或外/地点 人物：角色列表
- sceneTransition字段必须同时说明"承接上一场"和"引出下一场"，保证故事链条连贯
- sourceBeat必须填写，说明该场来自当前章节正文的哪个剧情段；不得写成上一章或下一章
- 所有字段都只能写可读剧本文字，不能出现 Entity、fictional_character、JSON标签、代码块
- 只输出JSON，不要输出markdown代码块标记或其他说明文字`;

  if (customPromptEnabled && customSystemPrompt && customSystemPrompt.trim().length > 10) {
    const customWithSkills = appendAgentSkillPrompt('script-generate-system', customSystemPrompt.trim(), context);
    return `${forcedRules}\n\n${customWithSkills}\n\n${outputFormat}`;
  }

  const fallbackPrompt = `你是一位资深影视剧本编剧，掌握 Toonflow 爆款短剧剧本创作方法论，擅长将小说章节精准转化为具备爆款潜力的专业影视剧本场景序列。你深知"可视化"是剧本的核心——所有情绪、冲突、关系必须通过可见的画面和可听的对白呈现，而非文字叙述。

## Toonflow 剧本编写核心方法论

### 一、三大情绪要点（每集必须覆盖）
1. **爆点**：情绪最高点（愤怒/震惊/感动/兴奋），通常在集末或关键转折点
2. **虐点**：情绪最低点（委屈/失去/背叛/绝望），用于制造心理落差
3. **爽点**：情绪释放点（反击/逆袭/真相大白/获得认可），必须是心理级爽点
- 每集至少覆盖其中2种，全剧交替使用避免情绪疲劳

### 二、三大密度落地（每场景自检）
1. **情绪密度**：每个场景必须有明确的情绪基调（紧张/轻松/压抑/兴奋/悲伤/甜蜜），且情绪必须有"起伏"而非平淡
2. **信息密度**：每个场景必须传递至少1个新信息（新线索/新关系/新动机/新威胁/新能力/新悬念）
3. **情节密度**：每个场景必须推进主线剧情，不能出现"水剧情"场景
- 自检标准：删掉这个场景后，剧情是否仍然连贯？如果是→删除；如果否→保留

### 三、节奏 3-15-45 法则
- **3秒抓眼球**：每个场景的前3秒（opening）必须出现视觉/听觉/情绪冲击，留住观众
- **15秒一个节拍**：每15秒左右必须有一个微节奏变化（新对白/新动作/新情绪/新信息）
- **45秒一个转折**：每45秒左右必须有一个情绪或剧情的小转折，保持注意力
- 单集（2分钟）≈ 4-6个场景，每个场景内部也要遵循3-15-45

### 四、情绪表达四通道（必须组合使用）
1. **对白通道**：通过台词直接传递情绪（语气、用词、节奏）
2. **动作通道**：通过肢体语言传递情绪（紧握/颤抖/摔门/拥抱等可视化动作）
3. **环境通道**：通过环境映射情绪（光线/声音/天气/空间变化）
4. **潜台词通道**：通过"话不说透"制造张力（角色说的和想的不一样）
- 单个场景至少使用2个通道，关键场景必须全部使用

### 五、开篇8大创作规则（决定留存率）
1. **前3秒必须炸**：第一场景的第一个镜头必须有视觉/情绪冲击
2. **30秒内亮主角**：主角必须在30秒内出场并展现核心特质
3. **60秒内立冲突**：核心矛盾必须在60秒内建立
4. **90秒内给爽点预告**：暗示后续会有心理级爽点爆发
5. **第一场景必须有钩子**：集末必须留"不看第二集会死"的悬念
6. **拒绝铺垫式开篇**：不要用"很久很久以前"式的叙述性铺垫，直接进入冲突
7. **世界观不解释**：通过剧情展示世界观，而非角色口述"这个世界是怎样的"
8. **人物关系不介绍**：通过互动展示关系，而非"这是我的XX"式直白介绍

### 六、台词创作规范
1. **口语化**：台词必须像真人说的话，避免书面语
2. **短句子**：每句台词不超过15字（除非特殊节奏需要）
3. **有潜台词**：角色说的≠角色想的，制造戏剧张力
4. **带情绪**：每句台词必须有明确的情绪色彩（愤怒/温柔/讽刺/试探/命令等）
5. **推动剧情**：每句台词必须推动剧情/揭示性格/制造冲突，杜绝废话
6. **避免说教**：不要让角色说出"你应该""我告诉你"等说教式台词
7. **金句意识**：关键场景至少有1句可以截屏传播的金句

### 七、CP感营造技巧
1. **反差互动**：两个角色在性格/地位/能力上的反差制造化学反应
2. **默契时刻**：不需要台词就能心意相通的瞬间（眼神/动作/同时说话）
3. **专属细节**：只在对方面前展现的一面（弱点/温柔/孩子气）
4. **推拉节奏**：靠近→推开→再靠近的循环，制造心动感
5. **共同敌人**：面对共同敌人时的并肩作战快速升温关系

### 八、高频情绪模板（可直接套用）
- **打脸模板**：被轻视→隐忍→关键场合→一击反转→全场震惊
- **虐恋模板**：甜蜜时刻→被迫分离→长期等待→重逢却不能相认→最终突破
- **逆袭模板**：跌入谷底→获得金手指→小试牛刀→大翻盘→登顶
- **悬疑模板**：发现异常→追查线索→发现误导→接近真相→真相反转
- **商战模板**：被排挤→暗中布局→关键一招→对方崩盘→掌控全局

## 章节正文改编原则
1. **正文优先**：以当前章节正文为准，章节概要、关键事件、钩子只作为辅助理解，不能替代正文。
2. **按章改编**：只改编当前章节已发生的内容，不提前写下一章，不回头重复上一章。
3. **情节完整**：本章的起因、推进、冲突、转折、结尾钩子都要落到场景中。
4. **逻辑闭环**：人物动机、行动结果、情绪变化必须一环扣一环，不能突然转折。
5. **对白显性化**：原文里的说话内容必须转成dialogues；叙述中的“他说要离开”也要尽量改成角色直接开口。

## 场景划分原则
1. **时空转换**即换场景：地点变化、时间跳跃、内外景切换都必须新开场景
2. **焦点转移**即换场景：主要角色变化、叙事视角切换应拆分场景
3. **情绪转折**可换场景：情感基调发生显著变化时
4. **对白场景**：一段完整对话（含动作穿插）为一个场景
5. **动作场景**：一个连续动作段落为一个场景

## 场景连贯性要求（强制执行）
1. **因果关系**：每个场景必须由前一个场景的情节自然引出，不能凭空出现
2. **时间线连贯**：场景之间的时间推移要有逻辑，不能跳跃
3. **空间转换合理**：地点变化要有过渡说明（如"李明离开房间，来到楼下"）
4. **人物状态延续**：角色在不同场景中的情绪、身体状况要保持一致
5. **禁止重复**：已生成的情节不能重新演绎，只能推进新内容
6. **承上启下**：每个场景必须填写 sceneTransition 字段，说明“上一场结果如何带到本场、本场结尾如何引出下一场”
7. **禁止内部标记**：不得出现 Entity、fictional_character、people/place/item/scene/entity JSON标签、数组标记、代码块或Markdown围栏；看到这类内容时必须改写成正常角色名和正常台词
8. **场景唯一任务**：每个场景只能承担一个明确的新任务，如进入、发现、质问、反击、逃离、揭示、转折；相邻场景不得重复同一任务
9. **同地点差异化**：同一地点连续出现时必须细分微地点或动作阶段，标题、动作、对白和结尾结果都要明显不同

## 各字段写作要求

### description（场景环境描述）— 至少50字
- 必须包含：时辰/光线 + 地点陈设 + 环境氛围 + 至少一个声音或气味细节
- 示例："傍晚，出租屋内光线昏暗，地板堆满外卖盒。窗外传来楼道里的争吵声，空气里混着廉价方便面的味道。"
- ❌ 禁止只写"室内，白天"这种干巴巴的描述

### actions（角色动作描述）— 至少30字
- 必须是具体、可视化的肢体动作和微表情，不能写心理活动
- 示例："她放下手机，沉默片刻，走到窗边背对镜头，手指无意识地摩挲窗框边缘。"
- ❌ 禁止"她很伤心""他心里复杂"等不可视化的情绪陈述

### dialogues（对白）
- 台词必须口语化、符合人物性格，有潜台词
- 有对白的场景台词不少于2句；纯动作/环境场景设为空数组[]
- 角色名必须与原文一致，不得改名，**character字段严禁为空字符串**
- 如果不确定角色名，使用原文中出现的角色名
- 每条台词都必须有对应的角色名

### sceneTransition（承上启下说明）
- 每个场景必须添加此字段
- 必须同时说明：本场如何承接上一场的因果/情绪/空间变化，以及本场结尾如何推动下一场
- 示例："上一场李明离开出租屋，本场切到街头追踪；本场结尾他发现陌生号码，为下一场质问对方埋下动因。"
- 第一个场景说明如何承接本章开端；最后一个场景说明如何收束本章并引出后续悬念

### stageDirections（镜头/舞台指示）
- 必须包含景别（特写/近景/中景/全景/远景）+ 运镜（推/拉/摇/跟/手持/固定）
- 示例："近景跟拍，镜头随她移动，结尾定格在手指摩挲窗框的特写。"

### sceneTitle（场景标题）— 格式严格统一：内外景-地点-时间
- ✅ 示例："内景-出租屋-傍晚" "外景-街头-深夜" "内景-办公室-清晨"
- ❌ 禁止：只写地点不写时间，或格式不统一`;

  const promptBody = await getPromptWithFallback('script-generate-system', fallbackPrompt, context);
  return `${forcedRules}\n\n${promptBody}\n\n${outputFormat}`;
}

// 每批最多生成的场景数（设为30以确保通常单章在单次完整批次内一口气生成完毕，保障剧情的完美连贯度）
const SCENES_PER_BATCH = 30;

// 安全地将数据推送到流
function safeEnqueue(controller: ReadableStreamDefaultController, data: string, errorContext: string): boolean {
  try {
    if (controller.desiredSize === null) {
      console.warn(`[generate] 流已关闭，跳过推送: ${errorContext}`);
      return false;
    }
    controller.enqueue(new TextEncoder().encode(data));
    return true;
  } catch (e) {
    console.warn(`[generate] 流推送失败: ${errorContext}`, e);
    return false;
  }
}

// 安全关闭流
function safeClose(controller: ReadableStreamDefaultController) {
  try {
    controller.close();
  } catch (e) {
    // 流可能已经关闭，忽略
  }
}

function toIntegerOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(num) ? num : null;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    novelId,
    startChapter,
    endChapter,
    configId,
    chapterIndex: requestedChapterIndexRaw,
    customPromptEnabled,
    customSystemPrompt,
    projectConfig,
    skeletonSummary,
    adaptationSummary,
  } = body;

  if (!novelId) {
    return new Response(JSON.stringify({ error: '缺少小说ID' }), { status: 400 });
  }

  // 从 JWT token 获取用户 ID，确保脚本归属正确
  const authHeader = request.headers.get('authorization') || '';
  const tokenPayload = getUserFromToken(authHeader);
  const jwtUserId = tokenPayload?.userId || '';

  const novel = await novelManager.getById(novelId);
  if (!novel) {
    return new Response(JSON.stringify({ error: '小说不存在' }), { status: 404 });
  }

  // 优先使用 JWT userId，其次回退到 novel.userId
  const effectiveUserId = jwtUserId || novel.userId;

  // 解析小说结构获取章节数，用于确定默认范围
  const structure = typeof novel.structure === 'string' ? JSON.parse(novel.structure) : novel.structure;
  const idea = typeof novel.idea === 'string' ? JSON.parse(novel.idea) : novel.idea;
  
  // 解析小说已生成的章节内容，获取真实标题
  const novelChapters = Array.isArray(novel.chapters) ? novel.chapters : [];

  // 构建章节信息列表：优先使用 structure.chapters，否则从小说已有章节 + chapterHooks 推导
  let chaptersInfo: Array<{ title: string; summary?: string; keyEvents?: string }> = [];
  if (structure?.chapters && Array.isArray(structure.chapters) && structure.chapters.length > 0) {
    chaptersInfo = structure.chapters.map((ch: any, i: number) => ({
      title: novelChapters[i]?.title || ch.title || `第${i + 1}章`,
      summary: ch.summary || cleanScriptText(novelChapters[i]?.content).substring(0, 600) || '',
      keyEvents: ch.keyEvents || '',
    }));
  } else {
    // 从小说已有章节获取真实标题，补充 chapterHooks 概要
    const chapterCount = novelChapters.length || structure?.chapterHooks?.length || novel.totalChapters || 0;
    for (let i = 0; i < chapterCount; i++) {
      const novelChapter = novelChapters[i];
      const hook = structure?.chapterHooks?.[i] || '';
      chaptersInfo.push({
        title: novelChapter?.title || `第${i + 1}章`,
        summary: cleanScriptText(novelChapter?.content).substring(0, 600) || hook || structure?.mainPlot || '',
        keyEvents: hook,
      });
    }
  }

  const totalNovelChapters = chaptersInfo.length || novel.totalChapters || 0;

  if (totalNovelChapters === 0) {
    return new Response(JSON.stringify({ error: '小说暂无结构分析，请先生成结构分析' }), { status: 400 });
  }

  // chapterIndex 是前台单章重新生成使用的 0-based 索引，优先级高于范围参数。
  const requestedChapterIndex = toIntegerOrNull(requestedChapterIndexRaw);
  let actualStart: number;
  let actualEnd: number;

  if (requestedChapterIndex !== null) {
    if (requestedChapterIndex < 0 || requestedChapterIndex >= totalNovelChapters) {
      return new Response(
        JSON.stringify({ error: `第${requestedChapterIndex + 1}章不存在，无法生成剧本` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    actualStart = requestedChapterIndex + 1;
    actualEnd = requestedChapterIndex + 1;
  } else {
    actualStart = toIntegerOrNull(startChapter) ?? 1;
    actualEnd = toIntegerOrNull(endChapter) ?? totalNovelChapters;
    actualStart = Math.max(1, Math.min(actualStart, totalNovelChapters));
    actualEnd = Math.max(1, Math.min(actualEnd, totalNovelChapters));
    if (actualStart > actualEnd) {
      return new Response(
        JSON.stringify({ error: '生成范围不正确，请检查开始章节和结束章节' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  let script = await scriptManager.getScriptByNovelId(novelId, effectiveUserId);

  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController | null = null;
  let isStreamClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      controllerRef = controller;

      try {
        // 如果没有剧本记录，先创建
        if (!script) {
          script = await scriptManager.createScript({
            novelId,
            userId: effectiveUserId,
            status: 'generating',
            chapters: [],
          });
        } else if (script.status !== 'generating') {
          // 修复旧数据：如果剧本的 userId 与当前用户不匹配，更新它
          if (effectiveUserId && script.userId !== effectiveUserId) {
            await scriptManager.updateScript(script.id, { userId: effectiveUserId });
          }
          await scriptManager.updateScript(script.id, { status: 'generating' });
        }

        const structureData = structure; // 已在外层解析
        const totalChapters = actualEnd - actualStart + 1;
        let completedCount = 0;
        let successCount = 0; // 跟踪成功生成的章节数

        // 发送开始事件
        if (!isStreamClosed) {
          safeEnqueue(
            controller,
            `data: ${JSON.stringify({
              type: 'start',
              totalChapters,
            })}\n\n`,
            'start'
          );
        }

        // 为每个章节初始化数据
        const currentScript = await scriptManager.getScriptById(script.id);
        const existingChapters = Array.isArray(currentScript?.chapters) ? [...currentScript.chapters] : [];

        for (let i = actualStart; i <= actualEnd; i++) {
          const chapterIndex = i - 1; // 0-based index

          // 确保章节数组有足够的空间
          while (existingChapters.length <= chapterIndex) {
            existingChapters.push({
              chapterIndex: existingChapters.length,
              chapterTitle: chaptersInfo[existingChapters.length]?.title || `第${existingChapters.length + 1}章`,
              screenplay: null,
              imagePrompts: null,
              videoPrompts: null,
            });
          }

          // 获取章节实际文本内容
          const chapterContent = getChapterContent(novel, chapterIndex);
          if (!chapterContent || chapterContent.length < 50) {
            existingChapters[chapterIndex] = {
              ...existingChapters[chapterIndex],
              chapterTitle: chaptersInfo[chapterIndex].title,
              screenplay: { scenes: [], status: 'failed', error: '章节正文缺失，不能按章节内容生成剧本' },
            };
            await scriptManager.updateScript(script.id, { chapters: existingChapters });
            if (!isStreamClosed) {
              safeEnqueue(
                controller,
                `data: ${JSON.stringify({
                  type: 'error',
                  chapterIndex,
                  error: `第${chapterIndex + 1}章正文缺失，无法生成剧本`,
                })}\n\n`,
                `missing chapter content ${chapterIndex}`
              );
            }
            completedCount++;
            continue;
          }
          // 根据章节字数计算目标场景数
          const wordCount = chapterContent.length;
          const targetSceneCount = calcTargetSceneCount(wordCount);

          // 断点续生成：已生成剧本通过质量检查才跳过；若检测到重复/断裂，则允许重新生成修复
          const rawExistingScenes = existingChapters[chapterIndex]?.screenplay?.scenes || [];
          const existingQualityCheck = rawExistingScenes.length > 0
            ? validateScreenplayQuality(rawExistingScenes, chapterContent)
            : { ok: false, feedback: '' };
          const hasCompleteScreenplay = rawExistingScenes.length > 0 && existingQualityCheck.ok;
          const existingScenes = hasCompleteScreenplay ? rawExistingScenes : [];
          
          if (hasCompleteScreenplay) {
            completedCount++;
            if (!isStreamClosed) {
              safeEnqueue(
                controller,
                `data: ${JSON.stringify({
                  type: 'skip',
                  chapterIndex,
                  title: existingChapters[chapterIndex].chapterTitle,
                  sceneCount: existingScenes.length,
                })}\n\n`,
                `skip chapter ${chapterIndex}`
              );
            }
            continue;
          }

          if (rawExistingScenes.length > 0 && !existingQualityCheck.ok) {
            console.warn(`[generate] 第${chapterIndex + 1}章已有剧本质量未通过，将重新生成：${existingQualityCheck.feedback}`);
            if (!isStreamClosed) {
              safeEnqueue(
                controller,
                `data: ${JSON.stringify({
                  type: 'retry',
                  chapterIndex,
                  retry: 0,
                  reason: existingQualityCheck.feedback,
                })}\n\n`,
                `regenerate duplicate chapter ${chapterIndex}`
              );
            }
          }

          // 构建章节上下文（含实际文本）
          const chapterContext = buildChapterContext(
            chaptersInfo[chapterIndex],
            structureData,
            idea,
            novel,
            chapterContent ?? undefined,
            chapterIndex,
            chaptersInfo,
            novelChapters,
            existingChapters
          );

          // 分批生成剧本 - 断点续生成：从已有场景数继续
          let accumulatedScenes = [...existingScenes]; // 继承已有场景
          const startSceneIndex = existingScenes.length; // 从断点继续

          if (startSceneIndex > 0 && !isStreamClosed) {
            safeEnqueue(
              controller,
              `data: ${JSON.stringify({
                type: 'resume',
                chapterIndex,
                title: existingChapters[chapterIndex].chapterTitle,
                existingScenes: startSceneIndex,
                targetScenes: targetSceneCount,
              })}\n\n`,
              `resume chapter ${chapterIndex}`
            );
          }

          let screenplay = null;
          let retryCount = 0;
          const maxRetries = 3;
          let qualityFeedback = rawExistingScenes.length > 0 && !existingQualityCheck.ok
            ? `已有剧本存在以下问题，需要整章重写并彻底规避：\n${existingQualityCheck.feedback}`
            : '';

          while (!screenplay && retryCount < maxRetries) {
            try {
              if (retryCount > 0 && !isStreamClosed) {
                safeEnqueue(
                  controller,
                  `data: ${JSON.stringify({
                    type: 'retry',
                    chapterIndex,
                    retry: retryCount,
                  })}\n\n`,
                  `retry chapter ${chapterIndex} attempt ${retryCount}`
                );
              }

              screenplay = await generateScreenplayBatched(
                chapterContext,
                chaptersInfo[chapterIndex].title,
                targetSceneCount,
                configId,
                controller,
                isStreamClosed,
                startSceneIndex,
                accumulatedScenes,
                script,
                scriptManager,
                chapterIndex,
                chaptersInfo,
                customPromptEnabled,
                customSystemPrompt,
                qualityFeedback,
                projectConfig,
                skeletonSummary,
                adaptationSummary
              );

              // 验证生成结果：合并后场景数必须大于已有场景数，且达到目标的80%
              if (!screenplay || !screenplay.scenes || screenplay.scenes.length <= startSceneIndex) {
                console.warn(`[generate] 第${chapterIndex + 1}章生成结果为空，重试 ${retryCount + 1}/${maxRetries}`);
                screenplay = null;
                retryCount++;
                continue;
              }
              
              // 检查是否需要补生：场景数未达到目标的85%，进行补生
              const sceneCount = screenplay.scenes.length;
              if (sceneCount < targetSceneCount * 0.85 && retryCount < maxRetries) {
                console.warn(`[generate] 第${chapterIndex + 1}章场景不足：${sceneCount}/${targetSceneCount}，进行补生`);
                accumulatedScenes = [...screenplay.scenes];
                
                // 补生：从当前场景数继续生成缺失的场景
                const supplementScenes = await generateScreenplayBatched(
                  chapterContext,
                  chaptersInfo[chapterIndex].title,
                  targetSceneCount,
                  configId,
                  controller,
                  isStreamClosed,
                  sceneCount,
                  accumulatedScenes,
                  script,
                  scriptManager,
                  chapterIndex,
                  chaptersInfo,
                  customPromptEnabled,
                  customSystemPrompt,
                  qualityFeedback || `前一次只生成${sceneCount}个场景，未完整覆盖当前章节正文。`,
                  projectConfig,
                  skeletonSummary,
                  adaptationSummary
                );
                
                if (supplementScenes && supplementScenes.scenes && supplementScenes.scenes.length > sceneCount) {
                  screenplay = supplementScenes;
                  console.log(`[generate] 第${chapterIndex + 1}章补生成功：${sceneCount} → ${supplementScenes.scenes.length}个场景`);
                } else {
                  console.warn(`[generate] 第${chapterIndex + 1}章补生未增加场景，保持原结果`);
                }
              }

              const qualityCheck = validateScreenplayQuality(screenplay.scenes, chapterContent);
              if (!qualityCheck.ok) {
                if (retryCount < maxRetries - 1) {
                  qualityFeedback = qualityCheck.feedback;
                  console.warn(`[generate] 第${chapterIndex + 1}章质量检查未通过，重试 ${retryCount + 1}/${maxRetries}: ${qualityFeedback}`);
                  screenplay = null;
                  retryCount++;
                  continue;
                }

                console.warn(`[generate] 第${chapterIndex + 1}章最终质量检查仍有问题，保留当前结果: ${qualityCheck.feedback}`);
              }
            } catch (genError: any) {
              console.error(`[generate] 第${chapterIndex + 1}章生成失败 (尝试 ${retryCount + 1}/${maxRetries}):`, genError?.message);
              if (genError?.message?.includes('balance') || genError?.message?.includes('403')) {
                if (!isStreamClosed) {
                  safeEnqueue(
                    controller,
                    `data: ${JSON.stringify({
                      type: 'error',
                      chapterIndex,
                      error: 'API余额不足，请检查账户余额',
                    })}\n\n`,
                    `api balance error chapter ${chapterIndex}`
                  );
                }
                break;
              }
              retryCount++;
              screenplay = null;
            }
          }

          // 保存章节到数据库
          if (screenplay && screenplay.scenes.length > 0) {
            existingChapters[chapterIndex] = {
              ...existingChapters[chapterIndex],
              chapterTitle: chaptersInfo[chapterIndex].title,
              screenplay,
            };

            try {
              await scriptManager.updateScript(script.id, { chapters: existingChapters });
              console.log(`[generate] 第${chapterIndex + 1}章剧本保存成功，共${screenplay.scenes.length}个场景`);
              successCount++; // 递增成功计数
            } catch (saveError) {
              console.error(`[generate] 第${chapterIndex + 1}章保存到数据库失败:`, saveError);
            }
          } else {
            existingChapters[chapterIndex] = {
              ...existingChapters[chapterIndex],
              chapterTitle: chaptersInfo[chapterIndex].title,
              screenplay: { scenes: [], status: 'failed' },
            };

            try {
              await scriptManager.updateScript(script.id, { chapters: existingChapters });
            } catch (saveError) {
              console.error(`[generate] 第${chapterIndex + 1}章(失败)保存到数据库失败:`, saveError);
            }

            if (!isStreamClosed) {
              safeEnqueue(
                controller,
                `data: ${JSON.stringify({
                  type: 'error',
                  chapterIndex,
                  error: `第${chapterIndex + 1}章生成失败`,
                })}\n\n`,
                `chapter ${chapterIndex} failed`
              );
            }
          }

          completedCount++;

          // 更新进度
          if (!isStreamClosed) {
            const progress = Math.round((completedCount / totalChapters) * 100);
            safeEnqueue(
              controller,
              `data: ${JSON.stringify({
                type: 'progress',
                chapterIndex,
                title: chaptersInfo[chapterIndex].title,
                completedCount,
                totalChapters,
                progress,
              })}\n\n`,
              `progress chapter ${chapterIndex}`
            );
          }
        }

        // 最终保存
        const hasSuccess = successCount > 0;
        const hasAllFailed = successCount === 0 && totalChapters > 0;
        
        try {
          await scriptManager.updateScript(script.id, {
            chapters: existingChapters,
            status: hasAllFailed ? 'failed' : 'completed',
          });
          if (hasAllFailed) {
            console.log(`[generate] 剧本生成失败，共${totalChapters}章全部失败`);
          } else {
            console.log(`[generate] 剧本最终保存成功，共${totalChapters}章，成功${successCount}章`);
          }
        } catch (finalSaveError) {
          console.error('[generate] 剧本最终保存失败:', finalSaveError);
        }

        if (!isStreamClosed) {
          if (hasAllFailed) {
            // 所有章节都生成失败
            safeEnqueue(
              controller,
              `data: ${JSON.stringify({
                type: 'error',
                error: '所有章节生成失败，请检查API配置',
                successCount: 0,
                totalChapters,
              })}\n\n`,
              'all_failed'
            );
          } else {
            // 部分或全部章节生成成功
            safeEnqueue(
              controller,
              `data: ${JSON.stringify({
                type: 'complete',
                successCount,
                totalChapters,
                hasErrors: successCount < totalChapters,
              })}\n\n`,
              'complete'
            );
          }
        }
      } catch (error: any) {
        console.error('[generate] 剧本生成异常:', error);

        try {
          if (script?.id) {
            await scriptManager.updateScript(script.id, { status: 'failed' });
          }
        } catch (e) {
          console.error('[generate] 更新剧本状态为failed也失败:', e);
        }

        if (!isStreamClosed) {
          safeEnqueue(
            controller,
            `data: ${JSON.stringify({
              type: 'error',
              error: error?.message || '剧本生成失败',
            })}\n\n`,
            'fatal error'
          );
        }
      } finally {
        isStreamClosed = true;
        safeClose(controller);
      }
    },

    cancel() {
      isStreamClosed = true;
      console.log('[generate] 客户端断开连接，流已取消');
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// 根据字数计算目标场景数量：按照影视/短剧行业标准，每1000字改编为约 5 个场景，最少5个，最多18个，避免凑数导致AI重复演绎
function calcTargetSceneCount(wordCount: number): number {
  // 根据字数估算合理场景数，但只是参考建议，最终由AI根据内容决定
  // 参考行业标准：每1000字约3-4个场景
  const estimated = Math.max(2, Math.round(wordCount / 300));
  
  // 只给一个大致范围建议，不做强制限制
  return estimated;
}

// 从小说 chapters JSON 中获取指定章节的正文内容
function getChapterContent(novel: any, chapterIndex: number): string | null {
  const chapters = typeof novel.chapters === 'string' ? JSON.parse(novel.chapters) : novel.chapters;
  if (!Array.isArray(chapters) || chapterIndex >= chapters.length) return null;
  const content = cleanScriptText(chapters[chapterIndex]?.content);
  return content || null;
}

type DialogueHint = {
  speaker?: string;
  line: string;
};

function toPlainText(value: any): string {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function getEntityDisplayName(value: string): string {
  const text = toPlainText(value);
  if (!text) return '';
  const entityMatch = text.match(/(?:Entity|entity)\s*\[\]\s*(\{[\s\S]*?\})\s*\[\]/);
  const payload = entityMatch?.[1] || text;
  const nameMatch = payload.match(/["'](?:fictional_character|character|name|people|person|role)["']\s*:\s*["']([^"']{1,40})["']/i);
  return nameMatch?.[1]?.trim() || '';
}

function cleanScriptText(value: any): string {
  let text = sanitizeChapterText(toPlainText(value));
  if (!text) return '';

  text = text.replace(/(?:Entity|entity)\s*\[\]\s*(\{[\s\S]*?\})\s*\[\]/g, (full) => getEntityDisplayName(full) || '');
  text = text.replace(/["'](?:fictional_character|character|name|people|place|item|scene|entity)["']\s*:\s*["'][^"']*["']\s*,?/gi, '');
  text = text.replace(/(?:fictional_character|people|place|item|scene|entity)\s*[\[\]{}:：]/gi, '');
  text = text.replace(/^\s*```(?:json|ts|js|javascript|typescript|markdown)?/gim, '');
  text = text.replace(/```\s*$/gim, '');
  text = text.replace(/^\s*[\[{]\s*([\s\S]{1,240}?)\s*[\]}]\s*$/, '$1');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\s+([，。！？；：、])/g, '$1');
  text = text.replace(/([“「『])\s+/g, '$1');
  text = text.replace(/\s+([”」』])/g, '$1');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

function cleanCharacterName(value: any): string {
  const entityName = getEntityDisplayName(toPlainText(value));
  let text = entityName || cleanScriptText(value);
  text = text.replace(/[：:，。、“”「」『』\[\]{}]/g, '').trim();
  if (text.includes('/')) text = text.split('/')[0].trim();
  if (text.length > 24) text = text.slice(0, 24).trim();
  return text;
}

function getChapterContentFromList(chapters: any[], chapterIndex: number): string {
  if (!Array.isArray(chapters) || chapterIndex < 0 || chapterIndex >= chapters.length) return '';
  const chapter = chapters[chapterIndex];
  if (typeof chapter === 'string') return cleanScriptText(chapter);
  return cleanScriptText(chapter?.content);
}

function getChapterTail(chapters: any[], chapterIndex: number, length = 220): string {
  const content = getChapterContentFromList(chapters, chapterIndex);
  return content.length > length ? content.slice(-length) : content;
}

function getChapterHead(chapters: any[], chapterIndex: number, length = 220): string {
  const content = getChapterContentFromList(chapters, chapterIndex);
  return content.length > length ? content.slice(0, length) : content;
}

function extractDialogueHints(chapterContent?: string | null, limit = 50): DialogueHint[] {
  const text = cleanScriptText(chapterContent || '').replace(/\r/g, '').trim();
  if (!text) return [];

  const hints: DialogueHint[] = [];
  const seen = new Set<string>();
  const pushHint = (line: string, speaker?: string) => {
    const cleanLine = cleanScriptText(line).replace(/\s+/g, ' ').trim();
    const cleanSpeaker = cleanCharacterName(speaker);
    if (cleanLine.length < 2 || cleanLine.length > 180) return;
    if (/^第.+章$/.test(cleanSpeaker || '')) return;
    const key = `${cleanSpeaker || ''}:${cleanLine}`;
    if (seen.has(key)) return;
    seen.add(key);
    hints.push(cleanSpeaker ? { speaker: cleanSpeaker, line: cleanLine } : { line: cleanLine });
  };

  const speakerLinePattern = /(?:^|\n)\s*([\u4e00-\u9fa5A-Za-z0-9_·]{1,16})[：:]\s*([^\n]{2,180})/g;
  let speakerLineMatch: RegExpExecArray | null;
  while ((speakerLineMatch = speakerLinePattern.exec(text)) !== null && hints.length < limit) {
    pushHint(speakerLineMatch[2], speakerLineMatch[1]);
  }

  const quotePattern = /[“「『](.{2,180}?)[”」』]/g;
  let quoteMatch: RegExpExecArray | null;
  while ((quoteMatch = quotePattern.exec(text)) !== null && hints.length < limit) {
    const before = text.slice(Math.max(0, quoteMatch.index - 48), quoteMatch.index);
    const speakerMatch = before.match(/([\u4e00-\u9fa5A-Za-z0-9_·]{1,12})(?:冷声|沉声|低声|小声|大声|厉声|怒声|笑着|哭着|问|说|道|喊|吼|答|回|骂|叫|喃喃|嘀咕|叹|反问|提醒|解释|开口|打断)\s*$/);
    pushHint(quoteMatch[1], speakerMatch?.[1]);
  }

  return hints.slice(0, limit);
}

function formatDialogueHints(hints: DialogueHint[]): string {
  if (hints.length === 0) {
    return '未检测到明显引号对白；请根据正文中的“他说/她问/众人喊”等叙述，把可听见的说话内容改写成自然台词。';
  }

  return hints
    .map((hint, index) => `${index + 1}. ${hint.speaker ? `${hint.speaker}：` : ''}${hint.line}`)
    .join('\n');
}

function buildAdjacentChapterContext(chapterIndex: number, chaptersInfo: any[], novelChapters: any[]): string {
  const lines: string[] = [];
  const total = chaptersInfo.length || novelChapters.length;
  lines.push(`当前章节位置：第${chapterIndex + 1}章 / 共${total || '?'}章`);

  const prevInfo = chaptersInfo[chapterIndex - 1];
  if (prevInfo) {
    lines.push(`上一章：${prevInfo.title || `第${chapterIndex}章`}`);
    if (prevInfo.summary) lines.push(`上一章概要：${prevInfo.summary}`);
    if (prevInfo.keyEvents) lines.push(`上一章关键事件：${prevInfo.keyEvents}`);
    const prevTail = getChapterTail(novelChapters, chapterIndex - 1);
    if (prevTail) lines.push(`上一章结尾片段：${prevTail}`);
  }

  const nextInfo = chaptersInfo[chapterIndex + 1];
  if (nextInfo) {
    lines.push(`下一章：${nextInfo.title || `第${chapterIndex + 2}章`}`);
    if (nextInfo.summary) lines.push(`下一章概要：${nextInfo.summary}`);
    if (nextInfo.keyEvents) lines.push(`下一章关键事件：${nextInfo.keyEvents}`);
    const nextHead = getChapterHead(novelChapters, chapterIndex + 1);
    if (nextHead) lines.push(`下一章开头片段：${nextHead}`);
  }

  lines.push('注意：前后章节只用于保持人物状态和因果衔接，剧本正文只能改编当前章节。');
  return lines.join('\n');
}

function buildChapterSourceBeats(chapterContent?: string | null, maxBeats = 10): string {
  const text = cleanScriptText(chapterContent || '');
  if (!text) return '未提供章节正文，需以章节概要和钩子为辅，但不得跳章。';

  const paragraphs = text
    .split(/\n{2,}|(?<=[。！？])\s*(?=[\u4e00-\u9fa5A-Za-z0-9“「『])/)
    .map(part => cleanScriptText(part))
    .filter(part => part.length >= 18);

  const chunks: string[] = [];
  let current = '';
  const targetLength = Math.max(220, Math.ceil(text.length / maxBeats));
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > targetLength && chunks.length < maxBeats - 1) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = [current, paragraph].filter(Boolean).join('');
    }
  }
  if (current.trim()) chunks.push(current.trim());

  const normalized = chunks.length > 0 ? chunks : [text];
  return normalized
    .slice(0, maxBeats)
    .map((beat, index) => `剧情段${index + 1}：${beat.length > 360 ? `${beat.slice(0, 340)}...` : beat}`)
    .join('\n');
}

function getScreenplayScenes(screenplay: any): any[] {
  if (!screenplay) return [];
  if (Array.isArray(screenplay?.scenes)) return screenplay.scenes;
  if (Array.isArray(screenplay?.screenplay?.scenes)) return screenplay.screenplay.scenes;
  if (typeof screenplay === 'string') {
    try {
      const parsed = JSON.parse(screenplay);
      return getScreenplayScenes(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

function summarizeSceneForContinuity(scene: any, index: number): string {
  const title = cleanScriptText(scene?.sceneTitle || scene?.title || `场景${index + 1}`);
  const actions = cleanScriptText(scene?.actions || scene?.description || '').slice(0, 100);
  const dialogues = Array.isArray(scene?.dialogues)
    ? scene.dialogues
        .map((dialogue: any) => `${cleanCharacterName(dialogue?.character)}：${cleanScriptText(dialogue?.line)}`)
        .filter(Boolean)
        .slice(0, 2)
        .join('；')
    : '';
  const transition = cleanScriptText(scene?.sceneTransition || '').slice(0, 100);
  return [`场景${index + 1} ${title}`, actions && `动作：${actions}`, dialogues && `对白：${dialogues}`, transition && `衔接：${transition}`]
    .filter(Boolean)
    .join('｜');
}

function buildAdjacentScreenplayContext(chapterIndex: number, scriptChapters: any[] = []): string {
  const lines: string[] = [];
  const prevScriptChapter = scriptChapters[chapterIndex - 1];
  const nextScriptChapter = scriptChapters[chapterIndex + 1];
  const prevScenes = getScreenplayScenes(prevScriptChapter?.screenplay);
  const nextScenes = getScreenplayScenes(nextScriptChapter?.screenplay);

  if (prevScenes.length > 0) {
    const start = Math.max(0, prevScenes.length - 2);
    const tail = prevScenes.slice(start).map((scene, idx) => summarizeSceneForContinuity(scene, start + idx)).join('\n');
    lines.push(`上一章剧本结尾状态（本章第一场必须接住人物状态/地点/情绪，不得重演）：\n${tail}`);
  }

  if (nextScenes.length > 0) {
    const head = nextScenes.slice(0, 2).map((scene, idx) => summarizeSceneForContinuity(scene, idx)).join('\n');
    lines.push(`下一章已有剧本开端参考（本章最后一场应自然引向它，但不得提前演完）：\n${head}`);
  }

  return lines.length > 0
    ? lines.join('\n\n')
    : '暂无相邻章节已生成剧本；请根据相邻章节正文片段保持跨章人物状态和因果。';
}

// 构建章节上下文（含实际章节文本内容）
function buildChapterContext(
  chapterInfo: any,
  structure: any,
  idea: any,
  novel: any,
  chapterContent?: string,
  chapterIndex = 0,
  chaptersInfo: any[] = [],
  novelChapters: any[] = [],
  scriptChapters: any[] = []
): string {
  const context: string[] = [];

  if (novel.title) context.push(`小说标题：${novel.title}`);
  if (novel.description) context.push(`小说简介：${novel.description}`);
  if (novel.category) context.push(`分类：${novel.category}`);
  if (novel.genderTarget) context.push(`目标读者：${novel.genderTarget === 'male' ? '男频' : '女频'}`);

  if (novel.protagonist) context.push(`主角设定：${novel.protagonist}`);
  if (novel.supportingCharacterName) context.push(`配角：${novel.supportingCharacterName}`);

  if (idea?.coreConcept) context.push(`核心概念：${idea.coreConcept}`);
  if (idea?.theme) context.push(`主题：${idea.theme}`);

  // 添加角色关系体系
  if (idea?.characterRelationships && idea.characterRelationships.trim()) {
    context.push(`\n角色关系体系：\n${idea.characterRelationships}`);
  }

  if (structure?.mainPlot) context.push(`主线剧情：${structure.mainPlot}`);
  if (structure?.emotionalArc) context.push(`情感弧线：${structure.emotionalArc}`);

  context.push(`\n前后章节逻辑参考：\n${buildAdjacentChapterContext(chapterIndex, chaptersInfo, novelChapters)}`);
  context.push(`\n相邻章节剧本连续性参考：\n${buildAdjacentScreenplayContext(chapterIndex, scriptChapters)}`);

  context.push(`\n当前章节：${chapterInfo.title || ''}`);
  if (chapterInfo.summary) context.push(`章节概要：${chapterInfo.summary}`);
  if (chapterInfo.keyEvents) context.push(`关键事件：${chapterInfo.keyEvents}`);
  if (chapterInfo.emotionalBeat) context.push(`情感节奏：${chapterInfo.emotionalBeat}`);
  if (chapterInfo.hook) context.push(`悬念钩子：${chapterInfo.hook}`);

  // 传入章节实际文本内容
  if (chapterContent) {
    const dialogueHints = extractDialogueHints(chapterContent, 50);
    context.push(`\n当前章节正文剧情段锚点（每个场景必须按顺序绑定 sourceBeat，只能改编这些剧情段）：\n${buildChapterSourceBeats(chapterContent)}`);
    context.push(`\n本章对白线索（必须优先转写进 dialogues）：\n${formatDialogueHints(dialogueHints)}`);
    context.push(`\n章节正文内容（本次剧本改编的唯一正文来源，必须从开头覆盖到结尾）：\n${chapterContent}`);
  }

  return context.join('\n');
}

// 分批生成剧本场景
async function generateScreenplayBatched(
  chapterContext: string,
  chapterTitle: string,
  targetSceneCount: number,
  configId: string | null,
  controller: ReadableStreamDefaultController,
  isStreamClosed: boolean,
  startSceneIndex: number = 0,
  existingScenes: any[] = [],
  script: any,
  scriptManager: any,
  chapterIndex: number,
  chaptersInfo: any[],
  customPromptEnabled?: boolean,
  customSystemPrompt?: string,
  qualityFeedback?: string,
  projectConfig?: any,
  skeletonSummary?: string,
  adaptationSummary?: string
): Promise<any> {
  const allScenes: any[] = [...existingScenes];
  // 如果有已有场景，从断点开始计算批次
  const remainingScenes = targetSceneCount - startSceneIndex;
  if (remainingScenes <= 0) {
    // 所有场景已生成完毕
    return { scenes: allScenes };
  }
  const totalBatches = Math.ceil(remainingScenes / SCENES_PER_BATCH);

  // 发送批次开始事件
  if (!isStreamClosed) {
    safeEnqueue(
      controller,
      `data: ${JSON.stringify({
        type: 'batch_start',
        totalBatches,
        totalScenes: targetSceneCount,
        existingScenes: startSceneIndex,
        scenesPerBatch: SCENES_PER_BATCH,
      })}\n\n`,
      'batch_start'
    );
  }

  for (let batch = 0; batch < totalBatches; batch++) {
    if (isStreamClosed) break;

    const batchStart = startSceneIndex + batch * SCENES_PER_BATCH;
    const batchEnd = Math.min(batchStart + SCENES_PER_BATCH, targetSceneCount);
    const batchSceneCount = batchEnd - batchStart;

    // 发送批次进度（开始生成）
    if (!isStreamClosed) {
      safeEnqueue(
        controller,
        `data: ${JSON.stringify({
          type: 'batch_progress',
          currentBatch: batch + 1,
          totalBatches,
          sceneRange: `${batchStart + 1}-${batchEnd}`,
          status: 'generating',
        })}\n\n`,
        `batch_progress ${batch + 1}`
      );
    }

    const batchScenes = await generateScreenplayBatch(
      chapterContext,
      chapterTitle,
      batchSceneCount,
      batchStart, // 起始 sceneIndex
      targetSceneCount, // 总场景数
      batch + 1,
      totalBatches,
      allScenes, // 已有场景（用于上下文衔接）
      configId,
      controller,
      isStreamClosed,
      customPromptEnabled,
      customSystemPrompt,
      qualityFeedback,
      projectConfig,
      skeletonSummary,
      adaptationSummary
    );

    if (batchScenes && batchScenes.length > 0) {
      const previousCount = allScenes.length;
      allScenes.push(...batchScenes);
      allScenes.splice(0, allScenes.length, ...dedupeAndNormalizeScenes(allScenes));
      const removedCount = previousCount + batchScenes.length - allScenes.length;
      if (removedCount > 0) {
        console.warn(`[generate] 批次${batch + 1}检测并移除${removedCount}个重复/近似场景`);
      }
      const scenesToEmit = allScenes.slice(previousCount);
      console.log(`[generate] 批次${batch + 1}/${totalBatches}完成，本批${batchScenes.length}个场景，累计${allScenes.length}个`);

      // 逐个发送场景事件，让前端实时看到每个场景
      for (const scene of scenesToEmit) {
        if (isStreamClosed) break;
        safeEnqueue(
          controller,
          `data: ${JSON.stringify({
            type: 'scene_generated',
            scene: {
              sceneIndex: scene.sceneIndex,
              sceneTitle: scene.sceneTitle || '',
              description: scene.description || '',
              actions: scene.actions || '',
              dialogues: scene.dialogues || [],
              stageDirections: scene.stageDirections || '',
              sourceBeat: scene.sourceBeat || '',
              sceneTransition: scene.sceneTransition || '',
            },
            accumulatedScenes: allScenes.length,
            totalScenes: targetSceneCount,
          })}\n\n`,
          `scene ${scene.sceneIndex}`
        );
      }

      // 每批次完成后立即保存到数据库
      try {
        const currentScript = await scriptManager.getScriptById(script.id);
        const existingChapters = Array.isArray(currentScript?.chapters) ? [...currentScript.chapters] : [];
        
        while (existingChapters.length <= chapterIndex) {
          existingChapters.push({
            chapterIndex: existingChapters.length,
            chapterTitle: chaptersInfo[existingChapters.length]?.title || `第${existingChapters.length + 1}章`,
            screenplay: null,
            imagePrompts: null,
            videoPrompts: null,
          });
        }
        
        existingChapters[chapterIndex] = {
          ...existingChapters[chapterIndex],
          chapterTitle: chaptersInfo[chapterIndex].title,
          screenplay: {
            scenes: [...allScenes],
            status: 'generating'
          },
        };
        
        await scriptManager.updateScript(script.id, { chapters: existingChapters });
        console.log(`[generate] 批次${batch + 1}/${totalBatches}保存成功，已保存${allScenes.length}个场景`);
      } catch (saveError) {
        console.error(`[generate] 批次${batch + 1}/${totalBatches}保存失败:`, saveError);
      }

      // 发送批次完成事件
      if (!isStreamClosed) {
        safeEnqueue(
          controller,
          `data: ${JSON.stringify({
            type: 'batch_progress',
            currentBatch: batch + 1,
            totalBatches,
            sceneRange: `${batchStart + 1}-${batchEnd}`,
            status: 'completed',
            accumulatedScenes: allScenes.length,
            totalScenes: targetSceneCount,
          })}\n\n`,
          `batch_progress ${batch + 1} completed`
        );
      }
    } else {
      console.warn(`[generate] 批次${batch + 1}/${totalBatches}生成失败，跳过`);
    }
  }

  // 检查最后一个场景是否被截断（内容不完整），如果是则移除
  if (allScenes.length > 0) {
    const lastScene = allScenes[allScenes.length - 1];
    const isTrunc = isSceneTruncated(lastScene);
    if (isTrunc) {
      console.warn(`[generate] 最后一个场景疑似截断，移除：场景${lastScene.sceneIndex} ${lastScene.sceneTitle || ''}`);
      allScenes.pop();
      // 移除后重新编号最后一个
      if (allScenes.length > 0) {
        allScenes[allScenes.length - 1].sceneIndex = allScenes.length;
      }
    }
  }

  allScenes.splice(0, allScenes.length, ...dedupeAndNormalizeScenes(allScenes));

  return { scenes: allScenes, targetSceneCount };
}

// 检测场景是否被截断（AI输出中断导致内容不完整）
function isSceneTruncated(scene: any): boolean {
  // description 或 actions 字段存在但明显过短（不到20字且没有句号结尾）
  const desc = scene.description || '';
  const actions = scene.actions || '';
  const stageDirections = scene.stageDirections || '';
  
  // 所有内容字段都为空 → 肯定被截断
  if (!desc && !actions && !stageDirections && (!scene.dialogues || scene.dialogues.length === 0)) {
    return true;
  }
  
  // description 截断检测：非空但末尾没有标点，且长度异常短
  if (desc && desc.length > 0 && desc.length < 30 && !/[。！？…」』"]$/.test(desc)) {
    return true;
  }
  
  // actions 截断检测：非空但末尾没有标点，且长度异常短
  if (actions && actions.length > 0 && actions.length < 20 && !/[。！？…」』"]$/.test(actions)) {
    return true;
  }
  
  return false;
}

function normalizeDialogueItem(item: any): { character: string; line: string } | null {
  if (!item) return null;

  if (typeof item === 'string') {
    const cleanedItem = cleanScriptText(item);
    const parts = cleanedItem.split(/[：:]/);
    if (parts.length >= 2) {
      const character = cleanCharacterName(parts.shift());
      const line = cleanScriptText(parts.join('：'));
      if (character && line) return { character, line };
    }
    return null;
  }

  const rawCharacter = cleanCharacterName(item.character || item.name || item.speaker || item.role);
  const rawLine = cleanScriptText(item.line || item.text || item.content || item.dialogue);

  if (!rawLine) return null;

  if (!rawCharacter) {
    const parts = rawLine.split(/[：:]/);
    if (parts.length >= 2 && parts[0].trim().length <= 16) {
      const character = cleanCharacterName(parts.shift());
      const line = cleanScriptText(parts.join('：'));
      if (character && line) return { character, line };
    }
    return null;
  }

  return { character: rawCharacter, line: rawLine };
}

function normalizeGeneratedScenes(scenes: any[], batchStartIndex: number): any[] {
  return scenes
    .map((scene: any, index: number) => {
      const rawDialogues = Array.isArray(scene?.dialogues) ? scene.dialogues : [];
      const dialogues = rawDialogues
        .map(normalizeDialogueItem)
        .filter((dialogue: { character: string; line: string } | null): dialogue is { character: string; line: string } => Boolean(dialogue));

      return {
        ...scene,
        sceneIndex: batchStartIndex + index + 1,
        sceneTitle: cleanScriptText(scene?.sceneTitle || scene?.title),
        description: cleanScriptText(scene?.description),
        actions: cleanScriptText(scene?.actions),
        dialogues,
        stageDirections: cleanScriptText(scene?.stageDirections),
        sourceBeat: cleanScriptText(scene?.sourceBeat || scene?.sourceAnchor || scene?.beat || scene?.source || ''),
        sceneTransition: cleanScriptText(scene?.sceneTransition || (batchStartIndex + index === 0 ? '开篇场景，无前置衔接' : '')),
      };
    })
    .filter((scene: any) => scene.sceneTitle || scene.description || scene.actions || scene.dialogues.length > 0);
}

function ensureSceneContinuity(scenes: any[]): any[] {
  const normalized = normalizeGeneratedScenes(scenes, 0);

  return normalized.map((scene: any, index: number) => {
    const prev = normalized[index - 1];
    const next = normalized[index + 1];
    const prevTitle = prev?.sceneTitle || `场景${index}`;
    const nextTitle = next?.sceneTitle || '';
    const existing = cleanScriptText(scene.sceneTransition);
    const hasForwardBridge = /下一场|下场|引出|推进到|过渡到|转入|为.*埋下|后续|悬念/.test(existing);
    const prevBridge = index === 0
      ? '本场承接当前章节开端，建立人物处境和核心冲突。'
      : `本场承接上一场「${prevTitle}」的行动结果，延续人物状态与冲突压力。`;
    const nextBridge = next
      ? `本场结尾把矛盾推进到下一场「${nextTitle}」，形成继续行动的直接动因。`
      : '本场收束当前章节的主要冲突，并保留通往后续剧情的悬念。';

    return {
      ...scene,
      sceneIndex: index + 1,
      sceneTransition: existing
        ? `${existing}${hasForwardBridge ? '' : ` ${nextBridge}`}`.trim()
        : `${prevBridge}${nextBridge}`,
    };
  });
}

function dedupeAndNormalizeScenes(scenes: any[]): any[] {
  const normalized = ensureSceneContinuity(scenes);
  const kept: any[] = [];

  for (const scene of normalized) {
    const duplicate = kept.find((existing) => areScenesTooSimilar(existing, scene));
    if (duplicate) {
      continue;
    }
    kept.push(scene);
  }

  return ensureSceneContinuity(kept);
}

function findDuplicateSceneIssues(scenes: any[]): string[] {
  const normalized = normalizeGeneratedScenes(scenes, 0);
  const issues: string[] = [];

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      if (areScenesTooSimilar(normalized[i], normalized[j])) {
        issues.push(`场景${i + 1}与场景${j + 1}内容高度相似，疑似重复演绎同一剧情。`);
      }
    }
  }

  let streakTitle = '';
  let streakStart = 0;
  let streakCount = 0;
  for (let i = 0; i < normalized.length; i++) {
    const title = normalizeSceneTitleKey(normalized[i]?.sceneTitle);
    if (title && title === streakTitle) {
      streakCount++;
    } else {
      if (streakTitle && streakCount >= 3) {
        issues.push(`场景${streakStart + 1}-${streakStart + streakCount}连续使用相同标题「${streakTitle}」，请细分微地点或动作阶段。`);
      }
      streakTitle = title;
      streakStart = i;
      streakCount = title ? 1 : 0;
    }
  }
  if (streakTitle && streakCount >= 3) {
    issues.push(`场景${streakStart + 1}-${streakStart + streakCount}连续使用相同标题「${streakTitle}」，请细分微地点或动作阶段。`);
  }

  return Array.from(new Set(issues)).slice(0, 6);
}

function areScenesTooSimilar(a: any, b: any): boolean {
  const titleA = normalizeSceneTitleKey(a?.sceneTitle);
  const titleB = normalizeSceneTitleKey(b?.sceneTitle);
  const sameTitle = Boolean(titleA && titleB && titleA === titleB);
  const samePlace = Boolean(titleA && titleB && normalizeScenePlaceKey(titleA) === normalizeScenePlaceKey(titleB));
  const textA = sceneNarrativeText(a);
  const textB = sceneNarrativeText(b);
  const similarity = textSimilarity(textA, textB);
  const dialogueSimilarity = textSimilarity(formatDialogueText(a?.dialogues), formatDialogueText(b?.dialogues));

  if (similarity >= 0.72) return true;
  if (sameTitle && similarity >= 0.42) return true;
  if (samePlace && dialogueSimilarity >= 0.68 && dialogueSimilarity > 0) return true;
  return false;
}

function sceneNarrativeText(scene: any): string {
  return [
    scene?.description,
    scene?.actions,
    formatDialogueText(scene?.dialogues),
    scene?.stageDirections,
  ].map(toPlainText).filter(Boolean).join(' ');
}

function formatDialogueText(dialogues: any): string {
  if (!Array.isArray(dialogues)) return '';
  return dialogues
    .map((dialogue: any) => `${toPlainText(dialogue?.character)}：${toPlainText(dialogue?.line)}`)
    .filter(Boolean)
    .join(' ');
}

function normalizeSceneTitleKey(value: any): string {
  return toPlainText(value)
    .replace(/[（）()【】\[\]「」『』]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function normalizeScenePlaceKey(title: string): string {
  const parts = title.split(/[-—－]/).map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, 2).join('-');
  return title;
}

function textSimilarity(a: string, b: string): number {
  const x = normalizeSimilarityText(a);
  const y = normalizeSimilarityText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const setA = charNgrams(x, 2);
  const setB = charNgrams(y, 2);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

function normalizeSimilarityText(value: string): string {
  return toPlainText(value)
    .replace(/[，。！？；：、“”‘’《》【】（）()「」『』\s,.!?;:'"[\]{}<>/\\|_-]/g, '')
    .slice(0, 800);
}

function charNgrams(value: string, size: number): Set<string> {
  const result = new Set<string>();
  if (value.length <= size) {
    if (value) result.add(value);
    return result;
  }
  for (let i = 0; i <= value.length - size; i++) {
    result.add(value.slice(i, i + size));
  }
  return result;
}

function countGeneratedDialogues(scenes: any[]): number {
  return scenes.reduce((total, scene) => {
    const dialogues = Array.isArray(scene?.dialogues) ? scene.dialogues : [];
    return total + dialogues.filter((dialogue: any) => toPlainText(dialogue?.character) && toPlainText(dialogue?.line)).length;
  }, 0);
}

function validateScreenplayQuality(scenes: any[], chapterContent?: string | null): { ok: boolean; feedback: string } {
  const issues: string[] = [];

  if (!Array.isArray(scenes) || scenes.length === 0) {
    return { ok: false, feedback: '没有生成有效场景。' };
  }

  const dialogueHints = extractDialogueHints(chapterContent, 80);
  const generatedDialogueCount = countGeneratedDialogues(scenes);
  const requiredDialogueCount = dialogueHints.length >= 6
    ? Math.max(3, Math.ceil(dialogueHints.length * 0.45))
    : dialogueHints.length >= 2
      ? 2
      : dialogueHints.length;

  if (requiredDialogueCount > 0 && generatedDialogueCount < requiredDialogueCount) {
    issues.push(`当前章节检测到${dialogueHints.length}处原文对白线索，但剧本只生成${generatedDialogueCount}句台词；请把主要说话内容改写进dialogues。`);
  }

  const serializedScenes = JSON.stringify(scenes);
  if (/(?:Entity\s*\[\]|fictional_character|["'](?:people|place|item|scene|entity)["']\s*:|```)/i.test(serializedScenes)) {
    issues.push('生成内容仍包含Entity、fictional_character、JSON标签或代码块；请全部改写成正常角色名、正常台词和剧本描述。');
  }

  const invalidDialogueScene = scenes.find((scene: any) => {
    const dialogues = Array.isArray(scene?.dialogues) ? scene.dialogues : [];
    return dialogues.some((dialogue: any) => !toPlainText(dialogue?.character) || !toPlainText(dialogue?.line));
  });
  if (invalidDialogueScene) {
    issues.push('存在角色名或台词为空的对白；每条dialogues都必须有明确character和line。');
  }

  const duplicateIssues = findDuplicateSceneIssues(scenes);
  if (duplicateIssues.length > 0) {
    issues.push(`存在重复或近似重复场景：${duplicateIssues.join(' ')}`);
  }

  const missingSourceBeatCount = scenes.filter((scene: any) => !toPlainText(scene?.sourceBeat)).length;
  if (missingSourceBeatCount > Math.max(1, Math.floor(scenes.length * 0.25))) {
    issues.push(`有${missingSourceBeatCount}个场景缺少sourceBeat；每场必须绑定当前章节正文剧情段，保证按章节正文顺序改编。`);
  }

  const missingTransition = scenes.find((scene: any) => !toPlainText(scene?.sceneTransition));
  if (missingTransition) {
    issues.push('存在缺少sceneTransition的场景；每一场都要说明如何承接上一场并引出下一场。');
  }

  const weakTransition = scenes.find((scene: any, index: number) => {
    const transition = toPlainText(scene?.sceneTransition);
    if (!transition) return true;
    if (index === scenes.length - 1) return transition.length < 16;
    return transition.length < 24 || !/(下一场|下场|引出|推进到|过渡到|转入|为.*埋下|后续|悬念)/.test(transition);
  });
  if (weakTransition) {
    issues.push('场景衔接不够完整；sceneTransition必须写清本场承接上一场的原因，以及本场结尾如何推动下一场。');
  }

  const tooManyEmptyActionScenes = scenes.filter((scene: any) => !toPlainText(scene?.actions) && !toPlainText(scene?.description)).length;
  if (tooManyEmptyActionScenes > Math.max(1, Math.floor(scenes.length * 0.2))) {
    issues.push('有过多场景缺少环境或动作描写；请用可视化动作和环境承载剧情。');
  }

  return {
    ok: issues.length === 0,
    feedback: issues.join('\n'),
  };
}

// 生成单批场景
async function generateScreenplayBatch(
  chapterContext: string,
  chapterTitle: string,
  batchSceneCount: number,
  batchStartIndex: number,
  totalSceneCount: number,
  currentBatch: number,
  totalBatches: number,
  previousScenes: any[],
  configId: string | null,
  controller: ReadableStreamDefaultController,
  isStreamClosed: boolean,
  customPromptEnabled?: boolean,
  customSystemPrompt?: string,
  qualityFeedback?: string,
  projectConfig?: any,
  skeletonSummary?: string,
  adaptationSummary?: string
): Promise<any[]> {
  const model = await getModelName(configId);
  const temperature = await getTemperature(configId);

  const sceneRange = {
    min: Math.max(1, Math.round(batchSceneCount * 0.9)),
    max: Math.round(batchSceneCount * 1.1),
  };

  // 构建前文衔接信息与防重复清单
  let continuityContext = '';
  if (previousScenes.length > 0) {
    const lastScene = previousScenes[previousScenes.length - 1];
    
    // 生成全局已生成场景的简明清单
    const previousSceneSummaryList = previousScenes.map((s: any, idx: number) => 
      `- 场景 ${idx + 1}：${s.sceneTitle || '无标题'}（概要：${(s.actions || '').slice(0, 50)}...）`
    ).join('\n');

    continuityContext = `
## 已生成场景目录清单（⚠️绝对禁止重复以下已发生的任何场景与情节）
${previousSceneSummaryList}

## 上一批次最后一幕的详细衔接细节（您必须紧接此处继续创作新情节，切勿倒退）
- 场景标题：${lastScene.sceneTitle || ''}
- 场景描述：${lastScene.description || ''}
- 动作：${lastScene.actions || ''}
- 对白：${(lastScene.dialogues || []).map((d: any) => `${d.character}：${d.line}`).join('；') || '无'}
- 舞台指示：${lastScene.stageDirections || ''}

请从上述最末场景无缝自然过渡，严禁重复已生成目录清单中的任意场景及对白剧情。`;
  }

  const systemPrompt = await getScriptSystemPrompt(customPromptEnabled, customSystemPrompt, {
    title: chapterTitle,
    text: [chapterTitle, chapterContext, continuityContext, qualityFeedback].filter(Boolean).join('\n'),
  });

  const progressPctStart = Math.round(((currentBatch - 1) / totalBatches) * 100);
  const progressPctEnd = Math.round((currentBatch / totalBatches) * 100);

  // 构建项目配置信息块
  const projectConfigBlock = projectConfig
    ? `
【项目配置】
- 总集数：${projectConfig.totalEpisodes || '未指定'}集
- 单集时长：${projectConfig.episodeDuration || '未指定'}分钟
- 平台规格：${projectConfig.platform || '未指定'}
- 风格定位：${projectConfig.style || '未指定'}
- 付费策略：${projectConfig.paywall || '未指定'}
- 当前集数：${projectConfig.currentEpisode ? `第${projectConfig.currentEpisode}集` : '未指定'}
- 本次生成集数：${projectConfig.totalEpisodesToGenerate || 1}集
`
    : '';

  // 构建骨架摘要块
  const skeletonBlock = skeletonSummary
    ? `
【故事骨架摘要】
${skeletonSummary}
`
    : '';

  // 构建改编策略摘要块
  const adaptationBlock = adaptationSummary
    ? `
【改编策略摘要】
${adaptationSummary}
`
    : '';

  // 将所有动态上下文和防重复规则整合到 userPrompt 中，让 systemPrompt 保持对数据库模板的绝对纯净调用
  const userPrompt = `请将以下小说章节转化为影视剧本。
${projectConfigBlock}
${skeletonBlock}
${adaptationBlock}
【当前章节标题】${chapterTitle}
【当前改编进度】本次改编对应章节内容的 ${progressPctStart}% - ${progressPctEnd}% 左右
【起始场景索引】sceneIndex 从 ${batchStartIndex + 1} 开始

${continuityContext}

${qualityFeedback ? `【上一次生成未通过检查，本次必须修正】\n${qualityFeedback}\n` : ''}

【待改编小说正文】
${chapterContext}

【生成指令】
1. 请完全根据【系统提示词 (System Prompt)】的角色设定、Toonflow 剧本创作方法论和 JSON 格式要求进行剧本创作。
2. 场景数量根据小说内容灵活决定：有多少情节需要表现就生成多少场景，不做固定数量限制。
3. 【强制要求】每个场景都必须有dialogues对白，不得出现空数组[]或空值；如果原文没有直接对白，需要根据情节合理创作符合角色性格的对白。
4. 每个sceneTransition必须写成"承接上一场 + 引出下一场"的完整句子，让场景形成连续故事链。
5. sceneTitle格式参考《洪水进门》：集数-场景序号 时间/内或外/地点 人物：角色列表，如"1-1 清晨/内/刘桂兰家 人物：刘桂兰、刘建国"。
6. 必须确保故事时间线向后推进，严禁改编已处于前文部分的已生成情节。
7. 每个场景都必须产生"新的剧情结果"：新线索、新冲突升级、新人物决定、新空间变化或新关系变化。
8. 必须按"当前章节正文剧情段锚点"的顺序改编，可以一个场景覆盖一个剧情段，也可以一个场景覆盖相邻两个剧情段。
9. 严格遵循输出格式，只返回合法纯 JSON，且绝不能包含 markdown 代码块标记或任何前后解释文字。
10. 【Toonflow 执行要点】每个场景必须自查三大密度（情绪/信息/情节），确保符合 Toonflow 方法论要求。
11. 【情绪通道】每个场景至少使用2个情绪表达通道（对白/动作/环境/潜台词）。
12. 【节奏控制】遵循3-15-45法则，每个场景的前3秒必须有抓眼球的元素。`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];

  let fullText = '';

  try {
    const { apiUrl, apiKey, provider } = await getRawAIConfig(configId);
    
    // 检查API Key是否配置
    if (!apiKey) {
      throw new Error('AI接口密钥未配置，请先在"API设置"页面配置有效的AI接口密钥');
    }
    
    // 检查API Key格式是否正确
    if (apiKey.length < 10) {
      throw new Error('AI接口密钥格式无效，请检查"API设置"页面的配置');
    }
    
    const resp = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: true, temperature, max_tokens: 8192, reasoning_effort: 'none', tool_choice: 'none' }),
    });
    
    if (resp.status === 401) {
      throw new Error(`AI接口密钥无效（401错误），请在"API设置"页面重新配置有效的${provider}接口密钥`);
    }
    
    if (!resp.ok || !resp.body) {
      const errorText = await resp.text().catch(() => '');
      throw new Error(`AI 接口错误: ${resp.status} - ${errorText || '请检查API配置'}`);
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    outer: while (true) {
      if (isStreamClosed) break;
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') break outer;
        try {
          const j = JSON.parse(raw);
          const content = j.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            if (!isStreamClosed) {
              safeEnqueue(
                controller,
                `data: ${JSON.stringify({ type: 'content', chapterTitle, content })}\n\n`,
                `content for ${chapterTitle}`
              );
            }
          }
        } catch {}
      }
    }
  } catch (streamError: any) {
    console.error('[generate] 流式生成错误:', streamError?.message);
    if (!fullText) throw streamError;
  }

  if (!fullText.trim()) {
    console.warn('[generate] AI返回内容为空');
    return [];
  }

  console.log(`[generate] AI返回内容长度: ${fullText.length}, 前200字: ${fullText.substring(0, 200)}`);

  // 预处理：移除AI可能添加的思考标签
  let cleanedText = fullText;
  cleanedText = cleanedText.replace(/<think[\s\S]*?<\/think>/gi, '');
  cleanedText = cleanedText.replace(/<thinking[\s\S]*?<\/thinking>/gi, '');
  cleanedText = cleanedText.trim();

  // 解析JSON
  try {
    // 先尝试直接解析（可能是 episodes 结构或 scenes 结构）
    let parsed = extractJsonObject<any>(cleanedText, ['scenes']);
    
    // 如果没找到 scenes，尝试直接解析看是否有 episodes 结构
    if (!parsed) {
      try {
        const directParse = JSON.parse(cleanedText);
        if (directParse && typeof directParse === 'object') {
          // 检查是否有 episodes 结构
          if (directParse.episodes && Array.isArray(directParse.episodes)) {
            const allScenes: any[] = [];
            for (const ep of directParse.episodes) {
              if (ep.scenes && Array.isArray(ep.scenes)) {
                allScenes.push(...ep.scenes);
              }
            }
            if (allScenes.length > 0) {
              console.log(`[generate] 从episodes结构提取到 ${allScenes.length} 个场景`);
              return normalizeGeneratedScenes(allScenes, batchStartIndex);
            }
          }
          // 检查嵌套结构
          if (directParse.screenplay?.scenes) {
            parsed = directParse;
          }
        }
      } catch {
        // 直接解析也失败，保持parsed为null
      }
    }

    if (!parsed) {
      console.warn('[generate] 批次JSON解析返回null, 原文前500字: ' + cleanedText.substring(0, 500));
      return extractScenesFromText(cleanedText);
    }

    let scenes: any[] = [];

    if (parsed.scenes && Array.isArray(parsed.scenes)) {
      scenes = parsed.scenes;
    } else if (parsed.screenplay?.scenes) {
      scenes = parsed.screenplay.scenes;
    } else {
      console.warn('[generate] 批次JSON解析成功但无scenes字段:', Object.keys(parsed));
      return extractScenesFromText(cleanedText);
    }

    // 兼容处理：sceneTitle / title 统一
    scenes = scenes.map((scene: any) => {
      const normalized = {
        ...scene,
        sceneTitle: scene.sceneTitle || scene.title || '',
      };
      delete normalized.title;
      return normalized;
    });

    return normalizeGeneratedScenes(scenes, batchStartIndex);
  } catch (parseError) {
    console.warn('[generate] 批次JSON解析失败:', parseError);
    return extractScenesFromText(cleanedText);
  }
}

// 从纯文本中提取场景信息（JSON解析失败时的兜底方案）
function extractScenesFromText(text: string): any[] {
  const scenes: any[] = [];
  const patterns = [
    /(?:场景|Scene)\s*(\d+)[：:.\s]+([^\n]+)/gi,
    /(?:【场景|【Scene)(\d+)[】]\s*([^\n]+)/gi,
    /(\d+)[.、．]\s*([^\n]{2,40})/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const idx = parseInt(match[1]);
      if (idx >= 1 && idx <= 200) {
        scenes.push({
          sceneIndex: idx,
          sceneTitle: match[2].trim(),
          description: '',
          actions: '',
          dialogues: [],
          stageDirections: '',
        });
      }
    }
    if (scenes.length > 0) break;
  }

  return scenes;
}
