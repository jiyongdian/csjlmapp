import { sqliteTable, index, text, integer, blob } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { createSchemaFactory } from "drizzle-zod"
import { z } from "zod"

export const users = sqliteTable("users", {
	id: text("id").primaryKey().notNull(),
	username: text("username").notNull().unique(),
	email: text("email").notNull().unique(),
	passwordHash: text("password_hash").notNull(),
	nickname: text("nickname"),
	avatar: text("avatar"),
	memberLevelId: text("member_level_id"),
	memberExpireAt: text("member_expire_at"),
	memberStatus: text("member_status").default('inactive'),
	isActive: integer("is_active").default(1).notNull(),
	role: text("role").default('user').notNull(),
	chapterLimit: integer("chapter_limit"),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("users_email_idx").on(table.email),
	index("users_username_idx").on(table.username),
]);

export const memberLevels = sqliteTable("member_levels", {
	id: text("id").primaryKey().notNull(),
	code: text("code").notNull().unique(),
	name: text("name").notNull(),
	description: text("description"),
	price: integer("price").default(0).notNull(),
	duration: integer("duration").default(30).notNull(),
	features: text("features"),
	chapterLimit: integer("chapter_limit").default(10).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	isActive: integer("is_active").default(1).notNull(),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("member_levels_code_idx").on(table.code),
	index("member_levels_sort_idx").on(table.sortOrder),
]);

export const memberOrders = sqliteTable("member_orders", {
	id: text("id").primaryKey().notNull(),
	userId: text("user_id").notNull(),
	memberLevelId: text("member_level_id").notNull(),
	orderNo: text("order_no").notNull().unique(),
	amount: integer("amount").default(0).notNull(),
	paymentMethod: text("payment_method"),
	paymentStatus: text("payment_status").default('pending').notNull(),
	paymentTime: text("payment_time"),
	startTime: text("start_time"),
	endTime: text("end_time"),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("member_orders_user_idx").on(table.userId),
	index("member_orders_order_no_idx").on(table.orderNo),
]);

export const novels = sqliteTable("novels", {
	id: text("id").primaryKey().notNull(),
	userId: text("user_id").notNull(),
	title: text("title").notNull(),
	description: text("description"),
	category: text("category"),
	genderTarget: text("gender_target"),
	narrativePerspective: text("narrative_perspective"),
	tone: text("tone"),
	protagonist: text("protagonist"),
	supportingCharacterName: text("supporting_character_name"),
	totalChapters: integer("total_chapters").default(0).notNull(),
	currentChapters: integer("current_chapters").default(0).notNull(),
	status: text("status").default('draft'),
	isPublic: integer("is_public").default(1).notNull(),
	idea: text("idea"),
	structure: text("structure"),
	chapters: text("chapters"),
	coverImage: text("cover_image"),
	styleDNA: text("style_dna"),
	volumeId: text("volume_id"),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("novels_user_id_idx").on(table.userId),
	index("novels_category_idx").on(table.category),
	index("novels_created_at_idx").on(table.createdAt),
	index("novels_status_idx").on(table.status),
]);

// ====== 小说结构化子表 ======

// 剧情表（主线剧情、情感曲线等）
export const novelPlots = sqliteTable("novel_plots", {
	id: text("id").primaryKey().notNull(),
	novelId: text("novel_id").notNull(),
	userId: text("user_id").notNull(),
	mainPlot: text("main_plot"),              // 主线剧情
	emotionalCurve: text("emotional_curve"),   // 情感曲线
	keyConflicts: text("key_conflicts"),        // 关键冲突
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("novel_plots_novel_id_idx").on(table.novelId),
	index("novel_plots_user_id_idx").on(table.userId),
]);

// 章节钩子表（每章一条记录）
export const novelChapterHooks = sqliteTable("novel_chapter_hooks", {
	id: text("id").primaryKey().notNull(),
	novelId: text("novel_id").notNull(),
	userId: text("user_id").notNull(),
	chapterNumber: integer("chapter_number").notNull(),   // 章节序号
	title: text("title"),                                  // 章节标题
	hook: text("hook"),                                    // 章节钩子/摘要
	status: text("status").default('pending'),             // pending / generated / edited
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("novel_chapter_hooks_novel_id_idx").on(table.novelId),
	index("novel_chapter_hooks_user_id_idx").on(table.userId),
	index("novel_chapter_hooks_chapter_num_idx").on(table.novelId, table.chapterNumber),
]);

// 角色表
export const novelCharacters = sqliteTable("novel_characters", {
	id: text("id").primaryKey().notNull(),
	novelId: text("novel_id").notNull(),
	userId: text("user_id").notNull(),
	name: text("name").notNull(),              // 角色名
	role: text("role").default('supporting'),  // protagonist / supporting / antagonist / minor
	gender: text("gender"),                    // 性别 (男/女/未知)
	description: text("description"),          // 角色描述
	personality: text("personality"),           // 性格特征
	appearance: text("appearance"),             // 外貌描述
	aliases: text("aliases"),                   // 别名（@提及 用）
	appearanceHairColor: text("appearance_hair_color"),
	appearanceHairstyle: text("appearance_hairstyle"),
	appearanceEyes: text("appearance_eyes"),
	appearanceUpper: text("appearance_upper"),
	appearanceLower: text("appearance_lower"),
	background: text("background"),            // 背景故事
	relationships: text("relationships"),       // 角色关系（JSON 字符串）
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("novel_characters_novel_id_idx").on(table.novelId),
	index("novel_characters_user_id_idx").on(table.userId),
	index("novel_characters_role_idx").on(table.role),
]);

// 场景表
export const novelScenes = sqliteTable("novel_scenes", {
	id: text("id").primaryKey().notNull(),
	novelId: text("novel_id").notNull(),
	userId: text("user_id").notNull(),
	name: text("name").notNull(),              // 场景名
	description: text("description"),          // 场景描述
	atmosphere: text("atmosphere"),             // 氛围/基调
	relatedChapters: text("related_chapters"), // 关联章节（JSON 数组）
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("novel_scenes_novel_id_idx").on(table.novelId),
	index("novel_scenes_user_id_idx").on(table.userId),
]);

// 物品表
export const novelItems = sqliteTable("novel_items", {
	id: text("id").primaryKey().notNull(),
	novelId: text("novel_id").notNull(),
	userId: text("user_id").notNull(),
	name: text("name").notNull(),              // 物品名
	description: text("description"),          // 物品描述
	significance: text("significance"),         // 重要性/象征意义
	relatedChapters: text("related_chapters"), // 关联章节（JSON 数组）
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("novel_items_novel_id_idx").on(table.novelId),
	index("novel_items_user_id_idx").on(table.userId),
]);

// 角色关系表
export const novelCharacterRelationships = sqliteTable("novel_character_relationships", {
	id: text("id").primaryKey().notNull(),
	novelId: text("novel_id").notNull(),
	userId: text("user_id").notNull(),
	fromCharacter: text("from_character").notNull(), // 关系来源角色名
	toCharacter: text("to_character").notNull(),     // 关系目标角色名
	relationship: text("relationship"),               // 关系描述
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("novel_character_relationships_novel_id_idx").on(table.novelId),
	index("novel_character_relationships_user_id_idx").on(table.userId),
]);

// 角色冲突表
export const novelCharacterConflicts = sqliteTable("novel_character_conflicts", {
	id: text("id").primaryKey().notNull(),
	novelId: text("novel_id").notNull(),
	userId: text("user_id").notNull(),
	fromCharacter: text("from_character").notNull(), // 冲突来源角色名
	toCharacter: text("to_character").notNull(),     // 冲突目标角色名
	conflictType: text("conflict_type"),               // 冲突类型（理念/利益/情感/宿命等）
	description: text("description"),                  // 冲突描述
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("novel_character_conflicts_novel_id_idx").on(table.novelId),
	index("novel_character_conflicts_user_id_idx").on(table.userId),
]);

