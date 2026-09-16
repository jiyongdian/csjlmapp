// Agent run 核心执行器：意图路由 + 流式生成 + 工具写回（chevoink 移植最小子集）
import { getModelName, getTemperature, getRawAIConfig } from '@/lib/ai-config';
import { novelManager, storyMemoryManager, scriptManager } from '@/storage/database';
import { syncNovelScriptPromptsToDramas } from '@/lib/drama-prompt-sync';
import { getPromptsWithFallback } from '@/lib/prompt-helper';
import { sanitizeChapterText } from '@/lib/chapter-text-cleaner';
import { formatChapterTitle, sanitizeChapterTitleText, stripChapterTitlePrefix } from '@/lib/chapter-title';
import type { AgentAction, AgentStreamEvent } from './types';
import {
  createAgentMessage,
  createAgentRun,
  getChapter,
  getGeneration,
  applyChapterContent,
  getLastChapter,
  appendChapter,
  touchAgentSession,
  updateAgentRunStatus,
  addNovelChange,
  upsertGeneration,
  listAgentMessages,
  getSessionDigest,
  saveSessionDigest,
} from './agent-store';
import { loadRoleTuning, loadAgentMemorySettings } from './agent-tuning';
import type { AgentMemorySettings } from '@/lib/system-settings';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const TIMEOUT_MS = 300_000;

async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number }): Promise<Response> {
  const { timeout = 60000, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 展开 fetch/undici 的完整错误链（fetch failed 的真实原因在 error.cause 里） */
function describeFetchError(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 5; depth++) {
    const c = cur as { name?: string; message?: string; code?: string; errno?: string; syscall?: string; address?: string; port?: number; cause?: unknown };
    let seg = (c.name || 'Error') + ': ' + (c.message || '');
    if (c.code) seg += ' [code=' + c.code + ']';
    if (c.errno) seg += ' [errno=' + c.errno + ']';
    if (c.syscall) seg += ' [syscall=' + c.syscall + ']';
    if (c.address) seg += ' [addr=' + c.address + (c.port ? ':' + c.port : '') + ']';
    parts.push(seg);
    cur = c.cause;
  }
  return parts.join(' <- ');
}

/** 判断是否为可重试的网络类错误（模型网关抖动 / 连接被重置） */
function isRetryableNetworkError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return msg.includes('fetch failed') || msg.includes('network') || msg.includes('econnreset')
    || msg.includes('socket hang up') || msg.includes('terminated') || msg.includes('other side closed')
    || msg.includes('timeout') || msg.includes('超时') || msg.includes('aborted');
}

/**
 * 带重试的流式生成：网络抖动时自动重试（最多 3 次，退避 1.5s / 3s）。
 * 重试前发 text_reset 事件，让前端丢弃已输出的半截内容，避免重复拼接。
 */
async function streamLLMWithRetry(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  temp: number,
  maxTokens: number,
  push: (event: AgentStreamEvent) => void,
  attempts = 3,
  roleId?: string
): Promise<string> {
  let lastErr: unknown = null;
  for (let i = 1; i <= attempts; i++) {
    let acc = '';
    const attemptStart = Date.now();
    try {
      for await (const delta of streamLLM(messages, temp, maxTokens, roleId)) {
        push({ type: 'text_delta', content: delta });
        acc += delta;
      }
      return acc;
    } catch (e) {
      lastErr = e;
      const retryable = isRetryableNetworkError(e);
      const detail = describeFetchError(e);
      console.error('[Agent] 流式生成失败（第' + i + '/' + attempts + '次, 耗时' + (Date.now() - attemptStart) + 'ms）: ' + detail, retryable ? '（将重试）' : '（不重试）');
      if (i >= attempts || !retryable) throw e;
      if (acc) push({ type: 'text_reset' });
      await new Promise((r) => setTimeout(r, i * 1500));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 会话压缩：把较早的消息压成一段前情提要（结果缓存到 agent_session_digest，避免重复压缩） */
async function compactSessionDigest(
  sessionId: string,
  older: { role: string; content: string }[],
  maxChars: number,
): Promise<string> {
  if (!older.length) return '';
  const cached = getSessionDigest(sessionId);
  if (cached && cached.coveredCount === older.length && cached.digest) return cached.digest;
  const raw = older
    .map((m) => (m.role === 'user' ? '用户：' : '助手：') + (m.content || '').slice(0, 600))
    .join('\n');
  try {
    const digest = await callLLM([
      {
        role: 'system',
        content:
          '你是会话记忆压缩器。把下面的对话压缩成一段前情提要：保留用户的目标、已确认的设定/人物、已完成的操作与结论、未完成的待办；去掉寒暄、重复与过程性描述。直接输出正文，不要 JSON、不要标题，不超过 ' +
          maxChars +
          ' 字。',
      },
      { role: 'user', content: raw.slice(0, 12000) },
    ], 0.3, 900, 'memory-extract');
    const text = (digest || '').trim().slice(0, maxChars);
    if (text) saveSessionDigest(sessionId, text, older.length);
    return text;
  } catch {
    return cached?.digest || '';
  }
}

/** 组装可带入模型的历史消息（最近 N 条 + 较早对话的压缩前情提要） */
async function buildSessionHistory(
  sessionId: string,
  memory: AgentMemorySettings,
): Promise<ChatMessage[]> {
  if (memory.historyRounds <= 0) return [];
  try {
    const all = listAgentMessages(sessionId).filter(
      (m) => (m.role === 'user' || m.role === 'assistant') && (m.content || '').trim(),
    );
    const prior = all.slice(0, -1);
    if (!prior.length) return [];
    const recent: ChatMessage[] = prior.slice(-memory.historyRounds).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: (m.content || '').slice(0, 2000),
    }));
    const out: ChatMessage[] = [];
    if (memory.enableCompression && prior.length > memory.compressionThreshold) {
      const older = prior.slice(0, Math.max(0, prior.length - memory.compressionKeepRounds));
      const digest = await compactSessionDigest(sessionId, older, memory.compressionMaxChars);
      if (digest) out.push({ role: 'user', content: '【前情提要（较早对话已压缩）】\n' + digest });
    }
    return out.concat(recent);
  } catch {
    return [];
  }
}

async function callLLM(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  temp: number,
  maxTokens = 4096,
  roleId?: string
): Promise<string> {
  const tuning = await loadRoleTuning(roleId);
  const configId = tuning?.configId ?? undefined;
  const finalTemp = tuning?.temperature ?? temp;
  const finalMaxTokens = tuning?.maxTokens ?? maxTokens;
  const modelName = await getModelName(configId);
  const { apiUrl, apiKey } = await getRawAIConfig(configId);
  const resp = await fetchWithTimeout(apiUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ model: modelName, messages, stream: false, temperature: finalTemp, max_tokens: finalMaxTokens, reasoning_effort: 'none' }),
    timeout: TIMEOUT_MS,
  });
  if (!resp.ok) throw new Error('AI 接口错误: ' + resp.status);
  const j = await resp.json() as { choices?: { message?: { content?: string } }[] };
  const out = j.choices?.[0]?.message?.content ?? '';
  return out.trim();
}

async function* streamLLM(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  temp: number,
  maxTokens = 8192,
  roleId?: string
): AsyncGenerator<string> {
  const tuning = await loadRoleTuning(roleId);
  const configId = tuning?.configId ?? undefined;
  const finalTemp = tuning?.temperature ?? temp;
  const finalMaxTokens = tuning?.maxTokens ?? maxTokens;
  const modelName = await getModelName(configId);
  const { apiUrl, apiKey } = await getRawAIConfig(configId);
  const resp = await fetchWithTimeout(apiUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ model: modelName, messages, stream: true, temperature: finalTemp, max_tokens: finalMaxTokens, reasoning_effort: 'none' }),
    timeout: TIMEOUT_MS,
  });
  if (!resp.ok || !resp.body) throw new Error('AI 接口错误: ' + resp.status);
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const IDLE_MS = 90_000;
  while (true) {
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<never>((_, reject) => {
      idleTimer = setTimeout(() => reject(new Error('AI 流式响应超时（' + Math.round(IDLE_MS / 1000) + ' 秒未收到数据）')), IDLE_MS);
    });
    const readP = reader.read();
    readP.catch(() => { /* 超时后该 promise 的拒绝不再处理 */ });
    let done = false;
    let value: Uint8Array | undefined;
    try {
      const r = await Promise.race([readP, idle]);
      done = !!r.done;
      value = r.value as Uint8Array | undefined;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
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
        if (typeof c === 'string' && c.length > 0) yield c;
      } catch { /* 忽略坏行 */ }
    }
  }
}

// ---------- 本地关键词预分类（省一次 LLM 意图调用） ----------
function localIntent(prompt: string): AgentAction | null {
  const p = prompt.trim();
  if (!p) return 'chat';
  const hints: [RegExp, AgentAction][] = [
    [/视频提示词|视频分镜提示|生成视频提示|出视频提示/, 'script-video-prompts'],
    [/图片提示词|图片分镜提示|生成图片提示|出图提示/, 'script-image-prompts'],
    [/场景数据|场景参数|补齐场景|补全场景|完善场景|加强场景|景别|机位|镜头运动/, 'script-scene-meta'],
    [/场景拆分|重新拆分|拆分场景|多拆|少拆|合并场景|场景太(多|少|碎)|场次太(多|少)|场景节奏|拆成.*场景/, 'script-scenes'],
    [/(补充|增加|丰富|优化|精简|删减|调整|太少|太多|不够|偏少|偏多).{0,4}(台词|对白)|(台词|对白).{0,4}(太少|太多|不够|偏少|偏多|优化|丰富|增加|精简)/, 'script-dialogue'],
    [/扩写|展开写|写得再细|补充细节|丰富内容|加长一些/, 'expand'],
    [/精简|压缩|缩短|删减|浓缩/, 'condense'],
    [/重写|改写|换个写法|重新写|换一种写法|推翻/, 'rewrite'],
    [/续写|继续写|接下去|接着写|往下写|后续/, 'continue'],
    [/润色|美化|优化表达|打磨|精修|语句更好|表达更生动/, 'polish'],
    [/查错|找bug|找错误|审阅|审错|语法|病句|问题在哪/, 'review'],
    [/生成剧本|写成剧本|改成剧本|转成剧本|转剧本|剧本化|出剧本|做剧本|改编成剧本|生成.*剧本/, 'generate-script'],
    [/生成.*(小说|连载|书)|写一部|创作一部|新写一|开一本|出一部|成书/, 'generate'],
    [/总结|摘要|概括|提炼|要点|概述/, 'summary'],
  ];
  for (const [re, act] of hints) if (re.test(p)) return act;
  return null;
}

// ---------- 系统级提示 ----------
function buildIntentSystemPrompt(): string {
  return `你是小说/剧本创作 Agent 的意图解析器。用户会给出一句话指令，你要判断用户想对当前章节做什么，并输出纯 JSON（不要任何其他文字），格式：
{"action":"rewrite|continue|polish|expand|condense|review|summary|generate|generate-script|script-scenes|script-dialogue|script-scene-meta|script-image-prompts|script-video-prompts|chat","instruction":"一句话复述用户指令（50字内）"}

动作含义：
- rewrite 重写：全文重写当前章节（保留情节骨架，换表达）
- continue 续写：在章节结尾继续往下写新内容
- polish 润色：保持情节人物不变，优化表达更生动流畅
- expand 扩写：把章节补充更丰富的细节与情节，明显加长
- condense 精简：压缩章节，去掉冗余只留核心
- review 查错：指出章节的问题清单（不修改正文）
- summary 总结：给章节做摘要
- generate-script 生成剧本：把小说章节改编成剧本（分场景，含地点/动作/台词），写入该小说的剧本
- script-scenes 优化场景拆分：按作者要求重新拆分/合并当前章节**已有剧本**的场景（场次数量、节奏、单场时长），保留剧情与人物
- script-dialogue 优化对白：在不改动场景结构的前提下，为当前章节剧本补充或优化台词/对白
- script-scene-meta 补齐场景数据：为当前章节剧本的每个场景补齐/规范化技术参数（地点/景别/机位/时长/镜头运动），不改动画面、动作与对白
- script-image-prompts 生成图片提示词：为当前章节剧本的每个场景生成图片生成提示词
- script-video-prompts 生成视频提示词：为当前章节剧本的每个场景生成视频生成提示词
- chat 其他：普通对话（围绕作品回答，不生成正文）`;
}

function parseIntent(raw: string): { action: AgentAction; instruction: string } {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no json');
    const j = JSON.parse(m[0]);
    const action = (['rewrite', 'continue', 'polish', 'expand', 'condense', 'review', 'summary', 'generate-script', 'script-scenes', 'script-dialogue', 'script-scene-meta', 'script-image-prompts', 'script-video-prompts', 'chat'] as AgentAction[])
      .find((a) => a === j.action);
    return { action: action ?? 'chat', instruction: String(j.instruction ?? '') };
  } catch {
    return { action: 'chat', instruction: raw };
  }
}

function buildContextSystem(sessionContext: {
  novelTitle: string; chapterTitle: string; chapterContent: string; hasChapter: boolean;
}, memoryDigest?: string): string {
  const lines = [
    '你是一位资深网文创作 Agent，正在协助作者进行小说创作。',
    '你必须严格遵循作者指令，输出高质量中文网文正文，语气与文体贴合男频/女频题目设定。',
  ];
  if (sessionContext.novelTitle) lines.push('小说标题：' + sessionContext.novelTitle);
  if (sessionContext.hasChapter) {
    lines.push('当前章节标题：' + sessionContext.chapterTitle);
  }
  if (memoryDigest) {
    lines.push('');
    lines.push(memoryDigest);
  }
  lines.push('');
  lines.push('【写作红线】');
  lines.push('1. 禁止输出任何解释、说明、标题序号、markdown 标记，只输出正文本身。');
  lines.push('2. 禁止复述你收到的上一章/本章原文（除非是续写桥接）。');
  lines.push('3. 保持叙事视角统一、人物行为与设定一致。');
  return lines.join('\n');
}

function buildChapterContextMessage(sessionContext: {
  novelTitle: string; chapterTitle: string; chapterContent: string; hasChapter: boolean;
}, prompt: string, instruction: string, action: AgentAction, maxChars = 24000): string {
  const parts: string[] = [];
  if (sessionContext.hasChapter) {
    const c = sessionContext.chapterContent;
    const shown = c.length > maxChars ? c.slice(0, maxChars) + '\n……（章节过长已截断）' : c;
    parts.push('【当前章节原文（第' + sessionContext.chapterTitle + '章）】');
    parts.push(shown);
  } else {
    parts.push('（当前未选中章节，可围绕作品创作进行回答）');
  }
  parts.push('');
  parts.push('【作者指令】' + (instruction || prompt));
  if (action === 'rewrite') {
    parts.push('【任务】重写整章：保留情节骨架与人物，彻底更换表达与节奏，字数与原章相当或更优。直接输出重写后的完整正文。');
  } else if (action === 'continue') {
    parts.push('【任务】承接本章结尾续写**新的一章**：直接输出新章节的完整正文，不要重复已有原文、衔接自然，正文 1000-1800 字；不要输出「第N章」这类标题行，标题另行处理。');
  } else if (action === 'polish') {
    parts.push('【任务】润色整章：情节、人物、结构完全不变，仅优化语句表达使其更生动流畅。直接输出润色后的完整正文。');
  } else if (action === 'expand') {
    parts.push('【任务】扩写整章：保留原有情节与人物，补充环境、动作、心理、对话细节，篇幅显著加长。直接输出扩写后的完整正文。');
  } else if (action === 'condense') {
    parts.push('【任务】精简整章：去除冗余描写与重复叙述，保留核心情节、对话与关键信息，篇幅明显缩短。直接输出精简后的完整正文。');
  } else if (action === 'review') {
    parts.push('【任务】审查当前章节，输出问题清单（每条一行，格式：【问题类型】具体位置+修改建议），不超过15条。不改写正文。');
  } else if (action === 'summary') {
    parts.push('【任务】为当前章节输出摘要：200字以内，概括本章发生了什么、主角状态变化、埋下的伏笔。');
  } else {
    parts.push('【任务】围绕这部作品回答作者的问题，直接给出内容。');
  }
  return parts.join('\n');
}

