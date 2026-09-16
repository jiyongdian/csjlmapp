// Agent 对话式创作（chevoink 移植最小子集）— 共享类型定义

export interface AgentSession {
  id: string;
  userId: string;
  novelId: string | null;
  novelTitle: string;
  title: string;
  status: string;
  chapterIndex: number | null;
  scope?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string | null;
  toolPayload?: string | null;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  sessionId: string;
  userId: string;
  novelId: string | null;
  chapterIndex: number | null;
  prompt: string;
  status: 'running' | 'finished' | 'failed' | 'stopped';
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Agent SSE 事件（与前端对话面板的协议） */
export type AgentStreamEvent =
  | { type: 'run_start'; runId: string; sessionId: string }
  | { type: 'intent'; action: AgentAction; instruction: string }
  | { type: 'text_delta'; content: string }
  | {
      type: 'tool_result';
      toolName: AgentAction;
      summary: string;
      content: string;
      applied?: boolean;
      chapterIndex?: number | null;
    }
  | { type: 'change_applied'; action: string; title: string }
  | { type: 'generation_start'; novelId: string; title: string; total: number }
  | { type: 'generation_progress'; current: number; total: number; chapterTitle: string; chars: number; preview: string }
  | { type: 'generation_chapter_start'; current: number; total: number; title: string }
  | { type: 'generation_chapter_reset'; current: number; total: number; title: string }
  | { type: 'generation_chapter_delta'; current: number; content: string }
  | { type: 'generation_chapter_end'; current: number; chars: number; content: string }
  | { type: 'need_perspective'; options: string[]; default: string }
  | { type: 'generation_queued'; sessionId: string }
  | { type: 'need_gender'; options: string[]; default: string }
  | { type: 'need_category'; options: string[]; default: string; tree?: { name: string; genres: string[] }[] }
  | { type: 'generation_finished'; novelId: string; title: string; total: number }
  | { type: 'text_reset' }
  | { type: 'run_finished'; runId: string; status: string; messageId?: string }
  | { type: 'run_error'; runId: string; message: string };

/** Agent 支持的动作（工具路由） */
export type AgentAction =
  | 'rewrite' | 'continue' | 'polish' | 'expand' | 'condense' | 'review' | 'summary'
  | 'chat' | 'generate' | 'generate-script'
  | 'script-scenes' | 'script-dialogue' | 'script-scene-meta' | 'script-image-prompts' | 'script-video-prompts';

export const AGENT_ACTIONS: AgentAction[] = [
  'rewrite', 'continue', 'polish', 'expand', 'condense', 'review', 'summary',
  'chat', 'generate', 'generate-script',
  'script-scenes', 'script-dialogue', 'script-scene-meta', 'script-image-prompts', 'script-video-prompts',
];

export interface AgentRunRequest {
  sessionId: string;
  novelId?: string;
  chapterIndex?: number;
  prompt: string;
}

export interface ChapterRef {
  index: number;
  title: string;
  content: string;
}
