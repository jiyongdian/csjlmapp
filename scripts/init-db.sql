-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nickname VARCHAR(100),
    avatar VARCHAR(500),
    member_level_id VARCHAR(36),
    member_expire_at TIMESTAMPTZ,
    member_status VARCHAR(20) DEFAULT 'inactive',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    chapter_limit INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE INDEX IF NOT EXISTS users_username_idx ON users(username);

-- 会员等级表
CREATE TABLE IF NOT EXISTS member_levels (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price INTEGER NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 30,
    features JSONB,
    chapter_limit INTEGER NOT NULL DEFAULT 10,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS member_levels_code_idx ON member_levels(code);
CREATE INDEX IF NOT EXISTS member_levels_sort_idx ON member_levels(sort_order);

-- 会员订单表
CREATE TABLE IF NOT EXISTS member_orders (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(36) NOT NULL,
    member_level_id VARCHAR(36) NOT NULL,
    order_no VARCHAR(64) NOT NULL UNIQUE,
    amount INTEGER NOT NULL DEFAULT 0,
    payment_method VARCHAR(50),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    payment_time TIMESTAMPTZ,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS member_orders_user_idx ON member_orders(user_id);
CREATE INDEX IF NOT EXISTS member_orders_order_no_idx ON member_orders(order_no);

-- 小说表
CREATE TABLE IF NOT EXISTS novels (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(36) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    gender_target VARCHAR(20),
    tone JSONB,
    protagonist TEXT,
    total_chapters INTEGER NOT NULL DEFAULT 0,
    current_chapters INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) DEFAULT 'draft',
    idea JSONB,
    structure JSONB,
    chapters JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS novels_user_id_idx ON novels(user_id);
CREATE INDEX IF NOT EXISTS novels_category_idx ON novels(category);
CREATE INDEX IF NOT EXISTS novels_created_at_idx ON novels(created_at);
CREATE INDEX IF NOT EXISTS novels_status_idx ON novels(status);

-- AI配置表
CREATE TABLE IF NOT EXISTS ai_configs (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(36),
    name VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    api_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model VARCHAR(100) NOT NULL,
    temperature INTEGER NOT NULL DEFAULT 85,
    max_tokens INTEGER DEFAULT 8192,
    scope VARCHAR(20) NOT NULL DEFAULT 'user',
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_configs_user_id_idx ON ai_configs(user_id);
CREATE INDEX IF NOT EXISTS ai_configs_provider_idx ON ai_configs(provider);
CREATE INDEX IF NOT EXISTS ai_configs_scope_idx ON ai_configs(scope);

-- 邀请码表
CREATE TABLE IF NOT EXISTS invite_codes (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    description TEXT,
    level_type VARCHAR(20),
    member_level_id VARCHAR(36),
    max_uses INTEGER NOT NULL DEFAULT 1,
    current_uses INTEGER NOT NULL DEFAULT 0,
    is_used_up BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMPTZ,
    created_by VARCHAR(36),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS invite_codes_code_idx ON invite_codes(code);
CREATE INDEX IF NOT EXISTS invite_codes_status_idx ON invite_codes(is_active);
CREATE INDEX IF NOT EXISTS invite_codes_level_type_idx ON invite_codes(level_type);

-- 插入默认会员等级
INSERT INTO member_levels (code, name, description, price, duration, features, chapter_limit, sort_order, is_active) VALUES
('free', '免费用户', '免费用户，可生成11章', 0, 365, '["基础小说生成","11章内容限制","本地保存"]', 11, 0, TRUE),
('vip', 'VIP会员', 'VIP会员，可生成999章', 9900, 30, '["无限小说生成","999章内容限制","云端保存","优先客服支持"]', 999, 1, TRUE),
('svip', 'SVIP会员', 'SVIP会员，可生成9999章', 29900, 30, '["无限小说生成","9999章内容限制","云端保存","专属客服","高级AI模型"]', 9999, 2, TRUE)
ON CONFLICT (code) DO NOTHING;
