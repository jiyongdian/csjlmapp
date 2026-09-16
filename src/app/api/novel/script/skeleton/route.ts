import { NextRequest } from 'next/server';
import { getModelName, getTemperature, getRawAIConfig } from '@/lib/ai-config';
import { appendAgentSkillPrompt } from '@/lib/agent-skills';
import { getPromptWithFallback } from '@/lib/prompt-helper';
import { scriptManager } from '@/storage/database';
import { novelManager } from '@/storage/database/novelManager';

// 清洗AI输出
function cleanAIOutput(text: string): string {
  return text
    .replace(/<invoke[\s\S]*?<\/invoke>/gi, '')
    .replace(/<\/?minimax:tool_call[\s\S]*?>/gi, '')
    .replace(/<[\s\S]*?>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      novelId,
      chapters,
      novelContent,
      feedback,
      totalEpisodes = 20,
      episodeDuration = 2,
      startChapter = 1,
      endChapter = 0,
      platform = '竖屏',
      style = '',
      paywall = '',
      genderTarget: gt = '',
    } = body;
    
    // 可变字段（后续可能被数据库加载覆盖）
    let genre = body.genre || '';
    let tone = body.tone || '';
    let protagonistName = body.protagonistName || '';
    let supportingCharacters = body.supportingCharacters || '';
    let genderTarget = gt;

    // 支持两种输入格式：chapters数组 或 novelContent字符串
    let processedChapters: Array<{ title: string; content: string }> = [];
    
    if (chapters && Array.isArray(chapters) && chapters.length > 0) {
      processedChapters = chapters.map((ch: any) => ({
        title: ch.title || `第${ch.chapterNo || ''}章`,
        content: ch.content || ch.summary || ch.text || '',
      }));
    } else if (novelContent && typeof novelContent === 'string' && novelContent.trim().length > 0) {
      // 将小说内容按章节/段落切分
      const segments = novelContent
        .split(/\n(?=第[一二三四五六七八九十百千\d]+[章节回卷集部])/g)
        .map(s => s.trim())
        .filter(s => s.length > 50);
      
      if (segments.length === 0) {
        // 无法按章节切分，整体作为一个章节
        processedChapters = [{ title: '全文', content: novelContent.trim() }];
      } else {
        processedChapters = segments.map((seg, idx) => {
          const match = seg.match(/^第[一二三四五六七八九十百千\d]+[章节回卷集部](.+?)[，,]/);
          const title = match ? match[0] : `第${idx + 1}章`;
          return { title, content: seg };
        });
      }
    }

    // 如果前端没有传 chapters/novelContent，但有 novelId，自动从数据库加载小说
    if (processedChapters.length === 0 && novelId) {
      try {
        const novel = await novelManager.getById(novelId);
        if (novel) {
          // 从小说的 chapters 字段获取
          const novelChapters = Array.isArray(novel.chapters) ? novel.chapters : [];
          if (novelChapters.length > 0) {
            processedChapters = novelChapters.map((ch: any, idx: number) => ({
              title: ch.title || `第${idx + 1}章`,
              content: ch.content || ch.summary || '',
            }));
          } else {
            // 从 structure.chapters 获取
            const structure = typeof novel.structure === 'string' 
              ? JSON.parse(novel.structure) 
              : (novel.structure || {});
            const structChapters = Array.isArray(structure?.chapters) ? structure.chapters : [];
            if (structChapters.length > 0) {
              processedChapters = structChapters.map((ch: any, idx: number) => ({
                title: ch.title || `第${idx + 1}章`,
                content: ch.summary || ch.keyEvents || '',
              }));
            }
          }
          
          // 用小说的元数据填充缺失字段
          if (!genre && novel.category) genre = novel.category;
          if (!tone && Array.isArray(novel.tone)) tone = novel.tone.join(' ');
          if (!protagonistName && novel.protagonist) protagonistName = novel.protagonist;
          if (!genderTarget && novel.genderTarget) genderTarget = novel.genderTarget;
          
          console.log(`[Script Skeleton] Auto-loaded novel "${novel.title}": ${processedChapters.length} chapters`);
        }
      } catch (loadErr) {
        console.warn('[Script Skeleton] Failed to auto-load novel:', loadErr);
      }
    }

    if (!novelId || processedChapters.length === 0) {
      return Response.json(
        { success: false, error: '小说ID和章节内容不能为空' },
        { status: 400 }
      );
    }

    const modelName = await getModelName();
    const temperature = await getTemperature(0.7);
    const { apiUrl, apiKey, provider } = await getRawAIConfig();

    if (!apiKey) {
      return Response.json(
        { success: false, error: 'API密钥未配置' },
        { status: 503 }
      );
    }

    console.log(`[Script Skeleton] Using provider: ${provider}, model: ${modelName}`);

    // 构建章节全文摘要（不限制字数，小说内容多少就用多少）
    const chapterSummaries = processedChapters.map((ch, idx) => {
      const content = ch.content || '';
      return `【第${idx + 1}章《${ch.title || '无标题'}》】\n${content}`;
    });

    // 实际章节范围
    const actualEndChapter = endChapter > 0 ? endChapter : processedChapters.length;

    // 构建上下文
    const context = {
      genre,
      tone: Array.isArray(tone) ? tone.join(' ') : tone,
      genderTarget,
      protagonistName,
      supportingCharacters,
      platform,
      style,
      paywall,
      text: chapterSummaries.join('\n'),
    };

    // 获取系统提示词（整合Agent Skill）
    const baseSystemPrompt = await getPromptWithFallback('script-skeleton-system', getDefaultSkeletonPrompt(), context);
    const systemPrompt = appendAgentSkillPrompt('script-skeleton-system', baseSystemPrompt, context);

    // 构建用户提示词（包含完整章节内容）
    const userPrompt = `请基于以下小说章节内容，构建一个完整的短剧故事骨架。

【⚠️ 重要】直接输出骨架正文，第一行必须是骨架标题。禁止任何前置应答（如"好的"、"我将"、"以下是"等），禁止思考过程，禁止提问。

【小说信息】
- 题材：${genre || '未指定'}
- 基调：${tone || '未指定'}
- 主角：${protagonistName || '未指定'}
- 配角：${supportingCharacters || '未指定'}
- 性别方向：${genderTarget === 'male' ? '男频' : genderTarget === 'female' ? '女频' : '未指定'}

【项目配置】
- 集数：${totalEpisodes}集
- 单集时长：${episodeDuration}分钟（约${episodeDuration * 150}字台词）
- 原著范围：第${startChapter}-${actualEndChapter}章
- 平台规格：${platform}
- 风格定位：${style || '未指定'}
- 付费策略：${paywall || '未指定'}

【小说章节全文内容】
${chapterSummaries.join('\n\n')}
${feedback ? `\n\n【上一轮审核反馈——本次必须修复以下问题】\n${feedback}\n` : ''}

请按照以下结构输出完整的故事骨架（直接输出，不要任何前置语）：
1. 故事核（一句话总结核心吸引力 + 核心心理级爽点 + 金手指原创性及约束）
2. 隐线（人物弧光）
3. 人物小传（核心角色，≤4人）
4. 三幕结构
5. 分集决策（每集一句话概括）
6. 付费卡点设计（按≈10%/30%/50%/70%/90%比例）
7. 股价级反转登记表`;

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
    const MIN_SKELETON_LENGTH = 100;
    const MAX_SERVER_RETRIES = 2;  // 总共3次尝试（初始+2次重试）
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullContent = '';
          let chunkCount = 0;
          let attempt = 0;
          let lastGoodContent = '';
          
          // 服务端重试：如果生成内容过短则自动重试
          while (attempt <= MAX_SERVER_RETRIES) {
            fullContent = '';
            chunkCount = 0;
            attempt++;
            
            // 只有重试时才追加更强的指令
            const retryMessages = attempt > 1 ? [
              { role: 'system' as const, content: systemPrompt + '\n\n补充要求：禁止任何前置应答，直接输出骨架标题开始的正文。' },
              { role: 'user' as const, content: userPrompt + `\n\n【重要】你之前的输出太短了！请务必详细展开，至少输出${MIN_SKELETON_LENGTH * 5}字以上的完整骨架。直接开始输出，不要说任何多余的话。` },
            ] : messages;
            
            let lastSentLength = 0;
            for await (const chunk of streamWithMaxTokens(retryMessages, temperature, 16384)) {
              if (chunk.content) {
                fullContent += chunk.content;
                chunkCount++;

                // 发送流式内容（增量）
                if (fullContent.length - lastSentLength >= 50 || chunkCount <= 3) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: 'content',
                        content: fullContent.slice(lastSentLength),
                        chunkIndex: chunkCount,
                      })}\n\n`
                    )
                  );
                  lastSentLength = fullContent.length;
                }
              }
            }
            
            // 清洗输出
            fullContent = cleanAIOutput(fullContent);
            
            console.log(`[Script Skeleton] 第${attempt}次生成：${fullContent.length}字符`);
            
            // 如果内容足够，跳出重试循环
            if (fullContent.length >= MIN_SKELETON_LENGTH) {
              lastGoodContent = fullContent;
              // 发送最后剩余的内容
              if (lastSentLength < fullContent.length) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: 'content',
                      content: fullContent.slice(lastSentLength),
                      chunkIndex: chunkCount,
                    })}\n\n`
                  )
                );
              }
              break;
            }
            
            // 内容过短
            console.warn(`[Script Skeleton] 第${attempt}次生成内容过短（${fullContent.length}字符），将重试...`);
            if (attempt >= MAX_SERVER_RETRIES) {
              // 重试耗尽，使用降级方案
              console.warn(`[Script Skeleton] 骨架生成3次均过短，使用确定性降级骨架`);
              fullContent = generateFallbackSkeleton(processedChapters, { genre, tone, protagonistName, totalEpisodes, episodeDuration, platform, style });
              break;
            }
          }
          
          // 使用最好的或降级的内容
          if (lastGoodContent && lastGoodContent.length >= MIN_SKELETON_LENGTH) {
            fullContent = lastGoodContent;
          }

          // 保存骨架到数据库
          try {
            const savedSkeleton = await scriptManager.saveSkeleton({
              novelId,
              skeleton: fullContent,
              totalEpisodes,
              episodeDuration,
              genre,
              tone,
              protagonistName,
              supportingCharacters,
            });

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'complete',
                  content: fullContent,
                  skeletonId: savedSkeleton?.id,
                  message: '故事骨架生成完成',
                })}\n\n`
              )
            );
          } catch (saveError) {
            console.error('[Script Skeleton] Save error:', saveError);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'complete',
                  content: fullContent,
                  message: '故事骨架生成完成（保存失败）',
                })}\n\n`
              )
            );
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error: any) {
          console.error('[Script Skeleton] Error:', error);
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
    console.error('[Script Skeleton] Error:', error);
    return Response.json(
      { success: false, error: error.message || '故事骨架生成失败' },
      { status: 500 }
    );
  }
}

