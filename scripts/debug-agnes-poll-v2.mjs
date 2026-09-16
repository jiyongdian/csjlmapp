#!/usr/bin/env node
/**
 * 调试 Agnes Video 2.5 Flash 创建 + 轮询端点
 * 使用 axios（更稳定）+ 重试
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

const axiosInstance = axios.create({
  timeout: 60_000,
  headers: {
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  },
  // 允许自签名/异常证书情况下仍尝试
  // httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false }),
});

async function withRetry(fn, name, retries = 3, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      const code = e?.code || e?.cause?.code || "";
      const msg = e?.message || String(e);
      console.log(`   [retry ${i + 1}/${retries}] ${name} fail: ${code} ${msg.slice(0, 120)}`);
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      } else {
        throw e;
      }
    }
  }
}

async function run() {
  if (!KEY) {
    console.error("no api key");
    process.exit(1);
  }

  // ===== 1. 创建任务 =====
  const createUrl = `${PROXY_BASE}/v1/videos`;
  const createBody = {
    model: "agnes-video-2.5-flash",
    prompt: "阳光明媚的公园，一只金毛犬追逐飞盘，镜头跟随，自然光影，4k 高清",
    mode: "text",
    seconds: "4",
    size: "720P",
    aspect_ratio: "16:9",
    n: 1,
  };
  console.log("\n📤 [1] 创建任务 POST", createUrl);
  console.log("     body =", JSON.stringify(createBody));

  let taskId;
  try {
    const resp = await withRetry(
      () => axiosInstance.post(createUrl, createBody),
      "create-task",
      4,
      3000
    );
    console.log(`\n✅ HTTP ${resp.status}. 创建响应:`);
    console.log(JSON.stringify(resp.data, null, 2));
    taskId = resp.data?.video_id || resp.data?.id || resp.data?.task_id;
    if (!taskId) {
      console.log("❌ 没拿到任务 id。检查响应中有无其他字段。");
      return;
    }
    console.log("\n🎯 taskId =", taskId);
  } catch (e) {
    const status = e?.response?.status;
    const body = e?.response?.data || e?.cause || e?.message;
    console.log(`❌ 创建失败 HTTP ${status ?? "?"}:`, JSON.stringify(body).slice(0, 800));
    return;
  }

  // ===== 2. 先等待 10 秒再开始查（否则可能 404，任务还未落库） =====
  console.log("\n⏱ 等待 12 秒让任务进入队列...");
  await new Promise((r) => setTimeout(r, 12000));

  // ===== 3. 各个端点探测 =====
  const probes = [
    ["A1 /agnesapi?video_id=ID&model_name=agnes-video-2.5-flash", `${PROXY_BASE}/agnesapi?video_id=${encodeURIComponent(taskId)}&model_name=agnes-video-2.5-flash`],
    ["A2 /agnesapi?video_id=ID",                       `${PROXY_BASE}/agnesapi?video_id=${encodeURIComponent(taskId)}`],
    ["A3 /agnesapi?id=ID&model_name=2.5-flash",        `${PROXY_BASE}/agnesapi?id=${encodeURIComponent(taskId)}&model_name=agnes-video-2.5-flash`],
    ["A4 /agnesapi?task_id=ID&model=2.5-flash",        `${PROXY_BASE}/agnesapi?task_id=${encodeURIComponent(taskId)}&model=agnes-video-2.5-flash`],
    ["B1 /v1/videos/ID",                               `${PROXY_BASE}/v1/videos/${encodeURIComponent(taskId)}`],
    ["B2 /v1/videos?video_id=ID",                      `${PROXY_BASE}/v1/videos?video_id=${encodeURIComponent(taskId)}`],
    ["B3 /videos/ID",                                  `${PROXY_BASE}/videos/${encodeURIComponent(taskId)}`],
    ["C1 /v1/tasks/ID",                                `${PROXY_BASE}/v1/tasks/${encodeURIComponent(taskId)}`],
    ["C2 /tasks/ID",                                   `${PROXY_BASE}/tasks/${encodeURIComponent(taskId)}`],
    ["C3 /v1/operations/ID  (OpenAI operation style)",`${PROXY_BASE}/v1/operations/${encodeURIComponent(taskId)}`],
  ];

  for (const [label, url] of probes) {
    try {
      const t0 = Date.now();
      const resp = await withRetry(
        () =>
          axios.get(url, {
            headers: { Authorization: `Bearer ${KEY}` },
            timeout: 30_000,
          }),
        label.split(" ")[0],
        2,
        2500
      );
      const dt = Date.now() - t0;
      const body = resp.data;
      const pretty = JSON.stringify(body);
      const short = pretty.length > 500 ? pretty.slice(0, 500) + ` …(${pretty.length}B total)` : pretty;
      console.log(`\n✅ ${label}`);
      console.log(`   HTTP ${resp.status} (${dt}ms) → ${short}`);
    } catch (e) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      const dataStr =
        typeof data === "string"
          ? data.slice(0, 300)
          : data != null
          ? JSON.stringify(data).slice(0, 300)
          : "";
      const net = e?.code || e?.cause?.code || e?.message?.slice(0, 120);
      console.log(`\n❌ ${label}`);
      console.log(
        `   ${status != null ? `HTTP ${status} ` : ""}${dataStr || String(net).slice(0, 200)}`
      );
    }
  }

  console.log("\n🎉 探测结束");
}

run().catch((e) => {
  console.error("\n💥 FATAL:", e);
  process.exit(99);
});
