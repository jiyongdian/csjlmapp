import { db } from './sqlite';
import { extractTemplates, type ExtractTemplate } from './shared/schema';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { ExtractKind } from '../../lib/extract-template';
import { DEFAULT_EXTRACT_TEMPLATES } from './shared/extractTemplatesSeed';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export type ExtractTemplateSource = 'drama' | 'user' | 'system' | 'none';

export type ResolvedExtractTemplate = {
  kind: ExtractKind;
  template: string;
  name: string;
  source: ExtractTemplateSource;
  id: string | null;
};

/**
 * 资产提取模版管理（角色 / 场景 / 物品）
 *
 * 命中优先级：作品级(userId+dramaId) > 用户级(userId) > 系统默认(userId 为空)
 */
export const extractTemplateManager = {
  /** 查询某用户/作品下某个类型的全部模版（系统 + 用户 + 作品），供编辑弹窗展示 */
  async list(kind: ExtractKind, opts: { userId?: string | null; dramaId?: string | null } = {}): Promise<ExtractTemplate[]> {
    const rows = await db
      .select()
      .from(extractTemplates)
      .where(eq(extractTemplates.kind, kind))
      .orderBy(asc(extractTemplates.userId), asc(extractTemplates.dramaId), asc(extractTemplates.sortOrder));
    const userId = opts.userId || null;
    const dramaId = opts.dramaId || null;
    return rows.filter((row) => {
      if (row.userId === null) return true; // 系统默认
      if (userId === null || row.userId !== userId) return false;
      if (row.dramaId === null) return true; // 该用户通用
      return dramaId !== null && row.dramaId === dramaId;
    });
  },

  /** 某个层级下的全部模版（dramaId 为空即账号级），用于模版库列表 */
  async listScope(
    kind: ExtractKind,
    opts: { userId: string | null; dramaId?: string | null },
  ): Promise<ExtractTemplate[]> {
    const dramaId = opts.dramaId || null;
    return db
      .select()
      .from(extractTemplates)
      .where(
        and(
          opts.userId === null ? isNull(extractTemplates.userId) : eq(extractTemplates.userId, opts.userId),
          dramaId === null ? isNull(extractTemplates.dramaId) : eq(extractTemplates.dramaId, dramaId),
          eq(extractTemplates.kind, kind),
        ),
      )
      .orderBy(asc(extractTemplates.sortOrder), asc(extractTemplates.createdAt));
  },

  /** 按 id 取单条 */
  async getById(id: string): Promise<ExtractTemplate | null> {
    const rows = await db.select().from(extractTemplates).where(eq(extractTemplates.id, id)).limit(1);
    return rows[0] || null;
  },

  /** 在某个层级新建一条模版（不覆盖同层已有模版） */
  async create(input: {
    userId: string;
    dramaId?: string | null;
    kind: ExtractKind;
    name?: string | null;
    template: string;
    makeActive?: boolean;
  }): Promise<ExtractTemplate> {
    const dramaId = input.dramaId || null;
    const name = (input.name || '').trim() || (dramaId ? '本作品模版' : '我的模版');
    const siblings = await this.listScope(input.kind, { userId: input.userId, dramaId });
    const makeActive = input.makeActive !== false;
    if (makeActive) {
      await db
        .update(extractTemplates)
        .set({ isActive: 0 })
        .where(
          and(
            eq(extractTemplates.userId, input.userId),
            dramaId === null ? isNull(extractTemplates.dramaId) : eq(extractTemplates.dramaId, dramaId),
            eq(extractTemplates.kind, input.kind),
          ),
        );
    }
    const inserted = await db
      .insert(extractTemplates)
      .values({
        id: generateUUID(),
        userId: input.userId,
        dramaId,
        kind: input.kind,
        name,
        template: input.template,
        isActive: makeActive ? 1 : 0,
        sortOrder: siblings.length,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      })
      .returning();
    return inserted[0];
  },

  /** 按 id 更新某条模版的内容 / 名称（层级归属不变） */
  async updateById(id: string, patch: { name?: string | null; template?: string }): Promise<ExtractTemplate | null> {
    const values: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (patch.name !== undefined) values.name = String(patch.name || '').trim() || '未命名模版';
    if (patch.template !== undefined) values.template = patch.template;
    const updated = await db.update(extractTemplates).set(values).where(eq(extractTemplates.id, id)).returning();
    return updated[0] || null;
  },

  /** 把某条设为其层级「当前使用」，同层其它置为非使用 */
  async setActive(id: string): Promise<ExtractTemplate | null> {
    const row = await this.getById(id);
    if (!row) return null;
    await db
      .update(extractTemplates)
      .set({ isActive: 0 })
      .where(
        and(
          row.userId === null ? isNull(extractTemplates.userId) : eq(extractTemplates.userId, row.userId),
          row.dramaId === null ? isNull(extractTemplates.dramaId) : eq(extractTemplates.dramaId, row.dramaId),
          eq(extractTemplates.kind, row.kind),
        ),
      );
    const updated = await db
      .update(extractTemplates)
      .set({ isActive: 1, updatedAt: new Date().toISOString() })
      .where(eq(extractTemplates.id, id))
      .returning();
    return updated[0] || null;
  },

  /**
   * 让某个层级「不再覆盖上一层」：把该层全部模版置为非使用，但**保留模版本身**。
   * 恢复默认时用它替代删除，避免把用户新建的模版一起清掉。
   */
  async deactivate(
    kind: ExtractKind,
    opts: { userId: string; dramaId?: string | null; level?: 'user' | 'drama' | 'both' },
  ): Promise<number> {
    const level = opts.level || 'both';
    const now = new Date().toISOString();
    let count = 0;
    const clearScope = async (dramaId: string | null) => {
      const updated = await db
        .update(extractTemplates)
        .set({ isActive: 0, updatedAt: now })
        .where(
          and(
            eq(extractTemplates.userId, opts.userId),
            dramaId === null ? isNull(extractTemplates.dramaId) : eq(extractTemplates.dramaId, dramaId),
            eq(extractTemplates.kind, kind),
          ),
        )
        .returning();
      count += updated.length;
    };
    if (level === 'user' || level === 'both') await clearScope(null);
    if ((level === 'drama' || level === 'both') && opts.dramaId) await clearScope(opts.dramaId);
    return count;
  },

  /** 作品被删除时，清掉挂在该作品下的模版，避免留下孤儿数据 */
  async deleteByDramaId(dramaId: string): Promise<number> {
    const removed = await db.delete(extractTemplates).where(eq(extractTemplates.dramaId, dramaId)).returning();
    return removed.length;
  },

  /** 删除一条模版；若删掉的是「当前使用」的，把同层剩下的一条顶上来 */
  async removeById(id: string): Promise<ExtractTemplate | null> {
    const removed = await db.delete(extractTemplates).where(eq(extractTemplates.id, id)).returning();
    const row = removed[0] || null;
    if (row && row.isActive === 1) {
      const siblings = await this.listScope(row.kind as ExtractKind, { userId: row.userId, dramaId: row.dramaId });
      if (siblings[0]) await this.setActive(siblings[0].id);
    }
    return row;
  },

  /** 按优先级解析最终生效的模版 */
  async resolve(
    kind: ExtractKind,
    opts: { userId?: string | null; dramaId?: string | null },
  ): Promise<ResolvedExtractTemplate | null> {
    const userId = opts.userId || null;
    const dramaId = opts.dramaId || null;

    const pick = async (where: any) => {
      const rows = await db
        .select()
        .from(extractTemplates)
        .where(where)
        .orderBy(asc(extractTemplates.sortOrder))
        .limit(1);
      return rows[0] || null;
    };

    let row: ExtractTemplate | null = null;
    let source: ExtractTemplateSource = 'none';

    if (userId && dramaId) {
      row = await pick(and(eq(extractTemplates.userId, userId), eq(extractTemplates.dramaId, dramaId), eq(extractTemplates.kind, kind), eq(extractTemplates.isActive, 1)));
      if (row) source = 'drama';
    }
    if (!row && userId) {
      row = await pick(and(eq(extractTemplates.userId, userId), isNull(extractTemplates.dramaId), eq(extractTemplates.kind, kind), eq(extractTemplates.isActive, 1)));
      if (row) source = 'user';
    }
    if (!row) {
      row = await pick(and(isNull(extractTemplates.userId), isNull(extractTemplates.dramaId), eq(extractTemplates.kind, kind), eq(extractTemplates.isActive, 1)));
      if (row) source = 'system';
    }

    if (!row) return null;
    return { kind, template: row.template, name: row.name, source, id: row.id };
  },

  /**
   * 保存模版。按「归属层级」决定写入位置：
   * - userId === null → 系统默认层（所有用户共用，仅管理员可写）
   * - dramaId 有值    → 作品级
   * - 其余            → 用户级通用
   */
  async upsert(input: {
    userId: string | null;
    dramaId?: string | null;
    kind: ExtractKind;
    name?: string | null;
    template: string;
  }): Promise<ExtractTemplate> {
    const dramaId = input.userId === null ? null : input.dramaId || null;
    const defaultName = input.userId === null ? '系统默认模版' : dramaId ? '本作品提取模版' : '我的提取模版';
    const name = (input.name || '').trim() || defaultName;
    const existing = await db
      .select()
      .from(extractTemplates)
      .where(
        and(
          input.userId === null ? isNull(extractTemplates.userId) : eq(extractTemplates.userId, input.userId),
          dramaId === null ? isNull(extractTemplates.dramaId) : eq(extractTemplates.dramaId, dramaId),
          eq(extractTemplates.kind, input.kind),
        ),
      )
      .limit(1);

    if (existing[0]) {
      const updated = await db
        .update(extractTemplates)
        .set({ name, template: input.template, isActive: 1, updatedAt: new Date().toISOString() })
        .where(eq(extractTemplates.id, existing[0].id))
        .returning();
      return updated[0];
    }

    const inserted = await db
      .insert(extractTemplates)
      .values({
        id: generateUUID(),
        userId: input.userId,
        dramaId,
        kind: input.kind,
        name,
        template: input.template,
        isActive: 1,
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      })
      .returning();
    return inserted[0];
  },

  /**
   * 恢复默认：删除该用户 / 作品下该类型的自定义模版，回落到上一层。
   * - level='user'  仅清用户级通用模版
   * - level='drama' 仅清作品级模版（需 dramaId）
   * - 不传（both）  用户级 + 作品级一起清，彻底回落到系统默认
   */
  async reset(
    kind: ExtractKind,
    opts: { userId: string; dramaId?: string | null; level?: 'user' | 'drama' | 'both' },
  ): Promise<number> {
    const dramaId = opts.dramaId || null;
    const level = opts.level || 'both';
    const scopes: any[] = [];
    if (level === 'user' || level === 'both') {
      scopes.push(and(
        eq(extractTemplates.userId, opts.userId),
        isNull(extractTemplates.dramaId),
        eq(extractTemplates.kind, kind),
      ));
    }
    if ((level === 'drama' || level === 'both') && dramaId) {
      scopes.push(and(
        eq(extractTemplates.userId, opts.userId),
        eq(extractTemplates.dramaId, dramaId),
        eq(extractTemplates.kind, kind),
      ));
    }
    if (scopes.length === 0) return 0;
    const where = scopes.length === 1 ? scopes[0] : or(...scopes);
    const removed = await db.delete(extractTemplates).where(where).returning();
    return removed.length;
  },

  /**
   * 把系统默认模版恢复成「内置出厂内容」。
   * 系统层没有上一层可回落，所以这里是覆盖写回种子内容，而不是删除。
   */
  async restoreSystemDefault(kind: ExtractKind): Promise<ExtractTemplate | null> {
    const fallback = DEFAULT_EXTRACT_TEMPLATES.find((item) => item.kind === kind);
    if (!fallback) return null;
    const existing = await db
      .select()
      .from(extractTemplates)
      .where(and(isNull(extractTemplates.userId), isNull(extractTemplates.dramaId), eq(extractTemplates.kind, kind)))
      .limit(1);
    if (existing[0]) {
      const updated = await db
        .update(extractTemplates)
        .set({ name: fallback.name, template: fallback.template, isActive: 1, updatedAt: new Date().toISOString() })
        .where(eq(extractTemplates.id, existing[0].id))
        .returning();
      return updated[0];
    }
    const inserted = await db
      .insert(extractTemplates)
      .values({
        id: generateUUID(),
        userId: null,
        dramaId: null,
        kind,
        name: fallback.name,
        template: fallback.template,
        isActive: 1,
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      })
      .returning();
    return inserted[0];
  },
};