// ====== 创作记忆系统 ======
export const storyMemory = sqliteTable("story_memory", {
	id: text("id").primaryKey().notNull(),
	novelId: text("novel_id").notNull(),
	userId: text("user_id").notNull(),
	memoryType: text("memory_type").notNull(),  // novelSummary/worldbuilding/characterCard/chapterSummary/timelineEvent/foreshadowing/stylePreference/continuityRule/storyArc/sceneState/relationshipState
	layer: text("layer").default('L2'),          // L1设定/L2章节/L3全书
	title: text("title").notNull(),
	content: text("content"),
	importance: integer("importance").default(70),
	status: text("status").default('confirmed'), // confirmed/pending/conflict
	sourceChapter: integer("source_chapter"),    // 来源章节序号
	evidence: text("evidence"),                   // JSON: {sourceType, sourceId, confidence}
	tags: text("tags"),                           // JSON 数组
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("story_memory_novel_id_idx").on(table.novelId),
	index("story_memory_user_id_idx").on(table.userId),
	index("story_memory_type_idx").on(table.memoryType),
	index("story_memory_layer_idx").on(table.layer),
]);

// ====== 卷结构管理 ======
export const volumes = sqliteTable("volumes", {
	id: text("id").primaryKey().notNull(),
	novelId: text("novel_id").notNull(),
	userId: text("user_id").notNull(),
	title: text("title").notNull(),
	summary: text("summary"),
	orderIndex: integer("order_index").default(1).notNull(),
	chapterCount: integer("chapter_count").default(0),
	wordCount: integer("word_count").default(0),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("volumes_novel_id_idx").on(table.novelId),
	index("volumes_user_id_idx").on(table.userId),
	index("volumes_order_idx").on(table.novelId, table.orderIndex),
]);

// ====== 章节基线表（冲突检测） ======
export const chapterBaselines = sqliteTable("chapter_baselines", {
	id: text("id").primaryKey().notNull(),
	novelId: text("novel_id").notNull(),
	userId: text("user_id").notNull(),
	chapterNumber: integer("chapter_number").notNull(),
	baselineContent: text("baseline_content"),
	baselineHash: text("baseline_hash"),
	currentContent: text("current_content"),
	currentHash: text("current_hash"),
	userEdited: integer("user_edited").default(0),
	lastAiGeneratedAt: text("last_ai_generated_at"),
	lastUserEditedAt: text("last_user_edited_at"),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("chapter_baselines_novel_idx").on(table.novelId),
	index("chapter_baselines_chapter_idx").on(table.novelId, table.chapterNumber),
]);

// ====== 技能系统表 ======
export const skills = sqliteTable("skills", {
	id: text("id").primaryKey().notNull(),
	userId: text("user_id").notNull(),
	name: text("name").notNull(),
	description: text("description"),
	category: text("category").default('writing'),
	systemPrompt: text("system_prompt"),
	userPrompt: text("user_prompt"),
	parameters: text("parameters"),
	isDefault: integer("is_default").default(0),
	isActive: integer("is_active").default(1),
	sortOrder: integer("sort_order").default(0),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("skills_user_idx").on(table.userId),
	index("skills_category_idx").on(table.category),
]);

// ====== 质量检测表（人性质量） ======
export const qualityChecks = sqliteTable("quality_checks", {
	id: text("id").primaryKey().notNull(),
	novelId: text("novel_id").notNull(),
	userId: text("user_id").notNull(),
	chapterNumber: integer("chapter_number"),
	checkType: text("check_type").default('humanity'),
	overallScore: integer("overall_score"),
	emotionScore: integer("emotion_score"),
	specificityScore: integer("specificity_score"),
	naturalnessScore: integer("naturalness_score"),
	dialogueScore: integer("dialogue_score"),
	pacingScore: integer("pacing_score"),
	issues: text("issues"),
	status: text("status").default('completed'),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("quality_checks_novel_idx").on(table.novelId),
	index("quality_checks_chapter_idx").on(table.novelId, table.chapterNumber),
	index("quality_checks_type_idx").on(table.checkType),
]);

export const scripts = sqliteTable("scripts", {
	id: text("id").primaryKey().notNull(),
	novelId: text("novel_id").notNull(),
	userId: text("user_id").notNull(),
	status: text("status").default('draft'),
	chapters: text("chapters"),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("scripts_novel_id_idx").on(table.novelId),
	index("scripts_user_id_idx").on(table.userId),
]);

export const aiConfigs = sqliteTable("ai_configs", {
	id: text("id").primaryKey().notNull(),
	userId: text("user_id"),
	name: text("name").notNull(),
	provider: text("provider").notNull(),
	apiUrl: text("api_url").notNull(),
	apiKey: text("api_key").notNull(),
	model: text("model").notNull(),
	temperature: integer("temperature").default(85).notNull(),
	maxTokens: integer("max_tokens").default(8192),
	scope: text("scope").default('user').notNull(),
	isDefault: integer("is_default").default(0),
	isActive: integer("is_active").default(1),
	modelType: text("model_type").default('text').notNull(),
	extraConfig: text("extra_config"),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("ai_configs_user_id_idx").on(table.userId),
	index("ai_configs_provider_idx").on(table.provider),
	index("ai_configs_scope_idx").on(table.scope),
	index("ai_configs_model_type_idx").on(table.modelType),
]);

export const modelPrompts = sqliteTable("model_prompts", {
	id: text("id").primaryKey().notNull(),
	code: text("code").notNull().unique(),
	name: text("name").notNull(),
	description: text("description"),
	module: text("module").notNull(),
	systemPrompt: text("system_prompt").notNull(),
	userPrompt: text("user_prompt"),
	sortOrder: integer("sort_order").default(0).notNull(),
	isActive: integer("is_active").default(1).notNull(),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("model_prompts_code_idx").on(table.code),
	index("model_prompts_module_idx").on(table.module),
]);

// ====== 资产提取模版（角色 / 场景 / 物品，支持 系统 / 用户 / 作品 三级覆盖） ======
export const extractTemplates = sqliteTable("extract_templates", {
	id: text("id").primaryKey().notNull(),
	userId: text("user_id"),              // NULL = 系统默认
	dramaId: text("drama_id"),            // NULL = 用户级通用；非空 = 仅该作品生效
	kind: text("kind").notNull(),         // character | scene | item
	name: text("name").notNull(),
	template: text("template").notNull(),
	isActive: integer("is_active").default(1).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("extract_templates_lookup_idx").on(table.userId, table.dramaId, table.kind),
]);
export type ExtractTemplate = typeof extractTemplates.$inferSelect;
export type InsertExtractTemplate = typeof extractTemplates.$inferInsert;

export const stylePrompts = sqliteTable("style_prompts", {
	id: text("id").primaryKey().notNull(),
	userId: text("user_id"),              // NULL = 管理员级（所有用户可用）
	kind: text("kind").notNull(),         // character | scene | item | image-storyboard | video-storyboard
	category: text("category").default('风格').notNull(),  // 库内分类；内置预置属于「风格」
	name: text("name").notNull(),
	prompt: text("prompt").notNull(),
	thumbnail: text("thumbnail"),         // 缩略图（dataURL），插入时一并填进参考图片
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("style_prompts_lookup_idx").on(table.userId, table.kind),
]);
export type StylePrompt = typeof stylePrompts.$inferSelect;
export type InsertStylePrompt = typeof stylePrompts.$inferInsert;

const { createInsertSchema } = createSchemaFactory({
	coerce: { date: true },
});

export const insertUserSchema = createInsertSchema(users).pick({
	username: true,
	email: true,
	passwordHash: true,
	nickname: true,
	avatar: true,
});

export const updateUserSchema = createInsertSchema(users)
	.pick({
		nickname: true,
		avatar: true,
		memberLevelId: true,
		memberExpireAt: true,
		memberStatus: true,
		chapterLimit: true,
		isActive: true,
	})
	.partial();

export const insertMemberLevelSchema = createInsertSchema(memberLevels).pick({
	code: true,
	name: true,
	description: true,
	price: true,
	duration: true,
	features: true,
	sortOrder: true,
	isActive: true,
	chapterLimit: true,
});