/** 为续写新增的章节生成标题（统一格式：第N章：标题） */
async function generateNewChapterTitle(novelTitle: string, content: string, index: number): Promise<string> {
  const excerpt = (content || '').slice(0, 1500);
  try {
    const raw = await callLLM([
      { role: 'system', content: '你是资深网文编辑。请根据章节正文起一个精准的章节标题：只输出标题文字本身，4-16 个汉字，能概括本章核心情节或悬念；不要引号、不要「第N章」前缀、不要任何解释。' },
      { role: 'user', content: '书名：' + (novelTitle || '未命名') + '\n\n本章正文：\n' + excerpt },
    ], 0.5, 60);
    const clean = sanitizeChapterTitleText(raw, 18);
    if (clean) return formatChapterTitle(index, clean);
  } catch (e) {
    console.error('[Agent] 续写章节标题生成失败:', e instanceof Error ? e.message : e);
  }
  return formatChapterTitle(index, '');
}

// ---------- 主入口 ----------
export interface RunAgentLoopOptions {
  userId: string;
  sessionId: string;
  novelId?: string;
  chapterIndex?: number;
  prompt: string;
  push: (event: AgentStreamEvent) => void;
  /** 用户在对话里选定的叙事视角（未提供时先询问） */
  narrativePerspective?: string;
  /** 用户在对话里选定的目标读者方向（未提供时先询问） */
  genderTarget?: string;
  /** 用户在对话里选定的小说类型（未提供时先询问） */
  category?: string;
  /** 追问/补充轮次：不重复落库用户消息 */
  skipUserMessage?: boolean;
}

const AGENT_SCRIPT_FALLBACK = [
  '你是资深影视编剧兼分镜师，负责把小说章节改编为可直接拍摄的剧本。',
  '你只输出严格 JSON，不要任何解释文字、不要 markdown 代码块。',
  '',
  '输出格式：',
  '{"scenes":[{"sceneIndex":1,"sceneTitle":"场景标题","location":"具体地点","shotType":"远景/全景/中景/近景/特写/过肩镜头","cameraAngle":"正面/侧面/斜侧/俯拍/仰拍/过肩","duration":"6秒","cameraMovement":"固定/推镜/拉镜/摇镜/跟镜","description":"画面描述（80~160字，写清人物、环境、光源方向与色调）","actions":"人物动作与场面调度","dialogues":[{"character":"角色名","line":"台词"}],"stageDirections":"光线/音效/道具等提示"}]}',
  '',
  '硬性要求：',
  '1. 每章拆分为 6~12 个场景，按时间顺序排列，sceneIndex 从 1 连续递增。',
  '2. 每个场景写清地点、人物、动作、台词；台词要推进剧情或塑造人物，禁止无信息量的寒暄。',
  '3. 只写能拍出来的内容，禁止大段心理描写与旁白式抒情。',
  '4. 保留原著的人物、关键情节与冲突，不新增与设定冲突的内容。',
  '5. location / shotType / cameraAngle / duration / cameraMovement 五个字段，每个场景都必须填写，不得留空、不得省略：',
  '   - location：具体地点（如「废弃村落村口」），禁止只写「室内」「室外」；',
  '   - shotType：只能从「远景/全景/中景/近景/特写/过肩镜头」中选一个；',
  '   - cameraAngle：只能从「正面/侧面/斜侧/俯拍/仰拍/过肩」中选一个；',
  '   - duration：本场景时长，写成「N秒」，常规 4~10 秒；',
  '   - cameraMovement：只能从「固定/推镜/拉镜/摇镜/跟镜」中选一个。',
  '6. description 必须与 location / shotType / cameraAngle 相互匹配（例如 shotType 为特写时，画面描述必须是特写能拍到的内容）。',
].join('\n');

/** 场景技术参数的可选词表（含常见同义写法，用于把模型输出归一化到统一词表） */
const SHOT_TYPE_SYNONYMS: Record<string, string[]> = {
  远景: ['远景', '大远景'],
  全景: ['全景', '大全景'],
  中景: ['中景'],
  近景: ['近景'],
  特写: ['特写'],
  过肩镜头: ['过肩'],
};
const CAMERA_ANGLE_SYNONYMS: Record<string, string[]> = {
  正面: ['正面', '平视'],
  侧面: ['侧面', '侧拍'],
  斜侧: ['斜侧', '斜角'],
  俯拍: ['俯拍', '俯视'],
  仰拍: ['仰拍', '仰视'],
  过肩: ['过肩'],
};
const CAMERA_MOVEMENT_SYNONYMS: Record<string, string[]> = {
  固定: ['固定', '静止'],
  推镜: ['推镜', '推近', '推进', '前推'],
  拉镜: ['拉镜', '拉远', '后拉'],
  摇镜: ['摇镜', '摇移', '横摇'],
  跟镜: ['跟镜', '跟随', '跟拍', '手持跟'],
};

/** 命中词表返回标准值，未命中返回空串（由调用方决定兜底值） */
function pickEnum(value: any, synonyms: Record<string, string[]>): string {
  const v = String(value || '').trim();
  if (!v) return '';
  for (const key of Object.keys(synonyms)) {
    if (synonyms[key].some((w) => v.includes(w))) return key;
  }
  return '';
}

/** 归一化时长：任意写法 → 「N秒」，无法解析返回空串 */
function normalizeDuration(value: any): string {
  const v = String(value || '').trim();
  if (!v) return '';
  const m = v.match(/\d+(\.\d+)?/);
  return m ? m[0] + '秒' : '';
}

function parseSceneScript(raw: string): any[] {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return [];
    const j = JSON.parse(m[0]);
    const scenes = Array.isArray(j && j.scenes) ? j.scenes : [];
    return scenes.map((s: any, i: number) => ({
      sceneIndex: i + 1,
      sceneTitle: String((s && s.sceneTitle) || (s && s.title) || ('场景' + (i + 1))),
      location: String((s && (s.location || s.place)) || '').trim() || '未指定地点',
      shotType: pickEnum(s && (s.shotType || s.shot), SHOT_TYPE_SYNONYMS) || '中景',
      cameraAngle: pickEnum(s && (s.cameraAngle || s.angle), CAMERA_ANGLE_SYNONYMS) || '正面',
      duration: normalizeDuration(s && (s.duration || s.timeLength)) || '6秒',
      cameraMovement: pickEnum(s && (s.cameraMovement || s.movement), CAMERA_MOVEMENT_SYNONYMS) || '固定',
      description: String((s && s.description) || ''),
      actions: String((s && s.actions) || ''),
      dialogues: Array.isArray(s && s.dialogues)
        ? s.dialogues.map((d: any) => ({ character: String((d && d.character) || ''), line: String((d && d.line) || '') })).filter((d: any) => d.line)
        : [],
      stageDirections: String((s && s.stageDirections) || ''),
    })).filter((s: any) => s.description || s.actions || s.dialogues.length > 0);
  } catch {
    return [];
  }
}

/** 只解析场景技术参数（补齐场景数据用，不触碰画面/动作/对白字段） */
function parseSceneMetaOnly(raw: string): any[] {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return [];
    const j = JSON.parse(m[0]);
    const scenes = Array.isArray(j && j.scenes) ? j.scenes : [];
    return scenes.map((s: any, i: number) => ({
      sceneIndex: Number(s && s.sceneIndex) || i + 1,
      location: String((s && (s.location || s.place)) || '').trim(),
      shotType: pickEnum(s && (s.shotType || s.shot), SHOT_TYPE_SYNONYMS),
      cameraAngle: pickEnum(s && (s.cameraAngle || s.angle), CAMERA_ANGLE_SYNONYMS),
      duration: normalizeDuration(s && (s.duration || s.timeLength)),
      cameraMovement: pickEnum(s && (s.cameraMovement || s.movement), CAMERA_MOVEMENT_SYNONYMS),
    }));
  } catch {
    return [];
  }
}

const CN_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function cnNumToInt(raw: string): number {
  const s = String(raw || '').trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (!/^[零〇一二两三四五六七八九十百]+$/.test(s)) return 0;
  const hundred = s.indexOf('百');
  if (hundred !== -1) {
    const head = cnNumToInt(s.slice(0, hundred)) || 1;
    return head * 100 + cnNumToInt(s.slice(hundred + 1));
  }
  const ten = s.indexOf('十');
  if (ten !== -1) {
    const head = ten === 0 ? 1 : (CN_DIGITS[s[ten - 1]] ?? 0);
    const tailStr = s.slice(ten + 1);
    return head * 10 + (tailStr ? (CN_DIGITS[tailStr] ?? 0) : 0);
  }
  let n = 0;
  for (const ch of s) n = n * 10 + (CN_DIGITS[ch] ?? 0);
  return n;
}

function parseScriptRange(prompt: string, fallbackIndex: number): { start: number; end: number } {
  const num = '([0-9]+|[零〇一二两三四五六七八九十百]+)';
  const rangeRe = new RegExp('第\\s*' + num + '\\s*章?\\s*[-~至到]\\s*第?\\s*' + num + '\\s*章');
  const range = prompt.match(rangeRe);
  if (range) {
    const a = cnNumToInt(range[1]);
    const b = cnNumToInt(range[2]);
    if (a > 0 && b >= a) return { start: a, end: b };
  }
  const single = prompt.match(new RegExp('第\\s*' + num + '\\s*章'));
  if (single) {
    const n = cnNumToInt(single[1]);
    if (n > 0) return { start: n, end: n };
  }
  return { start: fallbackIndex, end: fallbackIndex };
}

const AGENT_IMAGE_PROMPT_FALLBACK = [
  '你是资深影视分镜师，负责把剧本场景转成可直接出图的图片生成提示词。',
  '你只输出严格 JSON，不要任何解释文字、不要 markdown 代码块。',
  '',
  '输出格式：',
  '{"imagePrompts":[{"sceneIndex":1,"sceneTitle":"场景标题","shotType":"特写/中景/远景/全景/过肩镜头","description":"画面一句话描述（20字内）","prompt":"详细中文图片生成提示词","negativePrompt":"模糊, 变形, 低质量, 水印, 文字, 多余肢体","style":"电影质感, 适配场景的风格关键词"}]}',
  '',
  '硬性要求：',
  '1. prompt 必须具体到：人物数量、姿态、表情、服装细节、环境特征、光源方向、色调。',
  '2. 每条 prompt 80~150 字，信息密度高，中文撰写。',
  '3. 定格每个场景最具视觉冲击力的瞬间。',
  '4. 场景含对白时，prompt 必须描述说话者的表情、口型、肢体动作，并完整引用对话原文，格式：角色名说「对话内容」。',
  '5. 只描述画面，不写剧情与心理活动。',
].join('\n');

function stripPlaceholders(text: string): string {
  return String(text || '').replace(/\{\{\s*\w+\s*\}\}/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function buildScenePromptText(scene: any, order: number): string {
  const lines = ['【场景' + (Number(scene && scene.sceneIndex) || order) + '：' + ((scene && scene.sceneTitle) || '') + '】'];
  // 缺失字段必须显式标注：直接填默认值会被模型当成场景真实数据原样回显，导致所有场景参数雷同
  lines.push('地点：' + ((scene && scene.location) || '未设定（请补全具体地点）'));
  lines.push('景别：' + ((scene && scene.shotType) || '未设定（远景/全景/中景/近景/特写/过肩镜头 择一）'));
  lines.push('机位：' + ((scene && scene.cameraAngle) || '未设定（正面/侧面/斜侧/俯拍/仰拍/过肩 择一）'));
  lines.push('时长：' + ((scene && scene.duration) || '未设定（写 N秒）'));
  lines.push('镜头运动：' + ((scene && scene.cameraMovement) || '未设定（固定/推镜/拉镜/摇镜/跟镜 择一）'));
  lines.push('环境描述：' + ((scene && scene.description) || '无'));
  lines.push('角色动作：' + ((scene && scene.actions) || '无'));
  if (scene && Array.isArray(scene.dialogues) && scene.dialogues.length) {
    lines.push('对话：');
    for (const d of scene.dialogues) lines.push('  ' + ((d && d.character) || '') + '：「' + ((d && d.line) || '') + '」');
  } else {
    lines.push('对话：无');
  }
  lines.push('舞台指示：' + ((scene && scene.stageDirections) || '无'));
  return lines.join('\n');
}

function parsePrompts(raw: string, scenes: any[], chapterIndex: number, key: string, idPrefix: string): any[] {
  let list: any[] = [];
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return [];
    const j = JSON.parse(m[0]);
    list = Array.isArray(j && j[key]) ? j[key] : [];
  } catch {
    return [];
  }
  const out: any[] = [];
  const isVideo = key === 'videoPrompts';
  scenes.forEach((sc: any, i: number) => {
    const src = list[i] || {};
    const sceneIndex = Number(sc && sc.sceneIndex) || i + 1;
    const prompt = String((src && src.prompt) || '');
    if (!prompt) return;
    const dialogues: any[] = Array.isArray(sc && sc.dialogues) ? sc.dialogues : [];
    const dialogueText = dialogues
      .map((d: any) => String((d && d.character) || '') + '：「' + String((d && d.line) || '') + '」')
      .join('，');
    // 严格把控：场景自带的技术参数（景别/机位/时长/镜头运动/地点）一律以场景数据为准，模型输出仅作兜底
    const sceneShotType = String((sc && sc.shotType) || '').trim();
    const sceneCameraAngle = String((sc && sc.cameraAngle) || '').trim();
    const sceneDuration = String((sc && sc.duration) || '').trim();
    const sceneCameraMovement = String((sc && sc.cameraMovement) || '').trim();
    const sceneLocation = String((sc && sc.location) || '').trim();
    const base: any = {
      id: idPrefix + '_ch' + chapterIndex + '_s' + sceneIndex,
      sceneIndex,
      sceneTitle: String((src && src.sceneTitle) || (sc && sc.sceneTitle) || ''),
      shotType: sceneShotType || String((src && src.shotType) || '中景'),
      description: String((src && src.description) || ''),
      prompt,
      negativePrompt: String((src && src.negativePrompt) || '模糊, 变形, 低质量, 水印, 文字, 多余肢体'),
      style: String((src && src.style) || ''),
    };
    if (sceneLocation) base.location = sceneLocation;
    if (sceneCameraAngle) base.cameraAngle = sceneCameraAngle;
    if (isVideo) {
      // 与 /api/novel/script/video-prompts 的输出结构保持一致，避免下游分镜/视频生成拿不到时长、首尾帧、运镜等信息
      base.subShotIndex = Number((src && src.subShotIndex) || 1);
      base.startFrame = String((src && src.startFrame) || (sc && sc.description) || '场景起始画面');
      base.cameraMovement = sceneCameraMovement || String((src && src.cameraMovement) || (dialogues.length ? '跟镜' : '固定'));
      base.action = String((src && src.action) || (sc && sc.actions) || (dialogues.length ? '角色对话交流' : '场景展示'));
      base.endFrame = String((src && src.endFrame) || '自然结束');
      base.duration = sceneDuration || String((src && src.duration) || '6秒');
      base.transition = String((src && src.transition) || '自然衔接');
      base.dialogueRange = String((src && src.dialogueRange) || (dialogues.length ? '覆盖的对话：' + dialogueText : '无对话'));
    }
    out.push(base);
  });
  return out;
}

async function generatePromptsForChapter(
  kind: 'image' | 'video',
  chapterIndex: number,
  chapterTitle: string,
  scenes: any[],
  systemPrompt: string,
): Promise<any[]> {
  if (!scenes.length) return [];
  const isImage = kind === 'image';
  const key = isImage ? 'imagePrompts' : 'videoPrompts';
  const idPrefix = isImage ? 'img' : 'vid';
  const label = isImage ? '图片' : '视频';
  const roleId = isImage ? 'image-prompts' : 'video-prompts';
  const sceneBlocks = scenes.map((sc, i) => buildScenePromptText(sc, i + 1)).join('\n\n');
  const sample = isImage
    ? '{"imagePrompts":[{"sceneIndex":1,"sceneTitle":"","shotType":"","description":"","prompt":"","negativePrompt":"","style":""}]}'
    : '{"videoPrompts":[{"sceneIndex":1,"sceneTitle":"","shotType":"","description":"","startFrame":"","cameraMovement":"","action":"","endFrame":"","duration":"6秒","prompt":"","negativePrompt":"","style":"","transition":""}]}';
  const userMsg = [
    '【章节】第' + chapterIndex + '章 ' + chapterTitle,
    '',
    '共 ' + scenes.length + ' 个场景，请为每个场景各输出 1 条' + label + '提示词，sceneIndex 必须与场景编号一致，严格按以下 JSON 返回：',
    sample,
    '',
    '【严格对应场景数据——优先级最高，必须逐条遵守】',
    '1. 每条提示词只能依据其对应场景给出的「地点 / 景别 / 机位 / 时长 / 镜头运动 / 环境描述 / 角色动作 / 对话 / 舞台指示」来创作。',
    '2. 严禁新增场景数据里没有的人物、道具、地点、情节；严禁遗漏场景里的任何一句对白。',
    '3. shotType 必须原样使用该场景的「景别」，不得改写、不得自创。',
    isImage
      ? '4. 构图与视角必须符合该场景的「机位」和「景别」；画面内容（环境、人物、动作、表情）必须与该场景的「环境描述 / 角色动作」逐条对应。'
      : '4. cameraMovement 必须原样使用该场景的「镜头运动」，duration 必须原样使用该场景的「时长」。',
    '5. 场景有对白时，prompt 必须引用该场景的对白原文（用「」引用），口型、表情、肢体语言要与对白一致。',
    ...(isImage
      ? []
      : [
          '',
          '【视频字段要求（每个字段都必须填写，不得为空）】',
          '- startFrame：镜头起始画面，12~30 字静态画面描述，承接上一场景的结束画面；',
          '- cameraMovement：原样使用该场景的「镜头运动」；',
          '- action：角色在本场景内的动作过程，12~30 字；',
          '- endFrame：镜头结束画面，12~30 字，需能自然接上下一场景的 startFrame；',
          '- duration：原样使用该场景的「时长」；',
          '- transition：与下一场景的转场方式，8 字以内。',
        ]),
    '',
    sceneBlocks,
  ].join('\n');
  const raw = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMsg },
  ], 0.6, 8192, roleId);
  return parsePrompts(raw, scenes, chapterIndex, key, idPrefix);
}

