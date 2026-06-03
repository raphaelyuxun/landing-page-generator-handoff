import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs, loadAnchors, loadKnobs, publicAssetUrl, saveKnobs } from './config.js';
import { ROOT } from './config.js';
import { relayHealth } from './aigw/client.js';
import {
  assetsDir,
  createProject,
  deleteProject,
  findByCampaign,
  findCampaignMain,
  getByLandingpageId,
  getProject,
  listProjects,
  renameProjectCode,
  sanitizeCode,
  saveProject,
} from './store/projects.js';
import { generateCombos, profileCategory } from './pipeline/profiler.js';
import { resolveKnobState } from './pipeline/knobs.js';
import { generateCopy } from './pipeline/copy.js';
import { runTrustGuard } from './pipeline/trustguard.js';
import { generateImages, regenerateBanner, regenerateProductImage } from './pipeline/image.js';
import { segmentProducts } from './pipeline/segment.js';
import { routeRevision } from './pipeline/revise.js';
import { buildExportPayload, exportZip } from './pipeline/exporter.js';
import type { ContentData, FormInput, GenerationProject, ImageMeta, JobStatus, KnobState, LogEntry, ProductData, ReviewEdit } from './types.js';
import { imageMetaOf } from './types.js';

function nowISO(): string {
  return new Date().toISOString();
}

type JobLog = (level: LogEntry['level'], msg: string) => void;
type JobWork = (
  p: GenerationProject,
  update: (step: string, current?: number, total?: number) => void,
  log: JobLog,
) => Promise<void>;

/** Run long work in the background, tracking progress + logs on the project for UI polling. */
function startJob(code: string, kind: JobStatus['kind'], work: JobWork): GenerationProject | null {
  const p = getProject(code);
  if (!p) return null;
  if (p.job?.status === 'running') {
    const ageMs = Date.now() - new Date(p.job.startedAt).getTime();
    if (ageMs < 15 * 60 * 1000) return p; // genuinely running — don't start another
    // else: stale/stuck job — allow a new one to take over
  }
  p.job = { kind, status: 'running', step: '开始…', startedAt: nowISO() };
  if (!p.logs) p.logs = [];
  const log: JobLog = (level, msg) => {
    p.logs!.push({ at: nowISO(), level, msg });
    if (p.logs!.length > 300) p.logs = p.logs!.slice(-300);
    saveProject(p);
  };
  const kindLabel =
    kind === 'profile' ? '生成品类画像' : kind === 'copy' ? '生成文案' : kind === 'images' ? '生成图片' : kind === 'auto' || kind === 'generate' ? '生成全部素材' : kind === 'revise' ? '应用修改' : '处理中';
  log('info', `▶ 开始：${kindLabel}`);
  void (async () => {
    const update = (step: string, current?: number, total?: number) => {
      p.job = { ...(p.job as JobStatus), step, current, total };
      log('info', total != null ? `${step} (${current}/${total})` : step);
    };
    try {
      await work(p, update, log);
      p.job = { ...(p.job as JobStatus), status: 'done', step: '完成', finishedAt: nowISO() };
      log('info', '✓ 完成');
    } catch (e) {
      p.job = { ...(p.job as JobStatus), status: 'error', step: '失败', error: String(e), finishedAt: nowISO() };
      log('error', `✗ 失败：${String(e)}`);
    }
  })();
  return p;
}

ensureDirs();
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '64mb' }));
app.use(cookieParser(config.sessionSecret));

// ---------------------------------------------------------------------------
// Auth (fixed password, signed cookie — no user system, PRD §1.3)
// ---------------------------------------------------------------------------
const AUTH_COOKIE = 'es_auth';
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.signedCookies?.[AUTH_COOKIE] === 'ok') return next();
  return res.status(401).json({ error: 'unauthorized' });
}

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (typeof password === 'string' && password === config.appPassword) {
    res.cookie(AUTH_COOKIE, 'ok', {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'invalid password' });
});
app.post('/api/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE);
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  res.json({ authed: req.signedCookies?.[AUTH_COOKIE] === 'ok' });
});

