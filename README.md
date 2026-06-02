# Landing Page Generator（落地页素材生产工作台）

给一个产品（公司名、品类、描述、产品图），自动生成一套 B2B 谷歌广告落地页素材——**banner 大图 + 营销文案 + 多张产品图**；运营在工作台检查/微调后「标记完成」，即可对外交付（两份 JSON + 公网可访问的图片 URL）或导出 zip。

- 后端：Node + TypeScript（Express，`tsx` 直跑，无需编译）
- 前端：React + Vite + Tailwind（构建为静态包，由后端托管）
- 存储：纯文件系统（`data/`），**无数据库**
- 文案/图片：调用 **NetEase AIGW**（文案 `claude-opus-4-6`，图片 `gemini-3-pro-image`）

> 面向使用者的图文操作手册见 `docs/用户使用手册.md`；外部系统对接见 `docs/external-api-spec.md`。

---

## 架构

```
浏览器 ──► 本服务 (Express, :4100)
              │  · /api/*        管理接口（建任务、生成、改稿、标记完成、归档…）
              │  · /api/ext/*    外部对接接口（X-API-Key）
              │  · /public/...   公网可访问的图片资源
              │  · web/dist      前端静态包
              │
              └─► AIGW（文案 + 图片）── 两种接入模式，见下 ──► aigw.nie.netease.com
数据：data/projects/*.json（任务记录） + data/assets/<code>/（输入原图 + 生成图）
```

## AIGW 接入：两种模式（`AIGW_MODE`）

应用所有 AIGW 调用都收口在 `src/aigw/client.ts`。两种模式**请求体与返回完全一致**，只差「目标地址 + 鉴权头 + 谁持有 AppKey」：

| | `AIGW_MODE=relay`（默认） | `AIGW_MODE=direct` |
|---|---|---|
| 适用 | **阿里云 / 外网机器**，无法直连 AIGW | **集团内网机器**，可直连 AIGW |
| 目标 | `AIGW_RELAY_URL`（本机端口，反向 SSH 隧道到 Mac Mini relay） | `AIGW_BASE_URL`（`https://aigw.nie.netease.com/v1`） |
| 鉴权 | `X-Relay-Token: <AIGW_RELAY_TOKEN>` | `Authorization: Bearer <AIGW_APP_KEY>` |
| 谁持有 AppKey | Mac Mini relay（应用不碰密钥） | 应用自身（`AIGW_APP_KEY` 放本机 `.env`） |
| 健康检查 | 探 relay 的 `/healthz` | 配了 `AIGW_APP_KEY` 即视为就绪 |

**为什么有 relay 模式**：现网部署在阿里云 seo（公网），其网络访问不到 AIGW 内网端点；而公司内网的 Mac Mini 能直连 AIGW，于是 Mac Mini 上跑一个轻量 relay，seo 通过一条持久反向 SSH 隧道（`seo:4500 → Mac Mini`）把请求转发过去，relay 注入 AppKey。

**迁移到集团内网时**：把目标机器 `.env` 改成 `AIGW_MODE=direct` + `AIGW_APP_KEY=<AppID.AppKey>` 即可，**不再需要 Mac Mini relay 和反向隧道**，拓扑更简洁。代码无需改动。

---

## 环境变量

复制 `.env.example` 为 `.env` 并填写。**真实密钥不入库**（`.env` 已在 `.gitignore`）。

| 变量 | 说明 |
|---|---|
| `PORT` | HTTP 端口（默认 4100） |
| `APP_PASSWORD` | 工作台登录密码（轻量固定密码，无用户系统） |
| `SESSION_SECRET` | 会话 cookie 签名密钥（任意长随机串） |
| `AIGW_MODE` | `relay`（默认）或 `direct`，见上 |
| `AIGW_RELAY_URL` | relay 模式：本机 relay 地址（默认 `http://127.0.0.1:4500`） |
| `AIGW_RELAY_TOKEN` | relay 模式：relay 鉴权 token |
| `AIGW_BASE_URL` | direct 模式：AIGW 基址（默认 `https://aigw.nie.netease.com/v1`） |
| `AIGW_APP_KEY` | direct 模式：`<AppID>.<AppKey>` 形式的 Bearer 值 |
| `TEXT_MODEL` / `IMAGE_MODEL` | 模型代号（默认 `claude-opus-4-6` / `gemini-3-pro-image`） |
| `DATA_DIR` | 数据目录（默认 `./data`；多实例用不同目录隔离） |
| `PUBLIC_BASE_URL` | 导出 JSON 内图片绝对 URL 的域名前缀 |
| `EXT_API_KEYS` | 外部对接接口接受的 API Key，逗号分隔 |
| `EXT_IP_ALLOWLIST` | 可选 IP 白名单，逗号分隔；空 = 不校验 |
| `SITE_WHATSAPP` / `SITE_EMAIL` | 写入每个落地页的固定联系方式 |

