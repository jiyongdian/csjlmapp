import { db } from './sqlite';
import { stylePrompts, type StylePrompt } from './shared/schema';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DEFAULT_STYLE_PROMPTS } from './shared/stylePromptsSeed';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 风格类型：与风格设置弹窗的 5 种一一对应 */
export const STYLE_PROMPT_KINDS = ['character', 'scene', 'item', 'image-storyboard', 'video-storyboard'] as const;
export type StylePromptKind = (typeof STYLE_PROMPT_KINDS)[number];

/** 内置预置提示词所属的分类；自定义分类由用户自己起名 */
export const DEFAULT_STYLE_PROMPT_CATEGORY = '风格';
export const MAX_STYLE_PROMPT_CATEGORY = 20;

export function normalizeStylePromptKind(raw: unknown): StylePromptKind | null {
  const text = String(raw ?? '').trim().toLowerCase();
  return (STYLE_PROMPT_KINDS as readonly string[]).includes(text) ? (text as StylePromptKind) : null;
}

/** 分类名统一处理：去空白、限长，空值回落到「风格」 */
export function normalizeStylePromptCategory(raw: unknown): string {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return DEFAULT_STYLE_PROMPT_CATEGORY;
  return Array.from(text).slice(0, MAX_STYLE_PROMPT_CATEGORY).join('');
}

/** 同进程内去重，避免首屏并发请求把预置数据插两遍 */
const seedDone = new Set<string>();
const seedInFlight = new Map<string, Promise<void>>();

/**
 * 风格提示词库管理。
 *
 * user_id 为空 = 管理员级（所有用户都可用）；非空 = 该用户私有。
 * 每个「风格类型」各自一套库；库内再按 category 分类，内置预置属于「风格」。
 */
export const stylePromptManager = {
  /** 某个类型下该用户可见的全部提示词：管理员级 + 自己私有的 */
  async list(kind: StylePromptKind, userId: string | null): Promise<StylePrompt[]> {
    await this.ensureDefaults(kind);
    const rows = await db.select().from(stylePrompts).where(eq(stylePrompts.kind, kind)).orderBy(asc(stylePrompts.sortOrder), asc(stylePrompts.createdAt));
    return rows.filter((row) => row.userId === null || (userId !== null && row.userId === userId));
  },

  async getById(id: string): Promise<StylePrompt | null> {
    const rows = await db.select().from(stylePrompts).where(eq(stylePrompts.id, id)).limit(1);
    return rows[0] || null;
  },

  async create(input: {
    userId: string | null;
    kind: StylePromptKind;
    name: string;
    prompt: string;
    category?: string | null;
    thumbnail?: string | null;
  }): Promise<StylePrompt> {
    const siblings = await db
      .select()
      .from(stylePrompts)
      .where(input.userId === null ? and(eq(stylePrompts.kind, input.kind), isNull(stylePrompts.userId)) : and(eq(stylePrompts.kind, input.kind), eq(stylePrompts.userId, input.userId)));
    const inserted = await db
      .insert(stylePrompts)
      .values({
        id: generateUUID(),
        userId: input.userId,
        kind: input.kind,
        category: normalizeStylePromptCategory(input.category),
        name: input.name,
        prompt: input.prompt,
        thumbnail: input.thumbnail ?? null,
        sortOrder: siblings.length,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      })
      .returning();
    return inserted[0];
  },

  async updateById(id: string, patch: { name?: string; prompt?: string; category?: string; thumbnail?: string | null }): Promise<StylePrompt | null> {
    const values: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.prompt !== undefined) values.prompt = patch.prompt;
    if (patch.category !== undefined) values.category = normalizeStylePromptCategory(patch.category);
    if (patch.thumbnail !== undefined) values.thumbnail = patch.thumbnail || null;
    const updated = await db.update(stylePrompts).set(values).where(eq(stylePrompts.id, id)).returning();
    return updated[0] || null;
  },

  async removeById(id: string): Promise<StylePrompt | null> {
    const removed = await db.delete(stylePrompts).where(eq(stylePrompts.id, id)).returning();
    return removed[0] || null;
  },

  /**
   * 首次访问某个类型时，把内置的 14 条风格写入为「管理员级」提示词（分类：风格）。
   * 只在一条都没有的时候写。
   */
  async ensureDefaults(kind: StylePromptKind): Promise<void> {
    if (seedDone.has(kind)) return;
    const running = seedInFlight.get(kind);
    if (running) return running;
    const task = (async () => {
      try {
        const existing = await db
          .select()
          .from(stylePrompts)
          .where(and(eq(stylePrompts.kind, kind), isNull(stylePrompts.userId)))
          .limit(1);
        if (existing.length > 0) {
          seedDone.add(kind);
          return;
        }
        const now = new Date().toISOString();
        for (let i = 0; i < DEFAULT_STYLE_PROMPTS.length; i++) {
          const item = DEFAULT_STYLE_PROMPTS[i];
          await db.insert(stylePrompts).values({
            id: generateUUID(),
            userId: null,
            kind,
            category: DEFAULT_STYLE_PROMPT_CATEGORY,
            name: item.name,
            prompt: item.prompt,
            thumbnail: null,
            sortOrder: i,
            createdAt: now,
            updatedAt: null,
          });
        }
        seedDone.add(kind);
        console.log(`[StylePrompts] 已写入 ${DEFAULT_STYLE_PROMPTS.length} 条「${kind}」风格预设（分类：${DEFAULT_STYLE_PROMPT_CATEGORY}）`);
      } catch (error) {
        console.error('[StylePrompts] 写入风格预设失败:', error);
      } finally {
        seedInFlight.delete(kind);
      }
    })();
    seedInFlight.set(kind, task);
    return task;
  },
};