// ---------------------------------------------------------------------------
// Health + config
// ---------------------------------------------------------------------------
app.get('/api/health', requireAuth, async (_req, res) => {
  res.json({ ok: true, relay: await relayHealth() });
});
app.get('/api/knobs-config', requireAuth, (_req, res) => res.json(loadKnobs()));
app.get('/api/anchors-config', requireAuth, (_req, res) => res.json(loadAnchors()));
app.put('/api/knobs-config', requireAuth, (req, res) => {
  // admin mode (§4.4): persist edited knob options
  try {
    saveKnobs(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
// 已归档任务只读保护：拦截对已归档任务的一切改动（archive 端点除外，以便放回）
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const m = req.path.match(/^\/api\/projects\/([^/]+)\/(.+)$/);
  if (!m || m[2] === 'archive') return next();
  if (getProject(m[1])?.archived) return res.status(409).json({ error: '任务已归档（只读），请先放回再操作' });
  next();
});

app.get('/api/projects', requireAuth, (_req, res) => res.json(listProjects()));

app.post('/api/projects', requireAuth, (req, res) => {
  const form = req.body as FormInput;
  if (!form || !Array.isArray(form.products) || form.products.length === 0) {
    return res.status(400).json({ error: 'invalid FormInput: need at least one product' });
  }
  if (!form.products[0].nameEn?.trim() && !form.products[0].nameCn?.trim() && !form.code?.trim()) {
    return res.status(400).json({ error: 'need a product name or code' });
  }
  const merchant = form.merchantName?.trim();
  const p = createProject(form, merchant ? { echo: { merchant_name: merchant }, fallback: sanitizeCode(merchant) } : {});
  res.json(p);
});

app.get('/api/projects/:code', requireAuth, (req, res) => {
  const p = getProject(req.params.code);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
});
app.delete('/api/projects/:code', requireAuth, (req, res) => {
  deleteProject(req.params.code);
  res.json({ ok: true });
});

app.put('/api/projects/:code/form', requireAuth, (req, res) => {
  const p = getProject(req.params.code);
  if (!p) return res.status(404).json({ error: 'not found' });
  p.formInput = { ...req.body, code: p.code };
  res.json(saveProject(p));
});

// raw image upload (multer → data/assets/<code>/raw)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(assetsDir(req.params.code), 'raw');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});
app.post('/api/projects/:code/raw', requireAuth, upload.array('images', 12), (req, res) => {
  const files = (req.files as Express.Multer.File[]) || [];
  res.json({ refs: files.map((f) => path.join('raw', path.basename(f.path))) });
});

// product image ZIP upload — extract images into raw/, assign to the first product
const uploadZip = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const IMG_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
app.post('/api/projects/:code/raw-zip', requireAuth, uploadZip.single('zip'), (req, res) => {
  const p = getProject(req.params.code);
  if (!p) return res.status(404).json({ error: 'not found' });
  if (!req.file) return res.status(400).json({ error: 'no zip uploaded' });
  const dir = path.join(assetsDir(p.code), 'raw');
  fs.mkdirSync(dir, { recursive: true });
  const refs: string[] = [];
  try {
    const zip = new AdmZip(req.file.buffer);
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      if (e.entryName.includes('__MACOSX')) continue;
      const bn = path.basename(e.entryName);
      if (!IMG_EXT.test(bn) || bn.startsWith('.')) continue;
      const safe = `${Date.now()}-${refs.length}-${bn.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
      fs.writeFileSync(path.join(dir, safe), e.getData());
      refs.push(path.join('raw', safe));
    }
  } catch (e) {
    return res.status(400).json({ error: `bad zip: ${String(e)}` });
  }
  if (p.formInput.products[0]) {
    p.formInput.products[0].rawImages = [...(p.formInput.products[0].rawImages || []), ...refs];
  }
  saveProject(p);
  res.json({ refs, count: refs.length });
});

// 编辑输入内容（兜底）：修改文字字段 + 可选 zip 替换全部图片 → 干净重跑全量生成。
// 暂存上传的 zip：解压到 raw-staging/（不动正式 raw/），返回图片列表供弹窗展示并逐张填描述。
// 取消编辑则暂存目录作废、原图不受影响；保存时由 edit-input 提交。
app.post('/api/projects/:code/stage-zip', requireAuth, uploadZip.single('zip'), (req, res) => {
  const p = getProject(req.params.code);
  if (!p) return res.status(404).json({ error: 'not found' });
  if (!req.file) return res.status(400).json({ error: 'no zip uploaded' });
  const stageDir = path.join(assetsDir(p.code), 'raw-staging');
  fs.mkdirSync(stageDir, { recursive: true });
  for (const f of fs.readdirSync(stageDir)) fs.rmSync(path.join(stageDir, f), { force: true });
  const images: { ref: string; url: string }[] = [];
  try {
    const zip = new AdmZip(req.file.buffer);
    let n = 0;
    for (const e of zip.getEntries()) {
      if (e.isDirectory || e.entryName.includes('__MACOSX')) continue;
      const bn = path.basename(e.entryName);
      if (!IMG_EXT.test(bn) || bn.startsWith('.')) continue;
      const name = `up-${n++}-${bn.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
      fs.writeFileSync(path.join(stageDir, name), e.getData());
      // ref 是提交后在 raw/ 里的最终路径（前端用它作为 descriptions 的 key）
      images.push({ ref: path.join('raw', name), url: `/assets/${p.code}/raw-staging/${name}` });
    }
    if (!images.length) return res.status(400).json({ error: 'zip 内没有可用图片' });
  } catch (e) {
    return res.status(400).json({ error: `bad zip: ${String(e)}` });
  }
  res.json({ images });
});

// 编辑输入内容（兜底）。multipart：文字字段 + descriptions(JSON, key=最终ref) + staged 标记；可选 legacy zip 'zip'。
app.post('/api/projects/:code/edit-input', requireAuth, uploadZip.single('zip'), (req, res) => {
  const p = getProject(req.params.code);
  if (!p) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const dir = path.join(assetsDir(p.code), 'raw');
  const stageDir = path.join(assetsDir(p.code), 'raw-staging');

  // 每张图元数据（key = 最终 ref；值 = {nameCn?, nameEn?, description?}）
  let metaInput: Record<string, ImageMeta> = {};
  try { if (typeof b.meta === 'string' && b.meta.trim()) metaInput = JSON.parse(b.meta); } catch { /* ignore */ }
  const hasMetaField = typeof b.meta === 'string';

  // 1) 图片来源：暂存提交（首选）→ legacy 直传 zip → 否则保留现有
  const useStaged = (b.staged === '1' || b.staged === 'true') && fs.existsSync(stageDir) && fs.readdirSync(stageDir).length > 0;
  let replacedImages = false;
  if (useStaged) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
    for (const f of fs.readdirSync(stageDir)) fs.renameSync(path.join(stageDir, f), path.join(dir, f));
    fs.rmSync(stageDir, { recursive: true, force: true });
    replacedImages = true;
  } else if (req.file) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
      const zip = new AdmZip(req.file.buffer);
      let n = 0;
      for (const e of zip.getEntries()) {
        if (e.isDirectory || e.entryName.includes('__MACOSX')) continue;
        const bn = path.basename(e.entryName);
        if (!IMG_EXT.test(bn) || bn.startsWith('.')) continue;
        fs.writeFileSync(path.join(dir, `up-${n++}-${bn.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`), e.getData());
      }
      if (n === 0) return res.status(400).json({ error: 'zip 内没有可用图片' });
      replacedImages = true;
    } catch (e) {
      return res.status(400).json({ error: `bad zip: ${String(e)}` });
    }
  }

  // 2) 以 raw/ 目录实际文件为准，收集全部输入图（重生成的图片源）
  let rawImages: string[] = [];
  try {
    rawImages = fs.readdirSync(dir).filter((f) => IMG_EXT.test(f)).sort().map((f) => path.join('raw', f));
  } catch { /* no raw dir */ }

  // 3) 图片元数据：弹窗传了 meta → 以它为准（过滤到现存图）；否则兼容沿用旧值（或随替换清空）
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  let imageMeta: Record<string, ImageMeta> | undefined;
  if (hasMetaField) {
    const built: Record<string, ImageMeta> = {};
    for (const r of rawImages) {
      const m = metaInput[r];
      if (!m) continue;
      const v: ImageMeta = { nameCn: s(m.nameCn), nameEn: s(m.nameEn), description: s(m.description) };
      if (v.nameCn || v.nameEn || v.description) built[r] = v;
    }
    imageMeta = Object.keys(built).length ? built : undefined;
  } else {
    // 未传 meta：替换了图片则清空；否则沿用已有（兼容旧 imageDescriptions）
    imageMeta = replacedImages ? undefined : (Object.keys(imageMetaOf(p.formInput)).length ? imageMetaOf(p.formInput) : undefined);
  }

  // 4) 写回 echo（公司名/昵称/排除地区，保留 task_type/extra）+ formInput（折叠成单一种子产品）
  const echo = { ...(p.echo || {}) } as Record<string, unknown>;
  if (str(b.merchantName)) echo.merchant_name = str(b.merchantName);
  if (b.nickname !== undefined) echo.nickname = str(b.nickname);
  if (b.excludeRegion !== undefined) echo.exclude_region = str(b.excludeRegion);
  p.echo = echo;
  const seed = {
    nameEn: str(b.nameEn) || p.formInput.products[0]?.nameEn || 'Product',
    nameCn: str(b.nameCn) || p.formInput.products[0]?.nameCn || '',
    sellingPointCn: str(b.productDesc) || undefined,
    rawImages,
  };
  p.formInput = {
    ...p.formInput,
    merchantName: str(b.merchantName) || p.formInput.merchantName,
    categoryHint: str(b.categoryHint) || p.formInput.categoryHint,
    productFeaturesCn: str(b.productDesc) || p.formInput.productFeaturesCn,
    imageMeta,
    imageDescriptions: undefined, // 统一用 imageMeta
    products: [seed],
  };

  // 4) 干净重跑：清掉旧文案/图片/画像（reuse 失效）后全量重生成
  resetForRerun(p); // 内部 saveProject，持久化上面的输入改动 + 重置 markedReady/delivered
  const started = startJob(p.code, 'auto', autorunWork);
  res.json(started || getProject(p.code));
});

