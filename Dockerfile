# ---- 阶段1：构建前端 web/dist ----
FROM node:22-bookworm-slim AS webbuild
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- 阶段2：运行时（tsx 直跑 TS，无编译产物）----
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# 仅装生产依赖（sharp 原生二进制 + tsx 已在 dependencies）
COPY package*.json ./
RUN npm ci --omit=dev
# 应用源码 + 配置 + 模板 + 前端产物
COPY tsconfig.json ./
COPY src ./src
COPY config ./config
COPY templates ./templates
COPY --from=webbuild /app/web/dist ./web/dist
# data/ 不进镜像，运行时挂命名卷
EXPOSE 4100
CMD ["npx", "tsx", "src/server.ts"]
