/**
 * Nano Banana 原生图像客户端 —— 直连 Google Gemini 图像 API（generateContent）。
 *
 * 与 AIGW 路径的差别：
 *  - 端点/鉴权：POST {baseUrl}/models/{model}:generateContent?key=<KEY>
 *  - 输入参考图：Gemini 原生用 inlineData(base64)，不是 URL；本项目的 inputImages 已是 data URI，直接转。
 *  - 返回：candidates[0].content.parts[].inlineData.{mimeType,data(base64)}
 *  - 网络：公司内网被墙 → 经 config.nanoBanana.proxy（Xray 的 HTTP 入站）；空则直连。
 * 超时覆盖 fetch + 读 body 全过程（clearTimeout 放 finally），避免代理传大图时挂死。
 */
import { config } from '../config.js';
import type { ImageGenResult } from './client.js';

// undici 的 ProxyAgent 用于“只让本次 fetch 走代理”（全局 HTTPS_PROXY 会把 AIGW 也代理掉）
let _ProxyAgent: any = null;
let _dispatcher: any = null;
async function proxyDispatcher(): Promise<any> {
  if (!config.nanoBanana.proxy) return undefined;
  if (!_dispatcher) {
    if (!_ProxyAgent) ({ ProxyAgent: _ProxyAgent } = await import('undici'));
    _dispatcher = new _ProxyAgent(config.nanoBanana.proxy);
  }
  return _dispatcher;
}

function dataUriToInline(u: string): { mimeType: string; data: string } | null {
  const m = u.match(/^data:([^;]+);base64,(.*)$/s);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

/** 生成一张图。inputImages 为 data URI（i2i 参考图）；返回与 AIGW 路径同构的 ImageGenResult。 */
export async function generateImageNano(
  prompt: string,
  inputImages: string[] = [],
  opts: { model?: string } = {},
): Promise<ImageGenResult> {
  if (!config.nanoBanana.apiKey) throw new Error('Nano Banana 未配置 API Key');
  const model = opts.model || config.nanoBanana.model;

  const parts: unknown[] = [{ text: prompt }];
  for (const u of inputImages) {
    const inl = dataUriToInline(u);
    if (inl) parts.push({ inlineData: inl });
    // 非 data URI（理论上本项目不会出现）直接跳过，避免把 URL 当图发。
  }
  const body = { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'] } };
  const url = `${config.nanoBanana.baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(config.nanoBanana.apiKey)}`;

  const dispatcher = await proxyDispatcher();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      ...(dispatcher ? { dispatcher } : {}),
    } as any);
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Nano Banana 返回非 JSON (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok || json?.error) {
      const msg = json?.error?.message || text.slice(0, 200);
      // 无余额/配额/权限等业务错误也从这里抛出，交由上层回退 AIGW
      throw new Error(`Nano Banana error (${res.status}): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }
    const rparts: any[] = json?.candidates?.[0]?.content?.parts || [];
    const img = rparts.find((p) => p?.inlineData || p?.inline_data);
    const d = img && (img.inlineData || img.inline_data);
    if (!d?.data) throw new Error('Nano Banana 未返回图片（无 inlineData）');
    const base64: string = d.data;
    const mime: string = d.mimeType || d.mime_type || 'image/png';
    return { dataUri: `data:${mime};base64,${base64}`, mime, base64, buffer: Buffer.from(base64, 'base64') };
  } finally {
    clearTimeout(timer);
  }
}
