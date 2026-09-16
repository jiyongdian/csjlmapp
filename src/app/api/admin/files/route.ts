import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getUserFromToken } from "@/lib/auth";
import { getSystemSettings, resolveMediaDiskRoot, buildMediaUrl, touchSectionSavedAt } from "@/lib/system-settings";

export const runtime = "nodejs";

function isAdmin(request: NextRequest): boolean {
  const payload = getUserFromToken(request.headers.get("Authorization") || "");
  return !!payload && payload.role === "admin";
}

async function resolveRoot(): Promise<string> {
  const settings = await getSystemSettings();
  return resolveMediaDiskRoot(settings);
}

function safeJoin(root: string, rel: string): string | null {
  const clean = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const target = path.resolve(root, clean);
  const base = path.resolve(root);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ success: false, error: "无权限" }, { status: 403 });
  }
  try {
    const root = await resolveRoot();
    const url = new URL(request.url);
    const download = url.searchParams.get("download");
    const rel = url.searchParams.get("path") || "";

    if (download) {
      const target = safeJoin(root, download);
      if (!target) {
        return NextResponse.json({ success: false, error: "路径不合法" }, { status: 400 });
      }
      const stat = await fs.stat(target).catch(() => null);
      if (!stat || !stat.isFile()) {
        return NextResponse.json({ success: false, error: "文件不存在" }, { status: 404 });
      }
      const buf = await fs.readFile(target);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(target)),
          "Content-Length": String(buf.length),
        },
      });
    }

    const target = safeJoin(root, rel);
    if (!target) {
      return NextResponse.json({ success: false, error: "路径不合法" }, { status: 400 });
    }
    await fs.mkdir(target, { recursive: true });
    const dirents = await fs.readdir(target, { withFileTypes: true });
    const settings = await getSystemSettings();
    const entries = await Promise.all(
      dirents.map(async (d) => {
        const full = path.join(target, d.name);
        let size = 0;
        let mtime = "";
        try {
          const st = await fs.stat(full);
          size = st.size;
          mtime = st.mtime.toISOString();
        } catch {
          size = 0;
        }
        const childRel = path.relative(root, full).replace(/\\/g, "/");
        return {
          name: d.name,
          type: d.isDirectory() ? "dir" : "file",
          size,
          sizeText: d.isDirectory() ? "-" : formatSize(size),
          mtime,
          relativePath: childRel,
          url: d.isDirectory() ? "" : buildMediaUrl(settings, childRel),
        };
      })
    );
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const parent = rel ? path.dirname(rel.replace(/\\/g, "/")).replace(/^\.$/, "") : "";
    return NextResponse.json({
      success: true,
      data: { root, relativePath: rel, parent, entries },
    });
  } catch (error) {
    console.error("读取目录失败:", error);
    const message = error instanceof Error ? error.message : "读取目录失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ success: false, error: "无权限" }, { status: 403 });
  }
  try {
    const root = await resolveRoot();
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const action = String(form.get("action") || "upload");
      const dir = String(form.get("path") || "");

      if (action === "mkdir") {
        const name = String(form.get("name") || "").trim();
        if (!name || name.includes("..") || /[\\/:*?"<>|]/.test(name)) {
          return NextResponse.json({ success: false, error: "目录名不合法" }, { status: 400 });
        }
        const target = safeJoin(root, dir ? dir + "/" + name : name);
        if (!target) return NextResponse.json({ success: false, error: "路径不合法" }, { status: 400 });
        await fs.mkdir(target, { recursive: true });
        await touchSectionSavedAt("files");
        return NextResponse.json({ success: true, data: { created: name } });
      }

      if (action === "upload") {
        const target = safeJoin(root, dir);
        if (!target) return NextResponse.json({ success: false, error: "路径不合法" }, { status: 400 });
        await fs.mkdir(target, { recursive: true });
        const files = form.getAll("files").filter((f): f is File => f instanceof File);
        const saved: string[] = [];
        for (const file of files) {
          const name = path.basename(file.name || "upload.bin");
          const buf = Buffer.from(await file.arrayBuffer());
          await fs.writeFile(path.join(target, name), buf);
          saved.push(name);
        }
        await touchSectionSavedAt("files");
        return NextResponse.json({ success: true, data: { saved } });
      }

      return NextResponse.json({ success: false, error: "未知操作" }, { status: 400 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "");

    if (action === "delete") {
      const targets = Array.isArray(body.paths) ? body.paths.map(String) : [String(body.path || "")];
      const deleted: string[] = [];
      for (const rel of targets) {
        const target = safeJoin(root, rel);
        if (!target || target === path.resolve(root)) continue;
        await fs.rm(target, { recursive: true, force: true });
        deleted.push(rel);
      }
      await touchSectionSavedAt("files");
      return NextResponse.json({ success: true, data: { deleted } });
    }

    if (action === "mkdir") {
      const name = String(body.name || "").trim();
      const dir = String(body.path || "");
      if (!name || name.includes("..") || /[\\/:*?"<>|]/.test(name)) {
        return NextResponse.json({ success: false, error: "目录名不合法" }, { status: 400 });
      }
      const target = safeJoin(root, dir ? dir + "/" + name : name);
      if (!target) return NextResponse.json({ success: false, error: "路径不合法" }, { status: 400 });
      await fs.mkdir(target, { recursive: true });
      return NextResponse.json({ success: true, data: { created: name } });
    }

    return NextResponse.json({ success: false, error: "未知操作" }, { status: 400 });
  } catch (error) {
    console.error("文件操作失败:", error);
    const message = error instanceof Error ? error.message : "文件操作失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
