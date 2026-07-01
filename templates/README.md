# EaseSourcing 落地页模板包

把「单个落地页」扩展为「一整套可切换的版式模板」，供 Google Landing Page 投放系统使用。
所有模板均为 **独立 HTML+JS 单文件**，运行时 `fetch` 同一份 `content.json` + `products.json` 渲染，
复用统一的转化按钮：**Get a Quote · Chat on WhatsApp · Chat Now**。

当前共 **5 套版式**，与现有 `m1`(stats/certs/testimonials) / `m2`(trust/faq) 共用完全相同的
`ContentData` / `ProductData` 契约，可直接纳入现有 `m{n}-{wfil}` 路由：

| 版式文件 | 名称 | 风格定位 |
|---|---|---|
| `split-editorial.html` | **Split Editorial** | 浅色克制、信任前置、左右分栏 Hero（通用品牌感） |
| `dark-premium.html` | **Dark Premium** | 深色高端、全幅 Hero、交替媒体行（高客单价） |
| `catalog-grid.html` | **Catalog Grid** | 密集目录网格、多 SKU；含 About EaseSourcing 品牌带 |
| `showroom.html` | **Showroom** | 沉浸式陈列：大图 Hero + 特色产品大展位 + 产品画廊 + 品牌故事 |
| `brand-story.html` | **Brand Story** | 编辑/叙事风（衬线）：EaseSourcing 故事 + FAST 流程时间线 + 精选产品 |

> **Showroom 系**（catalog-grid / showroom / brand-story）额外包含一段「About EaseSourcing」品牌介绍，
> 文案取自 easesourcing.com（NetEase·NASDAQ:NTES、6B+ 海关记录 / 230+ 国家 / 200M+ 联系人、FAST 流程等）。

---

## 版本（1.0 / 1.1）

每套版式有两个版本，预览站可在左侧侧栏的「版本」段控里切换：

| 版本 | 位置 | 说明 |
|---|---|---|
| **1.0 原版** | 根目录 `/<key>` | 初版设计 |
| **1.1 最佳实践版** | `/v1.1/<key>` | 参考落地页最佳实践修改（见 POPO 文档《高转化 B2B 产品落地页：要素体系》） |

`1.1` 按 **B2B 最佳实践**（见 POPO 文档《v1.1 · B2B 产品落地页最佳实践（B2B 强化版）》）在 `1.0` 上叠加一层**自适应 B2B 实质层**（同一文件内联，主题自适应；**已剔除 To C 式 emoji 安抚**）：

- **合规/验证带**（替代 emoji 信任条）— hero 下方一行**事实**：合规标准号（CE·UN38.3·IEC 62619·ISO 9001…）+ "工厂审计 / 第三方报告 SGS·BV 可索取"，无 emoji
- **规格参数表** — 首品的关键技术参数（电压/容量/化学/循环/BMS/防护/合规/质保…）+ "Request full datasheet"，喂技术买家的独立调研
- **采购条款表**（替代"风险逆转"安抚卡）— MOQ / 交期 / 付款(T/T·L/C) / 打样 / QC / Incoterms / OEM，可由 `window.LP.TRADE` 覆盖
- **转化埋点** — 每次转化点击 push `dataLayer`（`event:lp_conversion`）+ 调 `gtag('event','generate_lead')`

> 规格数据取自 `products.json` 的可选字段 `specs:[{label,value}]`（`1.0` 忽略，`1.1` 渲染，向后兼容）。
> 待业务/产品拍板后再做的项：独立线索资格表单（vs 一键 WhatsApp）、品牌主体取向、按投放类型的页面粒度路由。

---

## 一、目录结构

```
easesourcer-templates/
├── split-editorial.html   # 版式：Split Editorial
├── dark-premium.html      # 版式：Dark Premium
├── catalog-grid.html      # 版式：Catalog Grid（含品牌带）
├── showroom.html          # 版式：Showroom
├── brand-story.html       # 版式：Brand Story
├── index.html             # 预览导航页（缩略图 + 入口；仅预览用）
├── docs.html              # 本文档的网页渲染版（仅预览用）
├── marked.min.js          # docs.html 的 Markdown 渲染库（随站点托管，运行时不依赖 CDN）
├── _switcher.js           # 预览站模板切换器（由 nginx 边缘注入，不写入交付文件）
├── data/
│   ├── content.json       # 示例 ContentData（含全部可选区块，便于预览）
│   └── products.json      # 示例 { data: ProductData[] }
├── serve.js               # 本地预览最简静态服务器（node serve.js → http://localhost:8765）
└── README.md
```

每个版式 `.html` 都是 **零外部依赖** 的单文件（内联 CSS + JS），可直接托管/嵌入。
`index.html` / `docs.html` / `_switcher.js` / `marked.min.js` 仅服务于预览环境，**不属于交付内容**。

---

## 二、数据契约（与 m1/m2 一致）

