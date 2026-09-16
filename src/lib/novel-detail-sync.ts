import { novelDetailManager } from "@/storage/database";
import { getStandaloneSceneAtmosphere, splitSceneDescriptionAtmosphere } from "@/lib/scene-atmosphere";
import { getStandaloneItemSignificance, splitItemDescriptionSignificance } from "@/lib/item-significance";
import { parseCharacterRelationshipsText } from "@/lib/character-relationships";
import { parseCharacterDetails, parseCharacterHeader } from "@/lib/character-text-parser";

/**
 * 从小说保存数据中提取结构化信息，同步到 5 张子表
 * 在创建/更新小说时异步调用，不阻塞主流程
 */
export async function syncNovelDetails(
  novelId: string,
  userId: string,
  body: any
): Promise<void> {
  const structure = body.structure;
  if (!structure) return;

  // 解析 structure（可能是字符串或对象）
  let struct: any;
  if (typeof structure === 'string') {
    try { struct = JSON.parse(structure); } catch { return; }
  } else {
    struct = structure;
  }

  // 1. 同步剧情表 (novel_plots)
  if (struct.mainPlot || struct.emotionalCurve || struct.keyConflicts) {
    await novelDetailManager.upsertPlot(novelId, userId, {
      mainPlot: struct.mainPlot || null,
      emotionalCurve: struct.emotionalCurve || null,
      keyConflicts: struct.keyConflicts || null,
    });
  }

  // 3. 同步场景表 (novel_scenes) — 从 keyScenes 文本中解析
  if (struct.keyScenes && typeof struct.keyScenes === 'string' && struct.keyScenes.length > 15) {
    const scenes = parseSceneList(struct.keyScenes);
    if (scenes.length > 0) {
      // 先清除旧数据再批量插入
      await novelDetailManager.deleteScenesByNovelId(novelId);
      await novelDetailManager.bulkCreateScenes(novelId, userId,
        scenes.map((s, i) => ({
          name: s.title,
          description: s.description,
          atmosphere: s.atmosphere || null,
          sortOrder: i,
        }))
      );
    }
  }

  // 4. 同步物品表 (novel_items) — 从 keyItems 文本中解析
  if (struct.keyItems && typeof struct.keyItems === 'string' && struct.keyItems.length > 15) {
    const items = parseNumberedList(struct.keyItems);
    if (items.length > 0) {
      await novelDetailManager.deleteItemsByNovelId(novelId);
      await novelDetailManager.bulkCreateItems(novelId, userId,
        items.map((it, i) => ({
          name: it.title,
          description: it.description,
          significance: it.significance || null,
          sortOrder: i,
        }))
      );
    }
  }

  // 5. 同步角色关系表 (novel_character_relationships) — 解析 idea.characterRelationships
  const idea = body.idea;
  if (idea) {
    let ideaObj: any;
    if (typeof idea === 'string') {
      try { ideaObj = JSON.parse(idea); } catch { ideaObj = null; }
    } else {
      ideaObj = idea;
    }
    if (ideaObj?.characterRelationships && typeof ideaObj.characterRelationships === 'string'
        && ideaObj.characterRelationships.length > 10) {
      const rels = parseCharacterRelationshipsText(ideaObj.characterRelationships);
      if (rels.length > 0) {
        await novelDetailManager.deleteRelationshipsByNovelId(novelId);
        await novelDetailManager.bulkCreateRelationships(novelId, userId,
          rels.map((r, i) => ({ fromCharacter: r.from, toCharacter: r.to, relationship: r.description, sortOrder: i }))
        );
      }
    }

    const conflicts = parseConflictEntries(ideaObj?.conflictRelationships, struct.keyConflicts);
    if (conflicts.length > 0) {
      await novelDetailManager.deleteConflictsByNovelId(novelId);
      await novelDetailManager.bulkCreateConflicts(novelId, userId,
        conflicts.map((c, i) => ({
          fromCharacter: c.fromCharacter,
          toCharacter: c.toCharacter,
          conflictType: c.conflictType,
          description: c.description,
          sortOrder: i,
        }))
      );
    }
  }

  // 6. 同步角色表 (novel_characters) — 解析 idea.characters + idea.supportingCharacters
  // (reuse already-parsed ideaObj below)
  if (idea) {
    let ideaObj: any;
    if (typeof idea === 'string') {
      try { ideaObj = JSON.parse(idea); } catch { ideaObj = null; }
    } else {
      ideaObj = idea;
    }
    if (ideaObj) {
      const protagonists = parseCharactersFromText(ideaObj.characters || '', 'protagonist');
      const supporting = parseCharactersFromText(ideaObj.supportingCharacters || '', 'supporting');
      const allChars = [...protagonists, ...supporting];

      if (allChars.length > 0) {
        const existingChars = await novelDetailManager.getCharactersByNovelId(novelId);
        const hasMergedEntry = existingChars.length === 1 && /[，,、]/.test(existingChars[0].name);
        const expectedNames = new Set(allChars.map(c => c.name));
        // 若已有角色且至少一个名字命中期望列表 → 说明数据基本正确，仅补充缺失角色
        const matchingCount = existingChars.filter((c: any) => expectedNames.has(c.name)).length;
        const shouldRebuild = existingChars.length === 0 || hasMergedEntry || matchingCount === 0;

        if (shouldRebuild) {
          if (existingChars.length > 0) await novelDetailManager.deleteCharactersByNovelId(novelId);
          for (const c of allChars) {
            await novelDetailManager.createCharacter(novelId, userId, {
              name: c.name, role: c.role, gender: c.gender || null, description: c.description,
              personality: c.personality, appearance: c.appearance || null, background: c.background || null,
            });
          }
        } else if (matchingCount < allChars.length) {
          // 补充缺失角色，保留已有（含用户手动编辑）
          const existingNameSet = new Set(existingChars.map((c: any) => c.name));
          for (const c of allChars) {
            if (existingNameSet.has(c.name)) continue;
            await novelDetailManager.createCharacter(novelId, userId, {
              name: c.name, role: c.role, gender: c.gender || null, description: c.description,
              personality: c.personality, appearance: c.appearance || null, background: c.background || null,
            });
          }
        }
      } else if (body.protagonist) {
        const existingChars = await novelDetailManager.getCharactersByNovelId(novelId);
        if (existingChars.length === 0) {
          const fallbackNames = body.protagonist.split(/[，,、;；]+/).map((s: string) => s.trim()).filter(Boolean);
          for (const fallbackName of fallbackNames) {
            await novelDetailManager.createCharacter(novelId, userId, {
              name: fallbackName, role: 'protagonist',
              description: ideaObj && typeof ideaObj.characters === 'string' ? ideaObj.characters.slice(0, 300) : '',
            });
          }
        }
      }
    }
  }
}

