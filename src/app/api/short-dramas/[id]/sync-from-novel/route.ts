import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import { extractAssetsFromNovelContentWithAI } from '@/lib/novel-ai-asset-extractor';
import { extractAssetsFromNovelContent, type ExtractedNovelAssets } from '@/lib/novel-content-extractor';
import {
  analyzeExtractTemplate,
  buildExtractTemplateContext,
  normalizeExtractChapters,
  normalizeExtractKind,
  pickExtractChapters,
  renderExtractTemplate,
  type ExtractKind,
} from '@/lib/extract-template';
import { resolveTextConfigId } from '@/lib/text-config';
import { extractAppearanceFields } from '@/lib/character-text-parser';
import { shortDramaManager, dramaWorkflowManager, novelDetailManager, novelManager, extractTemplateManager } from '@/storage/database';

/**
 * POST /api/short-dramas/[id]/sync-from-novel
 * 从关联小说提取角色、场景、物品到短剧资源。
 * 优先读取已经生成好的小说章节正文，已有结构化小说子表和结构大纲只作为补充。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const payload = getUserFromToken(request.headers.get('authorization'));
    if (!payload) return NextResponse.json({ error: '未登录' }, { status: 401 });
    const body = await readJsonBody(request);

    const { id: dramaId } = await params;
    const drama = await shortDramaManager.getById(dramaId);
    if (!drama) return NextResponse.json({ error: '短剧不存在' }, { status: 404 });
    if (drama.userId !== payload.userId && payload.role !== 'admin') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }
    if (!drama.novelId) {
      return NextResponse.json({ error: '该短剧未关联小说' }, { status: 400 });
    }

    const novelId = drama.novelId;
    const userId = drama.userId;
    const [details, novel] = await Promise.all([
      novelDetailManager.getNovelDetails(novelId),
      novelManager.getById(novelId),
    ]);

    if (!novel) return NextResponse.json({ error: '关联小说不存在' }, { status: 404 });

    // ── 提取类型（不传 = 三类一起提取，保持原有行为）──
    const rawKinds = Array.isArray(body?.kinds) ? body.kinds : [];
    const kinds: ExtractKind[] = rawKinds
      .map((k: unknown) => normalizeExtractKind(k))
      .filter((k: ExtractKind | null): k is ExtractKind => Boolean(k));

    // ── 提取范围：默认整本；支持按章节号或分集 id 限定 ──
    const allChapters = normalizeExtractChapters(novel.chapters);
    if (allChapters.length === 0) {
      return NextResponse.json({ error: '关联小说还没有正文内容，请先生成章节正文' }, { status: 400 });
    }
    let chapterIndexes: number[] | null = null;
    const rawChapterIndexes = Array.isArray(body?.chapterIndexes) ? body.chapterIndexes : [];
    if (rawChapterIndexes.length > 0) {
      chapterIndexes = rawChapterIndexes
        .map((n: unknown) => Number(n))
        .filter((n: number) => Number.isFinite(n));
    } else if (Array.isArray(body?.episodeIds) && body.episodeIds.length > 0) {
      const episodes = await shortDramaManager.getEpisodesByDramaId(dramaId);
      const wanted = new Set(body.episodeIds.map((x: unknown) => String(x)));
      const picked: number[] = [];
      for (const ep of episodes) {
        if (!wanted.has(String(ep.id))) continue;
        const srcScriptCh = (ep as any).sourceScriptChapterIndex;
        const srcChapter = (ep as any).sourceChapter;
        const idx =
          srcScriptCh != null ? Number(srcScriptCh) + 1 : srcChapter != null ? Number(srcChapter) : Number(ep.episodeNumber);
        if (Number.isFinite(idx)) picked.push(idx);
      }
      if (picked.length > 0) chapterIndexes = picked;
    }
    const scopedChapters = pickExtractChapters(allChapters, chapterIndexes);
    const scopedRaw = scopedChapters.map((c) => ({ index: c.index, title: c.title, content: c.content }));
    const targetChapters = scopedRaw.length > 0 ? scopedRaw : novel.chapters;

    // ── 模版：作品级 > 用户级 > 系统默认；也支持本次临时覆盖 ──
    let renderedTemplate: string | null = null;
    const templateKind: ExtractKind = kinds.length === 1 ? kinds[0] : 'character';
    if (kinds.length > 0 || body?.templateOverride) {
      const resolved = body?.templateOverride
        ? { template: String(body.templateOverride), source: 'override' as const }
        : await extractTemplateManager.resolve(templateKind, { userId, dramaId });
      if (!resolved || !String(resolved.template || '').trim()) {
        return NextResponse.json({ error: '未找到可用的提取模版，请先在「提取模版」里配置' }, { status: 400 });
      }
      const analysis = analyzeExtractTemplate(String(resolved.template), templateKind);
      if (analysis.missingRequired.length > 0) {
        return NextResponse.json(
          { error: `提取模版缺少必备变量：${analysis.missingRequired.map((v) => '{{' + v + '}}').join('、')}` },
          { status: 400 },
        );
      }
      const existingNames = await collectExistingNamesForTemplate(dramaId, templateKind);
      const context = buildExtractTemplateContext({
        kind: templateKind,
        novel,
        drama,
        chapters: scopedChapters,
        allChapters,
        existingNames,
      });
      renderedTemplate = renderExtractTemplate(String(resolved.template), context);
    }

    const ruleAssets = extractAssetsFromNovelContent(targetChapters, {
      idea: novel.idea,
      protagonist: novel.protagonist,
      structure: novel.structure,
    });
    let contentAssets = ruleAssets;
    let extractionMode = '本地规则';
    const forceAI = body?.forceAI === true;
    const resolvedConfigId = await resolveTextConfigId(userId, body?.configId || body?.aiConfigId);

    try {
      const aiAssets = await extractAssetsFromNovelContentWithAI(targetChapters, {
        idea: novel.idea,
        protagonist: novel.protagonist,
        structure: novel.structure,
        configId: resolvedConfigId,
        ...(kinds.length > 0 ? { kinds } : {}),
        ...(renderedTemplate ? { systemPrompt: renderedTemplate, maxTokens: 8000 } : {}),
      });
      if (aiAssets) {
        contentAssets = preferAIAssets(aiAssets, ruleAssets);
        extractionMode = renderedTemplate ? 'AI模版' : 'AI智能';
      } else if (forceAI) {
        return NextResponse.json({
          error: 'AI模型没有返回有效提取结果，请检查文字模型API配置，或确认小说已经生成正文内容。',
        }, { status: 400 });
      }
    } catch (error) {
      if (forceAI) {
        const message = error instanceof Error ? error.message : String(error);
        const status = /文字模型|配置不存在|已停用/.test(message) ? 400 : 500;
        return NextResponse.json({ error: `AI模型提取失败：${message}` }, { status });
      }
      console.warn('[sync-from-novel] AI extraction failed, fallback to rule extractor:', error);
    }

    // 指定类型提取时只处理该类型，避免把另外两类清空或覆盖
    const onlyKinds: ExtractKind[] | null = kinds.length > 0 ? kinds : null;
    const wantCharacters = !onlyKinds || onlyKinds.includes('character');
    const wantScenes = !onlyKinds || onlyKinds.includes('scene');
    const wantItems = !onlyKinds || onlyKinds.includes('item');
    if (!wantCharacters) contentAssets.characters = [];
    if (!wantScenes) contentAssets.scenes = [];
    if (!wantItems) contentAssets.items = [];

    // ── 角色类型（主角/配角）补全 ──
    // 提取模版一般只输出 name/aliases/description，不含 role。此前只能靠
    // 「谁被提及得最多就晋升主角」兜底，而男女双主角的提及次数往往接近（本例 385 : 348），
    // 兜底条件 2 倍差达不到，于是整批角色全部落成「配角」。
    // 这里改为以「小说自己写明的主角名单」和小说侧已存角色为准补全，
    // 保证短剧「从小说提取」出来的主角/配角与小说详情页完全一致。
    const knownRoleIndex = buildKnownRoleIndex(novel, details);
    for (const c of contentAssets.characters) {
      c.role = resolveCharacterRole(c, knownRoleIndex);
    }
    // 提取模版一般只输出 name/aliases/description，性格特点永远是空的。
    // 小说侧已经存了性格的，直接继承过来，别每次提取都把「性格特点」留空。
    const knownPersonalityIndex = buildKnownPersonalityIndex(details);

    await backfillNovelDetailsFromContent(novelId, userId, contentAssets, details);

    const existChars = await dramaWorkflowManager.getCharactersByDramaId(dramaId);
    const existCharMap = new Map(existChars.map((c: any) => [String(c.name || '').trim(), c]));
    const existCharNames = new Set(existCharMap.keys());
    let charCreated = 0;
    let charUpdated = 0;

    const addCharacter = async (c: any) => {
      const name = String(c?.name || '').trim();
      if (!name) return;
      const resolved = resolveExistingCharacter(name, existCharMap);
      if (resolved) {
        const existing = resolved.row;
        // 按别名命中的说明是同一个人换了叫法：把这个叫法补进别名，下次就能直接对上
        const patch =
          resolved.matchedBy === 'alias'
            ? {
                ...buildCharacterUpdatePatch(existing, c),
                aliases: Array.from(new Set([...splitAliasList(existing.aliases), ...splitAliasList(c?.aliases), ...splitAliasList(name)])).join(','),
              }
            : buildCharacterUpdatePatch(existing, c);
        if (Object.keys(patch).length > 0) {
          await dramaWorkflowManager.updateCharacter(existing.id, patch);
          Object.assign(existing, patch);
          charUpdated++;
        }
        return;
      }
      const appearanceFields = extractAppearanceFields(c.appearance || c.description || '');
      const created = await dramaWorkflowManager.createCharacter({
        dramaId,
        userId,
        name,
        role: normalizeRole(c.role),
        gender: normalizeGender(c.gender),
        description: c.description || null,
        personality: c.personality || null,
        appearance: c.appearance || null,
        aliases: c.aliases || null,
        appearanceHairColor: appearanceFields.hairColor || null,
        appearanceHairstyle: appearanceFields.hairstyle || null,
        appearanceEyes: appearanceFields.eyes || null,
        appearanceUpper: appearanceFields.upper || null,
        appearanceLower: appearanceFields.lower || null,
        sortOrder: existChars.length + charCreated,
      } as any);
      existCharNames.add(name);
      existCharMap.set(name, created);
      charCreated++;
    };

    /** 提取结果没给性格时，从小说侧已存角色继承，避免把「性格特点」写空 */
    const withInheritedPersonality = (list: any[]) =>
      list.map((c: any) => {
        if (cleanIncomingText(c?.personality)) return c;
        const inherited = lookupIndexedValue(knownPersonalityIndex, String(c?.name || '').trim(), c?.aliases);
        return inherited ? { ...c, personality: inherited } : c;
      });

    for (const c of withInheritedPersonality(contentAssets.characters)) await addCharacter(c);
    if (wantCharacters && contentAssets.characters.length === 0) {
      for (const c of withInheritedPersonality(getValidNovelCharacters(details.characters))) await addCharacter(c);
    }
    if (contentAssets.characters.length === 0 && getValidNovelCharacters(details.characters).length === 0) {
      for (const c of withInheritedPersonality(parseIdeaCharacters(novel.idea))) await addCharacter(c);
    }

    const existScenes = await dramaWorkflowManager.getScenesByDramaId(dramaId);
    const existSceneMap = new Map(existScenes.map((s: any) => [String(s.name || '').trim(), s]));
    const existSceneNames = new Set(existSceneMap.keys());
    let sceneCreated = 0;
    let sceneUpdated = 0;

    const addScene = async (s: any) => {
      const name = String(s?.name || s?.title || '').trim();
      if (!name) return;
      const existing = existSceneMap.get(name);
      if (existing) {
        const patch = buildSceneUpdatePatch(existing, s);
        if (Object.keys(patch).length > 0) {
          await dramaWorkflowManager.updateScene(existing.id, patch);
          Object.assign(existing, patch);
          sceneUpdated++;
        }
        return;
      }
      const created = await dramaWorkflowManager.createScene({
        dramaId,
        userId,
        name,
        description: s.description || null,
        atmosphere: s.atmosphere || null,
        sortOrder: existScenes.length + sceneCreated,
      });
      existSceneNames.add(name);
      existSceneMap.set(name, created);
      sceneCreated++;
    };

    for (const s of contentAssets.scenes) await addScene(s);
    if (wantScenes && contentAssets.scenes.length === 0) {
      for (const s of details.scenes || []) await addScene(s);
      if ((details.scenes || []).length === 0) {
        for (const s of getStructuredEntries(novel.structure, 'scene')) await addScene(s);
      }
    }

    const existItems = await dramaWorkflowManager.getItemsByDramaId(dramaId);
    const existItemMap = new Map(existItems.map((it: any) => [String(it.name || '').trim(), it]));
    const existItemNames = new Set(existItemMap.keys());
    let itemCreated = 0;
    let itemUpdated = 0;

    const addItem = async (item: any) => {
      const name = String(item?.name || item?.title || '').trim();
      if (!name) return;
      const existing = existItemMap.get(name);
      if (existing) {
        const patch = buildItemUpdatePatch(existing, item);
        if (Object.keys(patch).length > 0) {
          await dramaWorkflowManager.updateItem(existing.id, patch);
          Object.assign(existing, patch);
          itemUpdated++;
        }
        return;
      }
      const created = await dramaWorkflowManager.createItem({
        dramaId,
        userId,
        name,
        description: item.description || null,
        significance: item.significance || null,
        sortOrder: existItems.length + itemCreated,
      });
      existItemNames.add(name);
      existItemMap.set(name, created);
      itemCreated++;
    };

    for (const item of contentAssets.items) await addItem(item);
    if (wantItems && contentAssets.items.length === 0) {
      for (const item of details.items || []) await addItem(item);
      if ((details.items || []).length === 0) {
        for (const item of getStructuredEntries(novel.structure, 'item')) await addItem(item);
      }
    }

    const kindLabel = (k: ExtractKind) => (k === 'character' ? '角色' : k === 'scene' ? '场景' : '物品');
    const scopeLabel =
      onlyKinds || chapterIndexes
        ? '（' + (onlyKinds ? '仅' + onlyKinds.map(kindLabel).join('、') + '；' : '') + '第' + scopedChapters.map((c) => c.index).join('、') + '章）'
        : '';

    const [characters, scenes, items] = await Promise.all([
      dramaWorkflowManager.getCharactersByDramaId(dramaId),
      dramaWorkflowManager.getScenesByDramaId(dramaId),
      dramaWorkflowManager.getItemsByDramaId(dramaId),
    ]);

    return NextResponse.json({
      success: true,
      message: `提取完成：${extractionMode}提取${scopeLabel}，已读取${contentAssets.sourceChapterCount}章正文，新增角色${charCreated}个、更新角色${charUpdated}个；新增场景${sceneCreated}个、更新场景${sceneUpdated}个；新增物品${itemCreated}个、更新物品${itemUpdated}个`,
      data: {
        characters,
        scenes,
        items,
        charCreated,
        charUpdated,
        sceneCreated,
        sceneUpdated,
        itemCreated,
        itemUpdated,
        extractedFromContent: {
          mode: extractionMode,
          characters: contentAssets.characters.length,
          scenes: contentAssets.scenes.length,
          items: contentAssets.items.length,
          chapters: contentAssets.sourceChapterCount,
        },
      },
    });
  } catch (error: any) {
    console.error('[sync-from-novel] failed:', error);
    return NextResponse.json({ error: `同步失败: ${error.message || String(error)}` }, { status: 500 });
  }
}

