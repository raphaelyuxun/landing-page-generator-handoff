# 研发交接 — Docker 运行手册

配套：[技术交接说明](技术交接说明.md)（架构/代码/流水线全貌）、[对接接口](external-api-spec.md)。

## 一句话

**单镜像自洽**：`docker compose up -d --build` 起一个容器，容器内**同时**跑 app 和内置 Xray（图片走内置代理翻墙到 Google/Nano Banana，AIGW/文本直连）。所有密钥/节点配置集中在**一个 `.env`**。图像默认 **Nano Banana(Google 原生) 优先，失败自动回退 AIGW**。

## 上手步骤

```bash
git clone <私有仓库> && cd landing-page-generator
cp .env.example .env          # 填真实值（见“必填项”）；真实 .env 由我方安全渠道单独给
docker compose up -d --build
scripts/load-data.sh es-data.tgz   # 迁移历史数据（我方导出的 es-data.tgz）→ 命名卷
# 打开 http://<host>:4100 登录，建 demo 任务验证
```

## `.env` 必填项（一个文件管全部）

| 组 | 变量 | 说明 |
|---|---|---|
| App | `APP_PASSWORD` `SESSION_SECRET` `PUBLIC_BASE_URL` | 登录密码 / cookie 密钥 / 产物图片对外 URL 前缀（你们的域名）|
| 对接 | `EXT_API_KEYS` | /api/ext 的 key |
| AIGW（文本 + 图像回退）| `AIGW_MODE=direct` `AIGW_BASE_URL` `AIGW_APP_KEY` | 内网机器直连 AIGW |
| 图像顺序 | `IMAGE_PROVIDER_ORDER=nanobanana,aigw` | 原生优先→回退 AIGW |
| Nano Banana | `NANO_BANANA_API_KEY` `NANO_BANANA_MODEL` | Google Gemini key（`?key=` 鉴权）；如 `gemini-2.5-flash-image` |
| Xray 节点 | `XRAY_SERVER/PORT/UUID/SNI/PBK/SID/TRANSPORT/FP/SPX` | VLESS+Reality；`docker-entrypoint.sh` 据此在容器内起 xray |

> `NANO_BANANA_PROXY` **不用填**：容器启动脚本自动设为 `http://127.0.0.1:${XRAY_HTTP_PORT}`，**只让图片调用走代理，AIGW/文本直连**。

## 网络拓扑（内网 direct 模式，单容器内）

```
容器
 ├─ app ──文本/图像回退──► AIGW（内网直连，不走代理）
 ├─ app ──Nano Banana 图片──► 127.0.0.1:10809(内置xray) ──Reality──► 翻墙 ──► Google Gemini
 └─ 内置 xray（docker-entrypoint.sh 起）        失败(连不上/无余额/报错/空图) → 自动回退 AIGW
```

- 部署机**能直连 Google** 时：`.env` 里不填 `XRAY_*` → 不起内置 xray、图片直连 Google，省掉代理。

## 已验证（我方在 seo 上实测，seo 封 Google，逼着走内置 xray）

- 镜像构建通过（多阶段：web 构建 + app 依赖含 sharp/tsx + 从官方镜像拷入 xray 二进制）。
- 容器启动：内置 xray 起 Reality 连接、自动接上 `NANO_BANANA_PROXY`、app 服务就绪。
- HTTP：`/`=200、`/api/health`=401、`/templates/`=302（模板站已并入、登录门生效）。
- **容器直连 Google 超时被墙 → 经内置 xray 成功出 Nano Banana 图（1.18MB PNG）**，完全自洽、未借任何外部代理/网关。

## 常用运维

| 操作 | 命令 |
|---|---|
| 起 / 停 | `docker compose up -d` / `docker compose down` |
| 看日志（app + xray 同容器）| `docker compose logs -f app` |
| 换代理节点 / 换 provider 顺序 | 改 `.env`（`XRAY_*` / `IMAGE_PROVIDER_ORDER`）→ `docker compose up -d --build`（或 `restart`）|
| 迁 / 重灌数据 | `scripts/load-data.sh es-data.tgz` |
| 数据备份 | `docker run --rm -v <proj>_es-data:/d -v $PWD:/b alpine tar czf /b/es-data.tgz -C /d .` |

## 注意

- **密钥只在 `.env`（gitignore + dockerignore），绝不进镜像/仓库。**
- **数据在命名卷 `es-data`**（挂 `/app/data`）；`docker compose down` 不删卷，`down -v` 才删（勿误用）。
- UI 改的旋钮（`config/knobs.config.json`）默认在镜像内、容器重建会还原；要持久化就把 `docker-compose.yml` 里 `./config:/app/config` 取消注释。
- 单容器内置 xray 也可直接 `svc_deploy` 到网关（单容器形态天然兼容）；此时**不要**开 `needs.proxy/needs.aigw`，让容器用自己的 xray + key。
