import { NextRequest } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { shortDramaManager, dramaWorkflowManager } from '@/storage/database';
import { aiConfigManager } from '@/storage/database/aiConfigManager';
import { getPromptsWithFallback } from '@/lib/prompt-helper';
import { buildScriptSceneDescriptions, buildShotsFromScriptScenes } from '@/lib/drama-scene-description';
import { buildH3SystemPrompt, buildH3UserPrompt, extractH3Prompt, sanitizeH3PromptForSingleShot, validateH3Prompt, buildComfyUIH3Prompt, isH3StructuredPrompt, type H3PromptInput } from '@/lib/minimax-h3-prompt';
import {
  AtMentionIndex, buildAtAssets, applyAtRules, scanAtTexts,
  detectExpectedAssets, validateAtCoverage, formatExpectedAtList, AT_MENTION_RULES, type AtAsset,
} from '@/lib/at-mentions';

export const maxDuration = 300;

function enc(obj: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

function safeEnqueue(ctrl: ReadableStreamDefaultController, obj: object): boolean {
  try {
    if (ctrl.desiredSize === null) return false;
    ctrl.enqueue(enc(obj));
    return true;
  } catch { return false; }
}

function safeClose(ctrl: ReadableStreamDefaultController) {
  try { ctrl.close(); } catch {}
}

/**
 * 从 AI 流式输出的累积文本中提取并修复 JSON。
 * 处理：代码块包裹、额外文字、未转义换行、未转义嵌套引号、截断的 JSON、嵌套JSON。
 * 返回解析后的对象，失败时返回空对象 {}。
 */
function parseAIResponse(text: string): any {
  if (!text || !text.trim()) return {};

  let raw = text.trim();

  // 1. 剥离代码块标记 ```json ... ``` 或 ``` ... ```
  raw = raw.replace(/^```(?:[a-z]*)\s*/i, '').replace(/\s*```$/i, '').trim();

  // 2. 找到第一个 { 或 [
  const validStarts = [raw.indexOf('{'), raw.indexOf('[')];
  const start = validStarts.filter(x => x !== -1).sort((a, b) => a - b)[0] ?? -1;
  if (start === -1) return {};
  raw = raw.slice(start);

  // 3. 逐字符扫描，修复字符串内的未转义换行和嵌套引号，同时找正确的结束位置
  let fixed = '';
  let depth = 0;
  let inString = false;
  let escape = false;
  let endIdx = -1;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escape) {
      fixed += ch;
      escape = false;
      continue;
    }

    if (ch === '\\') {
      fixed += ch;
      escape = true;
      continue;
    }

    if (ch === '"') {
      // 检查是否是字符串内的未闭合引号（前面有未匹配的开头引号）
      if (inString) {
        // 看下一个非空白字符是否是 , 或 } 或 ]，如果是则说明这是字符串结束
        let peek = i + 1;
        while (peek < raw.length && /[\s]/.test(raw[peek])) peek++;
        if (peek >= raw.length || raw[peek] === ',' || raw[peek] === '}' || raw[peek] === ']') {
          // 这是合法的字符串结束引号
          inString = false;
          fixed += ch;
          continue;
        }
        // 这是字符串内的嵌套引号，转义它
        fixed += '\\"';
        continue;
      } else {
        // 字符串开始
        inString = true;
        fixed += ch;
        continue;
      }
    }

    // 在字符串外部处理结构字符
    if (!inString) {
      if (ch === '{' || ch === '[') {
        depth++;
        fixed += ch;
        continue;
      }
      if (ch === '}' || ch === ']') {
        depth--;
        fixed += ch;
        if (depth === 0) { endIdx = fixed.length; break; }
        continue;
      }
      fixed += ch;
      continue;
    }

    // 在字符串内部
    if (ch === '\n' || ch === '\r') {
      fixed += '\\n';
    } else {
      fixed += ch;
    }
  }

  // 如果没找到闭合括号，截取到最后一个 } 或 ]
  if (endIdx === -1) {
    const lastClose = Math.max(fixed.lastIndexOf('}'), fixed.lastIndexOf(']'));
    if (lastClose > 0) fixed = fixed.slice(0, lastClose + 1);
    else return {};
  } else {
    fixed = fixed.slice(0, endIdx);
  }

  // 4. 尝试解析
  let parsed: any = null;
  try {
    parsed = JSON.parse(fixed);
  } catch {
    // 5. 二次尝试：用正则提取
    parsed = extractFieldsByRegex(fixed);
  }

  // 6. 递归查找嵌套对象中的关键字段（处理 {"json": {"imagePrompt": "..."}} 这种情况）
  if (parsed && typeof parsed === 'object') {
    parsed = flattenNestedFields(parsed);
  }

  return parsed || {};
}

/**
 * 递归扁平化嵌套对象，提取关键字段到顶层。
 * 处理AI返回的嵌套结构如 {"json": {"imagePrompt": "..."}} 或 {"data": {"prompt": "..."}}
 */
function flattenNestedFields(obj: any, depth = 0): any {
  if (depth > 5 || !obj || typeof obj !== 'object') return obj;

  const targetFields = ['imagePrompt', 'prompt', 'videoPrompt', 'description', 'startFrame', 'endFrame',
    'cameraMovement', 'characterAction', 'stateNote', 'characterIds', 'scene'];

  const result = { ...obj };

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      // 检查嵌套对象中是否有我们需要的字段
      const nested = flattenNestedFields(val, depth + 1);
      for (const field of targetFields) {
        if (nested[field] && !result[field]) {
          result[field] = nested[field];
        }
      }
    }
  }

  return result;
}

/**
 * 清洗提示词文本，移除代码标记、JSON、markdown符号、纯英文内容等垃圾
 */
