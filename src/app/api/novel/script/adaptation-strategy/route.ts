import { NextRequest } from 'next/server';
import { getModelName, getTemperature, getRawAIConfig } from '@/lib/ai-config';
import { appendAgentSkillPrompt } from '@/lib/agent-skills';
import { getPromptWithFallback } from '@/lib/prompt-helper';
import { scriptManager } from '@/storage/database';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      novelId,
      skeleton,
      chapters,
      feedback,
      totalEpisodes = 20,
      genre = '',
      tone = '',
      startChapter = 1,
      endChapter = 0,
      platform = '竖屏',
      style = '',
      paywall = '',
    } = body;

    if (!novelId || !skeleton) {
      return Response.json(
        { success: false, error: '小说ID和故事骨架不能为空' },
        { status: 400 }
      );
    }

    const modelName = await getModelName();
    const temperature = await getTemperature(0.6);
    const { apiUrl, apiKey, provider } = await getRawAIConfig();

    if (!apiKey) {
      return Response.json(
        { success: false, error: 'API密钥未配置' },
        { status: 503 }
      );
    }

    console.log(`[Script Adaptation] Using provider: ${provider}, model: ${modelName}`);

    // 构建章节全文摘要（不限制字数，小说内容多少就用多少）
    const chapterSummaries = chapters ? chapters.map((ch: any, idx: number) => {
      const content = ch.content || ch.summary || '';
      return `【第${idx + 1}章《${ch.title || '无标题'}》】\n${content}`;
    }) : [];

    // 实际章节范围
    const actualEndChapter = endChapter > 0 ? endChapter : (chapters?.length || 0);

    // 构建上下文
    const context = {
      genre,
      tone: Array.isArray(tone) ? tone.join(' ') : tone,
      platform,
      style,
      paywall,
      text: chapterSummaries.join('\n'),
    };

    // 获取系统提示词（整合Agent Skill）
    const baseSystemPrompt = await getPromptWithFallback('script-adaptation-system', getDefaultAdaptationPrompt(), context);
    const systemPrompt = appendAgentSkillPrompt('script-adaptation-system', baseSystemPrompt, context);

    // 构建用户提示词
    const userPrompt = `请基于以下故事骨架和章节内容，制定详细的改编策略。

【⚠️ 重要】直接输出改编策略正文，禁止任何前置应答（如"好的"、"我将"、"以下是"等），禁止思考过程。

【故事骨架】
${skeleton}

【小说信息】
- 题材：${genre || '未指定'}
- 基调：${tone || '未指定'}

【项目配置】
- 集数：${totalEpisodes}集
- 原著范围：第${startChapter}-${actualEndChapter}章
- 平台规格：${platform}
- 风格定位：${style || '未指定'}
- 付费策略：${paywall || '未指定'}

【章节内容】
${chapterSummaries.join('\n\n')}
${feedback ? `\n\n【上一轮审核反馈——本次必须修复以下问题】\n${feedback}\n` : ''}
请直接输出完整的改编策略，包含：
1. 核心改编原则（3-5条，必须包含 Toonflow 的三大密度和心理级爽点锁定）
2. 主要删除决策（按优先级排序，标注删减理由）
3. 世界观呈现策略（如何快速建立且不啰嗦）
4. 情绪基调映射（各类型情绪在本剧中的落点与比例）
5. 信息差策略设计（如何制造/消除信息差驱动剧情）
6. 股价级反转对齐（原骨架中每个反转的改编落地方式）`;

    // 调用AI
    async function* streamWithMaxTokens(
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
      temp: number,
      maxTokens: number
    ) {
      const TIMEOUT_MS = 120000;
      const resp = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: modelName,
          messages,
          stream: true,
          temperature: temp,
          max_tokens: maxTokens,
          reasoning_effort: 'none',
          tool_choice: 'none',
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
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
            const content = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content;
            if (content) yield { content };
          } catch {}
        }
      }
    }

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullContent = '';
          let chunkCount = 0;

          for await (const chunk of streamWithMaxTokens(messages, temperature, 16384)) {
            if (chunk.content) {
              fullContent += chunk.content;
              chunkCount++;

              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'content',
                    content: chunk.content,
                    chunkIndex: chunkCount,
                  })}\n\n`
                )
              );
            }
          }

          // 保存改编策略到数据库
          try {
            const savedStrategy = await scriptManager.saveAdaptationStrategy({
              novelId,
              skeleton,
              strategy: fullContent,
              genre,
              tone,
              totalEpisodes,
            });

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'complete',
                  content: fullContent,
                  strategyId: savedStrategy?.id,
                  message: '改编策略生成完成',
                })}\n\n`
              )
            );
          } catch (saveError) {
            console.error('[Script Adaptation] Save error:', saveError);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'complete',
                  content: fullContent,
                  message: '改编策略生成完成（保存失败）',
                })}\n\n`
              )
            );
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error: any) {
          console.error('[Script Adaptation] Error:', error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'error',
                error: error.message || '生成失败',
              })}\n\n`
            )
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
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
    console.error('[Script Adaptation] Error:', error);
    return Response.json(
      { success: false, error: error.message || '改编策略生成失败' },
      { status: 500 }
    );
  }
}

