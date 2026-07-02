# 落地页生成系统 — AGENT 执行手册（可直接照做）

> 读者：负责部署/运维本项目的 AI Agent 或工程师。本手册自包含、命令可直接执行。
> 目标：在一台**公司内网、装了 Docker** 的机器上，把本系统部署起来、迁入历史数据、验证通过。
> 术语/架构不清楚时看 [技术交接说明](技术交接说明.md)；对接接口看 [external-api-spec](external-api-spec.md)。

---

## 0. 成功判据（做完应满足）

- `docker compose ps` 中 app 容器 `healthy`。
- `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4100/` 返回 `200`。
- 用 `APP_PASSWORD` 能登录 Web；`/templates/` 能看到模板预览（需登录）。
- 新建一个任务能跑完（文本走 AIGW、图片走 Nano Banana），产物有 Banner + 产品图。
- 迁入的历史任务在列表全量可见、图片正常显示。

---

## 1. 前置检查（先跑这些，全绿再往下）

```bash
docker version            # 需要 Docker（compose v2）
docker compose version
# 部署机必须在公司内网、能直连 AIGW（文本链路）：
curl -s -o /dev/null -w 'AIGW %{http_code}\n' https://aigw.nie.netease.com/v1   # 期望非 000（能连到，403/401 都算通）
# 必须能拉官方 Xray 镜像（构建时用；ghcr 在被墙网络通常可直连）：
docker pull ghcr.io/xtls/xray-core:latest   # 期望成功
# 必须能连翻墙节点（图片链路，占位见下）：
curl -s -o /dev/null -w 'node %{http_code}\n' https://<XRAY_SERVER>/   # 期望非 000
```

- AIGW 返回 `000`（超时）= 部署机不在内网 / 未授权 → 文本链路不可用，必须换机器或加白名单。
- `docker pull ghcr...` 失败 = 构建机没有 ghcr 访问 → 换网络或让有网络的机器 build 后导出镜像。

---

## 2. 取代码

```bash
git clone https://github.com/raphaelyuxun/landing-page-generator.git
cd landing-page-generator
```

---

## 3. 配置 `.env`（一个文件管全部）

```bash
cp .env.example .env
```
按下表填。**真实密钥由交付方通过安全渠道给你，不在仓库里。** 填完自检：`grep -c '=' .env`。

| 变量 | 必填 | 值/来源 |
|---|---|---|
| `APP_PASSWORD` | ✅ | 自定，Web 登录密码 |
| `SESSION_SECRET` | ✅ | 自定长随机串（`openssl rand -hex 32`）|
| `PUBLIC_BASE_URL` | ✅ | 你们的对外域名，如 `https://lp.yourcorp.com`（产物图片 URL 前缀）|
| `EXT_API_KEYS` | ✅ | 对接方调用 `/api/ext` 的 key（逗号分隔，自定或沿用交付方给的）|
| `AIGW_MODE` | ✅ | `direct`（内网直连）|
| `AIGW_BASE_URL` | ✅ | `https://aigw.nie.netease.com/v1` |
| `AIGW_APP_KEY` | ✅ | 交付方给（形如 `<AppID>.<AppKey>`）|
| `TEXT_MODEL` | ✅ | `claude-opus-4-6` |
| `IMAGE_MODEL` | ✅ | `gemini-3-pro-image`（AIGW 回退用的图像模型）|
| `IMAGE_PROVIDER_ORDER` | ✅ | `nanobanana,aigw`（原生优先→回退 AIGW）|
| `NANO_BANANA_API_KEY` | ✅ | 交付方给（Google Gemini key）|
| `NANO_BANANA_BASE_URL` | ✅ | `https://generativelanguage.googleapis.com/v1beta` |
| `NANO_BANANA_MODEL` | ✅ | `gemini-2.5-flash-image` |
| `XRAY_SERVER/PORT/UUID/SNI/PBK/SID` | ✅ | 交付方给的 VLESS+Reality 节点参数 |
| `XRAY_TRANSPORT/FP/SPX/FLOW` | ✅ | 一般 `tcp`/`chrome`/`/`/空；按节点填 |
| `NANO_BANANA_PROXY` | ❌ | **不用填**：容器启动脚本自动设为 `http://127.0.0.1:10809` |