type ParsedConflictEntry = {
  fromCharacter: string;
  toCharacter: string;
  conflictType: string | null;
  description: string;
};

function parseConflictEntries(conflictRelationships: any, keyConflicts: any): ParsedConflictEntry[] {
  const relationshipText = normalizeConflictSource(conflictRelationships);
  const directConflicts = parseConflictRelationshipText(relationshipText);
  if (directConflicts.length > 0) return directConflicts;

  const keyConflictText = normalizeConflictSource(keyConflicts);
  return parseKeyConflictText(keyConflictText);
}

function normalizeConflictSource(value: any): string {
  if (typeof value === 'string') return value.replace(/\\n/g, '\n').trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => typeof item === 'string' ? item : JSON.stringify(item))
      .join('\n')
      .replace(/\\n/g, '\n')
      .trim();
  }
  return '';
}

function parseConflictRelationshipText(text: string): ParsedConflictEntry[] {
  if (!text) return [];
  return text
    .split(/\n+/)
    .map((line) => parseConflictLine(line))
    .filter((item): item is ParsedConflictEntry => Boolean(item));
}

function parseKeyConflictText(text: string): ParsedConflictEntry[] {
  if (!text) return [];
  const numbered = parseNumberedList(text);
  if (numbered.length > 0) {
    return numbered
      .map((item) => parseConflictLine(`${item.title}：${item.description}`) || ({
        fromCharacter: item.title.slice(0, 40) || '关键冲突',
        toCharacter: '故事主线',
        conflictType: '关键冲突',
        description: item.description || item.title,
      }))
      .filter((item) => item.description);
  }

  return text
    .split(/\n\s*\n|\n+/)
    .map((line) => parseConflictLine(line) || ({
      fromCharacter: line.trim().slice(0, 40) || '关键冲突',
      toCharacter: '故事主线',
      conflictType: '关键冲突',
      description: line.trim(),
    }))
    .filter((item) => item.description);
}

