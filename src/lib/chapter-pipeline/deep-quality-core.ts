/**
 * deep-quality-core.ts — STATION 4B：AI 深度质检 & 自动修复（纯函数内核）
 *
 * 背景：`/api/novel/chapters/quality-check` 路由里已经实现了完整的"6 维度评审 + 自动修复 + 2 次重试"，
 * 但它写在 NextRoute 的 POST handler 里，stream/route.ts 要调用它有两种方式：
 *   (1) HTTP 回环 fetch → 每次 4B 都要再启动一次请求解析、日志是两份，部署还可能遇到回环 URL 问题；
 *   (2) 把核心逻辑提取成纯函数 → 直接 import 调（本方案）。
 *
 * 本文件即原来的 quality-check/route.ts POST 里的业务本体：
 *   - 导出 DeepQualityInput / DeepQualityResult 类型
 *   - 导出 async runDeepQualityCheck(input)
 * 原路由 route.ts 改为：从本文件 import runDeepQualityCheck() 并把请求体 JSON → Input，最后 NextResponse.json(result)。
 * 新 stream route 改为：import 后直接传章节数据调用，不走 HTTP。
 */

import { getRawAIConfig, getModelName, getTemperature } from '@/lib/ai-config';
import { sanitizeChapterText } from '@/lib/chapter-text-cleaner';
import { getPromptWithFallback } from '@/lib/prompt-helper';
import { appendAgentSkillPrompt } from '@/lib/agent-skills';

const TIMEOUT_MS = 120000;
const MAX_RETRIES = 2;

export type DeepQualityInput = {
  /** 可选：AI 配置 id（多租户或多套模型） */
  configId?: string;
  /** 小说元信息（用于系统 prompt 上下文 + Agent Skill） */
  idea?: {
    theme?: string;
    concept?: string;
    mainPlot?: string;
    characters?: string;
    supportingCharacters?: string;
    characterRelationships?: string;
    setting?: string;
  };
  structure?: {
    mainPlot?: string;
    keyConflicts?: string;
    keyScenes?: string;
    keyItems?: string;
  };
  tone?: string;
  genderTarget?: string;
  narrativePerspective?: string;
  /** 当前章（必填） */
  chapter: { index: number; title?: string; content: string };
  /** 上章 / 下章（可选，用于对比跨章重复） */
  previousChapter?: { index?: number; title?: string; content?: string };
  nextChapter?: { index?: number; title?: string; content?: string };
  /** 可选：上一章账本 4A FAILURE_REPORT / 本地质检分，帮助 AI 审更聚焦 */
  localFinalScore?: number;
  localIssuesSummary?: string;
};

export type DeepQualityResult = {
  status: 'pass' | 'fixed';
  /** 0-100，STATION 6 门禁：≥90 才算通过 4B */
  score: number;
  issues: string[];
  summary: string;
  /** status=pass 时等于原文；status=fixed 时是修复后的完整正文 */
  revisedContent: string;
  /** 服务端内部字段：是否是所有重试失败后的"透传"低分（会被 STATION 6 降级 WARN，不直接 break） */
  degraded?: boolean;
  /** 调用消耗的重试次数（debug 用） */
  attempts?: number;
};

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number },
): Promise<Response> {
  const { timeout = TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function trimTail(value: string, limit: number): string {
  const text = sanitizeChapterText(String(value || '')).trim();
  if (!text) return '';
  return text.length > limit ? '...' + text.slice(-limit) : text;
}
function trimHead(value: string, limit: number): string {
  const text = sanitizeChapterText(String(value || '')).trim();
  if (!text) return '';
  return text.length > limit ? text.slice(0, limit) + '...' : text;
}

function cleanRevisedContent(value: unknown, chapterIndex: number): string {
  let text = sanitizeChapterText(String(value || ''));
  text = text.replace(/^```(?:json|markdown|text)?\s*/i, '');
  text = text.replace(/```\s*$/i, '');
  text = text.replace(/^\s*第\s*\d+\s*章[^\n\r]*[\n\r]+/, '');
  text = text.replace(
    new RegExp(`^\\s*第\\s*${chapterIndex}\\s*章[^\\n\\r]*[\\n\\r]+`),
    '',
  );
  text = text.replace(/^\s*正文[：:]\s*/i, '');
  text = text.replace(/^\s*修复后正文[：:]\s*/i, '');
  text = text.replace(/^\s*修改后[：:]\s*/i, '');
  return text.trim();
}

function cleanJsonString(str: string): string {
  let result = '';
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escapeNext) {
      result += ch;
      escapeNext = false;
      continue;
    }
    if (ch === '\\') {
      result += ch;
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString) {
      if (ch === '\n' || ch === '\r') {
        result += '\\n';
        continue;
      }
      if (ch === '\t') {
        result += ' ';
        continue;
      }
    }
    result += ch;
  }
  return result.replace(/,(\s*[}\]])/g, '$1').trim();
}

