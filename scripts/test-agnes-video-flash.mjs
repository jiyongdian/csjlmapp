#!/usr/bin/env node
/**
 * Agnes Video 2.5 Flash 接口直连测试脚本
 * 用法：node scripts/test-agnes-video-flash.mjs
 *
 * 会依次尝试：
 *   1) 使用官方接口 https://apihub.agnes-ai.com/v1
 *   2) 使用代理接口 https://www.csjlm.app/v1
 *   直到有一个成功创建并完成任务为止
 */
import * as dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";

// 从项目根目录加载 .env 和 .env.local
const ROOT = path.resolve(process.cwd());
for (const f of [".env", ".env.local"]) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) dotenv.config({ path: p, override: true });
}

const TEST_PROMPT =
  "雨后的未来城市街道，霓虹灯倒映在湿润的地面，一辆银色跑车缓慢驶过，电影级运镜，自然环境声，4k 高清，慢动作";
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractVideoUrl(respJson) {
  const candidates = [
    respJson?.url,
    respJson?.video_url,
    respJson?.data?.url,
    respJson?.data?.video_url,
    respJson?.output,
    respJson?.data?.output,
  ];
  if (Array.isArray(respJson?.data)) {
    const first = respJson.data[0];
    if (first) candidates.push(first.url, first.video_url, first.output);
  }
  if (Array.isArray(respJson?.output)) {
    candidates.push(respJson.output[0]?.url, respJson.output[0]?.video_url);
  }
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//i.test(c)) return c;
  }
  return "";
}

async function testEndpoint({ name, apiKey, baseUrl, pollBaseOverride }) {
  console.log(`\n${"=".repeat(64)}`);
  console.log(`🧪 测试通道: ${name}`);
  console.log(`   Base URL: ${baseUrl}`);
  console.log(`   API Key : ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);
  console.log(`${"=".repeat(64)}\n`);

  // ========== Step 1: 创建任务 ==========
  const createUrl = baseUrl.endsWith("/") ? `${baseUrl}videos` : `${baseUrl}/videos`;
  const createBody = {
    model: "agnes-video-2.5-flash",
    prompt: TEST_PROMPT,
    mode: "text",
    seconds: "5",
    size: "720P",
    aspect_ratio: "16:9",
    n: 1,
  };
  console.log("📤 [1/3] 创建任务 →", createUrl);
  console.log("     body:", JSON.stringify(createBody, null, 2).split("\n").map((l, i) => i === 0 ? l : "           " + l).join("\n"));

  let createResp, createJson;
  try {
    createResp = await fetch(createUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(createBody),
    });
    const txt = await createResp.text();
    try {
      createJson = txt ? JSON.parse(txt) : {};
    } catch {
      createJson = { raw: txt };
    }
  } catch (e) {
    console.log("❌ 创建任务时网络异常：", e.message || e);
    return { ok: false, reason: "network", error: e.message || String(e) };
  }

  console.log(`     HTTP ${createResp.status}`);
  if (!createResp.ok) {
    const detail =
      createJson?.detail ||
      createJson?.error?.message ||
      createJson?.message ||
      JSON.stringify(createJson);
    console.log("❌ 创建任务失败：", detail);
    // 如果是 401/403，基本就是 key 不对；size/images/videos 的 400 表示接口是通的只是参数
    return { ok: false, reason: "create", httpStatus: createResp.status, error: detail };
  }

  console.log("✅ 创建成功，原始响应：");
  console.log(
    "    ",
    JSON.stringify(createJson, null, 2)
      .split("\n")
      .join("\n     ")
  );

  const videoId = createJson.video_id || createJson.id || createJson.task_id;
  if (!videoId) {
    console.log("❌ 创建响应中找不到 video_id / id / task_id");
    return { ok: false, reason: "noid" };
  }
  console.log(`\n🎬 video_id = ${videoId}`);

  // ========== Step 2: 轮询任务 ==========
  const pollBase = pollBaseOverride || "https://apihub.agnes-ai.com";
  // 按文档推荐：所有模式都带上 model_name
  const pollUrl = `${pollBase}/agnesapi?video_id=${encodeURIComponent(
    String(videoId)
  )}&model_name=agnes-video-2.5-flash`;

  console.log(`\n🔍 [2/3] 轮询任务 → ${pollBase}/agnesapi?video_id=***`);
  console.log(`     间隔 ${POLL_INTERVAL_MS}ms，最长 ${POLL_TIMEOUT_MS / 1000}s`);

  const startTs = Date.now();
  let attempts = 0;
  let lastPoll = null;
  while (Date.now() - startTs < POLL_TIMEOUT_MS) {
    attempts += 1;
    await sleep(POLL_INTERVAL_MS);
    let resp, json;
    try {
      resp = await fetch(pollUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const txt = await resp.text();
      try {
        json = txt ? JSON.parse(txt) : {};
      } catch {
        json = { raw: txt };
      }
    } catch (e) {
      process.stdout.write(`.`);
      continue;
    }
    lastPoll = json;

    if (!resp.ok) {
      // Flash 专属校验错误
      if (
        resp.status === 400 &&
        typeof json?.detail === "string" &&
        /size must be|images length must not exceed|videos is not supported/.test(json.detail)
      ) {
        console.log(`\n❌ 参数错误：${json.detail}`);
        return { ok: false, reason: "param", error: json.detail };
      }
      // 401/403 在查询阶段也可能出现
      if (resp.status === 401 || resp.status === 403) {
        console.log(`\n❌ 轮询鉴权失败 HTTP ${resp.status}：`, JSON.stringify(json).slice(0, 300));
        return { ok: false, reason: "auth", httpStatus: resp.status, error: json };
      }
      process.stdout.write(`?`);
      continue;
    }

    const statusRaw = json.status || json.data?.status || "";
    const status = typeof statusRaw === "string" ? statusRaw : "?";

    if (status === "completed" || status === "SUCCESS" || status === "succeeded") {
      const videoUrl = extractVideoUrl(json);
      console.log(`\n✅ [3/3] 生成成功！用时 ${((Date.now() - startTs) / 1000).toFixed(1)}s，轮询 ${attempts} 次`);
      console.log(`   🎞️  视频 URL: ${videoUrl || "(未找到，下面是原始响应)"}`);
      console.log(
        "   📦 完整响应:",
        JSON.stringify(json, null, 2)
          .split("\n")
          .map((l) => "            " + l)
          .join("\n")
      );
      return { ok: true, videoId, videoUrl, raw: json };
    }

    const fail = ["failed", "error", "cancelled", "canceled", "expired"];
    if (status && fail.includes(status.toLowerCase())) {
      const err =
        json?.error?.message || json?.detail || json?.message || status;
      console.log(`\n❌ 任务失败：${err}`);
      console.log("   原始响应：", JSON.stringify(json).slice(0, 800));
      return { ok: false, reason: "task", status, error: err, raw: json };
    }

    // 进度显示
    if (attempts === 1 || attempts % 10 === 0) {
      process.stdout.write(`\n     #${attempts} status=${status} `);
    } else {
      process.stdout.write(`.`);
    }
  }

  console.log(`\n⏰ 超时（${POLL_TIMEOUT_MS / 1000}s），最后一次轮询：`);
  console.log(JSON.stringify(lastPoll, null, 2).slice(0, 1000));
  return { ok: false, reason: "timeout", videoId };
}

