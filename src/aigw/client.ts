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

interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** extra top-level fields merged into the request body (e.g. vertexai) */
  extra?: Record<string, unknown>;
}

async function relayPost(body: unknown, timeoutMs: number): Promise<any> {
  const attempts = 4; // tolerate relay/tunnel blips (sleep, reconnect, network jitter)
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${config.relayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Relay-Token': config.relayToken },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      // network-level failure (relay down / tunnel reconnecting / timeout) → retry
      clearTimeout(timer);
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      throw new Error(`AIGW relay 连接失败（已重试 ${attempts} 次，relay 可能不可用）：${String(e)}`);
    }
    clearTimeout(timer);
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`AIGW relay returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
    }
    // a got-a-response error is a business error (e.g. bad params) — do NOT retry
    if (!res.ok || json?.error) {
      const msg = json?.error?.message || json?.error || text.slice(0, 300);
      throw new Error(`AIGW error (${res.status}): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }
    return json;
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
 * Image generation via gemini-3-pro-image. Caller supplies the text prompt and
 * optional input images (data URIs or https URLs) for i2i. Sets the required
 * vertexai.response_modalities. Returns the first image.
 */
export async function generateImage(
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

export async function relayHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${config.relayUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}
