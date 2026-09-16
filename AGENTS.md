# AI小说创作系统 - 开发规范

## 项目概览

基于AI的中篇小说创作系统，支持自动生成主题、结构分析和章节内容。用户注册登录后，每个会员都有自己独立的小说库。

## 角色说明

系统支持两种角色：
- **user（普通用户）**：使用小说生成、小说库、会员购买等功能
- **admin（管理员）**：管理所有会员信息、订单、会员等级

管理员账号：admin@example.com / Admin@123456

## 章节生成限制

用户生成章节时受会员等级对应的 `chapterLimit` 限制：

| 等级 | 代码 | 章节上限 |
|------|------|----------|
| 免费用户 | free | 11 章 |
| VIP会员 | vip | 999 章 |
| SVIP会员 | svip | 9999 章 |

**实现逻辑**（`src/app/api/novel/chapters/stream/route.ts`）：
1. 请求必须携带 `Authorization: Bearer {token}` 头
2. 根据用户 ID 查 `users.chapterLimit`（用户单独设置，优先级最高）
3. 若无单独设置，则查 `member_levels.chapterLimit`（根据会员等级）
4. 若均无，默认 11 章
5. 统计用户所有小说的 `currentChapters` 总和，超限返回 403 及剩余可生成章数

## 技术栈

- **框架**: Next.js 16 (App Router)
- **语言**: TypeScript 5
- **样式**: Tailwind CSS 4
- **数据库**: PostgreSQL (通过 coze-coding-dev-sdk)
- **ORM**: Drizzle ORM
- **认证**: JWT (jsonwebtoken)
- **密码加密**: bcryptjs
- **AI模型**: DeepSeek V3.2

## 项目结构

```
src/
├── app/
│   ├── api/
│   │   ├── auth/                    # 认证相关API
│   │   │   ├── register/route.ts   # 用户注册
│   │   │   ├── login/route.ts       # 用户登录
│   │   │   ├── refresh/route.ts     # 刷新Token
│   │   │   └── me/route.ts          # 获取当前用户信息
│   │   ├── member/                  # 会员相关API
│   │   │   ├── levels/route.ts      # 获取会员等级列表
│   │   │   ├── orders/route.ts      # 创建会员订单
│   │   │   ├── orders/[orderNo]/route.ts  # 订单详情/支付回调
│   │   │   └── status/route.ts      # 获取会员状态
│   │   ├── novels/                  # 小说库API
│   │   │   ├── route.ts             # 小说列表/创建
│   │   │   └── [id]/route.ts        # 小说详情/更新/删除
│   │   └── novel/                   # 小说生成相关API
│   │       ├── ideas/route.ts       # 生成主题创意
│   │       ├── trial-read/route.ts   # 生成试读段落
│   │       ├── structure/route.ts   # 生成结构分析
│   │       └── chapters/stream/route.ts  # 流式生成章节
│   ├── auth/login/page.tsx          # 登录页面
│   ├── admin/                       # 管理后台
│   │   └── members/page.tsx         # 会员管理页面
│   ├── member/page.tsx               # 会员中心页面
│   ├── my-novels/page.tsx           # 我的小说库页面
│   ├── novel-generator/page.tsx      # 小说生成页面
│   └── page.tsx                     # 首页
├── lib/
│   ├── auth.ts                      # JWT工具函数
│   └── api/
│       └── client.ts                # API客户端
├── storage/
│   └── database/
│       ├── shared/
│       │   └── schema.ts            # 数据库Schema定义
│       ├── index.ts                 # 导出所有Manager
│       ├── userManager.ts           # 用户管理
│       ├── memberLevelManager.ts     # 会员等级管理
│       ├── memberOrderManager.ts     # 会员订单管理
│       └── novelManager.ts           # 小说管理
│       └── modelPromptManager.ts     # 模型提示词管理
```

## 数据库Schema

### 用户表 (users)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | varchar(36) | 主键，UUID |
| username | varchar(50) | 用户名，唯一 |
| email | varchar(255) | 邮箱，唯一 |
| passwordHash | text | 密码哈希 |
| nickname | varchar(100) | 昵称 |
| avatar | varchar(500) | 头像URL |
| role | varchar(20) | 角色 (user/admin) |
| memberLevelId | varchar(36) | 会员等级ID |
| memberExpireAt | timestamp | 会员过期时间 |
| memberStatus | varchar(20) | 会员状态 (active/expired/inactive) |
| isActive | boolean | 账户是否激活 |
| createdAt | timestamp | 创建时间 |
| updatedAt | timestamp | 更新时间 |

