import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnchorsConfig, KnobsConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export const config = {
  port: Number(process.env.PORT || 4100),
  // 真实值由各机器的 .env 提供（.env 已 gitignore）。源码只保留安全占位默认值。
  appPassword: process.env.APP_PASSWORD || 'change-me',
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-change-me',
  // AIGW 接入模式：'relay' = 经 Mac Mini relay（阿里云外网机器用）；'direct' = 直连 AIGW（集团内网机器用）
  aigwMode: (process.env.AIGW_MODE || 'relay').trim() as 'relay' | 'direct',
  // relay 模式：应用 → 本机 relay 端口（反向隧道到 Mac Mini），relay 注入 AppKey
  relayUrl: (process.env.AIGW_RELAY_URL || 'http://127.0.0.1:4500').replace(/\/$/, ''),
  relayToken: process.env.AIGW_RELAY_TOKEN || '',
  // direct 模式：应用直连 AIGW，自己持有 AppKey（AppID.AppKey 形式的 Bearer 值）
  aigwBaseUrl: (process.env.AIGW_BASE_URL || 'https://aigw.nie.netease.com/v1').replace(/\/$/, ''),
  aigwAppKey: process.env.AIGW_APP_KEY || '',
  textModel: process.env.TEXT_MODEL || 'claude-opus-4-6',
  imageModel: process.env.IMAGE_MODEL || 'gemini-3-pro-image',
  /** 图像 provider 尝试顺序：默认 Nano Banana 原生优先，失败（连不上/无余额/报错/空图）回退 AIGW。 */
  imageProviderOrder: (process.env.IMAGE_PROVIDER_ORDER || 'nanobanana,aigw')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  /** Nano Banana = Google 原生 Gemini 图像 API（内网被墙 → 经 Xray 代理）。 */
  nanoBanana: {
    apiKey: process.env.NANO_BANANA_API_KEY || '',
    baseUrl: (process.env.NANO_BANANA_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, ''),
    model: process.env.NANO_BANANA_MODEL || 'gemini-2.5-flash-image',
    /** HTTP 代理（Xray 的 HTTP 入站，如 http://xray:10809）。空 = 直连 Google（部署机能直连时）。 */
    proxy: (process.env.NANO_BANANA_PROXY || '').trim(),
  },
  /** 喂给视觉模型“理解产品范围”的图片数节流阀（均匀采样）。0/未设 = 喂全部图（默认），
   *  使模型能识别到“图片数”这么多不同产品；仅在图特别多、想省 token/延迟时才设正值。 */
  maxVisionImages: Math.max(0, Number(process.env.MAX_VISION_IMAGES || 0)),
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || './data'),
  configDir: path.resolve(ROOT, 'config'),
  /** public base URL for externally-reachable asset links in exported JSON */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'https://easesourcer.omni-marketeer.com').replace(/\/$/, ''),
  /** fixed site-wide contact, written into every landing page's content.contact */
  siteContact: {
    wa: (process.env.SITE_WHATSAPP || '+85270850592').trim(),
    email: (process.env.SITE_EMAIL || 'sales@easesourcing.com').trim(),
  },
  /** external integration API keys (X-API-Key) accepted by /api/ext/* — 由 .env 的 EXT_API_KEYS 提供 */
  extApiKeys: (process.env.EXT_API_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean),
  /** optional IP allowlist for /api/ext/* — empty = disabled */
  extIpAllowlist: (process.env.EXT_IP_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean),
};

/** Externally-reachable absolute URL for a generated asset (no auth required). */
export function publicAssetUrl(code: string, exportName: string): string {
  return `${config.publicBaseUrl}/public/assets/${code}/${exportName.replace(/^\/+/, '')}`;
}

export function ensureDirs(): void {
  for (const d of [config.dataDir, path.join(config.dataDir, 'projects'), path.join(config.dataDir, 'assets')]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

let _knobs: KnobsConfig | null = null;
let _anchors: AnchorsConfig | null = null;

export function loadKnobs(): KnobsConfig {
  // re-read each time the file path is requested via reloadKnobs; cache otherwise
  if (!_knobs) _knobs = JSON.parse(fs.readFileSync(path.join(config.configDir, 'knobs.config.json'), 'utf-8'));
  return _knobs!;
}

export function saveKnobs(next: KnobsConfig): void {
  fs.writeFileSync(path.join(config.configDir, 'knobs.config.json'), JSON.stringify(next, null, 2));
  _knobs = next;
}

export function loadAnchors(): AnchorsConfig {
  if (!_anchors) _anchors = JSON.parse(fs.readFileSync(path.join(config.configDir, 'anchors.config.json'), 'utf-8'));
  return _anchors!;
}
