# ---- 取 Xray 二进制（官方镜像是 distroless，仅用来拷贝二进制）----
FROM ghcr.io/xtls/xray-core:latest AS xraybin

# ---- 阶段1：构建前端 web/dist ----
FROM node:22-bookworm-slim AS webbuild
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- 阶段2：运行时（app + 内置 xray，单容器自洽）----
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# 生产依赖（sharp 原生 + tsx 已在 dependencies）
COPY package*.json ./
RUN npm ci --omit=dev
# 应用源码 + 配置 + 模板 + 前端产物
COPY tsconfig.json ./
COPY src ./src
COPY config ./config
COPY templates ./templates
COPY --from=webbuild /app/web/dist ./web/dist
# 内置 Xray 二进制 + 启动脚本（node:22-slim 自带 /bin/sh）
COPY --from=xraybin /usr/local/bin/xray /usr/local/bin/xray
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
# data/ 不进镜像，运行时挂命名卷
EXPOSE 4100
ENTRYPOINT ["/docker-entrypoint.sh"]