/** 拆分别名字符串 */
function splitAliasList(value: unknown): string[] {
  return String(value ?? '')
    .split(/[,，、;；\/｜|]/)
    .map((alias) => alias.trim())
    .filter(Boolean);
}

/**
 * 找出这条提取结果对应的已有角色。
 * 先按名字精确命中；名字对不上时，再看有没有「唯一一个」已有角色把该名字写在别名里。
 * 模型每次给同一个人起的名字可能不同（陈建国 / 陈博士、老者 / 神秘老人），
 * 只按名字匹配会反复建出重复行，所以这里用别名兜一层。
 */
function resolveExistingCharacter(
  name: string,
  existCharMap: Map<string, any>,
): { row: any; matchedBy: 'name' | 'alias' } | null {
  const exact = existCharMap.get(name);
  if (exact) return { row: exact, matchedBy: 'name' };
  const claimants = [...existCharMap.values()].filter((row) => splitAliasList(row?.aliases).includes(name));
  if (claimants.length === 1) return { row: claimants[0], matchedBy: 'alias' };
  if (claimants.length > 1) return null;

  // 模型偶尔会把「本体 + 代称」拼成一个名字（例如「白兔/食梦貘」）。
  // 这种分隔符不会出现在真实人名里，拆开逐段匹配；只有全部指向同一个角色时才归并，
  // 否则宁可新建，也不要把两个人错并成一个。
  const fragments = name.split(/[/｜|·・]+/).map((f) => f.trim()).filter(Boolean);
  if (fragments.length < 2) return null;
  const hits = new Set<any>();
  for (const fragment of fragments) {
    const hit =
      existCharMap.get(fragment) ||
      [...existCharMap.values()].filter((row) => splitAliasList(row?.aliases).includes(fragment))[0];
    if (hit) hits.add(hit);
  }
  return hits.size === 1 ? { row: [...hits][0], matchedBy: 'alias' } : null;
}

