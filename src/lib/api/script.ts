import { http } from "./client";

// ========== 类型定义 ==========

export interface Script {
  id: number;
  projectId: number;
  title: string;
  content: string | null;
  rawContent: string | null;
  totalEpisodes: number;
  storySynopsis: string | null;
  charactersJson: string | null;
  sourceType: number;
  parsingStatus: number;
  parsingProgress: string | null;
  summary: string | null;
  genre: string | null;
  targetAudience: string | null;
  durationEstimate: number | null;
  aiGenerated: boolean;
  status: number;
  createTime: string;
  updateTime: string;
}

export interface ScriptEpisode {
  id: number;
  scriptId: number;
  episodeNumber: number;
  title: string;
  synopsis: string | null;
  rawContent: string | null;
  durationEstimate: number | null;
  totalScenes: number;
  sourceType: number;
  sortOrder: number;
  parsingStatus: number;
  status: number;
  version: number;
  createTime: string;
  updateTime: string;
}

/** 对白/动作元素 */
export interface DialogueElement {
  type: number; // 1=对白, 2=动作, 3=旁白, 4=镜头指令, 5=环境描写
  character_name?: string;
  character_asset_id?: number;
  content: string;
  parenthetical?: string;
  sortOrder?: number;
}

export interface SceneItem {
  id: number;
  episodeId: number;
  scriptId: number;
  sceneNumber: string;
  sceneHeading: string;
  location: string | null;
  timeOfDay: string | null;
  intExt: string | null;
  characters: string[] | null;
  characterAssetIds: number[] | null;
  sceneAssetId: number | null;
  propAssetIds: number[] | null;
  sceneDescription: string | null;
  dialogues: DialogueElement[] | null;
  sortOrder: number;
  status: number;
  version: number;
  createTime: string;
  updateTime: string;
}

export interface ScriptCreateReq {
  projectId: number;
  title: string;
  rawContent?: string;
}

export interface ScriptUpdateReq {
  id: number;
  title?: string;
  content?: string;
  rawContent?: string;
  storySynopsis?: string;
  genre?: string;
  targetAudience?: string;
  durationEstimate?: number;
}

export interface EpisodeCreateReq {
  scriptId: number;
  episodeNumber?: number;
  title?: string;
  synopsis?: string;
  rawContent?: string;
  durationEstimate?: number;
  sortOrder?: number;
}

export interface EpisodeUpdateReq {
  id: number;
  title?: string;
  synopsis?: string;
  rawContent?: string;
  durationEstimate?: number;
  sortOrder?: number;
  version?: number;
}

export interface SceneCreateReq {
  episodeId: number;
  scriptId?: number;
  sceneNumber?: string;
  sceneHeading?: string;
  location?: string;
  timeOfDay?: string;
  intExt?: string;
  sceneDescription?: string;
  sortOrder?: number;
}

export interface SceneUpdateReq {
  id: number;
  episodeId?: number;
  scriptId?: number;
  sceneNumber?: string;
  sceneHeading?: string;
  location?: string;
  timeOfDay?: string;
  intExt?: string;
  characters?: string;
  characterAssetIds?: string;
  sceneAssetId?: number;
  propAssetIds?: string;
  sceneDescription?: string;
  dialogues?: string;
  sortOrder?: number;
  version?: number;
}

// ========== 剧本流水线类型 ==========

export interface ProjectConfig {
  totalEpisodes: number;
  episodeDuration: number;
  startChapter?: number;
  endChapter?: number;
  chapterIds?: string[];
  platform?: string;
  style?: string;
  paywall?: string;
  audience?: string;
  budget?: string;
  keyMoments?: string;
  adaptations?: string;
}

export interface PipelineDecision {
  projectId: string;
  config: ProjectConfig;
  pipeline: Array<{
    phase: 'skeleton' | 'strategy' | 'script';
    status: 'pending' | 'in_progress' | 'completed';
    input: string[];
    output: string[];
    dependencies: string[];
  }>;
  warnings: string[];
  estimatedRounds: number;
}

export interface SupervisionReport {
  rating: 'A' | 'B' | 'C' | 'D';
  summary: string;
  issues: Array<{
    severity: '🔴 严重' | '🟡 中等' | '⚪ 轻微';
    item: string;
    problem: string;
    suggestion: string;
  }>;
  decisions?: string[];
  reviewType: 'skeleton' | 'strategy' | 'script';
}

