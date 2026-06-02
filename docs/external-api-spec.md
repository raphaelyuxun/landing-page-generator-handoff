# EaseSourcer 落地页生产系统 — 对接接口文档 v1.0

面向外部"落地页生产列表"系统的集成方。本文档自包含,集成时无需额外背景。

---

## 0. 集成流程

```
① 创建    POST /api/ext/landingpages           → 拿到 landingpage_id(请保存),任务进入异步生成
② 轮询    POST /api/ext/landingpages/status     → 传一组 campaign_id,批量拿状态(建议每 10~20s)
③ 交付    GET  /api/ext/landingpages/{id}/delivery → 当 status=ready 时返回两份 JSON + 图片URL
④ 上线    外部下载图片URL → 转存自有对象存储 → 替换链接 → 发布
```
- 生成是**异步**的(数分钟)。创建接口立即返回,不阻塞。
- 任务生成完后,还需我方操作员在后台点"标记完成",状态才变 `ready`、才可交付。

---

## 1. 环境与密钥

| 环境 | Base URL | API Key(`X-API-Key`) |
|---|---|---|
| 测试 | 待提供(测试环境搭建后给出,预计形如 `https://easesourcer-test.omni-marketeer.com`) | `esk_test_xxxxxxxx（向我方索取）` |
| 线上 | `https://easesourcer.omni-marketeer.com` | `esk_live_xxxxxxxx（向我方索取）` |

> 密钥请妥善保管、勿外泄、勿提交到公开仓库;如需轮换请联系我方。建议先在测试环境联调通过,再切线上。

**通用约定**

| 项 | 说明 |
|---|---|
| 路径前缀 | `/api/ext/`(拼在对应环境 Base URL 之后) |
| 请求/响应格式 | `application/json`,UTF-8 |
| 接口层时间 | ISO 8601 UTC,如 `2026-06-01T12:30:00Z` |
| JSON 产物内时间 | `updateTime` 用 `YYYY-MM-DD HH:mm:ss`(下游模板契约,勿改) |

---

## 2. 鉴权

所有接口必须带请求头 `X-API-Key`,值为**对应环境**的 API Key(见 §1):

| Header | 必填 | 说明 |
|---|---|---|
| `X-API-Key` | 是 | 测试环境用 `esk_test_…`,线上环境用 `esk_live_…` |

- 缺失 / 错误 → `401`。
- IP 白名单(可选):我方配置;为空则不校验,非空则仅放行名单内来源 IP,否则 `403`。请提供贵方固定出口 IP(测试 / 线上可分别提供)。

---

## 3. 接口一:创建落地页任务

`POST /api/ext/landingpages`

### 请求体字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `campaign_id` | string | 是 | 投放任务唯一ID(即贵方列表的"任务ID")。**幂等键**,见"创建行为" |
| `is_variant` | boolean | 是 | `false`=主落地页(走防覆盖保护);`true`=为该 campaign 新建一个变体落地页 |
| `industry` | string | 是 | 行业/产品类别,用于品类判断与文案/配图,如 `"CNC精密加工"` |
| `product_desc` | string | 是 | 产品描述,用于生成文案与产品图主体 |
| `product_name_cn` | string | 是 | 产品中文名 |
| `product_name_en` | string | 是 | 产品英文名 |
| `images` | array | 是 | 产品图,至少 1 个;我方服务器会下载。每个元素可为 **① URL 字符串**(旧形态,继续支持)**或 ② 对象 `{ "url": "...", "description": "..." }`**(新形态,`description` 可选)。**强烈建议带 `description`**:它是用户上传图片时填写的图片说明,会作为"该图对应产品到底是什么"的强信号喂给识别/文案/品类判断,纠正仅凭产品名导致的方向偏差。两种形态可混用 |
| `merchant_name` | string | 是 | 商家名;作我方后台列表的任务名显示,不写入落地页 |
| `nickname` | string | 是 | 发起人昵称;仅我方存档(不影响生成、不回传) |
| `exclude_region` | string | 否 | 剔除国家地区;**仅我方存档,不影响生成** |
| `task_type` | string | 否 | 任务类型;**仅我方存档,不影响生成** |
| `extra` | object | 否 | 任意其他字段;仅我方存档 |

