import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

/**
 * Agnes Video 2.5 Flash - 查询任务状态
 * GET /api/agnes-video/status?id=xxx
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

const http = axios.create({ timeout: 90_000 });

async function pollWithRetry(url: string, apiKey: string, label: string) {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await http.get(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        responseType: "json",
      });
    } catch (e: any) {
      lastErr = e;
      const code = e?.code || e?.cause?.code || "";
      const retryable =
        /CONNECT|ECONN|ETIMEDOUT|UND_ERR|TLS|EPIPE|ERR_SOCKET|EAI_AGAIN/i.test(code) ||
        /fetch failed|connect timeout|network error|socket hang up/i.test(e?.message || "") ||
        (e?.response?.status ?? 0) === 429 ||
        (e?.response?.status ?? 0) >= 500;
      if (!retryable || attempt === 3) break;
      console.warn(
        `[AgnesFlash/status] 重试 ${attempt}/3 ${label} (${code || (e?.message || "").slice(0, 80)})`
      );
      await new Promise((r) => setTimeout(r, 2000 * attempt));
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
    const first = p.output[0];
    candidates.push(first?.url, first?.video_url, first?.download_url);
  }
  if (Array.isArray(p?.data)) {
    const first = p.data[0];
    candidates.push(first?.url, first?.video_url, first?.metadata?.url);
  }
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//i.test(c)) return c;
  }
  const raw = JSON.stringify(p);
  const m = raw.match(/https?:\/\/[^"'\\\s]+\.mp4[^"'\\\s]*/g);
  if (m && m[0]) return m[0].replace(/[,}\]]+$/, "");
  return "";
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { success: false, error: "id 必填（创建接口返回的 data.id）" },
        { status: 400 }
      );
    }

    const { apiKey, baseUrl } = getCredentials();
    const isOfficial = /agnes-ai\.com/i.test(baseUrl);

    let pollUrl: string;
    if (isOfficial) {
      pollUrl = `https://apihub.agnes-ai.com/agnesapi?video_id=${encodeURIComponent(
        id
      )}&model_name=agnes-video-2.5-flash`;
    } else {
      const rawBase = baseUrl.replace(/\/+$/, "");
      const hostBase = rawBase.endsWith("/v1") ? rawBase.slice(0, -3) : rawBase;
      pollUrl = `${hostBase}/v1/videos/${encodeURIComponent(id)}`;
    }

    console.log(
      `[AgnesFlash/status] ${isOfficial ? "OFFICIAL" : "PROXY"} → ${
        pollUrl.split("?")[0]
      }?...`
    );

    let resp: axios.AxiosResponse;
    try {
      resp = await pollWithRetry(pollUrl, apiKey, "poll");
    } catch (e: any) {
      const respData = e?.response?.data;
      const status = e?.response?.status ?? 0;
      const err =
        respData?.error?.message ||
        respData?.error?.detail ||
        respData?.detail ||
        respData?.message ||
        respData?.code ||
        e?.message ||
        `HTTP ${status || "?"}`;
      if (respData?.code === "task_not_exist") {
        return NextResponse.json(
          {
            success: false,
            error:
              "task_not_exist：请确认查询的是创建接口返回的 data.id，而不是内部的 task_id / video_id",
            raw: respData,
          },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { success: false, error: err, httpStatus: status || undefined, raw: respData ?? null },
        { status: status >= 400 && status < 600 ? status : 502 }
      );
    }

    const respJson = resp.data ?? {};
    const status = String(
      respJson?.status || respJson?.data?.status || respJson?.task_status || ""
    ).toLowerCase();

    const successStatuses = ["completed", "succeeded", "success", "done"];
    const failStatuses = ["failed", "failure", "error", "cancelled", "canceled", "expired"];
    const isSuccess = successStatuses.includes(status);
    const isFail = failStatuses.includes(status);
    const isTerminal = isSuccess || isFail;

    const videoUrl = extractVideoUrl(respJson);

    let errMsg: string | undefined;
    if (isFail) {
      errMsg =
        respJson?.error?.message ||
        respJson?.error?.detail ||
        respJson?.detail ||
        respJson?.message ||
        respJson?.error_description ||
        (typeof respJson?.error === "string" ? respJson.error : undefined) ||
        `任务状态 = ${status}`;
    }

    return NextResponse.json({
      success: true,
      data: {
        id,
        status: status || "unknown",
        progress:
          typeof respJson?.progress === "number" ? respJson.progress : undefined,
        is_terminal: isTerminal,
        is_success: isSuccess,
        is_fail: isFail,
        videoUrl: isSuccess ? videoUrl : "",
        error: errMsg,
        raw: respJson,
      },
    });
  } catch (e: any) {
    console.error(`[AgnesFlash/status] route error:`, e);
    return NextResponse.json(
      { success: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