function parseQualityResponse(
  content: string,
  originalContent: string,
  chapterIndex: number,
): DeepQualityResult {
  const fallback: DeepQualityResult = {
    status: 'pass',
    score: 75,
    issues: [],
    summary: '章节通过',
    revisedContent: originalContent,
  };
  try {
    let jsonText = String(content || '');
    jsonText = jsonText.replace(/<think[\s\S]*?<\/think\s*>/g, '');
    jsonText = jsonText.replace(/<thought[\s\S]*?<\/thought\s*>/g, '');
    const codeBlock = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock) jsonText = codeBlock[1].trim();

    let parsed: any = null;
    const attempts = [
      () => JSON.parse(jsonText),
      () => {
        const match = jsonText.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(cleanJsonString(match[0])) : null;
      },
      () => {
        const cleaned = jsonText.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/,\s*([}\]])/g, '$1');
        const match = cleaned.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : null;
      },
    ];
    for (const attempt of attempts) {
      try {
        parsed = attempt();
        if (parsed && typeof parsed === 'object') break;
      } catch {
        // ignore
      }
    }
    if (!parsed || typeof parsed !== 'object') return fallback;

    const status: 'pass' | 'fixed' = String(parsed.status || '').toLowerCase() === 'fixed' ? 'fixed' : 'pass';
    const revised = cleanRevisedContent(parsed.revisedContent, chapterIndex);
    if (status === 'fixed' && revised.length < 300) {
      return {
        status: 'pass',
        score: 70,
        issues: Array.isArray(parsed.issues) ? parsed.issues.map(String).filter(Boolean).slice(0, 5) : [],
        summary: '修复内容不完整，保持原文',
        revisedContent: originalContent,
      };
    }
    const score = Number.isFinite(Number(parsed.score))
      ? Math.max(0, Math.min(100, Number(parsed.score)))
      : status === 'fixed' ? 80 : 90;
    return {
      status,
      score,
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.map((x: unknown) => String(x)).filter(Boolean).slice(0, 8)
        : [],
      summary: String(
        parsed.summary || (status === 'fixed' ? '已修复章节连贯性问题' : '章节连贯性良好'),
      ),
      revisedContent: status === 'fixed' ? revised : originalContent,
    };
  } catch (e) {
    console.warn('[DeepQualityCore] parse error:', e);
    return fallback;
  }
}