// 降级骨架：当AI连续失败时使用确定性骨架
function generateFallbackSkeleton(
  chapters: Array<{ title: string; content: string }>,
  config: { genre: string; tone: string; protagonistName: string; totalEpisodes: number; episodeDuration: number; platform: string; style: string }
): string {
  const chapterSummaries = chapters.map((ch, idx) => {
    const preview = (ch.content || '').slice(0, 100).replace(/\s+/g, ' ');
    return `第${idx + 1}章《${ch.title}》：${preview}...`;
  });

  const mainCharacter = config.protagonistName || '主角';
  
  return `# 《${config.genre || '原创'}》- 故事骨架

---

## 故事核（一句话）
**${mainCharacter}在绝境中觉醒金手指，利用直播系统逆天改命，在复仇逆袭中实现自我成长。**

最吸引人的本质：**底层逆袭的极致爽感 + 直播/现代元素的代入感 + 金手指的成长性**。

## 隐线（人物弧光）
- ${mainCharacter}：从废物→觉醒→成长→掌控→登顶
- 内心挣扎：自卑→愤怒→坚定→包容→担当

## 人物小传
1. **${mainCharacter}**（主角）：落魄但有底线，金手指是直播系统，通过情绪波动获取能量
2. **张虎/主要对手**：代表旧势力/既得利益者，与主角有直接冲突
3. **赵铁柱/盟友**：忠诚但能力有限，是主角的支持者和情感支点
4. **系统/金手指**：限制明确（需情绪能量），随主角成长解锁新能力

## 三幕结构
### 第一幕：建立（约占25%）
- 第1-5集：主角陷入绝境，金手指觉醒，初步展示能力
- 核心冲突建立：主角vs对手的直接对抗
- 第一个微爽点爆发

### 第二幕：冲突升级（约占50%）
- 第6-15集：对手反扑，主角陷入更大危机，金手指成长
- 矛盾升级：人际矛盾→群体矛盾
- 至少2次大爽点 + 1次股价级反转

### 第三幕：高潮/结局（约占25%）
- 第16-20集：终极对决，主角完成终极反转
- 矛盾升级到命运矛盾
- 大结局：主角登顶，留下续集钩子

## 分集决策
${chapterSummaries.map((s, i) => `- 第${i + 1}集：${s}`).join('\n')}
${Array.from({ length: Math.max(0, config.totalEpisodes - chapters.length) }, (_, i) => `- 第${chapters.length + i + 1}集：后续剧情发展与高潮铺垫`).join('\n')}

## 付费卡点设计（按比例）
- **10%（第${Math.max(1, Math.floor(config.totalEpisodes * 0.1))}集）**：第一次微爽点爆发后，主角获得关键道具/信息
- **30%（第${Math.max(1, Math.floor(config.totalEpisodes * 0.3))}集）**：股价级反转预告，主角发现更大阴谋
- **50%（第${Math.max(1, Math.floor(config.totalEpisodes * 0.5))}集）**：中点大反转，主角陷入最大危机
- **70%（第${Math.max(1, Math.floor(config.totalEpisodes * 0.7))}集）**：真相揭露，主角团队成型
- **90%（第${Math.max(1, Math.floor(config.totalEpisodes * 0.9))}集）**：终极对决开始，金手指终极形态解锁

## 股价级反转登记表
1. **身份反转**：主角的真实身份/背景颠覆认知
2. **动机反转**：盟友变敌人/敌人变盟友
3. **真相反转**：金手指的真正来历和限制

---
（本骨架基于小说章节内容${chapters.length}章生成，为降级方案，建议重新生成以获取更丰富的内容）`;
}