function parseConflictLine(rawLine: string): ParsedConflictEntry | null {
  const line = rawLine
    .replace(/\\n/g, '\n')
    .replace(/^\s*(?:[-*•]|第?\d+[.、章节：:\s]+)\s*/, '')
    .trim();
  if (!line) return null;

  const pairMatch = line.match(/^(.{1,24}?)\s*(?:⊗|⚔|VS|vs|v\.s\.|对抗|对峙|与|和)\s*(.{1,24}?)(?:\s*[：:—-]\s*(.*))?$/i);
  const type = extractConflictType(line);
  if (pairMatch) {
    const fromCharacter = cleanConflictName(pairMatch[1]);
    const toCharacter = cleanConflictName(pairMatch[2]);
    const rest = (pairMatch[3] || '').trim();
    const description = stripLeadingConflictType(rest || line);
    if (fromCharacter && toCharacter) {
      return {
        fromCharacter,
        toCharacter,
        conflictType: type,
        description: description || line,
      };
    }
  }

  const [titlePart, ...descParts] = line.split(/[：:]/);
  const title = titlePart.trim();
  const description = stripLeadingConflictType(descParts.join('：').trim()) || line;
  return {
    fromCharacter: title.slice(0, 40) || '关键冲突',
    toCharacter: '故事主线',
    conflictType: type || '关键冲突',
    description,
  };
}

function cleanConflictName(name: string): string {
  return name
    .replace(/^(?:角色|人物)\s*/, '')
    .replace(/的?(?:对抗|对峙|冲突|矛盾|拉扯|较量|博弈|争夺|信任|背叛|危机|隔阂).*$/, '')
    .trim()
    .slice(0, 40);
}

function extractConflictType(text: string): string | null {
  const match = text.match(/(理念冲突|利益冲突|情感冲突|宿命冲突|信任冲突|身份冲突|阶层冲突|生存冲突|权力冲突|道德冲突|内在冲突|内心冲突|外部冲突|核心冲突|关键冲突)/);
  return match ? match[1] : '关键冲突';
}

function stripLeadingConflictType(text: string): string {
  return text.replace(/^(?:理念冲突|利益冲突|情感冲突|宿命冲突|信任冲突|身份冲突|阶层冲突|生存冲突|权力冲突|道德冲突|内在冲突|内心冲突|外部冲突|核心冲突|关键冲突)\s*[：:，,、-]?\s*/, '').trim();
}

function cleanChapterHook(value: any, chapterNumber: number): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(/\\n/g, '\n')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^\s*(?:第?\d+章|chapter\s*\d+|hook\s*\d*)\s*[：:.\-、]?\s*/i, '')
    .trim();
  if (!cleaned || cleaned === '[object Object]') return '';
  return cleaned.replace(/^第\d+章[：:]/, '');
}

function isValidChapterHook(value: any): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length < 12) return false;
  if (/^(mainPlot|emotionalCurve|keyConflicts|keyScenes|keyItems|chapters|title|summary|content)$/i.test(text)) return false;
  if (/^第\d+章[：:]?\s*(剧情发展|故事继续|待续|略|新钩子)/.test(text)) return false;
  if (/(剧情发展|故事继续展开|新的挑战和选择|推动剧情向更深层发展|真相比想象的更加复杂|命运转折)$/.test(text)) return false;
  if (/^[\u4e00-\u9fa5]{1,8}(→[\u4e00-\u9fa5]{1,8}){2,}$/.test(text)) return false;
  if (/^好奇→|^平静→|^紧张→/.test(text)) return false;
  return true;
}