// ========== 剧本流水线 API ==========

export const scriptPipelineApi = {
  /** 决策层：项目初始化 */
  decision: (novelId: string, config: ProjectConfig) =>
    http.post<never, PipelineDecision>('/api/novel/script/agent-decision', {
      novelId,
      projectConfig: config,
      mode: 'initialize',
    }),

  /** 阶段1：生成故事骨架（SSE流式） */
  generateSkeleton: (
    novelId: string,
    config: ProjectConfig,
    novelContent?: string,
    chapters?: any[],
    feedback?: string,
    onChunk?: (content: string, charCount: number) => void
  ): Promise<{ skeleton: string; summary: string }> => {
    return new Promise((resolve, reject) => {
      const token = localStorage.getItem("token") || localStorage.getItem("accessToken") || '';
      
      fetch('/api/novel/script/skeleton', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          novelId,
          ...(chapters && chapters.length > 0 ? { chapters } : {}),
          ...(novelContent ? { novelContent } : {}),
          ...(feedback ? { feedback } : {}),
          totalEpisodes: config.totalEpisodes,
          episodeDuration: config.episodeDuration,
          startChapter: config.startChapter,
          endChapter: config.endChapter,
          platform: config.platform,
          style: config.style,
          paywall: config.paywall,
        }),
      }).then(async (response) => {
        if (!response.ok) {
          reject(new Error(`HTTP ${response.status}`));
          return;
        }
        if (!response.body) {
          reject(new Error('No response body'));
          return;
        }

        const reader = response.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let fullContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            try {
              const data = JSON.parse(raw);
              if (data.type === 'complete') {
                resolve({ skeleton: data.content, summary: data.message || '' });
                return;
              }
              if (data.type === 'error') {
                reject(new Error(data.error || '生成失败'));
                return;
              }
              if (data.content) {
                fullContent += data.content;
                onChunk?.(data.content, fullContent.length);
              }
            } catch {}
          }
        }
        // If stream ended without 'complete' event
        resolve({ skeleton: fullContent, summary: '' });
      }).catch(reject);
    });
  },

  /** 阶段2：生成改编策略（SSE流式） */
  generateStrategy: (
    novelId: string,
    config: ProjectConfig,
    skeleton: string,
    chapters?: any[],
    feedback?: string,
    onChunk?: (content: string, charCount: number) => void
  ): Promise<{ strategy: string; summary: string }> => {
    return new Promise((resolve, reject) => {
      const token = localStorage.getItem("token") || localStorage.getItem("accessToken") || '';
      
      fetch('/api/novel/script/adaptation-strategy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          novelId,
          skeleton,
          chapters,
          ...(feedback ? { feedback } : {}),
          totalEpisodes: config.totalEpisodes,
          episodeDuration: config.episodeDuration,
          platform: config.platform,
          style: config.style,
          paywall: config.paywall,
        }),
      }).then(async (response) => {
        if (!response.ok) {
          reject(new Error(`HTTP ${response.status}`));
          return;
        }
        if (!response.body) {
          reject(new Error('No response body'));
          return;
        }

        const reader = response.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let fullContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            try {
              const data = JSON.parse(raw);
              if (data.type === 'complete') {
                resolve({ strategy: data.content, summary: data.message || '' });
                return;
              }
              if (data.type === 'error') {
                reject(new Error(data.error || '生成失败'));
                return;
              }
              if (data.content) {
                fullContent += data.content;
                onChunk?.(data.content, fullContent.length);
              }
            } catch {}
          }
        }
        resolve({ strategy: fullContent, summary: '' });
      }).catch(reject);
    });
  },

  /** 阶段3：流水线生成完整剧本（SSE流式，返回Promise） */
  generateScript: (
    novelId: string,
    config: ProjectConfig,
    skeleton: string,
    strategy: string,
    feedback?: string,
    onChunk?: (content: string, charCount: number) => void
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      const token = localStorage.getItem("token") || localStorage.getItem("accessToken") || '';
      
      fetch('/api/novel/script/pipeline-generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          novelId,
          skeleton,
          adaptationStrategy: strategy,
          ...(feedback ? { feedback } : {}),
          totalEpisodes: config.totalEpisodes,
          episodeDuration: config.episodeDuration,
          platform: config.platform,
          style: config.style,
          paywall: config.paywall,
          projectConfig: config,
          // 三阶段流水线重跑时以新骨架全新生成，不走断点续传
          force: true,
        }),
      }).then(async (response) => {
        if (!response.ok) {
          reject(new Error(`HTTP ${response.status}`));
          return;
        }
        if (!response.body) {
          reject(new Error('No response body'));
          return;
        }

        const reader = response.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let lastContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            try {
              const data = JSON.parse(raw);
              if (data.type === 'complete') {
                resolve({ script: data.script, content: data.content });
                return;
              }
              if (data.type === 'error') {
                reject(new Error(data.error || '生成失败'));
                return;
              }
              // kind='status' 是进度/重试提示语，不计入正文；kind='chunk' 是 AI 实时输出
              if (data.content && data.kind !== 'status') {
                lastContent += data.content;
                onChunk?.(data.content, lastContent.length);
              }
            } catch {}
          }
        }
        // If stream ended without 'complete' event, resolve with what we have
        resolve({ script: null, content: lastContent });
      }).catch(reject);
    });
  },

  /** 监督审核 */
  supervise: (params: {
    novelId: string;
    reviewType: 'skeleton' | 'strategy' | 'script';
    skeleton?: string;
    adaptationStrategy?: string;
    scriptContent?: any;
    totalEpisodes?: number;
    episodeDuration?: number;
    platform?: string;
    style?: string;
    paywall?: string;
    chapters?: any[];
  }) =>
    http.post<never, { report: SupervisionReport; rawContent: string; reviewType: string }>(
      '/api/novel/script/quality-check/supervision',
      params
    ),
};