function cleanPromptText(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();

  // 移除markdown代码块包裹
  cleaned = cleaned.replace(/^```(?:json|markdown|text)?\s*/i, '').replace(/\s*```$/i, '');

  // 移除开头的JSON键名包裹（如 {"imagePrompt":" 或 "imagePrompt": "）
  cleaned = cleaned.replace(/^["']?\s*(?:imagePrompt|prompt|description|videoPrompt|startFrame|endFrame|text|content|output|result|json|data)\s*["']?\s*[:=]\s*["']?/i, '');

  // 移除结尾的JSON闭合符号
  cleaned = cleaned.replace(/["']?\s*[}\]]\s*$/, '');

  // 移除markdown图片/链接语法
  cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  cleaned = cleaned.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // 如果内容以 { 或 [ 开头且无法提取有效中文，尝试从内部提取中文
  if (/^[{[]/.test(cleaned)) {
    const cnMatch = cleaned.match(/[\u4e00-\u9fa5][\u4e00-\u9fa5，。！？、；：""''（）\s\w@]{15,}/);
    if (cnMatch) {
      cleaned = cnMatch[0];
    }
  }

  // 检测中文占比，如果中文占比低于30%，认为是英文/代码，返回空
  const cnChars = (cleaned.match(/[\u4e00-\u9fa5]/g) || []).length;
  const totalChars = cleaned.replace(/\s/g, '').length;
  if (totalChars > 10 && cnChars / totalChars < 0.3) {
    // 尝试从英文中提取中文部分
    const cnSegments = cleaned.match(/[\u4e00-\u9fa5][\u4e00-\u9fa5，。！？、；：""''（）\s\w@]{10,}/g);
    if (cnSegments && cnSegments.length > 0) {
      cleaned = cnSegments.sort((a, b) => b.length - a.length)[0];
    } else {
      return ''; // 主要是英文/代码，丢弃
    }
  }

  // 清理多余的转义符号
  cleaned = cleaned.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, ' ');

  // 移除开头的引号和冒号
  cleaned = cleaned.replace(/^["'：:]+\s*/, '');

  return cleaned.trim();
}

/**
 * 确保对白被包含在提示词中（程序化兜底）
 * 如果 shot 有对白但 prompt 中未包含对白原文，则自动追加
 */
function ensureDialogueInPrompt(prompt: string, dialogue: string | null | undefined): string {
  if (!dialogue || !dialogue.trim()) return prompt;
  if (!prompt || !prompt.trim()) return prompt;

  const dialogueText = dialogue.trim();
  // 提取对白中的关键台词内容（去除角色名前缀，只保留台词部分）
  const lines = dialogueText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return prompt;

  // 检查 prompt 是否包含了对白的核心内容
  let promptLower = prompt.toLowerCase();
  let containsDialogue = false;

  // 检查每一行对白是否被包含
  let coveredLines = 0;
  for (const line of lines) {
    // 提取台词部分（角色名：台词 -> 台词）
    const dialoguePart = line.includes('：') ? line.split('：').slice(1).join('：').trim() : line;
    const dialoguePartClean = dialoguePart.replace(/[""'']/g, '').trim();
    
    if (dialoguePartClean.length > 2 && promptLower.includes(dialoguePartClean.toLowerCase())) {
      coveredLines++;
    }
  }

  // 如果超过50%的对白行已被包含，认为对白已集成
  if (coveredLines >= Math.ceil(lines.length * 0.5)) {
    return prompt;
  }

  // 对白未充分包含，追加到 prompt 末尾
  const formattedDialogue = lines.map(line => {
    // 确保格式统一：角色名："台词"
    if (line.includes('：') && !line.includes('"')) {
      const [charName, ...rest] = line.split('：');
      const dialogueContent = rest.join('：').trim();
      return `${charName.trim()}："${dialogueContent}"`;
    }
    return line;
  }).join(' ');

  return `${prompt}\n\n【对白原文】${formattedDialogue}`;
}

/**
 * 当 JSON 解析完全失败时，用正则从文本中提取已知字段。
 */
function extractFieldsByRegex(text: string): any {
  const fields = ['startFrame', 'endFrame', 'prompt', 'videoPrompt', 'description',
    'cameraMovement', 'characterAction', 'stateNote', 'imagePrompt'];
  const result: any = {};
  for (const field of fields) {
    // 匹配 "field":"value" 或 "field": "value"，value 可以包含转义引号
    const regex = new RegExp(`"${field}"\\s*:\\s*"([^"]*(?:"[^"]*)*?)"`, 'g');
    const match = regex.exec(text);
    if (match && match[1]) {
      result[field] = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
    }
  }
  return result;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const payload = getUserFromToken(request.headers.get('authorization'));
  if (!payload) return new Response('未授权', { status: 401 });

  const { id: dramaId } = await params;
  const body = await request.json();
  const { type, episodeId, configId, style, customSystemPrompt, customUserPromptTpl, promptStyle, referenceImages, referenceVideos, referenceAudios, videoDuration, h3Mode, shotId } = body as {
    type: 'image' | 'video';
    episodeId: string;
    configId?: string;
    style?: string;
    customSystemPrompt?: string;
    customUserPromptTpl?: string;
    promptStyle?: 'standard' | 'minimax-h3';
    referenceImages?: number;
    referenceVideos?: number;
    referenceAudios?: number;
    videoDuration?: number;
    h3Mode?: 'T2VA' | 'I2VA' | 'FL2VA' | 'L2VA' | 'Ref2VA';
    shotId?: string;
  };

  const isH3Mode = promptStyle === 'minimax-h3' && type === 'video';

  if (!episodeId) return new Response(JSON.stringify({ error: '缺少 episodeId' }), { status: 400 });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 1. 获取分集 & 分镜
        const episode = await shortDramaManager.getEpisodeById(episodeId);
        if (!episode) { safeEnqueue(controller, { type: 'error', message: '分集不存在' }); return safeClose(controller); }

        let shots = await dramaWorkflowManager.getShotsByEpisodeId(episodeId);

        // 2. 始终先刷新分镜的 sceneDescription 为剧本原文
        let screenplay = episode.screenplay;
        if (!screenplay && episode.sourceScriptChapterIndex != null) {
          try {
            const drama = await shortDramaManager.getById(dramaId);
            if (drama?.scriptId) {
              const { scriptManager } = await import('@/storage/database');
              const script = await scriptManager.getScriptById(drama.scriptId);
              const chapters = Array.isArray(script?.chapters) ? script.chapters : [];
              screenplay = chapters[episode.sourceScriptChapterIndex]?.screenplay || null;
            }
          } catch {}
        }
        // 尝试 episode.scenes 字段作为回退
        if (!screenplay && (episode as any).scenes) {
          try {
            const s2 = JSON.parse((episode as any).scenes);
            if (s2 && (Array.isArray(s2) || Array.isArray(s2?.scenes))) {
              screenplay = JSON.stringify(Array.isArray(s2) ? s2 : s2.scenes);
            }
          } catch {}
        }

        if (screenplay) {
          const sceneDescs = buildScriptSceneDescriptions(screenplay);
          if (sceneDescs.length > 0) {
            if (!shots.length) {
              // 无分镜：创建新分镜
              safeEnqueue(controller, { type: 'status', message: '从剧本创建分镜...' });
              const shotObjs = buildShotsFromScriptScenes(dramaId, episodeId, payload.userId, sceneDescs);
              await dramaWorkflowManager.bulkCreateShots(shotObjs);
              shots = await dramaWorkflowManager.getShotsByEpisodeId(episodeId);
              safeEnqueue(controller, { type: 'status', message: `已创建 ${shots.length} 个分镜` });
            } else {
              // 有分镜：更新 sceneDescription（1:1映射）
              safeEnqueue(controller, { type: 'status', message: '刷新分镜场景描述...' });
              const sceneCount = sceneDescs.length;
              let refreshed = 0;
              for (let i = 0; i < shots.length; i++) {
                const shot = shots[i];
                let finalSceneDesc: string | null = null;
                let finalDialogue: string | null = null;
                if (i < sceneCount) {
                  finalSceneDesc = sceneDescs[i].rawText;
                  if (sceneDescs[i].dialogueLines.length > 0) {
                    finalDialogue = sceneDescs[i].dialogueLines.join('\n');
                  }
                } else if (sceneCount > 0) {
                  finalSceneDesc = sceneDescs[sceneCount - 1].rawText;
                  if (sceneDescs[sceneCount - 1].dialogueLines.length > 0) {
                    finalDialogue = sceneDescs[sceneCount - 1].dialogueLines.join('\n');
                  }
                }
                if (finalSceneDesc && (finalSceneDesc !== shot.sceneDescription || finalDialogue !== shot.dialogue)) {
                  const payload2: any = { sceneDescription: finalSceneDesc };
                  if (finalDialogue) {
                    payload2.dialogue = finalDialogue;
                    payload2.ttsText = finalDialogue;
                    payload2.subtitle = finalDialogue.split('\n')[0];
                  }
                  await dramaWorkflowManager.updateShot(shot.id, payload2);
                  refreshed++;
                }
              }
              if (refreshed > 0) {
                shots = await dramaWorkflowManager.getShotsByEpisodeId(episodeId);
                safeEnqueue(controller, { type: 'status', message: `已刷新 ${refreshed} 个分镜场景描述` });
              }
            }
          }
        }

        if (!shots.length) { safeEnqueue(controller, { type: 'error', message: '分集剧本内容不存在或格式不支持' }); return safeClose(controller); }

        // 3. 获取 AI 配置
        let config: any = null;
        if (configId) {
          const c = await aiConfigManager.getConfigById(configId);
          if (c && (!c.modelType || c.modelType === 'text')) config = c;
        }
        const apiUrl = config?.apiUrl || process.env.AI_API_URL || process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
        const apiKey = config?.apiKey || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
        const model = config?.model || process.env.AI_MODEL || 'deepseek-v4-flash';
        if (!apiKey) { safeEnqueue(controller, { type: 'error', message: '缺少AI API密钥，请在AI设置中配置文字大模型，或在服务器设置 AI_API_KEY 环境变量' }); return safeClose(controller); }

        // 4. 构建上下文
        const characters = await dramaWorkflowManager.getCharactersByDramaId(dramaId);
        const scenes = await dramaWorkflowManager.getScenesByDramaId(dramaId);
        const items = await dramaWorkflowManager.getItemsByDramaId(dramaId);

        // ── 🛡️ 统一 @ 提及规则（共享库 at-mentions）──
        // 生成后规范化：别称/漏字/错字 @ → @登记名；漏 @ 的登记名自动补 @；无法识别的 @ 降级纯文本。
        // 长名优先单趟扫描，避免短名截断长名（如 "@橘猫@蛋子"）。
        const atAssets: AtAsset[] = buildAtAssets(characters, scenes, items);
        const atIndex = new AtMentionIndex(atAssets);

        const repairAtSymbols = (text: string): string => {
          if (!text) return '';
          return applyAtRules(text, atIndex).text;
        };

        // 本镜头必 @ 清单：以分镜 characterIds 为权威角色来源，叠加【画面描述】中检测到的场景/物品/角色。
        // 注意：不使用对白/旁白做检测源——对白可能提及画外人物或道具，强制 @ 会错误挂载参考图。
        const buildExpectedAssets = (shot: any): AtAsset[] => {
          const expected: AtAsset[] = [];
          const seenKeys = new Set<string>();
          const pushAsset = (a: AtAsset | null) => {
            if (!a) return;
            const key = a.id || a.name;
            if (!seenKeys.has(key)) { seenKeys.add(key); expected.push(a); }
          };
          let charIds: string[] = [];
          try { charIds = Array.isArray(shot.characterIds) ? shot.characterIds : JSON.parse(shot.characterIds || '[]'); } catch { /* ignore */ }
          for (const cid of charIds) pushAsset(atIndex.findByKey(cid));
          // 仅画面描述（含动作/环境）作为场景/物品检测源
          const visualText = shot.sceneDescription || '';
          for (const a of detectExpectedAssets(visualText, atIndex)) {
            // 角色以 characterIds 为权威；画面中出现但 characterIds 漏掉的角色也补入（去重）
            pushAsset(a);
          }
          return expected;
        };

        // @ 校验未通过时的重试反馈文案
        const buildAtFeedback = (missing: ReturnType<typeof validateAtCoverage>, unresolved: { token?: string }[]): string => {
          const lines: string[] = ['', '=== @提及校验未通过，必须修正后【重新输出完整结果】 ==='];
          if (missing.length) {
            lines.push('以下资产本镜头必须出现，但你的提示词中【完全没有提及】（请在画面描述中自然加入，并在登记名正前方紧接 @，逐字使用，一个都不能少）：');
            for (const iss of missing) {
              const a = iss.asset!;
              const label = a.type === 'character' ? '角色' : a.type === 'scene' ? '场景' : '物品';
              lines.push(`- ${label}「${a.name}」→ 必须写作 @${a.name}`);
            }
          }
          if (unresolved.length) {
            lines.push('以下 @ 无法在资产登记名列表中识别（严禁使用别称/简称/漏字/错字/自造名）：');
            for (const iss of unresolved) lines.push(`- @${iss.token} → 请核对资产列表，改用正确登记名逐字 @`);
          }
          lines.push('请严格遵守【@提及规则】：@ 后必须逐字使用资产列表中的登记名；必@资产一个都不能少；只允许 @ 列表内登记名。现在重新输出完整内容。');
          return lines.join('\n');
        };

        // 5. 过滤待生成分镜（已有提示词的跳过，支持断点续传）
        // 如果指定了 shotId，则只重新生成该分镜（忽略已有提示词状态）
        let pendingShots: any[];
        if (shotId) {
          const targetShot = shots.find((s: any) => s.id === shotId);
          pendingShots = targetShot ? [targetShot] : [];
        } else {
          pendingShots = type === 'image'
            ? shots.filter((s: any) => !s.imagePrompt)
            : shots.filter((s: any) => !s.videoPrompt);
        }
        const skippedCount = shots.length - pendingShots.length;

        safeEnqueue(controller, {
          type: 'start', total: shots.length,
          pending: pendingShots.length, skipped: skippedCount, promptType: type,
        });

        if (pendingShots.length === 0) {
          safeEnqueue(controller, { type: 'done', saved: 0, total: shots.length, skipped: skippedCount });
          return safeClose(controller);
        }

        // 6. 构建系统提示词（一次性构建，所有分镜共用）
        let systemPrompt = '';
        let imgUserTpl: string | null = null;

        if (type === 'image') {
          const sampleChar = characters[0]?.name || '角色名';
          const sampleScene = scenes[0]?.name || '场景名';
          const sampleItem = items[0]?.name || '道具名';

          const charList = characters.map((c: any) => `  - ID:${c.id} 名字:${c.name}${c.appearance ? ' 外貌:' + c.appearance : ''}`).join('\n');
          const sceneList = scenes.map((s: any) => `  - ${s.name}${s.description ? '：' + s.description : ''}${s.atmosphere ? ' 氛围:' + s.atmosphere : ''}`).join('\n');
          const itemList = items.map((i: any) => `  - ${i.name}${i.description ? '：' + i.description : ''}`).join('\n');
          const { systemPrompt: dbSystem, userPrompt: dbUserTpl } = await getPromptsWithFallback(
            'image-prompts-system',
            `你是一位顶级影视分镜师，精通AI绘画提示词技术。将剧本场景原文转化为具有叙事张力和电影质感的中文分镜画面提示词。核心原则：从剧本原文中提取最具戏剧张力的那一帧，让画面本身就在讲故事。`
            ,
            undefined,
            {
              text: [
                pendingShots.map((s: any) => [s.sceneDescription, (s as any).dialogue].filter(Boolean).join(' ')).join('\n'),
                charList,
                sceneList,
                itemList,
                style,
              ].filter(Boolean).join('\n'),
            }
          );
          
          const activeSystem = customSystemPrompt?.trim() || dbSystem;
          imgUserTpl = customUserPromptTpl?.trim() || dbUserTpl || null;

          systemPrompt = [
            activeSystem,
            '',
            '【剧本原文解析规则 — 必须严格遵守】',
            '你将收到"剧本场景原文"，包含以下结构化内容，必须逐一解析并转化为视觉元素：',
            '• 【场景N】场景标题 → 提取地点（内/外景）、时间、环境类型',
            '• 场景描述 → 转化为环境、光线、色调、氛围',
            '• 动作描写 → 转化为角色姿态、位置、互动',
            '• [对白] → 必须体现：说话角色的表情、口型变化、手势、听话角色的反应',
            '• [承上启下] → 必须承接上一分镜的结束状态',
            '• [镜头指示] → 转化为景别（远景/中景/特写）、角度、构图',
            '',
            '【对白集成规则 — 关键】',
            '当剧本原文包含[对白]时，imagePrompt中必须体现：',
            '• 说话角色：谁在说话，表情（愤怒/微笑/震惊等），口型状态，手势',
            '• 对话场景：角色站位关系，互动氛围',
            '• 听话角色：反应表情，肢体语言',
            '',
            '【分镜连贯性规则 — 关键】',
            '• 你将收到前一分镜的结束状态描述，必须确保当前分镜的起始状态与之自然衔接',
            '• 同一角色跨分镜外貌/服装/发型保持一致',
            '• 场景光线/色调跨分镜保持一致',
            '',
            '【提示词结构要求】',
            '每个imagePrompt必须按以下结构组织（按顺序）：',
            '1. 景别与构图：远景/中景/特写 + 构图描述',
            '2. 角色与动作：角色名 + 姿态/动作/表情/口型',
            '3. 环境与光线：地点 + 时间 + 光线方向 + 色调',
            '4. 对白视觉化：说话者 + 表情/手势 + 对方反应（如有对白）',
            '5. 氛围与风格：情绪氛围 + 艺术风格',
            '',
            charList ? `【可用角色列表】（@ 后必须逐字使用此表中的登记名）:\n${charList}` : '',
            sceneList ? `【可用场景列表】（@ 后必须逐字使用此表中的登记名）:\n${sceneList}` : '',
            itemList ? `【可用物品列表】（@ 后必须逐字使用此表中的登记名）:\n${itemList}` : '',
            AT_MENTION_RULES,
            `【风格要求】: ${style || 'cinematic, photorealistic'}`,
            '',
            '【输出格式强制要求】',
            '1. 只输出一个合法的 JSON 对象，不要有任何其他文字、解释、思考过程或 Markdown 代码块（绝对禁止使用 ```json 或 ``` 包裹）。',
            '2. JSON 的第一个字符必须是 {，最后一个字符必须是 }，不要有任何前缀或后缀文字。',
            `3. 正确示例格式：{"imagePrompt":"@${sampleChar}蹲在@${sampleScene}中，手持@${sampleItem}，眼神骤然亮起面露震惊，黄昏侧逆光，电影感画面，8K分辨率","characterIds":["角色ID1"]}`,
            '4. imagePrompt 字段必须使用【纯中文】撰写，包含完整、自包含的视觉描述，80-200字。',
            '5. imagePrompt 必须忠实还原剧本原文，不得添加原文没有的元素，不得脱离原文自由发挥。',
            '6. 有对白时imagePrompt必须体现说话者表情/口型/手势和听话者反应。',
            '7. 严禁使用英文撰写imagePrompt，严禁输出英文句子或段落。',
            '8. 严禁返回嵌套JSON结构（如 {"json": {...}} 或 {"data": {...}}），imagePrompt必须直接在最外层。',
            '9. 角色名、场景名、物品名必须在名字前方加@符号。',
            '10. 严禁输出图片URL、![]()等富文本地址。',
          ].filter(Boolean).join('\n');
        } else {
          const sampleChar = characters[0]?.name || '角色名';
          const sampleScene = scenes[0]?.name || '场景名';
          const sampleItem = items[0]?.name || '道具名';

          // MiniMax H3 专用提示词模式（仅 ComfyUI 使用）
          if (promptStyle === 'minimax-h3') {
            const charList = characters.map((c: any) => `- ${c.name}${c.appearance ? '，外貌：' + c.appearance : ''}`).join('\n');
            const sceneList = scenes.map((s: any) => `- ${s.name}${s.description ? '：' + s.description : ''}`).join('\n');
            const itemList = items.map((i: any) => `- ${i.name}${i.description ? '：' + i.description : ''}`).join('\n');

            systemPrompt = [
              buildH3SystemPrompt(),
              '',
              style ? `【风格要求】: ${style}` : '',
              charList ? `【角色列表】\n${charList}` : '',
              sceneList ? `【场景列表】\n${sceneList}` : '',
              itemList ? `【道具列表】\n${itemList}` : '',
              '',
              h3Mode ? `【指定模式】: ${h3Mode} — 必须严格按照此模式的 Context-IR 格式生成` : '',
              '【重要提示】',
              '1. 输出必须是可直接提交给 H3 模型的 Context-IR 格式提示词',
              '2. 不再输出中文翻译版本',
              '3. 参考图用 <Picture 1>、<Picture 2> 标记',
              '4. Shot 用 [Shot N] 标记',
              '5. 对白用 <d>[中文] 台词</d> 格式',
              '6. 说话人用 (S1)、(S2) 等稳定 ID',
              '7. 结构字段和 prose 用英文，对白/歌词/画面文字保留原语言',
            ].filter(Boolean).join('\n');
          } else {
          const charRef = characters.length > 0
            ? `\n主要角色列表（@ 后必须逐字使用此表中的登记名，不要显示图片URL）:\n${characters.map((c: any) => `- ${c.name}${c.appearance ? '，外貌：' + c.appearance : ''}`).join('\n')}` : '';
          const sceneRef = scenes.length > 0
            ? `\n场景设定列表（@ 后必须逐字使用此表中的登记名，不要显示图片URL）:\n${scenes.map((s: any) => `- ${s.name}${s.description ? '：' + s.description : ''}`).join('\n')}` : '';
          const itemRef = items.length > 0
            ? `\n关键道具列表（@ 后必须逐字使用此表中的登记名，不要显示图片URL）:\n${items.map((i: any) => `- ${i.name}${i.description ? '：' + i.description : ''}`).join('\n')}` : '';
          const { systemPrompt: dbSystem2 } = await getPromptsWithFallback(
            'video-prompts-system',
            `你是一位顶级影视视觉导演，精通AI视频生成技术。将剧本文字转化为精准、可执行的AI视频提示词，让AI视频模型"看到"一个完整的动态片段（3-10秒）。`
            ,
            undefined,
            {
              text: [
                pendingShots.map((s: any) => [s.sceneDescription, (s as any).dialogue, s.cameraMovement].filter(Boolean).join(' ')).join('\n'),
                charRef,
                sceneRef,
                itemRef,
              ].filter(Boolean).join('\n'),
            }
          );

          const activeSystem2 = customSystemPrompt?.trim() || dbSystem2;

          systemPrompt = [
            activeSystem2,
            '',
            '【剧本原文解析规则 — 必须严格遵守】',
            '你将收到"剧本场景原文"，包含以下结构化内容，必须逐一解析并转化为视频提示词字段：',
            '• 【场景N】场景标题 → startFrame / endFrame 的场景定位',
            '• 场景描述 → stateNote（场景氛围、环境说明）',
            '• 动作描写 → characterAction（角色动作过程）',
            '• [对白] → prompt 中必须包含对白原文和说话者动作',
            '• [承上启下] → startFrame 必须体现承接关系',
            '• [镜头指示] → cameraMovement（运镜方式）',
            '',
            '【对白集成规则 — 关键】',
            '当剧本原文包含[对白]时，必须在以下字段中体现：',
            '• prompt字段：必须包含 角色名（语气/表情）："台词原文"',
            '• characterAction字段：必须描述说话者的口型、表情变化、手势',
            '• startFrame / endFrame：必须体现角色对话时的站位关系',
            '',
            '【分镜连贯性规则 — 关键】',
            '• 你将收到前一分镜的结束状态描述，startFrame必须自然承接该状态',
            '• 同一角色跨分镜外貌/服装/发型保持一致',
            '• 场景光线/色调跨分镜保持一致',
            '• endFrame必须为下一分镜的startFrame做铺垫',
            '',
            '【字段职责】',
            '• startFrame：视频第一帧的静态画面，角色位置+姿态+场景初始状态',
            '• endFrame：视频最后一帧的静态画面，角色结束姿态+场景结束状态',
            '• prompt：完整视频描述（起始→过程→结束），必须包含对白（如有）',
            '• cameraMovement：运镜方式（推/拉/摇/移/跟/升降/固定），明确起止',
            '• characterAction：角色完整动作过程，含对白时的口型/表情',
            '• stateNote：场景氛围、光线、情绪补充',
            '',
            charRef, sceneRef, itemRef,
            '',
            AT_MENTION_RULES,
            '',
            '【输出格式强制要求】',
            '1. 只输出一个合法的 JSON 对象，不要有任何其他文字、解释、思考过程或 Markdown 代码块（绝对禁止使用 ```json 或 ``` 包裹）。',
            '2. JSON 的第一个字符必须是 {，最后一个字符必须是 }，不要有任何前缀或后缀文字。',
            '3. 所有字符串字段值必须用双引号包裹，不允许字段值内含有未转义的双引号或换行符。',
            '4. 所有描述字段（prompt、startFrame、endFrame、cameraMovement、characterAction、stateNote）必须使用【纯中文】撰写，严禁输出英文句子或段落。',
            '5. 严禁返回嵌套JSON结构（如 {"json": {...}} 或 {"data": {...}}），所有字段必须直接在最外层。',
            `6. 正确示例：{"startFrame":"@${sampleChar}蹲在@${sampleScene}中，手持@${sampleItem}","endFrame":"@${sampleChar}瞳孔收缩，面露震惊","prompt":"@${sampleChar}翻找时骤停，瞳孔收缩蓝光闪烁，@${sampleChar}（低声）：\\"叮——检测到高价值物品\\"","cameraMovement":"中景固定，缓慢推进至面部特写","characterAction":"@${sampleChar}瞪大双眼，嘴微张，身体僵硬","stateNote":"黄昏外景，侧逆光，紧张发现的氛围"}`,
            '7. 有对白时prompt必须包含对白原文，格式：角色名（表情/语气）："台词原文"，对白中的角色名同样要带@。',
            '8. 所有角色名、场景名、物品名必须逐字使用资产列表中的登记名，并紧接在@符号后；严禁自造名/简称/漏字。',
            '9. startFrame必须承接上一分镜endFrame，保证连贯性。',
            '10. 严禁输出图片URL、![]()等富文本地址。',
          ].filter(Boolean).join('\n');
          }
        }

        // 7. 逐个分镜生成（每个独立AI调用，流式输出，即时保存，支持断点续传）
        // 构建分镜查找表，用于获取前后分镜上下文以保证连贯性
        const shotLookup = new Map(shots.map((s: any) => [s.id, s]));
        const shotIndexMap = new Map<string, number>();
        shots.forEach((s: any, idx: number) => shotIndexMap.set(s.id, idx));
        
        // 重新生成模式：使用更高温度 + 差异化指令
        const isRegenerateMode = !!shotId;
        const regenTemperature = isRegenerateMode ? 0.9 : 0.3;
        
        let saved = 0;
        let shotIndex = 0;
        for (const shot of pendingShots) {
          // 在处理连续分镜之间加入 1.2 秒的间隔，防止由于请求过快触发服务商 QPS / 并发 / RPM 限制
          if (shotIndex > 0) {
            await new Promise(resolve => setTimeout(resolve, 1200));
          }
          shotIndex++;

          safeEnqueue(controller, { type: 'generating', shotId: shot.id, shotNumber: shot.shotNumber, pending: pendingShots.length });

          // 获取前后分镜上下文用于连贯性
          const curIdx = shotIndexMap.get(shot.id) ?? -1;
          const prevShot = curIdx > 0 ? shots[curIdx - 1] : null;
          const nextShot = curIdx < shots.length - 1 ? shots[curIdx + 1] : null;
          
          // 构建当前分镜用户消息 — 结构化呈现剧本原文各部分
          let userContent: string;
          let h3Input: H3PromptInput | undefined;
          let forcedSceneAssetNameCache: string | undefined;
          
          // 从sceneDescription中提取结构化信息
          const sceneDesc = shot.sceneDescription || '';
          const dialogue = (shot as any).dialogue || '';
          
          // 构建连贯性上下文
          const continuityParts: string[] = [];
          if (prevShot) {
            const prevDesc = prevShot.sceneDescription || '';
            const prevDialogue = (prevShot as any).dialogue ? ` [对白] ${(prevShot as any).dialogue}` : '';
            continuityParts.push(`【前一分镜(镜头${prevShot.shotNumber})结束状态】:${prevDesc.slice(0, 200)}${prevDialogue}`);
          } else {
            continuityParts.push(`【前一分镜(镜头${shot.shotNumber})结束状态】:这是第一个分镜，需要建立场景和人物关系`);
          }
          if (nextShot) {
            const nextDesc = nextShot.sceneDescription || '';
            const nextDialogue = (nextShot as any).dialogue ? ` [对白] ${(nextShot as any).dialogue}` : '';
            continuityParts.push(`【后一分镜(镜头${nextShot.shotNumber})起始预告】:${nextDesc.slice(0, 200)}${nextDialogue}`);
          }
          
          if (type === 'image') {
            const descParts: string[] = [];
            descParts.push(`=== 当前分镜(镜头${shot.shotNumber})剧本原文 ===`);
            descParts.push('');
            descParts.push(sceneDesc);
            if (dialogue) {
              descParts.push('');
              descParts.push('=== 对白内容(强制要求：提示词中必须体现对白的视觉元素，如说话者的表情、口型、手势、对方反应) ===');
              descParts.push('注意：不需要直接引用对白文字，但必须通过视觉细节体现对话场景！');
              descParts.push(dialogue);
            }
            descParts.push('');
            descParts.push(...continuityParts);
            descParts.push('');
            descParts.push('=== 本镜头必须 @ 的资产（逐一核对，缺一不可）===');
            descParts.push(formatExpectedAtList(buildExpectedAssets(shot)));
            descParts.push('');
            descParts.push('=== 任务要求 ===');
            descParts.push('请严格按照系统提示词的结构要求，从剧本原文中提取关键视觉元素，生成一个中文AI绘画提示词。必须包含：景别构图、角色姿态表情、环境光线、对白视觉化(如有)、氛围风格。');

            userContent = descParts.join('\n');
          } else if (isH3Mode) {
            // MiniMax H3 专用用户提示词构建
            // 注意：H3 是「1 个剧本分镜 = 1 条 12s 单镜头 H3 视频」的一一对应关系
            // 绝对禁止把下一分镜(nextShot)的对白/动作塞进来（会造成 AI 把下一分镜内容写进当前 H3 的第二个内部 Shot）
            // 因此这里只传 prevShotPrompt（前一分镜的结束状态，用于视觉/状态承接），不传 nextShotPreview

            // ---- 场景8 @漏写修复：解析「【场景N】XXX」标题，得到权威小场景名（优先使用具体房间/宿舍，不用大楼泛化）----
            const sceneTitleMatch = sceneDesc.match(/^[\s\u3000]*【场景[^】]*】[\s\u3000]*([^\n【（(\[]+)/);
            const sceneTitleName = sceneTitleMatch ? sceneTitleMatch[1].trim() : '';
            // 从画面描述中检测 scene 类型资产，优先挑选命中「场景标题名」的场景
            const descAssets = buildExpectedAssets(shot);
            let forcedSceneAssetName: string | undefined;
            if (sceneTitleName) {
              const sceneTypeAssets = descAssets.filter(a => a.type === 'scene');
              // 优先完全匹配
              forcedSceneAssetName = sceneTypeAssets.find(a => a.name === sceneTitleName)?.name;
              // 降级：双向 includes
              if (!forcedSceneAssetName) {
                forcedSceneAssetName = sceneTypeAssets.find(a =>
                  a.name.includes(sceneTitleName) || sceneTitleName.includes(a.name)
                )?.name;
              }
              // 再降级：对标题名做 atIndex 场景名精确匹配（允许标题带描述）
              if (!forcedSceneAssetName) {
                const byTitle = detectExpectedAssets(sceneTitleName, atIndex).find(a => a.type === 'scene');
                if (byTitle) forcedSceneAssetName = byTitle.name;
              }
            }
            // fallback: 若场景资产检测里没有明确场景名，用 buildExpectedAssets 里第一个 scene 名，再兜底 scenes[0]
            const fallbackScene = descAssets.find(a => a.type === 'scene')?.name;
            const effectiveSceneName = forcedSceneAssetName || fallbackScene || scenes[0]?.name;

            const expectedAssets = descAssets;
            const expectedAtText = formatExpectedAtList(expectedAssets);

            h3Input = {
              shotIndex: shot.shotNumber || (curIdx + 1),
              totalShots: shots.length,
              // ⚠️ 只用场景画面描述（剧本原文）生成 H3 提示词，其他叙事字段全部不传入
              sceneDescription: sceneDesc,
              dialogue: undefined,
              cameraMovement: undefined,
              characterAction: undefined,
              stateNote: undefined,
              duration: videoDuration || 10,
              referenceImages: referenceImages ?? ((shot as any).imageUrl ? 1 : 0),
              referenceVideos: referenceVideos ?? 0,
              referenceAudios: referenceAudios ?? 0,
              characterName: undefined,
              characterAppearance: undefined,
              sceneName: undefined,
              style: style || undefined,
              prevShotPrompt: undefined,
              nextShotPreview: undefined,
              isFinalShot: curIdx === shots.length - 1,
              forcedMode: h3Mode || undefined,
              expectedAtList: undefined,
              forcedSceneAssetName: undefined,
            };
            forcedSceneAssetNameCache = forcedSceneAssetName || fallbackScene || undefined;
            userContent = buildH3UserPrompt(h3Input);
          } else {
            const parts: string[] = [];
            parts.push(`=== 当前分镜(镜头${shot.shotNumber})剧本原文 ===`);
            parts.push('');
            parts.push(sceneDesc);
            if (dialogue) {
              parts.push('');
              parts.push('=== 对白内容(强制要求：prompt字段必须完整引用所有对白原文，格式：角色名（表情/语气）："台词原文") ===');
              parts.push('注意：每一句对白都必须出现在prompt中，不得省略或改写！');
              parts.push(dialogue);
            }
            parts.push('');
            parts.push(...continuityParts);
            parts.push('');
            parts.push('=== 本镜头必须 @ 的资产（逐一核对，缺一不可）===');
            parts.push(formatExpectedAtList(buildExpectedAssets(shot)));
            parts.push('');
            parts.push('=== 任务要求 ===');
            parts.push('请严格按照系统提示词的JSON结构，从剧本原文中提取信息，生成视频提示词的各字段。必须：');
            parts.push('1. startFrame承接前一分镜endFrame的状态');
            parts.push('2. 【最重要】有对白时prompt必须包含所有对白原文，完整引用每一句台词');
            parts.push('3. characterAction必须描述说话者的口型、表情、手势');
            parts.push('4. 忠实还原剧本原文，不得自由发挥');
            parts.push('5. 所有出场角色/所在场景/互动道具必须按上方"必@清单"逐字加@，严禁自造名或简称');

            userContent = parts.join('\n');
          }

          // 重新生成模式：添加旧提示词作为上下文 + 差异化指令
          if (isRegenerateMode && userContent) {
            const oldPrompt = type === 'image'
              ? (shot.imagePrompt || '')
              : (shot.videoPrompt || '');
            
            let regenSuffix = '\n\n=== 重新生成要求（重要） ===\n';
            if (oldPrompt) {
              regenSuffix += `【之前生成的提示词】\n${oldPrompt.slice(0, 500)}\n\n`;
              regenSuffix += '请生成一个与上面不同的版本：\n';
            } else {
              regenSuffix += '这是重新生成请求，请提供一个新的提示词版本：\n';
            }
            regenSuffix += '1. 使用不同的景别或构图方式（如特写→中景、俯视→平视）\n';
            regenSuffix += '2. 强调不同的视觉焦点或细节描述\n';
            regenSuffix += '3. 尝试不同的光线、色彩或氛围营造\n';
            regenSuffix += '4. 保持核心剧情元素不变，但表达方式要明显不同\n';
            regenSuffix += '5. 使用新的词汇和句式，避免与之前的提示词重复';
            userContent += regenSuffix;
          }

          try {
            // 验证图片提示词是否有效（中文为主、长度足够、不含代码）
            const isValidImagePrompt = (text: string): boolean => {
              if (!text || text.trim().length < 15) return false;
              const cleaned = cleanPromptText(text);
              if (cleaned.length < 15) return false;
              const cnChars = (cleaned.match(/[\u4e00-\u9fa5]/g) || []).length;
              const totalChars = cleaned.replace(/\s/g, '').length;
              if (totalChars < 10) return false;
              // 中文占比必须>=50%
              if (cnChars / totalChars < 0.5) return false;
              // 不能包含明显的JSON/代码标记
              if (/```|^\s*\{|^\s*\[|"imagePrompt"\s*:/.test(cleaned.slice(0, 50))) return false;
              return true;
            };

            // 验证视频提示词是否有效
            const isValidVideoPrompt = (text: string): boolean => {
              if (!text || text.trim().length < 10) return false;
              const cleaned = cleanPromptText(text);
              if (cleaned.length < 10) return false;
              const cnChars = (cleaned.match(/[\u4e00-\u9fa5]/g) || []).length;
              const totalChars = cleaned.replace(/\s/g, '').length;
              if (totalChars < 10) return false;
              if (cnChars / totalChars < 0.5) return false;
              if (/```|^\s*\{|^\s*\[|"prompt"\s*:/.test(cleaned.slice(0, 50))) return false;
              return true;
            };

            // 执行一次AI调用并返回累积文本。feedback/prevAssistant 用于内容重试时把校验问题反馈给 AI
            const callAIOnce = async (feedback?: string, prevAssistant?: string): Promise<string> => {
              let netAttempts = 0;
              const maxNetAttempts = 2;
              while (netAttempts <= maxNetAttempts) {
                try {
                  const messages: any[] = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent },
                  ];
                  if (feedback && prevAssistant) {
                    messages.push({ role: 'assistant', content: prevAssistant.slice(0, 6000) });
                    messages.push({ role: 'user', content: feedback });
                  }
                  const res = await fetch(`${apiUrl}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify({
                      model, temperature: regenTemperature, max_tokens: 2048, stream: true,
                      reasoning_effort: 'none',
                      messages,
                    }),
                  });
                  if (!res.ok) {
                    if (res.status === 429 || res.status === 401 || res.status === 403) {
                      netAttempts++;
                      if (netAttempts <= maxNetAttempts) {
                        await new Promise(r => setTimeout(r, netAttempts * 3000));
                        continue;
                      }
                    }
                    throw new Error(`AI接口错误: ${res.status}`);
                  }
                  const reader = res.body?.getReader();
                  if (!reader) throw new Error('AI流读取失败');
                  const dec = new TextDecoder();
                  let buf = '';
                  let accum = '';
                  while (true) {
                    const { done: d, value: v } = await reader.read();
                    if (d) break;
                    buf += dec.decode(v, { stream: true });
                    const ls = buf.split('\n');
                    buf = ls.pop() || '';
                    for (const ln of ls) {
                      if (!ln.startsWith('data: ')) continue;
                      const raw = ln.slice(6).trim();
                      if (raw === '[DONE]') break;
                      try {
                        const ck = JSON.parse(raw);
                        const delta = ck.choices?.[0]?.delta?.content || '';
                        if (delta) {
                          accum += delta;
                          safeEnqueue(controller, { type: 'token', shotId: shot.id, shotNumber: shot.shotNumber, content: delta });
                        }
                      } catch {}
                    }
                  }
                  reader.releaseLock();
                  return accum;
                } catch (err) {
                  netAttempts++;
                  if (netAttempts > maxNetAttempts) throw err;
                  await new Promise(r => setTimeout(r, netAttempts * 2000));
                }
              }
              throw new Error('AI调用失败');
            };

            // 带内容验证的重试循环（最多3次内容重试）
            let accum = '';
            let contentValid = false;
            let atFeedback = '';
            const maxContentRetries = 3;
            for (let contentRetry = 0; contentRetry < maxContentRetries; contentRetry++) {
              if (contentRetry > 0) {
                safeEnqueue(controller, { type: 'status', message: atFeedback
                  ? `镜头${shot.shotNumber} @提及校验未通过，第${contentRetry + 1}次重新生成...`
                  : `镜头${shot.shotNumber}内容质量不佳，第${contentRetry}次重新生成...` });
                await new Promise(r => setTimeout(r, 1500));
              }
              const feedbackThisRound = contentRetry > 0 ? atFeedback : '';
              accum = await callAIOnce(feedbackThisRound || undefined, feedbackThisRound ? accum : undefined);
              atFeedback = '';
              const parsed = parseAIResponse(accum);

              if (type === 'image') {
                let imgPrompt = parsed.imagePrompt || parsed.prompt || parsed.description || '';
                if (!imgPrompt) {
                  const parts = [parsed.scene, parsed.description, parsed.prompt, parsed.imagePrompt]
                    .filter(Boolean).map((p: any) => typeof p === 'string' ? p.trim() : '').filter(Boolean);
                  imgPrompt = parts.join(' ');
                }
                // 清洗并验证
                imgPrompt = cleanPromptText(imgPrompt);
                // 如果结构化提取失败，从原文提取最长中文片段
                if (!imgPrompt || imgPrompt.length < 15) {
                  const cnSegments = accum.match(/[\u4e00-\u9fa5][\u4e00-\u9fa5，。！？、；：""''（）《》…—\s\w@]{20,}/g);
                  if (cnSegments && cnSegments.length > 0) {
                    imgPrompt = cleanPromptText(cnSegments.sort((a, b) => b.length - a.length)[0]);
                  }
                }
                if (isValidImagePrompt(imgPrompt)) {
                  // ── @ 提及覆盖校验：漏 @ / 无效 @ 时带反馈重试 ──
                  const expected = buildExpectedAssets(shot);
                  const scan = scanAtTexts([imgPrompt], atIndex);
                  const missing = validateAtCoverage(scan.mentions, expected);
                  const unresolved = scan.issues.filter((i) => i.kind === 'unresolved');
                  if ((missing.length || unresolved.length) && contentRetry < maxContentRetries - 1) {
                    atFeedback = buildAtFeedback(missing, unresolved);
                    safeEnqueue(controller, { type: 'status', message: `镜头${shot.shotNumber} @提及校验：漏@ ${missing.length} 个、无效@ ${unresolved.length} 个，重新生成...` });
                    console.warn(`[PromptGen] Shot ${shot.shotNumber} @ retry ${contentRetry + 1}: missing=[${missing.map((i) => i.asset?.name).join(',')}] unresolved=[${unresolved.map((i) => i.token).join(',')}]`);
                    continue;
                  }
                  if (missing.length || unresolved.length) {
                    console.warn(`[PromptGen] Shot ${shot.shotNumber} @ issues remain after retries: missing=${missing.length} unresolved=${unresolved.length}`);
                  }
                  // 规范化修复（别称/漏字→登记名、漏@补@、无效@降级纯文本）
                  imgPrompt = repairAtSymbols(imgPrompt);
                  // 程序化兜底：确保对白被包含在图片提示词中
                  const shotDialogue = (shot as any).dialogue;
                  if (shotDialogue && shotDialogue.trim()) {
                    imgPrompt = ensureDialogueInPrompt(imgPrompt, shotDialogue);
                    imgPrompt = repairAtSymbols(imgPrompt);
                  }
                  const upd: any = { imagePrompt: imgPrompt.slice(0, 800) };
                  if (Array.isArray(parsed.characterIds) && parsed.characterIds.length > 0)
                    upd.characterIds = JSON.stringify(parsed.characterIds);
                  const result = await dramaWorkflowManager.updateShot(shot.id, upd);
                  if (result) { saved++; safeEnqueue(controller, { type: 'saved', shotId: shot.id, shotNumber: shot.shotNumber, imagePrompt: imgPrompt }); }
                  contentValid = true;
                  break;
                }
                console.warn(`[PromptGen] Shot ${shot.shotNumber} retry ${contentRetry + 1}: invalid content, first 200 chars:`, accum.slice(0, 200));
              } else if (isH3Mode) {
                // MiniMax H3 Context-IR 提示词解析 — 直接存储结构化格式
                const h3Result = extractH3Prompt(accum);
                if (h3Result && h3Result.h3Prompt && h3Result.h3Prompt.length > 30) {
                  // 【防线 3】单 Shot 隔离后处理 —— 即使 AI 违反规则也硬拉回正确边界
                  // ① 砍掉 detailed_description 里的第二个内部 [Shot N] 段落（防止跨场景合入）
                  // ② 剔除所有不在当前分镜对白里的 <d>…</d> 标签（防止泄漏下一分镜对白）
                  h3Result.h3Prompt = sanitizeH3PromptForSingleShot(h3Result.h3Prompt, dialogue || null);
                  // @ 规范化（别称/漏字→登记名、漏@补@、无效@降级纯文本）
                  // 注意：H3 主体是英文，repairAtSymbols 只对 @登记中文名 做归一化，不会把 "work journal" 英语词组改成 @工作日志。
                  h3Result.h3Prompt = repairAtSymbols(h3Result.h3Prompt);

                  // ── 🔴 H3 结构完整性校验（防线 1.5）：缺段就必须先补段，再进入 @校验 ──
                  // 之前的 bug：extractH3Prompt 在「结构不完整但字数 ≥50」时仍返回对象，导致残缺结构被保存。
                  // 这里再拦一次：结构不通过就带明确反馈重跑，优先补结构（否则 AI 不会在非结构文本里写 @）。
                  const structCheck = validateH3Prompt(h3Result.h3Prompt);
                  if (!structCheck.valid && contentRetry < maxContentRetries - 1) {
                    const structLines = [
                      `【H3 结构严重缺失 必须重写】你本次输出不符合 MiniMax H3 Context-IR（Ref2VA）六段式格式。`,
                      `要求必须完整包含这 6 段（段名用英文小写加冒号）：subject_definitions → summary → retention_analysis → detailed_description → overall_soundscape → non_diegetic_music。`,
                      `你的版本缺了 ${structCheck.issues.length} 段：${structCheck.issues.join('、')}。`,
                      `严禁只输出一段中文画面描述或通用剧本描述、严禁用中文段名替代英文、严禁段名漏冒号。`,
                      `之前已写入的规则须全部遵守：单 Shot 隔离（只允许一个 [Shot 1]）、对白数量与输入严格一致、强制权威场景名、必@清单。`,
                    ];
                    atFeedback = atFeedback ? atFeedback + '\n\n' + structLines.join('\n') : structLines.join('\n');
                    safeEnqueue(controller, {
                      type: 'status',
                      message: `镜头${shot.shotNumber} H3 结构校验：缺${structCheck.issues.length}段（${structCheck.issues.slice(0, 3).join(',')}${structCheck.issues.length > 3 ? '...' : ''}），重新生成...`
                    });
                    console.warn(`[PromptGen] H3 Shot ${shot.shotNumber} STRUCT retry ${contentRetry + 1}: missing=[${structCheck.issues.join(',')}]`);
                    continue; // 🔁 下一轮 AI 调用（含结构缺失明确反馈 + 之前的@反馈）
                  }
                  if (!structCheck.valid) {
                    console.warn(`[PromptGen] H3 Shot ${shot.shotNumber} STRUCT issues remain after max retries: ${structCheck.issues.join(',')}`);
                  }

                  // ── @ 提及覆盖校验（H3 专用，与 Image / 通用 Video 等价）──
                  // 对 summary / retention_analysis / detailed_description / subject_definitions 全部分段扫描 @提及
                  // 若 detectExpectedAssets 找到的资产未在 H3 中以 @中文名 形式出现，就把 buildAtFeedback 传给 AI 下一轮重试
                  const expected = buildExpectedAssets(shot);
                  const atScan = scanAtTexts([h3Result.h3Prompt], atIndex);
                  const missing = validateAtCoverage(atScan.mentions, expected);
                  const unresolved = atScan.issues.filter((i: any) => i.kind === 'unresolved');
                  if ((missing.length || unresolved.length) && contentRetry < maxContentRetries - 1) {
                    atFeedback = buildAtFeedback(missing, unresolved);
                    safeEnqueue(controller, {
                      type: 'status',
                      message: `镜头${shot.shotNumber} H3 @提及校验：漏@ ${missing.length} 个、无效@ ${unresolved.length} 个，重新生成...`
                    });
                    console.warn(`[PromptGen] H3 Shot ${shot.shotNumber} @ retry ${contentRetry + 1}: missing=[${missing.map((i: any) => i.asset?.name).join(',')}] unresolved=[${unresolved.map((i: any) => i.token).join(',')}]`);
                    // 额外硬警告：强制场景资产必须严格使用 forcedSceneAssetName 而非泛化名
                    if (forcedSceneAssetNameCache) {
                      // 若 forcedSceneAssetName 不在 @提及 里（或包含 broader fallback @阴司办事处大楼 而未包含 forcedSceneAssetName），显式反馈
                      const atText = atScan.mentions.map(m => m.name).join(' | ');
                      const hasForcedScene = forcedSceneAssetNameCache && atScan.mentions.some(m => m.name === forcedSceneAssetNameCache);
                      if (!hasForcedScene) {
                        atFeedback += `\n⚠️ 严重错误：本镜头【强制权威场景资产】是 @${forcedSceneAssetNameCache}，但你的 H3 中没有用这个登记名做@（可能错误地使用了上级/泛化场景名 @阴司办事处大楼 这类）。必须在summary/detailed_description里把地点全部统一写成 @${forcedSceneAssetNameCache}，否则将无限重试。`;
                      }
                    }
                    continue; // 🔁 回到 while 循环，用新的 atFeedback 作为 user prompt 追加内容，重新调用 AI
                  }
                  if (missing.length || unresolved.length) {
                    console.warn(`[PromptGen] H3 Shot ${shot.shotNumber} @ issues remain after max retries: missing=${missing.length} unresolved=${unresolved.length}`);
                  }

                  // 存储H3 Context-IR格式提示词
                  const h3Storage = JSON.stringify({
                    format: 'minimax-h3',
                    mode: h3Result.mode,
                    weightType: h3Result.weightType,
                    referenceCount: h3Result.referenceCount,
                    h3Prompt: h3Result.h3Prompt,
                  });
                  const result = await dramaWorkflowManager.updateShot(shot.id, { videoPrompt: h3Storage });
                  if (result) { 
                    saved++; 
                    safeEnqueue(controller, { 
                      type: 'saved', 
                      shotId: shot.id, 
                      shotNumber: shot.shotNumber, 
                      videoPrompt: h3Result.h3Prompt.slice(0, 100),
                      videoPromptJson: h3Storage,
                      h3Prompt: h3Result.h3Prompt,
                      h3WeightType: h3Result.weightType,
                      h3Mode: h3Result.mode,
                    }); 
                  }
                  contentValid = true;
                  break;
                }
                console.warn(`[PromptGen] H3 Shot ${shot.shotNumber} retry ${contentRetry + 1}: invalid H3 content, first 200 chars:`, accum.slice(0, 200));
              } else {
                // 视频提示词（标准JSON格式）— 先取原始字段（未修复），@ 校验通过后再规范化
                let promptText = cleanPromptText(parsed.prompt || parsed.videoPrompt || parsed.description || '');
                const rawStart = cleanPromptText(parsed.startFrame || '');
                const rawEnd = cleanPromptText(parsed.endFrame || '');
                const stateNote = cleanPromptText(parsed.stateNote || '');
                const rawCamera = cleanPromptText(parsed.cameraMovement || '');
                const rawAction = cleanPromptText(parsed.characterAction || '');

                if (!promptText) {
                  if (rawStart) promptText = rawStart;
                  else if (rawAction) promptText = rawAction;
                  else if (rawCamera) promptText = rawCamera;
                }
                // 从原文提取中文
                if (!promptText || promptText.length < 10) {
                  const cnSegments = accum.match(/[\u4e00-\u9fa5][\u4e00-\u9fa5，。！？、；：""''（）《》…—\s\w@]{15,}/g);
                  if (cnSegments && cnSegments.length > 0) {
                    promptText = cleanPromptText(cnSegments.sort((a, b) => b.length - a.length)[0]);
                  }
                }
                if (isValidVideoPrompt(promptText)) {
                  // ── @ 提及覆盖校验：扫描全部结构化字段，漏 @ / 无效 @ 时带反馈重试 ──
                  const expected = buildExpectedAssets(shot);
                  const scan = scanAtTexts([promptText, rawStart, rawEnd, rawCamera, rawAction], atIndex);
                  const missing = validateAtCoverage(scan.mentions, expected);
                  const unresolved = scan.issues.filter((i) => i.kind === 'unresolved');
                  if ((missing.length || unresolved.length) && contentRetry < maxContentRetries - 1) {
                    atFeedback = buildAtFeedback(missing, unresolved);
                    safeEnqueue(controller, { type: 'status', message: `镜头${shot.shotNumber} @提及校验：漏@ ${missing.length} 个、无效@ ${unresolved.length} 个，重新生成...` });
                    console.warn(`[PromptGen] Shot ${shot.shotNumber} video @ retry ${contentRetry + 1}: missing=[${missing.map((i) => i.asset?.name).join(',')}] unresolved=[${unresolved.map((i) => i.token).join(',')}]`);
                    continue;
                  }
                  if (missing.length || unresolved.length) {
                    console.warn(`[PromptGen] Shot ${shot.shotNumber} video @ issues remain after retries: missing=${missing.length} unresolved=${unresolved.length}`);
                  }
                  // 规范化修复（别称/漏字→登记名、漏@补@、无效@降级纯文本）
                  const startFrame = repairAtSymbols(rawStart);
                  const endFrame = repairAtSymbols(rawEnd);
                  const cameraMovement = repairAtSymbols(rawCamera);
                  const characterAction = repairAtSymbols(rawAction);
                  promptText = repairAtSymbols(promptText);
                  // 程序化兜底：确保对白被包含在视频提示词中
                  const shotDialogue = (shot as any).dialogue;
                  if (shotDialogue && shotDialogue.trim()) {
                    promptText = ensureDialogueInPrompt(promptText, shotDialogue);
                    promptText = repairAtSymbols(promptText);
                  }
                  const structured = JSON.stringify({
                    startFrame, endFrame, stateNote, cameraMovement, characterAction, prompt: promptText,
                  });
                  const result = await dramaWorkflowManager.updateShot(shot.id, { videoPrompt: structured });
                  if (result) { saved++; safeEnqueue(controller, { type: 'saved', shotId: shot.id, shotNumber: shot.shotNumber, videoPrompt: promptText, videoPromptJson: structured }); }
                  contentValid = true;
                  break;
                }
                console.warn(`[PromptGen] Shot ${shot.shotNumber} video retry ${contentRetry + 1}: invalid content, first 200 chars:`, accum.slice(0, 200));
              }
            }

            if (!contentValid) {
              // 最后一次尝试：即使质量不佳也尽量保存能提取到的中文内容
              const parsed = parseAIResponse(accum);
              if (type === 'image') {
                let imgPrompt = cleanPromptText(parsed.imagePrompt || parsed.prompt || parsed.description || '');
                if (!imgPrompt) {
                  const cnSegments = accum.match(/[\u4e00-\u9fa5][\u4e00-\u9fa5，。！？、；：""''（）《》…—\s\w@]{10,}/g);
                  if (cnSegments && cnSegments.length > 0) {
                    imgPrompt = cleanPromptText(cnSegments.sort((a, b) => b.length - a.length)[0]);
                  }
                }
                if (imgPrompt && imgPrompt.length >= 10) {
                  imgPrompt = repairAtSymbols(imgPrompt).slice(0, 800);
                  await dramaWorkflowManager.updateShot(shot.id, { imagePrompt: imgPrompt });
                  saved++;
                  safeEnqueue(controller, { type: 'saved', shotId: shot.id, shotNumber: shot.shotNumber, imagePrompt: imgPrompt });
                } else {
                  safeEnqueue(controller, { type: 'shotError', shotId: shot.id, shotNumber: shot.shotNumber, message: 'AI 多次生成仍无法得到有效提示词，已跳过' });
                }
              } else if (isH3Mode) {
                // H3 兜底：尝试从累积文本中提取任何有用的H3格式内容
                const h3Fallback = extractH3Prompt(accum);
                if (h3Fallback && h3Fallback.h3Prompt && h3Fallback.h3Prompt.length > 20) {
                  // 防线 3（兜底路径同样做）：单 Shot 隔离 + 对白一致性
                  h3Fallback.h3Prompt = sanitizeH3PromptForSingleShot(h3Fallback.h3Prompt, dialogue || null);
                  h3Fallback.h3Prompt = repairAtSymbols(h3Fallback.h3Prompt);
                  const h3Storage = JSON.stringify({
                    format: 'minimax-h3',
                    mode: h3Fallback.mode,
                    weightType: h3Fallback.weightType,
                    referenceCount: h3Fallback.referenceCount,
                    h3Prompt: h3Fallback.h3Prompt,
                  });
                  await dramaWorkflowManager.updateShot(shot.id, { videoPrompt: h3Storage });
                  saved++;
                  safeEnqueue(controller, { 
                    type: 'saved', 
                    shotId: shot.id, 
                    shotNumber: shot.shotNumber, 
                    videoPrompt: h3Fallback.h3Prompt.slice(0, 100),
                    videoPromptJson: h3Storage,
                    h3Prompt: h3Fallback.h3Prompt,
                    h3WeightType: h3Fallback.weightType,
                    h3Mode: h3Fallback.mode,
                  });
                } else {
                  // 🔴 H3 兜底最终防线：3 次 retry 后结构还是不合格（AI 一直回裸中文/非六段）。
                  // 不再 shotError 跳过（会导致卡片全空/遗漏），而是用 buildComfyUIH3Prompt 基于
                  // 本分镜的 h3Input（角色/场景/对白/必@清单）程序化生成「最小合法 H3 六段式骨架」。
                  // 保证 ComfyUI 的 Ref2VA 节点能识别格式，前端卡片也有完整结构（不再是仅一段裸画面描述）。
                  safeEnqueue(controller, {
                    type: 'status',
                    message: `镜头${shot.shotNumber} 3次重试仍无H3结构，回落到程序化骨架兜底...`
                  });
                  let skeleton = h3Input
                    ? buildComfyUIH3Prompt(h3Input, accum)
                    : `subject_definitions:\n<Subject 1> is the main character.\nsummary:\n[scene] ${(shot.sceneDescription || '').slice(0, 180)}\nretention_analysis:\n<Subject 1>: fully_preserved.\ndetailed_description:\n[Shot 1] ${(shot.sceneDescription || '').slice(0, 200)}\noverall_soundscape:\nAmbient.\nnon_diegetic_music:\nN/A\n`;
                  // 把「必@清单」插入 summary 段末尾，保证 fallback skeleton 也有 @ 提及 → 参考图能自动挂上
                  if (h3Input?.expectedAtList) {
                    const sm = skeleton.match(/\nsummary:\s*\n/i);
                    const ra = skeleton.match(/\nretention_analysis:\s*\n/i);
                    if (sm && ra && sm.index !== undefined && ra.index !== undefined && ra.index > sm.index) {
                      skeleton = skeleton.slice(0, ra.index)
                        + '\n\n' + h3Input.expectedAtList + '\n'
                        + skeleton.slice(ra.index);
                    } else {
                      skeleton += '\n\n' + h3Input.expectedAtList + '\n';
                    }
                  }
                  skeleton = sanitizeH3PromptForSingleShot(skeleton, dialogue || null);
                  skeleton = repairAtSymbols(skeleton);
                  const h3Storage = JSON.stringify({
                    format: 'minimax-h3',
                    mode: 'Ref2VA',
                    weightType: 'Ref2VA',
                    referenceCount: (h3Input?.referenceImages) || ((shot as any).imageUrl ? 1 : 0),
                    h3Prompt: skeleton,
                    isFallbackSkeleton: true,   // ← 前端可检测此标志显示「⚠️ Fallback骨架」徽章
                    fallbackReason: '3次retry AI未输出H3六段式结构，使用buildComfyUIH3Prompt程序化兜底。建议点击「重新生成」按钮重跑。',
                  });
                  await dramaWorkflowManager.updateShot(shot.id, { videoPrompt: h3Storage });
                  saved++;
                  safeEnqueue(controller, {
                    type: 'saved',
                    shotId: shot.id,
                    shotNumber: shot.shotNumber,
                    videoPrompt: skeleton.slice(0, 100),
                    videoPromptJson: h3Storage,
                    h3Prompt: skeleton,
                    h3WeightType: 'Ref2VA',
                    h3Mode: 'Ref2VA',
                    isFallbackSkeleton: true,
                  });
                  console.warn(`[PromptGen] H3 Shot ${shot.shotNumber} → FALLBACK skeleton used (AI never returned structured H3). Saved length=${skeleton.length}`);
                }
              } else {
                safeEnqueue(controller, { type: 'shotError', shotId: shot.id, shotNumber: shot.shotNumber, message: 'AI 多次生成仍无法得到有效视频提示词，已跳过' });
              }
            }
          } catch (e: any) {
            console.error(`[PromptGen] Shot ${shot.shotNumber} error:`, e);
            safeEnqueue(controller, { type: 'shotError', shotId: shot.id, shotNumber: shot.shotNumber, message: e.message || '生成失败' });
          }
        }

        safeEnqueue(controller, { type: 'done', saved, total: shots.length });
      } catch (err: any) {
        safeEnqueue(controller, { type: 'error', message: err.message || '生成失败' });
      } finally {
        safeClose(controller);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
