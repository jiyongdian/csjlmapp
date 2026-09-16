/**
 * AI Pipeline API — 单次自动执行的工作流
 *
 * 与 ai-assistant.ts（对话管理）分离，
 * 便于后续独立调整 pipeline 的参数和逻辑。
 */

import { API_BASE_URL } from "./client";
import {
  type AiChatReq,
  type AiChatStreamEvent,
  type StreamCallbacks,
  authenticatedFetch,
} from "./ai-assistant";

// 复用 ai-assistant 中的类型
export type { AiChatReq, AiChatStreamEvent, StreamCallbacks };

// ========== Pipeline 类型 ==========

/** Pipeline 类型的 agentType 列表（这些类型的对话隐藏用户输入） */
export const PIPELINE_AGENT_TYPES = [
  "story_to_script",
  "script_full_parse",
  "script_to_storyboard",
  "script_episode_parse",
  "episode_scene_writer",
  "episode_script_creator",
  "episode_storyboard_writer",
  "storyboard_asset_preprocessor",
  "asset_image_gen",
  "asset_image_executor",
  "storyboard_video_gen",
  "storyboard_video_executor",
] as const;

function parseSseEventBlock(
  eventBlock: string,
  callbacks: StreamCallbacks
) {
  const dataLines: string[] = [];

  for (const rawLine of eventBlock.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  const jsonStr = dataLines.join("\n").trim();
  if (!jsonStr) {
    return;
  }

  try {
    const event: AiChatStreamEvent = JSON.parse(jsonStr);
    callbacks.onEvent(event);
  } catch {
    console.warn("SSE 解析失败:", jsonStr);
  }
}

function consumeSseBuffer(buffer: string, callbacks: StreamCallbacks) {
  const normalizedBuffer = buffer.replace(/\r\n/g, "\n");
  const eventBlocks = normalizedBuffer.split("\n\n");
  const remaining = eventBlocks.pop() || "";

  for (const eventBlock of eventBlocks) {
    parseSseEventBlock(eventBlock, callbacks);
  }

  return remaining;
}

// ========== SSE 流式 API ==========

/**
 * 启动 Pipeline（SSE 流式）
 * 返回 AbortController 用于取消
 */
export function pipelineStream(
  req: AiChatReq,
  callbacks: StreamCallbacks
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/ai/pipeline/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("无法获取响应流");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        buffer = consumeSseBuffer(buffer, callbacks);
      }

      if (buffer.trim()) {
        parseSseEventBlock(buffer, callbacks);
      }

      callbacks.onComplete?.();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return controller;
}

/**
 * 重连 Pipeline（SSE 流式）
 * 返回 AbortController 用于取消
 */
export function reconnectPipelineStream(
  conversationId: string,
  callbacks: StreamCallbacks
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/ai/pipeline/reconnect?conversationId=${encodeURIComponent(conversationId)}`,
        {
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("无法获取响应流");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        buffer = consumeSseBuffer(buffer, callbacks);
      }

      if (buffer.trim()) {
        parseSseEventBlock(buffer, callbacks);
      }

      callbacks.onComplete?.();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return controller;
}

// ========== 普通 API ==========

import { http } from "./client";
import type { AgentConversation } from "./ai-assistant";

/**
 * 取消正在运行的 Pipeline
 */
export async function cancelPipeline(conversationId: string): Promise<void> {
  await http.post(
    `/api/ai/pipeline/cancel?conversationId=${encodeURIComponent(conversationId)}`
  );
}

/**
 * 查询 Pipeline 流状态
 * @returns ACTIVE / COMPLETED / ERROR / NONE
 */
export async function getPipelineStatus(
  conversationId: string
): Promise<string> {
  return http.get(
    `/api/ai/pipeline/status?conversationId=${encodeURIComponent(conversationId)}`
  );
}

/**
 * 查询运行中的 Pipeline 列表
 */
export async function listRunningPipelines(): Promise<AgentConversation[]> {
  return http.get("/api/ai/pipeline/running");
}
