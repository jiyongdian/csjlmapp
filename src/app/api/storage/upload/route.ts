import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join, isAbsolute } from "path";
import { shortDramaManager, novelManager, scriptManager } from "@/storage/database";
import { getSystemSettings, buildMediaUrl } from "@/lib/system-settings";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const subDir = (formData.get("subDir") as string) || "uploads";
    const dramaId = formData.get("dramaId") as string | null;
    const novelId = formData.get("novelId") as string | null;
    const scriptId = formData.get("scriptId") as string | null;

    if (!file) {
      return NextResponse.json({ code: 1, msg: "未选择任何文件" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const settings = await getSystemSettings();
    const baseSavePath = settings.mediaSavePath || "public";
    const mediaWebPath = settings.mediaWebPath || "/media";
    const websiteUrl = settings.websiteUrl ? settings.websiteUrl.replace(/\/$/, "") : "";

    const novelSavePath = settings.novelSavePath || "novel";
    const scriptSavePath = settings.scriptSavePath || "script";
    const dramaSavePath = settings.dramaSavePath || "works";

    // 默认相对路径
    let relativeSavePath = join("media", subDir);
    let relativeWebPath = `${mediaWebPath}/${subDir}`;

    // 如果指定了 dramaId，按照系统的 media/works/{title}_{dramaId}/{subDir} 目录存储，确保小说/短剧媒体文件保存路径的完全对应
    if (dramaId) {
      const drama = await shortDramaManager.getById(dramaId);
      if (drama) {
        const cleanTitle = (drama.title || "untitled").replace(/[\\/:*?"<>|\s]/g, "_");
        const folderName = `${cleanTitle}_${dramaId}`;
        relativeSavePath = join("media", dramaSavePath, folderName, subDir);
        relativeWebPath = `${mediaWebPath}/${dramaSavePath}/${folderName}/${subDir}`;
      }
    } else if (novelId) {
      const novel = await novelManager.getById(novelId);
      if (novel) {
        const cleanTitle = (novel.title || "untitled").replace(/[\\/:*?"<>|\s]/g, "_");
        const folderName = `${cleanTitle}_${novelId}`;
        relativeSavePath = join("media", novelSavePath, folderName, subDir);
        relativeWebPath = `${mediaWebPath}/${novelSavePath}/${folderName}/${subDir}`;
      }
    } else if (scriptId) {
      const script = await scriptManager.getScriptById(scriptId);
      if (script) {
        const cleanTitle = `script_${scriptId}`;
        const folderName = `${cleanTitle}`;
        relativeSavePath = join("media", scriptSavePath, folderName, subDir);
        relativeWebPath = `${mediaWebPath}/${scriptSavePath}/${folderName}/${subDir}`;
      }
    }

    // 拼接绝对物理保存路径
    const targetDir = join(
      isAbsolute(baseSavePath) ? baseSavePath : join(process.cwd(), baseSavePath),
      relativeSavePath
    );

    // 确保保存目录存在
    await mkdir(targetDir, { recursive: true });

    // 用时间戳对文件名去重
    const ext = file.name.split(".").pop() || "png";
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
    const targetPath = join(targetDir, safeName);

    // 写文件到磁盘
    await writeFile(targetPath, buffer);

    // 返回给前端可访问的相对 URL 路径 (并附带可能配置的 CDN/Website 前缀)
    const fileUrl = buildMediaUrl(settings, join(relativeSavePath, safeName));

    return NextResponse.json({
      code: 0,
      data: fileUrl,
      msg: "上传成功"
    });
  } catch (error: any) {
    console.error("本地上传失败:", error);
    return NextResponse.json({ code: 500, msg: `上传异常: ${error.message}` }, { status: 500 });
  }
}
