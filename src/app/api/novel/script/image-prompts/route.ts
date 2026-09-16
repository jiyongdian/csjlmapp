import { NextRequest } from 'next/server';
import { getRawAIConfig, getModelName, getTemperature } from '@/lib/ai-config';
import { getUserFromToken } from '@/lib/auth';
import { extractJsonObject } from '@/lib/json-parser';
import { modelPromptManager } from '@/storage/database';
import { scriptManager } from '@/storage/database';

const TIMEOUT_MS = 30000;

async function fetchWithTimeout(url: string, options: { timeout?: number; [key: string]: any }) {
  const { timeout = TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...fetchOptions, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

// SSE解析
async function* fetchSSE(
  apiUrl: string,
  apiKey: string,
  model: string,
  temperature: number,
  messages: Array<{ role: string; content: string }>,
  timeoutMs = TIMEOUT_MS
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: 4096,
        stream: true,
        reasoning_effort: 'none',
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!resp.ok || !resp.body) {
      throw new Error(`API错误: ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;

        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            yield { content, type: 'content' };
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

async function getImageSystemPrompt(chapterIdx?: number, sceneIdx?: number, contextText?: string): Promise<string> {
  const ch = chapterIdx !== undefined ? chapterIdx + 1 : '章节';
  const sc = sceneIdx !== undefined ? sceneIdx : '场景';

  const forcedRules = `
【强制执行指令——以下规则优先级最高，任何情况下不可违反】
- 严格遵守下面的【输出格式】JSON结构
- imagePrompts数组中必须恰好有1个对象
- 如果场景有对话，prompt中必须完整引用对话原文并有视觉描述
- 严格只输出JSON，不要任何解释或前言`;

  const outputFormat = `
【输出格式】
{
  "imagePrompts": [
    {
      "id": "img_ch${ch}_s${sc}",
      "sceneIndex": ${sc},
      "sceneTitle": "场景标题",
      "shotType": "特写/中景/远景/全景/过肩镜头",
      "description": "画面一句话描述：20字内",
      "prompt": "详细的中文图片生成提示词（必须完整引用对话原文）",
      "negativePrompt": "模糊, 变形, 低质量, 水印, 文字, 多余肢体",
      "style": "电影质感, 适配场景的风格关键词"
    }
  ]
}`;

  try {
    const dbPrompt = await modelPromptManager.getPrompt('image-prompts-system', { text: contextText || '' });
    if (dbPrompt && dbPrompt.systemPrompt && dbPrompt.systemPrompt.trim().length > 50) {
      return forcedRules + '\n\n' + dbPrompt.systemPrompt + outputFormat;
    }
  } catch {}

  return forcedRules + '\n\n' + `你是一位顶级的影视分镜师，精通AI绘图提示词技术。你的核心能力是将剧本场景转化为一张具有叙事张力和电影质感的分镜画面。
【核心原则】分镜图不是简单的场景截图，而是故事瞬间的凝固——选择该场景中最具戏剧张力的一刻，让画面本身就在讲故事。
【分镜设计方法论】
一、从场景内容提取画面要素——必须严格依据场景内容生成：
- 场景描述 → 确定空间构图、环境细节、光源位置、色调氛围
- 角色动作 → 选择动作最具表现力的一瞬
- 对话 → 捕捉说关键台词的瞬间，面部表情和肢体语言的极致状态
- 舞台指示 → 直接转化为构图方式和视角选择

二、对话场景的分镜处理（严格遵守）：
如果场景中包含对话内容，分镜必须体现：
- 说话者正在说话的瞬间（嘴唇微张、手势配合）
- 面部表情的极致状态（愤怒、悲伤、惊喜等）
- 对话双方的空间关系（面对面、背对等）
- 听话者的即时反应（如果场景有互动）
- 对话原文必须在prompt中完整引用
示例：场景有"李明说：我不会放弃"→分镜应选择男人面部特写，眼神坚定，嘴唇微张的瞬间

三、无对话场景的分镜处理：
- 聚焦动作最具视觉冲击力的一瞬
- 用光影和构图传递情绪
- 环境与角色的交互瞬间

四、构图与镜头选择原则：
- 角色独白/内心戏：面部特写，浅景深，背景虚化
- 双人对话：过肩镜头或侧面中景
- 群体场景：全景或中远景
- 动作/追逐：动态构图，对角线布局
- 环境建立：大全景，人物置于画面小比例

五、光影与氛围设计：
- 室内昏暗场景：单一主光源，高对比明暗
- 室外白天：根据时间设定色调
- 奇幻/修仙场景：边缘发光、粒子光效
- 动作场景：侧逆光勾勒轮廓

【提示词撰写规范】
1. prompt段落是最终送入AI绘画模型的指令
2. 必须具体到：人物数量、姿态、表情、服装细节、环境特征、光源方向、色调
3. 每条提示词80-150字，信息密度高
4. 选择场景中最具视觉冲击力的瞬间定格
5. 中文撰写，语言精炼但细节丰富
6. 如果场景有对话，prompt中必须描述说话者的表情、口型、肢体动作等说话瞬间的视觉特征
7. prompt中必须完整引用对话原文，格式：角色名说「对话内容」` + outputFormat;
}

// 安全推送数据到流
function safeEnqueue(controller: ReadableStreamDefaultController, encoder: TextEncoder, data: string, context: string): boolean {
  try {
    controller.enqueue(encoder.encode(data));
    return true;
  } catch (e) {
    console.warn(`[image-prompts] 流推送失败: ${context}`, e);
    return false;
  }
}

function safeClose(controller: ReadableStreamDefaultController) {
  try { controller.close(); } catch {}
}

// 构建单个场景的完整文本描述
function buildSceneText(s: any, sceneIdx: number): string {
  let text = `【场景${s.sceneIndex ?? sceneIdx}：${s.sceneTitle || s.title || ''}】\n`;
  text += `地点：${s.location || '未指定地点'}\n`;
  text += `景别：${s.shotType || '中景'}\n`;
  text += `机位：${s.cameraAngle || '正面'}\n`;
  text += `时长：${s.duration || '6秒'}\n`;
  text += `镜头运动：${s.cameraMovement || '固定'}\n`;
  text += `环境描述：${s.description || '无'}\n`;
  text += `角色动作：${s.actions || '无'}\n`;
  if (s.dialogues && Array.isArray(s.dialogues) && s.dialogues.length > 0) {
    text += '对话：\n';
    s.dialogues.forEach((d: any) => {
      text += `  ${d.character}：「${d.line}」${d.direction ? `（${d.direction}）` : ''}\n`;
    });
  } else {
    text += '对话：无\n';
  }
  text += `舞台指示：${s.stageDirections || '无'}`;
  return text;
}

// 保存单个场景的图片提示词到数据库
async function saveImagePromptToDb(scriptId: string, chapterIndex: number, prompt: any): Promise<void> {
  const freshScript = await scriptManager.getScriptById(scriptId);
  if (!freshScript) return;
  const updatedChapters = Array.isArray(freshScript.chapters) ? [...freshScript.chapters] : [];
  if (chapterIndex < 0 || chapterIndex >= updatedChapters.length) return;

  const existingIp = Array.isArray(updatedChapters[chapterIndex].imagePrompts)
    ? [...updatedChapters[chapterIndex].imagePrompts]
    : [];
  const existingMap = new Map(existingIp.map((v: any) => [String(v.sceneIndex), v]));
  existingMap.set(String(prompt.sceneIndex), prompt);

  updatedChapters[chapterIndex] = {
    ...updatedChapters[chapterIndex],
    imagePrompts: Array.from(existingMap.values()),
  };
  await scriptManager.updateScript(scriptId, { chapters: updatedChapters });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scriptId, chapterIndex, configId, force } = body;

    // 验证登录
    const authHeader = request.headers.get('Authorization');
    const payload = getUserFromToken(authHeader || '');
    if (!payload) {
      return new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    // 获取剧本
    const script = await scriptManager.getScriptById(scriptId);
    if (!script || script.userId !== payload.userId) {
      return new Response(JSON.stringify({ error: '剧本不存在或无权访问' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const chapters = Array.isArray(script.chapters) ? script.chapters : [];
    if (chapterIndex < 0 || chapterIndex >= chapters.length) {
      return new Response(JSON.stringify({ error: '章节索引无效' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const chapter = chapters[chapterIndex];
    const screenplay = chapter?.screenplay;

    if (!screenplay || (!screenplay.scenes && !screenplay.rawText)) {
      return new Response(JSON.stringify({ error: '请先生成该章节的剧本' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const { apiUrl, apiKey, provider } = await getRawAIConfig(configId);
    console.log(`[ImagePrompts] Using provider: ${provider}`);
    const model = await getModelName(configId);
    const temperature = await getTemperature(configId, 0.5);

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API密钥未配置' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    const allScenes: any[] = screenplay.scenes || [];
    const totalScenes = allScenes.length;

    // 如果没有场景数据，回退到原始文本模式
    if (totalScenes === 0) {
      return generateSingleBatch(request, script, chapterIndex, screenplay.rawText || '', apiUrl, apiKey, model, temperature);
    }

    // force=true：按「当前场景」全部重新生成，保证提示词跟随剧本修改变动
    const shouldForce = force === true || force === 1 || force === '1' || force === 'true';
    // 断点续生：默认跳过已有提示词的场景（force 时忽略跳过）
    const existingImagePrompts: any[] = Array.isArray(chapter.imagePrompts) ? chapter.imagePrompts : [];
    const existingSceneIndices = new Set(existingImagePrompts.map((ip: any) => String(ip.sceneIndex)));

    const scenesToGenerate = shouldForce ? allScenes : allScenes.filter((s: any) => !existingSceneIndices.has(String(s.sceneIndex)));
    const skippedCount = totalScenes - scenesToGenerate.length;

    console.log(`[image-prompts] 第${chapterIndex + 1}章共${totalScenes}个场景，已有${skippedCount}个提示词，需生成${scenesToGenerate.length}个`);

    const encoder = new TextEncoder();
    let isStreamClosed = false;
    const allImagePrompts: any[] = shouldForce ? [] : [...existingImagePrompts];

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 发送开始事件
          if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify({
            type: 'start',
            totalScenes,
            scenesToGenerate: scenesToGenerate.length,
            skippedScenes: skippedCount,
          })}${'\n\n'}`, 'start')) {
            isStreamClosed = true;
          }

          // 逐场景生成
          for (let i = 0; i < scenesToGenerate.length; i++) {
            if (isStreamClosed) break;

            const scene = scenesToGenerate[i];
            const sceneIdx = scene.sceneIndex;
            const sceneText = buildSceneText(scene, sceneIdx);

            // 发送场景开始事件
            if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify({
              type: 'scene_start',
              sceneIndex: sceneIdx,
              sceneTitle: scene.sceneTitle || scene.title || '',
              progress: i + 1,
              total: scenesToGenerate.length,
            })}${'\n\n'}`, 'scene_start')) {
              isStreamClosed = true;
              break;
            }

            const systemPrompt = await getImageSystemPrompt(
              chapterIndex,
              sceneIdx,
              [chapter.chapterTitle || chapter.title || `第${chapterIndex + 1}章`, sceneText].filter(Boolean).join('\n')
            );

            const hasDialogue = scene.dialogues && Array.isArray(scene.dialogues) && scene.dialogues.length > 0;
            const dialogueHint = hasDialogue
              ? '\n\n⚠️ 重要提醒：该场景包含对话内容，分镜图必须捕捉说话瞬间的视觉特征——说话者的表情、嘴唇状态、手势、眼神方向等，不能只画静态场景。'
              : '';

            const userPrompt = `请为以下场景生成1张分镜图提示词。
重要提醒：1. 仔细阅读场景内容，分镜必须精准还原该场景的所有要素
2. sceneIndex 必须为 ${sceneIdx}
3. 严格只生成1张分镜
4. 选择场景中最具戏剧张力和视觉冲击力的一刻来构图
5. 【严格对应场景数据】只能依据该场景的「地点/景别/机位/时长/镜头运动/环境描述/角色动作/对话/舞台指示」创作，禁止新增场景里没有的人物、道具、地点或情节
6. shotType 必须原样使用该场景的「景别」，不得改写、不得自创；构图与视角必须符合该场景的「机位」

章节：${chapter.chapterTitle || chapter.title || `第${chapterIndex + 1}章`}（场景${i + 1}/${scenesToGenerate.length}）
【场景内容】${sceneText}
${dialogueHint}

请生成1个分镜图图片提示词。`;

            let fullText = '';
            for await (const chunk of fetchSSE(apiUrl, apiKey, model, temperature, [{ role: 'system' as const, content: systemPrompt }, { role: 'user' as const, content: userPrompt }])) {
              if (isStreamClosed) break;
              if (chunk.content) {
                fullText += chunk.content;
                // 实时流式输出当前场景的生成内容
                if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify({
                  type: 'content',
                  content: chunk.content,
                  sceneIndex: sceneIdx,
                })}${'\n\n'}`, 'content chunk')) {
                  isStreamClosed = true;
                  break;
                }
              }
            }

            if (isStreamClosed) break;

            // 解析该场景结果
            console.log(`[image-prompts] 场景${sceneIdx} AI输出长度:${fullText.length}`);
            const sceneData = extractJsonObject<{ imagePrompts: any[] }>(fullText, ['imagePrompts']);
            const scenePrompts = sceneData?.imagePrompts || [];

            if (scenePrompts.length > 0) {
              const ip = scenePrompts[0];
              // 确保 sceneIndex 正确
              ip.sceneIndex = sceneIdx;
              ip.id = ip.id || `img_ch${chapterIndex + 1}_s${sceneIdx}`;
              // 严格把控：景别/机位/地点一律以场景数据为准，模型输出仅作兜底
              ip.shotType = scene.shotType || ip.shotType;
              ip.cameraAngle = scene.cameraAngle || ip.cameraAngle;
              ip.location = scene.location || ip.location;

              allImagePrompts.push(ip);

              // 每个场景生成完立即保存到数据库
              try {
                await saveImagePromptToDb(scriptId, chapterIndex, ip);
                console.log(`[image-prompts] 场景${sceneIdx}保存成功`);
              } catch (saveError) {
                console.error(`[image-prompts] 场景${sceneIdx}保存失败:`, saveError);
              }

              // 发送场景完成事件
              if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify({
                type: 'scene_complete',
                sceneIndex: sceneIdx,
                prompt: ip,
                progress: i + 1,
                total: scenesToGenerate.length,
              })}${'\n\n'}`, 'scene_complete')) {
                isStreamClosed = true;
              }
            } else {
              console.warn(`[image-prompts] 场景${sceneIdx}解析失败，AI输出: ${fullText.substring(0, 200)}`);
              // 发送场景跳过事件
              if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify({
                type: 'scene_skip',
                sceneIndex: sceneIdx,
                reason: 'AI输出解析失败',
                progress: i + 1,
                total: scenesToGenerate.length,
              })}${'\n\n'}`, 'scene_skip')) {
                isStreamClosed = true;
              }
            }

            // 发送进度更新
            const percent = Math.round(((i + 1) / scenesToGenerate.length) * 100);
            if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify({
              type: 'progress',
              completed: i + 1,
              total: scenesToGenerate.length,
              percent,
            })}${'\n\n'}`, 'progress')) {
              isStreamClosed = true;
            }
          }

          if (!isStreamClosed) {
            safeEnqueue(controller, encoder, `data: ${JSON.stringify({
              type: 'complete',
              imagePrompts: allImagePrompts,
              generated: scenesToGenerate.length,
              total: totalScenes,
            })}${'\n\n'}`, 'complete');
          }
          safeClose(controller);
        } catch (error: unknown) {
          console.error('[image-prompts] 生成错误:', error);
          if (!isStreamClosed) {
            safeEnqueue(
              controller,
              encoder,
              `data: ${JSON.stringify({ type: 'error', error: error instanceof Error ? error.message : '未知错误', savedPrompts: allImagePrompts.length })}${'\n\n'}`,
              'error'
            );
          }
          safeClose(controller);
        }
      },

      cancel() {
        console.log('[image-prompts] 客户端断开连接');
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : '服务器错误';
    console.error('[image-prompts] API错误:', error);
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// 无场景数据时，使用原始文本模式
async function generateSingleBatch(
  request: NextRequest,
  script: any,
  chapterIndex: number,
  rawText: string,
  apiUrl: string,
  apiKey: string,
  model: string,
  temperature: number,
) {
  const scriptId = script.id;
  const chapter = (Array.isArray(script.chapters) ? script.chapters : [])[chapterIndex];

  const systemPrompt = await getImageSystemPrompt(
    chapterIndex,
    undefined,
    [chapter?.chapterTitle || chapter?.title || `第${chapterIndex + 1}章`, rawText].filter(Boolean).join('\n')
  );

  const userPrompt = `请为以下剧本内容生成分镜图提示词。
