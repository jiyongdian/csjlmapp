# 创世纪联盟智能写作 / CSJLM Studio

一款**开箱即用的中文 AI 小说创作 与 短剧 / AI 视频生产全链路系统**。从「小说构思 → 章节生成 → 剧本 → 角色/场景/物品 → 分镜提示词 → 图片/视频生成 → 配音 → 合拼 → 导出发布」一站式完成。

> 基于 Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4 + SQLite/PostgreSQL + Drizzle ORM + pnpm。

---

## ✨ 功能总览

| 模块 | 能力 |
| ---- | ---- |
| **用户系统** | 注册 / 登录（JWT）、会员等级（免费 / VIP / SVIP）、章节额度、邀请码、个人资料 |
| **AI 小说创作** | 三种模式（标准流程 / 一键开书 / 短篇写作）；主题创意、结构分析、章节 SSE 流式生成、断点续写、单章重生成、整章替换 |
| **质量体系** | 章节质检（连贯性 / 硬伤 / 承接链自动修复）、真人味评分、全文/批量去 AI 味、章节标题在线编辑 |
| **书籍管理** | 书架、阅读器、多卷管理、章节钩子、故事记忆、下载 TXT / ZIP、复制 / 更新保存 |
| **剧本工坊** | 小说转剧本（章节级）、剧本场景 / 对白 / 提示词管理、剧本预检、AI 优化 |
| **短剧制作** | 数据源（小说 / 剧本）一键打通、分集管理、剧本原文同步、从小说批量提取角色 / 场景 / 物品 |
| **资产库** | 角色 / 场景 / 物品管理：AI 出图、风格设置、音色配置（TTS）、批量操作 |
| **图片分镜** | 分镜提示词（模板 / 自定义）、批量生图、一键全部生成、风格提示词库（管理员公共 / 会员私有 + 自定义分类） |
| **视频分镜** | 视频提示词（H3 结构化）、**按模版生成分镜**（章节拆段 → AI → 预览 → 应用）、多模式生成（文生视 / 图生视 / 多参视 / 合并视 / ComfyUI）、提交提示词与图片记录实时展示、生成版本画廊 |
| **视频生成** | 多平台适配：可灵、火山（Volcengine）、MiniMax H3、Seedance、Vidu、Runway、Luma、Veo、Grok、自建代理等；并发、暂停 / 取消、任务轮询 |
| **配音工作台** | TTS 多音色、试听、分镜配音 |
| **ComfyUI** | ComfyUI 工作流接入、视频 / 图片生成 |
| **后期输出** | 视频合拼、字幕 / 配音合成、剪映一键草稿导出 |
| **提取模板系统** | 角色 / 场景 / 物品 / 分镜生成四种模版，三层作用域（系统默认 / 我的通用 / 仅本作品），AI 辅助优化、导入导出 |
| **智能助手** | Agent 对话面板、技能系统（Skills）、故事记忆 |
| **社区 / 创作中心** | 帖子、话题、创作灵感中心 |
| **管理后台** | 用户 / 会员管理、小说管理、提示词管理、AI 模型配置（文字 / 图片 / 视频 / TTS / ComfyUI）、系统设置（媒体存储路径等）、导航配置、数据看板 |

---

## 🧱 技术栈

- **框架**：Next.js 16 (App Router) + React 19 + TypeScript
- **样式**：Tailwind CSS 4
- **数据库**：SQLite（`better-sqlite3`，零配置默认） / PostgreSQL（可选，`pg`）
- **ORM**：Drizzle ORM + drizzle-zod + Zod 4
- **认证**：JWT (`jsonwebtoken`) + bcryptjs
- **包管理**：pnpm
- **AI 接口**：OpenAI 兼容协议（DeepSeek / 通义 / 自建网关等），或界面内置多厂商适配器

---

## 📦 环境要求

