/**
 * ImagePipeline (PRD §7) — Nano Banana Pro (gemini-3-pro-image).
 * - style-reference: text-to-image, fixes layout per product group.
 * - product: image-to-image (reference + customer raw photo) — body from raw,
 *   style from reference. Strength via i2iStrength.
 * - banner: text-to-image scene (16:9, no text).
 * Deterministic template assembly (§7.2); LLM only distills the SUBJECT line.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chatText, generateImage } from '../aigw/client.js';
import { assetsDir } from '../store/projects.js';
import { collectImageBlocks } from './promptforge.js';
import type {
  AssetQAResult,
  CategoryProfile,
  CompiledPrompt,
  FormInput,
  GeneratedAsset,
  KnobState,
} from '../types.js';

const STYLE_BLOCK = 'professional product photography, high resolution, sharp focus, commercial catalog quality';
const NEGATIVE_BLOCK = 'no text, no watermark, no logo, no distorted shapes, no extra objects, no gibberish lettering';

// ---------------------------------------------------------------------------
// Product grouping (§7.4)
// ---------------------------------------------------------------------------
export interface ProductGroup {
  id: string;
  productIndexes: number[];
}

export function groupProducts(_profile: CategoryProfile, form: FormInput): ProductGroup[] {
  // All products share ONE style reference → uniform catalog look + fewer image calls
  // (1 banner + 1 reference + N product images). Each product's body still comes from
  // its own raw photo via i2i; only the layout/background/lighting is shared.
  return [{ id: 'g1', productIndexes: form.products.map((_, i) => i) }];
}

// ---------------------------------------------------------------------------
// SUBJECT distillation (the only LLM task in the image line, §7.1)
// ---------------------------------------------------------------------------
export async function distillSubjects(form: FormInput, profile: CategoryProfile): Promise<string[]> {
  const list = form.products
    .map((p, i) => `[${i}] EN="${p.nameEn}" CN="${p.nameCn}"${p.sellingPointCn ? ` selling="${p.sellingPointCn}"` : ''}`)
    .join('\n');
  const sys = `You write concise English SUBJECT descriptions for product photography prompts.
Given a product and the category's conventional presentation, output ONE short English noun
phrase (<=20 words) describing the physical subject to photograph — the object itself, not
marketing. No sentences, no quotes. Category presentation guide: "${profile.visualConventions.subjectPresentation}".
Output STRICT JSON: an array of strings, one per product, SAME ORDER.`;
  try {
    const raw = await chatText(
      [
        { role: 'system', content: sys },
        { role: 'user', content: `Products:\n${list}\nReturn a JSON array of ${form.products.length} subject strings.` },
      ],
      { maxTokens: 600, temperature: 0.3 },
    );
    const arr = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] || '[]');
    if (Array.isArray(arr) && arr.length === form.products.length) return arr.map(String);
  } catch {
    /* fall through to default */
  }
  return form.products.map((p) => `${p.nameEn}, ${profile.visualConventions.subjectPresentation}`);
}

// ---------------------------------------------------------------------------
// Prompt assembly (§7.2)
// ---------------------------------------------------------------------------
function assembleProductPrompt(subject: string, knobs: KnobState, tech: string): { text: string; compiled: CompiledPrompt } {
  const { blocks, trace } = collectImageBlocks(knobs);
  const parts: string[] = [`[SUBJECT] ${subject}`];
  for (const b of blocks) parts.push(`[${b.tag}] ${b.text}`);
  if (knobs.brandColor) parts.push(`[COLOR] brand accent color ${knobs.brandColor}`);
  if (knobs.directionNote?.trim()) parts.push(`[DIRECTION] operator instructions (HIGH PRIORITY, follow these): ${knobs.directionNote.trim()}`);
  parts.push(`[STYLE] ${STYLE_BLOCK}`);
  parts.push(`[NEGATIVE] ${NEGATIVE_BLOCK}`);
  parts.push(`[TECH] ${tech}`);
  const text = parts.join('\n');
  return { text, compiled: { text, trace, overridden: false } };
}