### 创建行为(同一 `campaign_id` 再次请求时)

**`is_variant=false`(主落地页)** — 按该 campaign 主落地页当前状态:

| 当前状态 | 行为 |
|---|---|
| 不存在 | 新建并开始生成 |
| `accepted`/`generating`(生成中) | **拒绝 `409`**,不覆盖(防重复点击/重试误覆盖) |
| `failed`(失败) | 清空并自动重新生成 |
| `generated`/`ready`/`delivered` | 幂等返回现有任务,**不覆盖**(`created=false`) |

**`is_variant=true`(变体)**:总是新建一个落地页(新的 `landingpage_id`、`variant_no` 递增),不影响该 campaign 已有任务。

> 一期变体的差异化生成逻辑尚未实现,但字段与数据结构已就绪;贵方一期可不暴露"创建变体"入口。

### 请求示例
```json
{
  "campaign_id": "T-10086",
  "is_variant": false,
  "industry": "CNC精密加工",
  "product_desc": "多轴 CNC 加工的铝合金/不锈钢非标精密零件,公差稳定,支持 OEM 图纸",
  "product_name_cn": "CNC精密零件",
  "product_name_en": "CNC Precision Machined Part",
  "images": [
    "https://cdn.example.com/u/123/a.jpg",
    { "url": "https://cdn.example.com/u/123/b.jpg", "description": "户外防腐不锈钢外壳,带散热孔" }
  ],
  "merchant_name": "苏州某精密机械",
  "nickname": "jacky",
  "exclude_region": "RU,IR",
  "task_type": "new",
  "extra": { "client_id": "C-9931", "budget": 5000 }
}
```

### 响应字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `landingpage_id` | string | 我方落地页ID,**对接主键,请保存**(状态/交付都用它) |
| `campaign_id` | string | 回显 |
| `variant_no` | integer | 落地页序号(主=0,变体 1,2…) |
| `status` | string | 见 §状态枚举(新建时为 `accepted`) |
| `created` | boolean | `true`=本次新建;`false`=幂等命中已存在 |

### 响应示例(`202`)
```json
{ "landingpage_id": "lp_abc123", "campaign_id": "T-10086", "variant_no": 0, "status": "accepted", "created": true }
```
- `200` + `created=false`:幂等命中已存在任务。
- 失败码:`401` `403` `409`(生成中) `422`(字段/图片URL 校验失败)。
- 图片下载每张重试 3 次;任一张最终失败 → 任务变 `failed`,对其再发一次"创建落地页"即自动重跑。

---

## 4. 接口二:批量查询状态

`POST /api/ext/landingpages/status`

### 请求体

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `campaign_ids` | string[] | 是 | 一组 campaign_id,**单次 ≤ 100** |

```json
{ "campaign_ids": ["T-10086", "T-10087"] }
```

### 响应

`results`:对象,key 为 campaign_id,value 为该 campaign 下的**落地页数组**(一期长度恒为 1,取 `[0]`;无记录则 `[]`)。

每个落地页对象字段:

| 字段 | 类型 | 说明 |
|---|---|---|
| `landingpage_id` | string | 落地页ID |
| `campaign_id` | string | 所属投放任务 |
| `variant_no` | integer | 序号 |
| `status` | string | 见 §状态枚举 |
| `deliverable` | boolean | 是否可交付(= status ∈ {`ready`,`delivered`}) |
| `code` | string \| null | 落地页 URL slug(生成完成后才有) |
| `failure_reason` | string \| null | 失败原因(status=`failed` 时有值) |
| `progress` | object \| null | 进度,见下;非生成中为 `null` |
| `updated_at` | string | 最近更新时间(ISO 8601) |

`progress` 子字段:

| 字段 | 类型 | 说明 |
|---|---|---|
| `step` | string | 当前步骤,如 `"产品图 3/4"` |
| `current` | integer | 已完成步数 |
| `total` | integer | 总步数 |
| `eta_seconds` | integer \| null | 预计剩余秒数 |

