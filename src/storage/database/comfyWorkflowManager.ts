/**
 * ComfyUI 工作流管理器
 * 负责工作流的 CRUD 操作及文件存储
 * 
 * 目录结构:
 * storage/ComfyUIAI/
 *   ├── workflows/       # 工作流插件文件
 *   ├── references/      # 参考素材（图片/音频）
 *   └── config.json      # 配置文件
 */
import { db } from './sqlite';
import {
  comfyWorkflows,
  insertComfyWorkflowSchema,
  updateComfyWorkflowSchema,
  type ComfyWorkflow,
  type InsertComfyWorkflow,
} from './shared/schema';
import { eq, and } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

// ComfyUIAI 根目录
export const COMFY_AI_DIR = path.join(process.cwd(), 'storage', 'ComfyUIAI');
// 工作流插件存储目录（在 ComfyUIAI 下）
export const COMFY_WORKFLOW_DIR = path.join(COMFY_AI_DIR, 'workflows');
// 参考素材目录
export const COMFY_REFERENCE_DIR = path.join(COMFY_AI_DIR, 'references');

// 确保目录存在
function ensureDir() {
  if (!fs.existsSync(COMFY_AI_DIR)) {
    fs.mkdirSync(COMFY_AI_DIR, { recursive: true });
  }
  if (!fs.existsSync(COMFY_WORKFLOW_DIR)) {
    fs.mkdirSync(COMFY_WORKFLOW_DIR, { recursive: true });
  }
  if (!fs.existsSync(COMFY_REFERENCE_DIR)) {
    fs.mkdirSync(COMFY_REFERENCE_DIR, { recursive: true });
  }
}