// ========== 小说关联 API ==========

export interface NovelBrief {
  id: string;
  title: string;
  description?: string;
  category?: string;
  genderTarget?: string;
  tone?: string | string[];
  protagonist?: string;
  totalChapters?: number;
  currentChapters?: number;
  chapters?: Array<{ title: string; content?: string; summary?: string }>;
  structure?: any;
  idea?: any;
}

export const novelLinkApi = {
  /** 获取小说简要数据（供剧本页面使用） */
  getBrief: (novelId: string) =>
    http.get<never, NovelBrief>(`/api/novels/${novelId}`),
};

// ========== API ==========

export const scriptApi = {
  /** 按项目查询剧本列表 */
  list: (projectId: number) =>
    http.get<never, Script[]>(`/api/script/list?projectId=${projectId}`),

  /** 获取剧本详情 */
  get: (id: number) => http.get<never, Script>(`/api/script/${id}`),

  /** 创建剧本 */
  create: (data: ScriptCreateReq) => http.post<never, Script>("/api/script", data),

  /** 更新剧本 */
  update: (data: ScriptUpdateReq) => http.put<never, Script>("/api/script", data),

  /** 删除剧本 */
  delete: (id: number) => http.delete<never, boolean>(`/api/script/${id}`),

  // ========== 分集 ==========

  /** 获取分集列表 */
  listEpisodes: (scriptId: number) =>
    http.get<never, ScriptEpisode[]>(`/api/script/${scriptId}/episodes`),

  /** 获取分集详情 */
  getEpisode: (id: number) =>
    http.get<never, ScriptEpisode>(`/api/script/episode/${id}`),

  /** 创建分集 */
  createEpisode: (data: EpisodeCreateReq) =>
    http.post<never, ScriptEpisode>("/api/script/episode", data),

  /** 更新分集 */
  updateEpisode: (data: EpisodeUpdateReq) =>
    http.put<never, ScriptEpisode>("/api/script/episode", data),

  /** 删除分集 */
  deleteEpisode: (id: number) =>
    http.delete<never, boolean>(`/api/script/episode/${id}`),

  // ========== 场次 ==========

  /** 获取场次列表（按分集） */
  listScenes: (episodeId: number) =>
    http.get<never, SceneItem[]>(`/api/script/episode/${episodeId}/scenes`),

  /** 获取场次详情 */
  getScene: (id: number) => http.get<never, SceneItem>(`/api/script/scene/${id}`),

  /** 创建场次 */
  createScene: (data: SceneCreateReq) =>
    http.post<never, SceneItem>("/api/script/scene", data),

  /** 更新场次 */
  updateScene: (data: SceneUpdateReq) =>
    http.put<never, SceneItem>("/api/script/scene", data),

  /** 删除场次 */
  deleteScene: (id: number) =>
    http.delete<never, boolean>(`/api/script/scene/${id}`),
};