### 响应示例(`200`)
```json
{
  "results": {
    "T-10086": [
      {
        "landingpage_id": "lp_abc123",
        "campaign_id": "T-10086",
        "variant_no": 0,
        "status": "generating",
        "deliverable": false,
        "code": null,
        "failure_reason": null,
        "progress": { "step": "产品图 3/4", "current": 5, "total": 6, "eta_seconds": 60 },
        "updated_at": "2026-06-01T12:30:00Z"
      }
    ],
    "T-10087": []
  }
}
```

---

## 5. 接口三:交付

`GET /api/ext/landingpages/{landingpage_id}/delivery`

- 前置:`status` 必须为 `ready` 或 `delivered`,否则返回 `409` + 当前 status。
- 成功拉取后,该任务 status 变为 `delivered`(可重复拉取)。

### 响应

交付就是两份落地页 JSON。**图片 URL 已包含在 JSON 内**(`content.banner`、`products.data[].images`),无需单独传图,也不回传图片二进制。

| 字段 | 类型 | 说明 |
|---|---|---|
| `content` | object | content.json 全文,见 §6 |
| `products` | object | products.json 全文,见 §7 |

### 响应示例(`200`)
```json
{
  "content": {
    "code": "cnc-precision-part",
    "schemaVersion": 1,
    "title": "CNC Precision Machining & Custom Metal Parts",
    "subtitle": "Multi-axis machining, ISO-certified, full documentation",
    "banner": "https://easesourcer.omni-marketeer.com/public/assets/cnc-precision-part/images/banner.jpg",
    "contact": { "wa": "+85270850592", "email": "sales@easesourcing.com" },
    "stats": { "sectionTitle": "Facility & Capability", "items": [ { "value": "16+", "label": "Years" } ] },
    "certifications": { "sectionTitle": "Certifications", "items": ["ISO 9001", "IATF 16949"] },
    "testimonials": { "sectionTitle": "Client Feedback", "items": [ { "quote": "...", "author": "M. Richter, Germany - QA" } ] }
  },
  "products": {
    "data": [
      {
        "id": "cnc-precision-part-1",
        "code": "cnc-precision-part",
        "productName": "CNC Machined Aluminum Heat Sink",
        "description": "Precision-milled, anodized finish",
        "images": ["https://easesourcer.omni-marketeer.com/public/assets/cnc-precision-part/images/product-1.jpg"],
        "price": 0, "quantity": 0, "updateTime": "2026-06-01 12:00:00"
      }
    ],
    "success": true, "message": "", "code": 200
  }
}
```
> 图片 URL 公网可访问;贵方下载转存到自有对象存储、替换 `content.banner` 与 `products.data[].images` 后再发布。

---

## 6. content.json 字段释义(落地页文案,对应下游 content 接口)

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `code` | string | 是 | 落地页 URL slug |
| `schemaVersion` | integer | 是 | 恒为 `1` |
| `updateTime` | string | 否 | `YYYY-MM-DD HH:mm:ss` |
| `title` | string | 是 | Hero 主标题 |
| `subtitle` | string | 是 | Hero 副标题 |
| `banner` | string | 是 | Hero 背景图 URL |
| `contact` | object | 是 | `{ wa, email }` 联系方式;WhatsApp 带国家码 |
| `cta` | object | 否 | `{ bottomTitle, bottomSubtitle }` 底部行动号召 |
| `stats` | object | 否 | `{ sectionTitle, items:[{ value, label }] }` 数据指标 |
| `certifications` | object | 否 | `{ sectionTitle, items: string[] }` 认证 |
| `testimonials` | object | 否 | `{ sectionTitle, items:[{ quote, author }] }` 客户评价 |

> 显隐三态:某模块字段不存在 = 该模块不渲染。当前版式固定为"模版1",仅含 stats/certifications/testimonials(不含 trust/faq)。
> `contact` 为**固定全站联系方式**(WhatsApp `+85270850592` / `sales@easesourcing.com`),由我方自动写入,**无需贵方传入**。