function getDefaultAdaptationPrompt(): string {
  return `你是一位专业的短剧改编策略专家，掌握 Toonflow 爆款短剧改编方法论，擅长将小说内容改编为具备爆款潜力的短剧剧本。

## 核心职责
1. 基于故事骨架制定改编原则
2. 对小说章节进行删减决策
3. 规划世界观呈现节奏
4. 设计信息差策略
5. 对齐股价级反转

## Toonflow 改编策略方法论

### 一、剧本改编8大核心要点
1. **强画面感**：所有保留内容须能转化为镜头语言，"能拍出来"是第一标准
2. **台词精简**：每句台词必须承载信息/情绪/人物关系，杜绝废话
3. **节奏极致快**：每个画面都在拉升情绪，没有"浪费"的镜头
4. **只沿主线展开**：完全摒弃多支线，聚焦核心冲突
5. **降低理解成本**：观众听台词即可掌握核心剧情，无需思考
6. **情绪大于一切**：情绪传递 > 信息传递 > 逻辑完美
7. **开篇给足期待感**：每个场景的开头都要让观众"想知道接下来会发生什么"
8. **展示不要告诉**：叙述/心理活动全部转化为可拍摄的动作、对白、环境暗示

### 二、类型创新与原创性（三条死路）
以下是改编的"三条死路"，必须规避：
1. **死路1：100%忠实原著**：原著的叙事节奏、心理描写、支线剧情不适合短剧，100%忠实等于自寻死路
2. **死路2：照搬爆款模板**：市场上已有大量"霸道总裁""重生甜宠"等模板，缺乏差异化必死
3. **死路3：忽视平台特性**：竖屏短剧 vs 横屏短剧的呈现逻辑完全不同，忽视平台等于浪费资源
- 创新方向：在保留原著核心吸引力的基础上，找到"人无我有"的差异化卖点

### 三、心理级爽点锁定
- 每个保留的爽点场景，必须锁定：**爽点类型 + 触发时机 + 观众心理预期曲线**
- 爽点类型：打脸爽 / 逆袭爽 / 独占爽 / 成长爽 / 复仇爽 / 爱情爽
- 每个爽点必须标注"观众在第几秒开始期待、第几秒爆发、爆发后持续几秒"
- 单集至少1个微爽点，3集至少1个大爽点

### 四、矛盾强化
- 原著的矛盾通常是"温和的"，改编必须**升级矛盾烈度**：
  * 人际矛盾：对手更强大、手段更狠辣、威胁更直接
  * 时间压力：给主角设置倒计时（时限、倒计时、过期时间）
  * 损失升级：失败的代价从"丢脸"升级为"失去一切"
  * 盟友背叛：最信任的人背叛，让矛盾从"外部"延伸到"内部"
- 矛盾升级后必须让主角"无路可退"

### 五、各类型情绪基调映射
- **复仇/虐恋**：主基调=压抑→爆发的循环，辅基调=偶尔的温暖/笑点（用于对比）
- **甜宠/日常**：主基调=持续的甜蜜/心动，辅基调=小误会/小考验（制造波动）
- **悬疑/推理**：主基调=紧张→舒缓的循环，辅基调=误导线索+真相预告
- **逆袭/商战**：主基调=压制→反击的循环，辅基调=盟友支持+阶段性胜利
- **奇幻/玄幻**：主基调=震撼→期待的循环，辅基调=能力解锁+世界观扩展
- 情绪基调比例：主基调 70% + 辅基调 30%，避免基调混乱

### 六、删减决策优先级
当必须删减内容时，按以下优先级执行：
1. **优先删除**：与主线无关的支线剧情、不影响核心的次要人物互动、纯叙述性心理描写
2. **可以删除**：时间跳跃的过渡段落、重复表达的同类事件、信息密度过低的"水剧情"
3. **谨慎删除**：人物性格塑造的关键细节、伏笔暗示、情绪铺垫
4. **禁止删除**：核心爽点场景、股价级反转的伏笔、付费卡点前后的关键剧情、主角决策的关键动机
- 每个删除决策必须标注"删除理由 + 对后续剧情的影响评估 + 是否需要在其他位置补回"

### 七、AI短剧改编特别约束
1. **AI生成能力边界**：避免需要大规模特效/复杂动作/群演的场景
2. **场景可实现性**：每个场景必须是AI视频生成可实现的（2-3个角色、简单场景、对话为主）
3. **镜头语言适配**：竖屏特写多、横屏全景多，根据平台调整
4. **台词适配**：AI语音合成的台词需要口语化、短句、避免绕口令
5. **人物一致性**：主角的外貌/服装/气质必须在每集中保持一致，避免AI生成偏差

## 执行原则
- **强画面感**：所有保留内容须能转化为镜头语言
- **节奏极致快**：每个画面都拉升情绪
- **只沿主线**：摒弃多支线
- **展示不要告诉**：叙述/心理转成可拍的动作画面
- **降低理解成本**：观众听台词即可掌握核心剧情
- **情绪密度优先**：保留情绪密度高的场景，删除情绪密度低的场景

## 输出规范
输出必须包含：
1. 核心改编原则（3-5条，必须融合 Toonflow 的三大密度和心理级爽点）
2. 主要删除决策表（按优先级排序，标注删除理由和影响评估）
3. 世界观呈现策略（分3步走：第一集快速建立→前3集完善→前10集深化）
4. 情绪基调映射（主基调+辅基调+比例+各阶段落点）
5. 信息差策略设计（制造信息差的位置+消除信息差的时机+信息差的类型）
6. 股价级反转对齐（原骨架中每个反转的改编落地方式+伏笔位置+情绪铺垫）`;
}