// ---------------------------------------------------------------------------
// Pipeline orchestration
// ---------------------------------------------------------------------------
function load(req: express.Request, res: express.Response): GenerationProject | null {
  const p = getProject(req.params.code);
  if (!p) {
    res.status(404).json({ error: 'not found' });
    return null;
  }
  return p;
}

app.post('/api/projects/:code/profile', requireAuth, (req, res) => {
  const started = startJob(req.params.code, 'profile', async (p, update, log) => {
    update('推断品类画像…');
    const profile = await profileCategory(p.formInput);
    p.categoryProfile = profile;
    log('info', `品类：${profile.categoryLabel}（锚点 ${profile.matchedAnchors.join('/')}）`);
    update('生成推荐组合…');
    p.recommendedCombos = await generateCombos(profile);
    update('识别压缩包内产品…');
    const rawCount = p.formInput.products[0]?.rawImages?.length || 0;
    if (rawCount === 0) log('warn', '压缩包内没有可用图片，将按品类生成产品变体');
    const products = await segmentProducts(p.formInput, profile);
    p.formInput = { ...p.formInput, products };
    log('info', `识别出 ${products.length} 个产品：${products.map((x) => x.nameEn).join('、')}`);
    // set a sensible default knob baseline so the prompt box is usable immediately,
    // preserving any operator prompt the user already typed
    const prevNote = p.knobState?.directionNote;
    p.knobState = resolveKnobState(profile, p.recommendedCombos?.[0] ?? null, prevNote ? { directionNote: prevNote } : undefined);
    p.state = 'KNOBS_SET';
  });
  if (!started) return res.status(404).json({ error: 'not found' });
  res.status(202).json(started);
});

app.post('/api/projects/:code/knobs', requireAuth, (req, res) => {
  const p = load(req, res);
  if (!p) return;
  if (!p.categoryProfile) return res.status(400).json({ error: 'profile required first' });
  const { archetype, overrides } = req.body || {};
  const combo = p.recommendedCombos?.find((c) => c.archetype === archetype) || null;
  p.knobState = resolveKnobState(p.categoryProfile, combo, overrides as Partial<KnobState>);
  p.state = 'KNOBS_SET';
  res.json(saveProject(p));
});

