/**
 * CopyPipeline (PRD §6) — generates content.json + products.json drafts with a
 * locked schema. LLM is free on wording, never on structure or hard claims.
 */
import { chatJSON } from '../aigw/client.js';
import { config } from '../config.js';
import { nowStamp } from '../store/projects.js';
import { collectCopyDirectives } from './promptforge.js';
import type {
  CategoryProfile,
  CompiledPrompt,
  ContentData,
  FormInput,
  KnobState,
  ProductData,
} from '../types.js';

const COPY_SYSTEM = `You are an expert B2B export copywriter for Google-Ads landing pages targeting
overseas buyers. Produce rich, professional, credible English copy.

HARD RULES (CRITICAL — violating these creates legal/policy risk):
1. You MUST NOT invent any of the following ("hard claims"):
   - numeric technical parameters (purity %, CAS numbers, power ratings, heavy-metal limits, particle size, etc.)
   - product model numbers
   - contact details (email / WhatsApp)
   For products[].specs: DO NOT generate specs at all in this version (leave undefined/omit).
   For products[].subtitle (model no): only fill if explicitly present in customer input, else omit.
2. You MAY freely generate (these are marketing and not precisely falsifiable):
   - Hero title/subtitle, CTA copy, FAQ wording, testimonials (fictional, initials+country only),
     trust card copy, certification names from the category's typical set, stats VALUES within
     the plausible ranges provided.
3. testimonials: author format "Initial., Country + Role" (e.g. "J. Smith, Germany - Procurement Lead").
   Never use real full company names.
4. Stay within category conventional wisdom — never use terminology from an unrelated industry.
5. Honor the display tri-state: if a module isn't warranted by richness/template, OMIT it entirely
   (do not emit empty placeholder text or empty items arrays).
6. Output STRICT JSON: { "content": ContentData, "products": ProductData[] }. No markdown, no prose.

TEMPLATE FIELD SCOPE:
- template=m1 → MAY emit stats, certifications, testimonials. MUST NOT emit trust, faq.
- template=m2 → MAY emit trust, faq. MUST NOT emit stats, certifications, testimonials.

RICHNESS:
- lean → required fields + at most ONE optional module.
- standard → a balanced subset of modules, moderate item counts (stats ~4, certs ~6, testimonials ~3, trust ~4, faq ~5).
- rich → populate ALL modules allowed for the template, with full item counts.

ContentData shape (emit ONLY fields you populate; omit empty modules):
{
  code: string; schemaVersion: 1; title: string; subtitle: string; banner: string; // title <=30 chars; subtitle <=60 chars (one concise line); banner = "" (filled later)
  cta?: { bottomTitle?: string; bottomSubtitle?: string };
  stats?: { sectionTitle?: string; items: { value: string; label: string }[] };
  certifications?: { sectionTitle?: string; items: string[] };
  trust?: { sectionTitle?: string; items: { icon: string; title: string; desc: string }[] };  // icon = emoji
  testimonials?: { sectionTitle?: string; items: { quote: string; author: string }[] };
  faq?: { sectionTitle?: string; items: { q: string; a: string }[] };
}
ProductData shape (one per input product, SAME ORDER):
{ productName: string; description?: string; subtitle?: string }  // subtitle only if model no present in input
- description MUST be ONE short, accurate selling line — at most ~18 words / two lines. No paragraphs, no fluff, no repetition. Concrete and credible.
Do NOT set id/code/updateTime/images/price/quantity/specs — the system fills those.`;

function buildUserPrompt(form: FormInput, profile: CategoryProfile, knobs: KnobState, directives: string[]): string {
  const descByRef = form.imageDescriptions || {};
  const products = form.products
    .map((p, i) => {
      const ds = (p.rawImages || []).map((r) => descByRef[r]).filter(Boolean);
      const imgDesc = ds.length ? ` imgDesc="${ds.join(' | ')}"` : '';
      return `  [${i}] EN="${p.nameEn}" CN="${p.nameCn}"${p.sellingPointCn ? ` selling="${p.sellingPointCn}"` : ''}${imgDesc}${p.modelNo ? ` modelNo="${p.modelNo}"` : ' (no model number provided)'}`;
    })
    .join('\n');
  const anyImgDesc = form.products.some((p) => (p.rawImages || []).some((r) => descByRef[r]));
  return [
    `CATEGORY PROFILE (do not contradict):`,
    JSON.stringify(profile, null, 1),
    ``,
    `PLAUSIBLE STAT RANGES (any numeric stat you emit MUST fall within these):`,
    JSON.stringify(profile.plausibleStats, null, 1),
    ``,
    `KNOB DIRECTIVES:`,
    `- template=${knobs.template}, richness=${knobs.richnessLevel}, market=${knobs.targetMarket}, buyer=${knobs.buyerType}, positioning=${knobs.positioning}`,
    ...directives.map((d) => `- ${d}`),
    ``,
    `CUSTOMER RAW MATERIAL (Chinese):`,
    `- companyIntro: ${form.companyIntroCn}`,
    `- productFeatures: ${form.productFeaturesCn}`,
    `- useScenarios: ${form.useScenariosCn}`,
    ``,
    anyImgDesc
      ? `NOTE: each product line below may include imgDesc="..." — a user-provided description of that product's photo. Treat imgDesc as a PRIMARY signal for what the product is and how to write its copy; weigh it at least as heavily as the product name (the name may be generic/misleading). Still obey the HARD RULES (no invented specs/models).`
      : '',
    `PRODUCTS (generate one ProductData each, same order; subtitle ONLY if modelNo present):`,
    products,
    ``,
    `code="${form.code}". Emit { "content": ContentData, "products": ProductData[] } now.`,
  ].filter(Boolean).join('\n');
}