export const updateMemberLevelSchema = createInsertSchema(memberLevels)
	.pick({
		name: true,
		description: true,
		price: true,
		duration: true,
		features: true,
		sortOrder: true,
		isActive: true,
		chapterLimit: true,
	})
	.partial();

export const insertMemberOrderSchema = createInsertSchema(memberOrders).pick({
	userId: true,
	memberLevelId: true,
	orderNo: true,
	amount: true,
	paymentMethod: true,
});

export const updateMemberOrderSchema = createInsertSchema(memberOrders)
	.pick({
		paymentStatus: true,
		paymentTime: true,
		startTime: true,
		endTime: true,
	})
	.partial();

export const insertScriptSchema = createInsertSchema(scripts).pick({
	novelId: true,
	userId: true,
	status: true,
}).extend({
	chapters: z.any().optional(),
});

export const updateScriptSchema = createInsertSchema(scripts)
	.pick({
		status: true,
	})
	.extend({
		chapters: z.any().optional(),
	})
	.partial();

export const insertModelPromptSchema = createInsertSchema(modelPrompts).pick({
	code: true,
	name: true,
	description: true,
	module: true,
	systemPrompt: true,
	userPrompt: true,
	sortOrder: true,
	isActive: true,
});

export const updateModelPromptSchema = createInsertSchema(modelPrompts)
	.pick({
		name: true,
		description: true,
		module: true,
		systemPrompt: true,
		userPrompt: true,
		sortOrder: true,
		isActive: true,
	})
	.partial();

export const insertNovelSchema = createInsertSchema(novels).pick({
	userId: true,
	title: true,
	description: true,
	category: true,
	genderTarget: true,
	narrativePerspective: true,
	protagonist: true,
	supportingCharacterName: true,
	totalChapters: true,
	currentChapters: true,
	status: true,
}).extend({
	tone: z.any().optional(),
	idea: z.any().optional(),
	structure: z.any().optional(),
	chapters: z.any().optional(),
});

export const updateNovelSchema = createInsertSchema(novels)
	.pick({
		title: true,
		description: true,
		category: true,
		genderTarget: true,
		narrativePerspective: true,
		protagonist: true,
		coverImage: true,
		supportingCharacterName: true,
		totalChapters: true,
		currentChapters: true,
		status: true,
	})
	.extend({
		tone: z.any().optional(),
		idea: z.any().optional(),
		structure: z.any().optional(),
		chapters: z.any().optional(),
		styleDNA: z.any().optional(),
		// 公开开关：前端传布尔，落库转为 0/1
		isPublic: z.union([z.boolean(), z.number().int()]).optional(),
	})
	.partial();

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;

export type MemberLevel = typeof memberLevels.$inferSelect;
export type InsertMemberLevel = z.infer<typeof insertMemberLevelSchema>;
export type UpdateMemberLevel = z.infer<typeof updateMemberLevelSchema>;

export type MemberOrder = typeof memberOrders.$inferSelect;
export type InsertMemberOrder = z.infer<typeof insertMemberOrderSchema>;
export type UpdateMemberOrder = z.infer<typeof updateMemberOrderSchema>;

export type Novel = typeof novels.$inferSelect;
export type InsertNovel = z.infer<typeof insertNovelSchema>;
export type UpdateNovel = z.infer<typeof updateNovelSchema>;

// ====== 小说子表 Schemas & Types ======

export const insertNovelPlotSchema = createInsertSchema(novelPlots).pick({
	novelId: true,
	userId: true,
	mainPlot: true,
	emotionalCurve: true,
	keyConflicts: true,
	sortOrder: true,
});
export const updateNovelPlotSchema = createInsertSchema(novelPlots)
	.pick({ mainPlot: true, emotionalCurve: true, keyConflicts: true, sortOrder: true })
	.partial();
export type NovelPlot = typeof novelPlots.$inferSelect;
export type InsertNovelPlot = z.infer<typeof insertNovelPlotSchema>;
export type UpdateNovelPlot = z.infer<typeof updateNovelPlotSchema>;

export const insertNovelChapterHookSchema = createInsertSchema(novelChapterHooks).pick({
	novelId: true,
	userId: true,
	chapterNumber: true,
	title: true,
	hook: true,
	status: true,
});
export const updateNovelChapterHookSchema = createInsertSchema(novelChapterHooks)
	.pick({ title: true, hook: true, status: true })
	.partial();
export type NovelChapterHook = typeof novelChapterHooks.$inferSelect;
export type InsertNovelChapterHook = z.infer<typeof insertNovelChapterHookSchema>;
export type UpdateNovelChapterHook = z.infer<typeof updateNovelChapterHookSchema>;

export const insertNovelCharacterSchema = createInsertSchema(novelCharacters).pick({
	novelId: true,
	userId: true,
	name: true,
	role: true,
	gender: true,
	description: true,
	personality: true,
	appearance: true,
	aliases: true,
	appearanceHairColor: true,
	appearanceHairstyle: true,
	appearanceEyes: true,
	appearanceUpper: true,
	appearanceLower: true,
	background: true,
	relationships: true,
	sortOrder: true,
});
export const updateNovelCharacterSchema = createInsertSchema(novelCharacters)
	.pick({ name: true, role: true, gender: true, description: true, personality: true, appearance: true,
		aliases: true,
		appearanceHairColor: true, appearanceHairstyle: true, appearanceEyes: true, appearanceUpper: true,
		appearanceLower: true,
		background: true, relationships: true, sortOrder: true })
	.partial();
export type NovelCharacter = typeof novelCharacters.$inferSelect;
export type InsertNovelCharacter = z.infer<typeof insertNovelCharacterSchema>;
export type UpdateNovelCharacter = z.infer<typeof updateNovelCharacterSchema>;

export const insertNovelSceneSchema = createInsertSchema(novelScenes).pick({
	novelId: true,
	userId: true,
	name: true,
	description: true,
	atmosphere: true,
	relatedChapters: true,
	sortOrder: true,
});
export const updateNovelSceneSchema = createInsertSchema(novelScenes)
	.pick({ name: true, description: true, atmosphere: true, relatedChapters: true, sortOrder: true })
	.partial();
export type NovelScene = typeof novelScenes.$inferSelect;
export type InsertNovelScene = z.infer<typeof insertNovelSceneSchema>;
export type UpdateNovelScene = z.infer<typeof updateNovelSceneSchema>;

export const insertNovelItemSchema = createInsertSchema(novelItems).pick({
	novelId: true,
	userId: true,
	name: true,
	description: true,
	significance: true,
	relatedChapters: true,
	sortOrder: true,
});
export const updateNovelItemSchema = createInsertSchema(novelItems)
	.pick({ name: true, description: true, significance: true, relatedChapters: true, sortOrder: true })
	.partial();
export type NovelItem = typeof novelItems.$inferSelect;
export type InsertNovelItem = z.infer<typeof insertNovelItemSchema>;
export type UpdateNovelItem = z.infer<typeof updateNovelItemSchema>;

export const insertNovelCharacterRelationshipSchema = createInsertSchema(novelCharacterRelationships).pick({
	novelId: true, userId: true, fromCharacter: true, toCharacter: true, relationship: true, sortOrder: true,
});
export const updateNovelCharacterRelationshipSchema = createInsertSchema(novelCharacterRelationships)
	.pick({ fromCharacter: true, toCharacter: true, relationship: true, sortOrder: true })
	.partial();
export type NovelCharacterRelationship = typeof novelCharacterRelationships.$inferSelect;
export type InsertNovelCharacterRelationship = z.infer<typeof insertNovelCharacterRelationshipSchema>;
export type UpdateNovelCharacterRelationship = z.infer<typeof updateNovelCharacterRelationshipSchema>;

// 角色冲突 Schema
export const insertNovelCharacterConflictSchema = createInsertSchema(novelCharacterConflicts).pick({
	novelId: true, userId: true, fromCharacter: true, toCharacter: true, conflictType: true, description: true, sortOrder: true,
});
export const updateNovelCharacterConflictSchema = createInsertSchema(novelCharacterConflicts)
	.pick({ fromCharacter: true, toCharacter: true, conflictType: true, description: true, sortOrder: true })
	.partial();