async function saveScriptChapter(novelId: string, userId: string, pos: number, chapterTitle: string, scenes: any[], imagePrompts?: any[], videoPrompts?: any[]): Promise<void> {
  let script = await scriptManager.getScriptByNovelId(novelId, userId, false);
  if (!script) script = await scriptManager.createScript({ novelId, userId, status: 'generating', chapters: [] });
  const src = Array.isArray(script.chapters) ? script.chapters : [];
  const chapters: any[] = src.slice();
  while (chapters.length <= pos) chapters.push(null);
  const prev: any = chapters[pos] || {};
  // 显式传入数组（含空数组）→ 以传入为准（场景变化后可清空失效提示词）；未传入(undefined) → 保留原值
  const nextImage = Array.isArray(imagePrompts) ? imagePrompts : (Array.isArray(prev.imagePrompts) ? prev.imagePrompts : []);
  const nextVideo = Array.isArray(videoPrompts) ? videoPrompts : (Array.isArray(prev.videoPrompts) ? prev.videoPrompts : []);
  chapters[pos] = {
    ...prev,
    chapterIndex: pos,
    chapterTitle,
    screenplay: { ...(prev.screenplay || {}), scenes },
    imagePrompts: nextImage,
    videoPrompts: nextVideo,
  };
  await scriptManager.updateScript(script.id, { chapters, status: 'completed' });
}

const AGENT_SCENE_REWORK_FALLBACK = [
  '你是资深影视分镜师，负责按导演要求重新拆分剧本场景。',
  '你只输出严格 JSON，不要任何解释文字、不要 markdown 代码块。',
  '',
  '输出格式：',
  '{"scenes":[{"sceneIndex":1,"sceneTitle":"场景标题","location":"地点","shotType":"远景/全景/中景/近景/特写/过肩镜头","cameraAngle":"正面/侧面/俯拍/仰拍","duration":"6秒","cameraMovement":"固定/推镜/拉镜/摇镜/跟镜","description":"画面描述","actions":"角色动作","dialogues":[{"character":"角色名","line":"台词"}],"stageDirections":"音效/光线/转场"}]}',
  '',
  '硬性要求：',
  '1. 严格保留原剧情、人物与关键信息，不得增删情节。',
  '2. 必须严格执行作者给出的拆分要求（场次数量、节奏、单场时长等）。',
  '3. 每个场景 description 80~160 字，写清人物、环境、光源方向与色调；actions 写镜头内的动作调度。',
  '4. 有对白的场景写全 dialogues；无对白的场景 dialogues 用空数组。',
  '5. 场景按剧情顺序排列，sceneIndex 从 1 开始连续编号。',
].join('\n');

const AGENT_DIALOGUE_FALLBACK = [
  '你是资深编剧，负责在不改变剧情与场景结构的前提下，为剧本场景补充或优化对白。',
  '你只输出严格 JSON，不要任何解释文字、不要 markdown 代码块。',
  '',
  '输出格式：',
  '{"scenes":[{"sceneIndex":1,"dialogues":[{"character":"角色名","line":"台词"}]}]}',
  '',
  '硬性要求：',
  '1. 不得改动场景数量、场景标题、地点与画面描述，只新增/改写对白。',
  '2. 严格遵循作者要求（例如「台词太少」就适当增加，「台词太密」就精简）。',
  '3. 台词口语化、贴合人物身份与性格，有潜台词，避免解释性台词。',
  '4. 保留原对白中的关键剧情信息，不要遗漏。',
  '5. sceneIndex 必须与传入的场景编号一致；每个场景都要出现在结果里。',
].join('\n');

const AGENT_VIDEO_PROMPT_FALLBACK = [
  '你是资深影视分镜师，负责把剧本场景转成可直接生成视频的视频提示词。',
  '你只输出严格 JSON，不要任何解释文字、不要 markdown 代码块。',
  '',
  '输出格式：',
  '{"videoPrompts":[{"sceneIndex":1,"sceneTitle":"场景标题","shotType":"景别","description":"画面一句话描述（20字内）","startFrame":"起始画面描述","cameraMovement":"镜头运动（固定/推镜/拉镜/摇镜/跟镜）","action":"角色动作描述","endFrame":"结束画面描述","duration":"6秒","prompt":"完整视频生成提示词","negativePrompt":"模糊, 变形, 闪烁, 低质量, 水印, 文字","style":"电影质感, 适配场景的风格关键词","transition":"转场方式"}]}',
  '',
  '硬性要求：',
  '1. prompt 必须写清：镜头运动（推/拉/摇/移/跟）、主体动作过程、环境氛围、光线方向与色调。',
  '2. 每条 prompt 80~160 字，中文撰写，描述一个连续镜头内发生的过程，不要写分镜切换。',
  '3. 含对白时说明角色口型与表情变化；对白原文用「」引用。',
  '4. 不要出现文字、水印、logo、字幕。',
  '5. startFrame 写镜头起始画面，endFrame 写镜头结束画面，endFrame 要能自然延续为下一场景的 startFrame，保证镜头连贯。',
  '6. cameraMovement 必须与场景数据的「镜头运动」完全一致（词表：固定/推镜/拉镜/摇镜/跟镜）；action 写角色在本场景内的动作过程；duration 必须与场景数据的「时长」一致（如「6秒」）；transition 写与下一场景的转场方式。',
  '7. 上述字段每一条都必须给出具体内容，不允许留空或省略。',
].join('\n');

function extractJsonValue(raw: string): any | null {
  const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function toDialogueList(value: any): any[] {
  const list = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  return list
    .map((d: any) => ({
      character: String((d && (d.character ?? d.name ?? d.role ?? d.speaker)) || ''),
      line: String((d && (d.line ?? d.text ?? d.content ?? d.dialogue)) || ''),
    }))
    .filter((d: any) => d.line);
}

function dialoguesOfSceneItem(item: any, fallbackIndex: number): { idx: number; list: any[] } {
  const idx = Number(item && (item.sceneIndex ?? item.index ?? item.scene)) || fallbackIndex;
  const raw = item && (item.dialogues ?? item.dialogue ?? item.lines ?? item.lines_list);
  return { idx, list: toDialogueList(raw) };
}

function parseSceneDialogues(raw: string): Map<number, any[]> {
  const out = new Map<number, any[]>();
  const push = (idx: number, list: any[]) => {
    if (!Number.isFinite(idx) || idx < 1 || !list.length) return;
    out.set(idx, list);
  };
  const j = extractJsonValue(raw);
  if (j === null || j === undefined) return out;

  if (Array.isArray(j)) {
    j.forEach((item: any, i: number) => {
      const r = dialoguesOfSceneItem(item, i + 1);
      push(r.idx, r.list);
    });
    return out;
  }

  const container = Array.isArray(j.scenes)
    ? j.scenes
    : Array.isArray(j.dialogues)
      ? j.dialogues
      : Array.isArray(j.sceneDialogues)
        ? j.sceneDialogues
        : Array.isArray(j.data)
          ? j.data
          : null;
  if (container) {
    container.forEach((item: any, i: number) => {
      const r = dialoguesOfSceneItem(item, i + 1);
      push(r.idx, r.list);
    });
    return out;
  }

  // 形如 { "1": [...], "2": [...] } 或 { scenes: { "1": [...] } }
  const mapSource = j.scenes && typeof j.scenes === 'object' ? j.scenes : j;
  for (const key of Object.keys(mapSource)) {
    const idx = Number(key);
    if (!Number.isFinite(idx) || idx < 1) continue;
    push(idx, toDialogueList(mapSource[key]));
  }
  return out;
}

async function saveChapterPromptField(
  novelId: string,
  userId: string,
  pos: number,
  kind: 'imagePrompts' | 'videoPrompts',
  prompts: any[],
): Promise<boolean> {
  try {
    const script = await scriptManager.getScriptByNovelId(novelId, userId, false);
    if (!script) return false;
    const chapters: any[] = Array.isArray(script.chapters) ? [...script.chapters] : [];
    if (!chapters[pos]) return false;
    chapters[pos] = { ...chapters[pos], [kind]: prompts };
    await scriptManager.updateScript(script.id, { chapters, status: 'completed' });
    return true;
  } catch (e) {
    console.warn('[Agent-Script] 保存提示词失败:', e instanceof Error ? e.message : e);
    return false;
  }
}

/** 读取某章剧本（按小说章节号定位） */
async function loadScriptChapterForAgent(novelId: string, userId: string, chapterIndex: number) {
  const script = await scriptManager.getScriptByNovelId(novelId, userId, false);
  const allChapters: any[] = script && Array.isArray(script.chapters) ? script.chapters : [];
  const pos = Math.max(0, chapterIndex - 1);
  const chapter = allChapters[pos];
  const scenes: any[] =
    chapter && chapter.screenplay && Array.isArray(chapter.screenplay.scenes) ? chapter.screenplay.scenes : [];
  return { script, chapters: allChapters, pos, chapter, scenes };
}

/**
 * 保证该章「图片提示词 + 视频提示词」与最新剧本一致
 * mode='both'        → 两者都按当前场景重新生成（对白/剧本有改动时）
 * mode='missingOnly' → 只补齐缺失或条数不匹配的一方
 */
async function ensureChapterPrompts(args: {
  novelId: string;
  userId: string;
  chapterIndex: number;
  mode: 'both' | 'missingOnly';
  push: (event: AgentStreamEvent) => void;
}): Promise<void> {
  const { novelId, userId, chapterIndex, mode, push } = args;
  try {
    const loaded = await loadScriptChapterForAgent(novelId, userId, chapterIndex);
    if (!loaded.chapter || !loaded.scenes.length) return;
    const chapterTitle = String(loaded.chapter.chapterTitle || loaded.chapter.title || ('第' + chapterIndex + '章'));
    const scenes = loaded.scenes;
    const curImg: any[] = Array.isArray(loaded.chapter.imagePrompts) ? loaded.chapter.imagePrompts : [];
    const curVid: any[] = Array.isArray(loaded.chapter.videoPrompts) ? loaded.chapter.videoPrompts : [];
    const needImg = mode === 'both' || curImg.length !== scenes.length;
    const needVid = mode === 'both' || curVid.length !== scenes.length;
    if (!needImg && !needVid) return;
    push({ type: 'text_delta', content: '\n正在按最新剧本同步图片/视频提示词（' + scenes.length + ' 个场景）…' });
    const imgTpl = await getPromptsWithFallback('image-prompts-system', AGENT_IMAGE_PROMPT_FALLBACK, undefined);
    const imageSystemPrompt = stripPlaceholders(imgTpl.systemPrompt) || AGENT_IMAGE_PROMPT_FALLBACK;
    const vidTpl = await getPromptsWithFallback('video-prompts-system', AGENT_VIDEO_PROMPT_FALLBACK, undefined);
    const videoSystemPrompt = stripPlaceholders(vidTpl.systemPrompt) || AGENT_VIDEO_PROMPT_FALLBACK;
    let imagePrompts: any[] = curImg;
    let videoPrompts: any[] = curVid;
    // 失败或返回空 → 保留原提示词（最多重试一次），绝不用空数组覆盖
    const regen = async (kind: 'image' | 'video', sys: string): Promise<any[] | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const out = await generatePromptsForChapter(kind, chapterIndex, chapterTitle, scenes, sys);
          if (Array.isArray(out) && out.length) return out;
        } catch { /* 重试一次 */ }
      }
      return null;
    };
    if (needImg) {
      const out = await regen('image', imageSystemPrompt);
      if (out) imagePrompts = out;
      else push({ type: 'text_delta', content: ' （图片提示词生成失败，已保留原提示词，可点「重刷图片提示词」）' });
    }
    if (needVid) {
      const out = await regen('video', videoSystemPrompt);
      if (out) videoPrompts = out;
      else push({ type: 'text_delta', content: ' （视频提示词生成失败，已保留原提示词，可点「重刷视频提示词」）' });
    }
    await saveScriptChapter(novelId, userId, loaded.pos, chapterTitle, scenes, imagePrompts, videoPrompts);
    push({ type: 'text_delta', content: ' ✓ 图片提示词 ' + imagePrompts.length + ' 条 / 视频提示词 ' + videoPrompts.length + ' 条已按最新剧本同步' });
  } catch (e) {
    push({ type: 'text_delta', content: '\n（提示词同步失败：' + (e instanceof Error ? e.message : String(e)) + '）' });
  }
}