function getDefaultSkeletonPrompt(): string {
  return `你是一位专业的短剧故事骨架构建专家，掌握 Toonflow 爆款短剧创作方法论，擅长基于小说章节内容构建具备爆款潜力的完整三幕结构与分集决策。

## 核心职责
1. 分析小说章节事件，提炼核心冲突与人物关系
2. 构建三幕结构（建立→冲突→高潮/结局）
3. 根据总集数制定分集决策
4. 设计付费卡点与股价级反转
5. 确保骨架具备爆款潜力

## Toonflow 核心骨架方法论

### 一、三大密度（必须贯穿全剧）
1. **情绪密度**：每3分钟至少一次情绪波动（爆点/虐点/爽点/笑点），让观众"停不下来"
2. **信息密度**：每5分钟必须有新信息/新线索/新关系/新反转推进，杜绝"水剧情"
3. **情节密度**：每集必须完成至少一个完整的"目标→阻碍→突破"闭环

### 二、心理级爽点与金手指原创性
- 爽点不是"打脸"本身，而是**心理预期的精准暴击**：让观众在主角反击的0.5秒前就开始屏息
- 金手指必须具备**原创性 + 限制性 + 成长性**：
  * 原创性：避免"废柴逆袭"等烂大街设定，找到差异化卖点
  * 限制性：金手指必须有代价/冷却/使用条件，否则剧情会崩
  * 成长性：金手指随主角成长解锁新能力，保持长线吸引力
- 每集至少1个"微爽点"，每3集至少1个"大爽点"

### 三、矛盾四级阶梯（逐级升级，不可跳跃）
1. **自我矛盾**：主角内心挣扎（信念vs欲望、责任vs情感）
2. **人际矛盾**：主角与直接对手的冲突（价值观/资源/情感）
3. **群体矛盾**：主角所在群体与外部势力的对抗
4. **命运矛盾**：主角与宿命/规则/体制的终极对抗
- 每5集完成一次矛盾层级升级

### 四、前10集黄金结构（决定留存率）
- **第1集（钩子集）**：开篇3秒必须出现视觉冲突/情绪炸弹，结尾必须是"不看第2集会死"的强钩子
- **第2-3集（建立期）**：快速建立世界观、人物关系、核心矛盾，每集结尾都有钩子
- **第4-6集（小高潮）**：第一次心理级爽点爆发，让观众"入坑"
- **第7-10集（巩固期）**：股价级反转预告 + 关系网深化 + 付费卡点埋伏
- 前10集必须完成"故事核 + 核心爽点原型 + 主线矛盾"的全部建立

### 五、付费点5大标准
1. **情绪高点**：付费卡点必须设在情绪最高点（爆点/虐点/爽点之后）
2. **信息断点**：付费卡点之后的内容必须有"解锁新信息/新世界/新关系"的预期
3. **钩子强度**：卡点后的下一集开头必须是"不得不看"的强钩子
4. **节奏断点**：卡点位置不能打断情绪节奏，必须是"自然暂停"
5. **价值感**：让付费观众觉得"值回票价"，物超所值
- 付费点按≈10%/30%/50%/70%/90%比例分布，共5个卡点

### 六、股价级反转设计（≈3个/20集）
- 定义：**彻底颠覆观众已建立的认知，让故事走向完全出乎意料但又合情合理**
- 类型：身份反转 / 动机反转 / 关系反转 / 阵营反转 / 真相反转
- 原则：
  * 必须有足够的前置伏笔（至少3集以前就有暗示）
  * 反转后必须立刻引发新的矛盾升级
  * 反转不能为反而反，必须服务人物弧光
- 每3个股价级反转之间，至少有2-3集的"消化期"

## 执行原则
- **情绪先行**：短剧是情绪产品，所有结构选择最终都要服务情绪
- **三大密度**：情绪密度/信息密度/情节密度可持续供给
- **预期管理**：建立预期→打破预期→埋下新预期
- **单线型叙事**：聚焦单条主线，避免多线并行
- **心理级爽点**：所有爽点必须击中观众"爽点心理学"——不甘→关注→期待→爆发
- **黄金前10集**：前10集的质量决定80%的留存率，必须投入50%以上的精力

## 输出规范
输出必须包含：
1. 故事核（一句话+核心心理级爽点+金手指原创性及约束）
2. 隐线（人物弧光）
3. 人物小传（大三角核心角色≤4人）
4. 三幕结构
5. 分集决策（≤20集用逐集展开模式A）
6. 付费卡点设计（标注每个卡点的情绪类型 + 卡点后钩子预告）
7. 股价级反转登记表（标注每个反转的类型 + 前置伏笔位置 + 反转后新矛盾）

## 注意事项
- 分集数必须等于配置中的总集数
- 每集必须有集末钩子（强/中/弱三种强度，交替使用）
- 付费点按≈10%/30%/50%/70%/90%比例分布
- 全剧设计≈3个股价级反转
- 人物小传仅大三角核心角色（≤4人）
- 每集分集决策必须标注：情绪密度等级 / 信息密度等级 / 情节密度等级 / 核心情绪类型`;
}
