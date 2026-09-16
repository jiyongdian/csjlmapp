import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "@/lib/auth";
import { aiConfigManager } from "@/storage/database/aiConfigManager";

function extractMimoAudioBase64(data: any): string {
  const candidates = [
    data?.choices?.[0]?.message?.audio?.data,
    data?.choices?.[0]?.message?.audio,
    data?.audio?.data,
    data?.audio,
    data?.data?.audio?.data,
    data?.data?.audio,
    data?.data?.[0]?.b64_json,
    data?.data?.[0]?.audio?.data,
  ];
  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  return "";
}

/**
 * POST /api/admin/media-configs/[id]/test
 * 测试媒体API配置连通性，对图片配置发起最小化生成请求
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = getUserFromToken(request.headers.get("Authorization") || "");
    if (!payload || payload.role !== "admin") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { id } = await params;
    const cfg = await aiConfigManager.getConfigByIdAdmin(id);
    if (!cfg) return NextResponse.json({ error: "配置不存在" }, { status: 404 });
    if (!cfg.apiKey) return NextResponse.json({ success: false, error: "未配置 API Key" });

    const baseUrl = (cfg.apiUrl || "").replace(/\/$/, "");

    // ── Step 1: try GET /models (lightweight connectivity check) ──
    if (cfg.modelType !== "tts") {
    try {
      const modelsUrl = `${baseUrl}/models`;
      const modelsRes = await fetch(modelsUrl, {
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (modelsRes.status === 401 || modelsRes.status === 403) {
        return NextResponse.json({ success: false, error: `API Key 无效 (${modelsRes.status})` });
      }
      if (modelsRes.ok) {
        return NextResponse.json({ success: true, message: `连接成功 (GET /models → ${modelsRes.status})` });
      }
    } catch (_) {
      // /models not supported, fall through to image test
    }
    }

    // ── Step 2: for image configs, send a minimal generation ──
    if (cfg.modelType === "image") {

      // Gemini generateContent API (gemini-banana 本地代理 / gemini-image 直连)
      if (cfg.provider === "gemini-banana" || cfg.provider === "gemini-image") {
        const rawBase = baseUrl;
        const geminiBase = cfg.provider === "gemini-banana"
          ? (rawBase.endsWith("/v1beta") ? rawBase : `${rawBase}/v1beta`)
          : rawBase;
        const geminiUrl = `${geminiBase}/models/${cfg.model}:generateContent`;
        const geminiBody = {
          contents: [{ role: "user", parts: [{ text: "a red circle, simple test image" }] }],
          generationConfig: {
            responseModalities: ["IMAGE", "TEXT"],
            temperature: 1.0,
            topP: 0.95,
            maxOutputTokens: 512,
            imageConfig: { aspectRatio: "1:1" },
          },
        };
        const gRes = await fetch(geminiUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(geminiBody),
          signal: AbortSignal.timeout(60000),
        });
        if (gRes.status === 401 || gRes.status === 403) {
          return NextResponse.json({ success: false, error: `API Key 无效 (${gRes.status})` });
        }
        if (gRes.ok) {
          return NextResponse.json({ success: true, message: `Gemini 图片API 连接正常 (${cfg.provider})` });
        }
        const gErr = await gRes.json().catch(() => ({}));
        return NextResponse.json({
          success: false,
          error: gErr?.error?.message || gErr?.message || `请求失败 (${gRes.status})`,
        });
      }

      const imgUrl = `${baseUrl}/images/generations`;
      let body: Record<string, any> = {
        model: cfg.model,
        prompt: "a red circle",
        n: 1,
        size: "256x256",
        response_format: "url",
      };

      // SiliconFlow / flux style
      if (cfg.provider === "siliconflow") {
        body = { model: cfg.model, prompt: "a red circle", image_size: "256x256", num_inference_steps: 1 };
      }
      // Stability AI
      if (cfg.provider === "stability-ai") {
        body = { text_prompts: [{ text: "a red circle" }], cfg_scale: 7, width: 256, height: 256, samples: 1 };
      }
      // 火山方舟 Seedream：走 OpenAI 兼容的 /images/generations，但显式声明返回格式并关闭水印
      if (cfg.provider === "volcengine-ark") {
        body = { model: cfg.model, prompt: "a red circle", size: "1024x1024", response_format: "url", watermark: false };
      }

      const imgRes = await fetch(imgUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });

      if (imgRes.status === 401 || imgRes.status === 403) {
        return NextResponse.json({ success: false, error: `API Key 无效 (${imgRes.status})` });
      }
      if (imgRes.ok) {
        const data = await imgRes.json().catch(() => ({}));
        const imgUrlResult = data?.data?.[0]?.url || data?.images?.[0]?.url || data?.artifacts?.[0]?.base64 || null;
        return NextResponse.json({
          success: true,
          message: "图片生成成功！API 连接正常",
          imageUrl: imgUrlResult,
        });
      }
      const errData = await imgRes.json().catch(() => ({}));
      return NextResponse.json({
        success: false,
        error: errData?.error?.message || errData?.message || `请求失败 (${imgRes.status})`,
      });
    }

    // ── Step 3: for video configs, just check if base URL responds ──
    if (cfg.modelType === "video") {
      const isAgnes = cfg.provider === "agnes-video" ||
        cfg.provider === "agnes" ||
        String(cfg.model || "").toLowerCase().includes("agnes-video") ||
        String(cfg.apiUrl || "").toLowerCase().includes("agnes-ai.com");
      if (isAgnes) {
        const rawBase = (cfg.apiUrl || "https://apihub.agnes-ai.com").replace(/\/+$/, "");
        const agnesBase = rawBase.endsWith("/v1") ? rawBase.slice(0, -3) : rawBase;
        const testUrl = `${agnesBase}/agnesapi?video_id=codex-connectivity-test&model_name=${encodeURIComponent(cfg.model || "agnes-video-v2.0")}`;
        const agnesRes = await fetch(testUrl, {
          headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10000),
        });
        if (agnesRes.status === 401 || agnesRes.status === 403) {
          return NextResponse.json({ success: false, error: `API Key 无效 (${agnesRes.status})` });
        }
        if (agnesRes.status < 500) {
          return NextResponse.json({ success: true, message: `Agnes Video API 连接正常 (${agnesRes.status})` });
        }
        return NextResponse.json({ success: false, error: `Agnes 服务端错误 (${agnesRes.status})` });
      }
      // MiniMax H3 走 v2 接口：故意发送空的 content，服务端会返回 400 参数错误（不产生计费任务），
      // 从而能区分「鉴权/地址正确」与「Key 无效 / 服务不可用」。
      const isMinimaxH3 = cfg.provider === "minimax-h3" ||
        String(cfg.model || "").toLowerCase().includes("minimax-h3");
      if (isMinimaxH3) {
        const h3RawBase = (cfg.apiUrl || "https://api.minimax.chat").replace(/\/+$/, "").replace(/\/v[12]$/i, "");
        const h3Res = await fetch(`${h3RawBase}/v2/video_generation`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: cfg.model || "MiniMax-H3", content: [] }),
          signal: AbortSignal.timeout(10000),
        });
        if (h3Res.status === 401 || h3Res.status === 403) {
          return NextResponse.json({ success: false, error: `API Key 无效 (${h3Res.status})` });
        }
        // 400/402/422 表示已连通（鉴权通过、仅参数/余额问题）
        if (h3Res.status < 500) {
          return NextResponse.json({ success: true, message: `MiniMax H3 API 连接正常 (${h3Res.status})` });
        }
        return NextResponse.json({ success: false, error: `MiniMax 服务端错误 (${h3Res.status})` });
      }

      const pingUrl = `${baseUrl}/video/generations`;
      const pingRes = await fetch(pingUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: cfg.model, prompt: "test" }),
        signal: AbortSignal.timeout(10000),
      });
      if (pingRes.status === 401 || pingRes.status === 403) {
        return NextResponse.json({ success: false, error: `API Key 无效 (${pingRes.status})` });
      }
      // 400/422 means auth passed but params wrong — still counts as connected
      if (pingRes.status < 500) {
        return NextResponse.json({ success: true, message: `视频API 连接正常 (${pingRes.status})` });
      }
      return NextResponse.json({ success: false, error: `服务器错误 (${pingRes.status})` });
    }

    if (cfg.modelType === "tts") {
      if (cfg.provider === "mimo-tts") {
        const endpoint = baseUrl.endsWith("/chat/completions")
          ? baseUrl
          : `${baseUrl || "https://api.xiaomimimo.com/v1"}/chat/completions`;
        const model = cfg.model || "mimo-v2.5-tts";
        if (model === "mimo-v2.5-asr") {
          return NextResponse.json({ success: true, message: "MiMo ASR 模型已保存；它用于语音识别，不走配音测试。" });
        }
        const isVoiceClone = model === "mimo-v2.5-tts-voiceclone";
        const isVoiceDesign = model === "mimo-v2.5-tts-voicedesign";
        const audioPayload: Record<string, any> = { format: "wav" };
        if (isVoiceDesign) {
          audioPayload.optimize_text_preview = false;
        } else {
          audioPayload.voice = "mimo_default";
        }
        const ttsRes = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": cfg.apiKey },
          body: JSON.stringify({
            model: isVoiceClone ? "mimo-v2.5-tts" : model,
            messages: [
              { role: "user", content: isVoiceDesign ? "请生成一个30岁温柔御姐、轻微沙哑、语速舒缓、电台叙事感的自然中文声音。" : "请将下面文本合成为自然中文语音。" },
              { role: "assistant", content: "这是一段测试文本，用于验证小米 MiMo 配音接口。" },
            ],
            modalities: ["text", "audio"],
            audio: audioPayload,
            stream: false,
          }),
          signal: AbortSignal.timeout(30000),
        });
        const raw = await ttsRes.text();
        let data: any = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        if (ttsRes.status === 401 || ttsRes.status === 403) {
          return NextResponse.json({ success: false, error: `API Key 无效 (${ttsRes.status})` });
        }
        if (!ttsRes.ok || data?.error) {
          return NextResponse.json({
            success: false,
            error: data?.error?.message || data?.message || raw.slice(0, 200) || `MiMo 配音请求失败 (${ttsRes.status})`,
          });
        }
        const audioBase64 = extractMimoAudioBase64(data);
        if (!audioBase64) {
          return NextResponse.json({ success: false, error: "MiMo 已响应，但未找到音频 Base64 数据" });
        }
        return NextResponse.json({
          success: true,
          message: isVoiceClone ? "MiMo API Key 连接正常；VoiceClone 需在前台上传参考音频后生成。" : "MiMo 配音API连接正常，已返回测试音频",
          audioUrl: `data:audio/wav;base64,${audioBase64}`,
        });
      }

      return NextResponse.json({ success: true, message: "配音API配置已保存；该供应商无需后台远程测试" });
    }

    return NextResponse.json({ success: false, error: "未知配置类型" });
  } catch (e: any) {
    const isTimeout = e?.name === "TimeoutError" || e?.message?.includes("timeout");
    return NextResponse.json({
      success: false,
      error: isTimeout ? "连接超时，请检查 API URL 是否正确" : (e.message || "测试失败"),
    });
  }
}
