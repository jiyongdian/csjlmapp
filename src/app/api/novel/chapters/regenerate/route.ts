import { formatChapterTitle } from '@/lib/chapter-title';
import { NextRequest } from 'next/server';
import { getRawAIConfig, getModelName, getTemperature } from '@/lib/ai-config';
import { getPromptWithFallback } from '@/lib/prompt-helper';
import { sanitizeChapterDelta, sanitizeChapterText } from '@/lib/chapter-text-cleaner';
import { type ChapterStateLedger, runLocalQualityCheck, type LocalQualityReport } from '@/lib/chapter-pipeline/local-quality-check';
import { buildLedgerFrom, buildHardAnchor, summarizeChapterForLedger, type ChapterHardAnchor } from '@/lib/chapter-pipeline/three-tables';
import { classifyEnding, cutOffPickList } from '@/lib/chapter-pipeline/ending-rotator';
import { runStation4B } from '@/lib/chapter-pipeline/deep-quality-client';
import {
  computeChapterContinuityReport,
  scanAndRepairClosingPhrases,
  CLOSING_PHRASES_EXPLICIT,
  AI_TEMPLATE_CLOSING_HINTS,
  EMPTY_HOOK_PHRASES_SHARED,
  type ContinuityReport,
} from '@/lib/chapter-pipeline/continuity-checker';

const TIMEOUT_MS = 360_000; // 360秒超时（推理量大的模型/中文长结构需要更宽窗口）

