/**
 * Product segmentation — turns the uploaded photos into a bounded product list.
 *
 * 解耦"理解"与"产出"：
 *  - 理解：尽量多喂图（缩小 + 均匀采样，最多 MAX_VISION_IMAGES 张）让模型看清产品范围；
 *  - 产出：产品数 = 真实识别出的不同产品数，封顶 MAX_PRODUCTS；同一产品的多角度图 → 1 个产品（不凑克隆）。
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chatJSON } from '../aigw/client.js';
import { config } from '../config.js';
import { assetsDir } from '../store/projects.js';
import type { CategoryProfile, FormInput, FormProductInput } from '../types.js';
import { imageMetaLine, imageMetaOf } from '../types.js';

// 喂给视觉模型理解用的图片数上限（均匀采样）/ 产出产品数上限：均可经 .env 调整（聚合页调高）
const MAX_VISION_IMAGES = config.maxVisionImages;
const MAX_PRODUCTS = config.maxProducts;
const VISION_MAX_DIM = 512;    // 喂模型前缩小，降低 token/延迟，使"多喂图"可行

async function rawToDataUri(code: string, ref: string): Promise<string | null> {
  const candidates = [path.join(assetsDir(code), ref), path.join(assetsDir(code), 'raw', path.basename(ref)), ref];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        const buf = await sharp(fs.readFileSync(c))
          .resize(VISION_MAX_DIM, VISION_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 72 })
          .toBuffer();
        return `data:image/jpeg;base64,${buf.toString('base64')}`;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** 在 n 张图里均匀取最多 max 张的下标（覆盖全程，而不是只取前几张）。 */
function sampleIndexes(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let k = 0; k < max; k++) out.push(Math.round((k * (n - 1)) / (max - 1)));
  return [...new Set(out)];
}

interface SegEntry {
  nameEn: string;
  nameCn: string;
  sellingPointCn?: string;
  imageIndexes: number[];
}

const SYS = `You are a B2B export product-catalog builder. You are given a product CATEGORY, a
short DESCRIPTION, a PRIMARY product name, and a set of the supplier's product PHOTOS
(indexed from 0). Build the product list for a Google-Ads landing page.

RULES:
1. Examine the photos and identify VISUALLY DISTINCT products.
2. If MULTIPLE distinct products are visible, output ONE entry per distinct product
   (up to the MAX PRODUCTS limit stated in the user message); assign each product the
   photo indexes that show it.
3. If ALL photos are clearly the SAME product (just different angles / lighting / packaging /
   close-ups), output EXACTLY ONE product. Do NOT invent fake grades or variants. Assign all
   relevant photo indexes to that single product.
4. Use the PHOTOS as the primary signal. The primary name and any user-provided per-photo
   metadata (name_en / name_cn / desc) are references — names may be casual/imprecise, so
   refine them into clean credible product names; never ignore them; do NOT invent numeric
   specs, CAS numbers, or model numbers.
5. Names: nameEn (English) + nameCn (Chinese), specific and credible. sellingPointCn: a short
   Chinese selling phrase (optional).
6. Output STRICT JSON: an array of objects
   { "nameEn": string, "nameCn": string, "sellingPointCn": string, "imageIndexes": number[] }.
   No prose, no markdown.`;

export async function segmentProducts(form: FormInput, profile: CategoryProfile): Promise<FormProductInput[]> {
  const primary = form.products[0];
  // 以全部输入图为准（allRawImages 为权威全集；兼容旧任务取 primary.rawImages）
  const allRaw = (form.allRawImages && form.allRawImages.length ? form.allRawImages : primary?.rawImages) || [];
  // 每任务产品数上限：调优时可设 targetProductCount（逐任务），且硬约束 ≤ 上传图片数；
  // 未设则用全局默认 MAX_PRODUCTS。
  const effectiveMax = Math.max(
    1,
    allRaw.length > 0
      ? Math.min(form.targetProductCount || MAX_PRODUCTS, allRaw.length)
      : form.targetProductCount || MAX_PRODUCTS,
  );
  const pick = sampleIndexes(allRaw.length, MAX_VISION_IMAGES);
  const uris: string[] = [];
  const uriRefIndex: number[] = []; // maps vision image index -> index into allRaw
  for (const i of pick) {
    const u = await rawToDataUri(form.code, allRaw[i]);
    if (u) {
      uris.push(u);
      uriRefIndex.push(i);
    }
  }

  const metaByRef = imageMetaOf(form);
  const hasMeta = uris.some((_, v) => imageMetaLine(metaByRef[allRaw[uriRefIndex[v]]]));
  const userText = [
    `CATEGORY: ${form.categoryHint || profile.categoryLabel}`,
    `DESCRIPTION: ${form.productFeaturesCn || primary?.sellingPointCn || ''}`,
    `PRIMARY PRODUCT: ${primary?.nameEn} / ${primary?.nameCn}`,
    `MAX PRODUCTS: output AT MOST ${effectiveMax} product(s). Never exceed this number.`,
    allRaw.length > uris.length ? `(${allRaw.length} photos uploaded in total; ${uris.length} representative ones shown below.)` : '',
    hasMeta
      ? `Each photo below may carry USER-PROVIDED metadata (name_en / name_cn / desc) — a STRONG reference you MUST consider; names may be casual, refine them into clean ones, never ignore them.`
      : '',
    uris.length > 0
      ? `There are ${uris.length} photos (indexes 0..${uris.length - 1}). Identify distinct products per the rules.`
      : `No photos available. Output ONE product based on the primary name (use empty imageIndexes).`,
  ].filter(Boolean).join('\n');

  // interleave each image with its (optional) user-provided metadata
  const parts: unknown[] = [{ type: 'text', text: userText }];
  uris.forEach((url, v) => {
    const line = imageMetaLine(metaByRef[allRaw[uriRefIndex[v]]]);
    parts.push({ type: 'text', text: `[Photo ${v}]${line ? ` user-provided: ${line}` : ''}` });
    parts.push({ type: 'image_url', image_url: { url } });
  });
  const content: unknown = uris.length > 0 ? parts : userText;

  let entries: SegEntry[] = [];
  try {
    entries = await chatJSON<SegEntry[]>(
      [
        { role: 'system', content: SYS },
        { role: 'user', content },
      ],
      { maxTokens: 1500, temperature: 0.4 },
    );
  } catch {
    entries = [];
  }
  if (!Array.isArray(entries)) entries = [];

  // map back to FormProductInput, resolving image indexes to the original rawImages refs
  const products: FormProductInput[] = entries
    .filter((e) => e && (e.nameEn || e.nameCn))
    .slice(0, effectiveMax)
    .map((e) => {
      const idxs = Array.isArray(e.imageIndexes) ? e.imageIndexes : [];
      const rawImages = idxs
        .map((vi) => uriRefIndex[vi])
        .filter((ri) => ri != null)
        .map((ri) => allRaw[ri!]);
      return {
        nameEn: (e.nameEn || e.nameCn || primary?.nameEn || 'Product').trim(),
        nameCn: (e.nameCn || e.nameEn || primary?.nameCn || '').trim(),
        sellingPointCn: e.sellingPointCn?.trim() || form.productFeaturesCn,
        rawImages: rawImages.length ? rawImages : allRaw.slice(0, 1),
      };
    });

  // 至少 1 个产品（不再凑等级变体）
  if (products.length === 0) {
    products.push({
      nameEn: (primary?.nameEn || 'Product').trim(),
      nameCn: (primary?.nameCn || '').trim(),
      sellingPointCn: form.productFeaturesCn,
      rawImages: allRaw.length ? allRaw : [],
    });
  }

  return products;
}