/** 剧本场景重排 / 对白优化 */
async function runScriptRework(args: {
  action: 'script-scenes' | 'script-dialogue';
  sessionId: string;
  novelId: string;
  userId: string;
  chapterIndex: number;
  instruction: string;
  push: (event: AgentStreamEvent) => void;
}): Promise<void> {
  const { action, sessionId, novelId, userId, chapterIndex, instruction, push } = args;
  // 把本次对话记录写入会话，保证重开对话仍能看到历史
  const saveRecord = (text: string, payload?: Record<string, unknown>) => {
    try {
      createAgentMessage({ sessionId, role: 'assistant', content: text, toolName: action, toolPayload: payload ? JSON.stringify(payload) : undefined });
      touchAgentSession(sessionId);
    } catch (e) {
      console.warn('[Agent] 保存对话记录失败:', e instanceof Error ? e.message : e);
    }
  };
  const isSceneMode = action === 'script-scenes';
  const novel = await novelManager.getById(novelId);
  const source = getChapter(novelId, chapterIndex);
  if (!source) {
    push({ type: 'text_delta', content: '没有找到第 ' + chapterIndex + ' 章的正文，请先在左侧选中要处理的章节。\n' });
    push({ type: 'tool_result', toolName: action, summary: '未找到章节', content: '未找到第 ' + chapterIndex + ' 章正文，无法处理剧本。', applied: false });
    saveRecord('未找到第 ' + chapterIndex + ' 章正文，无法处理剧本。', { chapterIndex, applied: false });
    return;
  }
  const loaded = await loadScriptChapterForAgent(novelId, userId, chapterIndex);
  if (!loaded.chapter || !loaded.scenes.length) {
    push({ type: 'text_delta', content: '第 ' + chapterIndex + ' 章还没有剧本，先说一句「把这一章生成剧本」吧。\n' });
    push({ type: 'tool_result', toolName: action, summary: '暂无剧本', content: '第 ' + chapterIndex + ' 章还没有剧本内容，请先生成剧本。', applied: false });
    saveRecord('第 ' + chapterIndex + ' 章还没有剧本内容，请先生成剧本。', { chapterIndex, applied: false });
    return;
  }
  const chapterTitle = String(loaded.chapter.chapterTitle || loaded.chapter.title || source.title || ('第' + chapterIndex + '章'));
  const memory = await loadAgentMemorySettings();
  const body =
    source.content.length > memory.scriptMaxChars
      ? source.content.slice(0, memory.scriptMaxChars) + '\n……（本章过长已截断）'
      : source.content;
  const sceneDigest = loaded.scenes
    .map((sc: any, i: number) => {
      const parts = ['#' + (Number(sc.sceneIndex) || i + 1) + ' ' + (sc.sceneTitle || '')];
      if (sc.location) parts.push('地点：' + sc.location);
      if (sc.description) parts.push('画面：' + sc.description);
      if (sc.actions) parts.push('动作：' + sc.actions);
      const dlg =
        Array.isArray(sc.dialogues) && sc.dialogues.length
          ? sc.dialogues.map((d: any) => (d && d.character ? d.character + '：' + d.line : String((d && d.line) || ''))).join(' / ')
          : '（无对白）';
      parts.push('对白：' + dlg);
      return parts.join('\n');
    })
    .join('\n\n');

  const template = await getPromptsWithFallback(
    'agent-script-system',
    isSceneMode ? AGENT_SCENE_REWORK_FALLBACK : AGENT_DIALOGUE_FALLBACK,
    undefined,
  );
  const baseSystem = stripPlaceholders(template.systemPrompt);
  const systemPrompt = isSceneMode
    ? (baseSystem ? baseSystem + '\n\n' + AGENT_SCENE_REWORK_FALLBACK : AGENT_SCENE_REWORK_FALLBACK)
    : (baseSystem ? baseSystem + '\n\n' + AGENT_DIALOGUE_FALLBACK : AGENT_DIALOGUE_FALLBACK);
  const userMsg = [
    '【小说】' + ((novel as any) && (novel as any).title ? (novel as any).title : ''),
    '【章节】第' + chapterIndex + '章 ' + chapterTitle,
    '【作者要求】' + (instruction || '按最合理的影视化方式优化'),
    ...(isSceneMode
      ? [
          '【拆分数量参考】',
          '- 作者认为场景「太碎/太散/太多」：合并同地点同时段的相邻场景，场次压缩到原来的 60%~70%；',
          '- 作者认为场景「太少/太赶/跳跃」：把信息量大的段落拆细，场次扩充到原来的 130%~150%；',
          '- 作者给出具体场次数（例如「拆成10个场景」「控制在6场」）：必须正好产出该数量。',
        ]
      : []),
    '',
    '【本章现有剧本场景】',
    sceneDigest,
    '',
    '【小说原文（供参考，不要照抄）】',
    body,
  ].join('\n');

  push({ type: 'text_delta', content: (isSceneMode ? '开始重排场景拆分' : '开始补充/优化对白') + '：第' + chapterIndex + '章（现有 ' + loaded.scenes.length + ' 个场景）…' });
  const askOnce = async (extra?: string) => {
    return callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: extra ? userMsg + '\n\n【重要】' + extra : userMsg },
    ], 0.5, 8192, 'script-generate');
  };
  let raw = '';
  try {
    raw = await askOnce();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    push({ type: 'text_delta', content: '\n✗ 生成失败：' + msg });
    push({ type: 'tool_result', toolName: action, summary: '生成失败', content: '调用模型失败：' + msg, applied: false });
    saveRecord('调用模型失败：' + msg, { chapterIndex, applied: false });
    return;
  }
  const parsedOk = isSceneMode ? parseSceneScript(raw).length > 0 : parseSceneDialogues(raw).size > 0;
  if (!parsedOk) {
    push({ type: 'text_delta', content: ' 输出格式不规范，正在重试…' });
    try {
      const retryRaw = await askOnce('上一次的输出无法解析。请只输出严格 JSON（不要解释文字、不要 markdown 代码块），并覆盖全部场景。');
      if (retryRaw && retryRaw.trim()) raw = retryRaw;
    } catch {
      // 保留首次结果，走后续的统一失败提示
    }
  }

  if (isSceneMode) {
    const nextScenes = parseSceneScript(raw);
    if (!nextScenes.length) {
      push({ type: 'text_delta', content: '\n✗ 未解析出场景，已保留原剧本' });
      push({ type: 'tool_result', toolName: action, summary: '解析失败', content: '模型返回内容无法解析为场景，已保留原剧本。', applied: false });
      saveRecord('模型返回内容无法解析为场景，已保留原剧本。', { chapterIndex, applied: false });
      return;
    }
    for (let i = 0; i < nextScenes.length; i++) nextScenes[i].sceneIndex = i + 1;
    // 场景已变化 → 自动重新生成图片/视频提示词，让提示词跟随场景（跟踪变化）
    push({ type: 'text_delta', content: ' 场景已变化，正在自动同步图片提示词…' });
    // 默认沿用原提示词：生成失败/返回空时绝不清空（避免数据丢失）
    let syncImage: any[] = Array.isArray((loaded.chapter as any).imagePrompts) ? (loaded.chapter as any).imagePrompts : [];
    let syncVideo: any[] = Array.isArray((loaded.chapter as any).videoPrompts) ? (loaded.chapter as any).videoPrompts : [];
    try {
      const imgTpl = await getPromptsWithFallback('image-prompts-system', AGENT_IMAGE_PROMPT_FALLBACK, undefined);
      const imageSystemPrompt = stripPlaceholders(imgTpl.systemPrompt) || AGENT_IMAGE_PROMPT_FALLBACK;
      for (let attempt = 0; attempt < 2; attempt++) {
        const out = await generatePromptsForChapter('image', chapterIndex, chapterTitle, nextScenes, imageSystemPrompt);
        if (Array.isArray(out) && out.length) { syncImage = out; break; }
      }
      if (!syncImage.length) push({ type: 'text_delta', content: ' （图片提示词生成失败，已保留原提示词）' });
    } catch (e) {
      push({ type: 'text_delta', content: ' （图片提示词同步失败，已保留原提示词，可稍后点「重刷图片提示词」）' });
    }
    push({ type: 'text_delta', content: ' 正在自动同步视频提示词…' });
    try {
      const vidTpl = await getPromptsWithFallback('video-prompts-system', AGENT_VIDEO_PROMPT_FALLBACK, undefined);
      const videoSystemPrompt = stripPlaceholders(vidTpl.systemPrompt) || AGENT_VIDEO_PROMPT_FALLBACK;
      for (let attempt = 0; attempt < 2; attempt++) {
        const out = await generatePromptsForChapter('video', chapterIndex, chapterTitle, nextScenes, videoSystemPrompt);
        if (Array.isArray(out) && out.length) { syncVideo = out; break; }
      }
      if (!syncVideo.length) push({ type: 'text_delta', content: ' （视频提示词生成失败，已保留原提示词）' });
    } catch (e) {
      push({ type: 'text_delta', content: ' （视频提示词同步失败，已保留原提示词，可稍后点「重刷视频提示词」）' });
    }
    await saveScriptChapter(novelId, userId, loaded.pos, chapterTitle, nextScenes, syncImage, syncVideo);
    const oldCount = loaded.scenes.length;
    const digest = buildScriptDigest(chapterIndex, chapterTitle, nextScenes, syncImage.length, syncVideo.length);
    const content = [
      '已按你的要求重排第' + chapterIndex + '章的场景拆分（' + oldCount + ' 场 → ' + nextScenes.length + ' 场）：',
      '',
      digest,
      '',
      '图片提示词（' + syncImage.length + ' 条）与视频提示词（' + syncVideo.length + ' 条）已自动跟随场景更新。',
    ].join('\n');
    push({ type: 'text_delta', content: '\n✓ 场景拆分完成（' + oldCount + ' 场 → ' + nextScenes.length + ' 场，提示词已自动同步）' });
    push({ type: 'tool_result', toolName: action, summary: '场景 ' + oldCount + ' → ' + nextScenes.length + ' 场，提示词已同步', content, applied: true, chapterIndex });
    addNovelChange({ novelId, userId, action: 'update_script', chapterIndex: loaded.pos, title: '第' + chapterIndex + '章场景重排' });
    push({ type: 'change_applied', action: 'update_script', title: '第' + chapterIndex + '章场景重排' });
    saveRecord(content, { chapterIndex, scenes: nextScenes.length, imagePrompts: syncImage.length, videoPrompts: syncVideo.length, applied: true });
    return;
  }

  const dialogMap = parseSceneDialogues(raw);
  if (!dialogMap.size) {
    push({ type: 'text_delta', content: '\n✗ 未解析出对白，已保留原剧本' });
    push({ type: 'tool_result', toolName: action, summary: '解析失败', content: '模型返回内容无法解析为对白，已保留原剧本。', applied: false });
    saveRecord('模型返回内容无法解析为对白，已保留原剧本。', { chapterIndex, applied: false });
    return;
  }
  let changed = 0;
  const nextScenes = loaded.scenes.map((sc: any, i: number) => {
    const idx = Number(sc && sc.sceneIndex) || i + 1;
    const dialogues = dialogMap.get(idx);
    if (!dialogues) return sc;
    changed++;
    return { ...sc, dialogues };
  });
  await saveScriptChapter(novelId, userId, loaded.pos, chapterTitle, nextScenes);
  const lines = nextScenes.slice(0, 12).map((sc: any, i: number) => {
    const dlgList = Array.isArray(sc.dialogues) && sc.dialogues.length
      ? sc.dialogues.map((d: any) => (d && d.character ? d.character + '：「' + d.line + '」' : '「' + (d && d.line) + '」')).join('；')
      : '（无对白）';
    return (i + 1) + '）' + (sc.sceneTitle || '') + '\n　　' + dlgList;
  });
  const content = [
    '已为第' + chapterIndex + '章补充/优化对白，覆盖 ' + changed + '/' + nextScenes.length + ' 个场景：',
    '',
    ...lines,
    '',
    '可在剧本工作区右侧「剧本场景」页签继续微调。',
  ].join('\n');
  push({ type: 'text_delta', content: '\n✓ 对白已更新（覆盖 ' + changed + ' 个场景）' });
  push({ type: 'tool_result', toolName: action, summary: '对白覆盖 ' + changed + ' 个场景', content, applied: true, chapterIndex });
  addNovelChange({ novelId, userId, action: 'update_script', chapterIndex: loaded.pos, title: '第' + chapterIndex + '章对白优化' });
  push({ type: 'change_applied', action: 'update_script', title: '第' + chapterIndex + '章对白优化' });
  saveRecord(content, { chapterIndex, covered: changed, applied: true });
}

const AGENT_SCENE_META_FALLBACK = [
  '你是资深影视分镜师，负责为已有剧本场景补齐技术参数。',
  '你只输出严格 JSON，不要任何解释文字、不要 markdown 代码块。',
  '',
  '输出格式：',
  '{"scenes":[{"sceneIndex":1,"location":"具体地点","shotType":"远景/全景/中景/近景/特写/过肩镜头","cameraAngle":"正面/侧面/斜侧/俯拍/仰拍/过肩","duration":"6秒","cameraMovement":"固定/推镜/拉镜/摇镜/跟镜"}]}',
  '',
  '硬性要求：',
  '1. sceneIndex 必须与输入的场景编号一一对应，禁止新增、删除、合并或重排场景。',
  '2. 只输出 location / shotType / cameraAngle / duration / cameraMovement 五个字段，不要输出或改写画面描述、动作、对白与舞台指示。',
  '3. location 必须写具体地点（如「废弃村落村口」），禁止只写「室内」「室外」「未知」。',
  '4. shotType 只能从「远景/全景/中景/近景/特写/过肩镜头」中选一个；cameraAngle 只能从「正面/侧面/斜侧/俯拍/仰拍/过肩」中选一个；cameraMovement 只能从「固定/推镜/拉镜/摇镜/跟镜」中选一个。',
  '5. duration 写成「N秒」（常规 4~10 秒）。',
  '6. 参数必须与场景的画面描述、动作、对白相匹配：对白密集的近身戏用中景/近景，环境交代用远景/全景，情绪爆发用特写。',
  '7. 每个场景都必须出现在结果里，五个字段一个都不能为空。',
  '8. 严禁所有场景使用同一套参数：必须按各场景的内容差异分别选择，同地点同机位的场景也要在景别/镜头运动/时长上体现出差别。',
  '9. 输入里标为「未设定」的字段就是需要你补全的字段，请结合该场景的画面描述、动作与对白给出最合适的取值。',
].join('\n');

