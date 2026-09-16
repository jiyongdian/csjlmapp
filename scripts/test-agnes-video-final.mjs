#!/usr/bin/env node
/**
 * Agnes Video 2.5 Flash 最终版测试 —— 使用正确的轮询端点
 *   创建：POST {base}/v1/videos
 *   查询：GET  {base}/v1/videos/{id}  (NewAPI 代理格式)
 */
import * as dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";
import axios from "axios";

const ROOT = path.resolve(process.cwd());
for (const f of [".env", ".env.local"]) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) dotenv.config({ path: p, override: true });
}

const KEY =
  process.env.AGNES_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.DEEPSEEK_API_KEY ||
  "";

const PROXY_BASE = "https://www.csjlm.app";
const POLL_INTERVAL = 2500; // ms
const POLL_TIMEOUT = 6 * 60 * 1000; // 6 分钟

const http = axios.create({ timeout: 90_000 });

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickVideoUrl(payload) {
  if (!payload || typeof payload !== "object") return "";
  const stack = [payload];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (
          (k.toLowerCase().includes("url") ||
            k.toLowerCase() === "video" ||
            k.toLowerCase() === "output" ||
            k.toLowerCase() === "download") &&
          typeof v === "string" &&
          /^https?:\/\/.+\.(mp4|webm|mov|m3u8|m4v)(\?|$)/i.test(v)
        ) {
          return v;
        }
        if (typeof v === "string" && /^https?:\/\/.+/i.test(v)) {
          // 宽松匹配：包含 video/download 的路径
          const lower = v.toLowerCase();
          if (/(video|clip|output|download|media|result)/.test(lower) || lower.endsWith('.mp4')) return v;
        }
        if (v && typeof v === "object") stack.push(v);
      }
    }
  }
  // 最后找任何 mp4 URL
  const raw = JSON.stringify(payload);
  const m = raw.match(/https?:\/\/[^"'\\\s]+\.mp4[^"'\\\s]*/g);
  if (m && m[0]) return m[0].replace(/,$/, "");
  return "";
}

async function main() {
  if (!KEY) {
    console.error("❌ 没有 API Key");
    process.exit(1);
  }

  console.log("🎬 Agnes Video 2.5 Flash —— 代理接口测试（NewAPI /v1/videos 风格）");
  console.log("   Base :", PROXY_BASE);
  console.log("   Key  :", KEY.slice(0, 8), "...", KEY.slice(-4));

  // ===== 1. 创建任务 =====
  const createBody = {
    model: "agnes-video-2.5-flash",
    prompt:
      "雨后的未来城市街道，霓虹灯倒映在湿润的地面，一辆银色跑车缓慢驶过，电影级运镜，自然环境声，4k 高清，慢动作",
    mode: "text",
    seconds: "5",
    size: "720P",
    aspect_ratio: "16:9",
    n: 1,
  };
  console.log("\n📤 [1/3] 创建任务 → POST /v1/videos");
  let createResp;
  try {
    createResp = await http.post(`${PROXY_BASE}/v1/videos`, createBody, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
    });
  } catch (e) {
    const s = e?.response?.status;
    const d = e?.response?.data;
    console.error(`❌ 创建失败 HTTP ${s ?? "?"}:\n`, JSON.stringify(d ?? e.message, null, 2));
    process.exit(1);
  }
  console.log(`   HTTP ${createResp.status}`);
  console.log(
    "   响应:",
    JSON.stringify(createResp.data, null, 2).split("\n").join("\n        ")
  );
  const taskId = createResp.data?.id || createResp.data?.task_id || createResp.data?.video_id;
  if (!taskId) {
    console.error("❌ 未找到 id");
    process.exit(1);
  }
  console.log(`\n✅ 已创建，task id = ${taskId}`);

  // ===== 2. 轮询 =====
  console.log(`\n🔍 [2/3] 轮询任务 → GET /v1/videos/${taskId}`);
  console.log(`   间隔 ${POLL_INTERVAL}ms，最长 ${POLL_TIMEOUT / 1000}s`);
  const startTs = Date.now();
  const endTs = startTs + POLL_TIMEOUT;
  let attempt = 0;
  let lastResp = null;

  while (Date.now() < endTs) {
    attempt += 1;
    await sleep(attempt === 1 ? 4000 : POLL_INTERVAL);

    let resp;
    try {
      resp = await http.get(`${PROXY_BASE}/v1/videos/${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${KEY}` },
      });
    } catch (e) {
      const s = e?.response?.status;
      // 404 等瞬态错误，不直接退出
      process.stdout.write(`E`);
      if (attempt % 15 === 0) {
        process.stdout.write(`\n     #${attempt} 网络/HTTP err: ${s ?? e.message} `);
      }
      continue;
    }
    lastResp = resp.data;
    const status = String(resp.data?.status || "").toLowerCase();
    const progress = resp.data?.progress ?? null;

    if (status === "completed" || status === "success" || status === "succeeded" || status === "done") {
      const vUrl = pickVideoUrl(resp.data);
      console.log(`\n\n✅ [3/3] 完成！耗时 ${((Date.now() - startTs) / 1000).toFixed(1)}s，轮询 ${attempt} 次`);
      console.log(`   🎞️  视频 URL: ${vUrl || "(未找到，下面完整响应)"}`);
      console.log(
        "\n   📦 完整响应:\n",
        JSON.stringify(resp.data, null, 2).split("\n").map(l => "      " + l).join("\n")
      );
      if (vUrl) {
        console.log("\n" + "=".repeat(60));
        console.log("🎉 最终视频 URL:");
        console.log(vUrl);
        console.log("=".repeat(60));
      }
      process.exit(vUrl ? 0 : 1);
    }

    if (["failed", "error", "cancelled", "canceled", "expired"].includes(status)) {
      const err =
        resp.data?.error?.message ||
        resp.data?.error?.detail ||
        resp.data?.error_description ||
        resp.data?.detail ||
        resp.data?.message ||
        status;
      console.log(`\n❌ 任务失败: ${err}`);
      console.log("   完整响应:", JSON.stringify(resp.data).slice(0, 2000));
      process.exit(2);
    }

    // in_progress / queued / processing
    if (attempt === 1 || attempt % 8 === 0) {
      const pct = typeof progress === "number" ? ` (${progress}%)` : "";
      process.stdout.write(`\n     #${attempt} status=${status || "?"}${pct} `);
    } else {
      process.stdout.write(".");
    }
  }

  console.log(`\n\n⏰ 超时（${POLL_TIMEOUT / 1000}s）`);
  console.log("最后一次响应:", JSON.stringify(lastResp, null, 2).slice(0, 1500));
  process.exit(3);
}

main().catch((e) => {
  console.error("💥 FATAL:", e);
  process.exit(99);
});
