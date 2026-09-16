import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

/**
 * Agnes Video 2.5 Flash - 一键生成
 * POST /api/agnes-video/generate
 * 用 axios 替换 fetch（解决 Next.js undici 连接超时问题），内置重试。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 360;

function getCredentials() {
  const apiKey =
    process.env.AGNES_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "";
  const baseUrl =
    process.env.AGNES_BASE_URL ||
    "https://www.csjlm.app/v1";
  if (!apiKey) {
    throw new Error(
      "未配置 AGNES_API_KEY（请在环境变量中设置 AGNES_API_KEY 或 OPENAI_API_KEY）"
    );
  }
  return { apiKey, baseUrl };
}

const http = axios.create({ timeout: 180_000 });

async function retryAxios(config: axios.AxiosRequestConfig, label: string, maxAttempts = 3) {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await http.request(config);
    } catch (e: any) {
      lastErr = e;
      const code = e?.code || e?.cause?.code || "";
      const retryable =
        /CONNECT|ECONN|ETIMEDOUT|UND_ERR|TLS|EPIPE|ERR_SOCKET|EAI_AGAIN/i.test(code) ||
        /fetch failed|connect timeout|network error|socket hang up/i.test(e?.message || "") ||
        (e?.response?.status ?? 0) === 429 ||
        (e?.response?.status ?? 0) >= 500;
      if (!retryable || attempt === maxAttempts) break;
      console.warn(
        `[AgnesFlash/gen] 重试 ${attempt}/${maxAttempts} ${label} (${code || (e?.message || "").slice(0, 80)})`
      );
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw lastErr;
}

function extractVideoUrl(p: any): string {
  if (!p) return "";
  if (typeof p?.metadata?.url === "string" && /^https?:\/\//i.test(p.metadata.url)) {
    return p.metadata.url;
  }
  if (typeof p?.metadata?.video_url === "string" && /^https?:\/\//i.test(p.metadata.video_url)) {
    return p.metadata.video_url;
  }
  const candidates = [
    p?.url,
    p?.video_url,
    p?.download_url,
    p?.data?.url,
    p?.data?.video_url,
    p?.data?.metadata?.url,
    p?.output,
    p?.data?.output,
  ];
  if (Array.isArray(p?.output)) {
    const f = p.output[0];
    candidates.push(f?.url, f?.video_url, f?.download_url);
  }
  if (Array.isArray(p?.data)) {
    const f = p.data[0];
    candidates.push(f?.url, f?.video_url, f?.metadata?.url);
  }
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//i.test(c)) return c;
  }
  const raw = JSON.stringify(p);
  const m = raw.match(/https?:\/\/[^"'\\\s]+\.mp4[^"'\\\s]*/g);
  if (m && m[0]) return m[0].replace(/[,}\]]+$/, "");
  return "";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const prompt = String(body?.prompt || "").trim();
    if (!prompt) {
      return NextResponse.json(
        { success: false, error: "prompt 必填" },
        { status: 400 }
      );
    }

    const mode: any =
      ["text", "keyframe", "reference"].includes(body?.mode) ? body.mode : "text";
    const rawSeconds = body.seconds ?? 5;
    const seconds =
      typeof rawSeconds === "number"
        ? String(Math.max(4, Math.min(12, Math.round(rawSeconds))))
        : String(rawSeconds);
    const aspect_ratio = body.aspect_ratio || "16:9";
    const pollIntervalMs = Math.max(1500, Number(body.poll_interval_ms) || 2500);
    const pollTimeoutSec = Math.max(30, Number(body.poll_timeout_sec) || 420);

    const { apiKey, baseUrl } = getCredentials();
    const isOfficial = /agnes-ai\.com/i.test(baseUrl);

    // 构造请求体
    const payload: Record<string, any> = {
      model: "agnes-video-2.5-flash",
      prompt,
      mode,
      seconds,
      size: "720P",
      aspect_ratio,
      n: 1,
    };
    if (typeof body.seed === "number" && Number.isFinite(body.seed)) {
      payload.seed = Math.floor(body.seed);
    }
    if (mode === "keyframe") {
      if (!body.first_frame && !body.last_frame) {
        return NextResponse.json(
          { success: false, error: "keyframe 模式至少提供 first_frame 或 last_frame" },
          { status: 400 }
        );
      }
      if (body.first_frame) payload.first_frame = String(body.first_frame);
      if (body.last_frame) payload.last_frame = String(body.last_frame);
    } else if (mode === "reference") {
      const hasImgs = Array.isArray(body.images) && body.images.length > 0;
      const hasAud = Array.isArray(body.audios) && body.audios.length > 0;
      if (!hasImgs && !hasAud) {
        return NextResponse.json(
          { success: false, error: "reference 模式至少提供 images 或 audios 之一" },
          { status: 400 }
        );
      }
      if (hasImgs) {
        if (body.images!.length > 5) {
          return NextResponse.json(
            { success: false, error: "images length must not exceed 5" },
            { status: 400 }
          );
        }
        payload.images = body.images.map(String);
      }
      if (hasAud) payload.audios = body.audios.map(String);
    }

    // ===== 1. 创建任务 =====
    const createUrl = baseUrl.endsWith("/") ? `${baseUrl}videos` : `${baseUrl}/videos`;
    console.log(
      `[AgnesFlash/gen] ${isOfficial ? "OFFICIAL" : "PROXY"} create mode=${mode} seconds=${seconds} → ${createUrl}`
    );

    let createResp: axios.AxiosResponse;
    try {
      createResp = await retryAxios(
        {
          method: "POST",
          url: createUrl,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          data: payload,
          responseType: "json",
        },
        "create-task"
      );
    } catch (e: any) {
      const respData = e?.response?.data;
      const status = e?.response?.status ?? 0;
      let detail: string =
        respData?.detail ||
        respData?.error?.message ||
        respData?.error?.detail ||
        respData?.message ||
        (typeof respData?.error === "string" ? respData.error : "") ||
        e?.message ||
        `HTTP ${status || "?"}`;
      if (status === 429 || respData?.code === "fail_to_fetch_task") {
        detail = "上游负载饱和（429），请稍后重试";
      }
      console.error(
        `[AgnesFlash/gen] create FAIL HTTP ${status || "?"}: ${detail.slice(0, 200)}`
      );
      return NextResponse.json(
        {
          success: false,
          error: detail,
          httpStatus: status || undefined,
          createRaw: respData ?? null,
        },
        {
          status:
            status === 429
              ? 503
              : status >= 400 && status < 600
              ? status
              : 502,
        }
      );
    }

    const createJson = createResp.data ?? {};
    const taskId = createJson.id || createJson.task_id || createJson.video_id;
    if (!taskId) {
      return NextResponse.json(
        {
          success: false,
          error: "创建任务成功但未找到 id/task_id/video_id",
          createRaw: createJson,
        },
        { status: 502 }
      );
    }
    console.log(`[AgnesFlash/gen] task created → id=${taskId}`);

    // ===== 2. 轮询 URL =====
    let pollUrl: string;
    if (isOfficial) {
      pollUrl = `https://apihub.agnes-ai.com/agnesapi?video_id=${encodeURIComponent(
        String(taskId)
      )}&model_name=agnes-video-2.5-flash`;
    } else {
      const rawBase = baseUrl.replace(/\/+$/, "");
      const hostBase = rawBase.endsWith("/v1") ? rawBase.slice(0, -3) : rawBase;
      pollUrl = `${hostBase}/v1/videos/${encodeURIComponent(String(taskId))}`;
    }

    const startTs = Date.now();
    const endTs = startTs + pollTimeoutSec * 1000;
    let attempt = 0;
    let lastPoll: any = null;

    while (Date.now() < endTs) {
      attempt += 1;
      const delay = attempt === 1 ? Math.max(3000, pollIntervalMs) : pollIntervalMs;
      await new Promise((r) => setTimeout(r, delay));

      let pollResp: axios.AxiosResponse;
      try {
        pollResp = await retryAxios(
          {
            method: "GET",
            url: pollUrl,
            headers: { Authorization: `Bearer ${apiKey}` },
            responseType: "json",
          },
          `poll#${attempt}`,
          2 // 轮询节点只重试 2 次（避免整体慢）
        );
      } catch (e: any) {
        if (attempt % 15 === 0) {
          const status = e?.response?.status ?? 0;
          console.warn(
            `[AgnesFlash/gen] poll #${attempt} err HTTP ${status || "?"}: ${(
              e?.message || ""
            ).slice(0, 120)}`
          );
        }
        continue;
      }
      const pollJson = pollResp.data ?? {};
      lastPoll = pollJson;

      const status = String(
        pollJson?.status || pollJson?.data?.status || pollJson?.task_status || ""
      ).toLowerCase();
      const progress = typeof pollJson?.progress === "number" ? pollJson.progress : null;

      if (pollResp.status === 400 && pollJson?.code === "task_not_exist" && attempt < 5) {
        continue;
      }

      // 成功
      if (
        status === "completed" ||
        status === "succeeded" ||
        status === "success" ||
        status === "done"
      ) {
        const videoUrl = extractVideoUrl(pollJson);
        console.log(
          `[AgnesFlash/gen] ✅ completed after ${attempt} polls, ` +
            `elapsed ${((Date.now() - startTs) / 1000).toFixed(1)}s, url=${
              videoUrl ? "FOUND" : "MISSING"
            }`
        );
        return NextResponse.json({
          success: true,
          data: {
            id: taskId,
            status: "completed",
            progress: 100,
            videoUrl,
            raw: pollJson,
          },
        });
      }

      // 失败
      if (
        ["failed", "failure", "error", "cancelled", "canceled", "expired"].includes(status)
      ) {
        const err =
          pollJson?.error?.message ||
          pollJson?.error?.detail ||
          pollJson?.detail ||
          pollJson?.message ||
          pollJson?.error_description ||
          (typeof pollJson?.error === "string" ? pollJson.error : null) ||
          `任务状态 = ${status}`;
        console.error(`[AgnesFlash/gen] ❌ task failed: ${err}`);
        return NextResponse.json(
          {
            success: false,
            error: err,
            id: taskId,
            status,
            raw: pollJson,
          },
          { status: 422 }
        );
      }

      if (attempt === 1 || attempt % 15 === 0) {
        const pct = progress != null ? ` (${progress}%)` : "";
        console.log(
          `[AgnesFlash/gen] poll #${attempt} status=${status || "?"}${pct} elapsed=${(
            (Date.now() - startTs) /
            1000
          ).toFixed(0)}s`
        );
      }
    }

    // 超时
    console.error(
      `[AgnesFlash/gen] ⏰ timeout after ${pollTimeoutSec}s (${attempt} polls). id=${taskId}`
    );
    return NextResponse.json(
      {
        success: false,
        error: `轮询超时（${pollTimeoutSec} 秒未完成）`,
        id: taskId,
        lastPoll,
      },
      { status: 504 }
    );
  } catch (e: any) {
    console.error(`[AgnesFlash/gen] route error:`, e);
    return NextResponse.json(
      { success: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