> 若部署机**能直连 Google**：可不填 `XRAY_*`，容器就不起内置代理、图片直连（`.env.example` 有说明）。

---

## 4. 构建并启动

```bash
docker compose up -d --build     # 首次含前端构建 + 依赖安装，约 3-6 分钟
docker compose ps                # app 应 running/healthy
docker compose logs app | tail -30
```
日志应出现（顺序）：
```
[entrypoint] xray → <server>:443 (tcp/reality) http-proxy 127.0.0.1:10809
Xray <ver> started
[entrypoint] NANO_BANANA_PROXY=http://127.0.0.1:10809
EaseSourcer server on http://127.0.0.1:4100 ...
```

---

## 5. 启动后验证（逐条）

```bash
# HTTP 存活
curl -s -o /dev/null -w '/ %{http_code}\n'            http://127.0.0.1:4100/            # 200
curl -s -o /dev/null -w '/api/health %{http_code}\n'  http://127.0.0.1:4100/api/health  # 401(未登录=服务活)
curl -s -o /dev/null -w '/templates/ %{http_code}\n'  http://127.0.0.1:4100/templates/  # 302(跳登录)

# 图片链路自测（容器内经内置 Xray 直出一张 Nano Banana 图；不依赖 AIGW）
docker compose exec -T -e NANO_BANANA_PROXY=http://127.0.0.1:10809 app npx tsx -e '
(async () => {
  const { generateImage } = await import("./src/aigw/client.js");
  const r = await generateImage("a red apple product photo on white background")
    .then(x => ({ ok:true, mime:x.mime, bytes:x.buffer.length }), e => ({ ok:false, err:String(e).slice(0,200) }));
  console.log("IMG_SELFTEST=" + JSON.stringify(r));
})();'
# 期望: IMG_SELFTEST={"ok":true,"mime":"image/png","bytes":...}
# ok:false 时看 err：连不上=Xray节点/参数问题；4xx/无余额=Nano Banana key/额度问题
```

全链路验证（建一个真实任务，需 AIGW 文本 + Nano Banana 图片都通）：
```bash
KEY=<EXT_API_KEYS 里的一个>
curl -s -X POST http://127.0.0.1:4100/api/ext/landingpages \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" -d '{
    "campaign_id":"selftest-001","industry":"Industrial Hardware",
    "product_desc":"Stainless steel flange","product_name_cn":"不锈钢法兰",
    "product_name_en":"Stainless Steel Flange","merchant_name":"selftest","nickname":"a",
    "is_variant":false,"images":["<一张可公网访问的产品图URL>"]}'
# 轮询状态：
curl -s -X POST http://127.0.0.1:4100/api/ext/landingpages/status \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" -d '{"campaign_ids":["selftest-001"]}'
# 期望最终 status=generated/ready；容器日志能看到“文案完成→banner→产品图→完成”
```

---

## 6. 数据迁移（迁入旧线上全量数据，含图）

数据在 Docker 命名卷 `es-data`（= `<项目目录名>_es-data`）。资源文件随卷迁入；任务 JSON 里图片是**旧域名绝对 URL**，需改写成你们的 `PUBLIC_BASE_URL`。

```bash
# 1) 交付方在旧线上主机导出（只导线上 data，不含测试环境）：
#    cd /opt/easesourcer && tar czf ~/es-data.tgz -C . data      # 或 scripts/export-data.sh
# 2) 拿到 es-data.tgz 后，在本项目目录执行（先 compose up 过一次以建卷）：
scripts/load-data.sh es-data.tgz \
  https://easesourcer.omni-marketeer.com \
  "$PUBLIC_BASE_URL_值(如 https://lp.yourcorp.com)"
# 3) 重启生效
docker compose restart app
# 4) 验证：登录 Web，列表应全量可见旧任务，随机打开一个，Banner/产品图能正常显示
```
> 若不传后两个 base 参数，则只迁数据、不改域名（旧任务图片会仍指向旧域名，可能不显示）。

---

## 7. 域名 / 反向代理