/** 补齐某个章节所有场景的技术参数（地点/景别/机位/时长/镜头运动），不改动画面、动作与对白 */
async function runScriptSceneMeta(args: {
  sessionId: string;
  novelId: string;
  userId: string;
  chapterIndex: number;
  push: (event: AgentStreamEvent) => void;
}): Promise<void> {
  const { sessionId, novelId, userId, chapterIndex, push } = args;
  const saveRecord = (text: string, payload?: Record<string, unknown>) => {
    try {
      createAgentMessage({ sessionId, role: 'assistant', content: text, toolName: 'script-scene-meta', toolPayload: payload ? JSON.stringify(payload) : undefined });
      touchAgentSession(sessionId);
    } catch (e) {
      console.warn('[Agent] 保存对话记录失败:', e instanceof Error ? e.message : e);
    }
  };
  const loaded = await loadScriptChapterForAgent(novelId, userId, chapterIndex);
  if (!loaded.chapter || !loaded.scenes.length) {
    push({ type: 'text_delta', content: '第 ' + chapterIndex + ' 章还没有剧本，先说一句「把这一章生成剧本」吧。\n' });
    push({ type: 'tool_result', toolName: 'script-scene-meta', summary: '暂无剧本', content: '第 ' + chapterIndex + ' 章还没有剧本内容，请先生成剧本。', applied: false });
    return;
  }
  const chapterTitle = String(loaded.chapter.chapterTitle || loaded.chapter.title || ('第' + chapterIndex + '章'));
  push({ type: 'text_delta', content: '正在补齐场景数据（地点/景别/机位/时长/镜头运动）：第' + chapterIndex + '章（' + loaded.scenes.length + ' 个场景）…' });
  const template = await getPromptsWithFallback('agent-script-system', AGENT_SCENE_META_FALLBACK, undefined);
  const baseSystem = stripPlaceholders(template.systemPrompt);
  const systemPrompt = baseSystem ? baseSystem + '\n\n' + AGENT_SCENE_META_FALLBACK : AGENT_SCENE_META_FALLBACK;
  const sceneBlocks = loaded.scenes.map((sc: any, i: number) => buildScenePromptText(sc, i + 1)).join('\n\n');
  const userMsg = [
    '【章节】第' + chapterIndex + '章 ' + chapterTitle,
    '',
    '共 ' + loaded.scenes.length + ' 个场景，请为每个场景补齐技术参数，sceneIndex 必须与场景编号一一对应，严格按以下 JSON 返回（下面是示例，取值必须按各场景内容分别填写，不要照抄）：',
    '{"scenes":[{"sceneIndex":1,"location":"废弃村落村口","shotType":"全景","cameraAngle":"俯拍","duration":"8秒","cameraMovement":"推镜"}]}',
    '',
    '字段要求（每个场景都必须填写，不得留空，且不得所有场景雷同）：',
    '- location：具体地点，禁止只写「室内」「室外」「未知」；',
    '- shotType：远景/全景/中景/近景/特写/过肩镜头 择一；',
    '- cameraAngle：正面/侧面/斜侧/俯拍/仰拍/过肩 择一；',
    '- duration：写成「N秒」（4~10 秒），按该场景信息量与对白长度决定；',
    '- cameraMovement：固定/推镜/拉镜/摇镜/跟镜 择一，按该场景的情绪与动作决定。',
    '',
    sceneBlocks,
  ].join('\n');
  let raw = '';
  try {
    raw = await callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ], 0.4, 4096, 'script-generate');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    push({ type: 'text_delta', content: '\n✗ 生成失败：' + msg });
    push({ type: 'tool_result', toolName: 'script-scene-meta', summary: '生成失败', content: '调用模型失败：' + msg, applied: false });
    saveRecord('补齐场景数据失败：' + msg, { chapterIndex, applied: false });
    return;
  }
  let metaList = parseSceneMetaOnly(raw);
  const usableCount = (list: any[]) => list.filter((m: any) => m.shotType || m.cameraAngle || m.duration || m.cameraMovement).length;
  if (!usableCount(metaList)) {
    // 只挤出 location、参数全空 → 重试一次，避免把纯默认值当成场景真实数据写库
    push({ type: 'text_delta', content: ' 输出格式不规范，正在重试…' });
    try {
      const retryRaw = await callLLM([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg + '\n\n【重要】上一次输出缺少 shotType / cameraAngle / duration / cameraMovement 的具体取值。请只输出严格 JSON，为每一个场景补齐这四个字段，且各场景取值必须不同。' },
      ], 0.4, 4096, 'script-generate');
      const retryList = parseSceneMetaOnly(retryRaw);
      if (usableCount(retryList)) metaList = retryList;
    } catch { /* 保留首次结果 */ }
  }
  if (!metaList.length || !usableCount(metaList)) {
    push({ type: 'text_delta', content: '\n✗ 未解析出有效的场景参数，已保留原剧本' });
    push({ type: 'tool_result', toolName: 'script-scene-meta', summary: '解析失败', content: '模型未能给出有效的场景技术参数，已保留原剧本。请稍后重试。', applied: false });
    saveRecord('模型未能给出有效的场景技术参数，已保留原剧本。', { chapterIndex, applied: false });
    return;
  }
  const metaMap = new Map<number, any>(metaList.map((m: any) => [Number(m.sceneIndex), m]));
  let changed = 0;
  const nextScenes = loaded.scenes.map((sc: any, i: number) => {
    const idx = Number(sc && sc.sceneIndex) || i + 1;
    const meta: any = metaMap.get(idx);
    if (!meta) return sc;
    changed++;
    // 模型给出的参数优先，缺失时保留场景原值，最终兜底到默认词表
    return {
      ...sc,
      location: meta.location || sc.location || '未指定地点',
      shotType: meta.shotType || sc.shotType || '中景',
      cameraAngle: meta.cameraAngle || sc.cameraAngle || '正面',
      duration: meta.duration || sc.duration || '6秒',
      cameraMovement: meta.cameraMovement || sc.cameraMovement || '固定',
    };
  });
  await saveScriptChapter(novelId, userId, loaded.pos, chapterTitle, nextScenes);
  const digest = buildScriptDigest(chapterIndex, chapterTitle, nextScenes);
  const content = [
    '已补齐第' + chapterIndex + '章 ' + changed + '/' + nextScenes.length + ' 个场景的数据（地点/景别/机位/时长/镜头运动）：',
    '',
    digest,
  ].join('\n');
  push({ type: 'text_delta', content: '\n✓ 场景数据已补齐（' + changed + '/' + nextScenes.length + ' 个场景）' });
  push({ type: 'tool_result', toolName: 'script-scene-meta', summary: '场景数据 ' + changed + '/' + nextScenes.length, content, applied: true, chapterIndex });
  addNovelChange({ novelId, userId, action: 'update_script', chapterIndex: loaded.pos, title: '第' + chapterIndex + '章场景数据补齐' });
  push({ type: 'change_applied', action: 'update_script', title: '第' + chapterIndex + '章场景数据补齐' });
  saveRecord(content, { chapterIndex, covered: changed, applied: true });
}

/** 剧本提示词生成（图片 / 视频） */
async function runScriptPromptGeneration(args: {
  kind: 'image' | 'video';
  sessionId: string;
  novelId: string;
  userId: string;
  chapterIndex: number;
  push: (event: AgentStreamEvent) => void;
}): Promise<void> {
  const { kind, sessionId, novelId, userId, chapterIndex, push } = args;
  const isImage = kind === 'image';
  const saveRecord = (text: string, payload?: Record<string, unknown>) => {
    try {
      createAgentMessage({ sessionId, role: 'assistant', content: text, toolName: isImage ? 'script-image-prompts' : 'script-video-prompts', toolPayload: payload ? JSON.stringify(payload) : undefined });
      touchAgentSession(sessionId);
    } catch (e) {
      console.warn('[Agent] 保存对话记录失败:', e instanceof Error ? e.message : e);
    }
  };
  const label = isImage ? '图片' : '视频';
  const loaded = await loadScriptChapterForAgent(novelId, userId, chapterIndex);
  if (!loaded.chapter || !loaded.scenes.length) {
    push({ type: 'text_delta', content: '第 ' + chapterIndex + ' 章还没有剧本，先说一句「把这一章生成剧本」吧。\n' });
    push({ type: 'tool_result', toolName: isImage ? 'script-image-prompts' : 'script-video-prompts', summary: '暂无剧本', content: '第 ' + chapterIndex + ' 章还没有剧本内容，请先生成剧本。', applied: false });
    return;
  }
  const chapterTitle = String(loaded.chapter.chapterTitle || loaded.chapter.title || ('第' + chapterIndex + '章'));
  push({ type: 'text_delta', content: '正在生成' + label + '提示词：第' + chapterIndex + '章（' + loaded.scenes.length + ' 个场景）…' });
  const template = await getPromptsWithFallback(
    isImage ? 'image-prompts-system' : 'video-prompts-system',
    isImage ? AGENT_IMAGE_PROMPT_FALLBACK : AGENT_VIDEO_PROMPT_FALLBACK,
    undefined,
  );
  const systemPrompt =
    stripPlaceholders(template.systemPrompt) || (isImage ? AGENT_IMAGE_PROMPT_FALLBACK : AGENT_VIDEO_PROMPT_FALLBACK);
  let prompts: any[] = [];
  try {
    prompts = await generatePromptsForChapter(kind, chapterIndex, chapterTitle, loaded.scenes, systemPrompt);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    push({ type: 'text_delta', content: '\n✗ 生成失败：' + msg });
    push({ type: 'tool_result', toolName: isImage ? 'script-image-prompts' : 'script-video-prompts', summary: '生成失败', content: '调用模型失败：' + msg, applied: false });
    saveRecord('生成' + label + '提示词失败：' + msg, { chapterIndex, applied: false });
    return;
  }
  if (!prompts.length) {
    push({ type: 'text_delta', content: '\n✗ 未能生成提示词，请稍后重试' });
    push({ type: 'tool_result', toolName: isImage ? 'script-image-prompts' : 'script-video-prompts', summary: '生成失败', content: '模型返回内容无法解析为提示词，请稍后重试。', applied: false });
    return;
  }
  const saved = await saveChapterPromptField(novelId, userId, loaded.pos, isImage ? 'imagePrompts' : 'videoPrompts', prompts);
  const preview = prompts
    .slice(0, 8)
    .map((p: any, i: number) => (i + 1) + '）' + (p.sceneTitle || '') + '：' + String(p.prompt || '').slice(0, 90))
    .join('\n');
  const content = [
    '已为第' + chapterIndex + '章生成 ' + prompts.length + ' 条' + label + '提示词' + (saved ? '并写入剧本' : '（写入失败，请重试）') + '：',
    '',
    preview,
    prompts.length > 8 ? '\n（其余 ' + (prompts.length - 8) + ' 条请在剧本工作区「' + label + '提示词」页签查看）' : '',
    '',
    '可在剧本工作区右侧「' + label + '提示词」页签继续编辑。',
  ].filter(Boolean).join('\n');
  push({ type: 'text_delta', content: '\n✓ 已生成 ' + prompts.length + ' 条' + label + '提示词' });
  push({ type: 'tool_result', toolName: isImage ? 'script-image-prompts' : 'script-video-prompts', summary: label + '提示词 ' + prompts.length + ' 条', content, applied: saved, chapterIndex });
  addNovelChange({ novelId, userId, action: isImage ? 'generate_image_prompts' : 'generate_video_prompts', chapterIndex: loaded.pos, title: '第' + chapterIndex + '章' + label + '提示词' });
  push({ type: 'change_applied', action: 'update_script', title: '第' + chapterIndex + '章' + label + '提示词' });
  saveRecord(content, { chapterIndex, prompts: prompts.length, applied: saved });
}

function buildScriptDigest(chapterIndex: number, chapterTitle: string, scenes: any[], imagePromptCount = 0, videoPromptCount = 0): string {
  const clip = (text: any, max: number) => {
    const v = String(text || '').replace(/\s+/g, ' ').trim();
    return v.length > max ? v.slice(0, max) + '…' : v;
  };
  const lines: string[] = ['第' + chapterIndex + '章《' + chapterTitle + '》 · ' + scenes.length + ' 个场景' + (imagePromptCount ? ' + ' + imagePromptCount + ' 条图片提示词' : '') + (videoPromptCount ? ' + ' + videoPromptCount + ' 条视频提示词' : '')];
  scenes.slice(0, 12).forEach((sc: any, i: number) => {
    const meta = [sc.location, sc.shotType, sc.cameraAngle, sc.duration, sc.cameraMovement].filter(Boolean).join(' / ');
    lines.push('');
    lines.push((i + 1) + '）' + (sc.sceneTitle || ('场景' + (i + 1))) + (meta ? '（' + meta + '）' : ''));
    if (sc.description) lines.push('　　画面：' + clip(sc.description, 160));
    if (sc.actions) lines.push('　　动作：' + clip(sc.actions, 160));
    if (Array.isArray(sc.dialogues) && sc.dialogues.length) {
      const dlg = sc.dialogues.slice(0, 6).map((d: any) => (d.character ? d.character + '：「' + clip(d.line, 80) + '」' : clip(d.line, 80))).join('；');
      lines.push('　　对白：' + dlg);
    }
    if (sc.stageDirections) lines.push('　　音效/提示：' + clip(sc.stageDirections, 140));
  });
  if (scenes.length > 12) lines.push('', '（其余 ' + (scenes.length - 12) + ' 个场景请在剧本工坊查看）');
  return lines.join('\n');
}

async function runScriptGeneration(args: {
  userId: string;
  sessionId: string;
  runId: string;
  novelId: string | null | undefined;
  chapterIndex: number | null | undefined;
  prompt: string;
  push: (event: AgentStreamEvent) => void;
}): Promise<void> {
  const { userId, sessionId, runId, novelId, chapterIndex, prompt, push } = args;
  const finish = (status: 'finished' | 'failed') => {
    push({ type: 'run_finished', runId, status: 'finished' });
    updateAgentRunStatus(runId, status);
  };
  const bail = (tip: string, summary: string) => {
    createAgentMessage({ sessionId, role: 'assistant', content: tip, toolName: 'generate-script' });
    push({ type: 'text_delta', content: tip });
    push({ type: 'tool_result', toolName: 'chat', summary, content: tip, applied: false });
    finish('finished');
  };
  try {
    if (!novelId) {
      bail('请先选中一部作品（在小说页或创作工作区打开一本小说），我才能把它的章节改编成剧本。', '缺少作品');
      return;
    }

    const novel = await novelManager.getById(novelId);
    const rawChapters: any = novel ? (novel as any).chapters : null;
    let chapterList: any[] = [];
    if (Array.isArray(rawChapters)) chapterList = rawChapters;
    else if (typeof rawChapters === 'string') {
      try { const parsed = JSON.parse(rawChapters); if (Array.isArray(parsed)) chapterList = parsed; } catch { /* ignore */ }
    }
    if (!chapterList.length) {
      bail('这部作品还没有章节正文，无法改编成剧本。请先生成或导入小说章节。', '没有章节');
      return;
    }

    const fallback = typeof chapterIndex === 'number' && chapterIndex > 0 ? chapterIndex : (Number(chapterList[0] && chapterList[0].index) || 1);
    const range = parseScriptRange(prompt, fallback);
    const end = Math.min(range.end, range.start + 4);
    const targets: { pos: number; index: number; title: string; content: string }[] = [];
    for (let n = range.start; n <= end; n++) {
      let pos = chapterList.findIndex((c) => Number(c && c.index) === n);
      if (pos < 0) pos = n - 1;
      const ch = chapterList[pos];
      if (!ch) continue;
      targets.push({ pos, index: Number(ch.index) || n, title: ch.title || ('第' + n + '章'), content: ch.content || '' });
    }
    if (!targets.length) {
      bail('没有找到要改编的章节，请说明章节号，例如「把第2章生成剧本」。', '未找到章节');
      return;
    }

    push({ type: 'text_delta', content: '开始改编剧本：第' + range.start + '~' + end + '章，共 ' + targets.length + ' 章。\n' });
    const memory = await loadAgentMemorySettings();
    const prompts = await getPromptsWithFallback('agent-script-system', AGENT_SCRIPT_FALLBACK, undefined);
    const imagePromptTemplate = await getPromptsWithFallback('image-prompts-system', AGENT_IMAGE_PROMPT_FALLBACK, undefined);
    const imageSystemPrompt = stripPlaceholders(imagePromptTemplate.systemPrompt) || AGENT_IMAGE_PROMPT_FALLBACK;
    const videoPromptTemplate = await getPromptsWithFallback('video-prompts-system', AGENT_VIDEO_PROMPT_FALLBACK, undefined);
    const videoSystemPrompt = stripPlaceholders(videoPromptTemplate.systemPrompt) || AGENT_VIDEO_PROMPT_FALLBACK;
    // 组合后的系统提示词末尾是「剧本改编核心技能」的格式规范（要求分行输出），会把 JSON 输出契约带偏，
    // 导致模型偶发返回非 JSON → 解析失败。这里把 JSON 结构要求追加到最后，保证输出契约优先级最高
    // （与 runScriptRework 追加 AGENT_SCENE_REWORK_FALLBACK 的做法保持一致）。
    const scriptSystemPrompt = (prompts.systemPrompt || '').trim() + '\n\n' + AGENT_SCRIPT_FALLBACK;

    const results: { index: number; pos: number; title: string; sceneCount: number; imagePromptCount: number; videoPromptCount: number }[] = [];
    const digests: string[] = [];
    for (const target of targets) {
      push({ type: 'text_delta', content: '\n▶ 第' + target.index + '章《' + target.title + '》改编中…' });
      const body = target.content.length > memory.scriptMaxChars ? target.content.slice(0, memory.scriptMaxChars) + '\n……（本章过长已截断）' : target.content;
      const userMsg = ['【小说】' + (((novel as any) && (novel as any).title) || ''), '【章节】第' + target.index + '章 ' + target.title, '', body].join('\n');
      let raw = '';
      try {
        raw = await callLLM([
          { role: 'system', content: scriptSystemPrompt },
          { role: 'user', content: userMsg },
        ], 0.4, 8192, 'script-generate');
      } catch (e) {
        push({ type: 'text_delta', content: ' ✗ 生成失败：' + (e instanceof Error ? e.message : String(e)) });
        continue;
      }
      let scenes = parseSceneScript(raw);
      if (!scenes.length) {
        // 诊断：把首次失败的原始输出落日志，便于定位模型返回了什么（截断 / 换结构 / 非 JSON）
        console.warn('[Agent] 生成剧本首次解析失败 rawLen=' + raw.length + ' head=' + raw.slice(0, 300).replace(/\s+/g, ' ') + ' tail=' + raw.slice(-120).replace(/\s+/g, ' '));
        push({ type: 'text_delta', content: ' 输出格式不规范，正在重试…' });
        try {
          const retryRaw = await callLLM([
            { role: 'system', content: scriptSystemPrompt },
            { role: 'user', content: userMsg + '\n\n【重要】上一次输出无法解析。请只输出严格 JSON（不要解释文字、不要 markdown 代码块、不要任何额外字段示例），顶层结构必须严格为：{"scenes":[{"sceneIndex":1,"sceneTitle":"","location":"","shotType":"","cameraAngle":"","duration":"","cameraMovement":"","description":"","actions":"","dialogues":[{"character":"","line":""}],"stageDirections":""}]}，必须是完整闭合的 JSON。' },
          ], 0.4, 8192, 'script-generate');
          if (retryRaw && retryRaw.trim()) {
            const retryScenes = parseSceneScript(retryRaw);
            if (retryScenes.length) {
              scenes = retryScenes;
              raw = retryRaw;
            }
          }
        } catch { /* 保留首次结果 */ }
      }
      if (!scenes.length) {
        push({ type: 'text_delta', content: ' ✗ 未解析出场景，已跳过' });
        continue;
      }
      push({ type: 'text_delta', content: ' 正在补充图片提示词…' });
      let imagePrompts: any[] = [];
      try {
        imagePrompts = await generatePromptsForChapter('image', target.index, target.title, scenes, imageSystemPrompt);
      } catch (e) {
        push({ type: 'text_delta', content: ' （图片提示词生成失败，已跳过：' + (e instanceof Error ? e.message : String(e)) + '）' });
      }
      push({ type: 'text_delta', content: ' 正在补充视频提示词…' });
      let videoPrompts: any[] = [];
      try {
        videoPrompts = await generatePromptsForChapter('video', target.index, target.title, scenes, videoSystemPrompt);
      } catch (e) {
        push({ type: 'text_delta', content: ' （视频提示词生成失败，已跳过：' + (e instanceof Error ? e.message : String(e)) + '）' });
      }
      await saveScriptChapter(novelId, userId, target.pos, target.title, scenes, imagePrompts, videoPrompts);
      digests.push(buildScriptDigest(target.index, target.title, scenes, imagePrompts.length, videoPrompts.length));
      results.push({ index: target.index, pos: target.pos, title: target.title, sceneCount: scenes.length, imagePromptCount: imagePrompts.length, videoPromptCount: videoPrompts.length });
      push({ type: 'text_delta', content: ' ✓ ' + scenes.length + ' 个场景' + (imagePrompts.length ? ' + ' + imagePrompts.length + ' 条图片提示词' : '') + (videoPrompts.length ? ' + ' + videoPrompts.length + ' 条视频提示词' : '') + '已写入剧本' });
      addNovelChange({ novelId, userId, action: 'generate_script', chapterIndex: target.pos, title: '第' + target.index + '章剧本' });
      push({ type: 'change_applied', action: 'generate_script', title: '第' + target.index + '章剧本' });
    }

    if (!results.length) {
      bail('本次没有生成出有效剧本，请稍后重试，或改说「把第2章生成剧本」。', '生成失败');
      return;
    }

    // 生成剧本后：把图片/视频提示词自动对应到短剧的图片分镜 / 视频分镜
    let storyboardNote = '';
    try {
      const synced = await syncNovelScriptPromptsToDramas(novelId, { overwrite: false });
      if (synced.imageFilled || synced.videoFilled) {
        storyboardNote = '已自动同步到短剧制作：图片分镜 ' + synced.imageFilled + ' 条、视频分镜 ' + synced.videoFilled + ' 条提示词'
          + (synced.shotsCreated ? '（自动创建 ' + synced.shotsCreated + ' 个分镜）' : '') + '。';
      }
    } catch (e) {
      console.error('[generate-script] 同步短剧分镜提示词失败:', e);
    }

    const contentLines = ['已把小说改编成剧本，并写入「我的剧本」（共 ' + results.length + ' 章）：'];
    for (const digest of digests) {
      contentLines.push('');
      contentLines.push(digest);
    }
    contentLines.push('');
    contentLines.push('图片提示词与视频提示词已一并写入，可在「剧本工坊」查看/继续编辑。');
    if (storyboardNote) contentLines.push(storyboardNote);
    const content = contentLines.join('\n');
    const summary = '已生成 ' + results.length + ' 章剧本（' + results.map((r) => '第' + r.index + '章 ' + r.sceneCount + ' 场/' + r.imagePromptCount + ' 图/' + r.videoPromptCount + ' 视频').join('；') + '）';
    createAgentMessage({ sessionId, role: 'assistant', content, toolName: 'generate-script' });
    push({ type: 'text_delta', content: '\n\n' + content });
    push({ type: 'tool_result', toolName: 'generate-script', summary, content, applied: true, chapterIndex: results[0].pos });
    push({ type: 'change_applied', action: 'generate_script', title: '剧本已更新' });
    finish('finished');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    push({ type: 'text_delta', content: '\n生成剧本失败：' + message });
    push({ type: 'run_error', runId, message: '生成剧本失败：' + message });
    updateAgentRunStatus(runId, 'failed');
  }
}