/** Ask the LLM for an industry-accurate, photorealistic banner scene description. */
export async function distillBannerScene(form: FormInput, profile: CategoryProfile, knobs: KnobState): Promise<string> {
  const sceneHint = bannerSceneBlock(knobs.bannerScene);
  const sys = `You write the SCENE description for the hero banner of a B2B export landing page.
RULES (critical):
- Choose the scene that best represents the category's CORE PRODUCTION / MANUFACTURING activity — the actual factory floor where the product is MADE.
  Examples: "CNC precision machining" → "a real CNC machining workshop floor with multi-axis CNC milling machines actively cutting metal parts, metal shavings and coolant mist, industrial overhead lighting"; "bulk chemical / nutraceutical raw material" → "a real pharmaceutical-grade production plant with stainless-steel reactors, piping and clean industrial flooring".
- The "scene tendency" is only a weak hint. If it conflicts with the core production floor (e.g. tendency says 'lab/quality-control' but the product is machined/manufactured), PREFER the core production/manufacturing floor — do NOT default to a laboratory or QC inspection room unless the category is genuinely lab/testing based.
- NEVER depict an unrelated industry.
- Photorealistic, believable, true to the trade — high-end and professional but authentic, NOT staged or fake.
- No text/signage.
- Output ONE English scene sentence (<= 40 words). No quotes, no explanation.`;
  const note = knobs.directionNote?.trim();
  const user = [
    `Category: ${profile.categoryLabel}`,
    `Products: ${form.products.map((p) => p.nameEn).join(', ')}`,
    `Scene tendency (weak hint only): ${sceneHint}`,
    note ? `Operator instruction (HIGHEST priority — the scene MUST reflect this): ${note}` : '',
    'Write the scene sentence.',
  ].filter(Boolean).join('\n');
  try {
    const out = await chatText([{ role: 'system', content: sys }, { role: 'user', content: user }], { maxTokens: 120, temperature: 0.4 });
    const s = out.trim().replace(/^["'`\s]+|["'`\s]+$/g, '');
    if (s) return s;
  } catch {
    /* fall through */
  }
  return `a real, photorealistic ${profile.categoryLabel} production environment, ${sceneHint}`;
}

function assembleBannerPrompt(knobs: KnobState, profile: CategoryProfile, scene: string): { text: string; compiled: CompiledPrompt } {
  const colorBlock = imageColor(knobs);
  const parts = [
    `[SCENE] ${scene}`,
    `[TOP PRIORITY] Photorealism and INDUSTRY RELEVANCE are the most important goals. This image MUST look like a real, authentic photograph of an actual ${profile.categoryLabel} facility/scene — never an unrelated industry, never a generic lab. High-end and professional, but believable and true to the trade.`,
    `[STYLE] ultra-photorealistic documentary photograph of a real ${profile.categoryLabel} environment, natural realistic lighting, high detail, shallow depth of field, premium and clean`,
    `[COLOR] ${colorBlock}${knobs.brandColor ? `, subtle brand accent ${knobs.brandColor}` : ''}`,
    ...(knobs.directionNote?.trim() ? [`[DIRECTION] operator instructions (HIGH PRIORITY): ${knobs.directionNote.trim()}`] : []),
    `[NEGATIVE] no text, no watermark, no logo, no captions, NOT an unrelated industry, no generic laboratory unless truly relevant, no illustration, no 3d render, no cartoon, no fantasy, no people posing or staring at the camera`,
    `[TECH] 16:9 aspect ratio, 1920x1080, wide cinematic establishing shot`,
  ];
  const text = parts.join('\n');
  const trace = [{ knobKey: 'bannerScene', chosenValue: knobs.bannerScene, templateBlockId: `bannerScene.${knobs.bannerScene}` }];
  return { text, compiled: { label: 'Banner', text, trace, overridden: false } };
}

function bannerSceneBlock(scene: KnobState['bannerScene']): string {
  const map: Record<KnobState['bannerScene'], string> = {
    lab: 'modern laboratory / quality-control environment, clean and clinical',
    'production-line': 'modern production line / factory floor with machinery and process',
    warehouse: 'organized warehouse with stacked goods and logistics activity',
    application: 'real-world application scene showing the product category in use',
    'abstract-brand': 'abstract premium brand backdrop, clean geometric composition',
  };
  return map[scene];
}
function imageColor(knobs: KnobState): string {
  const map: Record<KnobState['colorMood'], string> = {
    'cool-pro': 'cool professional palette, blues and neutral grays',
    'warm-vivid': 'warm vivid inviting palette',
    'dark-premium': 'dark premium palette with selective highlights',
    'clean-bright': 'clean bright high-key palette',
  };
  return map[knobs.colorMood];
}

// ---------------------------------------------------------------------------
// PNG dimensions + QA (§7.6)
// ---------------------------------------------------------------------------
export function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  // PNG signature + IHDR
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function qaAsset(kind: GeneratedAsset['kind'], buf: Buffer, dataUri: string): Promise<AssetQAResult> {
  const dim = pngDimensions(buf);
  const sizeKB = buf.length / 1024;
  let dimensionOk = true;
  if (kind === 'banner' && dim) {
    const ratio = dim.width / dim.height;
    dimensionOk = Math.abs(ratio - 16 / 9) < 0.15; // ~16:9
  }
  // best-effort text detection via vision model (no hard dependency on OCR libs)
  let hasUnexpectedText = false;
  try {
    const ans = await chatText(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Does this image contain any readable text, letters, words, or watermark? Answer strictly YES or NO.' },
            { type: 'image_url', image_url: { url: dataUri } },
          ] as unknown as string,
        },
      ],
      { maxTokens: 5, temperature: 0 },
    );
    hasUnexpectedText = /yes/i.test(ans);
  } catch {
    /* QA text check best-effort */
  }
  const needsAttention = hasUnexpectedText || !dimensionOk || (kind === 'banner' && sizeKB > 500);
  return { hasUnexpectedText, dimensionOk, needsAttention };
}