---

## 本地运行

```bash
# 1) 安装依赖
npm install
cd web && npm install && cd ..

# 2) 配置
cp .env.example .env   # 填好 AIGW_MODE 及对应模式的变量、APP_PASSWORD 等

# 3) 构建前端静态包
npm run build:web

# 4) 启动后端（同时托管前端 + API）
npm start              # http://localhost:4100
# 开发热重载：npm run dev（后端）；前端另开 cd web && npm run dev
```

> 本地若用 relay 模式，需要能访问到 relay（通常只有部署机能访问）；本地联调更适合 direct 模式 + 配好 `AIGW_APP_KEY`。

---

## 部署（现网：阿里云 seo）

- 通过 **systemd** 跑两个实例：线上 `easesourcer` 与测试 `easesourcer-test`（各自 `EnvironmentFile` 指向 `.env` / `.env.test`，`DATA_DIR` 隔离，端口 4100 / 4101）。
- 入口经 **Cloudflare 隧道**（cloudflared）暴露到公网域名。
- 前端静态包 `web/dist` 由两个实例共享；更新前端：本地 `npm run build:web` 后把 `web/dist` 同步到部署机。
- AIGW 走 **relay 模式**：Mac Mini 上的 LaunchDaemon 维持反向 SSH 隧道 + relay 进程。

### 迁移到集团内网（要点）
1. 新机器装 Node，拉取本仓库，`npm install` + `npm run build:web`。
2. `.env` 设 `AIGW_MODE=direct` + `AIGW_APP_KEY`（**去掉 relay/隧道依赖**）。
3. 数据是纯文件：把旧机器 `data/` 整目录拷到新机器的 `DATA_DIR` 即可（无损）。
4. 落地页 JSON 里的图片是**绝对 URL**（指向 `PUBLIC_BASE_URL`）：迁移时**保持同一公网域名并重指向新机器**最省事（存量 URL 零改写）；若必须换域名，跑一次 URL 改写脚本。
5. 用 systemd 或容器化（应用简单，Dockerfile 约十余行；注意 `data/` 必须挂卷、不入镜像）。

---

## 外部系统对接

三个接口（`/api/ext/*`，`X-API-Key` 鉴权）：创建落地页、批量查状态、交付（任务「标记完成」后返回两份 JSON）。完整字段与示例见 **`docs/external-api-spec.md`**。

---

## 数据与备份

- 全部状态在 `data/`：`projects/*.json`（任务） + `assets/<code>/`（输入原图 + 生成图）。**含客户数据，不入库**（`.gitignore` 已排除 `data/`、`data-test/`）。
- 目前无自动备份；因体量很小（数十 MB），建议加一个每日 `tar`/`rsync` 备份。

---

## 目录结构

```
src/            后端
  server.ts       Express 入口 + 全部接口 + 任务编排
  config.ts       配置（含 AIGW 模式开关）
  aigw/client.ts  AIGW 客户端（relay / direct 两模式收口处）
  pipeline/       生成管线：profiler 画像 / segment 产品识别 / copy 文案 / image 配图 / revise 改稿
  store/          文件系统任务存储
  types.ts        类型定义
web/            前端（React + Vite）
config/         品类锚点 / 旋钮配置
relay/          Mac Mini 上的 Python relay 源码（relay.config.json 含密钥，不入库）
docs/           用户手册、对接接口文档
scripts/        一次性回溯/维护脚本
```

## 安全

- 真实密钥（AIGW AppKey、relay token、对接 API Key、登录密码）**只放各机器的 `.env`**（已 gitignore）；源码与 `.env.example` 只含占位。
- direct 模式下应用持有 AppKey，仅应部署在可信的内网机器。
- `/api/ext/*` 用 `X-API-Key` 鉴权，可选 IP 白名单。