| 依赖 | 版本 | 说明 |
| ---- | ---- | ---- |
| Node.js | >= 20 | 运行时 |
| pnpm | >= 10 | 包管理（也可用 npm，建议 pnpm） |
| 数据库 | SQLite（默认，免安装）或 PostgreSQL 14+ | 首次启动自动建表迁移 |
| 端口 | 5000（可改） | 默认监听 |

> 生成小说 / 图片 / 视频需要**可用的 AI 接口**（在系统设置页配置模型即可，未配置也能体验登录与界面流程）。

---

## 🚀 本地一键安装（Windows / macOS / Linux）

在项目根目录执行对应脚本，脚本会自动完成：校验 Node/pnpm → 安装依赖 → 生成 `.env.local` → 构建 → 启动。

**Windows（双击或命令行）：**

```bat
install-local.bat
```

**macOS / Linux（命令行）：**

```bash
chmod +x install-local.sh
./install-local.sh
```

启动后访问 <http://localhost:5000>。

### 手动安装（不依赖脚本）

```bash
# 1. 克隆
git clone <你的仓库地址> csjlm
cd csjlm

# 2. 依赖
pnpm install

# 3. 环境变量（首次必须）
cp .env.example .env.local

# 4. 开发模式（热更新，面向开发）
pnpm dev
# 或生产模式（面向使用）
pnpm build && pnpm start:prod
```

### 首次初始化（重要）

1. **注册 / 管理员**：打开 `/register` 注册第一个账号；随后生产一个管理员：

   ```bash
   pnpm dlx tsx scripts/init-admin.ts
   # 默认账号 admin@example.com / Admin@123456（请立即在「个人设置」修改密码）
   ```

2. **播种系统默认模板与提示词**（角色 / 场景 / 物品 / 分镜生成模板、模型提示词等）。用管理员账号登录后打开一次：

   ```text
   POST http://localhost:5000/api/admin/init-db
   ```
   或在浏览器登入管理后台，执行「初始化数据库」入口（若提供）。

3. **配置 AI 模型**：登录后进入「AI 设置 / AI 模型」，添加文字模型（小说）、图片模型（出图）、视频模型、TTS 模型，可选手动 API Key（DeepSeek / 通义 / 创世纪网关等 OpenAI 兼容端点）。

---

## ☁️ 服务器一键部署（Linux）

提供两种方式：**裸机 Bash 脚本（pm2 守护）** 或 **Docker Compose**。

### 方式 A：裸机一键脚本（推荐，简单直观）

```bash
# 在服务器（Ubuntu/Debian/CentOS 均可）执行：
curl -fsSL -o install-server.sh https://<你的仓库raw地址>/deploy/install-server.sh
chmod +x install-server.sh
./install-server.sh
```

脚本将自动：安装 Node 20 与 pnpm → 克隆仓库 → 安装依赖 → 配置 `.env.local`（或复制已有配置）→ 构建 → 用 **pm2** 守护启动（端口 5000）→ 输出访问地址与常用命令。

常用运维命令：

```bash
pm2 status            # 查看进程
pm2 logs csjlm        # 查看日志
pm2 restart csjlm     # 重启
pm2 save && pm2 startup  # 开机自启
```

### 方式 B：Docker Compose（隔离环境，可选）

```bash
cp .env.example .env.local   # 先填 JWT_SECRET
docker compose -f deploy/docker-compose.yml up -d --build
```

- 使用仓库根目录的 `Dockerfile` 构建（compose 的 `build.context` 自动指向仓库根），亦可直接 `docker build -t csjlm:latest .`。
- 容器默认端口 `5000:5000`，数据（SQLite 位于 `/data/novel.db`、媒体位于 `public/media`）通过命名卷持久化，可备份或挂载。
- 修改 `.env.local` 后 `docker compose up -d` 重建。

### 反向代理（Nginx 示例）

```nginx
server {
  listen 80;
  server_name your.domain.com;   # 换成你的域名

  client_max_body_size 100m;

  location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";   # SSE / WebSocket 支持
    proxy_read_timeout 600s;
  }
}
```

---