// ---------------------------------------------------------------------------
// Asset persistence
// ---------------------------------------------------------------------------
function fileToDataUri(p: string): string {
  const buf = fs.readFileSync(p);
  const ext = path.extname(p).toLowerCase().replace('.', '') || 'png';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
  return `data:${mime};base64,${buf.toString('base64')}`;
}

const STRICT_NO_TEXT =
  '\n[STRICT] The image MUST contain absolutely NO text, letters, words, numbers, captions, labels, logos or signage anywhere — a clean photographic scene only.';

/** Compress to JPEG under ~480KB, resized for its role (banner 16:9, others 1:1). */
export async function compressImage(buf: Buffer, role: 'banner' | 'product' | 'ref'): Promise<Buffer> {
  const [w, h] = role === 'banner' ? [1920, 1080] : [1024, 1024];
  let q = 84;
  const render = (quality: number) => sharp(buf).resize(w, h, { fit: 'cover' }).jpeg({ quality, mozjpeg: true }).toBuffer();
  let out = await render(q);
  while (out.length > 480 * 1024 && q > 50) {
    q -= 8;
    out = await render(q);
  }
  return out;
}

/** Generate a banner; if QA detects text, regenerate once with a stricter no-text prompt. */
async function generateBannerGuarded(promptText: string, onLog?: LogFn): Promise<{ buffer: Buffer; dataUri: string; qa: AssetQAResult }> {
  let img = await generateImage(promptText);
  let qa = await qaAsset('banner', img.buffer, img.dataUri);
  if (qa.hasUnexpectedText) {
    onLog?.('warn', 'banner 图中检测到文字，自动重新生成一次…');
    img = await generateImage(promptText + STRICT_NO_TEXT);
    qa = await qaAsset('banner', img.buffer, img.dataUri);
  }
  return { buffer: img.buffer, dataUri: img.dataUri, qa };
}

