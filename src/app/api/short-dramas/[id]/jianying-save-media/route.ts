import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "200mb",
    },
  },
};

/**
 * 将前端浏览器下载的媒体文件（blob）直接保存到剪映草稿箱文件夹
 * 浏览器可以访问 CDN 视频 URL（video 播放器可以播放），
 * 但 Node.js 服务端 fetch 可能因 CDN 防盗链/网络限制无法下载。
 * 因此改用：浏览器 fetch blob → 上传 → 服务端保存的方式。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params; // validate route params
    
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const draftPath = formData.get("draftPath") as string | null;
    const draftName = formData.get("draftName") as string | null;
    const filename = formData.get("filename") as string | null;

    if (!file || !draftPath || !draftName || !filename) {
      return NextResponse.json(
        { success: false, error: "缺少必要参数: file/draftPath/draftName/filename" },
        { status: 400 }
      );
    }

    // 安全检查：确保路径在剪映草稿目录下
    const realDraftPath = path.resolve(draftPath);
    if (!realDraftPath.toLowerCase().includes("jianying")) {
      return NextResponse.json(
        { success: false, error: "目标路径不在剪映草稿目录内" },
        { status: 400 }
      );
    }

    const draftFolderPath = path.join(realDraftPath, draftName);

    // 创建目录
    fs.mkdirSync(draftFolderPath, { recursive: true });

    // 清理文件名，防止路径穿越
    const safeFilename = path.basename(filename);
    const destPath = path.join(draftFolderPath, safeFilename);

    // 读取文件数据
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      return NextResponse.json(
        { success: false, error: "文件为空 (0 bytes)" },
        { status: 400 }
      );
    }

    // 写入文件
    fs.writeFileSync(destPath, buffer);

    // 验证
    const stat = fs.statSync(destPath);

    return NextResponse.json({
      success: true,
      data: {
        filename: safeFilename,
        size: stat.size,
        path: destPath,
      },
    });
  } catch (error: any) {
    console.error("剪映媒体保存失败:", error);
    return NextResponse.json(
      { success: false, error: error.message || "保存失败" },
      { status: 500 }
    );
  }
}