content.json 示例:
```json
{
  "code": "cnc-precision-part", "schemaVersion": 1, "updateTime": "2026-06-01 12:00:00",
  "title": "CNC Precision Machining & Custom Metal Parts",
  "subtitle": "Multi-axis machining, ISO-certified, full documentation for OEM integration",
  "banner": "https://easesourcer.omni-marketeer.com/public/assets/cnc-precision-part/images/banner.jpg",
  "contact": { "wa": "+85270850592", "email": "sales@easesourcing.com" },
  "cta": { "bottomTitle": "Request a Technical Quote", "bottomSubtitle": "Reply within 24 hours" },
  "stats": { "sectionTitle": "Facility & Capability", "items": [ { "value": "16+", "label": "Years" }, { "value": "80+", "label": "Countries" } ] },
  "certifications": { "sectionTitle": "Certifications", "items": ["ISO 9001", "IATF 16949", "RoHS"] },
  "testimonials": { "sectionTitle": "Client Feedback", "items": [ { "quote": "Tolerance consistency was excellent.", "author": "M. Richter, Germany - QA Engineer" } ] }
}
```

---

## 7. products.json 字段释义(商品列表,对应下游 products 接口)

外层:`{ "data": ProductData[], "success": true, "message": "", "code": 200 }`

`ProductData` 字段:

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 商品ID(`{code}-{序号}`) |
| `code` | string | 是 | 落地页 slug(与 content.code 一致) |
| `productName` | string | 是 | 商品名(H1) |
| `description` | string | 否 | 一句简短卖点(≤2 行) |
| `images` | string[] | 否 | 商品图 URL(首张为主图) |
| `price` | number | 否 | 通常 0(前端不展示) |
| `quantity` | number | 否 | 通常 0 |
| `updateTime` | string | 是 | `YYYY-MM-DD HH:mm:ss` |

> `subtitle`(型号)/`specs`(规格表)本版默认不生成。

products.json 示例:
```json
{
  "data": [
    { "id": "cnc-precision-part-1", "code": "cnc-precision-part",
      "productName": "CNC Machined Aluminum Heat Sink", "description": "Precision-milled, anodized finish",
      "images": ["https://easesourcer.omni-marketeer.com/public/assets/cnc-precision-part/images/product-1.jpg"],
      "price": 0, "quantity": 0, "updateTime": "2026-06-01 12:00:00" }
  ],
  "success": true, "message": "", "code": 200
}
```

---

## 8. 枚举值

**status**(任务状态):

| 值 | 含义 | 可交付 |
|---|---|---|
| `accepted` | 已受理,排队 | 否 |
| `generating` | 生成中(`progress` 有值) | 否 |
| `generated` | 已生成,待我方操作员"标记完成" | 否 |
| `ready` | 已标记完成,可交付 | 是 |
| `delivered` | 已被拉取交付(可重复拉) | 是 |
| `failed` | 生成失败(`failure_reason` 有值) | 否 |

---

## 9. 错误码

| HTTP | 含义 |
|---|---|
| `401` | `X-API-Key` 缺失或错误 |
| `403` | 来源 IP 不在白名单 |
| `404` | landingpage_id 不存在 |
| `409` | 状态不满足(生成中重复创建 / 未 ready 就交付) |
| `422` | 请求字段或图片 URL 校验失败 |
| `429` | 频率限制(如启用) |
| `500` / `502` | 我方内部 / 上游(AI 网关)错误 |

错误响应体:
```json
{ "error": "该投放任务正在生成中,请勿重复创建", "status": "generating" }
```
(`status` 字段仅在与任务状态相关的错误时出现)

---

## 10. 名词

| 术语 | 含义 |
|---|---|
| campaign_id | 投放任务ID(贵方生成,贵方列表"任务ID") |
| landingpage_id | 落地页素材ID(我方生成,对接主键,贵方保存) |
| variant_no | 同一 campaign 下落地页序号(主=0) |
| code | 落地页 URL slug(我方生成、可由我方操作员调整) |

---
*v1.0 — 如对字段名/结构有调整意见,请反馈;确认后进入开发。*