async function readJsonBody(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function preferAIAssets(aiAssets: ExtractedNovelAssets, ruleAssets: ExtractedNovelAssets): ExtractedNovelAssets {
  return {
    characters: aiAssets.characters.length > 0 ? aiAssets.characters : ruleAssets.characters,
    scenes: aiAssets.scenes.length > 0 ? aiAssets.scenes : ruleAssets.scenes,
    items: aiAssets.items.length > 0 ? aiAssets.items : ruleAssets.items,
    sourceChapterCount: ruleAssets.sourceChapterCount || aiAssets.sourceChapterCount,
  };
}

function buildCharacterUpdatePatch(existing: any, incoming: any) {
  const patch: any = {};
  const role = normalizeRole(incoming?.role);
  const gender = normalizeGender(incoming?.gender);
  const description = cleanIncomingText(incoming?.description);
  const personality = cleanIncomingText(incoming?.personality);
  const appearance = cleanIncomingText(incoming?.appearance);

  if (role && shouldUseIncomingRole(existing?.role, role)) patch.role = role;
  if (gender && shouldUseIncomingGender(existing?.gender, gender)) patch.gender = gender;
  if (shouldUseIncomingText(existing?.description, description)) patch.description = description;
  if (shouldUseIncomingText(existing?.personality, personality)) patch.personality = personality;
  if (shouldUseIncomingAppearance(existing?.appearance, appearance)) patch.appearance = appearance;

  // 别名：供 @提及 做别称匹配
  const aliases = cleanIncomingText(incoming?.aliases);
  if (shouldUseIncomingText(existing?.aliases, aliases)) patch.aliases = aliases;

  // 外貌拆字段：只在原列为空时补写，不覆盖用户手工填过的值。
  // 部分模版把人物形象整段写在 description 里（不单列 appearance），这里一并兜住。
  const fields = extractAppearanceFields(appearance || description || existing?.appearance || '');
  const fieldMap: Array<[keyof typeof fields, string]> = [
    ['hairColor', 'appearanceHairColor'],
    ['hairstyle', 'appearanceHairstyle'],
    ['eyes', 'appearanceEyes'],
    ['upper', 'appearanceUpper'],
    ['lower', 'appearanceLower'],
  ];
  for (const [srcKey, colKey] of fieldMap) {
    const value = fields[srcKey];
    if (value && !String(existing?.[colKey] || '').trim()) patch[colKey] = value;
  }

  return patch;
}

function buildSceneUpdatePatch(existing: any, incoming: any) {
  const patch: any = {};
  const description = cleanIncomingText(incoming?.description);
  const atmosphere = cleanIncomingText(incoming?.atmosphere);
  if (shouldUseIncomingText(existing?.description, description)) patch.description = description;
  if (shouldUseIncomingText(existing?.atmosphere, atmosphere)) patch.atmosphere = atmosphere;
  return patch;
}

function buildItemUpdatePatch(existing: any, incoming: any) {
  const patch: any = {};
  const description = cleanIncomingText(incoming?.description);
  const significance = cleanIncomingText(incoming?.significance);
  if (shouldUseIncomingText(existing?.description, description)) patch.description = description;
  if (shouldUseIncomingText(existing?.significance, significance)) patch.significance = significance;
  return patch;
}

function cleanIncomingText(value: unknown) {
  return String(value ?? '').trim();
}

function isBlankText(value: unknown) {
  const text = cleanIncomingText(value).toLowerCase();
  return !text || text === 'unknown' || text === 'null' || text === 'undefined' || text === '未知';
}

function shouldUseIncomingRole(existing: unknown, incoming: string) {
  if (!incoming) return false;
  const current = cleanIncomingText(existing);
  return !current || current === 'minor' || (incoming === 'protagonist' && current !== incoming);
}

function shouldUseIncomingGender(existing: unknown, incoming: string) {
  if (!incoming) return false;
  const current = cleanIncomingText(existing);
  return isBlankText(current) || current === 'male' || current === 'female' || current === 'other' || current !== incoming;
}

function shouldUseIncomingText(existing: unknown, incoming: string) {
  if (!incoming) return false;
  const current = cleanIncomingText(existing);
  return isBlankText(current) || incoming.length > current.length + 20;
}

function hasAppearanceTags(value: unknown) {
  return /发色|发型|眼睛|上身|下身/.test(cleanIncomingText(value));
}

function shouldUseIncomingAppearance(existing: unknown, incoming: string) {
  if (!incoming) return false;
  const current = cleanIncomingText(existing);
  return isBlankText(current) || (hasAppearanceTags(incoming) && !hasAppearanceTags(current)) || incoming.length > current.length + 20;
}

async function backfillNovelDetailsFromContent(
  novelId: string,
  userId: string,
  assets: ExtractedNovelAssets,
  details: any,
) {
  const charMap = new Map((details.characters || []).map((c: any) => [String(c.name || '').trim(), c]));
  const charNames = new Set(charMap.keys());
  for (const c of assets.characters) {
    const resolved = resolveExistingCharacter(String(c.name || '').trim(), charMap as Map<string, any>);
    if (resolved) {
      const existing = resolved.row;
      const patch =
        resolved.matchedBy === 'alias'
          ? {
              ...buildCharacterUpdatePatch(existing, c),
              aliases: Array.from(new Set([...splitAliasList(existing.aliases), ...splitAliasList(c?.aliases), ...splitAliasList(c.name)])).join(','),
            }
          : buildCharacterUpdatePatch(existing, c);
      if (Object.keys(patch).length > 0) {
        await novelDetailManager.updateCharacter(existing.id, patch);
        Object.assign(existing, patch);
      }
      continue;
    }
    const novelSideFields = extractAppearanceFields(c.appearance || c.description || '');
    await novelDetailManager.createCharacter(novelId, userId, {
      name: c.name,
      role: normalizeRole(c.role),
      gender: normalizeGender(c.gender),
      description: c.description || null,
      personality: c.personality || null,
      appearance: c.appearance || null,
      aliases: c.aliases || null,
      appearanceHairColor: novelSideFields.hairColor || null,
      appearanceHairstyle: novelSideFields.hairstyle || null,
      appearanceEyes: novelSideFields.eyes || null,
      appearanceUpper: novelSideFields.upper || null,
      appearanceLower: novelSideFields.lower || null,
      sortOrder: charNames.size,
    } as any);
    charNames.add(c.name);
  }

  const sceneMap = new Map((details.scenes || []).map((s: any) => [String(s.name || '').trim(), s]));
  const sceneNames = new Set(sceneMap.keys());
  for (const s of assets.scenes) {
    const existing = sceneMap.get(s.name) as any;
    if (existing) {
      const patch = buildSceneUpdatePatch(existing, s);
      if (Object.keys(patch).length > 0) {
        await novelDetailManager.updateScene(existing.id, patch);
        Object.assign(existing, patch);
      }
      continue;
    }
    await novelDetailManager.createScene(novelId, userId, {
      name: s.name,
      description: s.description || null,
      atmosphere: s.atmosphere || null,
      relatedChapters: JSON.stringify(s.relatedChapters || []),
      sortOrder: sceneNames.size,
    });
    sceneNames.add(s.name);
  }

  const itemMap = new Map((details.items || []).map((item: any) => [String(item.name || '').trim(), item]));
  const itemNames = new Set(itemMap.keys());
  for (const item of assets.items) {
    const existing = itemMap.get(item.name) as any;
    if (existing) {
      const patch = buildItemUpdatePatch(existing, item);
      if (Object.keys(patch).length > 0) {
        await novelDetailManager.updateItem(existing.id, patch);
        Object.assign(existing, patch);
      }
      continue;
    }
    await novelDetailManager.createItem(novelId, userId, {
      name: item.name,
      description: item.description || null,
      significance: item.significance || null,
      relatedChapters: JSON.stringify(item.relatedChapters || []),
      sortOrder: itemNames.size,
    });
    itemNames.add(item.name);
  }
}

/** 收集该短剧已有的资产名，供模版 {{已有角色}}/{{已有场景}}/{{已有物品}} 做去重参考 */
async function collectExistingNamesForTemplate(dramaId: string, kind: ExtractKind): Promise<string[]> {
  try {
    const rows: any[] = kind === 'character'
      ? await dramaWorkflowManager.getCharactersByDramaId(dramaId)
      : kind === 'scene'
        ? await dramaWorkflowManager.getScenesByDramaId(dramaId)
        : await dramaWorkflowManager.getItemsByDramaId(dramaId);
    const names = (rows || [])
      .map((row: any) => String(row?.name || '').trim())
      .filter(Boolean);
    return Array.from(new Set(names));
  } catch (error) {
    console.warn('[sync-from-novel] 读取已有资产失败，模版去重参考为空：', error);
    return [];
  }
}

function getValidNovelCharacters(characters: any[] = []) {
  return characters.filter((c: any) => {
    const name = String(c?.name || '').trim();
    if (!name) return false;
    return !/[，,、]/.test(name);
  });
}

function parseIdeaCharacters(ideaInput: unknown) {
  const idea = parseMaybeJson(ideaInput);
  if (!idea || typeof idea !== 'object') return [];
  return [
    ...parseCharacterBlock(String((idea as any).characters || ''), 'protagonist'),
    ...parseCharacterBlock(String((idea as any).supportingCharacters || ''), 'supporting'),
  ];
}

function parseCharacterBlock(text: string, role: string) {
  if (!text) return [];
  const lines = text.replace(/\\n/g, '\n').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const results: any[] = [];
  for (const line of lines) {
    const match = line.match(/^([\u4e00-\u9fff]{2,6})\s*(?:[—\-:：]|【|\(|（)?/);
    const name = match?.[1]?.trim();
    if (!name || /^(他们|她们|我们|你们|众人|大家|男人|女人|老人|孩子|系统|怪物)$/.test(name)) continue;
    if (/(角色|主角|配角|人物|设定|关系|冲突)/.test(name)) continue;
    results.push({
      name,
      role,
      gender: inferGenderFromText(line),
      description: line.replace(name, '').replace(/^[—\-:：\s]+/, '').trim(),
    });
  }
  return results;
}

function getStructuredEntries(structureInput: unknown, type: 'scene' | 'item') {
  const structure = parseMaybeJson(structureInput);
  if (!structure || typeof structure !== 'object') return [];
  const raw = type === 'scene'
    ? ((structure as any).keyScenes || (structure as any).scenes)
    : ((structure as any).keyItems || (structure as any).items);
  return normalizeStructuredEntries(raw);
}

function normalizeStructuredEntries(raw: unknown) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => typeof entry === 'string'
        ? parseStructuredTextBlock(entry)
        : {
            name: entry?.name || entry?.title || '',
            description: entry?.description || entry?.summary || '',
            atmosphere: entry?.atmosphere || null,
            significance: entry?.significance || null,
          })
      .filter((entry) => entry.name);
  }
  if (typeof raw !== 'string') return [];
  return raw
    .replace(/\\n/g, '\n')
    .split(/(?=\n?\s*(?:\d+[.、]|[-*]\s+))/)
    .map(parseStructuredTextBlock)
    .filter((entry) => entry.name);
}

