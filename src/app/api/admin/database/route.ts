import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getUserFromToken } from "@/lib/auth";
import { sqlite } from "@/storage/database/sqlite";
import { touchSectionSavedAt } from "@/lib/system-settings";

export const runtime = "nodejs";

function isAdmin(request: NextRequest): boolean {
  const payload = getUserFromToken(request.headers.get("Authorization") || "");
  return !!payload && payload.role === "admin";
}

function listTables(): string[] {
  const rows = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ success: false, error: "无权限" }, { status: 403 });
  }
  try {
    const tables = listTables().map((name) => {
      let count = 0;
      try {
        const row = sqlite.prepare("SELECT COUNT(*) AS c FROM " + quoteIdent(name)).get() as { c: number };
        count = Number(row && row.c) || 0;
      } catch {
        count = -1;
      }
      return { name, count };
    });
    const dbFile = String(process.env.DB_PATH || '').trim()
    ? (path.isAbsolute(process.env.DB_PATH || '') ? process.env.DB_PATH : path.join(process.cwd(), String(process.env.DB_PATH || '')))
    : path.join(process.cwd(), "novel.db");
    let size = 0;
    try {
      size = fs.statSync(dbFile).size;
    } catch {
      size = 0;
    }
    return NextResponse.json({
      success: true,
      data: {
        dbFile,
        size,
        totalTables: tables.length,
        totalRows: tables.reduce((sum, t) => sum + Math.max(0, t.count), 0),
        tables,
      },
    });
  } catch (error) {
    console.error("数据库概览失败:", error);
    return NextResponse.json({ success: false, error: "数据库概览失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ success: false, error: "无权限" }, { status: 403 });
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "");

    if (action === "export") {
      const schema: { name: string; sql: string }[] = [];
      const tables: Record<string, unknown[]> = {};
      for (const name of listTables()) {
        const row = sqlite
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(name) as { sql: string } | undefined;
        schema.push({ name, sql: row && row.sql ? row.sql : "" });
        tables[name] = sqlite.prepare("SELECT * FROM " + quoteIdent(name)).all() as unknown[];
      }
      return NextResponse.json({
        success: true,
        data: { version: 1, exportedAt: new Date().toISOString(), schema, tables },
      });
    }

    if (action === "import") {
      const backup = body.data as { tables?: Record<string, unknown[]> } | undefined;
      if (!backup || !backup.tables || typeof backup.tables !== "object") {
        return NextResponse.json({ success: false, error: "备份数据格式不正确" }, { status: 400 });
      }
      const valid = new Set(listTables());
      let restored = 0;
      const run = sqlite.transaction(() => {
        for (const name of Object.keys(backup.tables as Record<string, unknown[]>)) {
          if (!valid.has(name)) continue;
          sqlite.prepare("DELETE FROM " + quoteIdent(name)).run();
          const rows = (backup.tables as Record<string, unknown[]>)[name];
          if (!Array.isArray(rows)) continue;
          for (const row of rows) {
            if (!row || typeof row !== "object") continue;
            const cols = Object.keys(row as Record<string, unknown>);
            if (!cols.length) continue;
            const sql =
              "INSERT INTO " + quoteIdent(name) + " (" + cols.map(quoteIdent).join(", ") +
              ") VALUES (" + cols.map(() => "?").join(", ") + ")";
            sqlite.prepare(sql).run(cols.map((c) => (row as Record<string, unknown>)[c] as never));
            restored++;
          }
        }
      });
      run();
      await touchSectionSavedAt("database");
      return NextResponse.json({ success: true, data: { restored } });
    }

    if (action === "clear-table") {
      const name = String(body.table || "");
      if (!listTables().includes(name)) {
        return NextResponse.json({ success: false, error: "数据表不存在" }, { status: 400 });
      }
      sqlite.prepare("DELETE FROM " + quoteIdent(name)).run();
      await touchSectionSavedAt("database");
      return NextResponse.json({ success: true, data: { table: name } });
    }

    if (action === "clear-all") {
      if (String(body.confirm || "") !== "清空数据库") {
        return NextResponse.json({ success: false, error: "请输入确认文字「清空数据库」" }, { status: 400 });
      }
      const names = listTables();
      const run = sqlite.transaction(() => {
        for (const name of names) sqlite.prepare("DELETE FROM " + quoteIdent(name)).run();
      });
      run();
      await touchSectionSavedAt("database");
      return NextResponse.json({ success: true, data: { cleared: names.length } });
    }

    return NextResponse.json({ success: false, error: "未知操作" }, { status: 400 });
  } catch (error) {
    console.error("数据库操作失败:", error);
    const message = error instanceof Error ? error.message : "数据库操作失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
