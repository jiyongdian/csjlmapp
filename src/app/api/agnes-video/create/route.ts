import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

/**
 * Agnes Video 2.5 Flash - 创建视频任务
 * POST /api/agnes-video/create
 *
 * 使用 axios 替换原生 fetch（避免 Next.js undici 10s connect 超时），
 * 并内置 3 次重试。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

function isOfficialBase(baseUrl: string): boolean {
  return /agnes-ai\.com/i.test(baseUrl);
}

// 带重试的 axios 实例
const http = axios.create({
  timeout: 120_000,
  headers: { "Accept-Encoding": "gzip, deflate" },
});

async function requestWithRetry(config: axios.AxiosRequestConfig, name: string) {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await http.request(config);
    } catch (e: any) {
      lastErr = e;
      const code =
        e?.code || e?.cause?.code || e?.err?.code || "";
      const msg = e?.message || String(e);
      // 以下情况重试：连接超时/重置、TLS 错误、网络未达、429 限流
      const retryable =
        /CONNECT|ECONN|ETIMEDOUT|UND_ERR|TLS|EPIPE|ERR_SOCKET|EAI_AGAIN/i.test(code) ||
        /fetch failed|connect timeout|network error|socket hang up/i.test(msg) ||
        (e?.response?.status ?? 0) === 429 ||
        (e?.response?.status ?? 0) >= 500;
      if (!retryable || attempt === 3) break;
      console.warn(
        `[AgnesFlash/create] 重试 ${attempt}/3 ${name} (${code || msg.slice(0, 80)})`
      );
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
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
      ["text", "keyframe", "reference"].includes(body?.mode)
        ? body.mode
        : "text";
    const rawSeconds = body.seconds ?? 5;
    const seconds =
      typeof rawSeconds === "number"
        ? String(Math.max(4, Math.min(12, Math.round(rawSeconds))))
        : String(rawSeconds);
    const aspect_ratio = body.aspect_ratio || "16:9";

    const { apiKey, baseUrl } = getCredentials();
    const official = isOfficialBase(baseUrl);

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

    const createUrl = baseUrl.endsWith("/")
      ? `${baseUrl}videos`
      : `${baseUrl}/videos`;

    console.log(
      `[AgnesFlash/create] ${official ? "OFFICIAL" : "PROXY"} mode=${mode} ` +
        `seconds=${payload.seconds} ratio=${aspect_ratio} → ${createUrl}`
    );

    let resp: axios.AxiosResponse;
    try {
      resp = await requestWithRetry(
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
        "create"
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
        `[AgnesFlash/create] FAIL HTTP ${status || "?"}: ${String(detail).slice(0, 200)}`
      );
      return NextResponse.json(
        {
          success: false,
          error: detail,
          httpStatus: status || undefined,
          raw: respData ?? { raw_error: e?.message },
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

    const respJson = resp.data ?? {};
    const taskId = respJson.video_id || respJson.id || respJson.task_id || null;

    return NextResponse.json({
      success: true,
      data: {
        id: taskId,
        task_id: respJson.task_id || null,
        video_id: respJson.video_id || null,
        initial_status: respJson.status || null,
        poll_style: official ? "agnesapi-query" : "videos-by-id",
        poll_hint: official
          ? `GET /agnesapi?video_id=${taskId}&model_name=agnes-video-2.5-flash (at apihub.agnes-ai.com)`
          : `GET {base}/v1/videos/${taskId}`,
        raw: respJson,
      },
    });
  } catch (e: any) {
    console.error(`[AgnesFlash/create] route error:`, e);
    return NextResponse.json(
      { success: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