### 会员等级表 (member_levels)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | varchar(36) | 主键，UUID |
| code | varchar(50) | 等级代码，唯一 |
| name | varchar(100) | 等级名称 |
| description | text | 等级描述 |
| price | integer | 价格（分） |
| duration | integer | 时长（天） |
| features | jsonb | 功能特性 |
| sortOrder | integer | 排序顺序 |
| isActive | boolean | 是否启用 |
| createdAt | timestamp | 创建时间 |

### 会员订单表 (member_orders)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | varchar(36) | 主键，UUID |
| userId | varchar(36) | 用户ID |
| memberLevelId | varchar(36) | 会员等级ID |
| orderNo | varchar(64) | 订单号，唯一 |
| amount | integer | 金额（分） |
| paymentMethod | varchar(50) | 支付方式 |
| paymentStatus | varchar(20) | 支付状态 |
| paymentTime | timestamp | 支付时间 |
| startTime | timestamp | 会员开始时间 |
| endTime | timestamp | 会员结束时间 |
| createdAt | timestamp | 创建时间 |

### 小说表 (novels)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | varchar(36) | 主键，UUID |
| userId | varchar(36) | 用户ID |
| title | varchar(255) | 小说标题 |
| description | text | 简介 |
| category | varchar(100) | 分类 |
| genderTarget | varchar(20) | 男频/女频 |
| tone | jsonb | 基调风格 |
| protagonist | text | 主角设定 |
| totalChapters | integer | 总章节数 |
| currentChapters | integer | 已生成章节数 |
| status | varchar(20) | 状态 |
| idea | jsonb | 主题创意 |
| structure | jsonb | 结构分析 |
| chapters | jsonb | 章节内容 |
| createdAt | timestamp | 创建时间 |
| updatedAt | timestamp | 更新时间 |

### 模型提示词表 (model_prompts)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | varchar(36) | 主键，UUID |
| code | varchar(50) | 模块代码，唯一（如 idea-system, chapter-stream-system） |
| name | varchar(200) | 模块名称 |
| description | text | 模块描述 |
| module | varchar(100) | 所属模块分类（如 novel, chapter, script） |
| systemPrompt | text | 系统提示词 |
| userPrompt | text | 用户提示词模板 |
| sortOrder | integer | 排序顺序 |
| isActive | boolean | 是否启用 |
| createdAt | timestamp | 创建时间 |
| updatedAt | timestamp | 更新时间 |

**提示词模块列表**：

| code | name | module | 说明 |
|------|------|--------|------|
| idea-options-system | 创意方向生成 | novel | 生成创意方向选项 |
| idea-system | 小说创意生成 | novel | 生成小说核心创意 |
| structure-system | 结构分析生成 | novel | 生成小说结构大纲 |
| trial-read-system | 试读段落生成 | novel | 生成开篇试读 |
| chapter-stream-system | 章节流式生成 | chapter | 流式生成章节内容 |
| chapter-title-system | 章节标题生成 | chapter | AI批量生成章节标题 |
| chapter-regenerate-system | 章节重生 | chapter | 重新生成单个章节 |
| script-generate-system | 剧本生成 | script | 生成剧本场景 |
| video-prompts-system | 视频提示词 | script | 生成分镜视频提示词 |
| image-prompts-system | 图片提示词 | script | 生成分镜图片提示词 |

## API接口

### 认证API

#### POST /api/auth/register - 用户注册
```json
请求:
{
  "username": "string",
  "email": "string",
  "password": "string"
}

响应:
{
  "success": true,
  "data": {
    "user": {...},
    "accessToken": "string",
    "refreshToken": "string"
  }
}
```

#### POST /api/auth/login - 用户登录
```json
请求:
{
  "email": "string",
  "password": "string"
}

响应:
{
  "success": true,
  "data": {
    "user": {...},
    "accessToken": "string",
    "refreshToken": "string"
  }
}
```

#### POST /api/auth/refresh - 刷新Token
```json
请求:
{
  "refreshToken": "string"
}

响应:
{
  "success": true,
  "data": {
    "accessToken": "string",
    "refreshToken": "string"
  }
}
```

#### GET /api/auth/me - 获取当前用户信息
需要 Authorization: Bearer {token} 头

### 会员API

#### GET /api/member/levels - 获取会员等级列表
```json
响应:
{
  "success": true,
  "data": [
    {
      "id": "string",
      "code": "free|vip|svip",
      "name": "免费用户|VIP会员|SVIP会员",
      "price": 0,
      "duration": 30,
      "features": [...]
    }
  ]
}
```

