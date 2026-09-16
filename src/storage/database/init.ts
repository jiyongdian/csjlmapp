import { db } from './sqlite';
import { users, memberLevels, memberOrders, novels, aiConfigs, inviteCodes, comfyWorkflows } from './shared/schema';
import { hashPassword } from '@/lib/auth';
import { seedModelPrompts } from './shared/modelPromptsSeed';
import { seedExtractTemplates } from './shared/extractTemplatesSeed';
import { seedAgentSkillsToModelPrompts } from './agentSkillPromptSeed';
import { ComfyWorkflowManager } from './comfyWorkflowManager';
import fs from 'fs';
import path from 'path';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export async function initDatabase() {
  try {
    console.log('初始化数据库...');
    
    const existingUsers = await db.select().from(users).limit(1);
    if (existingUsers.length > 0) {
      console.log('数据库已初始化，跳过');
      // 检查并补充缺失的会员等级
      const existingLevels = await db.select().from(memberLevels);
      const levelCodes = new Set(existingLevels.map(l => l.code));
      if (!levelCodes.has('free') || !levelCodes.has('vip') || !levelCodes.has('svip')) {
        console.log('检测到缺失的会员等级，正在补充...');
        const now = new Date().toISOString();
        if (!levelCodes.has('free')) {
          await db.insert(memberLevels).values({
            id: generateUUID(),
            code: 'free',
            name: '免费用户',
            description: '免费体验会员',
            price: 0,
            duration: 0,
            features: JSON.stringify(['基础小说生成', '最多11章']),
            chapterLimit: 11,
            sortOrder: 1,
            isActive: 1,
            createdAt: now,
          });
          console.log('已补充 free 等级');
        }
        if (!levelCodes.has('vip')) {
          await db.insert(memberLevels).values({
            id: generateUUID(),
            code: 'vip',
            name: '创世纪VIP会员',
            description: '高级会员',
            price: 9900,
            duration: 30,
            features: JSON.stringify(['高级小说生成', '最多999章', '优先AI处理']),
            chapterLimit: 999,
            sortOrder: 2,
            isActive: 1,
            createdAt: now,
          });
          console.log('已补充 vip 等级');
        }
        if (!levelCodes.has('svip')) {
          await db.insert(memberLevels).values({
            id: generateUUID(),
            code: 'svip',
            name: '创世纪SVIP会员',
            description: '超级会员（年卡）',
            price: 29900,
            duration: 365,
            features: JSON.stringify(['顶级小说生成', '最多9999章', '优先AI处理', '专属客服']),
            chapterLimit: 9999,
            sortOrder: 3,
            isActive: 1,
            createdAt: now,
          });
          console.log('已补充 svip 等级');
        }
      }
      // 仍然同步提示词数据
      await seedModelPrompts();
      await seedExtractTemplates();
      await seedAgentSkillsToModelPrompts();
      // 初始化 ComfyUI 工作流
      await ComfyWorkflowManager.ensureDefaultWorkflows();
      return;
    }
    
    const freeLevelId = generateUUID();
    const vipLevelId = generateUUID();
    const svipLevelId = generateUUID();
    
    await db.insert(memberLevels).values([
      {
        id: freeLevelId,
        code: 'free',
        name: '免费用户',
        description: '免费体验会员',
        price: 0,
        duration: 0,
        features: JSON.stringify(['基础小说生成', '最多11章']),
        chapterLimit: 11,
        sortOrder: 1,
        isActive: 1,
        createdAt: new Date().toISOString(),
      },
      {
        id: vipLevelId,
        code: 'vip',
        name: '创世纪VIP会员',
        description: '高级会员',
        price: 9900,
        duration: 30,
        features: JSON.stringify(['高级小说生成', '最多999章', '优先AI处理']),
        chapterLimit: 999,
        sortOrder: 2,
        isActive: 1,
        createdAt: new Date().toISOString(),
      },
      {
        id: svipLevelId,
        code: 'svip',
        name: '创世纪SVIP会员',
        description: '超级会员（年卡）',
        price: 29900,
        duration: 365,
        features: JSON.stringify(['顶级小说生成', '最多9999章', '优先AI处理', '专属客服']),
        chapterLimit: 9999,
        sortOrder: 3,
        isActive: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    
    const adminPasswordHash = await hashPassword('Admin@123456');
    await db.insert(users).values({
      id: generateUUID(),
      username: 'admin',
      email: 'admin@example.com',
      passwordHash: adminPasswordHash,
      nickname: '系统管理员',
      avatar: null,
      memberLevelId: svipLevelId,
      memberExpireAt: new Date('2099-12-31T00:00:00.000Z').toISOString(),
      memberStatus: 'active',
      isActive: 1,
      role: 'admin',
      chapterLimit: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    });
    
    await db.insert(aiConfigs).values({
      id: generateUUID(),
      userId: null,
      name: '创世纪联盟',
      provider: 'deepseek',
      apiUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-v4-flash',
      temperature: 85,
      maxTokens: 8192,
      scope: 'system',
      isDefault: 1,
      isActive: 1,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    });
    
    // 初始化提示词数据
    await seedModelPrompts();
    await seedExtractTemplates();
    await seedAgentSkillsToModelPrompts();
    
    // 初始化 ComfyUI 工作流
    await ComfyWorkflowManager.ensureDefaultWorkflows();
    
    console.log('数据库初始化完成!');
  } catch (error) {
    console.error('数据库初始化失败:', error);
    throw error;
  }
}
