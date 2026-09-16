#!/usr/bin/env node
/**
 * 快速调试：创建任务后立刻用多种 URL 格式查询一次状态
 */
import * as dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";

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

async function run() {
  if (!KEY) {
    console.error("no key");
    process.exit(1);
  }

  // 创建任务（代理接口，用 2.5 Flash 新格式）
  const createUrl = `${PROXY_BASE}/v1/videos`;
  const body = {
    model: "agnes-video-2.5-flash",
    prompt: "阳光明媚的公园，一只金毛犬追逐飞盘，镜头跟随，自然光影",
    mode: "text",
    seconds: "4",
    size: "720P",
    aspect_ratio: "16:9",
    n: 1,
  };
  console.log("POST", createUrl);
  console.log("body =", JSON.stringify(body));
  const r = await fetch(createUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  console.log(`\nHTTP ${r.status}`);
  console.log("create response:");
  console.log(txt);
  let data;
  try {
    data = JSON.parse(txt);
  } catch {
    data = { raw: txt };
  }

  const taskId = data?.video_id || data?.id || data?.task_id;
  if (!taskId) {
    console.log("\n❌ 没有 task id");
    return;
  }
  console.log("\n✅ taskId =", taskId, "\n");

  // 用 8 种不同 URL 各查一次
  const probes = [
    ["[A1] /agnesapi?video_id=ID&model_name=2.5-flash", `${PROXY_BASE}/agnesapi?video_id=${encodeURIComponent(taskId)}&model_name=agnes-video-2.5-flash`],
    ["[A2] /agnesapi?video_id=ID",                       `${PROXY_BASE}/agnesapi?video_id=${encodeURIComponent(taskId)}`],
    ["[A3] /agnesapi?id=ID&model_name=2.5-flash",        `${PROXY_BASE}/agnesapi?id=${encodeURIComponent(taskId)}&model_name=agnes-video-2.5-flash`],
    ["[A4] /agnesapi?task_id=ID",                        `${PROXY_BASE}/agnesapi?task_id=${encodeURIComponent(taskId)}`],
    ["[B1] /v1/videos/ID",                               `${PROXY_BASE}/v1/videos/${encodeURIComponent(taskId)}`],
    ["[B2] /videos/ID",                                  `${PROXY_BASE}/videos/${encodeURIComponent(taskId)}`],
    ["[B3] /v1/videos?video_id=ID",                      `${PROXY_BASE}/v1/videos?video_id=${encodeURIComponent(taskId)}`],
    ["[C1] /v1/tasks/ID  (通用代理 tasks 端点)",         `${PROXY_BASE}/v1/tasks/${encodeURIComponent(taskId)}`],
    ["[C2] /v1/async-tasks/ID",                          `${PROXY_BASE}/v1/async-tasks/${encodeURIComponent(taskId)}`],
  ];

  for (const [label, url] of probes) {
    try {
      const t0 = Date.now();
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${KEY}` },
      });
      const body2 = await resp.text();
      const dt = Date.now() - t0;
      const status = resp.status;
      const snippet = body2.length > 400 ? body2.slice(0, 400) + `...[truncated ${body2.length}B]` : body2;
      console.log(`\n${label}`);
      console.log(`   → ${url.split("?")[0]}?${url.split("?")[1] ? "..." : ""} (${dt}ms HTTP ${status})`);
      console.log(`   ← ${snippet}`);
    } catch (e) {
      console.log(`\n${label}  💥 network err: ${e.message}`);
    }
  }
}

run().catch((e) => console.error(e));