function parseStructuredTextBlock(block: string) {
  const lines = block
    .replace(/^\s*(?:\d+[.、]|[-*]\s+)/, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const name = (lines[0] || '').replace(/^[【\[]|[】\]]$/g, '').trim();
  const descriptionLines: string[] = [];
  let atmosphere: string | null = null;
  let significance: string | null = null;
  for (const line of lines.slice(1)) {
    const atmosphereMatch = line.match(/^(?:氛围|基调)[:：]\s*(.+)$/);
    if (atmosphereMatch) {
      atmosphere = atmosphereMatch[1].trim();
      continue;
    }
    const significanceMatch = line.match(/^(?:重要性|象征意义|作用)[:：]\s*(.+)$/);
    if (significanceMatch) {
      significance = significanceMatch[1].trim();
      continue;
    }
    descriptionLines.push(line);
  }
  return { name, description: descriptionLines.join('\n'), atmosphere, significance };
}

/** 小说侧「角色名 / 别名 → 性格特点」索引，只收非空的，供短剧侧继承 */
function buildKnownPersonalityIndex(details: any): Map<string, string> {
  const index = new Map<string, string>();
  const remember = (rawName: unknown, value: unknown) => {
    const name = String(rawName ?? '').trim();
    const text = cleanIncomingText(value);
    if (!name || !text || index.has(name)) return;
    index.set(name, text);
  };
  for (const row of details?.characters || []) {
    remember(row?.name, row?.personality);
    for (const alias of splitAliasList(row?.aliases)) remember(alias, row?.personality);
  }
  return index;
}

/** 按「名字 → 别名 → 拼接名拆段」的顺序在索引里取值 */
function lookupIndexedValue(index: Map<string, string>, name: string, aliases?: unknown): string | undefined {
  const direct = index.get(name) || splitAliasList(aliases).map((alias) => index.get(alias)).find(Boolean);
  if (direct) return direct;
  const fragments = name.split(/[/｜|·・]+/).map((f) => f.trim()).filter(Boolean);
  return fragments.length > 1 ? fragments.map((f) => index.get(f)).find(Boolean) : undefined;
}

/** 解析 role 文本为明确取值；解析不出来返回 null（用于区分「明确是配角」和「没说」） */
function parseExplicitRole(role: unknown): 'protagonist' | 'supporting' | 'minor' | null {
  const text = String(role ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text === 'protagonist' || /主角|男主|女主|主人公/.test(text)) return 'protagonist';
  if (text === 'minor' || /次要|客串|龙套|路人/.test(text)) return 'minor';
  if (text === 'supporting' || /配角|支持/.test(text)) return 'supporting';
  return null;
}

/**
 * 汇总「这个人到底是不是主角」的已知依据：
 * 1) 小说 idea 里写死的 characters（主角）/ supportingCharacters（配角）——作者钦定，最权威
 * 2) 小说侧已存角色表的 role——用户在小说详情里看到并确认过的结果
 * 主角优先：任一来源判定为主角后，不再被其它来源降级。
 */
function buildKnownRoleIndex(novel: any, details: any): Map<string, string> {
  const index = new Map<string, string>();
  const remember = (rawName: unknown, role: string | null) => {
    const name = String(rawName ?? '').trim();
    if (!name || !role) return;
    if (index.get(name) === 'protagonist') return;
    index.set(name, role);
  };

  for (const c of parseIdeaCharacters(novel?.idea)) {
    remember(c?.name, parseExplicitRole(c?.role));
  }
  for (const row of details?.characters || []) {
    const role = parseExplicitRole(row?.role);
    for (const key of [row?.name, ...splitAliasList(row?.aliases)]) remember(key, role);
  }
  return index;
}

/** 决定这条提取结果该用哪种角色类型：主角信号 > 次要 > 配角 */
function resolveCharacterRole(item: any, knownRoleIndex: Map<string, string>): string {
  const declared = parseExplicitRole(item?.role);
  const known =
    knownRoleIndex.get(String(item?.name ?? '').trim()) ||
    splitAliasList(item?.aliases).map((alias) => knownRoleIndex.get(alias)).find(Boolean);
  if (declared === 'protagonist' || known === 'protagonist') return 'protagonist';
  if (declared === 'minor' || known === 'minor') return 'minor';
  return 'supporting';
}

function normalizeRole(role: unknown) {
  const text = String(role || '').toLowerCase();
  if (text === 'protagonist' || text.includes('主角')) return 'protagonist';
  if (text === 'minor' || text.includes('次要') || text.includes('客串')) return 'minor';
  return 'supporting';
}

function normalizeGender(gender: unknown): string | null {
  const text = String(gender || '').trim().toLowerCase();
  if (!text) return null;
  if (text === 'male' || text === '男' || text === '男性' || text === '雄性') return '男';
  if (text === 'female' || text === '女' || text === '女性' || text === '雌性') return '女';
  if (text === 'other' || text === '其他' || text === '非人' || text === '宠物' || text === '动物' || text === '异兽' || text === 'ai') return '其他';
  return null;
}

function inferGenderFromText(text: string): string | null {
  if (/[【\[(（](?:男|男性|male)[】\])）]/i.test(text)) return 'male';
  if (/[【\[(（](?:女|女性|female)[】\])）]/i.test(text)) return 'female';
  if (/他/.test(text) && !/她/.test(text)) return 'male';
  if (/她/.test(text) && !/他/.test(text)) return 'female';
  return null;
}

function parseMaybeJson(input: unknown): unknown {
  if (!input || typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}
