export {
  agentTypeNames,
  assetTypeNames,
  getAgentTypeName,
  getToolDisplayName,
  isSubAgentTool,
  storyboardShotTypeNames,
  subAgentToolNames,
  toolDisplayNames,
} from "../shared/ai-task-display";

const fieldLabels: Record<string, string> = {
  status: "状态",
  message: "信息",
  total: "总数",
  id: "ID",
  name: "名称",
  type: "类型",
  count: "数量",
  title: "标题",
  projectId: "项目ID",
  storyboardId: "分镜ID",
  sceneId: "场次ID",
  episodeId: "集ID",
  sceneNumber: "场次号",
  shotCount: "镜头数",
  sceneCount: "场次数",
  totalItems: "总项数",
  totalEpisodes: "总集数",
  genre: "类型",
  description: "描述",
  content: "内容",
  url: "链接",
  createdAt: "创建时间",
  updatedAt: "更新时间",
  storyboards: "分镜列表",
  items: "子项",
  episodes: "集列表",
  assets: "资产列表",
  scripts: "剧本列表",
  projects: "项目列表",
};

export function getFieldLabel(key: string): string {
  return fieldLabels[key] || key;
}