# CSJLM Studio - Docker 镜像
# 构建: docker build -t csjlm:latest .
# 运行: docker compose -f deploy/docker-compose.yml up -d --build

FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
# better-sqlite3 等原生依赖缺少预编译产物时兜底编译
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile=false

FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
RUN corepack enable && apk add --no-cache tini
ENV NODE_ENV=production
ENV DEPLOY_RUN_PORT=5000
# SQLite 与媒体数据目录（由 compose 挂载卷持久化）
ENV DB_PATH=/data/novel.db
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/next.config.ts ./next.config.ts

VOLUME ["/data", "/app/public/media"]
EXPOSE 5000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "mkdir -p /data /app/public/media && node_modules/.bin/next start -p $DEPLOY_RUN_PORT"]