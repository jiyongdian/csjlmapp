import { NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import { join, normalize, sep } from "path";
import { Readable } from "stream";
import { getSystemSettings, resolveMediaDiskRoot } from "@/lib/system-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function extname(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function toWebStream(nodeStream: Readable): ReadableStream {
  return Readable.toWeb(nodeStream) as unknown as ReadableStream;
}

/**
 * 媒体回源路由：`/media/*` 在 public 下找不到文件时，回源到「系统设置 → 多媒体磁盘保存根路径」读取。
 * 用于：本地开发 + 部署后使用外部磁盘 / 挂载盘 / 独立媒体目录，都能正常读取媒体。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const { path: segments } = await params;
    const rel = (segments || []).join("/");

    // 防目录穿越 / 非法路径
    if (!rel || rel.indexOf("..") >= 0 || rel.startsWith("/") || rel.indexOf("\0") >= 0) {
      return new NextResponse("Not Found", { status: 404 });
    }

    const settings = await getSystemSettings();
    const root = resolveMediaDiskRoot(settings);
    const mediaRoot = normalize(join(root, "media"));
    const filePath = normalize(join(mediaRoot, rel));
    if (filePath !== mediaRoot && !filePath.startsWith(mediaRoot + sep)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      return new NextResponse("Not Found", { status: 404 });
    }
    if (!stat.isFile()) {
      return new NextResponse("Not Found", { status: 404 });
    }

    const contentType = MIME_TYPES[extname(filePath)] || "application/octet-stream";
    const size = stat.size;
    const cacheControl = "public, max-age=31536000, immutable";
    const rangeHeader = request.headers.get("range");

    if (rangeHeader) {
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
        if (start >= 0 && end >= start && start < size) {
          const stream = createReadStream(filePath, { start, end });
          return new NextResponse(toWebStream(stream as unknown as Readable), {
            status: 206,
            headers: {
              "Content-Type": contentType,
              "Content-Length": String(end - start + 1),
              "Content-Range": "bytes " + start + "-" + end + "/" + size,
              "Accept-Ranges": "bytes",
              "Cache-Control": cacheControl,
            },
          });
        }
      }
    }

    const stream = createReadStream(filePath);
    return new NextResponse(toWebStream(stream as unknown as Readable), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
        "Cache-Control": cacheControl,
      },
    });
  } catch (error) {
    console.error("[media] 读取媒体失败:", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