app.post('/api/projects/:code/generate-copy', requireAuth, (req, res) => {
  const pre = getProject(req.params.code);
  if (!pre) return res.status(404).json({ error: 'not found' });
  if (!pre.categoryProfile || !pre.knobState) return res.status(400).json({ error: 'profile + knobs required' });
  const overridePrompt = req.body?.overridePrompt;
  const started = startJob(req.params.code, 'copy', async (p, update, log) => {
    update('生成文案 (Claude)…');
    p.state = 'GENERATING';
    const { content, products, compiled } = await generateCopy(p.formInput, p.categoryProfile!, p.knobState!, overridePrompt);
    update('信任分级校验…');
    const tg = runTrustGuard(content, products, p.formInput);
    for (const v of tg.report.hardClaimViolations) log('warn', `硬声明校验：${v.path} ${v.reason} → ${v.action}`);
    p.contentDraft = tg.content;
    p.productsDraft = tg.products;
    p.validationReport = tg.report;
    p.l2Prompts = { ...(p.l2Prompts || {}), copy: compiled };
    p.state = 'VALIDATED';
    const mods = ['stats', 'certifications', 'testimonials', 'trust', 'faq', 'cta'].filter((k) => (tg.content as any)[k]);
    log('info', `文案完成：模块 ${mods.join('、') || '(仅必填)'}`);
  });
  res.status(202).json(started);
});

app.post('/api/projects/:code/generate-images', requireAuth, (req, res) => {
  const pre = getProject(req.params.code);
  if (!pre) return res.status(404).json({ error: 'not found' });
  if (!pre.categoryProfile || !pre.knobState) return res.status(400).json({ error: 'profile + knobs required' });
  const started = startJob(req.params.code, 'images', async (p, update, log) => {
    const result = await generateImages(
      p.formInput,
      p.categoryProfile!,
      p.knobState!,
      (step, cur, total) => update(step, cur, total),
      (level, msg) => log(level, msg),
    );
    (result.failures || []).forEach((f) => log('error', `图片：${f}`));
    p.assets = result.assets;
    p.assetsVersion = nowISO();
    p.l2Prompts = { ...(p.l2Prompts || {}), images: result.compiledPrompts };
    log('info', `图片完成：${result.assets.filter((a) => a.kind !== 'style-reference').length} 张可用`);
    if (p.contentDraft) p.contentDraft.banner = '';
    if (p.productsDraft) {
      p.productsDraft.forEach((pd, i) => {
        const names = result.productImageNames[i];
        pd.images = names && names.length ? names : pd.images || [];
      });
    }
  });
  res.status(202).json(started);
});

const DEFAULT_DIRECTION =
  '在真实、专业、完全行业相关的前提下体现高大上（high-end yet authentic, strictly industry-relevant, professional, photorealistic）';

// shared autorun work (profile+segment+copy+images, resumable) — used by /autorun and /api/ext
async function autorunWork(
  p: GenerationProject,
  update: (step: string, current?: number, total?: number) => void,
  log: (level: LogEntry['level'], msg: string) => void,
): Promise<void> {
  {
    // ---- 文案链：已有文案则整段跳过（断点续传）----
    if (!p.contentDraft) {
      if (!p.categoryProfile) {
        update('推断品类画像…');
        p.categoryProfile = await profileCategory(p.formInput);
        log('info', `品类：${p.categoryProfile.categoryLabel}`);
      }
      if (!p.recommendedCombos?.length) {
        update('生成推荐组合…');
        p.recommendedCombos = await generateCombos(p.categoryProfile);
      }
      update('识别压缩包内产品…');
      const products = await segmentProducts(p.formInput, p.categoryProfile);
      p.formInput = { ...p.formInput, products };
      log('info', `识别出 ${products.length} 个产品：${products.map((x) => x.nameEn).join('、')}`);
      p.knobState = resolveKnobState(p.categoryProfile, p.recommendedCombos?.[0] ?? null, { directionNote: DEFAULT_DIRECTION });
      update('生成文案 (Claude)…');
      p.state = 'GENERATING';
      const { content, products: pr, compiled } = await generateCopy(p.formInput, p.categoryProfile, p.knobState);
      const tg = runTrustGuard(content, pr, p.formInput);
      for (const v of tg.report.hardClaimViolations) log('warn', `硬声明校验：${v.path} ${v.reason} → ${v.action}`);
      p.contentDraft = tg.content;
      p.productsDraft = tg.products;
      p.validationReport = tg.report;
      p.l2Prompts = { ...(p.l2Prompts || {}), copy: compiled };
      log('info', '文案完成，开始生成图片…');
    } else {
      log('info', '文案已存在，续传图片（只补缺失的图）…');
    }

    // 图片所需 profile / knobState（续传时已存在；异常兜底）
    const profile = p.categoryProfile ?? (await profileCategory(p.formInput));
    p.categoryProfile = profile;
    if (!p.knobState) p.knobState = resolveKnobState(profile, p.recommendedCombos?.[0] ?? null, { directionNote: DEFAULT_DIRECTION });

    // ---- 图片：复用已在磁盘的图，只补缺失 ----
    const result = await generateImages(p.formInput, profile, p.knobState, (s, c, t) => update(s, c, t), (lv, m) => log(lv, m), p.assets);
    (result.failures || []).forEach((f) => log('error', `图片：${f}`));
    p.assets = result.assets;
    p.assetsVersion = nowISO();
    p.l2Prompts = { ...(p.l2Prompts || {}), images: result.compiledPrompts };
    // store externally-reachable absolute URLs directly in the drafts
    p.productsDraft?.forEach((pd, i) => {
      const names = result.productImageNames[i] || [];
      if (names.length) pd.images = names.map((n) => publicAssetUrl(p.code, n));
    });
    const bannerAsset = result.assets.find((a) => a.kind === 'banner');
    if (p.contentDraft) p.contentDraft.banner = bannerAsset ? publicAssetUrl(p.code, bannerAsset.exportName) : '';
    p.state = 'VALIDATED';
    log('info', `✓ 完成：可用图片 ${result.assets.filter((a) => a.kind !== 'style-reference').length} 张`);
  }
}

