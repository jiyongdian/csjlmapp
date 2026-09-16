// 导出 Manager 实例
export { userManager } from "./userManager";
export { memberLevelManager } from "./memberLevelManager";
export { memberOrderManager } from "./memberOrderManager";
export { novelManager } from "./novelManager";
export { novelDetailManager } from "./novelDetailManager";
export { inviteCodeManager } from "./inviteCodeManager";
export { scriptManager } from "./scriptManager";
export { shortDramaManager } from "./shortDramaManager";
export { dramaWorkflowManager } from "./dramaWorkflowManager";
export { modelPromptManager } from "./modelPromptManager";
export { extractTemplateManager } from "./extractTemplateManager";
export {
  stylePromptManager,
  STYLE_PROMPT_KINDS,
  normalizeStylePromptKind,
  normalizeStylePromptCategory,
  DEFAULT_STYLE_PROMPT_CATEGORY,
  MAX_STYLE_PROMPT_CATEGORY,
  type StylePromptKind,
} from "./stylePromptManager";
export { projectManager } from "./projectManager";
export { storyMemoryManager } from "./storyMemoryManager";
export { volumeManager } from "./volumeManager";
export { chapterBaselineManager } from "./chapterBaselineManager";
export { skillManager } from "./skillManager";
export { qualityCheckManager } from "./qualityCheckManager";

// 导出类型和 Schema（从 schema.ts 导出）
export * from "./shared/schema";
