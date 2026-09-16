import { NextRequest, NextResponse } from "next/server";
import { novelManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";
import { parseNovelFile } from "@/lib/novel-import";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_SIZE = 50 * 1024 * 1024;

/** 书名：优先容器元数据 → 文件名 → 正文首行 */
function guessTitle(filename: string, metaTitle: string | null, firstContent: string): string {
  if (metaTitle && metaTitle.length >= 2 && metaTitle.length <= 60) return metaTitle;
  let name = filename.replace(/\.[^.]+$/, "");
  name = name.replace(/[《》]/g, "").replace(/(小说|完结版|全集|完整版|精校版|全本|TXT|txt)/gi, "").trim();
  name = name.replace(/^[\[【(（].*?[\]】)）]\s*/g, "").trim();
  if (name && name.length >= 2 && name.length <= 60) return name;
  const firstLine = firstContent.split("\n").map((l) => l.trim()).find((l) => l.length >= 2) || "";
  const m = firstLine.match(/^《(.+?)》/);
  if (m) return m[1];
  return firstLine.slice(0, 40) || "未命名小说";
}

/**
 * POST /api/novels/import
 * multipart/form-data: file, title?, description?, category?, dryRun?
 * dryRun=1 → 只解析返回预览，不创建小说
 */
export async function POST(request: NextRequest) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "请上传文件" }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: "文件为空" }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "文件超过 50MB，请拆分后再上传" }, { status: 413 });

    const dryRun = String(formData.get("dryRun") || "") === "1";
    const buf = Buffer.from(await file.arrayBuffer());

    let result;
    try {
      result = await parseNovelFile(buf, file.name || "unknown.txt");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: "解析失败：" + msg }, { status: 400 });
    }

    if (!result.chapters.length) {
      return NextResponse.json({ error: "未能解析出正文内容，请确认文件是小说文本" }, { status: 400 });
    }

    const totalChars = result.chapters.reduce((s, c) => s + c.content.length, 0);
    if (totalChars < 200) {
      return NextResponse.json({ error: "正文内容过少（" + totalChars + " 字），可能不是小说文件" }, { status: 400 });
    }

    const preview = result.chapters.map((c) => ({
      index: c.index,
      title: c.title,
      wordCount: c.content.length,
      snippet: c.content.slice(0, 60).replace(/\s+/g, " "),
    }));

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        format: result.format,
        encoding: result.encoding,
        strategy: result.strategy,
        metaTitle: result.metaTitle,
        warnings: result.warnings,
        totalChars,
        chapterCount: result.chapters.length,
        preview,
      });
    }

    const titleOverride = String(formData.get("title") || "").trim();
    const title = titleOverride || guessTitle(file.name || "unknown.txt", result.metaTitle, result.chapters[0].content);

    const chapterArray = result.chapters.map((c) => ({ index: c.index, title: c.title, content: c.content }));

    const novel = await novelManager.create({
      userId: payload.userId,
      title,
      description:
        (formData.get("description") as string | null) ||
        "由《" + file.name + "》导入，共 " + chapterArray.length + " 章，约 " + totalChars + " 字（编码 " + result.encoding + "）。",
      category: (formData.get("category") as string | null) || null,
      genderTarget: null,
      narrativePerspective: null,
      protagonist: null,
      supportingCharacterName: null,
      totalChapters: chapterArray.length,
      currentChapters: chapterArray.length,
      status: "completed",
      tone: null,
      idea: null,
      structure: null,
      chapters: chapterArray,
    } as any);

    return NextResponse.json({
      success: true,
      novel: {
        id: novel.id,
        title: novel.title,
        totalChapters: chapterArray.length,
        encoding: result.encoding,
        format: result.format,
        fileSize: file.size,
      },
      warnings: result.warnings,
      preview,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Novel Import] error:", msg, e);
    return NextResponse.json({ error: "导入失败：" + msg }, { status: 500 });
  }
}
