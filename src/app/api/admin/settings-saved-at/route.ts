import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getUserFromToken } from "@/lib/auth";
import { getSystemSettings } from "@/lib/system-settings";
import { sqlite } from "@/storage/database/sqlite";

export const runtime = "nodejs";

interface SectionStamp {
  at: string | null;
  source: string;
}

/** 统一时间格式：SQLite 的 "YYYY-MM-DD HH:MM:SS"（UTC）转成 ISO，其余转换为 ISO */
function normalizeStamp(value: string | null): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return text.replace(" ", "T") + "Z";
  }
  const time = new Date(text);
  if (Number.isNaN(time.getTime())) return null;
  return time.toISOString();
}

function maxOf(table: string, expr: string, where?: string): string | null {
  try {
    const sql = 'SELECT MAX(' + expr + ') AS m FROM "' + table + '"' + (where ? ' WHERE ' + where : '');
    const row = sqlite.prepare(sql).get() as { m: string | null } | undefined;
    return normalizeStamp(row && row.m ? String(row.m) : null);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const payload = getUserFromToken(request.headers.get("Authorization") || "");
  if (!payload || payload.role !== "admin") {
    return NextResponse.json({ success: false, error: "无权限" }, { status: 403 });
  }
  try {
    const settings = await getSystemSettings();
    const stamp = (key: string): string | null => settings.sectionSavedAt[key] || null;

    let fileMtime: string | null = null;
    try {
      const file = path.join(process.cwd(), "storage", "system-settings.json");
      fileMtime = fs.statSync(file).mtime.toISOString();
    } catch {
      fileMtime = null;
    }

    const sections: Record<string, SectionStamp> = {
      // 站点设置由「站点设置」页整份写入，未记录分区时间时回退到设置文件修改时间
      site: { at: normalizeStamp(stamp("site") || fileMtime), source: "settings" },
      agents: { at: normalizeStamp(stamp("agents")), source: "settings" },
      memory: { at: normalizeStamp(stamp("memory")), source: "settings" },
      database: { at: normalizeStamp(stamp("database")), source: "operation" },
      files: { at: normalizeStamp(stamp("files")), source: "operation" },
      models: {
        at: maxOf("ai_configs", "COALESCE(updated_at, created_at)", "scope = 'system' AND model_type = 'text'"),
        source: "db",
      },
      media: {
        at: maxOf("ai_configs", "COALESCE(updated_at, created_at)", "scope = 'system' AND model_type IN ('image','video','tts')"),
        source: "db",
      },
      comfyui: { at: maxOf("comfy_workflows", "COALESCE(updated_at, created_at)"), source: "db" },
      prompts: { at: maxOf("model_prompts", "COALESCE(updated_at, created_at)"), source: "db" },
      skills: { at: maxOf("skills", "COALESCE(updated_at, created_at)"), source: "db" },
    };

    return NextResponse.json({ success: true, data: { sections, fileMtime } });
  } catch (error) {
    console.error("读取分区保存时间失败:", error);
    return NextResponse.json({ success: false, error: "读取分区保存时间失败" }, { status: 500 });
  }
}
