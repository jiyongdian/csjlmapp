import { http } from "./client";

// ========== 类型定义 ==========

export interface Project {
  id: number;
  name: string;
  description: string;
  coverUrl: string | null;
  scope: number;
  ownerType: number;
  ownerId: string;
  status: number;
  properties: Record<string, unknown> | null;
  artStyle: string | null;
  artStyleDescription: string | null;
  artStyleImagePrompt: string | null;
  artStyleImageUrl: string | null;
  createTime: string;
  updateTime: string;
}

export interface ProjectCreateReq {
  name: string;
  description?: string;
  properties?: string;
}

// ========== API ==========

export const projectApi = {
  /** 获取当前用户的项目列表 */
  list: () => http.get<never, Project[]>("/api/project/list"),

  /** 获取项目详情 */
  get: (id: number) => http.get<never, Project>(`/api/project/${id}`),

  /** 创建项目 */
  create: (data: ProjectCreateReq) => http.post<never, Project>("/api/project", data),

  /** 更新项目 */
  update: (data: Partial<Project> & { id: number }) =>
    http.put<never, Project>("/api/project", data),

  /** 更新项目扩展属性（properties 传对象，自动序列化为 JSON 字符串） */
  updateProperties: (id: number, properties: Record<string, unknown>) =>
    http.put<never, Project>("/api/project", {
      id,
      properties: JSON.stringify(properties),
    }),

  /** 删除项目 */
  delete: (id: number) => http.delete<never, boolean>(`/api/project/${id}`),
};