章节：${chapter?.chapterTitle || chapter?.title || `第${chapterIndex + 1}章`}

【剧本内容】${rawText.substring(0, 3000)}

请生成1-10个分镜图图片提示词。`;

  const llmStream = fetchSSE(apiUrl, apiKey, model, temperature, [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ]);

  const encoder = new TextEncoder();
  let fullText = '';
  let isStreamClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of llmStream) {
          if (isStreamClosed) break;
          if (chunk.content) {
            const text = typeof chunk.content === 'string' ? chunk.content : JSON.stringify(chunk.content);
            fullText += text;
            if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify({ type: 'content', content: text })}${'\n\n'}`, 'content chunk')) {
              isStreamClosed = true;
              break;
            }
          }
        }

        if (isStreamClosed) { safeClose(controller); return; }

        const imagePromptsData = extractJsonObject<{ imagePrompts: any[] }>(fullText, ['imagePrompts']);
        const imagePrompts = imagePromptsData?.imagePrompts || [];

        try {
          const freshScript = await scriptManager.getScriptById(scriptId);
          if (freshScript) {
            const updatedChapters = Array.isArray(freshScript.chapters) ? [...freshScript.chapters] : [];
            if (chapterIndex >= 0 && chapterIndex < updatedChapters.length) {
              updatedChapters[chapterIndex] = { ...updatedChapters[chapterIndex], imagePrompts };
              await scriptManager.updateScript(scriptId, { chapters: updatedChapters });
            }
          }
        } catch (saveError) {
          console.error('[image-prompts] 保存失败:', saveError);
        }

        safeEnqueue(controller, encoder, `data: ${JSON.stringify({ type: 'complete', imagePrompts })}${'\n\n'}`, 'complete');
        safeClose(controller);
      } catch (error: unknown) {
        console.error('[image-prompts] 生成错误:', error);
        if (!isStreamClosed) {
          safeEnqueue(controller, encoder, `data: ${JSON.stringify({ type: 'error', error: error instanceof Error ? error.message : '未知错误' })}${'\n\n'}`, 'error');
        }
        safeClose(controller);
      }
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
