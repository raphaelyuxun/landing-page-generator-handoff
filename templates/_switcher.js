/* ============================================================================
 * Preview-only template + version switcher.
 * Injected by nginx (sub_filter) ONLY on the preview host
 * (template.omni-marketeer.com). NOT part of the deliverable *.html files.
 * Fully isolated via Shadow DOM. Switches both layout (5 templates) and
 * version (1.0 original / 1.1 best-practice revision).
 * ========================================================================== */
(function () {
  "use strict";
  if (window.__lpSwitcher) return;
  window.__lpSwitcher = true;

  var TEMPLATES = [
    { key: "split-editorial", name: "Split Editorial", tag: "浅色 · 通用" },
    { key: "dark-premium",    name: "Dark Premium",    tag: "深色 · 高端" },
    { key: "catalog-grid",    name: "Catalog Grid",    tag: "浅色 · 多 SKU" },
    { key: "showroom",        name: "Showroom",        tag: "沉浸式陈列" },
    { key: "brand-story",     name: "Brand Story",     tag: "叙事 · 编辑风" }
  ];

  // parse current template + version from the path
  var path = location.pathname.replace(/\/+$/, "");
  var version = "1.0", slug;
  var mv = path.match(/^\/v1\.1\/([^\/]+?)(?:\.html)?$/);
  if (mv) { version = "1.1"; slug = mv[1]; }
  else { slug = path.replace(/^\//, "").replace(/\.html$/, ""); }
  if (slug === "" || slug === "index" || slug === "docs") return;
  var current = TEMPLATES.find(function (t) { return t.key === slug; });

  // Version switching is hidden until v1.1 is ready. Flip to true to re-expose.
  var SHOW_VERSIONS = false;
  var linkVer = SHOW_VERSIONS ? version : "1.0";

  // downloadable code package (HTML+JS) for the CURRENT template only — named after it
  var DOWNLOAD_URL = "/templates/download/" + slug + ".zip";

  // URL builders
  function urlFor(key, ver) { return ver === "1.1" ? "/templates/v1.1/" + key : "/templates/" + key; }

  function build() {
    var host = document.createElement("div");
    host.id = "lp-preview-switcher";
    host.style.cssText = "all:initial";
    var root = host.attachShadow({ mode: "open" });

    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}' +
      '.tab{position:fixed;left:0;top:50%;transform:translateY(-50%);z-index:2147483000;' +
        'display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;' +
        'background:rgba(15,23,42,.82);color:#fff;border:0;border-radius:0 12px 12px 0;' +
        'padding:14px 8px;box-shadow:0 6px 22px -8px rgba(0,0,0,.5);opacity:.55;transition:opacity .2s,padding .2s}' +
      '.tab:hover{opacity:1;padding-right:11px}' +
      '.tab svg{width:18px;height:18px;display:block}' +
      '.tab .vlabel{writing-mode:vertical-rl;font-size:11px;letter-spacing:.12em;font-weight:700}' +
      '.tab .vbadge{font-size:10px;font-weight:800;background:#2dd4a0;color:#06281f;border-radius:5px;padding:1px 4px;writing-mode:horizontal-tb}' +
      '.overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(2,6,23,.28);' +
        'opacity:0;pointer-events:none;transition:opacity .2s}' +
      '.panel{position:fixed;left:14px;top:50%;transform:translateY(-50%) translateX(-118%);z-index:2147483001;' +
        'width:262px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;' +
        'box-shadow:0 24px 60px -18px rgba(2,6,23,.5);transition:transform .22s cubic-bezier(.4,0,.2,1)}' +
      ':host(.open) .overlay{opacity:1;pointer-events:auto}' +
      ':host(.open) .panel{transform:translateY(-50%) translateX(0)}' +
      ':host(.open) .tab{opacity:0;pointer-events:none}' +
      '.hd{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:13px 14px;background:#0f172a;color:#fff}' +
      '.hd .t{font-size:12px;font-weight:700;letter-spacing:.04em}' +
      '.hd .t small{display:block;font-weight:500;color:#94a3b8;letter-spacing:0;margin-top:2px;font-size:10.5px}' +
      '.x{background:rgba(255,255,255,.12);border:0;color:#fff;width:24px;height:24px;border-radius:7px;cursor:pointer;font-size:14px;line-height:1}' +
      '.x:hover{background:rgba(255,255,255,.24)}' +
      // version segmented control
      '.ver{padding:13px 14px 11px;border-bottom:1px solid #eef2f7}' +
      '.ver .vlab{font-size:10.5px;font-weight:800;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;margin-bottom:7px}' +
      '.seg{display:flex;background:#f1f5f9;border-radius:10px;padding:3px;gap:3px}' +
      '.seg button{flex:1;border:0;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:700;color:#475569;' +
        'background:transparent;border-radius:8px;padding:8px 6px;transition:background .15s,color .15s;line-height:1.25}' +
      '.seg button small{display:block;font-weight:600;font-size:10px;color:#94a3b8;margin-top:2px}' +
      '.seg button.on{background:#fff;color:#0f766e;box-shadow:0 1px 3px rgba(15,23,42,.12)}' +
      '.seg button.on small{color:#13a37f}' +
      '.vnote{margin-top:9px;font-size:11px;color:#64748b;display:flex;gap:6px;align-items:flex-start;line-height:1.4}' +
      '.vnote .dot{width:7px;height:7px;border-radius:50%;background:#2dd4a0;flex:0 0 auto;margin-top:4px}' +
      // template list
      '.list-lab{font-size:10.5px;font-weight:800;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;padding:12px 16px 2px}' +
      '.list{padding:2px 8px 8px}' +
      '.opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;cursor:pointer;text-decoration:none;' +
        'padding:10px 11px;border-radius:10px;border:1px solid transparent;color:#0f172a;background:none}' +
      '.opt:hover{background:#f1f5f9}' +
      '.opt .dot{width:9px;height:9px;border-radius:50%;background:#cbd5e1;flex:0 0 auto}' +
      '.opt .nm{display:block;font-size:13.5px;font-weight:700;line-height:1.2}' +
      '.opt .tg{display:block;font-size:11px;color:#94a3b8;margin-top:2px}' +
      '.opt.cur{background:#ecfdf5;border-color:#a7f3d0;cursor:default}' +
      '.opt.cur .dot{background:#2dd4a0}' +
      '.opt.cur .nm{color:#0f766e}' +
      '.opt .cur-badge{margin-left:auto;white-space:nowrap;font-size:10px;font-weight:700;color:#0f766e;background:#d1fae5;padding:2px 7px;border-radius:999px}' +
      '.ft{border-top:1px solid #eef2f7;padding:8px}' +
      '.back{display:flex;align-items:center;gap:8px;width:100%;padding:10px 11px;border-radius:10px;text-decoration:none;color:#334155;font-size:13px;font-weight:600;background:none;border:0;cursor:pointer}' +
      '.back:hover{background:#f1f5f9}' +
      '.back svg{width:15px;height:15px}' +
      '.dl{justify-content:center;background:#2dd4a0;color:#06281f;font-weight:700;margin-bottom:4px}' +
      '.dl:hover{background:#22c08e}' +
      '</style>';

    // collapsed tab (shows current version badge)
    var tab = document.createElement("button");
    tab.className = "tab";
    tab.setAttribute("aria-label", "切换版式与版本");
    tab.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>' +
      '<rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' +
      '<span class="vlabel">模板</span>' + (SHOW_VERSIONS ? '<span class="vbadge">v' + version + '</span>' : '');

    var overlay = document.createElement("div");
    overlay.className = "overlay";

    var panel = document.createElement("div");
    panel.className = "panel";

    // version segmented control
    var verNote = version === "1.1"
      ? '<span class="dot"></span><span><b>1.1</b> · 按 B2B 最佳实践重做（合规带 / 规格参数表 / 采购条款表 / 转化埋点）</span>'
      : '<span class="dot"></span><span><b>1.0</b> · 原版。切到 1.1 查看按最佳实践修订的版本</span>';

    var segHtml = !SHOW_VERSIONS ? "" :
      '<div class="ver"><div class="vlab">版本</div>' +
      '<div class="seg">' +
        '<button data-ver="1.0" class="' + (version === "1.0" ? "on" : "") + '">1.0<small>原版</small></button>' +
        '<button data-ver="1.1" class="' + (version === "1.1" ? "on" : "") + '">1.1<small>最佳实践</small></button>' +
      '</div>' +
      '<div class="vnote">' + verNote + '</div></div>';

    // template options (links honor active version)
    var opts = TEMPLATES.map(function (t) {
      var isCur = current && t.key === current.key;
      if (isCur) {
        return '<div class="opt cur"><span class="dot"></span><span><span class="nm">' + t.name +
               '</span><span class="tg">' + t.tag + '</span></span><span class="cur-badge">当前</span></div>';
      }
      return '<a class="opt" href="' + urlFor(t.key, linkVer) + '"><span class="dot"></span><span><span class="nm">' + t.name +
             '</span><span class="tg">' + t.tag + '</span></span></a>';
    }).join("");

    panel.innerHTML =
      '<div class="hd"><div class="t">' + (SHOW_VERSIONS ? '切换版式 / 版本' : '切换版式') + '<small>预览模式 · 不影响交付文件</small></div>' +
      '<button class="x" aria-label="收起">✕</button></div>' +
      segHtml +
      '<div class="list-lab">版式</div>' +
      '<div class="list">' + opts + '</div>' +
      '<div class="ft">' +
      '<a class="back dl" href="' + DOWNLOAD_URL + '" download="' + slug + '.zip">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
      '下载此模板（HTML + JS）</a>' +
      '<a class="back" href="/templates/">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>' +
      '返回模板列表</a>' +
      '<a class="back" href="/templates/docs">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>' +
      '研发接入文档</a>' +
      '<a class="back" href="/">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' +
      '返回工作台</a></div>';

    root.appendChild(tab);
    root.appendChild(overlay);
    root.appendChild(panel);
    document.body.appendChild(host);

    function open() { host.classList.add("open"); }
    function close() { host.classList.remove("open"); }
    tab.addEventListener("click", open);
    overlay.addEventListener("click", close);
    panel.querySelector(".x").addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

    // version segmented control → navigate current template to chosen version
    panel.querySelectorAll(".seg button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var v = btn.getAttribute("data-ver");
        if (v === version) return;
        location.href = urlFor(slug, v);
      });
    });
  }

  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
})();
