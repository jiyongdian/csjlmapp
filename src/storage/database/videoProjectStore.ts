// 视频项目数据存储（临时内存存储，实际项目应使用数据库）
export const videoProjects: Map<string, any> = new Map();

export interface VideoProject {
  id: string;
  userId: string;
  title: string;
  description: string;
  status: 'draft' | 'generating' | 'completed';
  videoUrl: string | null;
  thumbnail: string | null;
  duration: number;
  scenes: Scene[];
  createdAt: string;
}

export interface Scene {
  id: string;
  prompt: string;
  imageUrl: string | null;
  audioText: string;
  duration: number;
  order: number;
  status: 'pending' | 'generating' | 'completed';
}