export async function runAgentLoop(opts: RunAgentLoopOptions): Promise<void> {
  const { userId, sessionId, novelId, chapterIndex, prompt, push, narrativePerspective, genderTarget, category, skipUserMessage } = opts;
  const run = createAgentRun({
    sessionId, userId, novelId, chapterIndex, prompt,
  });
  push({ type: 'run_start', runId: run.id, sessionId });

  try {
    // 1) 存用户消息（追问轮次不重复落库）
    if (!skipUserMessage) createAgentMessage({ sessionId, role: 'user', content: prompt });

    // 2) 装载上下文
    let chapter = null as { title: string; content: string; index: number } | null;
    if (novelId && typeof chapterIndex === 'number') chapter = getChapter(novelId, chapterIndex);
    const ctx = {
      novelTitle: '', chapterTitle: chapter ? chapter.title : '', chapterContent: chapter ? chapter.content : '',
      hasChapter: !!chapter,
    };
    console.log('[Agent-Ctx] novelId=', novelId, 'chapterIndex=', chapterIndex, 'hasChapter=', !!chapter, 'chLen=', chapter?.content.length);

    // 3) 意图识别
    let action = localIntent(prompt);
    let instruction = '';
    if (!action) {
      const raw = await callLLM([
        { role: 'system', content: buildIntentSystemPrompt() },
        { role: 'user', content: prompt },
      ], 0.2, 300, 'agent-chat');
      const parsed = parseIntent(raw);
      action = parsed.action;
      instruction = parsed.instruction;
    }
    if (!action) action = 'chat';
    push({ type: 'intent', action, instruction: instruction || prompt });

    // 4) 执行动作
    if (action === 'generate') {
      // 第一步：先让用户选择目标读者方向（男频/女频）
      if (!genderTarget) {
        push({ type: 'need_gender', options: ['male', 'female'], default: 'male' });
        createAgentMessage({
          sessionId, role: 'assistant',
          content: '开始生成前，请先选择本篇的目标读者方向（男频 / 女频）。选好后我会继续带你确认叙事视角。',
          toolName: 'ask_gender',
        });
        push({ type: 'tool_result', toolName: 'chat', summary: '等待选择性别方向', content: '请在上方选择男频 / 女频后，点击「下一步」。', applied: false });
        push({ type: 'run_finished', runId: run.id, status: 'finished' });
        updateAgentRunStatus(run.id, 'finished');
        return;
      }
      // 第二步：确认叙事视角（选定后再继续）
      if (!narrativePerspective) {
        push({ type: 'need_perspective', options: ['third-omniscient', 'third-limited', 'first-person', 'second-person'], default: 'third-omniscient' });
        createAgentMessage({
          sessionId, role: 'assistant',
          content: '开始生成前，请先选择本篇的叙事视角（默认：第三人称全知）。选好后我会立刻开始逐章创作。',
          toolName: 'ask_perspective',
        });
        push({ type: 'tool_result', toolName: 'chat', summary: '等待选择叙事视角', content: '请在上方选择叙事视角后，点击「确认并开始生成」。', applied: false });
        push({ type: 'run_finished', runId: run.id, status: 'finished' });
        updateAgentRunStatus(run.id, 'finished');
        return;
      }
      // 第三步：确认小说类型（选定后再继续）
      if (!category) {
        push({ type: 'need_category', options: CATEGORY_OPTIONS, default: CATEGORY_OPTIONS[0], tree: CATEGORY_TREE });
        createAgentMessage({
          sessionId, role: 'assistant',
          content: '还差最后一步：请选择本篇的小说类型（大类）。选好后我会立刻开始逐章创作。',
          toolName: 'ask_category',
        });
        push({ type: 'tool_result', toolName: 'chat', summary: '等待选择小说类型', content: '请在上方选择小说类型后，点击「确认并开始生成」。', applied: false });
        push({ type: 'run_finished', runId: run.id, status: 'finished' });
        updateAgentRunStatus(run.id, 'finished');
        return;
      }
      // 后台运行：不 await，客户端断开或切换页面都不会中断生成
      void generateNovelRun({ userId, sessionId, prompt, push, narrativePerspective, genderTarget, category }).catch((e) => {
        console.error('[Agent-Gen] 后台生成异常:', e instanceof Error ? e.message : e);
      });
      push({ type: 'generation_queued', sessionId });
      return;
    }

    if (action === 'generate-script') {
      await runScriptGeneration({ userId, sessionId, runId: run.id, novelId, chapterIndex, prompt, push });
      return;
    }

    if (
      action === 'script-scenes' || action === 'script-dialogue' || action === 'script-scene-meta' ||
      action === 'script-image-prompts' || action === 'script-video-prompts'
    ) {
      if (!novelId) {
        push({ type: 'tool_result', toolName: action, summary: '未选中作品', content: '请先在左侧选中一部作品，我才能处理它的剧本。', applied: false });
      } else if (typeof chapterIndex !== 'number' || chapterIndex <= 0) {
        push({ type: 'tool_result', toolName: action, summary: '未选中章节', content: '请先选中要处理的具体章节，我才能修改它的剧本。', applied: false });
      } else if (action === 'script-scene-meta') {
        await runScriptSceneMeta({ sessionId, novelId, userId, chapterIndex, push });
        // 场景数据变化 → 图片与视频提示词都按最新场景数据重新生成
        await ensureChapterPrompts({ novelId, userId, chapterIndex, mode: 'both', push });
      } else if (action === 'script-scenes' || action === 'script-dialogue') {
        await runScriptRework({ action, sessionId, novelId, userId, chapterIndex, instruction: instruction || prompt, push });
        // 凡是通过剧本 Agent 对话改动了剧本（场景/对白）→ 图片与视频提示词都按最新剧本同步
        await ensureChapterPrompts({
          novelId, userId, chapterIndex,
          mode: action === 'script-dialogue' ? 'both' : 'missingOnly',
          push,
        });
      } else {
        await runScriptPromptGeneration({
          kind: action === 'script-image-prompts' ? 'image' : 'video',
          sessionId, novelId, userId, chapterIndex, push,
        });
        // 生成其中一种后，另一种若缺失/不匹配也一并补齐（图片与视频都要走）
        await ensureChapterPrompts({ novelId, userId, chapterIndex, mode: 'missingOnly', push });
      }
      push({ type: 'run_finished', runId: run.id, status: 'finished' });
      updateAgentRunStatus(run.id, 'finished');
      return;
    }
    let assistantContent = '';
    if (action === 'review' || action === 'summary' || action === 'chat') {
      // 不写回正文：直接流式回答
      const memory = await loadAgentMemorySettings();
      const history = await buildSessionHistory(sessionId, memory);
      const msgs: ChatMessage[] = [
        { role: 'system', content: buildContextSystem(ctx) },
        ...history,
        { role: 'user', content: buildChapterContextMessage(ctx, prompt, instruction, action, memory.chapterMaxChars) },
      ];
      assistantContent = await streamLLMWithRetry(msgs, await getTemperature(null, 0.7), 4096, push, 3, 'agent-chat');
      // 记录 assistant 消息 + 标记完成
      const msg = createAgentMessage({ sessionId, role: 'assistant' as const, content: assistantContent, toolName: action });
      push({ type: 'tool_result', toolName: action, summary: '', content: assistantContent, applied: false });
      push({ type: 'run_finished', runId: run.id, status: 'finished', messageId: msg.id });
      updateAgentRunStatus(run.id, 'finished');
    } else {
      // 写回类：rewrite / continue / polish / expand / condense
      // 续写：以「最后一章」为基准（而非当前选中章节），生成内容后新增一章
      let continueBase: { index: number; title: string; content: string } | null = null;
      if (action === 'continue' && novelId) {
        const last = getLastChapter(novelId);
        if (last) {
          continueBase = { index: Number(last.index) || 0, title: last.title || '', content: last.content || '' };
          ctx.chapterTitle = continueBase.title;
          ctx.chapterContent = continueBase.content;
          ctx.hasChapter = true;
          chapter = { index: continueBase.index, title: continueBase.title, content: continueBase.content };
          console.log('[Agent] 续写基准：最后一章 第' + continueBase.index + '章 len=' + continueBase.content.length);
        } else {
          console.log('[Agent] 续写：作品暂无章节，按空白起笔');
        }
      }
      const digestIndex = (action === 'continue' && continueBase) ? continueBase.index : (chapterIndex ?? (chapter ? chapter.index : 1));
      let digest = '';
      if (novelId) {
        try { digest = await storyMemoryManager.buildMemoryDigest(novelId, userId, digestIndex); } catch { digest = ''; }
      }
      const memory = await loadAgentMemorySettings();
      const history = await buildSessionHistory(sessionId, memory);
      const msgs: ChatMessage[] = [
        { role: 'system', content: buildContextSystem(ctx, digest) },
        ...history,
        { role: 'user', content: buildChapterContextMessage(ctx, prompt, instruction, action, memory.chapterMaxChars) },
      ];
      const newContent = await streamLLMWithRetry(msgs, await getTemperature(null, 0.8), 8192, push, 3, 'agent-writeback');
      if (!newContent.trim()) throw new Error('生成内容为空');

      // 根据动作决定最终写回正文
      const finalContent = newContent;
      let applied = false;
      let appliedIndex: number | null = chapterIndex ?? (chapter ? chapter.index : null);
      let appliedTitle = chapter ? chapter.title : '';
      if (action === 'continue' && novelId) {
        // 续写：新增一章（自动生成章节标题），原有章节内容保持不变
        const ownerCheck = await novelManager.getById(novelId);
        if (ownerCheck) {
          const newIndex = (continueBase ? continueBase.index : 0) + 1;
          const newTitle = await generateNewChapterTitle(ownerCheck.title || '', newContent, newIndex);
          const appended = await appendChapter(novelId, ownerCheck.userId, newContent.trim(), newTitle);
          if (appended) {
            applied = true;
            appliedIndex = appended;
            appliedTitle = newTitle;
            console.log('[Agent] 续写已新增章节: ' + newTitle);
          }
        }
      } else if (novelId && typeof chapterIndex === 'number') {
        // 改写/润色直接整体替换；若当前无章节，仍把生成内容作为可应用正文返回
        const ownerCheck = await novelManager.getById(novelId);
        if (ownerCheck) {
          applied = await applyChapterContent(novelId, ownerCheck.userId, chapterIndex, finalContent);
        }
      }
      const msg = createAgentMessage({
        sessionId, role: 'assistant' as const, content: newContent,
        toolName: action, toolPayload: JSON.stringify({ chapterIndex: appliedIndex, applied }),
      });
      if (applied && novelId) {
        addNovelChange({ novelId, userId, action: 'apply_' + action, chapterIndex: appliedIndex, title: appliedTitle });
        void rememberChapter(novelId, userId, appliedIndex ?? 1, finalContent, push);
      }
      push({ type: 'tool_result', toolName: action, summary: action === 'continue' ? (applied ? '已新增一章并写回' : '已完成') : ('已完成' + (applied ? '并已写回章节' : '')), content: finalContent, applied, chapterIndex: appliedIndex });
      push({ type: 'run_finished', runId: run.id, status: 'finished', messageId: msg.id });
      updateAgentRunStatus(run.id, 'finished');
    }

    if (sessionId) touchAgentSession(sessionId);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Agent] run failed:', describeFetchError(error));
    updateAgentRunStatus(run.id, 'failed', msg);
    const friendly = isRetryableNetworkError(error)
      ? '模型网络连接中断（' + msg + '）：已自动重试多次仍未成功，请稍后重试，或检查网络 / 接口配置。'
      : msg;
    push({ type: 'run_error', runId: run.id, message: friendly });
  }
}


