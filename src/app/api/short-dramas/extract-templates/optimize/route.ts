import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import {
  analyzeExtractTemplate,
  EXTRACT_KIND_META,
  EXTRACT_TEMPLATE_VARIABLES,
  normalizeExtractKind,
} from '@/lib/extract-template';
import { buildChatEndpoint, getTextModelRuntime, resolveTextConfigId } from '@/lib/text-config';

const MAX_TEMPLATE_LENGTH = 30000;

/**
 * 让模型只输出干净的模版正文：
 * 去掉思维链、代码围栏，以及模型可能回显的模版包裹分隔符。
 */
function stripModelNoise(raw: string): string {
  let text = String(raw || '').replace(/<think[\s\S]*?<\/think>/gi, '').trim();
  const fence = text.match(/```(?:json|markdown|md|text)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  text = text.replace(/^```+|```+$/g, '').trim();
  const wrappers: RegExp[] = [
    /^\s*<<<\s*\n?/,
    /\n?\s*>>>\s*$/,
    /^\s*【当前模版开始】\s*\n?/,
    /\n?\s*【当前模版结束】\s*$/,
  ];
  for (const re of wrappers) text = text.replace(re, '');
  return text.trim();
}

function buildMessages(kindLabel: string, requiredVars: string[], template: string, instruction: string, strict: boolean) {
  const required = requiredVars.map((v) => '{{' + v + '}}').join('、') || '（无）';
  const varList = EXTRACT_TEMPLATE_VARIABLES.map((v) => `- {{${v.key}}}：${v.description}`).join('\n');

  const system =
    '你是资深 AI 提示词工程师，专精「从小说正文中结构化提取资料」这类抽取型提示词。\n' +
    '你的任务：在不改变变量占位符语义的前提下，优化用户给出的提取模版，让文字模型更容易稳定产出合规 JSON。\n\n' +
    '硬性规则：\n' +
    `1. 必须原样保留这些必备变量，一个都不能删：${required}\n` +
    '2. 只能使用「可用变量」清单里列出的变量，不得发明新变量；清单外的变量一律删除。\n' +
    '3. 变量必须保持 {{变量名}} 形式，不要改写、不要加空格或标点。\n' +
    '4. 不得改变要提取的实体类型，也不得改变输出 JSON 的顶层字段名。\n' +
    '5. 输出必须是完整可用的模版全文，不是修改建议、不是差异说明。\n\n' +
    '优化方向（按需取舍，不要为了改而改）：\n' +
    '- 结构分层清晰：角色定位 → 任务 → 输入说明 → 提取要求 → 输出格式\n' +
    '- 提取要求写成可判定的条目，避免「尽量」「适当」这类模糊表述\n' +
    '- 强化「不得杜撰」「没有依据就留空」等防幻觉约束\n' +
    '- JSON 示例的字段与要求严格一致\n' +
    '- 去除重复、矛盾或无关的表述\n\n' +
    (strict
      ? '注意：上一次输出不合规。请务必只输出模版正文本身，不要任何解释文字、不要代码围栏。\n\n'
      : '') +
    '只输出优化后的模版正文，不要任何解释，不要 markdown 代码围栏，也不要输出任何包裹标记或分隔符（例如 <<<、>>>、【当前模版开始】）。';

  const user =
    `模版类型：${kindLabel}提取\n` +
    `必备变量（必须保留）：${required}\n\n` +
    `可用变量清单：\n${varList}\n\n` +
    `当前模版（以下内容仅作参考，不要把它连同分隔标记一起输出）：\n【当前模版开始】\n${template}\n【当前模版结束】\n\n` +
    `我的优化要求：${instruction || '（无特别要求，请按通用最佳实践优化）'}`;

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

async function callOptimize(apiUrl: string, apiKey: string, model: string, messages: any[]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(buildChatEndpoint(apiUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model, temperature: 0.3, max_tokens: 6000, messages }),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`AI 优化失败 HTTP ${res.status}: ${errorText.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.delta?.content || '';
    return stripModelNoise(String(content));
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * POST /api/short-dramas/extract-templates/optimize
 * body: { kind, template, instruction?, configId? }
 * 用文字模型把当前模版改写得更好用，只返回候选结果，不写库。
 */
export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const body = await request.json().catch(() => ({} as any));
    const kind = normalizeExtractKind(body?.kind);
    if (!kind) return NextResponse.json({ error: 'kind 必须为 character、scene 或 item' }, { status: 400 });

    const template = String(body?.template ?? '');
    if (!template.trim()) return NextResponse.json({ error: '模版内容不能为空' }, { status: 400 });
    if (template.length > MAX_TEMPLATE_LENGTH) {
      return NextResponse.json({ error: `模版过长（上限 ${MAX_TEMPLATE_LENGTH} 字）` }, { status: 400 });
    }

    const meta = EXTRACT_KIND_META[kind];
    const instruction = String(body?.instruction ?? '').trim().slice(0, 600);

    const configId = await resolveTextConfigId(payload.userId, body?.configId);
    const runtime = await getTextModelRuntime(configId);
    if (!runtime) {
      return NextResponse.json(
        { error: '没有可用的文字模型配置（缺少 API Key），请先在「AI 设置」里配置文字模型。' },
        { status: 400 },
      );
    }

    let improved = '';
    let analysis = analyzeExtractTemplate('', kind);
    for (let attempt = 0; attempt < 2; attempt++) {
      improved = await callOptimize(
        runtime.apiUrl,
        runtime.apiKey,
        runtime.model,
        buildMessages(meta.label, meta.requiredVars, template, instruction, attempt > 0),
      );
      analysis = analyzeExtractTemplate(improved, kind);
      if (improved.trim() && analysis.missingRequired.length === 0 && analysis.unknown.length === 0) break;
      // 只对「缺必备变量 / 含未知变量」重试一次
      if (attempt === 0) continue;
      break;
    }

    if (!improved.trim()) {
      return NextResponse.json({ error: 'AI 没有返回可用的模版内容，请稍后重试或更换文字模型。' }, { status: 502 });
    }
    if (analysis.missingRequired.length > 0) {
      return NextResponse.json(
        {
          error: `AI 结果缺少必备变量：${analysis.missingRequired.map((v) => '{{' + v + '}}').join('、')}，已放弃本次优化。`,
          analysis,
        },
        { status: 502 },
      );
    }
    if (analysis.unknown.length > 0) {
      return NextResponse.json(
        {
          error: `AI 结果包含不支持的变量：${analysis.unknown.map((v) => '{{' + v + '}}').join('、')}，已放弃本次优化。`,
          analysis,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message: 'AI 优化完成',
      data: {
        kind,
        template: improved,
        analysis,
        model: runtime.model,
        before: { length: template.length },
        after: { length: improved.length },
      },
    });
  } catch (e: any) {
    console.error('[extract-templates/optimize] 失败:', e);
    return NextResponse.json({ error: e?.message || 'AI 优化模版失败' }, { status: 500 });
  }
}
