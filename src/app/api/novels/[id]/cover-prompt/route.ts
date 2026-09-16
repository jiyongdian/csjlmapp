import { NextRequest, NextResponse } from "next/server";
import { novelManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";
import { getRawAIConfig, getModelName } from "@/lib/ai-config";
import { callLLMApi } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_PROMPT = [
  "你是资深图书封面美术指导，擅长把小说内容转成可直接用于 AI 绘图的封面提示词。",
  "请输出一段中文提示词（120-220 字），包含：主体人物或核心场景、环境氛围、镜头与构图、光影、色调、绘画风格。",
  "硬性要求：竖向 3:4 书封构图；画面中必须清晰出现书名文字；不要出现英文、水印、杂乱文字。",
  "只输出提示词本身，不要任何解释、不要加引号、不要分点。",
].join("");

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const { id: novelId } = await params;

    const novel = await novelManager.getById(novelId);
    if (!novel) return NextResponse.json({ error: "小说不存在" }, { status: 404 });
    if (novel.userId !== payload.userId && payload.role !== "admin") {
      return NextResponse.json({ error: "无权操作该作品" }, { status: 403 });
    }

    const { apiUrl, apiKey } = await getRawAIConfig(null);
    const model = await getModelName(null);

    const lines = [
      "书名：《" + String(novel.title || "未命名小说") + "》",
      novel.category ? "题材：" + novel.category : "",
      novel.genderTarget ? "受众：" + novel.genderTarget : "",
      novel.protagonist ? "主角：" + String(novel.protagonist).slice(0, 120) : "",
      novel.description ? "简介：" + String(novel.description).slice(0, 400) : "",
    ].filter(Boolean);

    const r = await callLLMApi(apiUrl, apiKey, model, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: lines.join("\n") },
    ], { temperature: 0.85, maxTokens: 700, timeout: 180000, maxRetries: 2 });

    if (!r.success) return NextResponse.json({ error: r.error || "提示词生成失败" }, { status: 500 });
    const prompt = r.content.trim().replace(/^["「『]|["」』]$/g, "").trim();
    if (!prompt) return NextResponse.json({ error: "提示词为空" }, { status: 500 });
    return NextResponse.json({ success: true, data: { prompt } });
  } catch (error: any) {
    console.error("[CoverPrompt] 失败:", error);
    return NextResponse.json({ error: error?.message || "提示词生成失败" }, { status: 500 });
  }
}
