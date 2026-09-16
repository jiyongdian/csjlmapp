import { sqlite } from './sqlite';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export type SkillCategory = 'writing' | 'style' | 'plot' | 'character' | 'dialogue' | 'novel' | 'script' | 'image-prompt' | 'video-prompt';

export interface SkillInput {
  userId: string;
  name: string;
  description?: string;
  category?: SkillCategory;
  systemPrompt?: string;
  userPrompt?: string;
  parameters?: Record<string, any>;
  isDefault?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export interface SkillRecord {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  category: SkillCategory;
  systemPrompt: string | null;
  userPrompt: string | null;
  parameters: any;
  isDefault: number;
  isActive: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string | null;
}

function mapRow(row: any): SkillRecord {
  let params: any = null;
  if (row.parameters && typeof row.parameters === 'string') {
    try { params = JSON.parse(row.parameters); } catch { params = row.parameters; }
  }
  return {
    id: row.id, userId: row.user_id, name: row.name, description: row.description,
    category: row.category, systemPrompt: row.system_prompt, userPrompt: row.user_prompt,
    parameters: params, isDefault: row.is_default, isActive: row.is_active,
    sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export const skillManager = {
  async create(input: SkillInput): Promise<SkillRecord> {
    const now = new Date().toISOString();
    const id = generateUUID();
    sqlite.prepare(
      `INSERT INTO skills (id, user_id, name, description, category, system_prompt, user_prompt, parameters, is_default, is_active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.userId, input.name, input.description ?? null, input.category ?? 'writing',
      input.systemPrompt ?? null, input.userPrompt ?? null,
      input.parameters ? JSON.stringify(input.parameters) : null,
      input.isDefault ? 1 : 0, input.isActive !== false ? 1 : 0, input.sortOrder ?? 0, now, now);
    return this.getById(id) as Promise<SkillRecord>;
  },

  async listAllByUser(userId: string): Promise<SkillRecord[]> {
    if (!userId) return [];
    return sqlite.prepare('SELECT * FROM skills WHERE user_id = ? ORDER BY sort_order ASC, name ASC').all(userId).map(mapRow);
  },

  async getById(id: string): Promise<SkillRecord | null> {
    const row = sqlite.prepare('SELECT * FROM skills WHERE id = ?').get(id);
    return row ? mapRow(row) : null;
  },

  async listByUser(userId: string, opts?: { category?: SkillCategory }): Promise<SkillRecord[]> {
    if (!userId) return [];
    let sql = 'SELECT * FROM skills WHERE user_id = ? AND is_active = 1';
    const params: any[] = [userId];
    if (opts?.category) { sql += ' AND category = ?'; params.push(opts.category); }
    sql += ' ORDER BY sort_order ASC, name ASC';
    return sqlite.prepare(sql).all(...params).map(mapRow);
  },

  async get(id: string, userId: string): Promise<SkillRecord | null> {
    if (!id || !userId) return null;
    const row = sqlite.prepare('SELECT * FROM skills WHERE id = ? AND user_id = ?').get(id, userId);
    return row ? mapRow(row) : null;
  },

  async update(id: string, userId: string, data: Partial<SkillInput>): Promise<SkillRecord | null> {
    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const params: any[] = [now];
    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.category !== undefined) { sets.push('category = ?'); params.push(data.category); }
    if (data.systemPrompt !== undefined) { sets.push('system_prompt = ?'); params.push(data.systemPrompt); }
    if (data.userPrompt !== undefined) { sets.push('user_prompt = ?'); params.push(data.userPrompt); }
    if (data.parameters !== undefined) { sets.push('parameters = ?'); params.push(data.parameters ? JSON.stringify(data.parameters) : null); }
    if (data.isActive !== undefined) { sets.push('is_active = ?'); params.push(data.isActive ? 1 : 0); }
    if (data.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(data.sortOrder); }
    params.push(id, userId);
    sqlite.prepare(`UPDATE skills SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
    return this.getById(id);
  },

  async delete(id: string, userId: string): Promise<boolean> {
    sqlite.prepare('DELETE FROM skills WHERE id = ? AND user_id = ?').run(id, userId);
    return true;
  },

  applySkill(skill: any, baseSystemPrompt: string): string {
    if (!skill) return baseSystemPrompt;
    return skill.systemPrompt ? skill.systemPrompt + '\n\n' + baseSystemPrompt : baseSystemPrompt;
  },

  /**
   * 根据小说配置、创意、结构自动匹配最佳技能
   * @param userId 用户ID
   * @param context 匹配上下文
   * @returns 匹配到的技能，无匹配返回 null
   */
  async autoMatchSkill(userId: string, context: {
    novelCategory?: string;
    tones?: string[];
    genderTarget?: string;
    narrativePerspective?: string;
    idea?: { theme?: string; concept?: string; characters?: string; setting?: string; supportingCharacters?: string; characterRelationships?: string };
    structure?: { mainPlot?: string; chapterOutline?: string; keyConflicts?: string; keyScenes?: string; keyItems?: string; characterSoulField?: string };
  }): Promise<SkillRecord | null> {
    if (!userId) return null;
    const skills = await this.listByUser(userId);
    if (skills.length === 0) return null;

    // 构建匹配文本：把小说配置、创意、结构拼成可搜索文本
    const contextText = [
      context.novelCategory,
      ...(context.tones || []),
      context.genderTarget,
      context.narrativePerspective,
      context.idea?.theme, context.idea?.concept, context.idea?.characters,
      context.idea?.setting, context.idea?.supportingCharacters, context.idea?.characterRelationships,
      context.structure?.mainPlot, context.structure?.chapterOutline,
      context.structure?.keyConflicts, context.structure?.keyScenes,
      context.structure?.keyItems, context.structure?.characterSoulField,
    ].filter(Boolean).join(' ').toLowerCase();

    if (!contextText.trim()) return skills[0] || null;

    // 定义题材→技能分类的偏好映射
    const categoryPreference: Record<string, SkillCategory[]> = {
      // 奇幻玄幻 → 剧情+角色+风格
      fantasy: ['plot', 'character', 'style'], xianxia: ['plot', 'style', 'character'],
      wuxia: ['plot', 'style', 'dialogue'], 'eastern-fantasy': ['plot', 'character', 'style'],
      'western-fantasy': ['plot', 'style', 'character'], 'high-fantasy': ['plot', 'style', 'character'],
      // 都市现实 → 角色+对话+写作
      urban: ['character', 'dialogue', 'writing'], historical: ['plot', 'style', 'character'],
      campus: ['character', 'dialogue', 'style'], business: ['plot', 'dialogue', 'character'],
      sports: ['plot', 'style', 'writing'], 'slice-of-life': ['character', 'style', 'dialogue'],
      'social-issues': ['plot', 'character', 'writing'],
      // 科幻悬疑 → 剧情+风格+写作
      'sci-fi': ['plot', 'style', 'writing'], cyberpunk: ['style', 'plot', 'writing'],
      'space-opera': ['plot', 'style', 'character'], mystery: ['plot', 'style', 'writing'],
      thriller: ['plot', 'style', 'writing'], horror: ['style', 'plot', 'character'],
      'post-apocalyptic': ['plot', 'style', 'character'],
      // 冒险异能 → 剧情+角色+风格
      adventure: ['plot', 'character', 'style'], 'time-travel': ['plot', 'character', 'style'],
      rebirth: ['plot', 'character', 'dialogue'], transmigration: ['plot', 'character', 'style'],
      system: ['plot', 'writing', 'character'], game: ['plot', 'character', 'style'],
      apocalyptic: ['plot', 'style', 'character'],
      // 情感言情 → 角色+对话+风格
      romance: ['character', 'dialogue', 'style'], 'sweet-romance': ['character', 'dialogue', 'style'],
      drama: ['character', 'dialogue', 'plot'], 'ancient-romance': ['style', 'character', 'dialogue'],
      'modern-romance': ['character', 'dialogue', 'style'], 'love-triangle': ['character', 'dialogue', 'plot'],
      // 军事战争 → 剧情+风格+写作
      military: ['plot', 'style', 'writing'], war: ['plot', 'style', 'writing'],
      'special-forces': ['plot', 'character', 'style'], 'anti-espionage': ['plot', 'style', 'writing'],
      survival: ['plot', 'character', 'style'],
    };

    // 定义语气→技能分类的偏好映射
    const toneCategoryBoost: Record<string, SkillCategory[]> = {
      light: ['dialogue', 'writing', 'style'], serious: ['plot', 'writing', 'style'],
      epic: ['style', 'plot', 'character'], romantic: ['character', 'dialogue', 'style'],
      dark: ['style', 'plot', 'character'], mysterious: ['style', 'plot', 'writing'],
      suspense: ['plot', 'style', 'writing'], thriller: ['style', 'plot', 'character'],
      intense: ['plot', 'character', 'style'], philosophical: ['writing', 'plot', 'style'],
      satirical: ['writing', 'dialogue', 'style'], tragic: ['character', 'plot', 'style'],
      inspiring: ['character', 'plot', 'style'], lyrical: ['style', 'writing', 'character'],
      ironic: ['writing', 'dialogue', 'style'], warm: ['character', 'style', 'dialogue'],
      cold: ['writing', 'plot', 'style'], witty: ['dialogue', 'writing', 'style'],
      melancholy: ['style', 'character', 'plot'], heroic: ['character', 'plot', 'style'],
    };

    const preferredCats = new Set<SkillCategory>();
    if (context.novelCategory && categoryPreference[context.novelCategory]) {
      categoryPreference[context.novelCategory].forEach(c => preferredCats.add(c));
    }
    (context.tones || []).forEach(t => {
      if (toneCategoryBoost[t]) toneCategoryBoost[t].forEach(c => preferredCats.add(c));
    });

    // 提取关键词工具：按标点切分，保留2字以上词
    const splitKeywords = (text: string): string[] =>
      [...new Set(text.split(/[\s,，。、；;：:！!？?（）()【】\[\]"'""''「」『』\-—…]+/).filter(w => w.length >= 2))];

    const contextKeywords = splitKeywords(contextText);

    // 为每个技能打分
    const scored = skills.map(skill => {
      let score = 0;
      const skillText = [skill.name, skill.description, skill.systemPrompt].filter(Boolean).join(' ').toLowerCase();
      const skillKeywords = splitKeywords(skillText);

      // 1. 双向关键词匹配：上下文→技能 + 技能→上下文
      let matchCount = 0;
      for (const kw of contextKeywords) {
        if (skillText.includes(kw)) matchCount++;
      }
      for (const kw of skillKeywords) {
        if (contextText.includes(kw)) matchCount++;
      }
      score += matchCount * 3;

      // 2. 技能分类偏好加分
      if (preferredCats.has(skill.category)) score += 5;

      // 3. 默认技能加分
      if (skill.isDefault) score += 2;

      // 4. 排序优先级
      score += Math.max(0, 10 - skill.sortOrder) * 0.1;

      return { skill, score };
    });

    // 按分数排序，取最高分
    scored.sort((a, b) => b.score - a.score);

    if (scored[0].score > 0) {
      console.log('[Skill][AutoMatch] 匹配到技能: ' + scored[0].skill.name + ' (分数=' + scored[0].score.toFixed(1) + ')');
      return scored[0].skill;
    }

    // 无关键词匹配时，返回分类偏好的第一个技能
    const prefSkill = skills.find(s => preferredCats.has(s.category));
    if (prefSkill) {
      console.log('[Skill][AutoMatch] 按分类偏好匹配: ' + prefSkill.name);
      return prefSkill;
    }

    console.log('[Skill][AutoMatch] 无匹配，使用第一个技能: ' + skills[0].name);
    return skills[0];
  },
};