// ========== 生成一部小说（成书模式：建书 + 大纲 + 逐章正文写回） ==========
interface GenerateNovelOptions {
  userId: string;
  sessionId: string;
  prompt: string;
  push: (event: AgentStreamEvent) => void;
  narrativePerspective?: string;
  genderTarget?: string;
  category?: string;
}

/** 读取作品设定里的原始提示词（用于判断是否同一条指令） */
function readPremise(idea: unknown): string {
  if (!idea) return '';
  let v: unknown = idea;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return ''; }
  }
  if (v && typeof v === 'object') {
    const p = (v as Record<string, unknown>).premise;
    return typeof p === 'string' ? p : '';
  }
  return '';
}

function extractEpisodeCount(prompt: string): number {
  const m = prompt.match(/(\d+)\s*(集|章)/);
  const n = m ? parseInt(m[1], 10) : 20;
  return Math.min(500, Math.max(1, n));
}

function parseJsonLoose(raw: string): unknown {
  if (!raw) return null;
  const cleaned = String(raw).replace(/```json/gi, '```').replace(/```/g, '').trim();
  // 1) 整体解析
  try { return JSON.parse(cleaned); } catch { /* continue */ }
  // 2) 数组（大纲/标题等以数组返回）
  const arr = cleaned.match(/\[[\s\S]*\]/);
  if (arr) { try { return JSON.parse(arr[0]); } catch { /* continue */ } }
  // 3) 对象
  const obj = cleaned.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch { /* continue */ } }
  return null;
}

async function llmJson(messages: { role: 'system' | 'user' | 'assistant'; content: string }[], temp = 0.5, maxTokens = 1200): Promise<unknown> {
  const raw = await callLLM(messages, temp, maxTokens);
  const parsed = parseJsonLoose(raw);
  if (parsed === null) {
    console.warn('[Agent-LLM] JSON 解析失败，原始响应前 600 字：', String(raw || '').slice(0, 600));
  }
  return parsed;
}

/** 兼容多种返回形态，把大纲归一化为 [{t,h}] */
function extractHookItems(input: unknown): { t: string; h: string }[] {
  if (!input) return [];
  let arr: unknown[] | null = null;
  if (Array.isArray(input)) arr = input;
  else if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const arrVal = Object.values(obj).find((v) => Array.isArray(v));
    if (Array.isArray(arrVal)) arr = arrVal as unknown[];
    else {
      const numeric = Object.entries(obj).filter(([k]) => /^\s*\d+\s*$/.test(k));
      arr = numeric.length
        ? numeric.sort((a, b) => Number(a[0]) - Number(b[0])).map(([, v]) => v)
        : Object.values(obj);
    }
  }
  if (!arr) return [];
  return arr.map((it) => {
    if (typeof it === 'string') return { t: it, h: '' };
    if (it && typeof it === 'object') {
      const o = it as Record<string, unknown>;
      const t = (o.t ?? o.title ?? o.name ?? o.chapterTitle ?? o.chapter ?? '') as unknown;
      const h = (o.h ?? o.hook ?? o.summary ?? o.plot ?? o.content ?? o.outline ?? '') as unknown;
      return { t: typeof t === 'string' ? t : String(t ?? ''), h: typeof h === 'string' ? h : String(h ?? '') };
    }
    return { t: '', h: '' };
  });
}

/** 从原始文本里正则捞一个字符串字段（JSON 解析失败时的兜底） */
function extractJsonStringField(raw: string | null | undefined, key: string): string {
  if (!raw) return '';
  const re = new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"');
  const m = String(raw).match(re);
  if (!m) return '';
  return m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
}

/** 小说类型（大类 + 二级类型）—— 供对话中让用户选择 */
const CATEGORY_TREE: { name: string; genres: string[] }[] = [
  { name: '奇幻玄幻', genres: ['奇幻', '仙侠', '武侠', '东方玄幻', '西方奇幻', '史诗奇幻'] },
  { name: '都市现实', genres: ['都市', '历史', '校园', '商战', '体育', '日常', '社会问题'] },
  { name: '科幻悬疑', genres: ['科幻', '赛博朋克', '太空歌剧', '悬疑', '惊悚', '恐怖', '末世'] },
  { name: '冒险异能', genres: ['冒险', '穿越', '重生', '异界穿越', '系统流', '游戏', '末世求生'] },
  { name: '情感言情', genres: ['言情', '甜宠', '虐恋', '古言', '现言', '多角恋'] },
  { name: '军事战争', genres: ['军事', '战争', '特种兵', '谍战', '生存'] },
];
const CATEGORY_OPTIONS = CATEGORY_TREE.map((c) => c.name);

const GEN_WRITER_SYSTEM = `你是一位资深中文网文作家。你必须直接输出高质量小说正文，符合男频/女频的风格特点：
- 男频：热血、升级、打脸、节奏快、爽点密集
- 女频：细腻情感、人物互动、氛围感强
写作要求：
1. 禁止输出任何标题、序号、markdown、解释说明，只输出正文。
2. 对话占适当比例，自带换行段落；叙事流畅，动作与心理结合。
3. 每章结尾留一个钩子（悬念/冲突/反转），吸引读者看下一章。
4. 不写空话套话，不输出"接下来"之类内容。
5. 【篇幅·硬性红线】每章正文必须控制在 1000-1800 个中文字符之间，1800 字是绝对上限。组织方式：按 5-8 个自然段写完（每段 150-300 字），讲完本章核心情节即可收尾并留钩子。严禁注水、堆砌形容词、重复叙述、大段回忆或环境铺陈。输出前必须自检：若超过 1800 字，删除冗余描写后再输出；若不足 1000 字，补足关键情节与对话。`;

async function generateNovelRun(opts: GenerateNovelOptions): Promise<void> {
  const { userId, sessionId, prompt, push, narrativePerspective, genderTarget: genderOverride, category: categoryOverride } = opts;
  const total = extractEpisodeCount(prompt);

  // 断点续传：同一会话 + 同一条指令 + 已有正文 且 上次未完成 → 从断点继续，而不是重开一本
  {
    const prevGen = getGeneration(sessionId);
    if (prevGen && prevGen.novelId && prevGen.status !== 'finished') {
      const done = (prevGen.chapters ?? []).filter((c) => String(c.content ?? '').trim().length > 0);
      if (done.length > 0) {
        const prevNovel = await novelManager.getById(prevGen.novelId).catch(() => null);
        const prevPremise = readPremise((prevNovel as any)?.idea);
        if (prevPremise && prevPremise.trim() === prompt.trim()) {
          await resumeNovelRun(opts, prevGen, done, total);
          return;
        }
        console.log('[Agent-Gen] 会话有未完成任务但指令不同 → 按新书处理');
      }
    }
  }
  try {
    // 初始化生成任务状态（供前端轮询/恢复历史）
    upsertGeneration({ sessionId, userId, total, current: 0, status: 'preparing', chapters: [] });
    // 1) 元数据（标题/简介/分类/设定）
    push({ type: 'intent', action: 'generate', instruction: prompt });
    const metaSystem = '你是小说创作策划。根据用户提供的设定输出纯 JSON（必须包含全部字段，不可省略）：{"title":"书名","description":"完整简介（200-400字，必须覆盖用户设定中的全部关键信息：主角、所有宠物/配角及其名字、世界观、核心矛盾与主线走向，不要遗漏任何设定细节，不要压缩成一句话）","category":"题材分类(玄幻/都市/科幻/悬疑/言情/历史/游戏等)","genderTarget":"male或female","tone":["基调词"],"protagonist":"主角名与身份","narrativePerspective":"third-omniscient"}。要求：书名新颖有网感、4-12字，必须给出真实书名，禁止留空。叙事视角固定用 third-omniscient（第三人称全知），除非用户在设定中明确要求其他视角。只输出 JSON，不要任何解释。';
    let metaText = await callLLM([{ role: 'system', content: metaSystem }, { role: 'user', content: prompt }], 0.4, 1600);
    let metaObj = parseJsonLoose(metaText) as Record<string, unknown> | null;
    let titleFallback = extractJsonStringField(metaText, 'title');
    if (!metaObj || typeof metaObj !== 'object' || !String((metaObj as Record<string, unknown>).title ?? '').trim()) {
      console.warn('[Agent-Gen] 元数据缺失，重试一次。首次前120字：', String(metaText || '').slice(0, 120));
      metaText = await callLLM([{ role: 'system', content: metaSystem }, { role: 'user', content: prompt }], 0.5, 1600);
      metaObj = parseJsonLoose(metaText) as Record<string, unknown> | null;
      titleFallback = extractJsonStringField(metaText, 'title') || titleFallback;
    }
    const meta = (metaObj ?? {}) as { title?: string; description?: string; category?: string; genderTarget?: string; tone?: string[]; protagonist?: string; narrativePerspective?: string };
    const title = (meta.title || titleFallback || '未命名之作').trim().slice(0, 40);
    const description = (meta.description || '').trim().slice(0, 2000) || prompt;
    const genderTarget = genderOverride === 'female' ? 'female' : (genderOverride === 'male' ? 'male' : (meta.genderTarget === 'female' ? 'female' : 'male'));
    const category = (categoryOverride || meta.category || '玄幻').trim();

    // 2) 建书（draft，先写元数据，chapters 为空）
    const novel = await novelManager.create({
      userId,
      title,
      description,
      category,
      genderTarget,
      tone: meta.tone ?? [],
      protagonist: meta.protagonist ?? '',
      narrativePerspective: narrativePerspective || meta.narrativePerspective || 'third-omniscient',
      idea: { premise: prompt },
      totalChapters: total,
      currentChapters: 0,
      status: 'published',
    } as any);
    push({ type: 'generation_start', novelId: novel.id, title, total });
    upsertGeneration({ sessionId, userId, novelId: novel.id, title, total, current: 0, status: 'running', chapters: [] });
    const chapters: { index: number; title: string; content: string }[] = [];
    const persistChapters: { index: number; title: string; content: string }[] = [];

    // 3) 大纲（分批生成，杜绝一次性输出被截断导致标题全空）
    const hookList = await generateOutline({ title, description, prompt, total, push });
    const titled = hookList.filter((h) => h.rawTitle).length;
    console.log('[Agent-Gen] 大纲条目数 =', titled, '/', total);
    // 持久化大纲，供断点续传恢复后续章节的标题与剧情
    try {
      const baseStruct = novel.structure && typeof novel.structure === 'object' ? (novel.structure as Record<string, unknown>) : {};
      await novelManager.update(novel.id, userId, {
        structure: { ...baseStruct, agentOutline: hookList.map((h) => ({ t: h.rawTitle, h: h.hook })) },
      } as any);
    } catch (e) {
      console.warn('[Agent-Gen] 保存大纲失败', e instanceof Error ? e.message : e);
    }

    // 4) 逐章生成正文（带重试与断流恢复；已完成章节直接复用）
    await writeChapterLoop({
      userId, sessionId, push, prompt,
      novelId: novel.id, title, category, genderTarget,
      hookList, chapters, total, persistChapters,
    });

    await finalizeGeneration({ userId, sessionId, push, prompt, novelId: novel.id, title, total, chapters, persistChapters });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Agent-Gen] 生成小说失败:', msg);
    try { upsertGeneration({ sessionId, userId, status: 'error', error: msg }); } catch { /* ignore */ }
    push({ type: 'run_error', runId: '', message: '生成小说失败：' + msg });
  }
}

// ========== 成书：大纲分批 / 逐章循环（重试）/ 收尾 / 断点续传 ==========
const OUTLINE_BATCH = 20;
const OUTLINE_REQ_ATTEMPTS = 2;
const OUTLINE_MAX_TOKENS = 6000;
const CHAPTER_MAX_ATTEMPTS = 3;

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 取某一章区间的细纲；失败会重试，仍失败则把区间拆半递归，保证模型每次只面对更小的任务 */
async function fetchOutlineRange(opts: {
  title: string;
  description: string;
  prompt: string;
  start: number;
  end: number;
  ctxBefore: { t: string; h: string }[];
}): Promise<{ t: string; h: string }[]> {
  const { title, description, prompt, start, end, ctxBefore } = opts;
  const want = end - start + 1;
  const prevBrief = ctxBefore
    .slice(-6)
    .map((h, k) => '第' + (ctxBefore.length - 6 + k + 1) + '章：' + (h.t || '') + ' — ' + String(h.h || '').slice(0, 40))
    .join('\n');
  const sys =
    '你是网文大纲设计师。为小说输出【第' + start + '章 到 第' + end + '章】共 ' + want + ' 章的细纲，输出纯 JSON 数组（长度必须精确为 ' + want + '）：[{"t":"章标题","h":"本章剧情钩子(80字内)"},...]。\n【硬性要求】\nA. 必须严格依据"用户原始设定"，把设定里出现的**全部人物/宠物/角色及其名字、世界观、关键事件**都排进大纲，一个都不能遗漏；每一章都要推进主线。\nB. 剧情要有完整起承转合，伏笔要回收。' +
    (prevBrief ? '\nC. 本批为全书后段，必须承接前文（前情提要）：\n' + prevBrief : '') +
    '\n章标题规则（必须严格遵守）：\n1. "t" 只写章节的情节标题本体，4-16个中文字符，概括本章核心事件/冲突/意象，具体有画面感；\n2. 严禁包含"第X章""第X集"等序号前缀，严禁包含冒号，严禁使用引号书名号；\n3. 每章标题必须独一无二，严禁重复或雷同，严禁空洞泛化。\n示例：t="纸条"、t="洞口"、t="海獭四兄妹入住并立家规"。只输出 JSON。';
  const usr =
    '书名《' + title + '》\n【用户原始设定（必须完整覆盖，不得遗漏任何角色与设定）】\n' + prompt +
    '\n\n【题材定位与简介】\n' + description +
    '\n\n【本次需要输出的章节范围】第' + start + '章 ~ 第' + end + '章（共 ' + want + ' 章）';

  for (let attempt = 1; attempt <= OUTLINE_REQ_ATTEMPTS; attempt++) {
    try {
      const out = await llmJson([{ role: 'system', content: sys }, { role: 'user', content: usr }], 0.5, OUTLINE_MAX_TOKENS);
      const got = extractHookItems(out);
      if (got.length > 0) {
        const filled = got.slice(0, want);
        while (filled.length < want) filled.push({ t: '', h: '' });
        return filled;
      }
      console.warn('[Agent-Gen] 大纲 ' + start + '-' + end + ' 解析为空，重试 ' + attempt + '/' + OUTLINE_REQ_ATTEMPTS);
    } catch (e) {
      console.warn('[Agent-Gen] 大纲 ' + start + '-' + end + ' 请求失败(第' + attempt + '次)：' + (e instanceof Error ? e.message : String(e)));
    }
    await sleepMs(1000 * attempt);
  }

  // 拆半兜底：模型一次吃不下这么多章，就切成两个更小的区间分别要
  if (want > 1) {
    const mid = start + Math.floor(want / 2) - 1;
    console.warn('[Agent-Gen] 大纲 ' + start + '-' + end + ' 失败 → 拆分为 ' + start + '-' + mid + ' 与 ' + (mid + 1) + '-' + end);
    const left = await fetchOutlineRange({ title, description, prompt, start, end: mid, ctxBefore });
    const right = await fetchOutlineRange({ title, description, prompt, start: mid + 1, end, ctxBefore: ctxBefore.concat(left) });
    return left.concat(right);
  }
  console.warn('[Agent-Gen] 大纲 第' + start + '章 单章仍失败，标题回退「第' + start + '章」');
  return [{ t: '', h: '' }];
}

