import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join, isAbsolute } from "path";
import { novelManager } from "@/storage/database";
import { aiConfigManager } from "@/storage/database/aiConfigManager";
import { getUserFromToken } from "@/lib/auth";
import { getSystemSettings, buildMediaUrl } from "@/lib/system-settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const COVER_SIZE = "768x1024";

function safeJson(v: unknown): any {
  if (!v) return null;
  try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
}

/** 依据书名/题材/主角/简介自动拼一条封面提示词 */
function buildCoverPrompt(novel: any): string {
  const title = String(novel?.title || "未命名小说");
  const category = String(novel?.category || "");
  const protagonist = String(novel?.protagonist || "").slice(0, 60);
  const desc = String(novel?.description || "").replace(/\s+/g, " ").slice(0, 140);
  let p = "小说封面插画，作品名《" + title + "》。";
  if (category) p += "题材：" + category + "。";
  if (protagonist) p += "主角设定：" + protagonist + "。";
  if (desc) p += "画面氛围：" + desc + "。";
  p += "构图：竖向 3:4 书封，主体人物或核心场景居中，电影级光影，精致厚涂插画质感，色调统一且有氛围感。";
  p += "画面中必须清晰、工整地出现书名文字「" + title + "」，中文字体有设计感；不要出现多余英文、水印或杂乱文字。";
  return p;
}

/** 选一个可用的图片模型配置（用户优先，其次系统；可指定 configId） */
async function pickImageConfig(userId: string, configId?: string | null) {
  const { system, user } = await aiConfigManager.getAvailableConfigs(userId);
  const all = ([...(user || []), ...(system || [])] as any[])
    .filter((c) => c && c.modelType === "image" && c.isActive === 1);
  if (!all.length) return null;
  if (configId) return all.filter((c) => c.id === configId)[0] || null;
  return all.filter((c) => c.isDefault === 1)[0] || all[0];
}

/** 调用 OpenAI 兼容生图接口，兼容 url / b64_json 两种返回；端点若返回网页会自动尝试 /v1 路径兜底 */
async function generateImage(cfg: any, prompt: string, size: string): Promise<string> {
  const base = String(cfg.apiUrl || "").replace(/\/+$/, "");
  const extra = safeJson(cfg.extraConfig) || {};
  let endpoint = typeof extra.endpointPath === "string" && extra.endpointPath.trim()
    ? extra.endpointPath.trim()
    : "/images/generations";
  if (!/^https?:\/\//i.test(endpoint)) {
    endpoint = base + (endpoint.charAt(0) === "/" ? endpoint : "/" + endpoint);
  }

  const tryOnce = async (ep: string): Promise<{ out: string } | { html: boolean; text: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600000);
    try {
      const resp = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
        body: JSON.stringify({ model: cfg.model, prompt: prompt, n: 1, size: size }),
        signal: controller.signal,
      });
      const text = await resp.text();
      const htmlResp = !resp.ok && /text\/html/i.test(String(resp.headers.get("content-type") || ""));
      const json = (() => { try { return JSON.parse(text); } catch { return null; } })();
      if (!resp.ok) {
        const msg = (json && (json.error?.message || json.message || json.msg)) || (htmlResp ? "返回了网页（可能 API 地址/路径写错）" : text.slice(0, 200)) || ("HTTP " + resp.status);
        throw new Error("生图接口错误 " + resp.status + "：" + msg);
      }
      const d0 = json && Array.isArray(json.data) && json.data.length ? json.data[0] : null;
      let out = "";
      if (d0) {
        if (typeof d0.url === "string" && d0.url) out = d0.url;
        else if (typeof d0.b64_json === "string" && d0.b64_json) out = "data:image/png;base64," + d0.b64_json;
      }
      if (!out && json && typeof json.url === "string") out = json.url;
      if (!out) {
        // 200 但返回 HTML：多半是配置的地址少了 /v1 或路径不对
        if (/text\/html/i.test(String(resp.headers.get("content-type") || "")) || /^\s*<(!doctype|html)/i.test(text)) {
          return { html: true, text };
        }
        throw new Error("生图接口未返回图片：" + text.slice(0, 300));
      }
      return { out };
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await tryOnce(endpoint);
  if ("html" in first) {
    // 自动尝试 OpenAI 兼容的 /v1 路径（未带 /v1 时）
    if (!/\/v1\//i.test(endpoint)) {
      const alt = base + "/v1/images/generations";
      if (alt !== endpoint) {
        const second = await tryOnce(alt);
        if ("out" in second) return second.out;
      }
    }
    const plainText = String(first.text || "")
      .replace(/<[^>]{1,80}>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    throw new Error("生图接口返回了网页而不是图片，请检查该模型配置的 API 地址与路径（可能要带 /v1）：" + plainText);
  }
  return first.out;
}