### content.json — `ContentData`
| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | ✅ | Hero 主标题 |
| `subtitle` | ✅ | Hero 副标题 |
| `banner` | ✅ | Hero 背景/主图（绝对 URL，或 `{{ASSET:xxx}}` 占位，或相对图片名） |
| `cta` | – | `{ bottomTitle, bottomSubtitle }` 底部 CTA 文案 |
| `stats` | – | `{ sectionTitle, items:[{value,label}] }` |
| `trust` | – | `{ sectionTitle, items:[{icon,title,desc}] }` |
| `certifications` | – | `{ sectionTitle, items:[string] }` |
| `testimonials` | – | `{ sectionTitle, items:[{quote,author}] }` |
| `faq` | – | `{ sectionTitle, items:[{q,a}] }` |
| `about` | – | **可选**：`{ title, body }` 覆盖 Showroom 系的公司介绍标题/正文；不填则用内置 EaseSourcing 文案 |
| `contact` | – | `{ email, wa }`，`wa` 用于拼 WhatsApp 链接 |

所有可选区块均为 **三态显隐**：字段缺失或 `items` 为空 → 该区块自动不渲染。

### products.json — `{ data: ProductData[] }`（也兼容直接传数组）
每个 `ProductData` 使用：`productName`（标题）、`subtitle`（型号，如 `MLP-48S`）、
`description`（卖点）、`images[]`（首图为主图）。

> 资源解析：`http(s)://` / `data:` / `//` 开头原样使用；`{{ASSET:name}}` 占位还原为 `name`；
> 其余视为相对名，前缀 `LP_CONFIG.assetsBase`。

---

## 三、接入：只改一个配置块

每个模板顶部都有 `<script id="lp-config">`，**只改这里即可**，其它代码无需改动：

```js
window.LP_CONFIG = {
  contentUrl:  "data/content.json",   // 或后端返回 ContentData 的接口
  productsUrl: "data/products.json",  // 或返回 { data:[...] } 的接口
  assetsBase:  "",                    // 相对图片名/占位的前缀，如 "/assets/<code>/"
  whatsappFallback: "",               // content.contact.wa 缺失时的兜底号码（含国家码）

  // 转化按钮行为：'whatsapp'（默认）| 'url:https://...'
  actions: { quote: "whatsapp", chat: "whatsapp" },

  // 终极自定义钩子；返回 true 表示"已自行处理"，跳过默认行为
  // ({action, resolved, productName, content}) => boolean
  onAction: null
};
```

### 转化按钮行为（占位 + 数据驱动）
- **Chat on WhatsApp**：固定走 WhatsApp。号码取 `content.contact.wa`（兜底 `whatsappFallback`），预填文案与生产一致：
  - 带产品：`Hi, I'm interested in {productName}. Could you provide a quote?`
  - 通用：`Hi, I'd like to inquire about your products. Could you provide more details?`
- **Get a Quote** (`data-action="quote"`) / **Chat Now** (`data-action="chat"`)：默认走 WhatsApp，
  可在 `actions` 改为 `"url:https://..."`，或用 `onAction` 接管（弹询盘表单、打开自有 IM 等）。
  所有按钮带 `data-product`（产品级）便于埋点。

```js
// 接你们自己的询盘弹窗/IM：
onAction: ({action, productName}) => {
  if (action === 'quote') { openInquiryModal(productName); return true; }
  return false; // 其余仍走默认
}
```

---

## 四、About EaseSourcing 品牌块（Showroom 系）

`catalog-grid` / `showroom` / `brand-story` 顶部含一段 `<script id="lp-brand">`，定义 `LP.EASE` 常量
（标语、NetEase 背书、平台数据、三大支柱、FAST 流程）。文案据 easesourcing.com，作为品牌级常量在落地页间复用。
如需按项目覆盖公司介绍标题/正文，传 `content.about = { title, body }` 即可；其余品牌字段保持统一。

---

## 五、纳入 Google Landing Page 模板体系

- 所有版式对齐 `m1/m2`：同一份 `content.json` + `products.json` → 不同 `*.html` 渲染不同版式。
- 现有路由正则 `^m(\d+)-([wfil]{4})...` 可直接映射到本包对应 HTML。
- 每个模板内 **唯一不同** 的是 `<script id="lp-layout">`（版式渲染）与 `<style>`；
  `lp-config` 与 `lp-core`（数据加载 + 按钮分发）跨模板一致，便于统一维护或抽公共文件。

---

## 六、本地预览

```bash
cd easesourcer-templates
node serve.js   # http://localhost:8765/  → 导航页（5 套版式 + 文档）
```
（`data/` 下已附 solar-panel 示例数据，覆盖全部可选区块。）

线上预览（Cloudflare）：`https://template.omni-marketeer.com/`
切换器（左侧贴边标签）与本文档页均为预览专用，不影响交付文件。