// AUTORUN: created → straight to full generation
app.post('/api/projects/:code/autorun', requireAuth, (req, res) => {
  const pre = getProject(req.params.code);
  if (!pre) return res.status(404).json({ error: 'not found' });
  const started = startJob(req.params.code, 'auto', autorunWork);
  res.status(202).json(started);
});

// FIRST-RUN: one button → copy + all images in a single job
app.post('/api/projects/:code/generate-all', requireAuth, (req, res) => {
  const pre = getProject(req.params.code);
  if (!pre) return res.status(404).json({ error: 'not found' });
  if (!pre.categoryProfile || !pre.knobState) return res.status(400).json({ error: 'profile + knobs required' });
  const started = startJob(req.params.code, 'generate', async (p, update, log) => {
    update('生成文案 (Claude)…');
    p.state = 'GENERATING';
    const { content, products, compiled } = await generateCopy(p.formInput, p.categoryProfile!, p.knobState!);
    const tg = runTrustGuard(content, products, p.formInput);
    for (const v of tg.report.hardClaimViolations) log('warn', `硬声明校验：${v.path} ${v.reason} → ${v.action}`);
    p.contentDraft = tg.content;
    p.productsDraft = tg.products;
    p.validationReport = tg.report;
    p.l2Prompts = { ...(p.l2Prompts || {}), copy: compiled };
    log('info', '文案完成，开始生成图片…');
    const result = await generateImages(p.formInput, p.categoryProfile!, p.knobState!, (s, c, t) => update(s, c, t), (lv, m) => log(lv, m));
    (result.failures || []).forEach((f) => log('error', `图片：${f}`));
    p.assets = result.assets;
    p.assetsVersion = nowISO();
    p.l2Prompts = { ...(p.l2Prompts || {}), images: result.compiledPrompts };
    p.productsDraft.forEach((pd, i) => {
      const names = result.productImageNames[i];
      pd.images = names && names.length ? names : [];
    });
    p.state = 'VALIDATED';
    log('info', `全部完成：可用图片 ${result.assets.filter((a) => a.kind !== 'style-reference').length} 张`);
  });
  res.status(202).json(started);
});