/** 把 base64 dataURL 落盘到 public/media 下，返回可访问 URL（与 /api/storage/upload 约定一致） */
async function saveDataUrlToDisk(novel: any, dataUrl: string): Promise<string> {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("图片数据格式不正确");
  const mime = m[1];
  const buf = Buffer.from(m[2], "base64");

  const settings = await getSystemSettings();
  const baseSavePath = (settings as any).mediaSavePath || "public";
  const mediaWebPath = (settings as any).mediaWebPath || "/media";
  const websiteUrl = (settings as any).websiteUrl ? String((settings as any).websiteUrl).replace(/\/$/, "") : "";
  const novelSavePath = (settings as any).novelSavePath || "novel";

  const cleanTitle = String(novel?.title || "untitled").replace(/[\\/:*?"<>|\s]/g, "_");
  const folderName = cleanTitle + "_" + novel.id;
  const relativeSavePath = join("media", novelSavePath, folderName, "cover");
  const relativeWebPath = mediaWebPath + "/" + novelSavePath + "/" + folderName + "/cover";
  const targetDir = join(isAbsolute(baseSavePath) ? baseSavePath : join(process.cwd(), baseSavePath), relativeSavePath);
  await mkdir(targetDir, { recursive: true });

  const ext = mime.indexOf("jpeg") >= 0 || mime.indexOf("jpg") >= 0 ? "jpg" : (mime.indexOf("webp") >= 0 ? "webp" : "png");
  const safeName = Date.now() + "-" + Math.random().toString(36).slice(2, 9) + "." + ext;
  await writeFile(join(targetDir, safeName), buf);
  return buildMediaUrl(settings, join(relativeSavePath, safeName)).replace(/\\/g, "/");
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const { id: novelId } = await params;
    const body = await request.json().catch(() => ({} as any));

    const novel = await novelManager.getById(novelId);
    if (!novel) return NextResponse.json({ error: "小说不存在" }, { status: 404 });
    if (novel.userId !== payload.userId && payload.role !== "admin") {
      return NextResponse.json({ error: "无权操作该作品" }, { status: 403 });
    }

    // 模式一：本地上传（传 dataURL）
    if (body.mode === "upload") {
      const dataUrl = String(body.dataUrl || "");
      if (!/^data:image\//i.test(dataUrl)) {
        return NextResponse.json({ error: "图片数据无效（需为 data:image/... 格式）" }, { status: 400 });
      }
      const stored = await saveDataUrlToDisk(novel, dataUrl);
      await novelManager.update(novelId, novel.userId, { coverImage: stored } as any);
      return NextResponse.json({ success: true, data: { coverImage: stored } });
    }

    // 模式一之二：套用已有图片（从候选里选一张）
    if (body.mode === "set") {
      const url = String(body.url || "").trim();
      if (!url) return NextResponse.json({ error: "缺少图片地址" }, { status: 400 });
      await novelManager.update(novelId, novel.userId, { coverImage: url } as any);
      return NextResponse.json({ success: true, data: { coverImage: url } });
    }

    // 模式二：AI 生成
    const prompt = String(body.prompt || "").trim() || buildCoverPrompt(novel);
    const size = String(body.size || COVER_SIZE);
    const cfg = await pickImageConfig(payload.userId, body.configId);
    if (!cfg) {
      return NextResponse.json({ error: "未配置图片生成模型，请先在「AI 设置」里添加 image 类型配置" }, { status: 400 });
    }

    const raw = await generateImage(cfg, prompt, size);
    // dataURL 落盘（避免把几 MB 的 base64 写进数据库）；已是 http 链接则直接用
    const stored = /^data:image\//i.test(raw) ? await saveDataUrlToDisk(novel, raw) : raw;

    await novelManager.update(novelId, novel.userId, { coverImage: stored } as any);
    return NextResponse.json({ success: true, data: { coverImage: stored, prompt, model: cfg.model, size } });
  } catch (error: any) {
    console.error("[Cover] 封面生成失败:", error);
    return NextResponse.json({ error: error?.message || "封面生成失败" }, { status: 500 });
  }
}
