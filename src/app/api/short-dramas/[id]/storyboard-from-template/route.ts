import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { buildChatEndpoint, resolveTextConfigId } from '@/lib/text-config';
import { splitChapterContent } from '@/lib/chapter-text-splitter';
import { normalizeExtractChapters, renderExtractTemplate, analyzeExtractTemplate } from '@/lib/extract-template';
import { extractTemplateManager, shortDramaManager, dramaWorkflowManager, novelManager } from '@/storage/database';
import { parseStoryboardRecords, VIDEO_PROMPT_MAX } from '@/lib/storyboard-parser';

/** 组装角色/场景/物品的 @引用清单 */
function buildAssetList(rows: any[]): string {
  return rows
    .map((r: any) => `- 名称：${r.name}\n- 描述：@${r.name}${r.description ? `（${String(r.description).slice(0, 60)}）` : ''}`)
    .join('\n\n');
}

/** 把已有分镜转成「前/后分镜」上下文片段 */
function buildShotContext(shots: any[], n: number, side: '前' | '后'): string {
  if (!shots || shots.length === 0) return '(无)';
  const list = side === '前' ? shots.slice(-n) : shots.slice(0, n);
  return list
    .map((s: any, i: number) => {
      const d = s.dialogue || '';
      return `【${side}面分镜 ${i + 1}】${s.sceneDescription || ''}${d ? ` 对白：${d}` : ''}`;
    })
    .join('\n');
}

/** 本地文字模型调用：不强制 JSON 输出（模版要求自定义分隔符），带重试 */
async function callTextModel(runtime: { apiUrl: string; apiKey: string; model: string }, systemPrompt: string, userContent: string, maxRetries = 2, timeoutMs = 180000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const apiUrl = runtime.apiUrl || process.env.AI_API_URL || process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
      const apiKey = runtime.apiKey || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
      const model = runtime.model || process.env.AI_MODEL || 'deepseek-v4-flash';
      if (!apiKey) return { error: '缺少AI API密钥，请配置文本模型' };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(buildChatEndpoint(apiUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
            temperature: 0.5,
            max_tokens: 8192,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        const data = await res.json();
        if (data.error) {
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 2000 * attempt));
            continue;
          }
          return { error: data.error?.message || 'AI调用失败' };
        }
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 2000 * attempt));
            continue;
          }
          return { error: 'AI未返回内容' };
        }
        return { data: content };
      } catch (fetchErr: any) {
        clearTimeout(timer);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 3000 * attempt));
          continue;
        }
        return { error: fetchErr.name === 'AbortError' ? 'AI请求超时' : fetchErr.message };
      }
    } catch (e: any) {
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      return { error: e.message };
    }
  }
  return { error: 'AI调用失败' };
}