// PLAN: turn a free-text instruction into an intent understanding + Todo list (no execution)
app.post('/api/projects/:code/plan-revision', requireAuth, async (req, res) => {
  const p = getProject(req.params.code);
  if (!p) return res.status(404).json({ error: 'not found' });
  if (!p.contentDraft) return res.status(400).json({ error: '请先完成首次生成' });
  const instruction = String(req.body?.instruction || '').trim();
  if (!instruction) return res.status(400).json({ error: '请输入修改指令' });
  try {
    const plan = await routeRevision(instruction, p.productsDraft || []);
    res.json(plan);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// LATER EDITS: a confirmed plan (or fresh route) drives selective regeneration
app.post('/api/projects/:code/revise', requireAuth, (req, res) => {
  const pre = getProject(req.params.code);
  if (!pre) return res.status(404).json({ error: 'not found' });
  if (!pre.categoryProfile || !pre.knobState || !pre.contentDraft) return res.status(400).json({ error: '请先完成首次生成' });
  const instruction = String(req.body?.instruction || '').trim();
  if (!instruction) return res.status(400).json({ error: '请输入修改指令' });
  const presetPlan = req.body?.plan && typeof req.body.plan === 'object' ? req.body.plan : null;
  const started = startJob(req.params.code, 'revise', async (p, update, log) => {
    update('解析修改指令…');
    const plan: { copy: boolean; banner: boolean; productIndexes: number[] } =
      presetPlan && (presetPlan.copy !== undefined || presetPlan.banner !== undefined || Array.isArray(presetPlan.productIndexes))
        ? {
            copy: !!presetPlan.copy,
            banner: !!presetPlan.banner,
            productIndexes: (Array.isArray(presetPlan.productIndexes) ? presetPlan.productIndexes : []).filter((x: unknown): x is number => Number.isInteger(x)),
          }
        : await routeRevision(instruction, p.productsDraft || []);
    const prevNote = p.knobState!.directionNote;
    p.knobState = { ...p.knobState!, directionNote: [prevNote, instruction].filter(Boolean).join('\n') };
    const knobs = p.knobState!;
    const parts = [plan.copy && '文案', plan.banner && 'banner', plan.productIndexes.length ? `产品图 ${plan.productIndexes.map((i) => i + 1).join(',')}` : ''].filter(Boolean);
    log('info', `指令：${instruction}`);
    log('info', `计划重做：${parts.join('、') || '(无)'}`);

    if (plan.copy) {
      update('重写文案…');
      const { content, products, compiled } = await generateCopy(p.formInput, p.categoryProfile!, knobs);
      const tg = runTrustGuard(content, products, p.formInput);
      tg.products.forEach((pd, i) => { pd.images = p.productsDraft?.[i]?.images || []; });
      for (const v of tg.report.hardClaimViolations) log('warn', `硬声明校验：${v.path} ${v.reason} → ${v.action}`);
      p.contentDraft = tg.content;
      p.productsDraft = tg.products;
      p.validationReport = tg.report;
      p.l2Prompts = { ...(p.l2Prompts || {}), copy: compiled };
      log('info', '文案已更新');
    }
    if (plan.banner) {
      update('重新生成 banner…');
      const a = await regenerateBanner(p.formInput, p.categoryProfile!, knobs, (lv, m) => log(lv, m));
      p.assets = [...(p.assets || []).filter((x) => x.kind !== 'banner'), a];
      p.assetsVersion = nowISO();
      if (p.contentDraft) p.contentDraft.banner = publicAssetUrl(p.code, a.exportName);
      // keep the L2 archive in sync with the regenerated banner
      const imgs = (p.l2Prompts?.images || []).slice();
      const comp = { label: 'Banner', text: a.prompt, trace: [], overridden: false };
      const bi = imgs.findIndex((x) => x.label === 'Banner');
      if (bi >= 0) imgs[bi] = comp; else imgs.unshift(comp);
      p.l2Prompts = { ...(p.l2Prompts || {}), images: imgs };
      if (a.qa?.needsAttention) log('warn', 'banner 需人工检查（图中疑似有文字）');
      log('info', 'banner 已更新');
    }
    if (plan.productIndexes.length) {
      const refAsset = (p.assets || []).find((x) => x.kind === 'style-reference');
      const refUri = refAsset && fs.existsSync(refAsset.localPath) ? `data:image/${refAsset.localPath.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(refAsset.localPath).toString('base64')}` : undefined;
      for (const idx of plan.productIndexes) {
        update(`重新生成产品图 ${idx + 1}…`);
        const a = await regenerateProductImage(p.formInput, p.categoryProfile!, knobs, idx, refUri);
        p.assets = [...(p.assets || []).filter((x) => !(x.kind === 'product' && x.productIndex === idx)), a];
        p.assetsVersion = nowISO();
        if (p.productsDraft?.[idx]) p.productsDraft[idx].images = [publicAssetUrl(p.code, a.exportName)];
        // sync L2 archive for this product image
        const label = `产品图: ${p.productsDraft?.[idx]?.productName || '#' + (idx + 1)}`;
        const imgs = (p.l2Prompts?.images || []).slice();
        const comp = { label, text: a.prompt, trace: [], overridden: false };
        const pi = imgs.findIndex((x) => x.label === label);
        if (pi >= 0) imgs[pi] = comp; else imgs.push(comp);
        p.l2Prompts = { ...(p.l2Prompts || {}), images: imgs };
        if (a.qa?.needsAttention) log('warn', `产品图 ${idx + 1} 需人工检查`);
      }
    }
    if (p.state === 'APPROVED' || p.state === 'EXPORTED' || p.state === 'IN_REVIEW') p.state = 'VALIDATED';
    log('info', '修改完成');
  });
  res.status(202).json(started);
});

// regenerate a single product image (§9 "regenerate this image")
app.post('/api/projects/:code/regen-image', requireAuth, async (req, res) => {
  const p = load(req, res);
  if (!p) return;
  if (!p.categoryProfile || !p.knobState) return res.status(400).json({ error: 'profile + knobs required' });
  const idx = Number(req.body?.productIndex);
  if (!Number.isInteger(idx)) return res.status(400).json({ error: 'productIndex required' });
  try {
    const refAsset = (p.assets || []).find((a) => a.kind === 'style-reference');
    const refUri = refAsset ? `data:image/png;base64,${fs.readFileSync(refAsset.localPath).toString('base64')}` : undefined;
    const asset = await regenerateProductImage(p.formInput, p.categoryProfile, p.knobState, idx, refUri);
    p.assets = [...(p.assets || []).filter((a) => !(a.kind === 'product' && a.productIndex === idx)), asset];
    p.assetsVersion = nowISO();
    if (p.productsDraft?.[idx]) p.productsDraft[idx].images = [asset.exportName];
    (p.reviewEdits ||= []).push({ at: new Date().toISOString(), kind: 'regen-image', path: `products[${idx}]` });
    res.json(saveProject(p));
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// WYSIWYG review writes back content/products drafts
app.put('/api/projects/:code/draft', requireAuth, (req, res) => {
  const p = load(req, res);
  if (!p) return;
  const { content, products, edit } = req.body as { content?: ContentData; products?: ProductData[]; edit?: ReviewEdit };
  if (content) p.contentDraft = content;
  if (products) p.productsDraft = products;
  if (edit) (p.reviewEdits ||= []).push(edit);
  if (p.state === 'VALIDATED') p.state = 'IN_REVIEW';
  res.json(saveProject(p));
});

app.get('/api/projects/:code/export-preview', requireAuth, (req, res) => {
  const p = load(req, res);
  if (!p) return;
  res.json(buildExportPayload(p));
});

// 标记完成 / 取消标记（generated → ready）
app.post('/api/projects/:code/mark-ready', requireAuth, (req, res) => {
  const p = load(req, res);
  if (!p) return;
  if (!p.contentDraft) return res.status(400).json({ error: '请先完成生成' });
  p.markedReady = req.body?.ready !== false;
  if (!p.markedReady) p.delivered = false;
  res.json(saveProject(p));
});

// 归档 / 放回（archived=true/false）。归档是唯一"移除"方式（无硬删除）；保留 updatedAt 不改变时间排序位置。
app.post('/api/projects/:code/archive', requireAuth, (req, res) => {
  const p = load(req, res);
  if (!p) return;
  p.archived = req.body?.archived !== false;
  res.json(saveProject(p, false));
});

// 修改 code（URL slug）
app.post('/api/projects/:code/rename', requireAuth, (req, res) => {
  const newCode = String(req.body?.newCode || '').trim();
  if (!newCode) return res.status(400).json({ error: 'newCode 必填' });
  try {
    res.json(renameProjectCode(req.params.code, newCode));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/projects/:code/export', requireAuth, (req, res) => {
  const p = getProject(req.params.code);
  if (!p) return res.status(404).json({ error: 'not found' });
  if (!p.markedReady) {
    return res.status(400).json({ error: '请先「标记完成」再交付/导出' });
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${p.code}.zip"`);
  exportZip(p).pipe(res);
  p.state = 'EXPORTED';
  saveProject(p);
});

// ---------------------------------------------------------------------------
// Asset serving (generated images for preview)
// ---------------------------------------------------------------------------
// ===========================================================================
// EXTERNAL INTEGRATION  /api/ext/*  (API key + optional IP allowlist)
// ===========================================================================
function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = req.header('X-API-Key');
  if (!key || !config.extApiKeys.includes(key)) return res.status(401).json({ error: 'invalid api key' });
  if (config.extIpAllowlist.length) {
    const ip = (req.ip || '').replace('::ffff:', '');
    if (!config.extIpAllowlist.includes(ip)) return res.status(403).json({ error: 'ip not allowed' });
  }
  next();
}

/** Map internal project state → external status. */
function extStatus(p: GenerationProject): string {
  if (p.job?.status === 'error') return 'failed';
  if (p.job?.status === 'running') return p.job.current != null ? 'generating' : 'accepted';
  if (!p.contentDraft || !(p.assets || []).some((a) => a.kind === 'banner')) {
    return p.job?.status === 'done' ? 'generated' : 'accepted';
  }
  if (p.delivered) return 'delivered';
  if (p.markedReady) return 'ready';
  return 'generated';
}

function extView(p: GenerationProject) {
  const st = extStatus(p);
  const j = p.job;
  let progress: unknown = null;
  if (j?.status === 'running' && j.total) {
    let eta: number | null = null;
    try {
      const el = (Date.now() - new Date(j.startedAt).getTime()) / 1000;
      if (j.current) eta = Math.max(0, Math.round((el / j.current) * (j.total - j.current)));
    } catch { /* ignore */ }
    progress = { step: j.step, current: j.current, total: j.total, eta_seconds: eta };
  }
  return {
    landingpage_id: p.landingpageId,
    campaign_id: p.campaignId,
    variant_no: p.variantNo ?? 0,
    status: st,
    deliverable: st === 'ready' || st === 'delivered',
    code: p.contentDraft ? p.code : null,
    failure_reason: j?.status === 'error' ? j.error || '生成失败' : null,
    progress,
    updated_at: p.updatedAt,
  };
}

interface ImageItem { url: string; meta?: ImageMeta }

/** 归一化 images：元素可为 URL 字符串（旧）或 { url, name_cn?, name_en?, description? }（新）。非法返回 null。 */
function normalizeImageItems(arr: unknown): ImageItem[] | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const out: ImageItem[] = [];
  for (const it of arr) {
    if (typeof it === 'string') {
      if (!it.trim()) return null;
      out.push({ url: it.trim() });
    } else if (it && typeof it === 'object' && typeof (it as any).url === 'string' && (it as any).url.trim()) {
      const o = it as any;
      const meta: ImageMeta = { nameCn: s(o.name_cn), nameEn: s(o.name_en), description: s(o.description) };
      const hasMeta = meta.nameCn || meta.nameEn || meta.description;
      out.push({ url: o.url.trim(), meta: hasMeta ? meta : undefined });
    } else {
      return null;
    }
  }
  return out;
}

/** Download a list of image items into the project's raw/ dir; 3 retries each.
 *  Returns successfully-downloaded items as {ref, description?} (description stays
 *  bound to its image even when some downloads fail). */
async function downloadImageItems(code: string, items: ImageItem[], log: (l: LogEntry['level'], m: string) => void): Promise<{ ref: string; meta?: ImageMeta }[]> {
  const dir = path.join(assetsDir(code), 'raw');
  fs.mkdirSync(dir, { recursive: true });
  const out: { ref: string; meta?: ImageMeta }[] = [];
  for (let i = 0; i < items.length; i++) {
    const { url, meta } = items[i];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const ct = r.headers.get('content-type') || '';
        const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
        const name = `dl-${i}.${ext}`;
        fs.writeFileSync(path.join(dir, name), Buffer.from(await r.arrayBuffer()));
        out.push({ ref: path.join('raw', name), meta });
        break;
      } catch (e) {
        if (attempt === 2) log('error', `图片下载失败(${i + 1}/${items.length})：${url} ${String(e)}`);
        else await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      }
    }
  }
  return out;
}

/** Background job: download images then run the full generation pipeline. */
function startExtGeneration(code: string, items: ImageItem[]): GenerationProject | null {
  return startJob(code, 'auto', async (p, update, log) => {
    update('下载产品图…');
    const results = await downloadImageItems(p.code, items, log);
    if (!results.length) throw new Error('产品图全部下载失败');
    const refs = results.map((r) => r.ref);
    p.formInput.products.forEach((pd) => { pd.rawImages = refs; });
    const meta: Record<string, ImageMeta> = {};
    for (const r of results) if (r.meta) meta[r.ref] = r.meta;
    p.formInput.imageMeta = Object.keys(meta).length ? meta : undefined;
    p.formInput.imageDescriptions = undefined; // 统一用 imageMeta
    log('info', `下载 ${refs.length} 张产品图${Object.keys(meta).length ? `（含 ${Object.keys(meta).length} 张带名称/描述）` : ''}`);
    await autorunWork(p, update, log);
  });
}

function resetForRerun(p: GenerationProject): void {
  delete p.contentDraft;
  delete p.productsDraft;
  delete p.assets;
  delete p.l2Prompts;
  delete p.categoryProfile;
  delete p.recommendedCombos;
  delete p.knobState;
  delete p.validationReport;
  p.markedReady = false;
  p.delivered = false;
  saveProject(p);
}

// 创建落地页任务
app.post('/api/ext/landingpages', requireApiKey, (req, res) => {
  const b = req.body || {};
  for (const k of ['campaign_id', 'industry', 'product_desc', 'product_name_cn', 'product_name_en', 'merchant_name', 'nickname']) {
    if (!b[k] || typeof b[k] !== 'string') return res.status(422).json({ error: `字段缺失或非法: ${k}` });
  }
  if (typeof b.is_variant !== 'boolean') return res.status(422).json({ error: '字段缺失: is_variant (boolean)' });
  // images：向后兼容 —— 每个元素可为字符串 URL（旧）或 { url, description? }（新）
  const imageItems = normalizeImageItems(b.images);
  if (!imageItems) return res.status(422).json({ error: '字段非法: images 须为非空数组，元素为 URL 字符串或 {url, description?}' });
  const campaignId = String(b.campaign_id);
  const isVariant = b.is_variant === true;
  const echo = {
    merchant_name: b.merchant_name, nickname: b.nickname,
    exclude_region: b.exclude_region, task_type: b.task_type,
    ...(b.extra && typeof b.extra === 'object' ? b.extra : {}),
  };

  // 主落地页：幂等保护
  if (!isVariant) {
    const main = findCampaignMain(campaignId);
    if (main) {
      const st = extStatus(main);
      if (st === 'generating' || st === 'accepted') return res.status(409).json({ error: '该投放任务正在生成中，请勿重复创建', status: st });
      if (st === 'failed') {
        main.echo = echo;
        main.apiPayload = b; // 接口收到的完整 payload（排查用）
        resetForRerun(main);
        startExtGeneration(main.code, imageItems);
        return res.status(202).json({ landingpage_id: main.landingpageId, campaign_id: campaignId, variant_no: main.variantNo ?? 0, status: 'accepted', created: false });
      }
      return res.status(200).json({ landingpage_id: main.landingpageId, campaign_id: campaignId, variant_no: main.variantNo ?? 0, status: st, created: false });
    }
  }

  const variantNo = isVariant ? findByCampaign(campaignId).reduce((m, x) => Math.max(m, x.variantNo ?? 0), -1) + 1 : 0;
  const form: FormInput = {
    code: '', categoryHint: b.industry, companyIntroCn: '', productFeaturesCn: b.product_desc, useScenariosCn: '',
    products: [{ nameCn: b.product_name_cn, nameEn: b.product_name_en, sellingPointCn: b.product_desc, rawImages: [] }],
  };
  const p = createProject(form, { campaignId, isVariant, variantNo, echo, fallback: 'lp-' + campaignId });
  p.apiPayload = b; // 接口收到的完整 payload（排查用）
  saveProject(p);
  startExtGeneration(p.code, imageItems);
  res.status(202).json({ landingpage_id: p.landingpageId, campaign_id: campaignId, variant_no: variantNo, status: 'accepted', created: true });
});

// 批量查询状态
app.post('/api/ext/landingpages/status', requireApiKey, (req, res) => {
  const ids = req.body?.campaign_ids;
  if (!Array.isArray(ids)) return res.status(422).json({ error: 'campaign_ids 必填(数组)' });
  if (ids.length > 100) return res.status(422).json({ error: '单次最多 100 个 campaign_id' });
  const results: Record<string, unknown[]> = {};
  for (const cid of ids.map(String)) results[cid] = findByCampaign(cid).map(extView);
  res.json({ results });
});

// 交付
app.get('/api/ext/landingpages/:lpid/delivery', requireApiKey, (req, res) => {
  const p = getByLandingpageId(req.params.lpid);
  if (!p) return res.status(404).json({ error: 'not found' });
  const st = extStatus(p);
  if (st !== 'ready' && st !== 'delivered') return res.status(409).json({ error: '尚未标记完成，暂不可交付', status: st });
  const payload = buildExportPayload(p);
  if (!p.delivered) { p.delivered = true; saveProject(p); }
  res.json({ content: payload.content, products: payload.productsShell });
});

// PUBLIC asset serving — no auth, for externally-reachable image URLs in exported JSON
app.get('/public/assets/:code/*', (req, res) => {
  const rel = (req.params as any)[0] as string;
  const base = path.resolve(path.join(config.dataDir, 'assets'));
  const resolved = path.resolve(path.join(assetsDir(req.params.code), rel));
  if (!resolved.startsWith(base + path.sep)) return res.status(403).end();
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(resolved);
});

app.get('/assets/:code/*', requireAuth, (req, res) => {
  const rel = (req.params as any)[0] as string;
  const full = path.join(assetsDir(req.params.code), rel);
  if (!full.startsWith(path.join(config.dataDir, 'assets'))) return res.status(403).end();
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full);
});

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------
const webDist = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/assets')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

/** On boot, reset any job left 'running' by a previous process (interrupted by restart). */
function resetStaleJobs(): void {
  for (const s of listProjects()) {
    const p = getProject(s.code);
    if (p?.job?.status === 'running') {
      p.job = { ...p.job, status: 'error', step: '已中断（服务重启）', error: 'interrupted by server restart', finishedAt: nowISO() };
      if (!p.logs) p.logs = [];
      p.logs.push({ at: nowISO(), level: 'warn', msg: '⚠ 上次任务因服务重启被中断，请重新点击生成' });
      saveProject(p);
    }
  }
}

resetStaleJobs();
app.listen(config.port, () => {
  console.log(`EaseSourcer server on http://127.0.0.1:${config.port} (relay ${config.relayUrl})`);
});