export interface CopyResult {
  content: ContentData;
  products: ProductData[];
  compiled: CompiledPrompt;
}

export async function generateCopy(
  form: FormInput,
  profile: CategoryProfile,
  knobs: KnobState,
  overridePrompt?: string,
): Promise<CopyResult> {
  const { lines, trace } = collectCopyDirectives(knobs);
  const userPrompt = overridePrompt ?? buildUserPrompt(form, profile, knobs, lines);

  const raw = await chatJSON<{ content: Partial<ContentData>; products: Partial<ProductData>[] }>(
    [
      { role: 'system', content: COPY_SYSTEM },
      { role: 'user', content: userPrompt },
    ],
    { maxTokens: 4000, temperature: 0.6 },
  );

  const content = assembleContent(raw.content || {}, form, knobs);
  const products = assembleProducts(raw.products || [], form);

  const compiled: CompiledPrompt = {
    text: `[SYSTEM]\n${COPY_SYSTEM}\n\n[USER]\n${userPrompt}`,
    trace,
    overridden: Boolean(overridePrompt),
  };
  return { content, products, compiled };
}

/** Enforce required fields, template scoping, drop empty modules (tri-state). */
export function assembleContent(raw: Partial<ContentData>, form: FormInput, knobs: KnobState): ContentData {
  const content: ContentData = {
    code: form.code,
    schemaVersion: 1,
    updateTime: nowStamp(),
    title: ((raw.title || '').trim() || form.products[0]?.nameEn || form.code).slice(0, 40),
    subtitle: (raw.subtitle || '').trim().slice(0, 90),
    banner: '', // filled by image pipeline / export placeholder
  };

  // cta
  if (raw.cta && (raw.cta.bottomTitle || raw.cta.bottomSubtitle)) content.cta = raw.cta;

  const isM1 = knobs.template === 'm1';
  if (isM1) {
    if (raw.stats?.items?.length) content.stats = { sectionTitle: raw.stats.sectionTitle, items: raw.stats.items };
    if (raw.certifications?.items?.length) content.certifications = { sectionTitle: raw.certifications.sectionTitle, items: raw.certifications.items };
    if (raw.testimonials?.items?.length) content.testimonials = { sectionTitle: raw.testimonials.sectionTitle, items: raw.testimonials.items };
  } else {
    if (raw.trust?.items?.length) content.trust = { sectionTitle: raw.trust.sectionTitle, items: raw.trust.items };
    if (raw.faq?.items?.length) content.faq = { sectionTitle: raw.faq.sectionTitle, items: raw.faq.items };
  }

  // contact: customer input if provided, else the fixed site-wide default (never AI-generated)
  content.contact = {
    wa: form.contact?.wa?.trim() || config.siteContact.wa,
    email: form.contact?.email?.trim() || config.siteContact.email,
  };
  return content;
}

export function assembleProducts(raw: Partial<ProductData>[], form: FormInput): ProductData[] {
  return form.products.map((fp, i) => {
    const r = raw[i] || {};
    const p: ProductData = {
      id: `${form.code}-${i + 1}`,
      code: form.code,
      productName: (r.productName || '').trim() || fp.nameEn || fp.nameCn,
      updateTime: nowStamp(),
      price: 0,
      quantity: 0,
      images: [],
    };
    if (r.description && r.description.trim()) {
      let d = r.description.trim();
      if (d.length > 160) d = d.slice(0, 157).trimEnd() + '…'; // safety cap (~2 lines)
      p.description = d;
    }
    // subtitle (model no) handled/verified by TrustGuard; carry through if present
    if (r.subtitle && r.subtitle.trim()) p.subtitle = r.subtitle.trim();
    // specs NEVER generated this version (§8.4)
    return p;
  });
}