function pickKeys() {
  // 优先级：AGNES_API_KEY → OPENAI_API_KEY → DEEPSEEK_API_KEY
  const key =
    process.env.AGNES_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    "";
  return key.trim();
}

async function main() {
  const key = pickKeys();
  if (!key) {
    console.error("❌ 未找到任何 API Key。请在 .env.local 中设置 AGNES_API_KEY 或 OPENAI_API_KEY");
    process.exit(1);
  }

  console.log("🎬 Agnes Video 2.5 Flash 连通性 + 生成测试");
  console.log("   提示词 :", TEST_PROMPT);
  console.log("   时长   : 5s");
  console.log("   分辨率 : 720P");
  console.log("   比例   : 16:9");

  const channels = [
    // 通道 1：代理接口（和 .env.local 保持一致，优先尝试）
    {
      name: "代理接口 www.csjlm.app (创建 + 轮询)",
      apiKey: key,
      baseUrl: "https://www.csjlm.app/v1",
      // 有些代理把轮询也挂在自己域名下，所以尝试两种
      pollBaseOverride: "https://www.csjlm.app",
    },
    // 通道 2：代理创建 + 官方轮询（有些代理只是转发创建，查结果仍去官方）
    {
      name: "代理接口创建 + 官方 apihub 轮询",
      apiKey: key,
      baseUrl: "https://www.csjlm.app/v1",
      pollBaseOverride: "https://apihub.agnes-ai.com",
    },
    // 通道 3：官方接口全链路
    {
      name: "官方接口 apihub.agnes-ai.com (创建 + 轮询)",
      apiKey: key,
      baseUrl: "https://apihub.agnes-ai.com/v1",
      pollBaseOverride: "https://apihub.agnes-ai.com",
    },
  ];

  const results = [];
  for (const ch of channels) {
    const r = await testEndpoint(ch);
    results.push({ channel: ch.name, ...r });
    if (r.ok) {
      console.log(`\n🎉 通道「${ch.name}」全部通过！`);
      break;
    } else {
      console.log(`\n⚠️  通道「${ch.name}」失败，原因 = ${r.reason}`);
    }
  }

  console.log("\n" + "=".repeat(64));
  console.log("📋 测试总览：");
  for (const r of results) {
    const icon = r.ok ? "✅" : "❌";
    const info = r.ok
      ? `URL: ${r.videoUrl.slice(0, 60)}${r.videoUrl.length > 60 ? "..." : ""}`
      : `reason=${r.reason} error=${String(r.error ?? "").slice(0, 80)}`;
    console.log(`  ${icon} ${r.channel}  →  ${info}`);
  }
  console.log("=".repeat(64));

  const anyOk = results.some((r) => r.ok);
  process.exit(anyOk ? 0 : 2);
}

main().catch((e) => {
  console.error("❌ 未处理异常：", e);
  process.exit(99);
});