## ⚙️ 配置文件说明

复制 `.env.example` → `.env.local` 并编辑：

| 变量 | 必需 | 说明 |
| ---- | ---- | ---- |
| `JWT_SECRET` | ✅ | JWT 签名密钥，**生产环境务必换成强随机串** |
| `DEPLOY_RUN_PORT` | | 服务端口，默认 `5000` |
| `DB_PATH` | | SQLite 数据库文件路径，默认项目内 `novel.db`；Docker 部署时设为 `/data/novel.db`（自动挂载卷持久化） |
| `NODE_ENV` | | `development` / `production` |
| `DB_TYPE` | | `sqlite`（默认）或 `postgresql` |
| `PGDATABASE_URL` | 当 DB_TYPE=postgresql | PostgreSQL 连接串 |
| `OPENAI_API_KEY`/`OPENAI_BASE_URL` | | 文字模型兜底（在「AI 设置」页配置后以页面为准） |
| `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL` | | DeepSeek 兜底（可选） |

> AI 密钥优先在**页面内「AI 设置」** 配置（支持多模型、多厂商、用户级 / 系统级），`.env` 仅为兜底。

---

## 🗂️ 目录结构

```
src/
├─ app/                 # Next.js App Router：页面与 API 路由
│  ├─ (auth)/ login/ register/      # 认证
│  ├─ dashboard/ workspace/ studio/ # 工作台
│  ├─ novel-generator/              # AI 小说创作（含完成页/质检/去AI味）
│  ├─ my-novels/ books/[id]/        # 书架与阅读器
│  ├─ short-dramas/                 # 短剧列表与制作工作台（角色/场景/物品/分镜/视频/配音/合拼/导出）
│  ├─ script/ scripts/              # 剧本工坊
│  ├─ community/ creative-hub/      # 社区与创作中心
│  ├─ admin/ ai-settings/ settings/ # 管理与配置
│  └─ api/                          # 全部后端接口（novels/short-dramas/agent/ai/...）
├─ components/          # 通用组件（风格设置/封面/预览弹窗等）
├─ lib/                 # 核心逻辑（模板引擎、章节拆分、AI 调用、角色/场景/物品解析）
├─ storage/database/    # Drizzle schema、SQLite 迁移、种子脚本、各业务 Manager
public/media/           # 生成的图片/视频/音频（运行时数据）
scripts/                # 运维与初始化脚本、管理员初始化
Dockerfile / .dockerignore # Docker 镜像构建（默认从仓库根读取）
install-local.bat / install-local.sh / start-prod.bat  # 本地一键安装与启动脚本
deploy/                 # docker-compose（引用仓库根 Dockerfile）、服务器一键部署脚本、nginx 示例
```

---

## ❓ 常见问题

- **首次打开是空白 / 未建库？** 确认已配置 `.env.local`（至少 `JWT_SECRET`），服务首次启动会自动建表迁移。
- **生图/生文报「未返回图片/内容」？** 多为 AI 模型配置的 `API 地址` 少了 `/v1` 或 Key 无效，到「AI 设置」检查对应模型的 apiUrl 与 Key。
- **视频生成很慢 / 超时？** 视频任务为后台轮询（最长 20 分钟），可调高上游超时或在页面调并发数。
- **端口被占用？** 修改 `.env.local` 的 `DEPLOY_RUN_PORT` 后重启。
- **升级后出问题？** 升级前备份 `novel.db`（或 PostgreSQL）与 `public/media`；`pnpm install && pnpm build` 后重启。

---

## 🔒 安全提醒

- 生产环境务必修改 `JWT_SECRET`。
- `novel.db`、`public/media`、`.env.*` 已在 `.gitignore` 中，请勿提交到仓库。
- 默认管理员 `admin@example.com` 登录后请立即修改密码；建议限制 `/api/admin/*` 仅内网或加访控。

---

## 🧩 贡献与反馈

欢迎 Issue / PR。标签建议：`bug` `feature` `docs` `deploy`。