/** STATION 4B 主入口：调用 LLM 做 6 维度深度质检，必要时返回修复版正文 */
export async function runDeepQualityCheck(input: DeepQualityInput): Promise<DeepQualityResult> {
  const {
    configId,
    idea,
    structure,
    chapter,
    previousChapter,
    nextChapter,
    localFinalScore,
    localIssuesSummary,
  } = input;

  if (!chapter?.content || !chapter?.index) {
    // 兼容：返回透传 pass（让上层决定报错）
    return {
      status: 'pass',
      score: 0,
      issues: ['入参缺失：chapter.index 或 chapter.content'],
      summary: '入参错误',
      revisedContent: chapter?.content || '',
    };
  }

  const { apiUrl, apiKey } = await getRawAIConfig(configId);
  const modelName = await getModelName(configId);
  const temperature = await getTemperature(configId, 0.3);
  const originalContent = sanitizeChapterText(String(chapter.content || ''));
  const chapterIdx = Number(chapter.index);

  // 系统 prompt（Agent Skill 接入）
  const agentContext = {
    text: [idea?.theme || '', structure?.mainPlot || '', chapter?.title || ''].filter(Boolean).join('\n'),
  };
  const baseSystemPrompt = await getPromptWithFallback(
    'chapter-quality-check-system',
    `你是一位严苛的小说编辑，专门检查小说章节的连贯性和一致性。你必须严格检查以下6个维度，任何一个维度有问题都必须报告：

## 检查维度（必须逐一检查）
1. **跨章内容重复检测（最高优先级）**：上一章结尾 vs 本章开头，超过2句内容重复或换说法复述，必须报告；禁止"话说 / 且说 / 上次说到"开头复述。
2. **人物状态一致性**：伤情 / 位置 / 道具 / 情绪变化必须一致且有原因。
3. **战斗完整性**：不能戛然而止，要有收尾与结果。
4. **开头承接**：1-2句状态过渡，禁止复述剧情。
5. **结尾引导**：自然衔接到下一章，不要空泛总结。
6. **剧情断裂**：因果不能跳。
7. **AI 套话 & 视角越界**：微一X / 心中一动 / 眼中闪过 / 他心想（第一人称视角越界）等。

## 输出JSON
{"status":"pass或fixed","score":0-100,"issues":["具体问题"],"summary":"总结","revisedContent":"修复后正文"}

pass 时 revisedContent 为空字符串；fixed 时 revisedContent 必须是完整修复后正文。禁止输出 JSON 以外的任何文字。`,
    agentContext,
  );
  const systemPrompt = await appendAgentSkillPrompt(
    baseSystemPrompt,
    ['ai_dehumanizer', 'novel_chapter_writer-continuity'],
    { target: 'quality-check' },
  );

  const prevTail = trimTail(previousChapter?.content || '', 600);
  const nextHead = trimHead(nextChapter?.content || '', 600);
  const userPrompt = `第${chapterIdx}章《${chapter.title || ''}》

【上下文信息 - 必读】
${prevTail ? `上一章结尾（⚠️ 以下内容已经完整发生过，修复时绝对禁止复述或重写！）：\n${prevTail}` : '这是第一章'}

【本章正文 - 待检查和修复】
${originalContent}

${nextHead ? `下一章开头（供参考，确保衔接）：\n${nextHead}` : '这是最后一章'}

${typeof localFinalScore === 'number' ? `【本地 4A 质检参考分】：${localFinalScore}/100（仅供你聚焦，不作为你的评分依据）` : ''}
${localIssuesSummary ? `【本地 4A 命中重点（你需要复核是否真的修掉了）】\n${localIssuesSummary}` : ''}

【修复要求】
1. 重复 → 只承接状态、立即推进新剧情
2. 状态矛盾 → 补交代或删除
3. 战斗不完整 → 补收尾
4. 位置矛盾 → 统一
5. 若只是微小问题（<3条）也可以直接 pass，不用硬修

请直接输出 JSON。`;

  const apiUrlFull = apiUrl?.endsWith?.('/chat/completions') ? apiUrl : `${apiUrl || ''}/chat/completions`;
  console.log(
    `[DeepQualityCore] Start: chapter ${chapterIdx}, originalContent=${originalContent.length} model=${modelName}`,
  );

  let aiContent = '';
  let attempts = 0;
  let degraded = false;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    attempts = attempt;
    try {
      const resp = await fetchWithTimeout(apiUrlFull, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey || ''}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userPrompt },
          ],
          temperature: Math.min(temperature, 0.3),
          max_tokens: 8192,
          stream: false,
        }),
        timeout: TIMEOUT_MS,
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.error(
          `[DeepQualityCore] Attempt ${attempt} HTTP ${resp.status}: ${errText.substring(0, 200)}`,
        );
        continue;
      }
      const data = (await resp.json()) as any;
      aiContent = data?.choices?.[0]?.message?.content || '';
      if (aiContent && aiContent.trim().length > 10) break;
      console.warn(`[DeepQualityCore] Attempt ${attempt} empty content, retry`);
    } catch (e: any) {
      console.error(`[DeepQualityCore] Attempt ${attempt} failed: ${e?.message || e}`);
      if (attempt <= MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  if (!aiContent || aiContent.trim().length < 10) {
    console.warn('[DeepQualityCore] All attempts failed, fallback degraded pass-through');
    degraded = true;
    return {
      status: 'pass',
      score: 75,
      issues: ['AI 质检服务繁忙，已保留原文（degraded 透传）'],
      summary: '保持不变',
      revisedContent: originalContent,
      degraded: true,
      attempts,
    };
  }

  const result = parseQualityResponse(aiContent, originalContent, chapterIdx);
  return { ...result, attempts, degraded };
}