export type NovelCharacterConflict = typeof novelCharacterConflicts.$inferSelect;
export type InsertNovelCharacterConflict = z.infer<typeof insertNovelCharacterConflictSchema>;
export type UpdateNovelCharacterConflict = z.infer<typeof updateNovelCharacterConflictSchema>;

export type Script = typeof scripts.$inferSelect;
export type InsertScript = z.infer<typeof insertScriptSchema>;
export type UpdateScript = z.infer<typeof updateScriptSchema>;

export const insertAiConfigSchema = createInsertSchema(aiConfigs).omit({ id: true });
export const updateAiConfigSchema = createInsertSchema(aiConfigs).partial();

export type AiConfig = typeof aiConfigs.$inferSelect;
export type InsertAiConfig = z.infer<typeof insertAiConfigSchema>;
export type UpdateAiConfig = z.infer<typeof updateAiConfigSchema>;

export const inviteCodes = sqliteTable("invite_codes", {
	id: text("id").primaryKey().notNull(),
	code: text("code").notNull().unique(),
	description: text("description"),
	levelType: text("level_type"),
	memberLevelId: text("member_level_id"),
	maxUses: integer("max_uses").default(1).notNull(),
	currentUses: integer("current_uses").default(0).notNull(),
	isUsedUp: integer("is_used_up").default(0).notNull(),
	isActive: integer("is_active").default(1).notNull(),
	expiresAt: text("expires_at"),
	createdBy: text("created_by"),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("invite_codes_code_idx").on(table.code),
	index("invite_codes_status_idx").on(table.isActive),
	index("invite_codes_level_type_idx").on(table.levelType),
]);

// ====== ComfyUI 工作流表 ======
export const comfyWorkflows = sqliteTable("comfy_workflows", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  description: text("description"),
  fileName: text("file_name"),          // 存储在 ComfyUIAI 文件夹中的文件名
  workflowPath: text("workflow_path"),   // 完整文件路径
  workflowJson: text("workflow_json"),   // 工作流 JSON 内容
  workflowType: text("workflow_type").default('video'), // video / image / audio
  modelType: text("model_type"),        // 模型类型（如 MiniMax H3）
  isDefault: integer("is_default").default(0),
  sortOrder: integer("sort_order").default(0),
  isActive: integer("is_active").default(1).notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text("updated_at"),
}, (table) => [
  index("comfy_workflows_name_idx").on(table.name),
  index("comfy_workflows_type_idx").on(table.workflowType),
  index("comfy_workflows_default_idx").on(table.isDefault),
  index("comfy_workflows_active_idx").on(table.isActive),
]);

export const insertComfyWorkflowSchema = createInsertSchema(comfyWorkflows).pick({
  id: true,
  name: true,
  description: true,
  fileName: true,
  workflowPath: true,
  workflowJson: true,
  workflowType: true,
  modelType: true,
  isDefault: true,
  sortOrder: true,
  isActive: true,
});

export const updateComfyWorkflowSchema = createInsertSchema(comfyWorkflows)
  .pick({
    name: true,
    description: true,
    fileName: true,
    workflowPath: true,
    workflowJson: true,
    workflowType: true,
    modelType: true,
    isDefault: true,
    sortOrder: true,
    isActive: true,
  })
  .partial();

export type ComfyWorkflow = typeof comfyWorkflows.$inferSelect;
export type InsertComfyWorkflow = z.infer<typeof insertComfyWorkflowSchema>;
export type UpdateComfyWorkflow = z.infer<typeof updateComfyWorkflowSchema>;

