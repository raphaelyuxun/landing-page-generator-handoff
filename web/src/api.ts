import type { FormInput, ImageMeta, KnobsConfig, Project, ProjectListItem, RevisionPlan } from './types';

async function req<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
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

export const api = {
  me: () => req<{ authed: boolean }>('/api/me'),
  login: (password: string) => req<{ ok: true }>('/api/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => req<{ ok: true }>('/api/logout', { method: 'POST' }),
  health: () => req<{ ok: boolean; relay: boolean }>('/api/health'),

  listProjects: () => req<ProjectListItem[]>('/api/projects'),
  createProject: (form: FormInput) => req<Project>('/api/projects', { method: 'POST', body: JSON.stringify(form) }),
  getProject: (code: string) => req<Project>(`/api/projects/${code}`),
  deleteProject: (code: string) => req<{ ok: true }>(`/api/projects/${code}`, { method: 'DELETE' }),
  updateForm: (code: string, form: FormInput) => req<Project>(`/api/projects/${code}/form`, { method: 'PUT', body: JSON.stringify(form) }),
  uploadZip: async (code: string, file: File) => {
    const fd = new FormData();
    fd.append('zip', file);
    const res = await fetch(`/api/projects/${code}/raw-zip`, { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return (await res.json()) as { refs: string[]; count: number };
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
  stageZip: async (code: string, file: File) => {
    const fd = new FormData();
    fd.append('zip', file);
    const res = await fetch(`/api/projects/${code}/stage-zip`, { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return (await res.json()) as { images: { ref: string; url: string }[] };
  },
  stageImage: async (code: string, file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch(`/api/projects/${code}/stage-image`, { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return (await res.json()) as { ref: string; url: string };
  },
  editInput: async (code: string, fields: Record<string, string>, opts?: { meta?: Record<string, ImageMeta>; images?: string[]; staged?: boolean }) => {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v ?? ''));
    if (opts?.meta) fd.append('meta', JSON.stringify(opts.meta));
    if (opts?.images) fd.append('images', JSON.stringify(opts.images));
    if (opts?.staged) fd.append('staged', '1');
    const res = await fetch(`/api/projects/${code}/edit-input`, { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return (await res.json()) as Project;
  },
  markReady: (code: string, ready: boolean) => req<Project>(`/api/projects/${code}/mark-ready`, { method: 'POST', body: JSON.stringify({ ready }) }),
  archive: (code: string, archived: boolean) => req<Project>(`/api/projects/${code}/archive`, { method: 'POST', body: JSON.stringify({ archived }) }),
  renameCode: (code: string, newCode: string) => req<Project>(`/api/projects/${code}/rename`, { method: 'POST', body: JSON.stringify({ newCode }) }),
  exportUrl: (code: string) => `/api/projects/${code}/export`,

  getKnobsConfig: () => req<KnobsConfig>('/api/knobs-config'),
  saveKnobsConfig: (cfg: KnobsConfig) => req<{ ok: true }>('/api/knobs-config', { method: 'PUT', body: JSON.stringify(cfg) }),
};
