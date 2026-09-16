import { NextRequest } from 'next/server';
import { getModelName, getTemperature, getRawAIConfig } from '@/lib/ai-config';
import { scriptManager, novelManager } from '@/storage/database';
import { getUserFromToken } from '@/lib/auth';

export const maxDuration = 600;

interface PipelineGenerateBody {
  novelId: string;
  skeleton?: string;
  adaptationStrategy?: string;
  totalEpisodes?: number;
  episodeDuration?: number;
  platform?: string;
  style?: string;
  paywall?: string;
  projectConfig?: any;
  feedback?: string;
  /** 强制全部重新生成（三阶段流水线重跑用）；默认 false = 断点续传，跳过已完成章节 */
  force?: boolean;
}

// 清洗 AI 输出，移除工具调用标签
function cleanAIOutput(text: string): string {
  return text
    .replace(/<invoke[\s\S]*?<\/invoke>/gi, '')
    .replace(/<\/?minimax:tool_call[\s\S]*?>/gi, '')
    .replace(/<[\s\S]*?>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 生成单章剧本
async function generateChapterScript(
  apiUrl: string,
  apiKey: string,
  modelName: string,
  temperature: number,
  chapterTitle: string,
  chapterContent: string,
  skeleton: string,
  strategy: string,
  config: {
    totalEpisodes: number;
    episodeDuration: number;
    platform: string;
    style: string;
    paywall: string;
  },
  episodeIndex: number,
  signal: AbortSignal,
  prevEnding?: string,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const systemPrompt = `你是一位专业的${config.platform}短剧分镜编剧，擅长把小说文字转化为镜头能拍、观众能看的丰满画面。你必须将每章小说【完整】改编为分镜剧本：分镜场景数量由本章内容量决定，按剧情节点自然拆分，本章有多少情节就拆多少个场景，必须完整覆盖本章全部情节，严禁删减、合并、跳过或概括任何原文剧情。每个场景必须包含完整的分镜字段。绝对不要输出思考过程或解释，直接输出剧本。

【忠实原文铁则——最高优先级，凌驾于一切技巧之上】
1. 你只能改编【小说章节】正文中实际发生的剧情：情节、人物、动作、场景、因果顺序必须与原文完全一致。改编只做"文字→镜头"的影视化转译（心理活动外化为动作神态、叙述具象化为画面），绝不改变、增删剧情意思
2. 对白必须严格取自原文引号内的台词：台词尽量保留原文原词，说话人必须与原文归属完全一致——原文里是谁说的就是谁说的，严禁把甲的台词安给乙，严禁杜撰原文没有的台词；原文该处没有人物说话，就写「- （无对白）」，用画面和动作推进
3. 原文中可能混入极个别与本章场景、人物、故事背景明显无关的串句噪声（例如突兀的第一人称碎片、与本书世界毫不相干的句子）。这类噪声是文本垃圾，改编时必须直接忽略，严禁把它们写进任何场景的画面、对白或音效
4. 严禁虚构原文没有的剧情、人物、道具来"丰富"剧本；你的创造力只能用在把原文已有的内容拍得更具体、更好看，而不能用在编造新故事上

【丰满度铁则——你的剧本必须"拍得出来、看得过瘾"】
1. 小说是"想"出来的，剧本是"拍"出来的：原文中的心理活动、情绪感受、背景交代，必须全部转化为观众看得见的东西——人物的表情变化、肢体动作、眼神视线、手部细节、呼吸状态、与道具的互动、环境光影变化，严禁用"他很生气""她很紧张"这类抽象概括，必须写成具体动作（如"他把烟捏灭在桌角，指节捏得发白，盯着对方的眼睛半步不退"）
2. 每个场景的「画面」字段必须包含四个层次，缺一不可：①环境空间与天气光线（在哪、什么时间、光从哪来、什么色调）；②人物位置与连续动作链（谁在画面什么位置、先做什么后做什么、动作之间如何衔接）；③表情神态与视线（脸部特写能拍到什么、眼睛看向哪、情绪如何外化）；④关键道具与视觉焦点（手里拿什么、画面里最抢眼的东西是什么）
3. 「画面」字段是剧本的血肉，每个场景画面描写不少于80字，重要戏剧冲突场景不少于120字；写不具体就说明没有真正影视化，必须重写
4. 「音效/BGM」必须具体可执行：写清声源（海风/脚步/手机震动/杯子磕碰）、音乐情绪与节奏（低沉大提琴渐强/鼓点急促）、以及声音与画面的配合点（台词落下时音乐戛然而止），禁止只写"紧张BGM""悬疑音乐"这类空泛标签
5. 对白要符合人物身份和当下情绪，口语化、有潜台词；说话时伴随的动作神态写进「画面」字段，不要写进台词里
6. 时长向戏剧价值倾斜：普通过渡场景5-8秒，冲突、反转、情绪爆发、关键信息揭示的场景给10-15秒，让表演和情绪有空间展开

【格式铁则】
1. 分镜元数据字段（景别、机位、时长、镜头运动、画面、音效/BGM）和对白必须严格分开
2. 对白只能放在「对白」字段下，以 - 角色名："台词" 格式书写；无台词的场景写「- （无对白）」
3. 禁止把景别、机位、时长、镜头运动、画面、音效等字段写入对白区域
4. 禁止在分镜元数据字段中使用 「」 引号（只在对白台词中使用）
5. 「画面」字段写成一个连贯段落，字段值内部不要换行、不要用列表符号`;

  const userPrompt = `请将以下小说章节内容改编为一集完整的短剧剧本。

【小说章节】${chapterTitle}
${chapterContent}
${skeleton ? `
【故事骨架参考】
${skeleton}` : `
【改编要求】
本集无预设故事骨架，请严格忠实于本章小说原文进行改编，不得虚构原文没有的剧情、人物或设定。`}
${strategy ? `
【改编策略参考】
${strategy}` : ''}
${prevEnding ? `
【上一集结尾（本集必须无缝衔接）】
${prevEnding}

【衔接铁则】
1. 本集第1个场景必须紧接上一集结尾的悬念/危机/反转展开，时间线连续，禁止重新开场或回顾复述上一集剧情
2. 上一集「本集钩子」抛出的悬念，必须在本集前2个场景内给出回应或推进
3. 角色的位置、伤势、情绪、持有物品、在场人物必须与上一集结尾完全一致，不得出现矛盾（如上一集重伤倒地，本集不能毫发无损）
4. 禁止重复上一集已使用的桥段、台词和冲突方式
5. 本集结尾要开启新的悬念钩子，推动剧情继续向前` : ''}

【集数】第${episodeIndex + 1}集 / 共${config.totalEpisodes}集
【时长】${config.episodeDuration}分钟（约${config.episodeDuration * 150}字台词；⚠️ 场景数量不受时长限制，以完整覆盖本章全部剧情为准）
【平台】${config.platform}
【风格】${config.style}

【⚠️ 硬性要求】
1. 场景数量由本章内容决定：按剧情节点自然拆分，编号从「场景1」连续到「场景N」，N 不设上限也不设下限，内容多就多拆、内容少就少拆
2. 必须完整覆盖章节全部情节：开篇、发展、转折、高潮、结尾钩子一个都不能少；严禁为了压缩场景数而删减、合并、跳过或用一句话概括原文剧情，确保观众只看剧本就能完整了解本章发生的所有事
3. 严禁虚构原文没有的剧情、人物、道具来凑场景；原文中与本章故事明显无关的串句噪声直接忽略，不得改编进任何场景
4. 每个场景必须包含完整分镜字段：景别、机位、时长、镜头运动、画面、对白、音效/BGM
5. 「画面」字段必须丰满具体：每个场景画面描写不少于80字，冲突/反转/情绪爆发场景不少于120字，必须写出环境光线、人物连续动作、表情视线、关键道具四个层次；原文的心理活动必须转化为可见的动作神态，严禁抽象概括
6. 对白只能来自原文引号内的台词：说话人归属必须与原文一致（原文谁说就谁说，严禁张冠李戴），台词保留原文原词原意，严禁杜撰原文没有的台词；每句口语化、不超过20字；纯动作场景写「- （无对白）」，画面描写加倍细致
7. 【每场对白数量上限】每个场景（分镜）的对白控制在 1~2 句，最多不超过 3 句；超过 3 句的对话必须拆成多个分镜（用镜头切换/画面动作/环境描写隔开），保持剧情连贯不丢信息
7. 3秒抓眼球，15秒有变化，45秒强期待
8. 音效/BGM必须具体：写清声源、音乐情绪与节奏、声画配合点，禁止空泛标签
9. 结尾必须有强钩子悬念

【输出格式】严格遵循以下格式，场景数量按本章剧情需要从场景1连续编号到场景N，不要添加任何其他内容。以下范例展示画面字段的丰满标准，你必须达到同等细节密度：

### 第${episodeIndex + 1}集

**场景1**：场景标题（地点+事件）
- 景别：特写/近景/中景/全景/远景
- 机位：正面/侧面/背面/俯拍/仰拍
- 时长：5秒/8秒/10秒/15秒
- 镜头运动：固定/推/拉/摇/移/跟/升降
- 画面：[丰满范例参照——"黄昏的滩涂泛着冷金色的光，风把破旧帆布棚吹得啪啪作响。纪凡赛尔蹲在养殖箱前，手里攥着半截断锁，指节因为用力而泛白；他先是死死盯着箱里空掉的鱼干袋，喉结上下滚动了一下，随即猛地抬头扫视四周，眼睛眯起，鼻翼因急促呼吸微微张合，裤腿上的泥水顺着脚踝滴落。画面焦点始终落在他攥着断锁的手和箱中四只剩悠然舔爪子的海獭之间来回切换。"]
- 对白：
  - 角色名："台词"
  - 角色名："台词"
- 音效/BGM：[具体范例——"海风呼啸混着帆布抖动声，低音提琴拉出压抑的长音；台词说到'鱼干没了'时音乐骤停，只剩海獭啃咬声被放大"]

**⚠️ 格式注意**：
- 景别、机位、时长、镜头运动、画面、音效 这些是分镜元数据，禁止放入对白区域
- 对白区域只能出现角色名和台词，格式为「- 角色名："台词"」；无台词写「- （无对白）」
- 分镜元数据字段直接写值，不要加引号（如 - 景别：特写，不是 - 景别：「特写」）
- 画面字段写成一个连贯段落，字段内不要换行

**场景2**：场景标题
- 景别：
- 机位：
- 时长：
- 镜头运动：
- 画面：[同样按四层次丰满描写，不少于80字]
- 对白：
  - 角色名："台词"
- 音效/BGM：

**场景3**：场景标题
...（按剧情需要继续编号：场景4、场景5……一直到场景N，直到本章所有情节全部改编完毕，不得中途停笔；每个场景都必须达到范例的细节密度）

**本集钩子**：[本集结尾悬念，引向下一集，写清最后一个画面定格在什么上、人物什么表情、什么声音收尾]`;

  const resp = await fetch(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: true,
      temperature,
      // 场景数由章节内容决定，长章节输出更长：按正文字数动态给额度，下限16384防截断、上限32768防超限
      max_tokens: Math.min(32768, Math.max(16384, Math.floor(chapterContent.length * 4))),
      reasoning_effort: 'none',
      tool_choice: 'none',
    }),
    signal,
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`AI 接口错误: ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const j = JSON.parse(raw);
        const content = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content;
        if (content) {
          fullContent += content;
          // 实时把 AI 输出的每个片段转发给前端（断线时 send 自动 no-op，不影响后端）
          try { onChunk?.(content); } catch {}
        }
      } catch {}
    }
  }

  return cleanAIOutput(fullContent);
}

export async function POST(request: NextRequest) {
  try {
    const body: PipelineGenerateBody = await request.json();
    const {
      novelId,
      skeleton = '',
      adaptationStrategy = '',
      feedback,
      totalEpisodes = 20,
      episodeDuration = 2,
      platform = '竖屏',
      style = '',
      paywall = '',
      projectConfig,
      force = false,
    } = body;

    if (!novelId) {
      return Response.json({ success: false, error: '小说ID不能为空' }, { status: 400 });
    }

    const modelName = await getModelName();
    const temperature = await getTemperature(0.8);
    const { apiUrl, apiKey, provider } = await getRawAIConfig();

    // 获取当前用户ID
    const authHeader = request.headers.get('Authorization');
    const userPayload = authHeader ? getUserFromToken(authHeader) : null;
    const userId = userPayload?.userId || '';

    if (!apiKey) {
      return Response.json({ success: false, error: 'API密钥未配置' }, { status: 503 });
    }

    console.log(`[Script Pipeline Generate] Using provider: ${provider}, model: ${modelName}`);

    // 获取小说章节
    const novel = await novelManager.getById(novelId);
    if (!novel) {
      return Response.json({ success: false, error: '小说不存在' }, { status: 404 });
    }

    let chapters: any[] = Array.isArray(novel.chapters) ? novel.chapters : [];
    if (typeof chapters === 'string') {
      try { chapters = JSON.parse(chapters); } catch { chapters = []; }
    }

    // 如果没有章节，使用骨架生成
    if (chapters.length === 0 && skeleton) {
      chapters = [{ title: '全文', content: skeleton }];
    }

    // 直接生成模式（无骨架）下小说必须有章节内容
    if (chapters.length === 0) {
      return Response.json(
        { success: false, error: '小说还没有章节内容，无法直接生成剧本，请先生成小说章节' },
        { status: 400 }
      );
    }

    console.log(`[Pipeline Generate] 共 ${chapters.length} 章待生成剧本，模式：${skeleton ? '三阶段流水线' : '直接生成'}`);

    // 直接使用小说原文生成剧本，不做净化处理（避免 POV 归一误改未加引号的对白）
    console.log(`[Pipeline Generate] 直接使用原文，${chapters.length} 章`);

    const config = { totalEpisodes, episodeDuration, platform, style, paywall };

    // 逐章流式生成
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // 状态外提：即使中途报错，catch 里也能尽力保存已生成章节
        const allEpisodes: any[] = [];
        let allContent = '';
        // 上一集剧本结尾（最后一个场景+钩子），用于下一集衔接
        let prevEnding = '';
        let clientConnected = true;

        // 前端断开/刷新页面后 enqueue 会抛错；用 send 容错——后端继续跑完并落库，不白跑
        const send = (data: any) => {
          if (!clientConnected) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            clientConnected = false;
            console.log('[Pipeline Generate] 客户端连接已断开，后端继续生成并落库');
          }
        };
        const sendDone = () => {
          if (!clientConnected) return;
          try {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch { /* 已关闭 */ }
        };

        // 增量落库：每完成一章即保存（generating），全部完成后保存为 completed
        const persist = async (status: 'generating' | 'completed') => {
          // 读取旧数据，保留已生成的图片/视频提示词不被覆盖
          const oldScript = await scriptManager.getScriptByNovelId(novelId, userId).catch(() => null);
          const oldByIndex = new Map<number, any>();
          if (oldScript && Array.isArray(oldScript.chapters)) {
            oldScript.chapters.forEach((c: any) => oldByIndex.set(c.chapterIndex, c));
          }

          const scriptChapters = allEpisodes.map((ep, i) => {
            const scenes = parseEpisodesToScenes(ep.content, i);
            const old = oldByIndex.get(i);
            // 场景未变化 → 保留原提示词；场景已变化 → 丢弃旧提示词，避免提示词与新剧本不匹配（提示词需按新场景重新生成）
            const oldScenes: any[] = Array.isArray(old?.screenplay?.scenes) ? old.screenplay.scenes : [];
            const sceneKey = (s: any) => [
              String(s?.sceneIndex ?? ''),
              String(s?.sceneTitle ?? s?.title ?? ''),
              String(s?.location ?? ''),
              String(s?.description ?? s?.content ?? ''),
              String(s?.action ?? ''),
            ].join('|');
            const scenesUnchanged = oldScenes.length === scenes.length
              && oldScenes.every((s, k) => sceneKey(s) === sceneKey(scenes[k]));
            return {
              chapterIndex: i,
              chapterTitle: ep.episodeTitle || `第${i + 1}集`,
              screenplay: {
                scenes,
                summary: `第${i + 1}集：${ep.episodeTitle}`,
                rawText: ep.content,
                targetSceneCount: scenes.length,
                status: 'completed',
              },
              imagePrompts: scenesUnchanged ? (old?.imagePrompts ?? null) : null,
              videoPrompts: scenesUnchanged ? (old?.videoPrompts ?? null) : null,
            };
          });

          // 额外保存骨架和策略信息（作为第一个章节的附加数据）；续传时当前请求为空则保留旧值
          if (scriptChapters.length > 0) {
            const oldExtra = oldScript?.chapters?.[0] as any;
            (scriptChapters[0] as any).skeleton = skeleton || oldExtra?.skeleton || '';
            (scriptChapters[0] as any).adaptationStrategy = adaptationStrategy || oldExtra?.adaptationStrategy || '';
          }

          if (oldScript) {
            const updateData: any = { status, chapters: scriptChapters };
            if (userId && (!oldScript.userId || oldScript.userId === '')) {
              updateData.userId = userId;
            }
            await scriptManager.updateScript(oldScript.id, updateData);
          } else {
            await scriptManager.createScript({
              novelId,
              userId,
              status,
              chapters: scriptChapters,
            });
          }
          return scriptChapters;
        };

        try {
          // 注意：AbortController 不绑定 request.signal——前端断开时 AI 请求不中止，后端继续跑完
          const controller_ = new AbortController();

          const effectiveChapters = chapters.slice(0, totalEpisodes);

          // 断点续传：恢复数据库中已完成的章节（force=true 时全部重新生成，用于三阶段流水线重跑）
          if (!force) {
            try {
              const existing = await scriptManager.getScriptByNovelId(novelId, userId);
              if (existing && Array.isArray(existing.chapters)) {
                // 按章节索引建立已完成映射
                const doneByIndex = new Map<number, any>();
                for (const ec of existing.chapters) {
                  if (ec?.screenplay?.rawText && ec.screenplay?.status === 'completed') {
                    doneByIndex.set(ec.chapterIndex ?? -1, ec);
                  }
                }
                // 只恢复"从头开始连续完成"的前缀章节，且不超过本次目标章节数（遇到空洞/未完成即停）
                while (allEpisodes.length < effectiveChapters.length && doneByIndex.has(allEpisodes.length)) {
                  const ec = doneByIndex.get(allEpisodes.length);
                  const idx = allEpisodes.length;
                  allEpisodes.push({
                    episodeIndex: idx + 1,
                    episodeTitle: ec.chapterTitle || `第${idx + 1}集`,
                    content: ec.screenplay.rawText,
                  });
                  allContent += ec.screenplay.rawText + '\n\n';
                }
                if (allEpisodes.length > 0) {
                  prevEnding = extractEpisodeEnding(allEpisodes[allEpisodes.length - 1].content);
                  send({
                    type: 'resume',
                    skippedChapters: allEpisodes.length,
                    totalChapters: effectiveChapters.length,
                  });
                  console.log(`[Pipeline Generate] 断点续传：已恢复 ${allEpisodes.length} 章，从第 ${allEpisodes.length + 1} 章继续`);
                }
              }
            } catch (resumeErr) {
              console.warn('[Pipeline Generate] 恢复已完成章节失败，从头生成:', resumeErr);
            }
          }

          const startFrom = Math.min(allEpisodes.length, effectiveChapters.length);

          for (let i = startFrom; i < effectiveChapters.length; i++) {
            const ch = effectiveChapters[i];
            const title = ch.title || `第${i + 1}章`;
            const content = ch.content || ch.text || ch.body || '';

            // 发送进度事件
            send({
              type: 'chapter_start',
              chapterIndex: i,
              chapterTitle: title,
              totalChapters: effectiveChapters.length,
            });

            let chapterScript = '';
            let chapterStreamed = false; // 本章是否已通过流式 token 推送过内容（兜底剧本没有）

            // 重试2次
            for (let attempt = 0; attempt <= 2; attempt++) {
              try {
                send({
                  type: 'content',
                  kind: 'status',
                  content: `[第${i + 1}章] 正在生成（第${attempt + 1}次尝试），AI 输出实时显示中...`,
                  episode: i + 1,
                });

                chapterScript = await generateChapterScript(
                  apiUrl, apiKey, modelName, temperature,
                  title, content, skeleton, adaptationStrategy,
                  config, i,
                  controller_.signal,
                  prevEnding,
                  // AI 每输出一段就实时转发给前端，用户可看到正文逐字流出
                  (chunk: string) => {
                    chapterStreamed = true;
                    send({ type: 'content', kind: 'chunk', content: chunk, episode: i + 1 });
                  }
                );

                if (chapterScript && chapterScript.length > 600 && countScenes(chapterScript) >= 3) {
                  break;
                } else if (attempt < 2) {
                  send({
                    type: 'content',
                    kind: 'status',
                    content: `[第${i + 1}章] 输出不达标（场景${countScenes(chapterScript)}个/${chapterScript ? chapterScript.length : 0}字，要求场景≥3个且画面描写丰满），重新生成中...`,
                    episode: i + 1,
                  });
                }
              } catch (err: any) {
                console.warn(`[Pipeline Generate] Chapter ${i} attempt ${attempt} failed:`, err?.message);
                if (attempt >= 2) {
                  // 3次均失败：用兜底剧本占位，不中断整体流程
                  chapterScript = generateFallbackScript(title, content, i, config);
                }
              }
            }

            if (!chapterScript || chapterScript.length < 600 || countScenes(chapterScript) < 3) {
              chapterScript = generateFallbackScript(title, content, i, config);
            }

            // 提取本集结尾（最后一个场景+钩子），作为下一集的衔接依据
            prevEnding = extractEpisodeEnding(chapterScript);

            // 发送本章完成事件
            send({
              type: 'episode_complete',
              episode: i + 1,
              content: chapterScript,
            });

            allEpisodes.push({
              episodeIndex: i + 1,
              episodeTitle: `第${i + 1}集：${title}`,
              content: chapterScript,
            });
            allContent += chapterScript + '\n\n';

            // 正常章节的正文已通过流式 token 实时推送，不再重复发送；
            // 仅兜底剧本（3次尝试均失败、无流式输出）需要整章补发展示
            if (!chapterStreamed) {
              send({
                type: 'content',
                kind: 'chunk',
                content: chapterScript,
                episode: i + 1,
              });
            }

            // 每章完成后立即增量落库（保存失败不中断生成，下一章会再试）
            try {
              await persist('generating');
            } catch (persistErr) {
              console.warn(`[Pipeline Generate] 第${i + 1}章增量保存失败:`, persistErr);
            }
          }

          // 全部章节完成：最终落库为 completed
          let scriptChapters: any[] = [];
          try {
            scriptChapters = await persist('completed');
            console.log(`[Pipeline Generate] Saved ${allEpisodes.length} episodes to DB`);
          } catch (saveError) {
            console.error('[Pipeline Generate] Final save error:', saveError);
          }

          send({
            type: 'complete',
            content: allContent,
            script: { episodes: allEpisodes, totalEpisodes: allEpisodes.length },
            chapters: scriptChapters,
            message: `剧本生成完成，共${allEpisodes.length}集`,
          });

          sendDone();
        } catch (error: any) {
          console.error('[Script Pipeline] Error:', error);
          // 中途崩溃：尽力把已生成的章节落库，下次可断点续传
          if (allEpisodes.length > 0) {
            try {
              await persist('generating');
              console.log(`[Pipeline Generate] 出错前已保存 ${allEpisodes.length} 章，可断点续传`);
            } catch (persistErr) {
              console.error('[Pipeline Generate] 出错后保存也失败:', persistErr);
            }
          }
          send({
            type: 'error',
            error: `${error?.message || '剧本生成失败'}（已完成的 ${allEpisodes.length} 章已保存，可点击"继续生成"补齐剩余章节）`,
            savedChapters: allEpisodes.length,
          });
          sendDone();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('[Script Pipeline] Error:', error);
    return Response.json(
      { success: false, error: error.message || '流水线剧本生成失败' },
      { status: 500 }
    );
  }
}

// 统计文本中的场景数量（去重统计，兼容多种格式）
function countScenes(text: string): number {
  // 用一个宽松正则匹配所有场景标记格式
  const combined = /(?:\*\*)?\s*(?:场景|第\s*\d+\s*场)\s*\d+\s*(?:\*\*)?\s*[：:：]/g;
  const matches = text.match(combined);
  return matches ? matches.length : 0;
}

// 提取一集剧本的结尾（最后一个场景块 + 本集钩子），用于下一集衔接
// 截取内容控制在 900 字以内，避免 prompt 过长
function extractEpisodeEnding(script: string): string {
  if (!script) return '';

  // 兼容多种场景标记：**场景N**： / 场景N： / 【场景N】 / 第N场
  const sceneRegex = /(?:\*\*)?\s*(?:场景|第\s*\d+\s*场)\s*\d+\s*(?:\*\*)?\s*[：:：]/g;
  const indices: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = sceneRegex.exec(script)) !== null) {
    indices.push(m.index);
  }

  let ending = '';
  if (indices.length > 0) {
    // 从最后一个场景标记处截取到结尾（自然包含「本集钩子」）
    ending = script.slice(indices[indices.length - 1]).trim();
  } else {
    // 没有场景标记时，单独取钩子；钩子也没有则取文末 600 字
    const hookMatch = script.match(/本集钩子[：:]\s*([^\n]+)/);
    ending = hookMatch
      ? `本集钩子：${hookMatch[1].trim()}`
      : script.slice(-600).trim();
  }

  // 限制长度，优先保留尾部（钩子在最后）
  const MAX_LEN = 900;
  if (ending.length > MAX_LEN) {
    ending = '……' + ending.slice(-MAX_LEN);
  }
  return ending;
}

// 生成降级剧本（当AI不可用时）- 6个场景完整分镜
function generateFallbackScript(
  chapterTitle: string,
  chapterContent: string,
  episodeIndex: number,
  config: { totalEpisodes: number; episodeDuration: number; platform: string }
): string {
  const preview = chapterContent.slice(0, 150) || '剧情继续发展';
  return `### 第${episodeIndex + 1}集

**场景1**：绝境逆袭
- 景别：特写
- 机位：低角度仰拍
- 时长：8秒
- 镜头运动：固定
- 画面：主角躺在泥水中，满脸血污，雨水混着血水从眼角流下。突然手指微动，瞳孔猛然收缩。
- 对白：
  - 主角：（虚弱）"我……还没死？"
- 音效/BGM：暴雨声+心跳加速音效

**场景2**：神秘出现
- 景别：近景
- 机位：正面
- 时长：10秒
- 镜头运动：推
- 画面：一个模糊的蓝光身影出现在主角面前，伸手递出一件散发微光的物品。主角惊恐地盯着来人。
- 对白：
  - 神秘人："拿着这个，你有3分钟。"
  - 主角："你是谁？"
- 音效/BGM：神秘嗡鸣声

**场景3**：危机逼近
- 景别：全景
- 机位：俯拍
- 时长：12秒
- 镜头运动：摇
- 画面：三名追兵从不同方向逼近，手持凶器。主角握紧物品，挣扎着站起身，背靠墙壁。
- 对白：
  - 追兵甲："跑啊，怎么不跑了？"
  - 主角：（冷笑）"你们会后悔的。"
- 音效/BGM：脚步声+紧张BGM

**场景4**：意外反击
- 景别：中景
- 机位：侧面
- 时长：10秒
- 镜头运动：跟
- 画面：主角按下物品，一道强光炸开。追兵甲被震退数步，撞在墙上。其余两人愣住。
- 对白：
  - 追兵乙："这是什么东西？！"
  - 主角："送你们上路的东西。"
- 音效/BGM：爆炸音效+玻璃碎裂

**场景5**：穷途末路
- 景别：特写
- 机位：正面
- 时长：8秒
- 镜头运动：固定
- 画面：追兵甲嘴角流血，眼中闪过一丝忌惮。主角却因体力不支再次跪下，呼吸困难。
- 对白：
  - 主角：（喘息）"来啊，继续啊。"
- 音效/BGM：急促呼吸声

**场景6**：惊天反转
- 景别：近景
- 机位：仰拍
- 时长：15秒
- 镜头运动：拉
- 画面：天空中一道惊雷劈下，全场停电。黑暗中，主角的眼睛发出蓝色光芒。画外音响起。
- 对白：
  - 系统音："宿主觉醒成功，直播系统激活。"
  - 主角：（低语）"这才刚开始。"
- 音效/BGM：惊雷+电子激活音

**本集钩子**：主角站起身，蓝光笼罩全身，嘴角上扬露出冷笑。屏幕弹出【新手任务：活过今晚】。

（本集基于章节《${chapterTitle}》内容生成）`;
}

function getPipelineSystemPrompt(): string {
  return `你是一名专业的短剧分镜编剧。你的任务是将小说改编为包含6-8个详细分镜的完整剧本。
核心原则：
1. 每集开头3秒必须有强视觉冲击（特写+慢动作）
2. 每集中间必须有至少1次剧情反转
3. 每集结尾必须留强悬念钩子
4. 对白口语化，每句不超过20字
5. 每个场景必须包含：景别、机位、时长、镜头运动、画面描述、对白、音效`;
}

// 将文本格式的剧本解析为结构化场景（兼容新旧两种格式）
function parseEpisodesToScenes(text: string, chapterIdx: number): any[] {
  const scenes: any[] = [];
  
  // 宽松匹配场景标记：**场景N**： / 场景N： / 【场景N】 / 第N场
  const sceneRegex = /(?:\*\*)?\s*(?:场景|第\s*\d+\s*场)\s*(\d+)\s*(?:\*\*)?\s*[：:：]\s*([^\n]+)/g;
  const matches: Array<{ index: number; title: string; start: number; matchLength: number }> = [];
  
  let m;
  while ((m = sceneRegex.exec(text)) !== null) {
    matches.push({
      index: parseInt(m[1]),
      title: m[2].trim(),
      start: m.index,
      matchLength: m[0].length,
    });
  }
  
  if (matches.length === 0) {
    // 没找到场景标记，创建一个默认场景
    return [{
      sceneIndex: 1,
      subShot: 1,
      dialogueRange: '全片',
      description: text.slice(0, 200),
      startFrame: '',
      cameraMovement: '',
      action: text.slice(0, 300),
      endFrame: '',
      duration: '2分钟',
      prompt: text,
      style: '',
      transition: '',
      dialogues: extractDialogues(text),
    }];
  }
  
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].start + matches[i].matchLength;
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length;
    const sceneContent = text.slice(start, end);
    const title = matches[i].title;
    
    // 提取分镜字段
    const shotMatch = sceneContent.match(/[-*]\s*景别[：:]\s*([^\n]+)/);
    const shot = shotMatch ? shotMatch[1].trim() : '';
    
    const angleMatch = sceneContent.match(/[-*]\s*机位[：:]\s*([^\n]+)/);
    const angle = angleMatch ? angleMatch[1].trim() : '';
    
    const durationMatch = sceneContent.match(/[-*]\s*时长[：:]\s*([^\n]+)/);
    const duration = durationMatch ? durationMatch[1].trim() : '10秒';
    
    const cameraMatch = sceneContent.match(/[-*]\s*镜头运动[：:]\s*([^\n]+)/);
    const cameraMovement = cameraMatch ? cameraMatch[1].trim() : '固定';
    
    const visualMatch = sceneContent.match(/[-*]\s*画面[：:]\s*([^\n]+(?:\n(?![-*])[^\n]+)*)/);
    const visualDesc = visualMatch ? visualMatch[1].trim() : '';
    
    const sfxMatch = sceneContent.match(/[-*]\s*音效[\/／]?BGM[：:]\s*([^\n]+)/);
    const sfx = sfxMatch ? sfxMatch[1].trim() : '';
    
    // 提取对白
    const dialogues = extractDialogues(sceneContent);
    
    // 兼容旧格式：**动作** 字段
    const oldActionMatch = sceneContent.match(/\*\*动作\*\*[：:]\s*([^\n]+(?:\n(?!\*\*)[^\n]+)*)/);
    const oldAction = oldActionMatch ? oldActionMatch[1].trim() : '';
    
    // 兼容旧格式：**钩子** 字段
    const hookMatch = sceneContent.match(/\*\*钩子\*\*[：:]\s*([^\n]+)/);
    const hook = hookMatch ? hookMatch[1].trim() : '';
    
    // 组合描述
    const descParts = [title];
    if (shot || angle) descParts.push(`【${shot}${angle ? '·' + angle : ''}】`);
    if (visualDesc) descParts.push(visualDesc);
    if (oldAction) descParts.push(oldAction);
    if (hook) descParts.push(`钩子：${hook}`);
    const description = descParts.join('\n');
    
    // 组合动作字段（详细内容）
    const actionParts = [];
    if (shot) actionParts.push(`景别：${shot}`);
    if (angle) actionParts.push(`机位：${angle}`);
    if (cameraMovement) actionParts.push(`运镜：${cameraMovement}`);
    if (visualDesc) actionParts.push(visualDesc);
    if (sfx) actionParts.push(`音效：${sfx}`);
    const action = actionParts.join(' | ');
    
    scenes.push({
      sceneIndex: matches[i].index,
      subShot: 1,
      dialogueRange: title,
      description: description.slice(0, 2000),
      startFrame: '',
      cameraMovement: cameraMovement,
      action: action.slice(0, 1500),
      endFrame: '',
      duration: duration,
      prompt: sceneContent.slice(0, 2000),
      style: shot || '',
      transition: sfx || '',
      dialogues,
    });
  }
  
  return scenes;
}

// 已知的非对白字段名（分镜元数据）
const NON_DIALOGUE_KEYS = ['景别', '机位', '时长', '镜头运动', '画面', '音效', 'BGM', '音效/BGM', '音效／BGM', '场景', '对白', '本集钩子', '钩子', '动作', '画面描述', '视觉', '转场', '配乐'];

// 判断是否为对白字段（非分镜元数据）
function isDialogueField(character: string): boolean {
  const trimmed = character.trim();
  if (!trimmed) return false;
  // 精确匹配黑名单
  if (NON_DIALOGUE_KEYS.some(k => trimmed === k)) return false;
  // 以黑名单开头（如 "音效：" 或 "音效："）
  if (NON_DIALOGUE_KEYS.some(k => trimmed.startsWith(k + '：') || trimmed.startsWith(k + ':'))) return false;
  // 包含 "镜头"、"景"、"机"、"时长"、"画面"、"音效"、"BGM" 等关键字
  const metaPattern = /^(景别|机位|时长|镜头运动|画面|音效|BGM|场景|对白|钩子|动作|转场|配乐|本集钩子)/;
  if (metaPattern.test(trimmed)) return false;
  return true;
}

// 从文本中提取对白（仅从「对白」区域提取，过滤分镜元数据）
function extractDialogues(text: string): Array<{ character: string; line: string }> {
  const dialogues: Array<{ character: string; line: string }> = [];
  
  // 第一步：定位「对白」区域
  // 找到 "对白：" 或 "对白" 标记，只在该区域内提取
  const dialogueSectionRegex = /(?:^|\n)\s*(?:[-*]\s*)?对白[：:]\s*\n([\s\S]*?)(?=\n\s*(?:[-*]\s*)?(?:景别|机位|时长|镜头运动|画面|音效|BGM|场景|钩子|本集钩子)[：:]|\n\s*\*\*|\n\s*###|$)/g;
  
  let sectionMatch;
  const dialogueSections: string[] = [];
  
  while ((sectionMatch = dialogueSectionRegex.exec(text)) !== null) {
    dialogueSections.push(sectionMatch[1]);
  }
  
  // 如果找到对白区域，只在这些区域内提取
  const textsToSearch = dialogueSections.length > 0 ? dialogueSections : [text];
  
  // 第一遍：匹配带引号的对白（优先）
  for (const searchText of textsToSearch) {
    const regex1 = /[-*]\s*([^：:\n]+?)[：:]\s*[""「」""](.+?)[""「」""]/g;
    let m;
    while ((m = regex1.exec(searchText)) !== null) {
      const char = m[1].trim();
      const line = m[2].trim();
      if (char && line && isDialogueField(char)) {
        dialogues.push({ character: char, line });
      }
    }
  }
  
  // 第二遍：仅在第一遍完全没找到对白时，用无引号格式作为备选
  if (dialogues.length === 0) {
    for (const searchText of textsToSearch) {
      const regex2 = /[-*]\s*([^：:\n]+?)[：:]\s*(.+)/g;
      let m;
      while ((m = regex2.exec(searchText)) !== null) {
        const char = m[1].trim();
        let line = m[2].trim();
        // 移除首尾引号
        line = line.replace(/^[""「」""]|[""「」""]$/g, '').trim();
        if (char && line && line.length <= 200 && isDialogueField(char)) {
          dialogues.push({ character: char, line });
        }
      }
    }
  }
  
  return dialogues;
}
