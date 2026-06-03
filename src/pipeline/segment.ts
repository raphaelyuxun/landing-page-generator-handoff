/**
 * Product segmentation — turns the single intake (category + primary name +
 * uploaded image zip) into 3-4+ distinct products by looking at the photos.
 *
 * Rules (per operator request):
 *  - If the images clearly show MANY distinct products → keep as many as possible.
 *  - If few/similar products → still produce at least 3 (plausible variants/grades).
 */
import fs from 'node:fs';
import path from 'node:path';
import { chatJSON } from '../aigw/client.js';
import { assetsDir } from '../store/projects.js';
import type { CategoryProfile, FormInput, FormProductInput } from '../types.js';
import { imageMetaLine, imageMetaOf } from '../types.js';

const MAX_VISION_IMAGES = 8;
const MIN_PRODUCTS = 3;
const MAX_PRODUCTS = 8;

function rawToDataUri(code: string, ref: string): string | null {
  const candidates = [path.join(assetsDir(code), ref), path.join(assetsDir(code), 'raw', path.basename(ref)), ref];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        const ext = path.extname(c).toLowerCase().replace('.', '') || 'png';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
        return `data:${mime};base64,${fs.readFileSync(c).toString('base64')}`;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
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
2. If 3 or more distinct products are visible, output one entry per distinct product
   (up to ${MAX_PRODUCTS}); assign each product the indexes of the photos that show it.
3. If fewer than 3 distinct products are visible (the photos are the same/similar item),
   output AT LEAST ${MIN_PRODUCTS} entries by distinguishing credible VARIANTS of the primary
   product that are conventional in this category (e.g. grades, purities, specifications,
   packaging sizes, models). Assign the most relevant photo index to each (you may reuse
   an index). Variants must be realistic for the category — do NOT invent numeric specs,
   CAS numbers, or model numbers in the names.
4. Names: nameEn (English) + nameCn (Chinese), specific and credible, based on the primary
   product. sellingPointCn: a short Chinese selling phrase (optional).
5. Output STRICT JSON: an array of objects
   { "nameEn": string, "nameCn": string, "sellingPointCn": string, "imageIndexes": number[] }.
   No prose, no markdown.`;

export async function segmentProducts(form: FormInput, profile: CategoryProfile): Promise<FormProductInput[]> {
  const primary = form.products[0];
  const allRaw = primary?.rawImages || [];
  const uris: string[] = [];
  const uriRefIndex: number[] = []; // maps vision image index -> index into allRaw
  for (let i = 0; i < allRaw.length && uris.length < MAX_VISION_IMAGES; i++) {
    const u = rawToDataUri(form.code, allRaw[i]);
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
    hasMeta
      ? `Each photo below may carry USER-PROVIDED metadata (name_en / name_cn / desc). These are a STRONG reference for what the product is and how to split products — you MUST take them into account, weigh them at least as heavily as the primary name. BUT user-entered names can be casual/imprecise, so use them together with the actual photo to decide a clean, credible product name (you may refine the user's name, do not blindly copy it, and do not ignore it).`
      : '',
    uris.length > 0
      ? `There are ${uris.length} photos (indexes 0..${uris.length - 1}). Identify distinct products per the rules.`
      : `No photos available. Produce at least ${MIN_PRODUCTS} credible variants of the primary product (use empty imageIndexes).`,
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
  let products: FormProductInput[] = entries
    .filter((e) => e && (e.nameEn || e.nameCn))
    .slice(0, MAX_PRODUCTS)
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

  // ensure at least MIN_PRODUCTS
  if (products.length < MIN_PRODUCTS) {
    const base = primary || { nameEn: 'Product', nameCn: '', rawImages: allRaw };
    const suffixEn = ['Standard Grade', 'Premium Grade', 'Industrial Grade', 'Custom Spec'];
    const suffixCn = ['标准级', '优级', '工业级', '定制规格'];
    let k = 0;
    while (products.length < MIN_PRODUCTS) {
      products.push({
        nameEn: `${base.nameEn} ${suffixEn[k % suffixEn.length]}`.trim(),
        nameCn: `${base.nameCn} ${suffixCn[k % suffixCn.length]}`.trim(),
        sellingPointCn: form.productFeaturesCn,
        rawImages: allRaw.length ? [allRaw[k % allRaw.length]] : [],
      });
      k++;
    }
  }

  return products;
}