async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number }): Promise<Response> {
  const { timeout = TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...fetchOptions, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      idea,
      structure,
      tone,
      genderTarget,
      narrativePerspective,
      protagonistName,
      supportingCharacterName,
      chapterIndex,
      configId,
      previousChapterContent = '',
      previousChapterTitle = '',
      nextChapterHook = '',
      allChapterHooks,
      existingTitles = [],
      novelId = '',
      continuityRepairContext,
      repairTarget = 'default',
    } = body;

    if (!idea || !structure || !chapterIndex) {
      return new Response(JSON.stringify({ error: '主题创意、结构分析和章节索引不完整' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    const modelName = await getModelName(configId);
    const temperature = await getTemperature(configId, 0.65);
    const { apiUrl, apiKey, provider } = await getRawAIConfig(configId);

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API密钥未配置，请先在"API设置"中配置有效的AI接口密钥' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    const isContinuityRepair = repairTarget === 'continuity' || !!continuityRepairContext;
    console.log(
      `[Chapters/Regenerate] provider=${provider} chapter=${chapterIndex} repairTarget=${repairTarget} continuity=${isContinuityRepair}`
    );

    // ===== P3-1：单章重生 · 准备 POV / 账本 / tail / ending =====
    const chapterNum = typeof chapterIndex === 'number' ? chapterIndex : Number(chapterIndex);
    const narrativePOV: 'first' | 'third-limited' = String(narrativePerspective || '').includes('第三')
      ? 'third-limited'
      : 'first';
    const prevTailRaw = previousChapterContent ? summarizeChapterForLedger(previousChapterContent).tailRaw : '';
    const prevLedgerRaw: ChapterStateLedger = (() => {
      if (!previousChapterContent) {
        return {
          protagonistName: String(protagonistName || '主角'),
          pov: narrativePOV,
          povCharacterName: String(protagonistName || '主角'),
        };
      }
      // 账本由上一章 tail 摘要构建；禁止按关键词硬编码注入伤情/位置/道具
      // （旧逻辑会把"怀里/门槛"等正常用词误判为木匣/破庙等他书道具，造成跨书状态污染）。
      return buildLedgerFrom('', prevTailRaw, String(protagonistName || '主角'), narrativePOV);
    })();
    const recentEndingCats = previousChapterContent ? [classifyEnding(previousChapterContent).primary] : [];

    // 衔接修复上下文：把前端 pair 体检的违规清单抽成修复命令
    const continuityRepairDirectives = (() => {
      if (!isContinuityRepair) return '' as const;
      const ctx: any = continuityRepairContext || {};
      const issues: any[] = Array.isArray(ctx.pairReport?.issues) ? ctx.pairReport.issues : [];
      const columns: any[] = Array.isArray(ctx.pairReport?.columns) ? ctx.pairReport.columns : [];
      const endingClosed = !!ctx.pairReport?.endingClosed;
      const simPct = typeof ctx.pairReport?.similarityPct === 'number' ? ctx.pairReport.similarityPct : -1;

      const lowCols = columns
        .filter((c) => typeof c?.score === 'number' && typeof c?.maxScore === 'number')
        .filter((c) => c.score / Math.max(1, c.maxScore) < 0.6)
        .map((c) => `·【${c.name || '维度'}】仅${c.score}/${c.maxScore} → 必须把这一项提到 ≥${Math.ceil(c.maxScore * 0.75)}分`);

      const issueCmds = issues.slice(0, 6).map((it: any, i: number) => {
        const name = it?.name ? `问题${i + 1}·${it.name}` : `问题${i + 1}`;
        const desc = it?.description ? `描述：${String(it.description).slice(0, 120)}` : '';
        const sugg = it?.suggestion ? `建议做法：${String(it.suggestion).slice(0, 160)}` : '';
        return `·${name}${desc ? ' —— ' + desc : ''}${sugg ? '\n  ▶ ' + sugg : ''}`;
      });

      const mandatory = [] as string[];
      // 硬伤 1: 上一章结尾闭合 → 本章段 1 必须拆一个"未完成信号"承接
      if (endingClosed) mandatory.push('⚠️【铁律1】上一章结尾🔒闭合（把话都说完了），所以你**本章开篇必须重开一个承上启下的未完成钩子**，禁止用"话说回来/闲话休提/综上所述"复述性开场，必须用【场景动作 + 上一章实体1~2个 + 一眼没说完的状态】3 要素承接。');
      // 硬伤 2: 实体共享低于阈值 → 开篇前 3 句必须点名实体 1-3 个
      const entityCol = columns.find((c) => String(c?.name || '').includes('实体共享') || String(c?.name || '').includes('共享度'));
      if (entityCol || simPct < 15) mandatory.push('⚠️【铁律2】实体共享严重不足（Jaccard相似度=' + (simPct >= 0 ? simPct + '%' : '偏低') + '）。你必须在**本章开场前 3 句内，自然嵌入上一章结尾强实体/关键名词 2~3 个**（见下方【段1 上章真相】的锚点），不能跳新场景、不能换关键实体。');
      // 硬伤 3: 弱状态承接 / 骑砍状态未呼应
      const stateCol = columns.find((c) => String(c?.name || '').includes('状态'));
      if (stateCol) mandatory.push('⚠️【铁律3】状态词承接断裂。【段1】里要**原封不动保留上一章里的强状态词（伤、昏迷、被扣、被锁、握在手里、烧着、在水里…）至少 1 个**，不能一到本章就"状态全消失"，更不能把人从"昏迷"直接写成"正常赶路"。');
      // 硬伤 4: 复述警戒 → 禁止 3-gram 对上一章前 15% 复述
      mandatory.push('⚠️【铁律4】复述警戒：不能对上一章任何段落做同义复述、换说法重述，特别是**不能把上一章开篇/中段内容当回忆搬到本章**；只允许承接「上一章尾巴的硬锚点」。');

      return [
        '═════════════════════════════════════════════════════════════════',
        '【🔥衔接专项重写·最高优先级铁律（本批必须全部满足）】',
        `本次重写模式：repairTarget=${repairTarget || 'continuity'}，目的是解决「上章${ctx.pairReport?.prevIndex || ''} → 本章${ctx.pairReport?.nextIndex || ''}」衔接体检失败问题。`,
        ...mandatory,
        lowCols.length ? ['', '【需要补分的低分维度】', ...lowCols].join('\n') : '',
        issueCmds.length ? ['', '【体检检测到的具体问题清单（逐条修复，不能漏掉）】', ...issueCmds].join('\n') : '',
        ctx.nextOpening350 && typeof ctx.nextOpening350 === 'string'
          ? `\n【衔接后锚点】下一章开场前 350 字原文（给你写章末引子用，只能呼应，不能剧透下一章具体内容）：\n${ctx.nextOpening350.slice(0, 420)}`
          : '',
        '═════════════════════════════════════════════════════════════════',
      ]
        .filter(Boolean)
        .join('\n');
    })();


    // 直接 fetch 流式调用，明确设置 max_tokens=8192，避免 SDK 默认限制导致章节截断
    async function* streamWithMaxTokens(
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
      temp: number,
      maxTokens = 8192
    ) {
      const resp = await fetchWithTimeout(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: modelName,
          messages,
          stream: true,
          temperature: temp,
          max_tokens: maxTokens,
          reasoning_effort: 'none',
        }),
        timeout: TIMEOUT_MS,
      });
      if (!resp.ok || !resp.body) throw new Error(`AI 接口错误: ${resp.status}`);
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') return;
          try {
            const j = JSON.parse(raw);
            const c = j.choices?.[0]?.delta?.content;
            const rc = j.choices?.[0]?.delta?.reasoning_content;
            // 优先输出实际内容，过滤推理思考内容
            if (c !== undefined && c !== null) yield { content: c };
            else if (rc !== undefined && rc !== null) {
              // reasoning_content 直接跳过，不作为正文输出
            }
          } catch {}
        }
      }
    }
    
    // 性别方向说明
    const genderTargetName = genderTarget === 'male' ? '男频' : '女频';
    const genderGuide = genderTarget === 'male' 
      ? `【男频创作指南】
- 主角通常是男性，强调热血、成长、升级、打脸、兄弟情
- 情节节奏快，爽点密集，注重实力提升和对抗
- 配角多为兄弟、对手、美女角色
- 情感线相对简单，多是后宫或单一女主
- 强调"从弱变强"、"逆袭翻盘"、"征服挑战"等主题`
      : `【女频创作指南】
- 主角通常是女性，强调情感、细腻、成长、爱情
- 情节节奏相对较慢，注重情感描写和心理刻画
- 配角多为闺蜜、情敌、男主、男配
- 情感线复杂细腻，多重情感纠葛和内心戏
- 强调"情感救赎"、"自我成长"、"命中注定"等主题`;

    // 叙事视角说明
    const perspectiveMap: Record<string, { name: string; guide: string; rules: string }> = {
      'first-person': {
        name: '第一人称',
        guide: '以"我"来叙述',
        rules: `【第一人称叙事铁律】
- 全文只能用"我"作为叙述主体，所有信息和感受必须通过"我"的五官和判断传递
- ❌ 绝对禁止：写"我"不在场的事情、写他人的心理活动、写"我"不知道的信息
- ✅ 正确做法：通过"我"的观察来推断他人——"他的眼神闪了闪，我猜他没说实话"`
      },
      'third-limited': {
        name: '第三人称限制',
        guide: '用"他/她"称呼主角，视角锁定主角',
        rules: `【第三人称限制叙事铁律】
- 用"他/她"称呼主角，视角始终锁定在主角身上
- ✅ 可以写主角的所见所闻所想
- ❌ 绝对禁止：切换到其他角色的心理活动`
      },
      'third-omniscient': {
        name: '第三人称全知',
        guide: '上帝视角，可自由切换任何角色视角',
        rules: `【第三人称全知叙事铁律】
- 可自由切换到任何角色的心理和视角
- ⚠️ 每次切换必须有明确的场景过渡，每个视角至少停留1-2段`
      },
      'second-person': {
        name: '第二人称',
        guide: '用"你"来叙述',
        rules: `【第二人称叙事铁律】
- 全文用"你"来叙述，让读者成为故事参与者
- ❌ 绝对禁止：突然切换到"他"或"我"的叙述视角`
      }
    };
    const perspectiveInfo = perspectiveMap[narrativePerspective || 'third-omniscient'] || perspectiveMap['third-omniscient'];
    const perspectiveGuide = `【叙事视角：${perspectiveInfo.name}】${perspectiveInfo.guide}`;
    const agentContext = {
      genre: idea?.genre || idea?.category,
      tone,
      genderTarget,
      theme: idea?.theme,
      concept: idea?.concept,
      setting: idea?.setting,
      text: [
        idea?.theme,
        idea?.concept,
        idea?.characters,
        idea?.supportingCharacters,
        idea?.characterRelationships,
        idea?.setting,
        structure?.mainPlot,
        structure?.keyConflicts,
        structure?.keyScenes,
        structure?.keyItems,
        previousChapterContent,
        nextChapterHook,
        Array.isArray(allChapterHooks) ? allChapterHooks.join('\n') : '',
      ].filter(Boolean).join('\n'),
    };

    const encoder = new TextEncoder();

    // 获取指定章节的钩子
    const chapterHook = (structure.chapterHooks || [])[chapterIndex - 1] || '';

    // 从钩子中智能提炼标题（5-10字）：直接用钩子生成标题，不依赖AI
    const buildRawTitleFromHook = (chapterNum: number): string => {
      const hook = allChapterHooks?.[chapterNum - 1] || structure.chapterHooks?.[chapterNum - 1] || '';
      if (!hook) return '';

      // 策略1：提取"X的Y"结构，组合为"XY"（如"矿洞的血字"→"矿洞血字"）
      const dePatterns = [
        /([^\s，。！？、；：]{2,4})的([^\s，。！？、；：]{2,4})的/g,
        /([^\s，。！？、；：]{2,4})的([^\s，。！？、；：]{2,4})/g,
      ];
      for (const pattern of dePatterns) {
        const m = pattern.exec(hook);
        if (m) {
          const combined = m[1] + m[2];
          const len = [...combined].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x7f ? 1 : 0.5), 0);
          if (len >= 5 && len <= 10) return combined;
          const part2Len = [...m[2]].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x7f ? 1 : 0.5), 0);
          if (part2Len >= 3 && part2Len <= 8) return m[2];
        }
      }

      // 策略2：按标点分句提取核心动词+名词组合
      const clauses = hook.split(/[，。！？、；：\s]+/).filter((c: string) => c.length >= 2);
      const coreWords: string[] = [];
      for (const clause of clauses) {
        const cleaned = clause
          .replace(/^(于是|然后|但是|可是|虽然|然而|因此|所以|他|她|它|他们)/, '')
          .replace(/(之后|以前|时候|地方|起来|出来|下去|起来)/, '');
        if (cleaned.length >= 2 && cleaned.length <= 6) {
          coreWords.push(cleaned);
        } else if (cleaned.length > 6) {
          coreWords.push(cleaned.slice(0, 2));
          coreWords.push(cleaned.slice(-2));
        }
      }

      if (coreWords.length >= 2) {
        const combined = coreWords.slice(0, 2).join('');
        const len = [...combined].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x7f ? 1 : 0.5), 0);
        if (len >= 5 && len <= 10) return combined;
        if (len > 10) return combined.slice(0, 8);
      }
      if (coreWords.length >= 3) {
        const combined = coreWords[0] + coreWords[2];
        const len = [...combined].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x7f ? 1 : 0.5), 0);
        if (len >= 5 && len <= 10) return combined;
      }
      if (coreWords.length >= 1) {
        const single = coreWords[0];
        if (single.length >= 5) return single.slice(0, 8);
      }

      // 策略3：兜底取钩子前8字
      const first8 = hook.replace(/\s/g, '').slice(0, 8);
      const first8Len = [...first8].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x7f ? 1 : 0.5), 0);
      if (first8Len >= 5) return first8;

      return '';
    };
    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        try {
                    // 构建全章节钩子概览（帮助AI理解当前章节在整体中的位置）
    const allHooks = allChapterHooks || structure.chapterHooks || [];
    const hooksOverview = allHooks.map((hook: string, idx: number) => {
      const num = idx + 1;
      if (num === chapterIndex) return `第${num}章 ★当前★：${hook}`;
      if (num === chapterIndex - 1) return `第${num}章 ↑上章↑：${hook}`;
      if (num === chapterIndex + 1) return `第${num}章 ↓下章↓：${hook}`;
      return `第${num}章：${hook}`;
    }).join('\n');

    const baseSystemPrompt = await getPromptWithFallback('chapter-regenerate-system', `你是一位资深真人小说作家，有多年的创作经验。你的写作有温度、有烟火气，允许适度的"不完美感"——可加入轻微的情绪留白、碎片化心理描写、生活化细节。你拒绝AI式的"逻辑过度严密""语言过于规整""无多余情绪铺垫"，拒绝套话、空话和模板化句式。你的文字像真人伏案写作时的自然流露，而非机器的生硬拼接。

          【核心创作理念】

          1. **语言有温度**：用生活化的口语、有烟火气的细节，让文字有呼吸感
          2. **允许不完美**：可加入轻微的联想式表达、碎片化心理，不刻意追求"完美闭环"
          3. **拒绝AI痕迹**：不用"他的眼神充满了…""心中暗想…""时光荏苒…"等AI式表达
          4. **细节真实化**：用具体的视觉、听觉、触觉细节代替抽象描述
          5. **对话个性化**：人物有口头禅、有语气起伏，符合人物性格

          【章节结尾核心要求 - 最重要的部分】

          章节结尾必须彻底摆脱AI化的模式化表达，遵循真人作家的结尾逻辑。每章结尾必须独特，不能重复使用相同的模式。采用以下四种真人化收尾方式（可交替使用）：

          ① **场景留白式**：结尾停留在具体场景或细微动作上，无总结、无刻意悬念，只呈现画面感，留给读者联想空间
             - 例："她把那封皱巴巴的信塞进抽屉最深处，指尖蹭过木柜的纹路，窗外的雨还没停。"
             - 例："他站在空荡荡的站台上，看着列车消失在夜色里，手里的车票已经被攥得发皱。"

          ② **情绪余韵式**：结尾聚焦人物的细微情绪、心理波动，不直白点破，用细节传递情绪
             - 例："他握着那枚旧纽扣，指腹反复摩挲，直到掌心发潮，竟没发现眼眶已经发热。"
             - 例："她笑了笑，没再说话，转身走进厨房。锅里的汤还在咕嘟咕嘟地冒着热气。"

          ③ **戛然而止式**：在情节推进的关键节点自然收尾，不刻意强调"后续"，像真人写作时的"写到此处恰好留白"
             - 例："门被推开的瞬间，他看清了来人的脸，所有的话都堵在了喉咙里。"
             - 例："她举起手，犹豫了一下，最终还是敲响了那扇门。"

          ④ **细节呼应式**：结尾呼应本章前文的某个小细节（如物品、动作、一句话），形成细腻的闭环，不刻意升华
             - 例："她端起桌上的凉茶，抿了一口，还是和去年夏天一样的味道，只是身边再没人陪她吐槽茶太苦。"
             - 例："那张纸条还压在杯子底下，字迹已经被水渍晕开，但上面的每一个字她都记得。"

          【章节结尾禁忌 - 严格避免】
          ❌ 禁止总结本章内容（"本章主要讲述了…""综上所述…"）
          ❌ 禁止强行升华主题（"这让他明白了一个道理…"）
          ❌ 禁止刻意留下"明显悬念"（"他不知道的是，更大的危险正在逼近…"）
          ❌ 禁止"未完待续式生硬提示"（"欲知后事如何…""下一章更精彩…"）
          ❌ 禁止用固定句式收尾（"这一天结束了""他们回家了"）
          ❌ 禁止欧·亨利式刻意反转模仿
          ❌ 禁止每章都制造大悬念——真人作家的结尾更多是"情绪的沉淀"或"情节的自然停顿"

          【写作流程 - 严格按照以下步骤创作】

          ### 步骤一：列本章3句剧情大纲
          在写作前先明确以下三句话，确保本章有清晰主线：
          1. **本章发生啥**：本章核心事件是什么？
          2. **遇到啥**：主角遇到什么阻碍、冲突或转折？
          3. **结尾落在哪**：本章结尾用哪种收尾方式？落在什么情绪或画面上？

          ### 步骤二：按四段结构动笔
          将本章正文分为四个段落：
          - 第一段：开场快速承接上章，1-2句话带入场景，展开核心事件
          - 第二段：矛盾升级、冲突激化，主角遭遇阻碍
          - 第三段：转折变化、剧情推进，制造小高潮
          - 第四段：选一种真人化收尾方式，自然停笔

          ### 步骤三：结尾自然收束
          - 不拖剧情凑字数，在剧情自然节点果断收尾，**必须写完最后一句才停笔**
          - 选一种真人化收尾方式，情绪点到即止

          ### 步骤四：通读微调
          写完通读全章，确保：字数合规、语言自然、结尾不做作、段落简短易读

          输出格式（**必须严格遵守**）：
          第${chapterIndex}章
          （空一行后正文开始，篇幅1000-1800 字，完整写出本章全部情节、结尾留钩子）

          【格式铁律 - 违反即废稿】
          - **必须**以"第${chapterIndex}章"开头（后面不要写标题，系统会自动从钩子生成）
          - 章节号后必须空一行再开始正文
          - 不要在章节号后加冒号、标题或其他任何文字
          - 标题示例：钩子"主角发现父亲留下的密信" → 标题"尘封的密信"✅
          - 标题示例：钩子"敌军夜袭城池" → 标题"城破之夜"✅ 或"烽火夜袭"✅
          - ❌ 绝对禁止标题出现正文内容（如"临安府城北""第二天一早"等正文开头词）
          - ❌ 绝对禁止标题是正文第一句话的截取
          - ❌ 禁止过短标题（少于5字）
          - ❌ 禁止过长标题（超过10字）
          - ❌ 禁止无意义泛化标题如"开始"、"转折"、"高潮"

          【人物命名铁律 - 绝对禁止使用以下AI烂大街名字】
          ❌ 禁止男性名：叶辰、林辰、楚辰、夜宸、江辰、墨渊、墨尘、墨寒、墨枭、墨辞、萧逸、萧珩、萧烬、萧玄、萧辰、顾言琛、顾夜寒、顾云深、顾临川、顾景琛、陆沉渊、陆知衍、陆廷川、陆星辞、陆泽言、沈寂、沈砚、沈聿、沈辞、沈亦臻、凌夜、凌骁、凌宸、凌烬、凌玄、厉霆骁、厉烬言、厉司寒、厉夜珩、厉泽渊、傅斯年、傅景深、傅夜辞、傅云宸、傅聿白、云澈、玄澈、苍珩、冥夜、君夜、陈默
          ❌ 禁止女性名：苏晚、苏清鸢、苏念、苏瑶、苏汐、温阮、温瑜、温舒然、温知夏、温晚卿、洛璃、洛汐、洛烟、洛清欢、洛知予、云舒、云绾、云瑶、云晚、云汐月、许念、许知意、许清禾、许绾宁、许悠然、白芷、白若溪、白灵汐、白慕颜、白清瑶、叶绾绾、叶知微、叶晚柠、叶灵萱、叶清寒、唐知予、唐慕晚、唐沁柔、唐云汐、唐舒颜、宁汐、宁晚、宁知鸢、宁清瑶、宁绾柔、夏晚晴、夏知柠、夏灵玥、慕晚、林语嫣
          ✅ 必须使用真实、生活化、有烟火气的名字，像你身边真实存在的人名

          ${perspectiveInfo.rules}

          ⚠️ 铁律：必须输出完整章节内容，在句子自然结束处收笔，严禁在句子或段落中间截断。
          篇幅1000-1800 字，完整写出本章全部情节，严禁截断、严禁提前收尾。
          结尾选一种真人化收尾方式（场景留白/情绪余韵/戛然而止/细节呼应），自然停笔，不总结、不升华、不刻意制造悬念。`, agentContext);

    const systemPrompt = `${baseSystemPrompt}

【最终输出硬规则 - 优先级最高】
- 只输出小说正文，禁止输出任何代码、JSON、Markdown、XML、HTML、数组、对象、字段名或调试标记。
- 禁止输出 entity / people / place / item / scene 等内部实体标签，禁止输出 □entity□[...]□、<entity>...</entity> 之类标注。
- Agent Skills 只作为写作规则内化使用，不得把技能说明、分析标签、数据结构、字段名写进正文。
- 若需要记录人物、地点、物品关系，只能转化为自然中文叙事。

【🚫 收束句禁用清单（命中直接废稿）】
以下任何短语/句式严禁出现在正文中，尤其不得作为章末收尾：
1. 显式禁用短语：${CLOSING_PHRASES_EXPLICIT.map(p => `「${p}」`).join('、')}
2. 6 类 AI 模板结尾禁用：
${AI_TEMPLATE_CLOSING_HINTS.map(h => '   · ' + h).join('\n')}
3. 章末只允许使用"真人 4 类开放式结尾"之一：动作切断 / 钩子问句 / 细节揭示 / 台词截断。严禁"说完就收"式封闭式总结。
4. 结尾出现上述禁用短语，等同于本章不合格，将被程序化裁剪到上一个开放式句末并触发重写。`;

          // ===== 单章重写也构建上章硬锚点（单一真相源）=====
          const prevHardAnchor: ChapterHardAnchor | null = (() => {
            if (!previousChapterContent) return null;
            try {
              const e = previousChapterContent ? classifyEnding(previousChapterContent) : null;
              return buildHardAnchor(previousChapterContent, e ? { primary: e.primary as any, isHuman: ['action-cut','hook-question','detail-reveal','line-dialogue'].includes(e.primary) } : null);
            } catch { return null; }
          })();
          const hookEmpty = !!chapterHook && EMPTY_HOOK_PHRASES_SHARED.some(p => String(chapterHook).includes(p));
          const nextHookForRegen = nextChapterHook || (chapterNum < (structure?.chapterHooks?.length ?? 0) ? structure.chapterHooks[chapterNum] : null);
          const nextHookPhraseForRegen = (() => {
            if (!nextHookForRegen) return null;
            const h = String(nextHookForRegen).replace(/\s+/g, ' ').trim();
            const first = h.split(/(?<=[。！？!?；…])/).filter(Boolean)[0] || h;
            return first.length <= 60 ? first : first.slice(0, 60) + '…';
          })();

          const userPrompt = [
`请根据以下信息重新创作第${chapterIndex}章，目标读者群体为${genderTargetName}：`,
// ✅ 衔接修复时把铁律 4 条 + 低分维度 + 问题清单 6 条直接顶到最前（优先级最高）
continuityRepairDirectives,
genderGuide,
perspectiveGuide,
protagonistName && protagonistName.trim() ? `主角名字：${protagonistName}（全文统一使用此名字）` : '',
supportingCharacterName && supportingCharacterName.trim() ? `配角名字：${supportingCharacterName}（如有多个用逗号分隔，在章节中合理安排这些配角出场）` : '',
// 避免撞标题（前端送了 existingTitles 就复用）
Array.isArray(existingTitles) && existingTitles.length
  ? `【禁止撞标题（本文件已存在的章节标题，绝对不能使用）】\n${existingTitles
      .filter((t: any) => t && t.chapterNum !== chapterNum && t.title)
      .map((t: any) => `  · 第${t.chapterNum}章标题：${String(t.title)}`)
      .join('\n')}`
  : '',
'',
'【主题创意框架】',
`小说主题：${idea.theme}`,
`创意核心：${idea.concept}`,
`主要人物：${idea.characters}`,
idea.supportingCharacters ? `配角设定：${idea.supportingCharacters}` : '',
idea.characterRelationships ? `角色关系体系：${idea.characterRelationships}` : '',
`世界观设定：${idea.setting}`,
'',
'【结构分析框架】',
`主要情节：${structure.mainPlot}`,
`关键冲突：${structure.keyConflicts || ''}`,
structure.keyScenes ? `关键场景：${structure.keyScenes}` : '',
structure.keyItems ? `关键物品：${structure.keyItems}` : '',
'',
'【全章节钩子概览】',
hooksOverview,
'',
// —— 段 1：上章真相（硬锚点）
previousChapterContent && prevHardAnchor
  ? [
      hookEmpty ? `【钩子降级提示】本章钩子「${String(chapterHook).slice(0, 40)}…」检测为空话泛词。下面"段1 上章真相"替代钩子成为本章开场**第一优先级约束**。` : '',
      '═════════════════════════════════════════════════════════════════',
      '【段 1 · 上章真相（⚠️ 真实发生过的原文·严禁复述/改写/换说法重演）】',
      `—— 上章编号：第${chapterNum - 1}章`,
      `—— 上章结尾硬锚点·原文最后 1~2 句：「${prevHardAnchor.finalSentences || '(空)'}」`,
      prevHardAnchor.strongKeywords.length ? `—— 强状态词（尾 350 字内真实命中）：${prevHardAnchor.strongKeywords.join('、')}` : '',
      prevHardAnchor.anchorNgrams.length ? `—— 实体锚点 3-gram top6：${prevHardAnchor.anchorNgrams.join(' / ')}` : '',
      `—— 场景快照：${prevHardAnchor.sceneSnapshot}`,
      `—— 未完成信号：${prevHardAnchor.unresolvedSignal}`,
      `—— 上章结尾原文末 500 字（用于核对，禁止复述）：`,
      previousChapterContent.slice(-500),
      '【✅ 强制承接要求·本章开头前 3 句】',
      '1. 必须与「硬锚点·最后 1~2 句」保持时间/地点/人物/状态连续，禁止硬跳。',
      prevHardAnchor.strongKeywords.length
        ? '2. 前 3 句内必须出现至少 1 个强状态词，或写出明确过渡（挣脱/解开/醒来/发现自己在/从XX里出来/被带/押解/审讯室/牢房等）。'
        : '2. 前 3 句内必须出现至少 1 个硬锚点实体（人名/伤情/道具/天气/地点之一），给出自然承接。',
      '3. 绝对禁止"话说/且说/回忆/上次说到"等回顾式起笔，必须直接写承接状态后的下一步新动作。',
      '═════════════════════════════════════════════════════════════════',
    ].filter(Boolean).join('\n')
  : previousChapterContent
    ? `【上一章已发生原文（⚠️ 真实发生过，严禁复述/改写）】\n第${chapterNum - 1}章末尾 500 字：\n${previousChapterContent.slice(-500)}`
    : '【开篇要求】作为开篇章节，要清晰设定起点和核心冲突，建立世界观和人物关系。',
'',
// —— 段 2：本章任务（钩子 + 账本）
`【段 2 · 本章核心任务（必须逐条落到本章正文中，100% 覆盖）】`,
chapterHook,
'',
// —— 段 3：下章铺垫锚点
chapterNum < (structure?.chapterHooks?.length ?? 9999)
  ? nextHookPhraseForRegen
    ? `【段 3 · 下章铺垫锚点（只允许用 1~3 句场景引子自然铺垫·严禁展开下一章具体剧情）】\n—— 下一章开头场景引子：「${nextHookPhraseForRegen}」\n铺垫方式三选一：a) 时间/光线/天气变化；b) 场景物件/环境音的一个变化；c) 人物一个未完成的小动作/未说完的话。`
    : `【段 3 · 章末铺垫要求】本章结尾仅用 1~3 句场景化引子自然衔接到下一章开头，严禁写出下一章具体剧情。`
  : '【结局衔接】作为接近结尾的章节，逐步收束情节线、揭示关键伏笔、为最终结局做准备。',
'',
'【写作要求（严格遵循）】',
'1. 开头前3句必须按【段1 强制承接要求】承接上章硬锚点，然后立刻进入本章核心任务（回顾段禁止超过2句简短过渡）',
'2. 严格按【段2 本章核心任务】逐条覆盖钩子的关键事件/冲突/对白要点，钩子是本章核心任务，100% 内容服务于钩子，绝不偏移',
'3. 篇幅1000-1800 字，完整展开本章全部情节，必须写到自然结束点、严禁截断',
'4. 结尾严格遵循 system prompt 中的「真人 4 类开放式结尾」：动作切断 / 钩子问句 / 细节揭示 / 台词截断之一；严禁任何收束总结或封闭式收尾',
'5. 🚫 禁剧透未来章：段3 只做"场景引子"，绝对禁止写出下一章及以后的具体剧情、对白、冲突、人物动作细节',
'6. 🚫 严禁复述或重演上一章已完整演绎的任何场景、对白、动作',
'7. 🚫 收束句禁令已在 system prompt 中列出，命中任何一个都会被程序化裁剪并触发重写。',
'',
`直接输出第${chapterNum}章正文（不要写章节号、标题、任何开场白）：`,
          ].filter(Boolean).join('\n');

          const messages = [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userPrompt },
          ];

          const llmStream = streamWithMaxTokens(messages, temperature, 8192);

          let rawFullText = '';
          let fullText = '';
          let sentCleanLength = 0;
          let titleSent = false;
          let fallbackTitle = '';
          let inThinking = false; // 追踪是否在<think标签内

          for await (const chunk of llmStream) {
            // null/undefined 也要处理，不能跳过
            const content = chunk.content ?? '';
            if (!content) continue;
            let text = content.toString();

              // 过滤AI思考过程（<think...>...</think >标签内容）
              if (inThinking) {
                const endIdx = text.indexOf('</think');
                if (endIdx !== -1) {
                  const afterThink = text.substring(text.indexOf('>', endIdx) + 1);
                  text = afterThink;
                  inThinking = false;
                } else {
                  continue;
                }
              }

              const thinkStart = text.indexOf('<think');
              if (thinkStart !== -1) {
                const thinkEnd = text.indexOf('</think', thinkStart);
                if (thinkEnd !== -1) {
                  const afterThink = text.substring(text.indexOf('>', thinkEnd) + 1);
                  text = text.substring(0, thinkStart) + afterThink;
                } else {
                  text = text.substring(0, thinkStart);
                  inThinking = true;
                }
              }

              rawFullText += text;
              const cleanedResult = sanitizeChapterDelta(rawFullText, sentCleanLength);
              fullText = cleanedResult.cleanText;
              sentCleanLength = cleanedResult.sentLength;
              text = cleanedResult.delta;

              if (!text.trim()) continue;

              // 检测章节开始标记 - 第X章后换行即表示正文开始
              if (!titleSent) {
                // 新格式：第X章\n（标题由系统从钩子生成）
                const simpleRegex = /(?:###\s*)?第(\d+)章\s*\n/g;
                // 兼容旧格式：第X章：标题\n
                const titledRegex = /(?:###\s*)?第(\d+)章[：:]\s*([^\n#]+?)(?:\s*###)?\n/g;

                let match = simpleRegex.exec(fullText);
                let contentStart = 0;
                let foundTitle = false;

                if (match && parseInt(match[1]) === chapterIndex) {
                  // 新格式：直接用钩子生成标题
                  const title = formatChapterTitle(chapterIndex, buildRawTitleFromHook(chapterIndex));
                  fallbackTitle = title;
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: 'chapter_start',
                        chapter: chapterIndex,
                        title: title,
                      })}\n\n`
                    )
                  );
                  titleSent = true;
                  contentStart = match.index + match[0].length;
                  foundTitle = true;
                } else {
                  // 兼容旧格式
                  match = titledRegex.exec(fullText);
                  if (match && parseInt(match[1]) === chapterIndex) {
                    const title = formatChapterTitle(chapterIndex, buildRawTitleFromHook(chapterIndex));
                    fallbackTitle = title;
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          type: 'chapter_start',
                          chapter: chapterIndex,
                          title: title,
                        })}\n\n`
                      )
                    );
                    titleSent = true;
                    contentStart = match.index + match[0].length;
                    foundTitle = true;
                  }
                }

                // 如果标题已发送，发送标题后的内容
                if (foundTitle && contentStart > 0) {
                  const afterTitle = fullText.substring(contentStart).trimStart();
                  if (afterTitle) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          type: 'content',
                          chapter: chapterIndex,
                          content: afterTitle,
                        })}\n\n`
                      )
                    );
                  }
                }
                // 标题已处理，跳过后续的内容发送
                if (titleSent) continue;
              }

              // 标题已发送，直接发送正文内容
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'content',
                    chapter: chapterIndex,
                    content: text,
                  })}\n\n`
                )
              );
            }

          // 如果标题始终未解析到，使用已提取的标题或钩子作为默认标题
          if (!titleSent) {
            const hookTitle = formatChapterTitle(chapterIndex, buildRawTitleFromHook(chapterIndex));
            const defaultTitle = hookTitle || `第${chapterIndex}章`;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'chapter_start',
                  chapter: chapterIndex,
                  title: defaultTitle,
                })}\n\n`
              )
            );
            // 发送所有已收集的内容
            if (fullText.trim()) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'content',
                    chapter: chapterIndex,
                    content: fullText,
                  })}\n\n`
                )
              );
            }
          }

          // ============= P3-1：单章重生 · ST3.5 收束修复 → STATION 4A(含衔接) → 4B → ST6 三重门控 =============
          // --- ST3.5：程序化收束句修复（命中"本章完/总之/AI模板结尾"则裁剪到上一个开放式句末）
          (function station35ClosingRepair() {
            try {
              const r = scanAndRepairClosingPhrases(fullText);
              if (r.anyHit && r.cutAt && !r.needRewriteTail && fullText.slice(0, r.cutAt).length > 300) {
                const before = fullText.length;
                fullText = fullText.slice(0, r.cutAt);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'closing_repair_done', chapter: chapterNum, beforeLen: before, afterLen: fullText.length, hits: r.hits.slice(0,5), cutAt: r.cutAt, message: '单章重生·命中收束句禁用清单，已程序化裁剪（'+before+'→'+fullText.length+'）' })}\n\n`));
              } else if (r.anyHit) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'closing_repair_needs_rewrite', chapter: chapterNum, hits: r.hits.slice(0,6), needRewriteTail: r.needRewriteTail, message: '单章重生·命中收束句但裁剪过短，转入4A重写' })}\n\n`));
              }
            } catch {}
          })();
          // --- STATION 4A 质检 + 跨章衔接分（统一 Retry 循环）
          let localReport: LocalQualityReport;
          let continuityReport: ContinuityReport;
          let attempts4a = 0;
          const MAX_4A_RETRY = 1;
          const noNeedCont = !previousChapterContent || chapterNum <= 1;
          while (true) {
            localReport = runLocalQualityCheck({
              chapterNumber: chapterNum,
              chapterContent: fullText,
              ledger: prevLedgerRaw,
              previousChapterTail: prevTailRaw,
              recentEndingCategories: recentEndingCats,
            });
            if (noNeedCont) {
              continuityReport = { finalScore: 100, pass: true, hardBreak: false, columns: { stateScore:25,ngramScore:25,repeatScore:25,transitionScore:25 }, issues: [], failureSection: '' };
            } else {
              try {
                continuityReport = computeChapterContinuityReport({
                  previousChapterCleanContent: previousChapterContent!,
                  currentChapterCleanContent: fullText,
                  previousHardAnchor: prevHardAnchor ?? null,
                  previousChapterNumber: chapterNum - 1,
                });
              } catch {
                continuityReport = { finalScore: 80, pass: true, hardBreak: false, columns: { stateScore:20,ngramScore:20,repeatScore:20,transitionScore:20 }, issues: [], failureSection: '' };
              }
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'continuity_score', chapter: chapterNum, attempt: attempts4a + 1, finalScore: continuityReport.finalScore, pass: continuityReport.pass, hardBreak: continuityReport.hardBreak, columns: continuityReport.columns, issueCount: continuityReport.issues.length, issuesHead: continuityReport.issues.slice(0,6).map((i)=>({id:i.id,level:i.level,title:i.title,penalty:i.penalty})) })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'local_quality', chapter: chapterNum, attempt: attempts4a + 1, finalScore: localReport.finalScore, pass: localReport.pass, hardContradiction: localReport.hardContradiction, columns: localReport.columns, issueCount: localReport.issues.length })}\n\n`));
            const combinedPass = localReport.pass && continuityReport.pass && !continuityReport.hardBreak;
            if (combinedPass || attempts4a >= MAX_4A_RETRY) break;
            attempts4a += 1;
            const reasonBits = [];
            if (!localReport.pass) reasonBits.push('LOCAL=' + localReport.finalScore);
            if (!continuityReport.pass || continuityReport.hardBreak) reasonBits.push('CONT=' + continuityReport.finalScore + ' hardBreak=' + continuityReport.hardBreak);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'local_regeneration_start', chapter: chapterNum, attempt: attempts4a, reason: reasonBits.join(' | ') })}\n\n`));
            const genderMap: Record<string, string> = { male: '男频读者', female: '女频读者', general: '泛读者' };
            const genderName = genderMap[String(genderTarget ?? 'general')] || '泛读者';
            const hook = (allChapterHooks?.[chapterNum - 1] || structure?.chapterHooks?.[chapterNum - 1] || '');
            const failure = localReport.failureReport + (continuityReport.failureSection || '');
            // 重写 prompt 继续保持三段式硬约束承接
            const retryPrompt = [
              '目标读者：' + genderName,
              '',
              '【🔴 FAILURE_REPORT · 本地 5 栏分质检 + 跨章衔接未通过】',
              failure || '质检未通过，请重写',
              '',
              prevHardAnchor && previousChapterContent
                ? [
                    '═════════════════════════════════════════════════════════════════',
                    '【段 1 · 上章真相·强制承接】',
                    '—— 上章最后 1~2 句：「' + prevHardAnchor.finalSentences + '」',
                    prevHardAnchor.strongKeywords.length ? '—— 强状态词：' + prevHardAnchor.strongKeywords.join('、') : '',
                    '—— 场景快照：' + prevHardAnchor.sceneSnapshot,
                    '【✅ 强制承接·本章开头前 3 句】',
                    '1. 必须承接硬锚点的时间/地点/人物/状态连续；',
                    prevHardAnchor.strongKeywords.length
                      ? '2. 前 3 句内必须出现至少 1 个强状态词或写出明确过渡（挣脱/解开/醒来/被带/押解等）；'
                      : '2. 前 3 句内必须出现至少 1 个硬锚点实体。',
                    '3. 禁止"话说/回忆/上次说到"等回顾式起笔，必须直接写承接状态后的下一步新动作。',
                    '═════════════════════════════════════════════════════════════════',
                  ].join('\n')
                : '',
              '',
              '【段 2 · 第' + chapterNum + '章核心任务】',
              hook || '承接上一章，推进剧情',
              '',
              '【段 3 · 章末要求】' + (nextChapterHook ? '本章结尾仅用1-3句场景化引子衔接下一章开头场景，严禁写出下章具体剧情' : (chapterNum < (structure?.chapterHooks?.length ?? 0) ? '用 1~3 句场景引子自然铺垫下一章，严禁展开具体剧情' : '逐步收束情节，为结局做准备')),
              '',
              '【原正文（供你对照问题，不要复述其中问题句）】',
              fullText,
              '',
              '请直接输出重新撰写的完整本章正文（不要标题、不要任何说明）：',
            ].filter(Boolean).join('\n');
            const rewriteMsgs = [
              { role: 'system' as const, content: systemPrompt },
              { role: 'user' as const, content: retryPrompt },
            ];
            let buf = '';
            try {
              for await (const chunk of streamWithMaxTokens(rewriteMsgs, temperature, 8192)) {
                const c = chunk?.content ?? ''; if (c) buf += c.toString();
              }
            } catch (err) {
              console.error('[Regen-4A-Rewrite] AI 回写错误：', err);
            }
            if (buf.trim().length >= 200) {
              const cleaned = sanitizeChapterDelta(buf, 0, true);
              fullText = cleaned.cleanText;
              // 重写稿再跑一次收束裁剪
              try {
                const rep = scanAndRepairClosingPhrases(fullText);
                if (rep.anyHit && rep.cutAt && !rep.needRewriteTail && fullText.slice(0, rep.cutAt).length > 300) {
                  fullText = fullText.slice(0, rep.cutAt);
                }
              } catch {}
            }
          }
          // --- STATION 4B 深审（通过 4A+衔接 才跑 4B）
          let deep: any = null;
          const final4aCombinedPass = localReport.pass && continuityReport.pass && !continuityReport.hardBreak;
          if (final4aCombinedPass) {
            const skip = localReport.finalScore >= 75;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'deep_quality_start', chapter: chapterNum, skip, reason: skip ? '本地分≥75跳过4B' : '调用4B深度审' })}\n\n`));
            if (!skip) {
              const hookB = (allChapterHooks?.[chapterNum - 1] || structure?.chapterHooks?.[chapterNum - 1] || '');
              deep = await runStation4B({
                chapter: { index: chapterNum, title: '第' + chapterNum + '章', content: fullText },
                previousChapter: previousChapterContent ? { index: chapterNum - 1, content: previousChapterContent } : undefined,

                previousChapterTail: prevTailRaw,
                ledger: prevLedgerRaw,
                recentEndingCategories: recentEndingCats,
                localReport,
              });
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'deep_quality_done', chapter: chapterNum, status: deep.status, deepScore: deep.deepFinalScore, summary: deep.deep.summary, rejectReason: deep.rejectReason ?? null, fixShortened: deep.fixShortened ?? false, warnings: deep.warnings ?? null })}\n\n`));
              if (deep.status === 'fixed-applied') {
                fullText = deep.finalContent;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'deep_quality_regeneration', chapter: chapterNum, chars: fullText.length, replacedContent: fullText.slice(0, 300), fullContent: fullText })}\n\n`));
              }
            } else {
              deep = { status: 'pass-through', deepFinalScore: Math.min(100, localReport.finalScore + 5) };
            }
          }
          // --- 定稿清洗
          fullText = sanitizeChapterText(fullText, false, { protagonistName, thirdPerson: narrativePOV === 'third-limited' });
          // --- STATION 6 三重门禁：本地 + 深审 + 跨章衔接
          const localOk = localReport.pass;
          const contOk = continuityReport.pass && !continuityReport.hardBreak;
          const deepScore = deep ? deep.deepFinalScore : 0;
          const deepOk = !!deep && deepScore >= 90;
          const softPassByLocalOnly = !deep && localReport.finalScore >= 75 && !localReport.hardContradiction;
          const qualityPass = localOk && (deepOk || softPassByLocalOnly);
          const gatePass = qualityPass && contOk;
          if (softPassByLocalOnly) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'pipeline_gate_softpass', chapter: chapterNum, finalScore: localReport.finalScore, hardContradiction: false, reason: '4B未运行但4A≥75无硬矛盾，ST6软通过' })}\n\n`));
          }
          if (!gatePass) {
            const reasons = [];
            if (!localOk) reasons.push('4A=' + localReport.finalScore);
            if (deep && !deepOk && !softPassByLocalOnly) reasons.push('4B=' + deepScore);
            if (!contOk) reasons.push('跨章衔接=' + continuityReport.finalScore + ' hardBreak=' + continuityReport.hardBreak);
            const mergedIssues = [
              ...localReport.issues.slice(0, 5).map((i: any) => ({ id: i.id, level: i.level, title: i.title, detail: (i.detail || '').slice(0, 120) })),
              ...continuityReport.issues.slice(0, 5).map((i: any) => ({ id: i.id, level: i.level, title: i.title, detail: (i.detail || '').slice(0, 120) })),
            ];
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'pipeline_gate_blocked', chapter: chapterNum, finalScore: localReport.finalScore, deepScore, hardContradiction: localReport.hardContradiction, continuityScore: continuityReport.finalScore, continuityHardBreak: continuityReport.hardBreak, attempts: attempts4a + 1, issuesHead: mergedIssues, message: '单章重生门禁未通过：' + reasons.join('；') })}\n\n`));
            console.error('[Regen-ST6-BLOCK] 第' + chapterNum + '章 未过门禁 local=' + localReport.finalScore + ' deep=' + deepScore + ' cont=' + continuityReport.finalScore + ' hardBreak=' + continuityReport.hardBreak);
          } else if (!noNeedCont) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'pipeline_continuity_pass', chapter: chapterNum, continuityScore: continuityReport.finalScore, columns: continuityReport.columns, message: '✅ 第' + (chapterNum - 1) + '→第' + chapterNum + '章 跨章衔接通过（' + continuityReport.finalScore + '/100）' })}\n\n`));
          }
          // 发送完成事件
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', generatedCount: gatePass ? 1 : 0, passedCount: gatePass ? 1 : 0, expectedCount: 1, gatePass, finalScore: localReport.finalScore, hardContradiction: localReport.hardContradiction, continuityScore: continuityReport.finalScore, continuityHardBreak: continuityReport.hardBreak, deepScore: deep ? deep.deepFinalScore : null, lastDeepFinalScore: deep ? deep.deepFinalScore : null })}\n\n`));
        } catch (error) {
          console.error('Error in stream:', error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    const rawMsg = error?.message ? String(error.message) : '';
    const stack = error?.stack ? String(error.stack) : '';
    console.error('[Chapters/Regenerate] FATAL:', { msg: rawMsg, stack: stack.slice(0, 800) });
    const safeMsg = (() => {
      if (!rawMsg) return '服务端异常，未获取到错误信息';
      if (/api.*url|404|ENOTFOUND|ECONNREFUSED|Failed to fetch|apiUrl/i.test(rawMsg)) return 'AI 接口地址错误或不可达，请检查【API设置】中的接口URL';
      if (/401|403|unauthorized|invalid.*key|apiKey/i.test(rawMsg)) return 'AI 接口鉴权失败（401/403），请检查【API设置】中的密钥或模型权限';
      if (/429|rate.*limit|too.*many.*requests/i.test(rawMsg)) return 'AI 接口触发限流（429），请稍后重试或降低并发';
      if (/timeout|aborted|timed? *out/i.test(rawMsg)) return 'AI 推理超时（>6 分钟），请尝试缩短钩子或稍后重试';
      if (/5\d{2}|server.*error|upstream/i.test(rawMsg) || /AI 接口错误:/.test(rawMsg)) return rawMsg.slice(0, 220);
      if (/章节|钩子|创意|structure|idea/i.test(rawMsg)) return rawMsg.slice(0, 240);
      return rawMsg.slice(0, 240);
    })();
    return new Response(JSON.stringify({ error: safeMsg, detail: stack ? stack.slice(0, 500) : undefined }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