- 把你们的域名解析 + 反代到容器宿主的 `4100` 端口（你们的 nginx/网关自理）。
- 确保 `.env` 的 `PUBLIC_BASE_URL` = 该域名（决定产物图片对外 URL）。
- 产物图片由 app 的 `/public/assets/...` 提供，公网免鉴权可下载（渲染端/买家要能访问）。

---

## 8. 排障表

| 症状 | 原因 | 动作 |
|---|---|---|
| 建任务卡在“推断品类/文案”后失败 | AIGW 不通/未授权 | 前置检查 §1 的 AIGW；确认在内网、key 正确、`AIGW_MODE=direct` |
| 图片全部回退 AIGW / IMG_SELFTEST ok:false | Xray 节点错/挂 或 Nano Banana key/额度 | 看 `docker compose logs app` 的 xray 行；核对 `XRAY_*`；换节点；查 Google key 余额 |
| `docker pull ghcr...` 失败（构建期） | 构建机无 ghcr 访问 | 换能访问 ghcr 的机器 build，或 `docker save/load` 迁镜像 |
| sharp 相关构建报错 | 架构/基础镜像 | 用 x86_64 环境；基础镜像已固定 node:22-bookworm-slim |
| 4100 端口被占 | 冲突 | 改 `docker-compose.yml` 的 `ports` 左值 |
| 迁移后旧任务图片 404 | 域名没改写 | 重跑 `scripts/load-data.sh` 带上 OLD/NEW base |
| 任务永久卡 running | 极少数外部挂死 | 有 20 分钟看门狗自动判失败；或 `docker compose restart app`（重启会把 running 标记为“已中断，可重新生成”）|

---

## 9. 更新与回滚

```bash
git pull && docker compose up -d --build      # 更新
docker compose down                            # 停（保留数据卷）
docker compose down -v                         # 停并删数据卷（危险，会清空任务数据）
```
镜像不可变、数据在卷：回滚 = 切回旧 commit 重新 `up --build`；数据不受影响。

---

## 10. 安全红线

- 密钥只在 `.env`（已 gitignore + dockerignore），**绝不进镜像、绝不提交仓库**。
- 交付接口 `/api/ext` 幂等：外部平台入库产品必须**按 `code` 覆盖 / 按 `id` upsert**，禁止只插不删（详见 [external-api-spec §5.1](external-api-spec.md)）。
- 若改用网关 `svc` 托管（单容器天然兼容）：**不要**开 `needs.proxy/needs.aigw`，让容器用自己的 Xray + key，保持自洽。

---

## 11. 架构速记（供推理）

```
一个容器：
  app(Node/tsx) ── 文本(品类+文案) ─► AIGW(内网直连)
                └─ 图片 ─► 127.0.0.1:10809(内置Xray) ─Reality─► Google/Nano Banana
                                失败 → 自动回退 AIGW 出图
存储：Docker 卷 es-data → /app/data（projects/*.json + assets/<code>/），无数据库
入口：宿主 4100 → 你们反代 → 域名(PUBLIC_BASE_URL)
生成流水线：下载图 → 品类画像 → 产品切分 → 文案+校验 → 出图(banner/参考/产品) → VALIDATED
产品数：无硬上限，软上限=上传图片数；逐任务“目标产品数”可再压低
```

## 12. 关键文件

```
Dockerfile              多阶段：web构建 + app运行 + 从官方镜像COPY xray二进制
docker-entrypoint.sh    渲染Xray配置→起xray→自动接NANO_BANANA_PROXY→跑app
docker-compose.yml      单服务 app + 命名卷 es-data
.env.example            全部配置项说明
src/server.ts           Express入口/路由/编排/对接三接口
src/aigw/client.ts      图像provider派发(nanobanana→aigw回退) + 文本
src/aigw/nanobanana.ts  Google原生图像客户端(选择性走代理)
src/pipeline/*          profiler/segment/copy/image/exporter/...
scripts/load-data.sh    迁入数据 + 改写图片域名
scripts/export-data.sh  旧主机导出数据
docs/                   技术交接说明 / external-api-spec / 部署与回滚 / 用户使用手册
```
