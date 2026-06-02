/**
 * Filesystem-backed store for GenerationProject (no DB, per PRD §1.5).
 * Projects: data/projects/<code>.json
 * Assets:   data/assets/<code>/<file>
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { GenerationProject } from '../types.js';

function projectsDir(): string {
  return path.join(config.dataDir, 'projects');
}
export function assetsDir(code: string): string {
  const d = path.join(config.dataDir, 'assets', code);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function projectFile(code: string): string {
  return path.join(projectsDir(), `${sanitizeCode(code)}.json`);
}

export function sanitizeCode(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
}

export function nowStamp(): string {
  // "YYYY-MM-DD HH:mm:ss" in the server's local time
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export interface ProjectSummary {
  code: string;
  /** merchant_name (from echo) — list 显示名 = merchantName-code，列表层实时拼接 */
  merchantName?: string;
  state: string;
  updatedAt: string;
  job?: GenerationProject['job'];
  productCount?: number;
  markedReady?: boolean;
  archived?: boolean;
}
export function listProjects(): ProjectSummary[] {
  fs.mkdirSync(projectsDir(), { recursive: true });
  const out: ProjectSummary[] = [];
  for (const f of fs.readdirSync(projectsDir())) {
    if (!f.endsWith('.json')) continue;
    try {
      const p = JSON.parse(fs.readFileSync(path.join(projectsDir(), f), 'utf-8')) as GenerationProject;
      const merchantName = typeof p.echo?.merchant_name === 'string' ? (p.echo!.merchant_name as string).trim() : undefined;
      out.push({ code: p.code, merchantName: merchantName || undefined, state: p.state, updatedAt: p.updatedAt, job: p.job, productCount: p.formInput?.products?.length, markedReady: p.markedReady, archived: p.archived });
    } catch {
      /* skip unreadable */
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function getProject(code: string): GenerationProject | null {
  const f = projectFile(code);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf-8')) as GenerationProject;
}

export function saveProject(p: GenerationProject, bumpUpdatedAt = true): GenerationProject {
  fs.mkdirSync(projectsDir(), { recursive: true });
  if (bumpUpdatedAt) p.updatedAt = nowStamp();
  fs.writeFileSync(projectFile(p.code), JSON.stringify(p, null, 2));
  return p;
}

/**
 * Derive a unique URL slug (code). Priority: explicit code → product EN name →
 * `fallback`. If the chosen base is junk (empty / pure-numeric / single char,
 * e.g. EN name "1" or non-latin), it falls back to `fallback` (then 'lp').
 * Guarantees uniqueness by appending -2/-3… on filename collision.
 */
function deriveCode(formInput: GenerationProject['formInput'], fallback?: string): string {
  const clean = (s: string) => sanitizeCode(s).replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  let base = clean(formInput.code || formInput.products?.[0]?.nameEn || '');
  if (!base || /^[0-9]+$/.test(base) || base.length < 2) {
    base = clean(fallback || '') || 'lp';
  }
  let code = base;
  let n = 2;
  while (fs.existsSync(projectFile(code))) {
    code = `${base}-${n++}`;
  }
  return code;
}

export interface CreateOpts {
  campaignId?: string;
  isVariant?: boolean;
  variantNo?: number;
  echo?: Record<string, unknown>;
  code?: string;
  /** fallback slug base when EN name is junk/empty (e.g. 'lp-' + campaignId) */
  fallback?: string;
}

export function createProject(formInput: GenerationProject['formInput'], opts: CreateOpts = {}): GenerationProject {
  const code = deriveCode(opts.code ? { ...formInput, code: opts.code } : formInput, opts.fallback);
  const p: GenerationProject = {
    code,
    landingpageId: 'lp_' + crypto.randomBytes(9).toString('hex'),
    campaignId: opts.campaignId,
    isVariant: opts.isVariant,
    variantNo: opts.variantNo ?? 0,
    echo: opts.echo,
    state: 'DRAFT_INPUT',
    createdAt: nowStamp(),
    updatedAt: nowStamp(),
    formInput: { ...formInput, code },
  };
  return saveProject(p);
}

/** Find a project by its stable landingpage_id (external integration key). */
export function getByLandingpageId(lpid: string): GenerationProject | null {
  for (const s of listProjects()) {
    const p = getProject(s.code);
    if (p?.landingpageId === lpid) return p;
  }
  return null;
}

/** All landing pages under a campaign, sorted by variantNo. */
export function findByCampaign(campaignId: string): GenerationProject[] {
  const out: GenerationProject[] = [];
  for (const s of listProjects()) {
    const p = getProject(s.code);
    if (p?.campaignId === campaignId) out.push(p);
  }
  return out.sort((a, b) => (a.variantNo ?? 0) - (b.variantNo ?? 0));
}

/** The "main" (non-variant) landing page of a campaign, if any. */
export function findCampaignMain(campaignId: string): GenerationProject | null {
  return findByCampaign(campaignId).find((p) => !p.isVariant) ?? null;
}

/** Rename a project's code (URL slug): renames file + assets dir + rewrites all code/URL refs. */
export function renameProjectCode(oldCode: string, newCodeRaw: string): GenerationProject {
  const p = getProject(oldCode);
  if (!p) throw new Error('not found');
  const nc = sanitizeCode(newCodeRaw).replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  if (!nc) throw new Error('slug 不合法（请用字母/数字/连字符）');
  if (nc === oldCode) return p;
  if (fs.existsSync(projectFile(nc))) throw new Error(`slug「${nc}」已被占用，请换一个`);

  const oldAssets = path.join(config.dataDir, 'assets', oldCode);
  const newAssets = path.join(config.dataDir, 'assets', nc);
  if (fs.existsSync(oldAssets)) fs.renameSync(oldAssets, newAssets);

  // rewrite every occurrence of the old code in URLs/paths via JSON round-trip
  const json = JSON.stringify(p)
    .split('/public/assets/' + oldCode + '/').join('/public/assets/' + nc + '/')
    .split('/assets/' + oldCode + '/').join('/assets/' + nc + '/');
  const np: GenerationProject = JSON.parse(json);
  np.code = nc;
  np.formInput.code = nc;
  if (np.contentDraft) np.contentDraft.code = nc;
  np.productsDraft?.forEach((pd) => {
    pd.code = nc;
    if (pd.id.startsWith(oldCode + '-')) pd.id = nc + '-' + pd.id.slice(oldCode.length + 1);
  });

  fs.unlinkSync(projectFile(oldCode));
  return saveProject(np);
}

export function deleteProject(code: string): void {
  const f = projectFile(code);
  if (fs.existsSync(f)) fs.unlinkSync(f);
  const ad = path.join(config.dataDir, 'assets', sanitizeCode(code));
  if (fs.existsSync(ad)) fs.rmSync(ad, { recursive: true, force: true });
}
