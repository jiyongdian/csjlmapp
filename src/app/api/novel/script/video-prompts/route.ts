import { NextRequest, NextResponse } from 'next/server';
import { getRawAIConfig, getModelName, getTemperature } from '@/lib/ai-config';
import { getUserFromToken } from '@/lib/auth';
import { modelPromptManager } from '@/storage/database';
import { scriptManager } from '@/storage/database';

const TIMEOUT_MS = 120000;

// 获取视频提示词系统提示词（含Agent技能增强）
async function getVideoSystemPrompt(contextText?: string): Promise<string> {
  const forcedRules = `
【强制执行指令——以下规则优先级最高，任何情况下不可违反】
- 严格遵守下面的【输出格式】JSON结构
- videoPrompts数组中必须包含生成的子镜头
- 如果场景有对话，prompt中必须完整引用对话原文并有视觉描述
- 严格只输出JSON，不要任何解释或前言`;

  const outputFormat = `
【输出格式】
{
  "videoPrompts": [
    {
      "id": "vid_scENE",
      "sceneIndex": 场景号,
      "sceneTitle": "场景标题",
      "subShotIndex": 子镜头序号,
      "description": "画面描述",
      "startFrame": "起始画面描述",
      "cameraMovement": "镜头运动方式",
      "action": "动作描述",
      "endFrame": "结束画面描述",
      "duration": "时长",
      "prompt": "详细的中文视频生成提示词",
      "style": "风格",
      "transition": "转场方式",
      "dialogueRange": "对话范围"
    }
  ]
}`;

  try {
    const dbPrompt = await modelPromptManager.getPrompt('video-prompts-system', { text: contextText || '' });
    if (dbPrompt && dbPrompt.systemPrompt && dbPrompt.systemPrompt.trim().length > 50) {
      return forcedRules + '\n\n' + dbPrompt.systemPrompt + outputFormat;
    }
  } catch {}

  return forcedRules + '\n\n' + `你是一位顶级的影视视频分镜师，精通AI视频生成提示词技术。你的核心能力是将剧本场景转化为具有叙事张力和电影质感的视频分镜提示词。

【视频提示词创作原则】
1. 每个子镜头必须有明确的起始画面和结束画面
2. 描述镜头运动方式（推/拉/摇/移/跟/固定）
3. 如果场景有对话，必须在prompt中完整引用对话原文
4. 描述说话者的口型变化、表情、肢体语言等视觉细节
5. 起始画面必须承接上一镜头的结束画面，保持连贯性

【视频分镜要素】
- startFrame：起始画面（上一镜头结束画面的自然延续）
- cameraMovement：镜头运动方式（推近/拉远/摇移/跟随/固定）
- action：角色动作描述
- endFrame：结束画面（下一镜头的起始画面）
- duration：建议时长（秒）
- prompt：完整的视频生成提示词（80-200字中文）

【提示词规范】
1. 使用中文撰写，语言精炼但细节丰富
2. 描述必须具体：人物数量、姿态、表情、环境、光源
3. 包含镜头运动的方向和速度
4. 如果有对话，必须描述说话瞬间的视觉特征
5. 确保子镜头间的连贯性` + outputFormat;
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

// 安全入队
function safeEnqueue(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  data: string,
  _type: string
): boolean {
  try {
    controller.enqueue(encoder.encode(data));
    return true;
  } catch {
    return false;
  }
}

// JSON提取
function extractJsonObject<T>(text: string, keys: string[]): T | null {
  try {
    const startIdx = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');
    if (startIdx === -1 || endIdx === -1) return null;
    const jsonStr = text.slice(startIdx, endIdx + 1);
    const parsed = JSON.parse(jsonStr);
    
    // 检查是否包含所需的key
    for (const key of keys) {
      if (parsed[key] !== undefined) {
        return parsed as T;
      }
    }
    return parsed as T;
  } catch {
    return null;
  }
}

/** 把模型输出的各种时长写法归一化为「N秒」（如 7s / 7 / 7.5 秒 → 7秒），无法解析返回空串 */
function normalizeDurationText(value: any): string {
  const v = String(value || '').trim();
  if (!v) return '';
  const m = v.match(/\d+(\.\d+)?/);
  return m ? m[0] + '秒' : '';
}

// 保存视频提示词到数据库
async function saveVideoPromptToDb(scriptId: string, chapterIndex: number, prompts: any[], sceneIndex: number) {
  const script = await scriptManager.getScriptById(scriptId);
  if (!script || !script.chapters) return;

  const chapters = typeof script.chapters === 'string' ? JSON.parse(script.chapters) : script.chapters;
  const chapter = chapters[chapterIndex];
  if (!chapter) return;

  // 统一为扁平的 videoPrompts 数组（与图片提示词、剧本 Agent 的数据结构一致）：
  // 先移除该场景的旧提示词，再写入本次生成的子镜头
  const list: any[] = Array.isArray(chapter.videoPrompts) ? chapter.videoPrompts : [];
  const others = list.filter((p: any) => String((p && p.sceneIndex) ?? '') !== String(sceneIndex));
  chapter.videoPrompts = [...others, ...prompts];

  await scriptManager.updateScript(scriptId, { chapters: JSON.stringify(chapters) });
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController | null = null;
  let isStreamClosed = false;

  try {
    // getUserFromToken 内部要求传入带「Bearer 」前缀的原始头部，不能先剥掉前缀（否则永远 401）
    const authHeader = request.headers.get('authorization');
    const user = await getUserFromToken(authHeader);
    if (!user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const body = await request.json();
    const { scriptId, chapterIndex, customSystemPrompt, customUserPromptTpl } = body;

    if (!scriptId || chapterIndex === undefined) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 获取AI配置
    const { apiUrl, apiKey, provider } = await getRawAIConfig(null);
    console.log(`[VideoPrompts] Using provider: ${provider}`);
    const model = await getModelName(null);
    const temperature = await getTemperature(null, 0.7);

    if (!apiKey) {
      return NextResponse.json({ error: 'API密钥未配置' }, { status: 503 });
    }

    // 获取剧本
    const script = await scriptManager.getScriptById(scriptId);
    if (!script || !script.chapters) {
      return NextResponse.json({ error: '剧本不存在' }, { status: 404 });
    }

    const chapters = typeof script.chapters === 'string' ? JSON.parse(script.chapters) : script.chapters;
    const chapter = chapters[chapterIndex];
    if (!chapter) {
      return NextResponse.json({ error: '章节不存在' }, { status: 404 });
    }

    // 场景数据统一存放在 chapter.screenplay.scenes，与图片提示词接口、剧本 Agent 保持一致
    const screenplay = (chapter as any).screenplay;
    const scenes: any[] = screenplay && Array.isArray(screenplay.scenes) ? screenplay.scenes : [];
    if (!scenes.length) {
      return NextResponse.json({ error: '请先生成该章节的剧本' }, { status: 400 });
    }
    const scenesToGenerate = scenes;

    // 创建流式响应
    const stream = new ReadableStream({
      start(c) {
        controller = c;
      },
    });

    const response = new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

    let newlyGeneratedPrompts: any[] = [];

    // 处理每个场景
    (async () => {
      try {
        for (let i = 0; i < scenesToGenerate.length; i++) {
          if (isStreamClosed) break;

          const scene = scenesToGenerate[i];
          const sceneIdx = Number(scene.sceneIndex) || i + 1;

          // 发送场景开始事件
          if (!safeEnqueue(controller!, encoder, `data: ${JSON.stringify({
            type: 'scene_start',
            sceneIndex: sceneIdx,
            sceneTitle: scene.sceneTitle || scene.title || '',
            progress: i + 1,
            total: scenesToGenerate.length,
          })}${'\n\n'}`, 'scene_start')) {
            isStreamClosed = true;
            break;
          }

          const sceneDialogues: any[] = scene.dialogues && Array.isArray(scene.dialogues) ? scene.dialogues : [];
          const dialogueCount = sceneDialogues.length;

          // 构建完整场景文本
          let fullSceneText = `【场景${sceneIdx}：${scene.sceneTitle || scene.title || ''}】\n`;
          fullSceneText += `地点：${scene.location || '未指定地点'}\n`;
          fullSceneText += `景别：${scene.shotType || '中景'}\n`;
          fullSceneText += `机位：${scene.cameraAngle || '正面'}\n`;
          fullSceneText += `时长：${scene.duration || '6秒'}\n`;
          fullSceneText += `镜头运动：${scene.cameraMovement || '固定'}\n`;
          fullSceneText += `环境描述：${scene.description || '无'}\n`;
          fullSceneText += `角色动作：${scene.actions || '无'}\n`;
          if (dialogueCount > 0) {
            fullSceneText += '本场场景全部对话：\n';
            for (let di = 0; di < dialogueCount; di++) {
              const d = sceneDialogues[di];
              fullSceneText += `  第${di + 1}句：${d.character}：「${d.line}」${d.direction ? `（${d.direction}）` : ''}\n`;
            }
          }
          fullSceneText += `舞台指示：${scene.stageDirections || '无'}`;

          // 获取系统提示词（含Agent技能增强）
          const systemPrompt = await getVideoSystemPrompt(
            [chapter.chapterTitle || chapter.title || `第${chapterIndex + 1}章`, fullSceneText].filter(Boolean).join('\n')
          );

          // 计算需要生成的子镜头数量
          const expectedShotCount = dialogueCount === 0 ? 1 : Math.ceil(dialogueCount / 2);

          const fullUserPrompt = `请为以下完整场景生成视频提示词子镜头序列。
场景：${scene.sceneTitle || scene.title || ''}
章节：${chapter.chapterTitle || chapter.title || `第${chapterIndex + 1}章`}（场景${i + 1}/${scenesToGenerate.length}）
【场景信息】${fullSceneText}

【重要要求】
1. 本场场景共有${dialogueCount}句对话，请生成${expectedShotCount}个子镜头，确保所有对话都被完整覆盖
2. 每个子镜头覆盖1-2句对话，subShotIndex从1开始递增
3. 每个子镜头的prompt字段必须完整引用分配给它的对话原文
4. 必须描述说话者的口型变化、表情、肢体语言等视觉细节
5. 可以有主镜头和子镜头，但所有对话都要覆盖
6. 【严格对应场景数据】只能依据该场景的「地点/景别/机位/时长/镜头运动/环境描述/角色动作/对话/舞台指示」创作，禁止新增场景里没有的人物、道具、地点或情节
7. shotType 必须原样使用该场景的「景别」；cameraMovement 必须与该场景的「镜头运动」保持一致，仅在子镜头确有需要时才做细分
请生成${expectedShotCount}个视频提示词子镜头。`;

          let fullText = '';
          for await (const chunk of fetchSSE(apiUrl, apiKey, model, temperature, [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: fullUserPrompt }
          ])) {
            if (isStreamClosed) break;
            if (chunk.content) {
              fullText += chunk.content;
              if (!safeEnqueue(controller!, encoder, `data: ${JSON.stringify({
                type: 'content',
                content: chunk.content,
                sceneIndex: sceneIdx,
                subShotIndex: null,
              })}${'\n\n'}`, 'content chunk')) {
                isStreamClosed = true;
                break;
              }
            }
          }

          if (isStreamClosed) break;

          // 解析AI返回
          let cleanedText = fullText;
          cleanedText = cleanedText.replace(/<think[\s\S]*?<\/think>/gi, '').replace(/<thinking[\s\S]*?<\/thinking>/gi, '').trim();

          const shotData = extractJsonObject<{ videoPrompts: any[] }>(cleanedText, ['videoPrompts']);
          const shotPrompts = shotData?.videoPrompts || [];

          console.log(`[video-prompts] 场景${sceneIdx}共${dialogueCount}句对话，需${expectedShotCount}个子镜头，AI返回${shotPrompts.length}个`);

          // 清空并重新生成
          newlyGeneratedPrompts = [];

          // 根据对话数量严格生成子镜头
          for (let sIdx = 0; sIdx < expectedShotCount; sIdx++) {
            const diStart = sIdx * 2;
            const diEnd = Math.min(diStart + 2, dialogueCount);
            const coveredDialogues = dialogueCount > 0 ? sceneDialogues.slice(diStart, diEnd) : [];

            const dialogueRangeStr = dialogueCount === 0
              ? '无对话'
              : (diEnd - diStart === 1 ? `第${diStart + 1}句` : `第${diStart + 1}句-${diEnd}句`);

            // 从AI返回中获取数据
            let aiShotData = null;
            if (shotPrompts.length > 0) {
              aiShotData = shotPrompts.find((sp: any) => sp.subShotIndex === sIdx + 1) || shotPrompts[sIdx] || null;
            }

            const dialogueText = coveredDialogues.map((d: any) => `${d.character}：「${d.line}」`).join('，');
            const promptText = coveredDialogues.map((d: any) => `${d.character}说「${d.line}」`).join('，');

            const newShot = {
              id: aiShotData?.id || `vid_ch${chapterIndex + 1}_s${sceneIdx}_${sIdx + 1}`,
              sceneIndex: sceneIdx,
              subShotIndex: sIdx + 1,
              sceneTitle: aiShotData?.sceneTitle || scene.sceneTitle || scene.title || '',
              // 严格把控：景别/机位/地点以场景数据为准
              shotType: scene.shotType || aiShotData?.shotType || '中景',
              cameraAngle: scene.cameraAngle || aiShotData?.cameraAngle || '',
              location: scene.location || aiShotData?.location || '',
              dialogueRange: aiShotData?.dialogueRange && !aiShotData.dialogueRange.includes('X')
                ? aiShotData.dialogueRange
                : `覆盖的对话：${dialogueRangeStr}`,
              description: aiShotData?.description || (coveredDialogues.length > 0 ? `${coveredDialogues[0].character}与对手对话` : '场景氛围'),
              startFrame: aiShotData?.startFrame || '场景起始画面',
              // 严格把控：场景数据里的「镜头运动」优先，模型输出仅作兜底
              cameraMovement: scene.cameraMovement || aiShotData?.cameraMovement || (coveredDialogues.length > 0 ? '跟镜' : '固定'),
              action: aiShotData?.action || (coveredDialogues.length > 0 ? '角色对话交流' : '场景展示'),
              endFrame: aiShotData?.endFrame || '自然结束',
              // 严格把控：场景数据里的「时长」优先，模型输出归一化后兜底
              duration: scene.duration || normalizeDurationText(aiShotData?.duration) || '6秒',
              prompt: (aiShotData?.prompt || '') + (coveredDialogues.length > 0
                ? (aiShotData?.prompt && !aiShotData.prompt.includes(coveredDialogues[0]?.line)
                  ? `「${promptText}」，描述角色表情和肢体语言`
                  : '')
                : ''),
              style: aiShotData?.style || '写实风格',
              transition: aiShotData?.transition || '自然衔接',
              dialogues: sceneDialogues,
              coveredDialogues: coveredDialogues,
            };

            // 如果AI没有提供有效的prompt，使用自动生成的
            if (!newShot.prompt || newShot.prompt.trim().length < 10) {
              newShot.prompt = coveredDialogues.length > 0
                ? `${promptText}，描述角色表情、口型变化和肢体语言，镜头适当切换`
                : `${scene.sceneTitle || '场景'}，环境氛围展示`;
            }

            newlyGeneratedPrompts.push(newShot);
          }

          console.log(`[video-prompts] 场景${sceneIdx}生成完成，共${newlyGeneratedPrompts.length}个子镜头`);

          // 保存到数据库
          if (newlyGeneratedPrompts.length > 0) {
            try {
              await saveVideoPromptToDb(scriptId, chapterIndex, newlyGeneratedPrompts, sceneIdx);
              console.log(`[video-prompts] 场景${sceneIdx}保存成功`);
            } catch (saveError) {
              console.error(`[video-prompts] 场景${sceneIdx}保存失败:`, saveError);
            }

            if (!safeEnqueue(controller!, encoder, `data: ${JSON.stringify({
              type: 'scene_complete',
              sceneIndex: sceneIdx,
              prompts: newlyGeneratedPrompts,
              progress: i + 1,
              total: scenesToGenerate.length,
            })}${'\n\n'}`, 'scene_complete')) {
              isStreamClosed = true;
            }
          } else {
            if (!safeEnqueue(controller!, encoder, `data: ${JSON.stringify({
              type: 'scene_skip',
              sceneIndex: sceneIdx,
              reason: 'AI输出解析失败',
              progress: i + 1,
              total: scenesToGenerate.length,
            })}${'\n\n'}`, 'scene_skip')) {
              isStreamClosed = true;
            }
          }

          // 发送进度
          const percent = Math.round(((i + 1) / scenesToGenerate.length) * 100);
          if (!safeEnqueue(controller!, encoder, `data: ${JSON.stringify({
            type: 'progress',
            completed: i + 1,
            total: scenesToGenerate.length,
            percent,
          })}${'\n\n'}`, 'progress')) {
            isStreamClosed = true;
          }
        }

        // 发送完成事件
        if (!isStreamClosed) {
          safeEnqueue(controller!, encoder, `data: ${JSON.stringify({
            type: 'complete',
            totalPrompts: newlyGeneratedPrompts.length,
            message: '视频提示词生成完成',
          })}${'\n\n'}`, 'complete');
        }
      } catch (err: any) {
        console.error('[video-prompts] Error:', err);
        if (!isStreamClosed) {
          safeEnqueue(controller!, encoder, `data: ${JSON.stringify({
            type: 'error',
            message: err.message || '生成失败',
          })}${'\n\n'}`, 'error');
        }
      } finally {
        if (controller && !isStreamClosed) {
          try { controller.close(); } catch {}
        }
      }
    })();

    return response;
  } catch (error: any) {
    console.error('Video prompts generation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}