// 生成唯一 ID
function genId(): string {
  return 'wf_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

// 生成文件名
function genFileName(name: string): string {
  const timestamp = Date.now();
  const safeName = name.replace(/[^\w\u4e00-\u9fa5-]/g, '_').substring(0, 50);
  return `${safeName}_${timestamp}.json`;
}

export const ComfyWorkflowManager = {
  /**
   * 获取所有工作流列表
   */
  async list(options?: { active?: boolean; type?: string; skipFileCheck?: boolean }): Promise<ComfyWorkflow[]> {
    let query = db.select().from(comfyWorkflows);
    const conditions = [];
    if (options?.active !== undefined) {
      conditions.push(eq(comfyWorkflows.isActive, options.active ? 1 : 0));
    }
    if (options?.type) {
      conditions.push(eq(comfyWorkflows.workflowType, options.type));
    }
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    const results = await query.orderBy(comfyWorkflows.sortOrder, comfyWorkflows.createdAt);
    
    // 自动清理文件不存在的孤儿记录
    if (!options?.skipFileCheck) {
      const orphans: string[] = [];
      
      for (const wf of results) {
        if (wf.workflowPath && !fs.existsSync(wf.workflowPath)) {
          // 尝试从数据库恢复文件
          if (wf.workflowJson && Object.keys(wf.workflowJson as object).length > 0) {
            try {
              const dir = path.dirname(wf.workflowPath);
              fs.mkdirSync(dir, { recursive: true });
              let jsonContent = wf.workflowJson;
              if (typeof jsonContent === 'string') {
                try {
                  jsonContent = JSON.stringify(JSON.parse(jsonContent), null, 2);
                } catch {}
              } else if (typeof jsonContent === 'object') {
                jsonContent = JSON.stringify(jsonContent, null, 2);
              }
              fs.writeFileSync(wf.workflowPath, jsonContent, 'utf-8');
              console.log(`[ComfyWorkflowManager] 自动恢复文件: ${wf.name}`);
            } catch (err) {
              console.error(`[ComfyWorkflowManager] 自动恢复失败: ${wf.name}`, err);
              orphans.push(wf.id);
            }
          } else {
            orphans.push(wf.id);
          }
        }
      }
      
      if (orphans.length > 0) {
        // 自动清理无法恢复的孤儿记录
        for (const id of orphans) {
          try {
            await db.delete(comfyWorkflows).where(eq(comfyWorkflows.id, id));
            console.log(`[ComfyWorkflowManager] 清理孤儿记录: ${id}`);
          } catch {}
        }
        // 返回清理后的结果
        return results.filter(w => !orphans.includes(w.id));
      }
    }
    
    return results;
  },
  
  /**
   * 清理所有文件不存在的孤儿记录
   * 如果文件缺失但数据库有 JSON 内容，则自动恢复文件
   */
  async cleanupOrphans(): Promise<{ cleaned: number; restored: number }> {
    const all = await db.select().from(comfyWorkflows);
    let cleaned = 0;
    let restored = 0;
    
    for (const wf of all) {
      const fileExists = wf.workflowPath ? fs.existsSync(wf.workflowPath) : false;
      const hasJson = wf.workflowJson && Object.keys(wf.workflowJson as object).length > 0;
      
      if (!fileExists) {
        if (hasJson) {
          // 从数据库恢复文件
          try {
            const filePath = wf.workflowPath || path.join(COMFY_WORKFLOW_DIR, wf.fileName || `${wf.id}.json`);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            // 正确处理 JSON（数据库可能存的是字符串或对象）
            let jsonContent = wf.workflowJson;
            if (typeof jsonContent === 'string') {
              try {
                const parsed = JSON.parse(jsonContent);
                jsonContent = JSON.stringify(parsed, null, 2);
              } catch {
                // 已经是格式化的字符串
              }
            } else if (typeof jsonContent === 'object') {
              jsonContent = JSON.stringify(jsonContent, null, 2);
            }
            fs.writeFileSync(filePath, jsonContent, 'utf-8');
            console.log(`[ComfyWorkflowManager] 恢复文件: ${wf.name} -> ${filePath}`);
            restored++;
          } catch (err) {
            console.error(`[ComfyWorkflowManager] 恢复文件失败: ${wf.name}`, err);
            // 如果恢复失败，删除记录
            try {
              await db.delete(comfyWorkflows).where(eq(comfyWorkflows.id, wf.id));
              cleaned++;
            } catch {}
          }
        } else {
          // 无文件无内容，彻底删除
          try {
            await db.delete(comfyWorkflows).where(eq(comfyWorkflows.id, wf.id));
            cleaned++;
            console.log(`[ComfyWorkflowManager] 清理孤儿: ${wf.name} (${wf.id})`);
          } catch {}
        }
      }
    }
    return { cleaned, restored };
  },

  /**
   * 获取单个工作流
   */
  async getById(id: string): Promise<ComfyWorkflow | undefined> {
    const results = await db.select().from(comfyWorkflows).where(eq(comfyWorkflows.id, id)).limit(1);
    return results[0];
  },

  /**
   * 获取默认工作流
   */
  async getDefault(workflowType?: string): Promise<ComfyWorkflow | undefined> {
    let query = db.select().from(comfyWorkflows).where(and(
      eq(comfyWorkflows.isDefault, 1),
      eq(comfyWorkflows.isActive, 1),
    ));
    if (workflowType) {
      query = query.where(eq(comfyWorkflows.workflowType, workflowType));
    }
    const results = await query.limit(1);
    if (results.length > 0) return results[0];
    // 没有默认时返回第一个活跃的
    const fallback = await db.select().from(comfyWorkflows).where(and(
      eq(comfyWorkflows.isActive, 1),
    )).limit(1);
    return fallback[0];
  },

  /**
   * 上传/创建工作流
   */
  async create(data: {
    name: string;
    description?: string;
    workflowJson: string;
    workflowType?: string;
    modelType?: string;
    isDefault?: boolean;
  }): Promise<ComfyWorkflow> {
    ensureDir();

    // 验证 JSON
    try {
      JSON.parse(data.workflowJson);
    } catch {
      throw new Error('工作流 JSON 格式无效');
    }

    const id = genId();
    const fileName = genFileName(data.name);
    const workflowPath = path.join(COMFY_WORKFLOW_DIR, fileName);

    // 保存文件
    fs.writeFileSync(workflowPath, data.workflowJson, 'utf-8');

    const insertData = {
      id,
      name: data.name,
      description: data.description || '',
      fileName,
      workflowPath,
      workflowJson: data.workflowJson,
      workflowType: data.workflowType || 'video',
      modelType: data.modelType,
      isDefault: data.isDefault ? 1 : 0,
      sortOrder: 0,
      isActive: 1,
    };

    // 直接插入（不通过 Zod schema 验证，因为 id 是手动生成的）
    const result = await db.insert(comfyWorkflows).values(insertData).returning();

    // 如果设为默认，取消其他默认
    if (data.isDefault) {
      await db.update(comfyWorkflows)
        .set({ isDefault: 0 })
        .where(and(eq(comfyWorkflows.isDefault, 1), eq(comfyWorkflows.id, id)))
        .catch(() => {});
      // 设置当前为默认
      await db.update(comfyWorkflows)
        .set({ isDefault: 1 })
        .where(eq(comfyWorkflows.id, id))
        .catch(() => {});
    }

    return result[0];
  },

  /**
   * 更新工作流
   */
  async update(id: string, data: {
    name?: string;
    description?: string;
    workflowJson?: string;
    workflowType?: string;
    modelType?: string;
    isDefault?: boolean;
    isActive?: boolean;
  }): Promise<ComfyWorkflow | undefined> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('工作流不存在');

    const updateData: any = { ...data, updatedAt: new Date().toISOString() };

    // 如果更新了 JSON，重新保存文件
    if (data.workflowJson) {
      try {
        JSON.parse(data.workflowJson);
      } catch {
        throw new Error('工作流 JSON 格式无效');
      }
      ensureDir();
      const newFileName = genFileName(data.name || existing.name);
      const newPath = path.join(COMFY_WORKFLOW_DIR, newFileName);
      fs.writeFileSync(newPath, data.workflowJson, 'utf-8');
      // 删除旧文件
      if (existing.workflowPath) {
        try { fs.unlinkSync(existing.workflowPath); } catch {}
      }
      updateData.fileName = newFileName;
      updateData.workflowPath = newPath;
    }

    if (data.isDefault) {
      // 取消其他默认
      await db.update(comfyWorkflows)
        .set({ isDefault: 0 })
        .where(and(eq(comfyWorkflows.isDefault, 1), eq(comfyWorkflows.id, id)))
        .catch(() => {});
      updateData.isDefault = 1;
    }

    // 直接更新（不通过 Zod schema 验证，避免字段被过滤）
    const results = await db.update(comfyWorkflows)
      .set(updateData)
      .where(eq(comfyWorkflows.id, id))
      .returning();
    return results[0];
  },

  /**
   * 删除工作流（软删除 - 保留记录可恢复）
   */
  async delete(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('工作流不存在');

    // 软删除：标记为不活跃
    await db.update(comfyWorkflows)
      .set({ isActive: 0 })
      .where(eq(comfyWorkflows.id, id));
  },

  /**
   * 恢复已删除的工作流
   */
  async restore(id: string): Promise<ComfyWorkflow | undefined> {
    const existing = await db.select().from(comfyWorkflows)
      .where(eq(comfyWorkflows.id, id))
      .limit(1);
    if (!existing[0]) throw new Error('工作流不存在');
    if (existing[0].isActive) throw new Error('工作流未被删除');

    await db.update(comfyWorkflows)
      .set({ isActive: 1 })
      .where(eq(comfyWorkflows.id, id));

    // 如果文件被删了，从数据库恢复
    const workflow = existing[0];
    if (workflow.workflowJson) {
      try {
        // 重新保存文件
        const filePath = workflow.workflowPath || path.join(COMFY_WORKFLOW_DIR, workflow.fileName);
        fs.writeFileSync(filePath, JSON.stringify(workflow.workflowJson, null, 2), 'utf-8');
      } catch {}
    }

    return (await this.getById(id));
  },

  /**
   * 永久删除（不可恢复）
   */
  async permanentDelete(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('工作流不存在');

    // 删除文件
    if (existing.workflowPath) {
      try { fs.unlinkSync(existing.workflowPath); } catch {}
    }

    // 从数据库永久删除
    await db.delete(comfyWorkflows).where(eq(comfyWorkflows.id, id));
  },

  /**
   * 设置默认工作流
   */
  async setDefault(id: string, workflowType?: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('工作流不存在');

    // 取消同类型其他默认
    if (workflowType || existing.workflowType) {
      await db.update(comfyWorkflows)
        .set({ isDefault: 0 })
        .where(and(
          eq(comfyWorkflows.isDefault, 1),
          eq(comfyWorkflows.workflowType, workflowType || existing.workflowType!),
        ))
        .catch(() => {});
    } else {
      await db.update(comfyWorkflows)
        .set({ isDefault: 0 })
        .where(eq(comfyWorkflows.isDefault, 1))
        .catch(() => {});
    }

    await db.update(comfyWorkflows)
      .set({ isDefault: 1 })
      .where(eq(comfyWorkflows.id, id));
  },

  /**
   * 从文件导入工作流
   */
  async importFromFile(filePath: string, name?: string): Promise<ComfyWorkflow> {
    if (!fs.existsSync(filePath)) throw new Error('文件不存在');
    const content = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);
    const wfName = name || path.basename(filePath, '.json');
    return this.create({
      name: wfName,
      workflowJson: JSON.stringify(json, null, 2),
      workflowType: 'video',
    });
  },

  /**
   * 确保默认工作流存在（系统初始化时调用）
   */
  async ensureDefaultWorkflows(): Promise<void> {
    const existing = await this.list();
    if (existing.length > 0) return;

    // 默认工作流路径
    const defaultPaths = [
      path.join(process.cwd(), '..', 'MINIMAX-H3工作流', '多参9+3+3.json'),
      'f:/MINIMAX-H3工作流/多参9+3+3.json',
    ];

    for (const p of defaultPaths) {
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf-8');
          const json = JSON.parse(content);
          await this.create({
            name: 'MiniMax H3 多参工作流',
            description: '默认视频生成工作流，支持 9 张参考图',
            workflowJson: JSON.stringify(json, null, 2),
            workflowType: 'video',
            modelType: 'MiniMax H3',
            isDefault: true,
          });
          break;
        } catch {}
      }
    }
  },
};
