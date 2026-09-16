import { NextResponse } from "next/server";
import { getAllPresets } from "@/lib/art-style-presets";

/**
 * GET /api/project/presets/art-styles
 * 
 * 返回预设画风列表
 * 数据来源：Toonflow art_skills 体系
 * 参考图：public/art-styles/ 下的静态文件
 */
export async function GET() {
  try {
    const presets = getAllPresets();

    const data = presets.map((p) => ({
      key: p.key,
      name: p.name,
      description: p.description,
      imagePrompt: p.imagePrompt,
      referenceImagePath: p.referenceImagePath,
      referenceImagePublicUrl: null,
      category: p.category,
    }));

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get art style presets error:", error);
    return NextResponse.json(
      { success: false, error: "获取画风预设失败" },
      { status: 500 }
    );
  }
}