/** 分批生成大纲（每批 OUTLINE_BATCH 章）；单批失败会拆半递归，尽量避免标题缺失 */
async function generateOutline(opts: {
  title: string;
  description: string;
  prompt: string;
  total: number;
  push: (event: AgentStreamEvent) => void;
}): Promise<{ rawTitle: string; title: string; hook: string }[]> {
  const { title, description, prompt, total } = opts;
  const raw: { t: string; h: string }[] = [];
  for (let start = 1; start <= total; start += OUTLINE_BATCH) {
    const end = Math.min(total, start + OUTLINE_BATCH - 1);
    const got = await fetchOutlineRange({ title, description, prompt, start, end, ctxBefore: raw });
    for (const g of got) raw.push(g);
  }
  const hookList: { rawTitle: string; title: string; hook: string }[] = [];
  const missing: number[] = [];
  for (let i = 1; i <= total; i++) {
    const h = raw[i - 1] ?? { t: '', h: '' };
    const hook = String(h.h ?? '');
    const rawTitle = sanitizeChapterTitleText(h.t, 20) || sanitizeChapterTitleText(hook.slice(0, 14), 20);
    if (!rawTitle) missing.push(i);
    hookList.push({ rawTitle, title: formatChapterTitle(i, rawTitle), hook });
  }
  if (missing.length) console.warn('[Agent-Gen] 标题缺失 ' + missing.length + ' 章：' + missing.join(','));
  return hookList;
}

/** 从已保存的大纲（novels.structure.agentOutline）还原 hookList */
function buildHookListFromStructure(structure: unknown, total: number): { rawTitle: string; title: string; hook: string }[] {
  const outline = structure && typeof structure === 'object' ? (structure as Record<string, unknown>).agentOutline : null;
  if (!Array.isArray(outline) || outline.length === 0) return [];
  const list: { rawTitle: string; title: string; hook: string }[] = [];
  for (let i = 1; i <= total; i++) {
    const h = (outline[i - 1] ?? {}) as Record<string, unknown>;
    const hook = String(h.h ?? '');
    const rawTitle = sanitizeChapterTitleText(String(h.t ?? ''), 20) || sanitizeChapterTitleText(hook.slice(0, 14), 20);
    list.push({ rawTitle, title: formatChapterTitle(i, rawTitle), hook });
  }
  return list;
}

/** 逐章写正文：单章失败自动重试；已存在的章节（续传）自动复用 */
async function writeChapterLoop(ctx: {
  userId: string;
  sessionId: string;
  push: (event: AgentStreamEvent) => void;
  prompt: string;
  novelId: string;
  title: string;
  category: string;
  genderTarget: string;
  hookList: { rawTitle: string; title: string; hook: string }[];
  chapters: { index: number; title: string; content: string }[];
  total: number;
  persistChapters: { index: number; title: string; content: string }[];
}): Promise<void> {
  const { userId, sessionId, push, prompt, novelId, title, category, genderTarget, hookList, chapters, persistChapters, total } = ctx;
  let lastPersist = 0;
  const persist = (force = false) => {
    const ts = Date.now();
    if (!force && ts - lastPersist < 700) return;
    lastPersist = ts;
    upsertGeneration({ sessionId, userId, novelId, title, total, current: persistChapters.length, status: 'running', chapters: persistChapters });
  };
  let prevTail = chapters.length ? String(chapters[chapters.length - 1].content || '').slice(-260) : '';

  for (let i = chapters.length; i < hookList.length; i++) {
    const chNo = i + 1;
    const cur = hookList[i];
    const nextHook = hookList[i + 1]?.hook ?? '';
    const parts: string[] = [
      '书名《' + title + '》 · 题材：' + category + ' · 目标读者：' + (genderTarget === 'male' ? '男频' : '女频'),
      '【全书核心设定（必须严格遵守，人物/宠物名字与关系不得改动）】' + prompt,
      '【第' + chNo + '章标题】' + (cur.rawTitle || cur.title),
      '【本章剧情】' + (cur.hook || '推进主线'),
    ];
    if (nextHook) parts.push('【下一章预告（本章结尾1-3句话埋钩子，不要展开下一章剧情）】' + nextHook);
    if (prevTail) parts.push('【上一章结尾（本章开头需自然衔接，不得复述）】' + prevTail);
    parts.push('【本章篇幅·硬性】1000-1800 字（1800 字为绝对上限）。写法：用 5-8 个自然段讲完本章核心情节（有场景、对话、心理、转折），结尾留钩子，写到情节自然收束即停，不要续写下一章内容、不要写标题与序号、不要任何开场白。写完自检字数，超 1800 字必须删减到范围内。');
    const userMsg = parts.join('\n\n');

    push({ type: 'generation_chapter_start', current: chNo, total, title: cur.title });
    persistChapters.push({ index: chNo, title: cur.title, content: '' });
    persist(true);

    let clean = '';
    let netErr: unknown = null;
    for (let attempt = 1; attempt <= CHAPTER_MAX_ATTEMPTS && !clean.trim(); attempt++) {
      if (attempt > 1) {
        console.warn('[Agent-Gen] 第' + chNo + '章重试 ' + attempt + '/' + CHAPTER_MAX_ATTEMPTS);
        push({ type: 'generation_chapter_reset', current: chNo, total, title: cur.title });
        persistChapters[persistChapters.length - 1].content = '';
        await sleepMs(1200 * attempt);
      }
      let content = '';
      let pending = '';
      let lastFlush = Date.now();
      try {
        for await (const delta of streamLLM([
          { role: 'system', content: GEN_WRITER_SYSTEM },
          { role: 'user', content: userMsg },
        ], 0.8, 8192, 'book-write')) {
          content += delta;
          pending += delta;
          persistChapters[persistChapters.length - 1].content = content;
          const nowTs = Date.now();
          if (pending.length >= 80 || nowTs - lastFlush >= 250) {
            push({ type: 'generation_chapter_delta', current: chNo, content: pending });
            pending = '';
            lastFlush = nowTs;
            persist();
          }
        }
        if (pending) push({ type: 'generation_chapter_delta', current: chNo, content: pending });
        clean = sanitizeChapterText(content);
      } catch (e) {
        netErr = e;
        console.warn('[Agent-Gen] 第' + chNo + '章生成失败(第' + attempt + '次)：' + (e instanceof Error ? e.message : String(e)));
      }
    }

    if (!clean.trim()) {
      if (netErr) {
        throw new Error('第' + chNo + '章生成失败：' + (netErr instanceof Error ? netErr.message : String(netErr)));
      }
      console.warn('[Agent-Gen] 第' + chNo + '章为空，跳过');
      continue;
    }
    // 篇幅补救：不足 1000 字时补写一次
    if (clean.length < 1000) {
      try {
        const tail = clean.slice(-400);
        const more = await callLLM([
          { role: 'system', content: GEN_WRITER_SYSTEM },
          { role: 'user', content: '【前文结尾】\n' + tail + '\n\n请紧接上文继续写本章剩余的关键情节（补足到 1000-1800 字）：不要重复前文、不要写标题、不要开场白，直接续写正文，结尾留钩子。' },
        ], 0.8, 4096, 'book-write');
        const extra = sanitizeChapterText(more);
        if (extra && extra.length > 100) {
          push({ type: 'generation_chapter_delta', current: chNo, content: '\n\n' + extra });
          clean = sanitizeChapterText(clean + '\n\n' + extra);
        }
      } catch (e) {
        console.warn('[Agent-Gen] 补写失败 ch' + chNo, e instanceof Error ? e.message : e);
      }
    }

    chapters.push({ index: chNo, title: cur.title, content: clean });
    persistChapters[persistChapters.length - 1] = { index: chNo, title: cur.title, content: clean };
    persist(true);
    prevTail = clean.slice(-260);

    await novelManager.update(novelId, userId, {
      chapters: chapters.map((x) => ({ index: x.index, title: x.title, content: x.content })),
      currentChapters: chapters.length,
    } as any).catch((e: unknown) => console.warn('[Agent-Gen] 写回失败 ch' + chNo, e));

    push({
      type: 'generation_progress',
      current: chNo,
      total,
      chapterTitle: cur.title,
      chars: clean.length,
      preview: clean.slice(0, 80),
    });
    push({ type: 'generation_chapter_end', current: chNo, chars: clean.length, content: clean });
    addNovelChange({ novelId, userId, action: 'create_chapter', chapterIndex: chNo, title: cur.title, detail: clean.length + '字' });
    void rememberChapter(novelId, userId, chNo, clean, push);
  }
}

/** 收尾：写会话消息 / 变更记录 / 完成状态 */
async function finalizeGeneration(ctx: {
  userId: string;
  sessionId: string;
  push: (event: AgentStreamEvent) => void;
  prompt: string;
  novelId: string;
  title: string;
  total: number;
  chapters: { index: number; title: string; content: string }[];
  persistChapters: { index: number; title: string; content: string }[];
}): Promise<void> {
  const { userId, sessionId, push, prompt, novelId, title, total, chapters, persistChapters } = ctx;
  if (chapters.length === 0) throw new Error('所有章节生成失败');
  if (title) touchAgentSession(sessionId, title);
  addNovelChange({ novelId, userId, action: 'create_novel', title, detail: total + '章计划' });
  const summary = '已为你生成小说《' + title + '》（' + chapters.length + '/' + total + '章）。可在「我的小说」或书城中查看。';
  createAgentMessage({
    sessionId, role: 'assistant',
    content: summary,
    toolName: 'generate',
    toolPayload: JSON.stringify({ novelId, title, total: chapters.length }),
  });
  upsertGeneration({ sessionId, userId, novelId, title, total, current: persistChapters.length, status: 'finished', chapters: persistChapters, error: null });
  push({ type: 'generation_finished', novelId, title, total: chapters.length });
  push({
    type: 'tool_result',
    toolName: 'generate',
    summary,
    content: 'novelId=' + novelId,
    applied: true,
    chapterIndex: null,
  });
  createAgentRunStatusProxy(novelId, 'finished', sessionId, userId, prompt);
}

/** 断点续传：沿用原作品与已保存大纲，从已完成章节之后继续写 */
async function resumeNovelRun(
  opts: GenerateNovelOptions,
  prev: NonNullable<ReturnType<typeof getGeneration>>,
  done: { index: number; title: string; content: string }[],
  requestedTotal: number
): Promise<void> {
  const { userId, sessionId, prompt, push } = opts;
  const novelId = prev.novelId as string;
  try {
    const novel = await novelManager.getById(novelId);
    if (!novel) throw new Error('原作品不存在，无法续写');
    const anyNovel = novel as any;
    const title = String(anyNovel.title || prev.title || '未命名之作');
    const category = String(anyNovel.category || '玄幻');
    const genderTarget = anyNovel.genderTarget === 'female' ? 'female' : 'male';
    const description = String(anyNovel.description || prompt);
    const total = Math.max(prev.total || 0, requestedTotal, done.length);

    let hookList = buildHookListFromStructure(anyNovel.structure, total);
    if (!hookList.length) {
      const rest = Math.max(total - done.length, 1);
      const extra = await generateOutline({ title, description, prompt, total: rest, push });
      hookList = done.map((c) => ({
        rawTitle: stripChapterTitlePrefix(c.title),
        title: formatChapterTitle(c.index, stripChapterTitlePrefix(c.title)),
        hook: '',
      }));
      for (let k = 0; k < rest; k++) {
        const e = extra[k] ?? { rawTitle: '', title: '', hook: '' };
        const idx = hookList.length + 1;
        hookList.push({ rawTitle: e.rawTitle, title: formatChapterTitle(idx, e.rawTitle), hook: e.hook });
      }
    }

    const chapters = done.map((c) => ({ index: c.index, title: c.title, content: c.content }));
    const persistChapters = chapters.map((c) => ({ ...c }));
    console.log('[Agent-Gen] 断点续传：' + novelId + ' 已完成 ' + chapters.length + '/' + total + '，从第 ' + (chapters.length + 1) + ' 章继续');
    push({ type: 'intent', action: 'generate', instruction: prompt });
    push({ type: 'generation_start', novelId, title, total });
    upsertGeneration({ sessionId, userId, novelId, title, total, current: persistChapters.length, status: 'running', chapters: persistChapters, error: null });
    for (const c of chapters) {
      push({ type: 'generation_chapter_start', current: c.index, total, title: c.title });
      push({ type: 'generation_chapter_end', current: c.index, chars: c.content.length, content: c.content });
    }

    await writeChapterLoop({
      userId, sessionId, push, prompt,
      novelId, title, category, genderTarget,
      hookList, chapters, total, persistChapters,
    });
    await finalizeGeneration({ userId, sessionId, push, prompt, novelId, title, total, chapters, persistChapters });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Agent-Gen] 续写失败:', msg);
    try { upsertGeneration({ sessionId, userId, status: 'error', error: msg }); } catch { /* ignore */ }
    push({ type: 'run_error', runId: '', message: '续写失败：' + msg });
  }
}

/** 记录一次成书 run 状态（生成执行本身由 runAgentLoop 的 run 承接，此处仅做备注表） */
let __genRunCounter = 0;
function createAgentRunStatusProxy(_novelId: string, _status: string, _sessionId: string, _userId: string, _prompt: string) {
  __genRunCounter += 1;
  // 复用 run 表记录：仅当上层 run 未创建时兜底（正常路径上层已创建）
}


// ========== 章节记忆固化（每章摘要 + 阶段性作品设定抽取） ==========
async function rememberChapter(novelId: string, userId: string, chapterNum: number, content: string, push?: (e: AgentStreamEvent) => void): Promise<void> {
  const memory = await loadAgentMemorySettings();
  if (!memory.enableAutoMemory) return;
  try {
    const sum = await callLLM([
      { role: 'system', content: '你是作品记忆整理师。输出纯 JSON（不输出其他文字）：{"summary":"本章剧情摘要(80字内,含主角状态与关键事件/伏笔)","characters":"本章出现的关键角色名,逗号分隔"}。' },
      { role: 'user', content: content.slice(-memory.autoMemoryChars) },
    ], 0.3, 500, 'memory-extract');
    let parsed: { summary?: string; characters?: string } = {};
    const m = sum.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { /* ignore */ } }
    await storyMemoryManager.upsertChapterSummary({
      novelId, userId, sourceChapter: chapterNum, title: '第' + chapterNum + '章摘要',
      content: parsed.summary ?? content.slice(0, 120),
      memoryType: 'chapterSummary', importance: 78, layer: 'L2',
    } as any);
    if (chapterNum % Math.max(1, memory.autoExtractEvery) === 0) {
      const worldSeed = await callLLM([
        { role: 'system', content: '你是作品设定整理师。根据最近内容输出纯 JSON：{"characters":[{"name":"角色名","desc":"30字设定"}],"world":"世界观/地名/势力等设定(80字)","foreshadowing":"已埋伏笔(40字)"},最多各3项。只输出 JSON。' },
        { role: 'user', content: content.slice(-5000) },
      ], 0.3, 900, 'memory-extract');
      const wm = worldSeed.match(/\{[\s\S]*\}/);
      if (wm) {
        try {
          const w = JSON.parse(wm[0]);
          const chars = Array.isArray(w.characters) ? w.characters.slice(0, 3) : [];
          for (const ch of chars) {
            await storyMemoryManager.create({ novelId, userId, memoryType: 'characterCard', layer: 'L1', title: ch.name ?? '角色', content: ch.desc ?? '', importance: 85, sourceChapter: chapterNum } as any).catch(() => {});
          }
          if (w.world) await storyMemoryManager.create({ novelId, userId, memoryType: 'worldbuilding', layer: 'L1', title: '世界观设定', content: w.world, importance: 90, sourceChapter: chapterNum } as any).catch(() => {});
          if (w.foreshadowing) await storyMemoryManager.create({ novelId, userId, memoryType: 'foreshadowing', layer: 'L2', title: '第' + chapterNum + '章伏笔', content: w.foreshadowing, importance: 80, sourceChapter: chapterNum } as any).catch(() => {});
        } catch { /* ignore */ }
      }
    }
    push?.({ type: 'change_applied', action: 'update_memory', title: '第' + chapterNum + '章记忆已更新' });
  } catch (e) {
    console.warn('[Agent-Memory] 记忆固化失败 ch' + chapterNum + ':', e instanceof Error ? e.message : e);
  }
}
