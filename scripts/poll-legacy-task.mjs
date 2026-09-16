#!/usr/bin/env node
/**
 * 不创建新任务，只轮询之前的遗留任务：
 *   - 创建时返回 id: task_dU82QTIGGty6kbVP63u34cFYGAt8N53z
 *   - 查询时被映射成了内部 video_id: task_3z5mrvAxlRL74qz5uLTzfpo0ltnkhYLj
 * 看看真实的 completed 响应结构。
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
const BASE = "https://www.csjlm.app";

const IDS_TO_TRY = [
  "task_dU82QTIGGty6kbVP63u34cFYGAt8N53z",       // 创建响应 id
  "task_3z5mrvAxlRL74qz5uLTzfpo0ltnkhYLj",       // 轮询时看到的内部 video_id / task_id
];

async function main() {
  if (!KEY) {
    console.error("no key");
    process.exit(1);
  }
  const http = axios.create({ timeout: 60_000 });

  for (const id of IDS_TO_TRY) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🔍 轮询 id = ${id}  (最多 10 次，间隔 2.5s)`);
    for (let i = 0; i < 10; i++) {
      try {
        const resp = await http.get(`${BASE}/v1/videos/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${KEY}` },
        });
        const status = String(resp.data?.status || "?").toLowerCase();
        const progress = resp.data?.progress ?? "-";
        console.log(`   #${i + 1} → status=${status} progress=${progress}`);
        // 完整 dump 一次响应，当状态不是 in_progress / queued 时
        if (
          status !== "in_progress" &&
          status !== "queued" &&
          status !== "processing"
        ) {
          console.log(
            "   📦 完整响应:\n",
            JSON.stringify(resp.data, null, 2)
              .split("\n")
              .map((l) => "        " + l)
              .join("\n")
          );
          break;
        }
        if (status === "completed" || status === "success" || status === "succeeded") {
          // 尝试抽任何 mp4
          const raw = JSON.stringify(resp.data);
          const mp4s = raw.match(/https?:\/\/[^"'\\\s]+\.mp4[^"'\\\s]*/g) || [];
          console.log("   🔗 检测到的 mp4 URL:");
          if (mp4s.length) mp4s.forEach((u) => console.log("      -", u.replace(/,$/, "")));
          else console.log("      (none)");
          break;
        }
      } catch (e) {
        const s = e?.response?.status;
        const d = e?.response?.data;
        console.log(
          `   #${i + 1} FAIL HTTP ${s ?? "?"}:`,
          JSON.stringify(d ?? e.message).slice(0, 200)
        );
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  console.log("\n🏁 Done");
}
main().catch(console.error);