function saveAsset(code: string, exportName: string, buf: Buffer): string {
  const dir = assetsDir(code);
  // preserve the relative path (e.g. "images/banner.png") so it matches how the
  // asset is served (GET /assets/:code/images/...) and exported (zip name).
  const full = path.join(dir, exportName);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  return full;
}

/** Resolve a raw image reference to a data URI; tolerant of missing files. */
function resolveRawImage(code: string, ref: string): string | null {
  const candidates = [ref, path.join(assetsDir(code), 'raw', path.basename(ref)), path.join(assetsDir(code), path.basename(ref))];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return fileToDataUri(c);
    } catch {
      /* ignore */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Top-level generation
// ---------------------------------------------------------------------------
export interface ImageResult {
  assets: GeneratedAsset[];
  bannerExportName: string;
  /** map productIndex -> exportNames for the product's images (first is main) */
  productImageNames: Record<number, string[]>;
  compiledPrompts: CompiledPrompt[];
  /** per-asset failure messages (job still succeeds if at least one image was produced) */
  failures?: string[];
}

export type ProgressFn = (step: string, current: number, total: number) => void;
export type LogFn = (level: 'info' | 'warn' | 'error', msg: string) => void;

export async function generateImages(
  form: FormInput,
  profile: CategoryProfile,
  knobs: KnobState,
  onProgress?: ProgressFn,
  onLog?: LogFn,
  resumeAssets?: GeneratedAsset[],
): Promise<ImageResult> {
  const assets: GeneratedAsset[] = [];
  const compiledPrompts: CompiledPrompt[] = [];
  const productImageNames: Record<number, string[]> = {};

  const groups = groupProducts(profile, form);
  const total = 1 + groups.length + form.products.length; // banner + refs + products
  let done = 0;
  const tick = (step: string) => onProgress?.(step, ++done, total);
  const failures: string[] = [];

  // resume support: reuse an existing asset whose file is still on disk (skip regeneration)
  const reuse = (pred: (a: GeneratedAsset) => boolean): GeneratedAsset | undefined =>
    (resumeAssets || []).find((a) => {
      try {
        return pred(a) && !!a.localPath && fs.existsSync(a.localPath);
      } catch {
        return false;
      }
    });

  // 1) banner — reuse if already on disk, else generate (text-guard + compress)
  const bannerName = 'images/banner.jpg';
  const exB = reuse((a) => a.kind === 'banner');
  if (exB) {
    assets.push(exB);
    compiledPrompts.push({ label: 'Banner', text: exB.prompt, trace: [], overridden: false });
    onLog?.('info', 'banner 已存在，跳过');
    tick('banner 已存在');
  } else {
    const bannerScene = await distillBannerScene(form, profile, knobs);
    const banner = assembleBannerPrompt(knobs, profile, bannerScene);
    compiledPrompts.push(banner.compiled);
    try {
      const bres = await generateBannerGuarded(banner.text, onLog);
      const jbuf = await compressImage(bres.buffer, 'banner');
      const bannerPath = saveAsset(form.code, bannerName, jbuf);
      const qa: AssetQAResult = { hasUnexpectedText: bres.qa.hasUnexpectedText, dimensionOk: true, needsAttention: bres.qa.hasUnexpectedText };
      assets.push({ kind: 'banner', localPath: bannerPath, exportName: bannerName, prompt: banner.text, qa });
      if (qa.needsAttention) onLog?.('warn', 'banner 重生成后仍疑似有文字，请人工确认');
    } catch (e) {
      failures.push(`banner: ${String(e)}`);
      onLog?.('error', `banner 生成失败：${String(e)}`);
    }
    tick('banner 已处理');
  }

  // 2) subjects (groups computed above)
  const subjects = await distillSubjects(form, profile);

  // 3) per group: style reference (text-to-image), then i2i each product
  for (const group of groups) {
    const repIdx = group.productIndexes[0];
    let refDataUri: string | null = null;
    const exR = reuse((a) => a.kind === 'style-reference' && a.groupId === group.id);
    if (exR) {
      assets.push(exR);
      compiledPrompts.push({ label: `参考图 (${group.id})`, text: exR.prompt, trace: [], overridden: false });
      try { refDataUri = fileToDataUri(exR.localPath); } catch { /* ignore */ }
      onLog?.('info', `参考图 ${group.id} 已存在，跳过`);
      tick(`参考图 ${group.id} 已存在`);
    } else {
      const refPrompt = assembleProductPrompt(subjects[repIdx], knobs, 'square 1:1 product photo, consistent layout reference');
      compiledPrompts.push({ ...refPrompt.compiled, label: `参考图 (${group.id})` });
      try {
        const refImg = await generateImage(refPrompt.text);
        const jbuf = await compressImage(refImg.buffer, 'ref');
        const refName = `images/_ref-${group.id}.jpg`;
        const refPath = saveAsset(form.code, refName, jbuf);
        refDataUri = `data:image/jpeg;base64,${jbuf.toString('base64')}`;
        assets.push({ kind: 'style-reference', groupId: group.id, localPath: refPath, exportName: refName, prompt: refPrompt.text, qa: { hasUnexpectedText: false, dimensionOk: true, needsAttention: false } });
      } catch (e) {
        failures.push(`reference ${group.id}: ${String(e)}`);
        onLog?.('error', `参考图 ${group.id} 生成失败：${String(e)}`);
      }
      tick(`参考图 ${group.id} 已处理`);
    }

    // one polished image per product (i2i from its representative raw photo); isolated failures
    for (const idx of group.productIndexes) {
      const exP = reuse((a) => a.kind === 'product' && a.productIndex === idx);
      if (exP) {
        assets.push(exP);
        productImageNames[idx] = [exP.exportName];
        compiledPrompts.push({ label: `产品图: ${form.products[idx].nameEn}`, text: exP.prompt, trace: [], overridden: false });
        onLog?.('info', `产品图 ${idx + 1} 已存在，跳过`);
        tick(`产品图 ${idx + 1}/${form.products.length} 已存在`);
        continue;
      }
      const subject = subjects[idx];
      const prodPrompt = assembleProductPrompt(subject, knobs, 'square 1:1 product photo');
      const fullPrompt = `${i2iInstructionFor(knobs)}\n${prodPrompt.text}`;
      compiledPrompts.push({ ...prodPrompt.compiled, text: fullPrompt, label: `产品图: ${form.products[idx].nameEn}` });
      try {
        const rawRef = (form.products[idx].rawImages || [])[0];
        const rawUri = rawRef ? resolveRawImage(form.code, rawRef) : null;
        const inputs = [...(refDataUri ? [refDataUri] : []), ...(rawUri ? [rawUri] : [])];
        const prodImg = await generateImage(fullPrompt, inputs);
        const qa = await qaAsset('product', prodImg.buffer, prodImg.dataUri);
        const jbuf = await compressImage(prodImg.buffer, 'product');
        const exportName = `images/product-${idx + 1}.jpg`;
        const prodPath = saveAsset(form.code, exportName, jbuf);
        productImageNames[idx] = [exportName];
        assets.push({ kind: 'product', groupId: group.id, productIndex: idx, localPath: prodPath, exportName, prompt: fullPrompt, qa: { ...qa, dimensionOk: true, needsAttention: qa.hasUnexpectedText } });
        if (qa.hasUnexpectedText) onLog?.('warn', `产品图 ${idx + 1} 疑似有文字，请人工确认`);
      } catch (e) {
        failures.push(`product ${idx + 1}: ${String(e)}`);
        onLog?.('error', `产品图 ${idx + 1} 生成失败：${String(e)}`);
      }
      tick(`产品图 ${idx + 1}/${form.products.length} 已处理`);
    }
  }

  // if EVERY image failed, surface an error so the job is marked failed
  if (assets.length === 0) {
    throw new Error(`所有图片生成失败：${failures.slice(0, 3).join(' | ')}`);
  }
  return { assets, bannerExportName: bannerName, productImageNames, compiledPrompts, failures };
}

function i2iInstructionFor(knobs: KnobState): string {
  const strength: Record<KnobState['i2iStrength'], string> = {
    'high-fidelity': 'Preserve the real product from the SECOND image with maximum fidelity — exact shape, proportions and label.',
    medium: 'Keep the product from the SECOND image clearly recognizable and true.',
    low: 'Use the SECOND image loosely for the product form.',
  };
  return [
    'You are compositing one product photo for a catalog grid. The FIRST image is the STYLE & BACKGROUND reference; the SECOND image is the real product.',
    'CRITICAL FOR CONSISTENCY: the output background, surface, backdrop color, lighting and composition MUST EXACTLY match the FIRST reference image, so every product photo in this set looks visually identical in style. Do NOT keep the SECOND image\'s original background, lighting or surface — discard them and use the reference\'s.',
    `Replace ONLY the product object using the SECOND image. ${strength[knobs.i2iStrength]}`,
  ].join(' ');
}

/** Regenerate only the banner (scene image) — text-guard + compress to JPEG. */
export async function regenerateBanner(form: FormInput, profile: CategoryProfile, knobs: KnobState, onLog?: LogFn): Promise<GeneratedAsset> {
  const scene = await distillBannerScene(form, profile, knobs);
  const banner = assembleBannerPrompt(knobs, profile, scene);
  const bres = await generateBannerGuarded(banner.text, onLog);
  const jbuf = await compressImage(bres.buffer, 'banner');
  const exportName = 'images/banner.jpg';
  const localPath = saveAsset(form.code, exportName, jbuf);
  return {
    kind: 'banner',
    localPath,
    exportName,
    prompt: banner.text,
    qa: { hasUnexpectedText: bres.qa.hasUnexpectedText, dimensionOk: true, needsAttention: bres.qa.hasUnexpectedText },
  };
}

/** Regenerate a single product image (for the §9 "regenerate this image" action). */
export async function regenerateProductImage(
  form: FormInput,
  profile: CategoryProfile,
  knobs: KnobState,
  productIndex: number,
  referenceDataUri?: string,
): Promise<GeneratedAsset> {
  const subjects = await distillSubjects(form, profile);
  const prodPrompt = assembleProductPrompt(subjects[productIndex], knobs, 'square 1:1 product photo');
  const fullPrompt = `${i2iInstructionFor(knobs)}\n${prodPrompt.text}`;
  const rawRef = form.products[productIndex].rawImages?.[0];
  const rawUri = rawRef ? resolveRawImage(form.code, rawRef) : null;
  const inputs = [...(referenceDataUri ? [referenceDataUri] : []), ...(rawUri ? [rawUri] : [])];
  const img = await generateImage(fullPrompt, inputs);
  const qa = await qaAsset('product', img.buffer, img.dataUri);
  const jbuf = await compressImage(img.buffer, 'product');
  const exportName = `images/product-${productIndex + 1}.jpg`;
  const localPath = saveAsset(form.code, exportName, jbuf);
  return {
    kind: 'product',
    productIndex,
    localPath,
    exportName,
    prompt: fullPrompt,
    qa: { ...qa, dimensionOk: true, needsAttention: qa.hasUnexpectedText },
  };
}
