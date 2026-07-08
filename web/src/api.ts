import type { FormInput, ImageMeta, KnobsConfig, Project, ProjectListItem, RevisionPlan } from './types';

// 前端与后端可能分离部署（前端 CF Pages、后端阿里云）：
// - VITE_API_BASE 为空 = 同源部署（相对路径 + cookie，向后兼容）。
// - VITE_API_BASE = https://api.xxx = 跨域部署，鉴权走 Bearer token（存 localStorage）。
const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) || '').replace(/\/$/, '');
const TOKEN_KEY = 'es_token';
export function getToken(): string { return localStorage.getItem(TOKEN_KEY) || ''; }
function setToken(t: string) { if (t) localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }
function authHeaders(base: Record<string, string> = {}): Record<string, string> {
  const t = getToken();
  return t ? { ...base, Authorization: `Bearer ${t}` } : base;
}
const CREDS: RequestCredentials = API_BASE ? 'omit' : 'same-origin';

async function req<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(API_BASE + url, {
    credentials: CREDS,
    ...opts,
    headers: authHeaders({ 'Content-Type': 'application/json', ...(opts.headers as Record<string, string> | undefined) }),
  });
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

// 上传类（FormData）：不设 Content-Type（浏览器自动 multipart），但要带 token。
async function upload<T>(url: string, fd: FormData): Promise<T> {
  const res = await fetch(API_BASE + url, { method: 'POST', body: fd, headers: authHeaders(), credentials: CREDS });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  me: () => req<{ authed: boolean }>('/api/me'),
  login: async (password: string) => {
    const r = await req<{ ok: true; token?: string }>('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    if (r.token) setToken(r.token);
    return r;
  },
  logout: async () => {
    const r = await req<{ ok: true }>('/api/logout', { method: 'POST' }).catch(() => ({ ok: true as const }));
    clearToken();
    return r;
  },
  health: () => req<{ ok: boolean; relay: boolean }>('/api/health'),

  listProjects: () => req<ProjectListItem[]>('/api/projects'),
  createProject: (form: FormInput) => req<Project>('/api/projects', { method: 'POST', body: JSON.stringify(form) }),
  getProject: (code: string) => req<Project>(`/api/projects/${code}`),
  deleteProject: (code: string) => req<{ ok: true }>(`/api/projects/${code}`, { method: 'DELETE' }),
  updateForm: (code: string, form: FormInput) => req<Project>(`/api/projects/${code}/form`, { method: 'PUT', body: JSON.stringify(form) }),
  uploadZip: (code: string, file: File) => {
    const fd = new FormData();
    fd.append('zip', file);
    return upload<{ refs: string[]; count: number }>(`/api/projects/${code}/raw-zip`, fd);
  },

  profile: (code: string) => req<Project>(`/api/projects/${code}/profile`, { method: 'POST' }),
  setKnobs: (code: string, archetype: string | null, overrides: Record<string, unknown>) =>
    req<Project>(`/api/projects/${code}/knobs`, { method: 'POST', body: JSON.stringify({ archetype, overrides }) }),
  generateCopy: (code: string, overridePrompt?: string) =>
    req<Project>(`/api/projects/${code}/generate-copy`, { method: 'POST', body: JSON.stringify({ overridePrompt }) }),
  generateImages: (code: string) => req<Project>(`/api/projects/${code}/generate-images`, { method: 'POST' }),
  generateAll: (code: string) => req<Project>(`/api/projects/${code}/generate-all`, { method: 'POST' }),
  autorun: (code: string) => req<Project>(`/api/projects/${code}/autorun`, { method: 'POST' }),
  planRevision: (code: string, instruction: string) =>
    req<RevisionPlan>(`/api/projects/${code}/plan-revision`, { method: 'POST', body: JSON.stringify({ instruction }) }),
  revise: (code: string, instruction: string, plan?: RevisionPlan) =>
    req<Project>(`/api/projects/${code}/revise`, { method: 'POST', body: JSON.stringify({ instruction, plan }) }),
  regenImage: (code: string, productIndex: number) =>
    req<Project>(`/api/projects/${code}/regen-image`, { method: 'POST', body: JSON.stringify({ productIndex }) }),
  saveDraft: (code: string, content: unknown, products: unknown, edit?: unknown) =>
    req<Project>(`/api/projects/${code}/draft`, { method: 'PUT', body: JSON.stringify({ content, products, edit }) }),
  stageZip: (code: string, file: File) => {
    const fd = new FormData();
    fd.append('zip', file);
    return upload<{ images: { ref: string; url: string }[] }>(`/api/projects/${code}/stage-zip`, fd);
  },
  stageImage: (code: string, file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    return upload<{ ref: string; url: string }>(`/api/projects/${code}/stage-image`, fd);
  },
  editInput: (code: string, fields: Record<string, string>, opts?: { meta?: Record<string, ImageMeta>; images?: string[]; staged?: boolean }) => {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v ?? ''));
    if (opts?.meta) fd.append('meta', JSON.stringify(opts.meta));
    if (opts?.images) fd.append('images', JSON.stringify(opts.images));
    if (opts?.staged) fd.append('staged', '1');
    return upload<Project>(`/api/projects/${code}/edit-input`, fd);
  },
  markReady: (code: string, ready: boolean) => req<Project>(`/api/projects/${code}/mark-ready`, { method: 'POST', body: JSON.stringify({ ready }) }),
  archive: (code: string, archived: boolean) => req<Project>(`/api/projects/${code}/archive`, { method: 'POST', body: JSON.stringify({ archived }) }),
  renameCode: (code: string, newCode: string) => req<Project>(`/api/projects/${code}/rename`, { method: 'POST', body: JSON.stringify({ newCode }) }),
  // 下载走浏览器直接导航（<a href>），带不了 Bearer 头 → 跨域时用 ?token 兜底（后端 authed 接受 query token）。
  exportUrl: (code: string) => {
    const t = getToken();
    return `${API_BASE}/api/projects/${code}/export${t ? `?token=${encodeURIComponent(t)}` : ''}`;
  },

  getKnobsConfig: () => req<KnobsConfig>('/api/knobs-config'),
  saveKnobsConfig: (cfg: KnobsConfig) => req<{ ok: true }>('/api/knobs-config', { method: 'PUT', body: JSON.stringify(cfg) }),
};
