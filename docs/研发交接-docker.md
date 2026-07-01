# 研发交接 — Docker 运行手册

配套：[技术交接说明](技术交接说明.md)（架构/代码/流水线全貌）、[对接接口](external-api-spec.md)。

## 一句话

`docker compose up -d --build` 起两个容器：**app**（Node 应用）+ **xray**（翻墙代理）。所有密钥/节点配置集中在**一个 `.env`**。图像默认走 **Nano Banana(Google 原生)**，失败自动回退 **AIGW**。

## 上手步骤

```bash
git clone <私有仓库>
cd landing-page-generator
cp .env.example .env          # 填真实值（见下“必填项”），真实 .env 由我方安全渠道单独给
# 迁移历史数据（我方导出的 es-data.tgz）
scripts/load-data.sh es-data.tgz
# 起服务
docker compose up -d --build
# 打开 http://<host>:4100 登录，建一个 demo 任务验证生成链路
```

## `.env` 必填项（一个文件管全部）

| 组 | 变量 | 说明 |
|---|---|---|
| App | `APP_PASSWORD` `SESSION_SECRET` `PUBLIC_BASE_URL` | 登录密码 / cookie 密钥 / 产物图片对外 URL 前缀（填你们的域名）|
| 对接 | `EXT_API_KEYS` | /api/ext 的 key（可沿用或轮换）|
| AIGW（文本 + 图像回退）| `AIGW_MODE=direct` `AIGW_BASE_URL` `AIGW_APP_KEY` | 内网机器直连 AIGW；AppKey 形如 `<AppID>.<AppKey>` |
| 图像 provider | `IMAGE_PROVIDER_ORDER=nanobanana,aigw` | 原生优先→回退 AIGW |
| Nano Banana | `NANO_BANANA_API_KEY` `NANO_BANANA_MODEL` | Google Gemini key（`?key=` 鉴权）；模型如 `gemini-2.5-flash-image` |
| Xray 节点 | `XRAY_SERVER/PORT/UUID/SNI/PBK/SID/TRANSPORT/FP/SPX` | VLESS+Reality 节点参数，xray sidecar 据此渲染配置 |

> `NANO_BANANA_PROXY` 不用在 .env 写：`docker-compose.yml` 已自动注入为 `http://xray:10809`，**只让图片调用走代理，AIGW/文本直连**。

## 网络拓扑（内网 direct 模式）

```
app ──文本/图像回退──► AIGW（内网直连，不走代理）
app ──Nano Banana 图片──► xray:10809 ──VLESS/Reality──► 翻墙 ──► Google Gemini
       失败(连不上/无余额/报错/空图) → 自动回退 AIGW 出图
```

- 若部署机**能直连 Google**：`.env` 里 `NANO_BANANA_PROXY=` 留空、并可把 xray 服务停掉（`docker compose up app`），省掉代理。

## 常用运维

| 操作 | 命令 |
|---|---|
| 起 / 停 | `docker compose up -d` / `docker compose down` |
| 看日志 | `docker compose logs -f app` / `docker compose logs -f xray` |
| 换代理节点 | 改 `.env` 的 `XRAY_*` → `docker compose restart xray` |
| 切图像 provider | 改 `IMAGE_PROVIDER_ORDER`（如只用 AIGW：`aigw`）→ `docker compose restart app` |
| 迁 / 重灌数据 | `scripts/load-data.sh es-data.tgz` |
| 数据备份 | `docker run --rm -v <proj>_es-data:/d -v $PWD:/b alpine tar czf /b/es-data.tgz -C /d .` |

## 注意

- **密钥只在 `.env`（gitignore + dockerignore），绝不进镜像/仓库。**
- **数据持久化在命名卷 `es-data`**（挂到 `/app/data`）；`docker compose down` 不删卷，`down -v` 才删（勿误用）。
- UI 里改的旋钮（`config/knobs.config.json`）默认在镜像内、容器重建会还原；要持久化就把 `docker-compose.yml` 里 `./config:/app/config` 那行取消注释。
- 迁来的旧任务里图片 URL 是绝对旧域名；换域名后旧任务图片仍指旧域名（重新交付会刷新）。
