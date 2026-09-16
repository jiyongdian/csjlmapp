import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';

// Setup type safety for global caching in Next.js development and server processes
const globalForSqlite = globalThis as unknown as {
  sqlite: Database.Database | undefined;
  db: ReturnType<typeof drizzle> | undefined;
  dbInitialized: boolean | undefined;
};

// SQLite 文件路径：默认 CWD 下 novel.db；可用 DB_PATH 覆盖（Docker 卷持久化时用绝对路径）
function resolveDbPath(): string {
  const p = String(process.env.DB_PATH || '').trim();
  return p || 'novel.db';
}

export const sqlite = globalForSqlite.sqlite ?? (() => {
  const s = new Database(resolveDbPath());
  // 并发写入支持：WAL 模式允许多读一写；busy_timeout 等待锁释放而不是立即抛 SQLITE_BUSY
  s.pragma('journal_mode = WAL');
  s.pragma('busy_timeout = 10000');
  globalForSqlite.sqlite = s;
  return s;
})();

export const db = globalForSqlite.db ?? (() => {
  const d = drizzle(sqlite);
  globalForSqlite.db = d;
  return d;
})();

export async function getDb() {
  return db;
}

if (!globalForSqlite.dbInitialized) {
  console.log('[Database] First-time initialization/migration of SQLite database in this process.');
  
  sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nickname TEXT,
    avatar TEXT,
    member_level_id TEXT,
    member_expire_at TEXT,
    member_status TEXT DEFAULT 'inactive',
    is_active INTEGER DEFAULT 1 NOT NULL,
    role TEXT DEFAULT 'user' NOT NULL,
    chapter_limit INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  -- 扩展 novels 表：封面图 + 风格DNA（SQLite 不支持 IF NOT EXISTS，用独立 exec + try-catch）
  
  
  CREATE TABLE IF NOT EXISTS member_levels (
    id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER DEFAULT 0 NOT NULL,
    duration INTEGER DEFAULT 30 NOT NULL,
    features TEXT,
    chapter_limit INTEGER DEFAULT 10 NOT NULL,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    is_active INTEGER DEFAULT 1 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  
  CREATE TABLE IF NOT EXISTS member_orders (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    member_level_id TEXT NOT NULL,
    order_no TEXT NOT NULL UNIQUE,
    amount INTEGER DEFAULT 0 NOT NULL,
    payment_method TEXT,
    payment_status TEXT DEFAULT 'pending' NOT NULL,
    payment_time TEXT,
    start_time TEXT,
    end_time TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  
  CREATE TABLE IF NOT EXISTS novels (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    gender_target TEXT,
    narrative_perspective TEXT,
    tone TEXT,
    protagonist TEXT,
    supporting_character_name TEXT,
    total_chapters INTEGER DEFAULT 0 NOT NULL,
    current_chapters INTEGER DEFAULT 0 NOT NULL,
    status TEXT DEFAULT 'draft',
    is_public INTEGER DEFAULT 1 NOT NULL,
    idea TEXT,
    structure TEXT,
    chapters TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  
  CREATE TABLE IF NOT EXISTS novel_plots (
    id TEXT PRIMARY KEY NOT NULL,
    novel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    main_plot TEXT,
    emotional_curve TEXT,
    key_conflicts TEXT,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS novel_chapter_hooks (
    id TEXT PRIMARY KEY NOT NULL,
    novel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    chapter_number INTEGER NOT NULL,
    title TEXT,
    hook TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS novel_characters (
    id TEXT PRIMARY KEY NOT NULL,
    novel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'supporting',
    gender TEXT,
    description TEXT,
    personality TEXT,
    appearance TEXT,
    aliases TEXT,
    appearance_hair_color TEXT,
    appearance_hairstyle TEXT,
    appearance_eyes TEXT,
    appearance_upper TEXT,
    appearance_lower TEXT,
    background TEXT,
    relationships TEXT,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS novel_scenes (
    id TEXT PRIMARY KEY NOT NULL,
    novel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    atmosphere TEXT,
    related_chapters TEXT,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS novel_items (
    id TEXT PRIMARY KEY NOT NULL,
    novel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    significance TEXT,
    related_chapters TEXT,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS novel_character_relationships (
    id TEXT PRIMARY KEY NOT NULL,
    novel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    from_character TEXT NOT NULL,
    to_character TEXT NOT NULL,
    relationship TEXT,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS novel_character_conflicts (
    id TEXT PRIMARY KEY NOT NULL,
    novel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    from_character TEXT NOT NULL,
    to_character TEXT NOT NULL,
    conflict_type TEXT,
    description TEXT,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE INDEX IF NOT EXISTS novel_character_conflicts_novel_id_idx ON novel_character_conflicts(novel_id);
  CREATE INDEX IF NOT EXISTS novel_character_conflicts_user_id_idx ON novel_character_conflicts(user_id);

  CREATE TABLE IF NOT EXISTS scripts (
    id TEXT PRIMARY KEY NOT NULL,
    novel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    chapters TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS script_history (
    id TEXT PRIMARY KEY NOT NULL,
    script_id TEXT NOT NULL,
    novel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    chapters TEXT,
    status TEXT DEFAULT 'draft',
    source TEXT DEFAULT 'auto',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_script_history_script_id ON script_history(script_id);
  CREATE INDEX IF NOT EXISTS idx_script_history_novel_id ON script_history(novel_id);

  CREATE TABLE IF NOT EXISTS story_memory (
    id TEXT PRIMARY KEY NOT NULL,
    novel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    memory_type TEXT NOT NULL,
    layer TEXT DEFAULT 'L2',
    title TEXT NOT NULL,
    content TEXT,
    importance INTEGER DEFAULT 70,
    status TEXT DEFAULT 'confirmed',
    source_chapter INTEGER,
    evidence TEXT,
    tags TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS story_memory_novel_id_idx ON story_memory(novel_id);
  CREATE INDEX IF NOT EXISTS story_memory_user_id_idx ON story_memory(user_id);
  CREATE INDEX IF NOT EXISTS story_memory_type_idx ON story_memory(memory_type);

  CREATE TABLE IF NOT EXISTS volumes (
    id TEXT PRIMARY KEY NOT NULL,
    novel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    order_index INTEGER DEFAULT 1 NOT NULL,
    chapter_count INTEGER DEFAULT 0,
    word_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS volumes_novel_id_idx ON volumes(novel_id);
  CREATE INDEX IF NOT EXISTS volumes_user_id_idx ON volumes(user_id);

  CREATE TABLE IF NOT EXISTS chapter_baselines (
    id TEXT PRIMARY KEY NOT NULL,
    novel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    chapter_number INTEGER NOT NULL,
    baseline_content TEXT,
    baseline_hash TEXT,
    current_content TEXT,
    current_hash TEXT,
    user_edited INTEGER DEFAULT 0,
    last_ai_generated_at TEXT,
    last_user_edited_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS chapter_baselines_novel_idx ON chapter_baselines(novel_id);
  CREATE INDEX IF NOT EXISTS chapter_baselines_chapter_idx ON chapter_baselines(novel_id, chapter_number);

  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'writing',
    system_prompt TEXT,
    user_prompt TEXT,
    parameters TEXT,
    is_default INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS skills_user_idx ON skills(user_id);
  CREATE INDEX IF NOT EXISTS skills_category_idx ON skills(category);

  CREATE TABLE IF NOT EXISTS quality_checks (
    id TEXT PRIMARY KEY NOT NULL,
    novel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    chapter_number INTEGER,
    check_type TEXT DEFAULT 'humanity',
    overall_score INTEGER,
    emotion_score INTEGER,
    specificity_score INTEGER,
    naturalness_score INTEGER,
    dialogue_score INTEGER,
    pacing_score INTEGER,
    issues TEXT,
    status TEXT DEFAULT 'completed',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE INDEX IF NOT EXISTS quality_checks_novel_idx ON quality_checks(novel_id);
  CREATE INDEX IF NOT EXISTS quality_checks_chapter_idx ON quality_checks(novel_id, chapter_number);
  CREATE INDEX IF NOT EXISTS quality_checks_type_idx ON quality_checks(check_type);

  CREATE TABLE IF NOT EXISTS short_dramas (
    id TEXT PRIMARY KEY NOT NULL,
    novel_id TEXT,
    script_id TEXT,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    genre TEXT,
    target_audience TEXT,
    total_episodes INTEGER DEFAULT 0 NOT NULL,
    current_episodes INTEGER DEFAULT 0 NOT NULL,
    episode_duration INTEGER DEFAULT 60,
    status TEXT DEFAULT 'draft',
    cover_image TEXT,
    tags TEXT,
    style TEXT,
    platform TEXT,
    character_style TEXT,
    scene_style TEXT,
    item_style TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS short_drama_episodes (
    id TEXT PRIMARY KEY NOT NULL,
    drama_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    episode_number INTEGER NOT NULL,
    title TEXT,
    synopsis TEXT,
    screenplay TEXT,
    screenplay_scenes TEXT,
    scenes TEXT,
    dialogues TEXT,
    directions TEXT,
    image_prompts TEXT,
    video_prompts TEXT,
    duration INTEGER,
    status TEXT DEFAULT 'draft',
    source_chapter INTEGER,
    source_script_chapter_index INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS drama_characters (
    id TEXT PRIMARY KEY NOT NULL,
    drama_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'supporting',
    description TEXT,
    personality TEXT,
    appearance TEXT,
    aliases TEXT,
    appearance_hair_color TEXT,
    appearance_hairstyle TEXT,
    appearance_eyes TEXT,
    appearance_upper TEXT,
    appearance_lower TEXT,
    voice_id TEXT,
    voice_provider TEXT,
    voice_config TEXT,
    image_url TEXT,
    image_prompt TEXT,
    reference_images TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS drama_scenes (
    id TEXT PRIMARY KEY NOT NULL,
    drama_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    atmosphere TEXT,
    image_url TEXT,
    image_prompt TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS drama_items (
    id TEXT PRIMARY KEY NOT NULL,
    drama_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    significance TEXT,
    image_url TEXT,
    image_prompt TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS drama_storyboards (
    id TEXT PRIMARY KEY NOT NULL,
    drama_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    shot_number INTEGER NOT NULL,
    shot_type TEXT DEFAULT 'storyboard',
    scene_description TEXT,
    camera_angle TEXT,
    camera_movement TEXT,
    dialogue TEXT,
    voiceover TEXT,
    sound_effects TEXT,
    character_ids TEXT,
    image_prompt TEXT,
    image_url TEXT,
    video_prompt TEXT,
    video_url TEXT,
    audio_url TEXT,
    tts_text TEXT,
    tts_voice_id TEXT,
    subtitle TEXT,
    duration INTEGER DEFAULT 3,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS drama_assets (
    id TEXT PRIMARY KEY NOT NULL,
    drama_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT,
    local_path TEXT,
    mime_type TEXT,
    file_size INTEGER,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    metadata TEXT,
    related_shot_id TEXT,
    related_episode_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS drama_tasks (
    id TEXT PRIMARY KEY NOT NULL,
    drama_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    target_id TEXT,
    provider TEXT,
    model TEXT,
    status TEXT DEFAULT 'pending' NOT NULL,
    progress INTEGER DEFAULT 0,
    input TEXT,
    output TEXT,
    error TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    cover_url TEXT,
    scope INTEGER DEFAULT 0,
    owner_type INTEGER DEFAULT 0,
    owner_id TEXT,
    status INTEGER DEFAULT 0,
    properties TEXT,
    art_style TEXT,
    art_style_description TEXT,
    art_style_image_prompt TEXT,
    art_style_image_url TEXT,
    create_time TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    update_time TEXT
  );

  CREATE TABLE IF NOT EXISTS ai_configs (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    api_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT NOT NULL,
    temperature INTEGER DEFAULT 85 NOT NULL,
    max_tokens INTEGER DEFAULT 8192,
    scope TEXT DEFAULT 'user' NOT NULL,
    is_default INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    model_type TEXT DEFAULT 'text' NOT NULL,
    extra_config TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  
  CREATE TABLE IF NOT EXISTS model_prompts (
    id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    module TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    user_prompt TEXT,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    is_active INTEGER DEFAULT 1 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  
  CREATE TABLE IF NOT EXISTS extract_templates (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    drama_id TEXT,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    template TEXT NOT NULL,
    is_active INTEGER DEFAULT 1 NOT NULL,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS extract_templates_lookup_idx ON extract_templates (user_id, drama_id, kind);

  CREATE TABLE IF NOT EXISTS style_prompts (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    kind TEXT NOT NULL,
    category TEXT DEFAULT '风格' NOT NULL,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    thumbnail TEXT,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS style_prompts_lookup_idx ON style_prompts (user_id, kind);

  CREATE TABLE IF NOT EXISTS invite_codes (
    id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL UNIQUE,
    description TEXT,
    level_type TEXT,
    member_level_id TEXT,
    max_uses INTEGER DEFAULT 1 NOT NULL,
    current_uses INTEGER DEFAULT 0 NOT NULL,
    is_used_up INTEGER DEFAULT 0 NOT NULL,
    is_active INTEGER DEFAULT 1 NOT NULL,
    expires_at TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS comfy_workflows (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    file_name TEXT,
    workflow_path TEXT,
    workflow_json TEXT,
    workflow_type TEXT DEFAULT 'video',
    model_type TEXT,
    is_default INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  
  CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);
  CREATE INDEX IF NOT EXISTS users_username_idx ON users (username);
  CREATE INDEX IF NOT EXISTS member_levels_code_idx ON member_levels (code);
  CREATE INDEX IF NOT EXISTS member_levels_sort_idx ON member_levels (sort_order);
  CREATE INDEX IF NOT EXISTS member_orders_user_idx ON member_orders (user_id);
  CREATE INDEX IF NOT EXISTS member_orders_order_no_idx ON member_orders (order_no);
  CREATE INDEX IF NOT EXISTS novels_user_id_idx ON novels (user_id);
  CREATE INDEX IF NOT EXISTS novels_category_idx ON novels (category);
  CREATE INDEX IF NOT EXISTS novels_created_at_idx ON novels (created_at);
  CREATE INDEX IF NOT EXISTS novels_status_idx ON novels (status);
  CREATE INDEX IF NOT EXISTS novel_plots_novel_id_idx ON novel_plots (novel_id);
  CREATE INDEX IF NOT EXISTS novel_plots_user_id_idx ON novel_plots (user_id);
  CREATE INDEX IF NOT EXISTS novel_chapter_hooks_novel_id_idx ON novel_chapter_hooks (novel_id);
  CREATE INDEX IF NOT EXISTS novel_chapter_hooks_user_id_idx ON novel_chapter_hooks (user_id);
  CREATE INDEX IF NOT EXISTS novel_chapter_hooks_chapter_num_idx ON novel_chapter_hooks (novel_id, chapter_number);
  CREATE INDEX IF NOT EXISTS novel_characters_novel_id_idx ON novel_characters (novel_id);
  CREATE INDEX IF NOT EXISTS novel_characters_user_id_idx ON novel_characters (user_id);
  CREATE INDEX IF NOT EXISTS novel_characters_role_idx ON novel_characters (role);
  CREATE INDEX IF NOT EXISTS novel_scenes_novel_id_idx ON novel_scenes (novel_id);
  CREATE INDEX IF NOT EXISTS novel_scenes_user_id_idx ON novel_scenes (user_id);
  CREATE INDEX IF NOT EXISTS novel_items_novel_id_idx ON novel_items (novel_id);
  CREATE INDEX IF NOT EXISTS novel_items_user_id_idx ON novel_items (user_id);
  CREATE INDEX IF NOT EXISTS novel_character_relationships_novel_id_idx ON novel_character_relationships (novel_id);
  CREATE INDEX IF NOT EXISTS novel_character_relationships_user_id_idx ON novel_character_relationships (user_id);
  CREATE INDEX IF NOT EXISTS scripts_novel_id_idx ON scripts (novel_id);
  CREATE INDEX IF NOT EXISTS scripts_user_id_idx ON scripts (user_id);
  CREATE INDEX IF NOT EXISTS projects_owner_id_idx ON projects (owner_id);
  CREATE INDEX IF NOT EXISTS projects_status_idx ON projects (status);
  CREATE INDEX IF NOT EXISTS projects_name_idx ON projects (name);
  CREATE INDEX IF NOT EXISTS ai_configs_user_id_idx ON ai_configs (user_id);
  CREATE INDEX IF NOT EXISTS ai_configs_provider_idx ON ai_configs (provider);
  CREATE INDEX IF NOT EXISTS ai_configs_scope_idx ON ai_configs (scope);
  CREATE INDEX IF NOT EXISTS ai_configs_model_type_idx ON ai_configs (model_type);
  CREATE INDEX IF NOT EXISTS model_prompts_code_idx ON model_prompts (code);
  CREATE INDEX IF NOT EXISTS model_prompts_module_idx ON model_prompts (module);
  CREATE INDEX IF NOT EXISTS invite_codes_code_idx ON invite_codes (code);
  CREATE INDEX IF NOT EXISTS invite_codes_status_idx ON invite_codes (is_active);
  CREATE INDEX IF NOT EXISTS invite_codes_level_type_idx ON invite_codes (level_type);
  CREATE INDEX IF NOT EXISTS comfy_workflows_name_idx ON comfy_workflows (name);
  CREATE INDEX IF NOT EXISTS comfy_workflows_type_idx ON comfy_workflows (workflow_type);
  CREATE INDEX IF NOT EXISTS comfy_workflows_default_idx ON comfy_workflows (is_default);
  CREATE INDEX IF NOT EXISTS comfy_workflows_active_idx ON comfy_workflows (is_active);
  CREATE INDEX IF NOT EXISTS short_dramas_user_id_idx ON short_dramas (user_id);
  CREATE INDEX IF NOT EXISTS short_dramas_novel_id_idx ON short_dramas (novel_id);
  CREATE INDEX IF NOT EXISTS short_dramas_status_idx ON short_dramas (status);
  CREATE INDEX IF NOT EXISTS short_drama_episodes_drama_id_idx ON short_drama_episodes (drama_id);
  CREATE INDEX IF NOT EXISTS short_drama_episodes_user_id_idx ON short_drama_episodes (user_id);
  CREATE INDEX IF NOT EXISTS short_drama_episodes_number_idx ON short_drama_episodes (drama_id, episode_number);
  CREATE INDEX IF NOT EXISTS drama_characters_drama_id_idx ON drama_characters (drama_id);
  CREATE INDEX IF NOT EXISTS drama_characters_user_id_idx ON drama_characters (user_id);
  CREATE INDEX IF NOT EXISTS drama_scenes_drama_id_idx ON drama_scenes (drama_id);
  CREATE INDEX IF NOT EXISTS drama_scenes_user_id_idx ON drama_scenes (user_id);
  CREATE INDEX IF NOT EXISTS drama_items_drama_id_idx ON drama_items (drama_id);
  CREATE INDEX IF NOT EXISTS drama_items_user_id_idx ON drama_items (user_id);
  CREATE INDEX IF NOT EXISTS drama_storyboards_drama_id_idx ON drama_storyboards (drama_id);
  CREATE INDEX IF NOT EXISTS drama_storyboards_episode_id_idx ON drama_storyboards (episode_id);
  CREATE INDEX IF NOT EXISTS drama_storyboards_user_id_idx ON drama_storyboards (user_id);
  CREATE INDEX IF NOT EXISTS drama_storyboards_shot_idx ON drama_storyboards (episode_id, shot_number);
  CREATE INDEX IF NOT EXISTS drama_assets_drama_id_idx ON drama_assets (drama_id);
  CREATE INDEX IF NOT EXISTS drama_assets_user_id_idx ON drama_assets (user_id);
  CREATE INDEX IF NOT EXISTS drama_assets_type_idx ON drama_assets (type);
  CREATE INDEX IF NOT EXISTS drama_tasks_drama_id_idx ON drama_tasks (drama_id);
  CREATE INDEX IF NOT EXISTS drama_tasks_user_id_idx ON drama_tasks (user_id);
  CREATE INDEX IF NOT EXISTS drama_tasks_status_idx ON drama_tasks (status);
  CREATE INDEX IF NOT EXISTS drama_tasks_type_idx ON drama_tasks (type);

  -- ===== Agent 对话式创作（chevoink 移植：最小子集）=====
  CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    novel_id TEXT,
    title TEXT DEFAULT '新对话' NOT NULL,
    status TEXT DEFAULT 'active' NOT NULL,
    chapter_index INTEGER,
    scope TEXT DEFAULT 'studio' NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_sessions_user_idx ON agent_sessions (user_id);
  CREATE INDEX IF NOT EXISTS agent_sessions_novel_idx ON agent_sessions (novel_id);

  CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT,
    tool_name TEXT,
    tool_payload TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_messages_session_idx ON agent_messages (session_id);

  CREATE TABLE IF NOT EXISTS agent_session_digest (
    session_id TEXT PRIMARY KEY NOT NULL,
    digest TEXT NOT NULL,
    covered_count INTEGER DEFAULT 0 NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    novel_id TEXT,
    chapter_index INTEGER,
    prompt TEXT NOT NULL,
    status TEXT DEFAULT 'running' NOT NULL,
    error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX IF NOT EXISTS agent_runs_session_idx ON agent_runs (session_id);
  CREATE INDEX IF NOT EXISTS agent_runs_user_idx ON agent_runs (user_id);

  -- ===== 社区（帖子/评论/点赞）=====
  CREATE TABLE IF NOT EXISTS community_posts (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    images TEXT,
    topic_key TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE INDEX IF NOT EXISTS community_posts_user_idx ON community_posts (user_id);
  CREATE INDEX IF NOT EXISTS community_posts_topic_idx ON community_posts (topic_key);
  CREATE INDEX IF NOT EXISTS community_posts_created_idx ON community_posts (created_at);

  CREATE TABLE IF NOT EXISTS community_comments (
    id TEXT PRIMARY KEY NOT NULL,
    post_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE INDEX IF NOT EXISTS community_comments_post_idx ON community_comments (post_id);

  CREATE TABLE IF NOT EXISTS community_post_likes (
    id TEXT PRIMARY KEY NOT NULL,
    post_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE INDEX IF NOT EXISTS community_likes_post_idx ON community_post_likes (post_id);
  CREATE INDEX IF NOT EXISTS community_likes_user_idx ON community_post_likes (user_id);

  -- ===== 私信 =====
  CREATE TABLE IF NOT EXISTS message_threads (
    id TEXT PRIMARY KEY NOT NULL,
    user_a TEXT NOT NULL,
    user_b TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE INDEX IF NOT EXISTS message_threads_a_idx ON message_threads (user_a);
  CREATE INDEX IF NOT EXISTS message_threads_b_idx ON message_threads (user_b);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY NOT NULL,
    thread_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT NOT NULL,
    is_read INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (thread_id);
  CREATE INDEX IF NOT EXISTS messages_sender_idx ON messages (sender_id);

  -- ===== 管理后台审计日志 =====
  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id TEXT PRIMARY KEY NOT NULL,
    admin_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE INDEX IF NOT EXISTS admin_audit_admin_idx ON admin_audit_log (admin_user_id);
  CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_log (created_at);

  -- ===== 作品变更记录（Agent 工作区时间线） =====
  CREATE TABLE IF NOT EXISTS novel_changes (
    id TEXT PRIMARY KEY NOT NULL,
    novel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    chapter_index INTEGER,
    title TEXT,
    detail TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE INDEX IF NOT EXISTS novel_changes_novel_idx ON novel_changes (novel_id);
  CREATE INDEX IF NOT EXISTS novel_changes_user_idx ON novel_changes (user_id);

  -- ===== Agent 生成任务（后台运行·历史可恢复） =====
  CREATE TABLE IF NOT EXISTS agent_generations (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    novel_id TEXT,
    title TEXT,
    total INTEGER DEFAULT 0,
    current INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running',
    chapters TEXT,
    error TEXT,
    updated_at TEXT
  );
`);


// 迁移：为已有数据库添加缺失的列
function migrateColumns() {
  try {
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_configs'").all() as any[];
    if (tables.length === 0) return;

    const columns = sqlite.prepare("PRAGMA table_info(ai_configs)").all() as any[];
    const colNames = new Set(columns.map((c) => c.name));

    if (!colNames.has('model_type')) {
      sqlite.prepare("ALTER TABLE ai_configs ADD COLUMN model_type TEXT DEFAULT 'text' NOT NULL").run();
      console.log('[Migrate] Added ai_configs.model_type column');
    }
    if (!colNames.has('extra_config')) {
      sqlite.prepare("ALTER TABLE ai_configs ADD COLUMN extra_config TEXT").run();
      console.log('[Migrate] Added ai_configs.extra_config column');
    }
  } catch (e) {
    console.warn('[Migrate] ai_configs columns migration skipped:', e);
  }
}

migrateColumns();

// 迁移：style_prompts 增加「分类」列（老库回填为「风格」）
function migrateStylePromptColumns() {
  try {
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='style_prompts'").all() as any[];
    if (tables.length === 0) return;
    const cols = sqlite.prepare('PRAGMA table_info(style_prompts)').all() as any[];
    const colNames = new Set(cols.map((c: any) => c.name));
    if (!colNames.has('category')) {
      sqlite.prepare("ALTER TABLE style_prompts ADD COLUMN category TEXT DEFAULT '风格' NOT NULL").run();
      console.log('[Migrate] Added style_prompts.category column');
    }
  } catch (e) {
    console.warn('[Migrate] style_prompts columns migration skipped:', e);
  }
}

migrateStylePromptColumns();

// 迁移：空表直接 DROP 重建，确保 schema 完全一致
function rebuildEmptyTablesIfNeeded() {
  const tablesToCheck = ['short_dramas', 'short_drama_episodes', 'drama_characters', 'drama_scenes', 'drama_items', 'drama_storyboards', 'drama_assets', 'drama_tasks'];
  for (const tableName of tablesToCheck) {
    try {
      const exists = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`).all();
      if (exists.length === 0) continue;
      const count = sqlite.prepare(`SELECT count(*) as cnt FROM ${tableName}`).get() as any;
      if (count?.cnt > 0) continue;
      // 表存在但为空 → 无条件 DROP，后面的 CREATE TABLE 会用完整 schema 重建
      console.log(`[Migrate] 表 ${tableName} 为空，DROP 并重建以确保 schema 一致`);
      sqlite.prepare(`DROP TABLE IF EXISTS ${tableName}`).run();
    } catch (e) {
      console.warn(`[Migrate] rebuildEmptyTablesIfNeeded(${tableName}) skipped:`, e);
    }
  }
}

// 在同一事务内完成「DROP 空表 + 重建」，避免并发进程/构建 worker 看到中间态（no such table）
sqlite.exec('BEGIN IMMEDIATE;');
try {
rebuildEmptyTablesIfNeeded();

// 重建后重新执行 CREATE TABLE（只会创建被DROP的表）
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS short_dramas (
    id TEXT PRIMARY KEY NOT NULL,
    novel_id TEXT,
    script_id TEXT,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    genre TEXT,
    target_audience TEXT,
    total_episodes INTEGER DEFAULT 0 NOT NULL,
    current_episodes INTEGER DEFAULT 0 NOT NULL,
    episode_duration INTEGER DEFAULT 60,
    status TEXT DEFAULT 'draft',
    cover_image TEXT,
    tags TEXT,
    style TEXT,
    platform TEXT,
    character_style TEXT,
    scene_style TEXT,
    item_style TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS short_drama_episodes (
    id TEXT PRIMARY KEY NOT NULL,
    drama_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    episode_number INTEGER NOT NULL,
    title TEXT,
    synopsis TEXT,
    screenplay TEXT,
    screenplay_scenes TEXT,
    scenes TEXT,
    dialogues TEXT,
    directions TEXT,
    image_prompts TEXT,
    video_prompts TEXT,
    duration INTEGER,
    status TEXT DEFAULT 'draft',
    source_chapter INTEGER,
    source_script_chapter_index INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS drama_characters (
    id TEXT PRIMARY KEY NOT NULL,
    drama_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'supporting',
    description TEXT,
    personality TEXT,
    appearance TEXT,
    aliases TEXT,
    appearance_hair_color TEXT,
    appearance_hairstyle TEXT,
    appearance_eyes TEXT,
    appearance_upper TEXT,
    appearance_lower TEXT,
    voice_id TEXT,
    voice_provider TEXT,
    voice_config TEXT,
    image_url TEXT,
    image_prompt TEXT,
    reference_images TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS drama_scenes (
    id TEXT PRIMARY KEY NOT NULL,
    drama_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    atmosphere TEXT,
    image_url TEXT,
    image_prompt TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS drama_items (
    id TEXT PRIMARY KEY NOT NULL,
    drama_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    significance TEXT,
    image_url TEXT,
    image_prompt TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS drama_storyboards (
    id TEXT PRIMARY KEY NOT NULL,
    drama_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    shot_number INTEGER NOT NULL,
    shot_type TEXT DEFAULT 'storyboard',
    scene_description TEXT,
    camera_angle TEXT,
    camera_movement TEXT,
    dialogue TEXT,
    voiceover TEXT,
    sound_effects TEXT,
    character_ids TEXT,
    image_prompt TEXT,
    image_url TEXT,
    video_prompt TEXT,
    video_url TEXT,
    audio_url TEXT,
    tts_text TEXT,
    tts_voice_id TEXT,
    subtitle TEXT,
    duration INTEGER DEFAULT 3,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS drama_assets (
    id TEXT PRIMARY KEY NOT NULL,
    drama_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT,
    local_path TEXT,
    mime_type TEXT,
    file_size INTEGER,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    metadata TEXT,
    related_shot_id TEXT,
    related_episode_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE TABLE IF NOT EXISTS drama_tasks (
    id TEXT PRIMARY KEY NOT NULL,
    drama_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    target_id TEXT,
    provider TEXT,
    model TEXT,
    status TEXT DEFAULT 'pending' NOT NULL,
    progress INTEGER DEFAULT 0,
    input TEXT,
    output TEXT,
    error TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
`);
  sqlite.exec('COMMIT;');
} catch (e) {
  try { sqlite.exec('ROLLBACK;'); } catch { /* 忽略回滚失败 */ }
  console.error('[Migrate] 空表重建事务失败，已回滚（数据库保持原状）:', e);
}

// 迁移：短剧关联字段 + 所有可能缺失的列（兜底，处理有数据不能DROP的情况）
function migrateShortDramaColumns() {
  try {
    // short_dramas 表
    const dramaTables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='short_dramas'").all() as any[];
    if (dramaTables.length > 0) {
      const cols = sqlite.prepare("PRAGMA table_info(short_dramas)").all() as any[];
      const colNames = new Set(cols.map((c: any) => c.name));

      const dramaColsToAdd: [string, string][] = [
        ['novel_id', 'TEXT'],
        ['script_id', 'TEXT'],
        ['description', 'TEXT'],
        ['genre', 'TEXT'],
        ['target_audience', 'TEXT'],
        ['total_episodes', 'INTEGER DEFAULT 0'],
        ['current_episodes', 'INTEGER DEFAULT 0'],
        ['episode_duration', 'INTEGER DEFAULT 60'],
        ['status', "TEXT DEFAULT 'draft'"],
        ['cover_image', 'TEXT'],
        ['tags', 'TEXT'],
        ['style', 'TEXT'],
        ['platform', 'TEXT'],
        ['character_style', 'TEXT'],
        ['scene_style', 'TEXT'],
        ['item_style', 'TEXT'],
        ['updated_at', 'TEXT'],
      ];
      for (const [col, type] of dramaColsToAdd) {
        if (!colNames.has(col)) {
          sqlite.prepare(`ALTER TABLE short_dramas ADD COLUMN ${col} ${type}`).run();
          console.log(`[Migrate] Added short_dramas.${col} column`);
        }
      }
    }

    // short_drama_episodes 表
    const epTables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='short_drama_episodes'").all() as any[];
    if (epTables.length > 0) {
      const cols = sqlite.prepare("PRAGMA table_info(short_drama_episodes)").all() as any[];
      const colNames = new Set(cols.map((c: any) => c.name));

      const epColsToAdd: [string, string][] = [
        ['user_id', "TEXT DEFAULT ''"],
        ['title', 'TEXT'],
        ['synopsis', 'TEXT'],
        ['screenplay', 'TEXT'],
        ['screenplay_scenes', 'TEXT'],
        ['scenes', 'TEXT'],
        ['dialogues', 'TEXT'],
        ['directions', 'TEXT'],
        ['image_prompts', 'TEXT'],
        ['video_prompts', 'TEXT'],
        ['duration', 'INTEGER'],
        ['status', "TEXT DEFAULT 'draft'"],
        ['source_chapter', 'INTEGER'],
        ['source_script_chapter_index', 'INTEGER'],
        ['updated_at', 'TEXT'],
      ];
      for (const [col, type] of epColsToAdd) {
        if (!colNames.has(col)) {
          sqlite.prepare(`ALTER TABLE short_drama_episodes ADD COLUMN ${col} ${type}`).run();
          console.log(`[Migrate] Added short_drama_episodes.${col} column`);
        }
      }
    }

    // drama_characters 表
    const charTables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drama_characters'").all() as any[];
    if (charTables.length > 0) {
      const cols = sqlite.prepare("PRAGMA table_info(drama_characters)").all() as any[];
      const colNames = new Set(cols.map((c: any) => c.name));

      const charColsToAdd: [string, string][] = [
        ['gender', 'TEXT'],
        ['personality', 'TEXT'],
        ['appearance', 'TEXT'],
        ['aliases', 'TEXT'],
        ['appearance_hair_color', 'TEXT'],
        ['appearance_hairstyle', 'TEXT'],
        ['appearance_eyes', 'TEXT'],
        ['appearance_upper', 'TEXT'],
        ['appearance_lower', 'TEXT'],
        ['voice_id', 'TEXT'],
        ['voice_provider', 'TEXT'],
        ['voice_config', 'TEXT'],
        ['image_url', 'TEXT'],
        ['image_prompt', 'TEXT'],
        ['reference_images', 'TEXT'],
        ['image_gallery', 'TEXT'],
        ['sort_order', 'INTEGER DEFAULT 0'],
        ['updated_at', 'TEXT'],
      ];
      for (const [col, type] of charColsToAdd) {
        if (!colNames.has(col)) {
          sqlite.prepare(`ALTER TABLE drama_characters ADD COLUMN ${col} ${type}`).run();
          console.log(`[Migrate] Added drama_characters.${col} column`);
        }
      }
    }

    // drama_scenes 表
    const sceneTables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drama_scenes'").all() as any[];
    if (sceneTables.length > 0) {
      const cols = sqlite.prepare("PRAGMA table_info(drama_scenes)").all() as any[];
      const colNames = new Set(cols.map((c: any) => c.name));

      const sceneColsToAdd: [string, string][] = [
        ['image_gallery', 'TEXT'],
      ];
      for (const [col, type] of sceneColsToAdd) {
        if (!colNames.has(col)) {
          sqlite.prepare(`ALTER TABLE drama_scenes ADD COLUMN ${col} ${type}`).run();
          console.log(`[Migrate] Added drama_scenes.${col} column`);
        }
      }
    }

    // drama_items 表
    const itemTables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drama_items'").all() as any[];
    if (itemTables.length > 0) {
      const cols = sqlite.prepare("PRAGMA table_info(drama_items)").all() as any[];
      const colNames = new Set(cols.map((c: any) => c.name));

      const itemColsToAdd: [string, string][] = [
        ['image_gallery', 'TEXT'],
      ];
      for (const [col, type] of itemColsToAdd) {
        if (!colNames.has(col)) {
          sqlite.prepare(`ALTER TABLE drama_items ADD COLUMN ${col} ${type}`).run();
          console.log(`[Migrate] Added drama_items.${col} column`);
        }
      }
    }

    // novel_characters 表
    const novelCharTables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='novel_characters'").all() as any[];
    if (novelCharTables.length > 0) {
      const cols = sqlite.prepare("PRAGMA table_info(novel_characters)").all() as any[];
      const colNames = new Set(cols.map((c: any) => c.name));
      const novelCharColsToAdd: [string, string][] = [
        ['gender', 'TEXT'],
        ['aliases', 'TEXT'],
        ['appearance_hair_color', 'TEXT'],
        ['appearance_hairstyle', 'TEXT'],
        ['appearance_eyes', 'TEXT'],
        ['appearance_upper', 'TEXT'],
        ['appearance_lower', 'TEXT'],
      ];
      for (const [col, type] of novelCharColsToAdd) {
        if (!colNames.has(col)) {
          sqlite.prepare(`ALTER TABLE novel_characters ADD COLUMN ${col} ${type}`).run();
          console.log("[Migrate] Added novel_characters." + col + " column");
        }
      }
    }

    // drama_storyboards 表
    const shotTables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drama_storyboards'").all() as any[];
    if (shotTables.length > 0) {
      const cols = sqlite.prepare("PRAGMA table_info(drama_storyboards)").all() as any[];
      const colNames = new Set(cols.map((c: any) => c.name));

      const shotColsToAdd: [string, string][] = [
        ['camera_movement', 'TEXT'],
        ['voiceover', 'TEXT'],
        ['sound_effects', 'TEXT'],
        ['character_ids', 'TEXT'],
        ['image_prompt', 'TEXT'],
        ['image_url', 'TEXT'],
        ['video_prompt', 'TEXT'],
        ['video_url', 'TEXT'],
        ['video_download_url', 'TEXT'],
        ['video_gallery', 'TEXT'],
        ['audio_url', 'TEXT'],
        ['tts_text', 'TEXT'],
        ['tts_voice_id', 'TEXT'],
        ['subtitle', 'TEXT'],
        ['negative_prompt', 'TEXT'],
        ['duration', 'INTEGER DEFAULT 3'],
        ['status', 'TEXT DEFAULT "draft"'],
        ['updated_at', 'TEXT'],
      ];
      for (const [col, type] of shotColsToAdd) {
        if (!colNames.has(col)) {
          sqlite.prepare(`ALTER TABLE drama_storyboards ADD COLUMN ${col} ${type}`).run();
          console.log(`[Migrate] Added drama_storyboards.${col} column`);
        }
      }
    }
  } catch (e) {
    console.warn('[Migrate] short drama columns migration skipped:', e);
  }
}

  migrateShortDramaColumns();

  // 安全地添加 novels 表的新列
  try {
    const novelCols = sqlite.prepare("PRAGMA table_info(novels)").all().map((c: any) => c.name);
    if (!novelCols.includes('cover_image')) sqlite.exec("ALTER TABLE novels ADD COLUMN cover_image TEXT");
    if (!novelCols.includes('style_dna')) sqlite.exec("ALTER TABLE novels ADD COLUMN style_dna TEXT");
    if (!novelCols.includes('volume_id')) sqlite.exec("ALTER TABLE novels ADD COLUMN volume_id TEXT");
    if (!novelCols.includes('is_public')) sqlite.exec("ALTER TABLE novels ADD COLUMN is_public INTEGER DEFAULT 1");
  } catch (e) {
    console.warn('[Database] novels 表扩展列失败:', e);
  }

  // agent_sessions 增加 scope（创作工作区 / 剧本工作区各自独立对话记录）
  try {
    const sessCols = sqlite.prepare("PRAGMA table_info(agent_sessions)").all().map((c: any) => c.name);
    if (!sessCols.includes('scope')) sqlite.exec("ALTER TABLE agent_sessions ADD COLUMN scope TEXT DEFAULT 'studio'");
  } catch (e) {
    console.warn('[Database] agent_sessions 表扩展列失败:', e);
  }

  globalForSqlite.dbInitialized = true;
  console.log('[Database] Database schema initialization and migrations finished successfully.');
} else {
  console.log('[Database] Schema already initialized for this process. Skipping migrations.');
}
