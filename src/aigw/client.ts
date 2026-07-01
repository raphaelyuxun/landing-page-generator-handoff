/**
 * AIGW client — talks to the Python relay on the Mac Mini (over the reverse
 * SSH tunnel). The relay injects the AppKey and forwards to AIGW; this client
 * never sees the AppKey, only the relay token.
 */
import { config } from '../config.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | unknown;
}

/** 拿到了响应的业务错误（参数错误 / 非 JSON 等）——不应重试，与网络/超时错误区分。 */
class AigwBusinessError extends Error {}

interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** extra top-level fields merged into the request body (e.g. vertexai) */
  extra?: Record<string, unknown>;
}

/** AIGW 端点 + 鉴权头，按模式选择：
 *  - direct：直连 AIGW，自带 `Authorization: Bearer <AppKey>`（集团内网机器）
 *  - relay ：发到本机 relay 端口，带 `X-Relay-Token`，由 Mac Mini relay 注入 AppKey（阿里云外网机器） */
function aigwTarget(): { url: string; headers: Record<string, string> } {
  if (config.aigwMode === 'direct') {
    return {
      url: `${config.aigwBaseUrl}/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.aigwAppKey}` },
    };
  }
  return {
    url: `${config.relayUrl}/v1/chat/completions`,
    headers: { 'Content-Type': 'application/json', 'X-Relay-Token': config.relayToken },
  };
}

async function relayPost(body: unknown, timeoutMs: number): Promise<any> {
  const attempts = 4; // tolerate relay/tunnel blips (sleep, reconnect, network jitter)
  const { url, headers } = aigwTarget();
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      // 读取响应体也必须在同一个超时/中断保护内。隧道在收到响应头之后、传输
      // body（图片是大段 base64）过程中卡住时，res.text() 本身没有超时，会无限
      // 挂起——这正是任务卡死 13 小时的真因。把 clearTimeout 放到 finally，让
      // ctrl.signal 覆盖整个请求生命周期（fetch + 读 body）。
      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AigwBusinessError(`AIGW relay returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
      }
      // 拿到了响应的业务错误（如参数错误）——不重试
      if (!res.ok || json?.error) {
        const msg = json?.error?.message || json?.error || text.slice(0, 300);
        throw new AigwBusinessError(`AIGW error (${res.status}): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
      }
      return json;
    } catch (e) {
      if (e instanceof AigwBusinessError) throw e; // 业务错误立即抛出，不重试
      // 网络/超时/中断（relay 挂、隧道重连、body 传输卡死被 abort）→ 重试
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      throw new Error(`AIGW 连接失败（${config.aigwMode} 模式，已重试 ${attempts} 次，${config.aigwMode === 'direct' ? 'AIGW 直连不可用' : 'relay 可能不可用'}）：${String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Plain text chat completion. Returns the assistant message string. */
export async function chatText(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts.model || config.textModel,
    messages,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(opts.extra || {}),
  };
  const json = await relayPost(body, 60_000);
  const content = json?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

/**
 * Chat that must return strict JSON. Extracts the first JSON object/array from
 * the response (tolerates accidental code fences) and parses it.
 */
export async function chatJSON<T = unknown>(messages: ChatMessage[], opts: ChatOptions = {}): Promise<T> {
  const raw = await chatText(messages, opts);
  return parseLooseJSON<T>(raw);
}

export function parseLooseJSON<T = unknown>(raw: string): T {
  let s = raw.trim();
  // strip ```json ... ``` fences if present
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // find first balanced { } or [ ]
  const start = s.search(/[{[]/);
  if (start === -1) throw new Error(`No JSON found in model output: ${raw.slice(0, 200)}`);
  const openCh = s[start];
  const closeCh = openCh === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === openCh) depth++;
      else if (c === closeCh) {
        depth--;
        if (depth === 0) {
          const slice = s.slice(start, i + 1);
          return JSON.parse(slice) as T;
        }
      }
    }
  }
  throw new Error(`Unbalanced JSON in model output: ${raw.slice(0, 200)}`);
}

export interface ImageGenResult {
  /** data URI: data:image/png;base64,... */
  dataUri: string;
  mime: string;
  base64: string;
  buffer: Buffer;
}

/**
 * 图像生成派发器：按 config.imageProviderOrder 依次尝试 provider，任一成功即返回；
 * 前一个失败（连不上 / 无余额·配额 / 报错 / 空图）自动回退下一个。默认 nanobanana → aigw。
 */
export async function generateImage(
  prompt: string,
  inputImages: string[] = [],
  opts: ChatOptions = {},
): Promise<ImageGenResult> {
  const order = config.imageProviderOrder.length ? config.imageProviderOrder : ['aigw'];
  let lastErr: unknown;
  for (const prov of order) {
    try {
      if (prov === 'nanobanana') {
        if (!config.nanoBanana.apiKey) continue; // 未配置则跳过，不算失败
        const { generateImageNano } = await import('./nanobanana.js');
        return await generateImageNano(prompt, inputImages, { model: opts.model });
      }
      if (prov === 'aigw') return await generateImageAigw(prompt, inputImages, opts);
    } catch (e) {
      lastErr = e;
      console.warn(`[image] provider ${prov} 失败，尝试下一个：${String(e).slice(0, 160)}`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`所有图像 provider 均失败（${order.join(',')}）`);
}

/**
 * AIGW 图像生成（gemini-3-pro-image，OpenAI 兼容格式，经 relay/direct）。作为 Nano Banana 的回退。
 */
async function generateImageAigw(
  prompt: string,
  inputImages: string[] = [],
  opts: ChatOptions = {},
): Promise<ImageGenResult> {
  const userContent: unknown =
    inputImages.length > 0
      ? [
          { type: 'text', text: prompt },
          ...inputImages.map((url) => ({ type: 'image_url', image_url: { url } })),
        ]
      : prompt;

  const body: Record<string, unknown> = {
    model: opts.model || config.imageModel,
    messages: [{ role: 'user', content: userContent }],
    vertexai: { response_modalities: ['IMAGE', 'TEXT'] },
    ...(opts.extra || {}),
  };

  // retry on transient failures / empty image responses (image models occasionally
  // return text-only or a transient error)
  const attempts = 3;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const json = await relayPost(body, 180_000);
      const urls: string[] = json?.choices?.[0]?.message?.image_urls || [];
      const dataUri = urls[0];
      if (!dataUri || !dataUri.startsWith('data:')) {
        throw new Error('image model returned no image (no image_urls data URI)');
      }
      const m = dataUri.match(/^data:([^;]+);base64,(.*)$/s);
      if (!m) throw new Error('unexpected image data URI format');
      return { dataUri, mime: m[1], base64: m[2], buffer: Buffer.from(m[2], 'base64') };
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** AIGW 可达性：relay 模式探 relay 的 /healthz；direct 模式只要配了 AppKey 即视为就绪。 */
export async function relayHealth(): Promise<boolean> {
  if (config.aigwMode === 'direct') return !!config.aigwAppKey;
  try {
    const res = await fetch(`${config.relayUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}
