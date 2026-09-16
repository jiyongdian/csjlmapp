#!/usr/bin/env node
/**
 * 通过 localhost:5000 调用我们封装好的 Next.js API 路由测试：
 *  1) create → 确认 200 + id
 *  2) (如果 429，退回到 status 路由验证已存在任务)
 *  3) 最后调 generate 一键生成拿 mp4
 */
import axios from "axios";

const API = "http://localhost:5000/api/agnes-video";
const http = axios.create({ timeout: 600_000 }); // 10 分钟（generate 会阻塞）

async function main() {
  const PROMPT =
    "傍晚的薰衣草花田，金色夕阳从云层中洒下，一位穿白色连衣裙的女孩张开双臂迎风转圈，头发飘动，电影级追焦，温暖治愈，4K高清";
  const EXISTING_ID = "task_dU82QTIGGty6kbVP63u34cFYGAt8N53z";

  console.log("=".repeat(64));
  console.log("🧪 步骤1：验证 status 路由（旧任务）—— 确认 Next/axios 链路正常");
  {
    const r = await http.get(`${API}/status?id=${EXISTING_ID}`);
    console.log(`   HTTP ${r.status}`);
    const d = r.data;
    console.log(
      `   success=${d.success} status=${d.data?.status} is_success=${d.data?.is_success}`
    );
    if (d.data?.videoUrl) {
      console.log(`   ✅ videoUrl = ${d.data.videoUrl.slice(0, 100)}...`);
    } else {
      console.log(`   ❌ 没找到 URL，raw=${JSON.stringify(d.data?.raw).slice(0, 300)}`);
      process.exit(1);
    }
  }

  console.log("\n" + "=".repeat(64));
  console.log("🧪 步骤2：create 路由（创建新任务）——验证 axios 创建不再连接超时");
  let createdId = null;
  try {
    const r = await http.post(
      `${API}/create`,
      {
        prompt: PROMPT,
        mode: "text",
        seconds: 5,
        aspect_ratio: "16:9",
      },
      { timeout: 180_000 }
    );
    console.log(`   HTTP ${r.status}`);
    const d = r.data;
    if (d.success) {
      createdId = d.data.id;
      console.log(`   ✅ 新建任务 id=${createdId}, status=${d.data.initial_status}`);
      console.log(`      poll_style = ${d.data.poll_style}`);
      console.log(`      poll_hint  = ${d.data.poll_hint}`);
    } else {
      console.log(`   ❌ 创建失败: ${d.error}`);
      // 如果 429，不直接退出，后面继续用 generate 再试或用 status 验证
      if (d.httpStatus === 503 || /429|负载饱和/.test(String(d.error))) {
        console.log("   ⚠️  限流 429，跳过 create 测试（但 generate 路由会带重试）");
      } else {
        console.log("   原始响应:", JSON.stringify(d).slice(0, 600));
        process.exit(2);
      }
    }
  } catch (e) {
    const s = e?.response?.status;
    const body = JSON.stringify(e?.response?.data || e?.message);
    console.log(`   ❌ HTTP ${s || "?"} : ${body.slice(0, 500)}`);
    if (!/429|负载饱和|503/.test(body)) process.exit(2);
    console.log("   ⚠️  限流，继续下一步 generate 测试（内置重试会等）");
  }

  console.log("\n" + "=".repeat(64));
  console.log("🧪 步骤3：generate 一键生成（创建+轮询同步返回），最关键的验证");
  console.log(`   prompt=${PROMPT.slice(0, 40)}...`);
  console.log(`   duration=5s ratio=16:9 mode=text`);
  console.log(`   最长等待 9 分钟，这期间请耐心...`);
  const t0 = Date.now();
  try {
    const r = await http.post(
      `${API}/generate`,
      {
        prompt: PROMPT,
        mode: "text",
        seconds: 5,
        aspect_ratio: "16:9",
        poll_interval_ms: 2500,
        poll_timeout_sec: 540,
      },
      { timeout: 600_000 }
    );
    const d = r.data;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`\n   HTTP ${r.status}（耗时 ${elapsed}s）`);
    if (d.success) {
      console.log(`\n${"=".repeat(64)}`);
      console.log("🎉🎉🎉 generate 成功！！！");
      console.log(`   id        : ${d.data.id}`);
      console.log(`   status    : ${d.data.status}`);
      console.log(`   progress  : ${d.data.progress}%`);
      console.log(`   videoUrl  : ${d.data.videoUrl}`);
      console.log("=".repeat(64));
      // 验证 URL 可以被 HEAD 访问
      if (d.data.videoUrl) {
        console.log("\n🔗 验证视频 URL 可达性（HEAD）...");
        try {
          const head = await axios.head(d.data.videoUrl, { timeout: 30_000, maxRedirects: 5 });
          console.log(
            `   ✅ HTTP ${head.status}, Content-Length=${head.headers["content-length"] || "?"} bytes, Content-Type=${head.headers["content-type"] || "?"}`
          );
        } catch (e) {
          console.log(
            `   ⚠️  HEAD 失败（但不代表视频不能用，CDN 可能禁用 HEAD）: ${
              e?.response?.status || e?.message
            }`
          );
          // 再试 GET 只读 1 字节
          try {
            const get1 = await axios.get(d.data.videoUrl, {
              timeout: 15_000,
              responseType: "arraybuffer",
              headers: { Range: "bytes=0-0" },
              maxRedirects: 5,
            });
            console.log(
              `   ✅ GET bytes=0-0 HTTP ${get1.status}, ${
                get1.data?.byteLength || "?"
              } bytes, type=${get1.headers["content-type"] || "?"}`
            );
          } catch (e2) {
            console.log(
              `   ❌ Range GET 也没通过: ${e2?.response?.status || e2?.code || e2?.message}`
            );
          }
        }
      }
      process.exit(0);
    } else {
      console.log(`   ❌ 接口 success=false: ${d.error}`);
      if (d.lastPoll) console.log(`      lastPoll: ${JSON.stringify(d.lastPoll).slice(0, 600)}`);
      if (d.createRaw) console.log(`      createRaw: ${JSON.stringify(d.createRaw).slice(0, 600)}`);
      process.exit(3);
    }
  } catch (e) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    const s = e?.response?.status;
    const body = e?.response?.data;
    console.log(`\n   💥 调用失败 after ${elapsed}s, HTTP ${s || "?"}`);
    console.log(
      `   body: ${
        body ? (typeof body === "string" ? body : JSON.stringify(body)).slice(0, 1200) : e?.message
      }`
    );
    process.exit(4);
  }
}

main().catch((e) => {
  console.error("\n💥 未捕获错误:", e);
  process.exit(99);
});