#### POST /api/member/orders - 创建会员订单
```json
请求:
{
  "memberLevelId": "string"
}

响应:
{
  "success": true,
  "data": {
    "orderNo": "string",
    "amount": 9900
  }
}
```

#### GET /api/member/status - 获取会员状态
需要登录，返回用户的会员状态信息

### 管理员API（需要 admin 角色）

#### GET /api/admin/members - 获取所有会员列表
需要 Authorization: Bearer {token} 头，且 role=admin
```json
响应:
{
  "success": true,
  "data": {
    "members": [...],
    "total": 10
  }
}
```

#### GET /api/admin/members/[id] - 获取会员详情
需要 Authorization: Bearer {token} 头，且 role=admin
返回会员的完整信息，包括订单历史和小说数量
```json
响应:
{
  "success": true,
  "data": {
    ...memberInfo,
    "orders": [...],
    "novelsCount": 5
  }
}
```

#### PUT /api/admin/members/[id] - 更新会员信息
需要 Authorization: Bearer {token} 头，且 role=admin
```json
请求:
{
  "nickname": "string",           // 昵称
  "isActive": true,              // 账户启用状态
  "memberLevelId": "string|null", // 会员等级ID（设置会员等级）
  "memberStatus": "active"       // 会员状态
}

响应:
{
  "success": true,
  "message": "会员信息更新成功",
  "data": {...updatedMember}
}
```

#### DELETE /api/admin/members/[id] - 删除会员
需要 Authorization: Bearer {token} 头，且 role=admin
注意：不能删除自己

### 小说库API

#### GET /api/novels - 获取用户的小说列表
需要登录，分页返回用户的小说

#### POST /api/novels - 创建小说
需要登录

#### GET /api/novels/[id] - 获取小说详情
需要登录，且小说必须属于当前用户

#### PUT /api/novels/[id] - 更新小说
需要登录

#### DELETE /api/novels/[id] - 删除小说
需要登录

## 前端页面

### 首页 (/)
- 展示系统介绍和功能入口
- 已登录用户显示"我的小说"和"会员中心"入口
- 未登录用户显示"登录/注册"入口

### 登录页面 (/auth/login)
- 用户登录表单
- 注册链接

### 会员中心 (/member)
- 展示会员等级和价格
- 开通会员功能

### 我的小说库 (/my-novels)
- 展示用户的所有小说
- 继续编辑功能

### 小说生成器 (/novel-generator)
- 配置小说参数
- 生成主题创意、结构分析、章节内容
- 保存到用户的小说库

### 管理后台 (/admin/members)
- 会员管理（仅 admin 可访问）
- Tab 导航：会员管理 / 订单管理 / 会员等级
- 支持搜索、筛选会员
- 会员详情弹窗：修改昵称、设置会员等级、禁用/启用账户
- 实时同步会员数据

### 管理后台 - 小说管理 (/admin/novels)
- 查看所有用户的小说列表（支持搜索标题）
- 查看小说详情（含完整章节内容）
- 编辑小说标题和简介
- 删除小说

### 管理后台 - 模型提示词管理 (/admin/model-prompts)
- 管理前台所有AI生成模块的提示词（仅 admin 可访问）
- 10个模块提示词：创意方向、小说创意、结构分析、试读段落、章节生成、章节标题、章节重生、剧本生成、视频提示词、图片提示词
- 支持按模块分组查看和编辑 systemPrompt / userPrompt
- 编辑后实时同步前台生成模块（内存缓存5分钟自动刷新）
- 支持重置为默认值（重新seed）
- API: GET/POST /api/admin/model-prompts, PUT/DELETE /api/admin/model-prompts/[id], POST /api/admin/model-prompts/seed

### 我的小说库 (/my-novels) - 管理员模式
- 管理员登录后，页面自动进入管理员模式，显示所有用户的小说
- 每张卡片显示作者信息（昵称/邮箱）
- 管理员可查看详情、编辑章节内容、编辑小说基本信息、删除小说
- 管理员操作使用 `/api/admin/novels/*` 接口

## 开发命令

```bash
# 安装依赖
pnpm install

# 开发环境
pnpm dev

# 构建生产版本
pnpm build

# 生产环境
pnpm start
```

## 数据库管理

```bash
# 同步远端数据库结构到本地
coze-coding-ai db generate-models

# 同步本地结构到远端数据库
coze-coding-ai db upgrade
```

## 环境变量

| 变量名 | 说明 |
|--------|------|
| PGDATABASE_URL | PostgreSQL连接URL |
| JWT_SECRET | JWT密钥 |
| DEPLOY_RUN_PORT | 服务端口（默认5000） |