export const insertInviteCodeSchema = createInsertSchema(inviteCodes).pick({
	code: true,
	description: true,
	levelType: true,
	memberLevelId: true,
	maxUses: true,
	expiresAt: true,
}).partial().transform((data) => ({
	// code 为空时自动生成
	code: data.code || `INV${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
	description: data.description,
	levelType: data.levelType,
	memberLevelId: data.memberLevelId,
	maxUses: data.maxUses ?? 1,
	expiresAt: data.expiresAt,
}));

export const updateInviteCodeSchema = createInsertSchema(inviteCodes)
	.pick({
		description: true,
		maxUses: true,
		isActive: true,
		isUsedUp: true,
		expiresAt: true,
	})
	.partial();

export type InviteCode = typeof inviteCodes.$inferSelect;
export type InsertInviteCode = z.infer<typeof insertInviteCodeSchema>;
export type UpdateInviteCode = z.infer<typeof updateInviteCodeSchema>;

// ====== 项目表（剧本项目） ======

export const projects = sqliteTable("projects", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	name: text("name").notNull(),
	description: text("description"),
	coverUrl: text("cover_url"),
	scope: integer("scope").default(0),
	ownerType: integer("owner_type").default(0),
	ownerId: text("owner_id"),
	status: integer("status").default(0),
	properties: text("properties"),
	artStyle: text("art_style"),
	artStyleDescription: text("art_style_description"),
	artStyleImagePrompt: text("art_style_image_prompt"),
	artStyleImageUrl: text("art_style_image_url"),
	createTime: text("create_time").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updateTime: text("update_time"),
}, (table) => [
	index("projects_owner_id_idx").on(table.ownerId),
	index("projects_status_idx").on(table.status),
	index("projects_name_idx").on(table.name),
]);

export const insertProjectSchema = createInsertSchema(projects).pick({
	name: true,
	description: true,
	coverUrl: true,
	scope: true,
	ownerType: true,
	ownerId: true,
	status: true,
	properties: true,
	artStyle: true,
	artStyleDescription: true,
	artStyleImagePrompt: true,
	artStyleImageUrl: true,
});

export const updateProjectSchema = createInsertSchema(projects)
	.pick({ name: true, description: true, coverUrl: true, scope: true, ownerType: true, ownerId: true, status: true, properties: true, artStyle: true, artStyleDescription: true, artStyleImagePrompt: true, artStyleImageUrl: true })
	.partial();

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type UpdateProject = z.infer<typeof updateProjectSchema>;

// ====== 短剧表 ======

export const shortDramas = sqliteTable("short_dramas", {
	id: text("id").primaryKey().notNull(),
	novelId: text("novel_id"),
	scriptId: text("script_id"),
	userId: text("user_id").notNull(),
	title: text("title").notNull(),
	description: text("description"),
	genre: text("genre"),
	targetAudience: text("target_audience"),
	totalEpisodes: integer("total_episodes").default(0).notNull(),
	currentEpisodes: integer("current_episodes").default(0).notNull(),
	episodeDuration: integer("episode_duration").default(60),
	status: text("status").default('draft'),
	coverImage: text("cover_image"),
	tags: text("tags"),
	style: text("style"),
	platform: text("platform"),
	characterStyle: text("character_style"),
	sceneStyle: text("scene_style"),
	itemStyle: text("item_style"),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("short_dramas_user_id_idx").on(table.userId),
	index("short_dramas_novel_id_idx").on(table.novelId),
	index("short_dramas_script_id_idx").on(table.scriptId),
	index("short_dramas_status_idx").on(table.status),
]);

export const shortDramaEpisodes = sqliteTable("short_drama_episodes", {
	id: text("id").primaryKey().notNull(),
	dramaId: text("drama_id").notNull(),
	userId: text("user_id").notNull(),
	episodeNumber: integer("episode_number").notNull(),
	title: text("title"),
	synopsis: text("synopsis"),
	screenplay: text("screenplay"),
	screenplayScenes: text("screenplay_scenes"),
	scenes: text("scenes"),
	dialogues: text("dialogues"),
	directions: text("directions"),
	imagePrompts: text("image_prompts"),
	videoPrompts: text("video_prompts"),
	duration: integer("duration"),
	status: text("status").default('draft'),
	sourceChapter: integer("source_chapter"),
	sourceScriptChapterIndex: integer("source_script_chapter_index"),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("short_drama_episodes_drama_id_idx").on(table.dramaId),
	index("short_drama_episodes_user_id_idx").on(table.userId),
	index("short_drama_episodes_number_idx").on(table.dramaId, table.episodeNumber),
]);

export const insertShortDramaSchema = createInsertSchema(shortDramas).pick({
	novelId: true,
	scriptId: true,
	userId: true,
	title: true,
	description: true,
	genre: true,
	targetAudience: true,
	totalEpisodes: true,
	episodeDuration: true,
	status: true,
	coverImage: true,
	tags: true,
	style: true,
	platform: true,
});
export const updateShortDramaSchema = createInsertSchema(shortDramas)
	.pick({ title: true, description: true, genre: true, targetAudience: true, totalEpisodes: true, episodeDuration: true, status: true, coverImage: true, tags: true, style: true, platform: true, scriptId: true, novelId: true, characterStyle: true, sceneStyle: true, itemStyle: true })
	.partial();
export type ShortDrama = typeof shortDramas.$inferSelect;
export type InsertShortDrama = z.infer<typeof insertShortDramaSchema>;
export type UpdateShortDrama = z.infer<typeof updateShortDramaSchema>;

export const insertShortDramaEpisodeSchema = createInsertSchema(shortDramaEpisodes).pick({
	dramaId: true,
	userId: true,
	episodeNumber: true,
	title: true,
	synopsis: true,
	screenplay: true,
	screenplayScenes: true,
	scenes: true,
	dialogues: true,
	directions: true,
	imagePrompts: true,
	videoPrompts: true,
	duration: true,
	status: true,
	sourceChapter: true,
	sourceScriptChapterIndex: true,
});
export const updateShortDramaEpisodeSchema = createInsertSchema(shortDramaEpisodes)
	.pick({ title: true, synopsis: true, screenplay: true, screenplayScenes: true, scenes: true, dialogues: true, directions: true, imagePrompts: true, videoPrompts: true, duration: true, status: true, sourceChapter: true, sourceScriptChapterIndex: true })
	.partial();
export type ShortDramaEpisode = typeof shortDramaEpisodes.$inferSelect;
export type InsertShortDramaEpisode = z.infer<typeof insertShortDramaEpisodeSchema>;
export type UpdateShortDramaEpisode = z.infer<typeof updateShortDramaEpisodeSchema>;

// ====== 短剧角色表 ======

export const dramaCharacters = sqliteTable("drama_characters", {
	id: text("id").primaryKey().notNull(),
	dramaId: text("drama_id").notNull(),
	userId: text("user_id").notNull(),
	name: text("name").notNull(),
	role: text("role").default('supporting'),
	gender: text("gender"),
	description: text("description"),
	personality: text("personality"),
	appearance: text("appearance"),
	aliases: text("aliases"),
	appearanceHairColor: text("appearance_hair_color"),
	appearanceHairstyle: text("appearance_hairstyle"),
	appearanceEyes: text("appearance_eyes"),
	appearanceUpper: text("appearance_upper"),
	appearanceLower: text("appearance_lower"),
	voiceId: text("voice_id"),
	voiceProvider: text("voice_provider"),
	voiceConfig: text("voice_config"),
	imageUrl: text("image_url"),
	imagePrompt: text("image_prompt"),
	referenceImages: text("reference_images"),
	imageGallery: text("image_gallery"), // JSON数组: [{url, prompt, createdAt}]
	sortOrder: integer("sort_order").default(0),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("drama_characters_drama_id_idx").on(table.dramaId),
	index("drama_characters_user_id_idx").on(table.userId),
]);

export const insertDramaCharacterSchema = createInsertSchema(dramaCharacters).pick({
	dramaId: true, userId: true, name: true, role: true, gender: true, description: true,
	personality: true, appearance: true, aliases: true, appearanceHairColor: true, appearanceHairstyle: true,
	appearanceEyes: true, appearanceUpper: true, appearanceLower: true, voiceId: true, voiceProvider: true,
	voiceConfig: true, imageUrl: true, imagePrompt: true, referenceImages: true, imageGallery: true, sortOrder: true,
});
export const updateDramaCharacterSchema = createInsertSchema(dramaCharacters)
	.pick({ name: true, role: true, gender: true, description: true, personality: true, appearance: true,
		aliases: true,
		appearanceHairColor: true, appearanceHairstyle: true, appearanceEyes: true, appearanceUpper: true,
		appearanceLower: true,
		voiceId: true, voiceProvider: true, voiceConfig: true, imageUrl: true, imagePrompt: true,
		referenceImages: true, imageGallery: true, sortOrder: true })
	.partial();
export type DramaCharacter = typeof dramaCharacters.$inferSelect;
export type InsertDramaCharacter = z.infer<typeof insertDramaCharacterSchema>;
export type UpdateDramaCharacter = z.infer<typeof updateDramaCharacterSchema>;

// ====== 短剧场景表 ======

export const dramaScenes = sqliteTable("drama_scenes", {
	id: text("id").primaryKey().notNull(),
	dramaId: text("drama_id").notNull(),
	userId: text("user_id").notNull(),
	name: text("name").notNull(),
	description: text("description"),
	atmosphere: text("atmosphere"),
	imageUrl: text("image_url"),
	imagePrompt: text("image_prompt"),
	imageGallery: text("image_gallery"), // JSON数组: [{url, prompt, createdAt}]
	sortOrder: integer("sort_order").default(0),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("drama_scenes_drama_id_idx").on(table.dramaId),
	index("drama_scenes_user_id_idx").on(table.userId),
]);

export const insertDramaSceneSchema = createInsertSchema(dramaScenes).pick({
	dramaId: true, userId: true, name: true, description: true,
	atmosphere: true, imageUrl: true, imagePrompt: true, imageGallery: true, sortOrder: true,
});
export const updateDramaSceneSchema = createInsertSchema(dramaScenes)
	.pick({ name: true, description: true, atmosphere: true, imageUrl: true, imagePrompt: true, imageGallery: true, sortOrder: true })
	.partial();
export type DramaScene = typeof dramaScenes.$inferSelect;
export type InsertDramaScene = z.infer<typeof insertDramaSceneSchema>;
export type UpdateDramaScene = z.infer<typeof updateDramaSceneSchema>;

// ====== 短剧物品表 ======

export const dramaItems = sqliteTable("drama_items", {
	id: text("id").primaryKey().notNull(),
	dramaId: text("drama_id").notNull(),
	userId: text("user_id").notNull(),
	name: text("name").notNull(),
	description: text("description"),
	significance: text("significance"),
	imageUrl: text("image_url"),
	imagePrompt: text("image_prompt"),
	imageGallery: text("image_gallery"), // JSON数组: [{url, prompt, createdAt}]
	sortOrder: integer("sort_order").default(0),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("drama_items_drama_id_idx").on(table.dramaId),
	index("drama_items_user_id_idx").on(table.userId),
]);

export const insertDramaItemSchema = createInsertSchema(dramaItems).pick({
	dramaId: true, userId: true, name: true, description: true,
	significance: true, imageUrl: true, imagePrompt: true, imageGallery: true, sortOrder: true,
});
export const updateDramaItemSchema = createInsertSchema(dramaItems)
	.pick({ name: true, description: true, significance: true, imageUrl: true, imagePrompt: true, imageGallery: true, sortOrder: true })
	.partial();
export type DramaItem = typeof dramaItems.$inferSelect;
export type InsertDramaItem = z.infer<typeof insertDramaItemSchema>;
export type UpdateDramaItem = z.infer<typeof updateDramaItemSchema>;

// ====== 短剧分镜表 ======

export const dramaStoryboards = sqliteTable("drama_storyboards", {
	id: text("id").primaryKey().notNull(),
	dramaId: text("drama_id").notNull(),
	episodeId: text("episode_id").notNull(),
	userId: text("user_id").notNull(),
	shotNumber: integer("shot_number").notNull(),
	shotType: text("shot_type").default('storyboard'),
	sceneDescription: text("scene_description"),
	cameraAngle: text("camera_angle"),
	cameraMovement: text("camera_movement"),
	dialogue: text("dialogue"),
	voiceover: text("voiceover"),
	soundEffects: text("sound_effects"),
	characterIds: text("character_ids"),
	imagePrompt: text("image_prompt"),
	imageUrl: text("image_url"),
	videoPrompt: text("video_prompt"),
	videoUrl: text("video_url"),
	videoDownloadUrl: text("video_download_url"),
	videoGallery: text("video_gallery"), // JSON数组: [{url, prompt, createdAt}]
	audioUrl: text("audio_url"),
	ttsText: text("tts_text"),
	ttsVoiceId: text("tts_voice_id"),
	subtitle: text("subtitle"),
	negativePrompt: text("negative_prompt"),
	duration: integer("duration").default(3),
	status: text("status").default('draft'),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: text("updated_at"),
}, (table) => [
	index("drama_storyboards_drama_id_idx").on(table.dramaId),
	index("drama_storyboards_episode_id_idx").on(table.episodeId),
	index("drama_storyboards_user_id_idx").on(table.userId),
	index("drama_storyboards_shot_idx").on(table.episodeId, table.shotNumber),
]);

export const insertDramaStoryboardSchema = createInsertSchema(dramaStoryboards).pick({
	dramaId: true, episodeId: true, userId: true, shotNumber: true, shotType: true,
	sceneDescription: true, cameraAngle: true, cameraMovement: true, dialogue: true,
	voiceover: true, soundEffects: true, characterIds: true, imagePrompt: true,
	imageUrl: true, videoPrompt: true, videoUrl: true, videoDownloadUrl: true, videoGallery: true, audioUrl: true, ttsText: true,
	ttsVoiceId: true, subtitle: true, negativePrompt: true, duration: true, status: true,
}) as any;
export const updateDramaStoryboardSchema = createInsertSchema(dramaStoryboards)
	.pick({ shotNumber: true, shotType: true, sceneDescription: true, cameraAngle: true,
		cameraMovement: true, dialogue: true, voiceover: true, soundEffects: true,
		characterIds: true, imagePrompt: true, imageUrl: true, videoPrompt: true,
		videoUrl: true, videoDownloadUrl: true, videoGallery: true, audioUrl: true, ttsText: true, ttsVoiceId: true, subtitle: true,
		negativePrompt: true, duration: true, status: true })
	.partial();
export type DramaStoryboard = typeof dramaStoryboards.$inferSelect;
export type InsertDramaStoryboard = z.infer<typeof insertDramaStoryboardSchema>;
export type UpdateDramaStoryboard = z.infer<typeof updateDramaStoryboardSchema>;

// ====== 短剧资产表 ======

export const dramaAssets = sqliteTable("drama_assets", {
	id: text("id").primaryKey().notNull(),
	dramaId: text("drama_id").notNull(),
	userId: text("user_id").notNull(),
	type: text("type").notNull(),
	name: text("name").notNull(),
	url: text("url"),
	localPath: text("local_path"),
	mimeType: text("mime_type"),
	fileSize: integer("file_size"),
	width: integer("width"),
	height: integer("height"),
	duration: integer("duration"),
	metadata: text("metadata"),
	relatedShotId: text("related_shot_id"),
	relatedEpisodeId: text("related_episode_id"),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("drama_assets_drama_id_idx").on(table.dramaId),
	index("drama_assets_user_id_idx").on(table.userId),
	index("drama_assets_type_idx").on(table.type),
]);

// @ts-ignore
export const insertDramaAssetSchema = createInsertSchema(dramaAssets).pick({
	dramaId: true, userId: true, type: true, name: true, url: true, localPath: true,
	mimeType: true, fileSize: true, width: true, height: true, duration: true,
	metadata: true, relatedShotId: true, relatedEpisodeId: true,
} as any);
export type DramaAsset = typeof dramaAssets.$inferSelect;
export type InsertDramaAsset = z.infer<typeof insertDramaAssetSchema>;

// ====== 短剧任务表 ======

export const dramaTasks = sqliteTable("drama_tasks", {
	id: text("id").primaryKey().notNull(),
	dramaId: text("drama_id").notNull(),
	userId: text("user_id").notNull(),
	type: text("type").notNull(),
	targetId: text("target_id"),
	provider: text("provider"),
	model: text("model"),
	status: text("status").default('pending').notNull(),
	progress: integer("progress").default(0),
	input: text("input"),
	output: text("output"),
	error: text("error"),
	startedAt: text("started_at"),
	completedAt: text("completed_at"),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("drama_tasks_drama_id_idx").on(table.dramaId),
	index("drama_tasks_user_id_idx").on(table.userId),
	index("drama_tasks_status_idx").on(table.status),
	index("drama_tasks_type_idx").on(table.type),
]);

export const insertDramaTaskSchema = createInsertSchema(dramaTasks).pick({
	dramaId: true, userId: true, type: true, targetId: true, provider: true,
	model: true, status: true, input: true,
} as any);
export type DramaTask = typeof dramaTasks.$inferSelect;
export type InsertDramaTask = z.infer<typeof insertDramaTaskSchema>;

// ====== AI 图片/视频/TTS 提供商 ======

export const IMAGE_PROVIDERS = [
	{ id: "openai", name: "OpenAI DALL-E", baseUrl: "https://api.openai.com/v1", models: ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2", "gpt-image-1.5", "gpt-image-1-mini", "gpt-image-1", "dall-e-3", "dall-e-2"] },
	{ id: "gpt-image-2", name: "GPT Image 2", baseUrl: "https://api.openai.com/v1", models: ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2", "gpt-image-1.5", "gpt-image-1-mini"] },
	{ id: "codex-gpt-image-2", name: "Codex GPT Image 2", baseUrl: "https://api.openai.com/v1", models: ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2", "gpt-image-1.5", "gpt-image-1-mini"] },
	{ id: "siliconflow", name: "硅基流动 SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", models: ["black-forest-labs/FLUX.2-pro", "black-forest-labs/FLUX.2-flex", "Qwen/Qwen-Image", "Qwen/Qwen-Image-Edit", "Tongyi-MAI/Z-Image-Turbo", "black-forest-labs/FLUX.1-Kontext-max", "black-forest-labs/FLUX.1-Kontext-pro", "black-forest-labs/FLUX.1-Kontext-dev", "black-forest-labs/FLUX.1-schnell", "black-forest-labs/FLUX.1-dev", "stabilityai/stable-diffusion-3-5-large", "stabilityai/stable-diffusion-xl-base-1.0", "Kwai-Kolors/Kolors", "Pro/black-forest-labs/FLUX.1-schnell"] },
	{ id: "stability-ai", name: "Stability AI", baseUrl: "https://api.stability.ai", models: ["stable-image-ultra", "stable-image-core", "sd3.5-large", "sd3.5-large-turbo", "sd3.5-medium", "sd3.5-flash"] },
	{ id: "cogview", name: "智谱 CogView", baseUrl: "https://open.bigmodel.cn/api/paas/v4", models: ["glm-image", "cogview-4-250304", "cogview-4-flash", "cogview-4", "cogview-3-flash", "cogview-3-plus", "cogview-3"] },
	{ id: "minimax", name: "MiniMax", baseUrl: "https://api.minimax.chat/v1", models: ["image-01-live", "image-01"] },
	{ id: "volcengine", name: "火山引擎", baseUrl: "https://visual.volcengineapi.com", models: ["jimeng_t2i_v40", "high_aes_general_v30l_zt2i", "jimeng_t2i_v31", "jimeng_t2i_v30", "jimeng_i2i_v30", "jimeng_high_aes_general_v21_L", "high_aes_general_v21", "high_aes_general_v20", "high_aes_general_v14l"] },
	{ id: "volcengine-ark", name: "火山引擎 Seedream (方舟)", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: ["doubao-seedream-5-0-pro-260628", "doubao-seedream-5-0-260128", "doubao-seedream-4-5-251128", "doubao-seedream-4-0-250828", "doubao-seedream-3-0-t2i-250415"] },
	{ id: "qwen-image", name: "阿里通义万相", baseUrl: "https://dashscope.aliyuncs.com/api/v1", models: ["wan2.7-image-pro", "wan2.7-image", "wan2.6-t2i", "wan2.5-t2i-preview", "wan2.2-t2i-flash", "wan2.2-t2i-plus", "qwen-image-3.0-pro", "qwen-image-3.0", "qwen-image-2.0-pro", "qwen-image-2.0", "qwen-image-max", "qwen-image-plus", "qwen-image", "wanx2.1-t2i-turbo", "wanx2.1-t2i-plus", "wanx2.1-sketch-t2i-v1", "wanx-v1"] },
	{ id: "gemini-image", name: "Google Imagen", baseUrl: "https://generativelanguage.googleapis.com/v1beta", models: ["gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image", "gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview", "gemini-2.5-flash-image", "imagen-4.0-generate-preview-06-06", "imagen-4.0-ultra-generate-exp-05-20", "imagen-3.0-generate-002"] },
	{ id: "ideogram", name: "Ideogram", baseUrl: "https://api.ideogram.ai", models: ["ideogram-v4", "ideogram-v4-balanced", "ideogram-v3-turbo", "V_3", "V_2_TURBO", "V_2"] },
	{ id: "chatfire", name: "Chatfire", baseUrl: "https://api.chatfire.cn/v1", models: ["chatfire-image-1", "nano-banana-pro", "nano-banana", "flux-2-pro", "flux-2-dev", "qwen-image", "qwen-image-edit", "z-image-turbo", "flux-pro-max"] },
	{ id: "gemini-banana", name: "Gemini香蕉生图(本地代理)", baseUrl: "http://127.0.0.1:8000", models: ["gemini-3.0-pro-image-landscape-2k", "gemini-3.0-pro-image-portrait-2k", "gemini-3.0-pro-image-landscape", "gemini-3.0-pro-image-portrait", "gemini-3.1-flash-image-landscape-2k", "gemini-3.1-flash-image-portrait-2k", "gemini-3.1-flash-image-landscape", "gemini-3.1-flash-image-portrait", "gemini-3.1-flash-lite-image-landscape-2k", "gemini-3.1-flash-lite-image-portrait-2k"] },
	{ id: "custom-image", name: "自定义图片API", baseUrl: "", models: [] },
] as const;

export const VIDEO_PROVIDERS = [
	{ id: "kling", name: "可灵 Kling AI", baseUrl: "https://api.klingai.com", models: ["kling-v3", "kling-v3-omni", "kling-video-o1", "kling-v2-6", "kling-v2-5-turbo", "kling-v2-1-master", "kling-v2-1", "kling-v2-master", "kling-v1-6", "kling-v1-5", "kling-v1"] },
	{ id: "minimax-video", name: "MiniMax Video", baseUrl: "https://api.minimax.chat/v1", models: ["MiniMax-Hailuo-2.3", "MiniMax-Hailuo-02", "I2V-01-Director", "I2V-01-live", "I2V-01", "T2V-01-Director", "T2V-01", "S2V-01", "video-01-director", "video-01"] },
	{ id: "minimax-h3", name: "MiniMax H3 (海螺 H3)", baseUrl: "https://api.minimax.chat", models: ["MiniMax-H3", "MiniMax-H3-Max"] },
	{ id: "volcengine-video", name: "火山引擎 Seedance", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: ["doubao-seedance-2-5-260628", "doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-mini-260615", "doubao-seedance-1-5-pro-251215", "doubao-seedance-1-0-pro-fast-251015", "doubao-seedance-1-0-pro-250528", "doubao-seedance-1-5-pro", "seedance-1-0-pro-250528", "seedance-1-0-lite-250528"] },
	{ id: "vidu", name: "Vidu", baseUrl: "https://api.vidu.cn/v1", models: ["viduq3-pro", "viduq3-pro-fast", "viduq3-turbo", "viduq2-pro", "viduq2-pro-fast", "viduq2-turbo", "viduq2", "viduq1", "viduq1-classic", "vidu-2.0", "vidu-1.5", "vidu-1.0"] },
	{ id: "runway", name: "Runway ML", baseUrl: "https://api.dev.runwayml.com", models: ["gen4.5", "gen4_turbo", "gen4", "gen3a_turbo"] },
	{ id: "luma", name: "Luma Dream Machine", baseUrl: "https://api.lumalabs.ai", models: ["ray-2", "ray-flash-2", "ray-2-720p", "ray-1-6"] },
	{ id: "qwen-video", name: "阿里通义万象", baseUrl: "https://dashscope.aliyuncs.com/api/v1", models: ["wan2.7-i2v", "wan2.6-i2v", "wan2.6-i2v-flash", "wan2.5-i2v-preview", "wan2.2-i2v-flash", "wan2.2-i2v-plus", "wan2.1-i2v-turbo", "wan2.1-i2v-plus", "wanx2.1-i2v-turbo", "wanx2.1-i2v-plus", "wanx-v1-video"] },
	{ id: "grok-video", name: "Grok (xAI)", baseUrl: "https://api.x.ai/v1", models: ["grok-imagine-video-1.5-preview", "grok-imagine-video", "grok-2-aurora"] },
	{ id: "seedance2", name: "Seedance 2.0", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: ["doubao-seedance-2-5-260628", "doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-mini-260615", "seedance-2-0-pro-250616", "seedance-2-0-lite-250616"] },
	{ id: "veo", name: "Google Veo", baseUrl: "https://generativelanguage.googleapis.com/v1beta", models: ["veo-3.1-generate-001", "veo-3.1-fast-generate-001", "veo-3.1-lite-generate-001", "veo-3.1-generate-preview", "veo-3.1-fast-generate-preview", "veo_3_1_i2v_fast_landscape", "veo_3_1_i2v_fast_portrait", "veo_3_1_i2v_lite_landscape", "veo_3_1_i2v_lite_portrait", "veo_3_1_t2v_fast_landscape", "veo_3_1_t2v_fast_portrait", "veo-3.0-generate-preview", "veo-2.0-generate-001"] },
	{ id: "dfyue", name: "DFYue (Seedance)", baseUrl: "https://d.csjlm.app/v1", models: ["seedance_v2.0"] },
	{ id: "agnes-video", name: "Agnes Video", baseUrl: "https://apihub.agnes-ai.com", models: ["agnes-video-2.5-flash", "agnes-video-v2.0"] },
	{ id: "newapi-video", name: "NewAPI 视频", baseUrl: "", models: ["grok-imagine-video-1.5-preview", "grok-imagine-video", "doubao-seedance-2-5-260628"] },
	{ id: "custom-video", name: "自定义视频API", baseUrl: "", models: [] },
] as const;

export const TTS_PROVIDERS = [
	{ id: "mimo-tts", name: "小米 MiMo 语音合成", baseUrl: "https://api.xiaomimimo.com/v1", models: ["mimo-v2.5-tts", "mimo-v2.5-asr", "mimo-v2.5-tts-voiceclone", "mimo-v2.5-tts-voicedesign"] },
	{ id: "minimax-tts", name: "MiniMax TTS", baseUrl: "https://api.minimax.chat/v1", models: ["speech-02-hd", "speech-02", "speech-01-turbo"] },
	{ id: "gpt-sovits", name: "GPT-SoVITS", baseUrl: "http://localhost:9880", models: ["default"] },
	{ id: "edge-tts", name: "EdgeTTS", baseUrl: "", models: ["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural", "zh-CN-YunjianNeural", "zh-CN-XiaoyiNeural"] },
	{ id: "index-tts", name: "IndexTTS", baseUrl: "http://localhost:8080", models: ["default"] },
	{ id: "custom-tts", name: "自定义TTS", baseUrl: "", models: [] },
] as const;

export const AI_PROVIDERS = [
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", models: [
    "gpt-6-astra",
    "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6",
    "gpt-5.5", "gpt-5.4", "gpt-5.3", "gpt-5.2", "gpt-5.1", "gpt-5",
    "gpt-realtime-2.1", "gpt-realtime-2",
    "gpt-4.5", "gpt-4.5-turbo", "gpt-4.5-preview",
    "gpt-4o", "gpt-4o-2024-11-20", "gpt-4o-mini", "gpt-4o-mini-2024-07-18",
    "gpt-4-turbo", "gpt-4-turbo-2024-04-09",
    "gpt-4", "gpt-4-32k",
    "gpt-3.5-turbo", "gpt-3.5-turbo-16k"
  ]},
  { id: "anthropic", name: "Anthropic Claude", baseUrl: "https://api.anthropic.com/v1", models: [
    "claude-fable-5-1", "claude-fable-5",
    "claude-opus-5", "claude-sonnet-5",
    "claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-4-6", "claude-opus-4-6",
    "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1",
    "claude-sonnet-4-20250514", "claude-sonnet-4", 
    "claude-3-5-sonnet-latest", "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-latest", "claude-3-5-haiku-20241022",
    "claude-3-opus-latest", "claude-3-opus-20240229",
    "claude-3-sonnet-latest", "claude-3-sonnet-20240229",
    "claude-3-haiku-latest", "claude-3-haiku-20240307"
  ]},
  { id: "google", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/models", models: [
    "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash",
    "gemini-3.5-flash", "gemini-3.5-flash-lite",
    "gemini-3.1-pro-preview", "gemini-3.1-flash-lite", "gemini-3-flash-preview",
    "gemini-omni-flash-preview",
    "gemini-2.5-pro-preview-06-05", "gemini-2.5-flash-preview-05-20",
    "gemini-2.0-pro-exp", "gemini-2.0-flash-exp",
    "gemini-1.5-pro-latest", "gemini-1.5-pro-001", "gemini-1.5-pro-002", "gemini-1.5-pro-002",
    "gemini-1.5-flash-latest", "gemini-1.5-flash-001", "gemini-1.5-flash-002", "gemini-1.5-flash-002",
    "gemini-1.5-flash-8b-latest", "gemini-1.5-flash-8b-001"
  ]},
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", models: [
    "deepseek-flash", "deepseek-v4-pro", "deepseek-v4-flash",
    "deepseek-v4-pro-0813", "deepseek-v4-flash-0731",
    "deepseek-v3-2-251201", "deepseek-v3", "deepseek-chat",
    "deepseek-r1-250528", "deepseek-r1", "deepseek-r1-distill-qwen-32b",
    "deepseek-coder", "deepseek-coder-lite"
  ]},
  { id: "qwen", name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: [
    "qwen3.8-max", "qwen3.8-max-0902", "qwen3.8-flash", "qwen3.8-2.4t-a95b",
    "qwen3.7-max", "qwen3.7-plus", "qwen3.7-flash",
    "qwen3.6-plus", "qwen3.6-flash", "qwen3.6-35b-a3b", "qwen3.6-27b",
    "qwen3.5-omni-plus", "qwen3-omni-flash", "qwen3.5-ocr",
    "qwen3-vl-plus", "qwen3-vl-flash",
    "qwen3-4-32b", "qwen3-1.7b", "qwen3-8b", "qwen3-32b", "qwen3-57b-a47b", "qwen3-140b-a47b",
    "qwen-plus", "qwen-plus-latest", "qwen-max", "qwen-max-latest",
    "qwen-turbo", "qwen-turbo-latest", "qwen-long",
    "qwq-32b", "qwen2.5-72b-instruct", "qwen2.5-7b-instruct"
  ]},
  { id: "kimi", name: "Kimi Moonshot", baseUrl: "https://api.moonshot.cn/v1", models: [
    "kimi-k3", "kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6",
    "kimi-k2-260127",
    "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k",
    "moonshot-v1-auto"
  ]},
  { id: "zhipu", name: "智谱AI GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", models: [
    "glm-5.3", "glm-5.3-flash", "glm-5.2", "glm-5.1", "glm-5",
    "glm-4.6v", "glm-4.6v-flash", "glm-4.6", "glm-4.5", "glm-4.5-air", "glm-ocr",
    "glm-5.0-260211", "glm-5-turbo-260316",
    "glm-4-7-251222", "glm-4-plus", "glm-4-flash",
    "glm-4", "glm-4v", "glm-4-airx", "glm-4-air",
    "glm-3-turbo", "glm-3"
  ]},
  { id: "minimax", name: "MiniMax", baseUrl: "https://api.minimax.chat/v", models: [
    "MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed",
    "MiniMax-M2.5", "MiniMax-M2.1", "MiniMax-M2",
    "MiniMax-Text-01", "MiniMax-Text-01-Turbo",
    "abab6.5s-chat", "abab6.5g-chat", "abab5.5-chat",
    "abab5.5s-chat"
  ]},
  { id: "step", name: "阶跃星辰 Step", baseUrl: "https://api.stepfun.com/v1", models: [
    "step-3.7-flash", "step-3.5-flash-2603", "step-3.5-flash",
    "step-audio-2", "step-audio-2-mini", "step-1o-audio",
    "step-2-250528", "step-2-mini",
    "step-1v-8k", "step-1v-32k",
    "step-1o-mini"
  ]},
  { id: "yi", name: "零一万物 Yi", baseUrl: "https://api.lingyiwanwu.com/v1", models: [
    "yi-lightning", "yi-large-turbo", "yi-vision",
    "yi-large", "yi-large-rag", "yi-medium", "yi-medium-200k",
    "yi-spark", "yi-34b-chat", "yi-9b-chat"
  ]},
  { id: "tiangong", name: "天工AI", baseUrl: "https://api.tiangong.cn/v1", models: [
    "Skywork-o1", "Skywork-o1-0414",
    "Skywork-13b-chat", "Skywork-13b"
  ]},
  { id: "xfyun", name: "讯飞星火", baseUrl: "https://spark-api.xf-yun.com/v1", models: [
    "spark-x2.5", "xsparkx2flash",
    "generalv3.5", "generalv3",
    "generalv2.0", "general"
  ]},
  { id: "baidu", name: "百度文心", baseUrl: "https://qianfan.baidubce.com/v2", models: [
    "ernie-5.1", "ernie-5.1-preview", "ernie-5.0",
    "ernie-4.5-vl-28b-a3b",
    "ernie-4.0-8k-latest", "ernie-4.0-8k", "ernie-4.0-turbo-8k",
    "ernie-3.5-8k", "ernie-3.5-8k-attention",
    "ernie-speed-128k", "ernie-speed-8k", "ernie-lite-8k"
  ]},
  { id: "doubao", name: "字节豆包", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: [
    "doubao-seed-evolving",
    "doubao-seed-2-1-pro-260628", "doubao-seed-2-1-turbo-260628",
    "doubao-seed-2-0-lite-260428", "doubao-seed-2-0-mini-260428",
    "doubao-seed-2.0-pro-260215", "doubao-seed-2.0-lite-260215", "doubao-seed-2.0-mini-260215",
    "doubao-seed-1.8-251228",
    "doubao-pro-32k", "doubao-pro-4k"
  ]},
  { id: "custom", name: "自定义API", baseUrl: "", models: [] },
] as const;
/* P3-3：chapter_pipeline_runs —— LastRecords 三表跨请求/进程兜底快照（仅 runtime cache 恢复用，不替代 novels.chapters） */
export const chapterPipelineRuns = sqliteTable("chapter_pipeline_runs", {
	id: text("id").primaryKey().notNull(),
	runKey: text("run_key").notNull(), /* idea+structure 摘要生成的稳定 key，UI 无需关心 */
	userId: text("user_id"),
	chapterNumber: integer("chapter_number").notNull(),
	title: text("title"),
	summaryHead: text("summary_head"),
	summaryMiddle: text("summary_middle"),
	summaryTail: text("summary_tail"),
	tailRaw: text("tail_raw"),
	chars: integer("chars").default(0).notNull(),
	endingCategory: text("ending_category"),
	ledgerTailJson: text("ledger_tail_json"),
	localFinalScore: integer("local_final_score"),
	hardAnchorJson: text("hard_anchor_json"), // ★ 跨章衔接硬锚点 JSON（ChapterHardAnchor）
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("chapter_pipeline_runs_key_idx").on(table.runKey, table.chapterNumber),
]);
