import { sqlite } from './sqlite';

export interface SkillVersionRecord {
  id: string;
  skillId: string;
  version: number;
  systemPrompt: string | null;
  userPrompt: string | null;
  note: string | null;
  source: string;
  status: string;
  createdAt: string;
}

export interface SkillUsageRecord {
  id: string;
  skillId: string;
  stage: string;
  promptCode: string | null;
  refId: string | null;
  createdAt: string;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let tablesReady = false;

function ensureTables(): void {
  if (tablesReady) return;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS skill_versions (
      id TEXT PRIMARY KEY NOT NULL,
      skill_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      system_prompt TEXT,
      user_prompt TEXT,
      note TEXT,
      source TEXT DEFAULT 'manual',
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE INDEX IF NOT EXISTS skill_versions_skill_idx ON skill_versions (skill_id);
    CREATE TABLE IF NOT EXISTS skill_usage (
      id TEXT PRIMARY KEY NOT NULL,
      skill_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      prompt_code TEXT,
      ref_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE INDEX IF NOT EXISTS skill_usage_skill_idx ON skill_usage (skill_id);
    CREATE INDEX IF NOT EXISTS skill_usage_stage_idx ON skill_usage (stage);
  `);
  tablesReady = true;
}

function mapVersion(row: any): SkillVersionRecord {
  return {
    id: row.id,
    skillId: row.skill_id,
    version: row.version,
    systemPrompt: row.system_prompt,
    userPrompt: row.user_prompt,
    note: row.note,
    source: row.source || 'manual',
    status: row.status || 'draft',
    createdAt: row.created_at,
  };
}

export const skillLearningManager = {
  async recordUsage(input: { skillId: string; stage: string; promptCode?: string | null; refId?: string | null }): Promise<void> {
    ensureTables();
    if (!input.skillId || !input.stage) return;
    sqlite.prepare(
      'INSERT INTO skill_usage (id, skill_id, stage, prompt_code, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(generateUUID(), input.skillId, input.stage, input.promptCode ?? null, input.refId ?? null, new Date().toISOString());
  },

  async usageCount(skillId: string): Promise<number> {
    ensureTables();
    const row: any = sqlite.prepare('SELECT COUNT(*) AS n FROM skill_usage WHERE skill_id = ?').get(skillId);
    return row?.n ?? 0;
  },

  async usageSummary(): Promise<Record<string, { count: number; lastUsedAt: string | null }>> {
    ensureTables();
    const rows: any[] = sqlite.prepare(
      'SELECT skill_id, COUNT(*) AS n, MAX(created_at) AS last FROM skill_usage GROUP BY skill_id'
    ).all();
    const out: Record<string, { count: number; lastUsedAt: string | null }> = {};
    for (const row of rows) out[row.skill_id] = { count: row.n ?? 0, lastUsedAt: row.last ?? null };
    return out;
  },

  async recentUsage(skillId: string, limit = 20): Promise<SkillUsageRecord[]> {
    ensureTables();
    return sqlite.prepare(
      'SELECT * FROM skill_usage WHERE skill_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(skillId, limit).map((row: any) => ({
      id: row.id,
      skillId: row.skill_id,
      stage: row.stage,
      promptCode: row.prompt_code,
      refId: row.ref_id,
      createdAt: row.created_at,
    }));
  },

  async createVersion(input: {
    skillId: string;
    systemPrompt: string | null;
    userPrompt: string | null;
    note?: string | null;
    source?: string;
    status?: string;
  }): Promise<SkillVersionRecord> {
    ensureTables();
    const now = new Date().toISOString();
    const row: any = sqlite.prepare('SELECT MAX(version) AS v FROM skill_versions WHERE skill_id = ?').get(input.skillId);
    const version = (row?.v ?? 0) + 1;
    const id = generateUUID();
    sqlite.prepare(
      'INSERT INTO skill_versions (id, skill_id, version, system_prompt, user_prompt, note, source, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, input.skillId, version, input.systemPrompt ?? null, input.userPrompt ?? null,
      input.note ?? null, input.source ?? 'manual', input.status ?? 'draft', now);
    return {
      id, skillId: input.skillId, version,
      systemPrompt: input.systemPrompt ?? null, userPrompt: input.userPrompt ?? null,
      note: input.note ?? null, source: input.source ?? 'manual', status: input.status ?? 'draft', createdAt: now,
    };
  },

  async listVersions(skillId: string): Promise<SkillVersionRecord[]> {
    ensureTables();
    return sqlite.prepare('SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY version DESC').all(skillId).map(mapVersion);
  },

  async getVersion(id: string): Promise<SkillVersionRecord | null> {
    ensureTables();
    const row = sqlite.prepare('SELECT * FROM skill_versions WHERE id = ?').get(id);
    return row ? mapVersion(row) : null;
  },

  async activateVersion(id: string): Promise<SkillVersionRecord | null> {
    ensureTables();
    const version = await this.getVersion(id);
    if (!version) return null;
    sqlite.prepare("UPDATE skill_versions SET status = 'archived' WHERE skill_id = ?").run(version.skillId);
    sqlite.prepare("UPDATE skill_versions SET status = 'active' WHERE id = ?").run(id);
    return version;
  },

  async versionCount(skillId: string): Promise<number> {
    ensureTables();
    const row: any = sqlite.prepare('SELECT COUNT(*) AS n FROM skill_versions WHERE skill_id = ?').get(skillId);
    return row?.n ?? 0;
  },
};
