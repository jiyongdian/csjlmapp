export const VIDEO_PROMPT_MAX = 500;

export type StoryboardPreviewItem = {
  panelIndex: number;
  imagePrompt: string;
  videoPrompt: string;
  roleCandidates: string[];
};

/**
 * 拆解分镜模版输出：每条记录 = panel_index_::~FIELD::~_图片提示词_::~FIELD::~_视频提示词
 * 记录之间用 _::~RECORD::~_ 分隔。
 * 返回 { preview, warnings }；全部记录都无法解析时抛错（由调用方把 raw 返回前端展示，绝不半写库）。
 * 容错：剥离 markdown 围栏与前置解释文字；空字段 / 过短视频提示词跳过并给警告，不中断整体。
 */
export function parseStoryboardRecords(text: string): { preview: StoryboardPreviewItem[]; warnings: string[] } {
  const warnings: string[] = [];
  let cleaned = String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  // 去掉包裹说明文字（在第一条 record 之前的部分）
  cleaned = cleaned.replace(/^[\s\S]*?(?=\d\s*_::~FIELD::~_)/, '').trim();

  const records = cleaned.split(/_::~RECORD::~_/).map((s) => s.trim()).filter(Boolean);
  const preview: StoryboardPreviewItem[] = [];

  for (const rawRecord of records) {
    const m = rawRecord.match(/^\s*(\d+)\s*_::~FIELD::~_([\s\S]*?)_::~FIELD::~_([\s\S]*)$/);
    if (!m) {
      warnings.push('跳过无法解析的记录（缺少 panel_index / 分隔符）');
      continue;
    }
    const panelIndex = parseInt(m[1], 10);
    const imagePrompt = m[2].trim();
    const rest = m[3].trim();
    if (!imagePrompt || !rest) {
      warnings.push(`panel ${panelIndex} 缺图片提示词或视频提示词，已跳过`);
      continue;
    }

    // 角色候选：rest 里所有 @名字
    const roleCandidates = Array.from(new Set(rest.match(/@([^\s@，。,，]{1,24})/g) || [])).map((s) => s.replace(/^@/, ''));

    // 视频提示词：从「场景：」开始（保留前缀；若无则取 rest 全文）
    const sceneIdx = rest.indexOf('场景：');
    const videoPrompt = (sceneIdx >= 0 ? rest.slice(sceneIdx) : rest).trim();
    if (!videoPrompt || videoPrompt.length < 10) {
      warnings.push(`panel ${panelIndex} 视频提示词过短，已跳过`);
      continue;
    }

    preview.push({
      panelIndex,
      imagePrompt: imagePrompt.slice(0, 800),
      videoPrompt: videoPrompt.slice(0, VIDEO_PROMPT_MAX + 200),
      roleCandidates,
    });
  }

  if (preview.length === 0) {
    throw new Error('AI 返回的内容无法解析为分镜记录，请尝试重新生成');
  }
  return { preview, warnings };
}