/** 从角色文本中解析独立角色列表（用于 novel_characters 同步） */
function parseCharactersFromText(
  text: string,
  defaultRole: string
): Array<{ name: string; role: string; gender: string | null; description: string; personality: string; appearance: string; background: string }> {
  if (!text || typeof text !== 'string') return [];
  // 逗号/顿号分隔的纯名字列表（严格判断：每项必须是 2-5 字的正名）
  const commaNames = text.split(/[，,、;；]+/).map(s => s.trim()).filter(s => s.length >= 2);
  const PROPER_NAME_RE = /^[^\s【\[（(，,、—。？！：:\n他她它我你您这那其而但因所为等从以被]{2,5}$/;
  const looksLikeNameList = commaNames.length >= 2 && commaNames.length <= 12
    && commaNames.every(s => PROPER_NAME_RE.test(s));
  if (looksLikeNameList) {
    return commaNames.map(name => ({ name, role: defaultRole, gender: null, description: '', personality: '', appearance: '', background: '' }));
  }
  // 按「名字——」header 行拆分角色块（避免描述续行被误判为新角色）
  const results: Array<{ name: string; role: string; gender: string | null; description: string; personality: string; appearance: string; background: string }> = [];
  const lines = text.split('\n');
  const headerIndexes: number[] = [];
  // header 特征：2-6字短名，不以虚词/代词开头，含「——」分隔符
  const PARTICLE_RE = /^[他她它我你您这那其而但因所为等从以被]/;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const headerMatch = l.match(/^([^\s【\[（(，,、—]{2,6})\s*(?:（[^）)]*[）)])?\s*(?:——|—)/);
    if (headerMatch && !PARTICLE_RE.test(headerMatch[1])) headerIndexes.push(i);
  }
  // 若没有「——」格式的header，尝试老格式（名字单独一行，≤5字，不含虚词）
  if (headerIndexes.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l || l.length > 5 || PARTICLE_RE.test(l)) continue;
      if (/[【\[，,、—。？！：:（(]/.test(l)) continue;  // 含标点/括号则非名字行
      if (/[的地得了着过是有被把与和或]/.test(l)) continue; // 含助词则非名字
      headerIndexes.push(i);
    }
    if (headerIndexes.length === 0) return results;  // 实在解析不出来，返回空
  }
  for (let hi = 0; hi < headerIndexes.length; hi++) {
    const startIdx = headerIndexes[hi];
    const endIdx = hi + 1 < headerIndexes.length ? headerIndexes[hi + 1] : lines.length;
    const firstLine = lines[startIdx].trim();
    // 支持两种格式：「名字——描述」或「名字（单独一行）」
    const headerMatch = firstLine.match(/^([^\s【\[（(，,、—]{2,6})\s*(?:（[^）)]*[）)])?\s*(?:——|—)/)
      || firstLine.match(/^([^\s【\[（(，,、—。？！：:]{2,5})$/);
    if (!headerMatch) continue;
    const name = headerMatch[1].trim();
    if (!name || name.length > 6) continue;
    const header = parseCharacterHeader(firstLine);
    const firstLineRest = header ? header.rest : '';
    const rest = [firstLineRest, ...lines.slice(startIdx + 1, endIdx).map(line => line.trim())]
      .filter(Boolean)
      .join('\n');
    const details = parseCharacterDetails(rest);
    results.push({
      name,
      role: defaultRole,
      gender: details.gender || null,
      description: details.description,
      personality: details.personality,
      appearance: details.appearance,
      background: details.background,
    });
  }
  return results;
}

/**
 * 解析带序号的列表文本
 * 格式："1. 标题\n描述\n\n2. 标题\n描述"
 */
function parseNumberedList(text: string): { title: string; description: string; significance: string | null }[] {
  const results: { title: string; description: string; significance: string | null }[] = [];
  const blocks = text.split(/(?=\d+\.\s)/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const withoutNumber = trimmed.replace(/^\d+\.\s*/, '');
    const lines = withoutNumber.split('\n').map((l: string) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const title = lines[0];
    let significance: string | null = null;
    const descLines: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const standaloneSignificance = getStandaloneItemSignificance(lines[i]);
      if (standaloneSignificance) {
        significance = standaloneSignificance;
        continue;
      }

      const itemParts = splitItemDescriptionSignificance(lines[i], significance || '');
      if (itemParts.description !== lines[i]) {
        if (itemParts.description) descLines.push(itemParts.description);
        significance = itemParts.significance || null;
        continue;
      }

      descLines.push(lines[i]);
    }
    const description = descLines.join('\n');
    if (title) results.push({ title, description, significance });
  }
  return results;
}

/**
 * 解析场景列表，提取 atmosphere 字段
 * 格式："1. 地点名称\n地点描述（50-100字）\n氛围：xxx\n\n2. ..."
 */
function parseSceneList(text: string): { title: string; description: string; atmosphere: string | null }[] {
  const results: { title: string; description: string; atmosphere: string | null }[] = [];
  const blocks = text.split(/(?=\d+\.\s)/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const withoutNumber = trimmed.replace(/^\d+\.\s*/, '');
    const lines = withoutNumber.split('\n').map((l: string) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const title = lines[0];
    let atmosphere: string | null = null;
    const descLines: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const standaloneAtmosphere = getStandaloneSceneAtmosphere(lines[i]);
      if (standaloneAtmosphere) {
        atmosphere = standaloneAtmosphere;
        continue;
      }

      const sceneParts = splitSceneDescriptionAtmosphere(lines[i], atmosphere || '');
      if (sceneParts.description !== lines[i]) {
        if (sceneParts.description) descLines.push(sceneParts.description);
        atmosphere = sceneParts.atmosphere || null;
        continue;
      }

      descLines.push(lines[i]);
    }
    const description = descLines.join('\n');
    if (title) results.push({ title, description, atmosphere });
  }
  return results;
}