/**
 * POST /api/short-dramas/[id]/storyboard-from-template
 * body: { episodeId, configId?, apply? }
 *  - 不传 apply / apply=false：生成预览（不写库）
 *  - apply=true 且带 generated：把预览结果应用到该集（先写新行，成功后删旧行）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization') || '');
    if (!payload) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const { id: dramaId } = await params;
    const drama = await shortDramaManager.getById(dramaId);
    if (!drama) return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    if (drama.userId !== payload.userId && payload.role !== 'admin') {
      return NextResponse.json({ error: '无权限操作该作品' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({} as any));
    const episodeId = String(body?.episodeId || '');
    if (!episodeId) return NextResponse.json({ error: '缺少 episodeId' }, { status: 400 });

    const episode = await shortDramaManager.getEpisodeById(episodeId);
    if (!episode || episode.dramaId !== dramaId) {
      return NextResponse.json({ error: '分集不存在' }, { status: 404 });
    }

    // ---------- 应用：直接写库 ----------
    if (body?.apply === true) {
      const generated = Array.isArray(body?.generated) ? body.generated : [];
      if (generated.length === 0) return NextResponse.json({ error: '没有可应用的分镜数据' }, { status: 400 });
      const normalized = generated
        .map((g: any, i: number) => ({
          shotNumber: Number(g?.panelIndex) || i + 1,
          sceneDescription: String(g?.chapterText || g?.imagePrompt || '').slice(0, 60),
          imagePrompt: String(g?.imagePrompt || ''),
          videoPrompt: String(g?.videoPrompt || '').slice(0, VIDEO_PROMPT_MAX + 200),
          dialogue: String(g?.dialogue || ''),
          duration: 15,
          status: 'draft' as const,
        }))
        .filter((g: any) => g.imagePrompt || g.videoPrompt);

      // 先写新行（生成新 id），成功后删除旧行 —— 避免中途失败造成数据丢失
      const created = await dramaWorkflowManager.bulkCreateShots(
        normalized.map((g: any) => ({
          dramaId,
          episodeId,
          userId: drama.userId,
          ...g,
        })),
      );
      await dramaWorkflowManager.deleteShotsByEpisodeId(episodeId, new Set(created.map((c: any) => c.id)));
      return NextResponse.json({
        success: true,
        message: `已应用到本集：写入 ${created.length} 个分镜`,
        data: { count: created.length },
      });
    }

    // ---------- 预览：渲染模版 → 调 AI → 解析（不写库） ----------
    if (!drama.novelId) return NextResponse.json({ error: '该短剧未关联小说' }, { status: 400 });
    const novel = await novelManager.getById(drama.novelId);
    if (!novel) return NextResponse.json({ error: '关联小说不存在' }, { status: 404 });

    // 1. 取章节正文（优先 episode.source_chapter；回退到 source_script_chapter_index+1 / episode_number）
    const chapters = normalizeExtractChapters(novel.chapters);
    const wantChapter =
      Number(episode.sourceChapter) ||
      (episode.sourceScriptChapterIndex != null ? Number(episode.sourceScriptChapterIndex) + 1 : 0) ||
      Number(episode.episodeNumber);
    const chapter = chapters.find((c) => c.index === wantChapter) || chapters[0];
    if (!chapter) return NextResponse.json({ error: '小说还没有章节正文' }, { status: 400 });

    // 2. 拆段
    const segments = splitChapterContent(chapter.content);
    if (segments.length === 0) return NextResponse.json({ error: '本章节拆不出可用文案' }, { status: 400 });

    // 3. 解析生效模版（三层优先级）
    const resolved = await extractTemplateManager.resolve('storyboard' as any, { userId: drama.userId, dramaId });
    if (!resolved || !String(resolved.template || '').trim()) {
      return NextResponse.json({ error: '未找到分镜生成模版，请先在「分镜生成模版」里配置' }, { status: 400 });
    }
    const analysis = analyzeExtractTemplate(String(resolved.template), 'storyboard' as any);
    if (analysis.missingRequired.length > 0) {
      return NextResponse.json(
        { error: `分镜模版缺少必备变量：${analysis.missingRequired.map((v) => '{{' + v + '}}').join('、')}` },
        { status: 400 },
      );
    }

    // 4. 组装上下文并渲染
    const [charRows, sceneRows, itemRows, existingShots] = await Promise.all([
      dramaWorkflowManager.getCharactersByDramaId(dramaId),
      dramaWorkflowManager.getScenesByDramaId(dramaId),
      dramaWorkflowManager.getItemsByDramaId(dramaId),
      dramaWorkflowManager.getShotsByEpisodeId(episodeId),
    ]);

    const context: Record<string, string> = {
      故事情节: typeof novel.idea === 'string' ? novel.idea.slice(0, 2000) : JSON.stringify(novel.idea || '').slice(0, 2000),
      角色信息: buildAssetList(charRows) || '（无角色）',
      场景信息: buildAssetList(sceneRows) || '（无场景）',
      物品信息: buildAssetList(itemRows) || '（无物品）',
      小说原文: chapter.content,
      章节文案: segments.map((s) => `${s.index}. ${s.text}`).join('\n'),
      前面分镜: buildShotContext(existingShots, 2, '前'),
      后面分镜: buildShotContext(existingShots, 2, '后'),
      推文文案: '',
    };
    const rendered = renderExtractTemplate(String(resolved.template), context);
    const systemPrompt = [
      rendered,
      '',
      '【执行要求】请严格按照上述模版的输出格式生成，只输出分镜记录本身，不要 Markdown 代码块、不要任何解释文字、不要额外总结。',
    ].join('\n');
    const userContent = `请按模版为以上「章节文案」的每一项生成对应分镜。章节文案共 ${segments.length} 项，请严格输出 ${segments.length} 条记录，逐条对应。`;

    const resolvedConfigId = await resolveTextConfigId(drama.userId, body?.configId || null);
    const { getTextModelRuntime } = await import('@/lib/text-config');
    const runtime = await getTextModelRuntime(resolvedConfigId);
    if (!runtime) {
      return NextResponse.json({ error: '未找到可用的文字模型配置，请先在「AI 模型配置」里配置文字模型' }, { status: 400 });
    }

    const result = await callTextModel(runtime, systemPrompt, userContent, 2);
    if (result.error) {
      return NextResponse.json({ error: `分镜生成失败：${result.error}` }, { status: 500 });
    }

    // 5. 解析输出（出错时返回 raw 供前端展示）
    let preview = [];
    let warnings: string[] = [];
    let raw = String(result.data || '');
    try {
      const parsed = parseStoryboardRecords(raw);
      preview = parsed.preview;
      warnings = parsed.warnings;
    } catch (e: any) {
      return NextResponse.json({
        success: false,
        error: `AI 输出解析失败：${e.message}`,
        raw,
        generated: false,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        episodeId,
        chapter: { index: chapter.index, title: chapter.title },
        segmentCount: segments.length,
        preview,
        warnings,
        raw,
        template: { id: resolved.id, name: resolved.name, source: resolved.source },
        configId: resolvedConfigId,
        generated: false,
      },
    });
  } catch (e: any) {
    console.error('[storyboard-from-template] failed:', e);
    return NextResponse.json({ error: `分镜生成失败：${e.message || String(e)}` }, { status: 500 });
  }
}