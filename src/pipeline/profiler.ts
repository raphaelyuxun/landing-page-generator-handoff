/**
 * CategoryProfiler (PRD §5) — infers a CategoryProfile from FormInput using
 * anchor-calibrated generation, then produces 3 RecommendedCombos.
 */
import { chatJSON } from '../aigw/client.js';
import { loadAnchors } from '../config.js';
import type { CategoryProfile, FormInput, RecommendedCombo } from '../types.js';

const PROFILE_SYSTEM = `You are a B2B export sourcing strategist. Given a Chinese supplier's raw form input
(company intro, product features, use scenarios, product names), infer a structured
CategoryProfile for building a Google-Ads landing page.

RULES:
1. Identify the product category and match it to the 1-2 closest ANCHOR archetypes
   provided below. Use the anchors to CALIBRATE plausible numeric ranges and visual
   conventions — never invent magnitudes that contradict the nearest anchor.
2. For plausibleStats, output RANGES typical for a credible Chinese supplier in this
   category, anchored to the matched archetype(s). These ranges are guardrails for
   later copy generation; they must look believable to an experienced buyer.
3. typicalCertifications: list only certifications that are STANDARD and EXPECTED in
   this category (industry table-stakes). Do not list category-irrelevant certs.
4. visualConventions: describe how this category's product is conventionally shown in
   professional catalog photography.
5. productsLikelyHomogeneous: true only if the products are variants of the same thing
   (e.g. grades of one powder); false if mixed types (e.g. machine + box + powder).
6. Output STRICT JSON matching the CategoryProfile schema. No prose, no markdown.

CategoryProfile schema (TypeScript):
{
  categoryLabel: string;
  matchedAnchors: string[];               // anchor ids
  buyerPersona: { types: ('importer'|'brand'|'factory'|'trader')[]; primaryConcerns: string[] };
  trustDriversRanked: ('factory'|'compliance'|'customization'|'price')[];
  plausibleStats: {
    yearsExperience: [number, number];
    annualCapacity: { range: [number, number]; unit: string };
    countriesExported: [number, number];
    extra?: { label: string; range: [number, number]; unit: string }[];
  };
  typicalCertifications: string[];
  visualConventions: {
    recommendedProductPhotoStyle: 'studio-solid'|'gradient'|'minimal-scene'|'industrial';
    recommendedBannerScene: 'lab'|'production-line'|'warehouse'|'application'|'abstract-brand';
    recommendedColorMood: 'cool-pro'|'warm-vivid'|'dark-premium'|'clean-bright';
    subjectPresentation: string;
    productsLikelyHomogeneous: boolean;
  };
  faqDirections: string[];
  sellingPointPriority: string[];
}`;

const COMBO_SYSTEM = `You are a B2B export landing-page strategist. Given a CategoryProfile, produce EXACTLY
three RecommendedCombos — one per archetype — that preset the L1 knobs sensibly for
this category. Archetype intents:
- compliance-anchored ("合规背书型"): for buyers in regulated industries; lead with
  certifications, purity/quality, lab-clean visuals, restrained professional copy.
- capacity-strength ("产能实力型"): for bulk buyers valuing stable supply; lead with
  capacity numbers and production-line visuals, data-led social proof.
- fast-conversion ("快速转化型"): for SMB / sample-driven buyers; lead with
  word-of-mouth, samples and urgency.

Each knobPreset is a Partial<KnobState>; only set the knobs that matter for the
archetype (omit the rest — they fall back to category defaults). Valid knob values:
  targetMarket: na|weu|mideast|sea|latam|global
  positioning: technical|premium|value
  buyerType: importer|brand|factory|trader
  trustDriver: factory|compliance|customization|price
  priceStance: show-price|inquiry|sample-first
  productPhotoStyle: studio-solid|gradient|minimal-scene|industrial
  lighting: soft-studio|hard-texture|natural
  composition: front|angle45|center-closeup
  bannerScene: lab|production-line|warehouse|application|abstract-brand
  i2iStrength: high-fidelity|medium|low
  colorMood: cool-pro|warm-vivid|dark-premium|clean-bright
  backgroundComplexity: minimal|light-texture|scene
  propStyle: none|industry-props|packaging
  copyEmphasis: (quality|price-moq|oem|logistics|capacity)[]
  toneStrength: restrained|neutral|promotional
  template: m1|m2
  richnessLevel: lean|standard|rich
  ctaUrgency: calm|medium|strong
  socialProofStyle: data|word-of-mouth|credential

Output STRICT JSON: an array of exactly 3 objects matching:
{ archetype: 'compliance-anchored'|'capacity-strength'|'fast-conversion';
  displayName: string; fitFor: string; rationale: string; knobPreset: Partial<KnobState> }
No prose, no markdown.`;

function formInputDigest(form: FormInput): string {
  const products = form.products
    .map((p, i) => `  ${i + 1}. ${p.nameEn} / ${p.nameCn}${p.sellingPointCn ? ` — ${p.sellingPointCn}` : ''}${p.modelNo ? ` [model: ${p.modelNo}]` : ''}`)
    .join('\n');
  const lines: string[] = [];
  if (form.categoryHint && form.categoryHint.trim()) {
    lines.push(`Operator-declared product category (STRONG signal — anchor to this): ${form.categoryHint.trim()}`);
  }
  if (form.companyIntroCn?.trim()) lines.push(`Company intro (CN): ${form.companyIntroCn}`);
  if (form.productFeaturesCn?.trim()) lines.push(`Product description (CN): ${form.productFeaturesCn}`);
  if (form.useScenariosCn?.trim()) lines.push(`Use scenarios (CN): ${form.useScenariosCn}`);
  const imgDescs = Object.values(form.imageDescriptions || {}).filter((d) => d && d.trim());
  if (imgDescs.length) {
    lines.push(`User-provided per-image descriptions (STRONG signal about the real product — weigh at least as heavily as the product name, which may be generic): ${imgDescs.join(' | ')}`);
  }
  lines.push(`Products:\n${products}`);
  return lines.join('\n');
}

export async function profileCategory(form: FormInput): Promise<CategoryProfile> {
  const anchors = loadAnchors();
  const anchorsBlock = JSON.stringify(
    anchors.anchors.map((a) => ({ id: a.id, displayName: a.displayName, profile: a.profile, hints: a.hints })),
    null,
    1,
  );
  const profile = await chatJSON<CategoryProfile>(
    [
      { role: 'system', content: `${PROFILE_SYSTEM}\n\nANCHORS:\n${anchorsBlock}` },
      { role: 'user', content: `FORM INPUT:\n${formInputDigest(form)}` },
    ],
    { maxTokens: 2000, temperature: 0.4 },
  );
  return normalizeProfile(profile);
}

export async function generateCombos(profile: CategoryProfile): Promise<RecommendedCombo[]> {
  const combos = await chatJSON<RecommendedCombo[]>(
    [
      { role: 'system', content: COMBO_SYSTEM },
      { role: 'user', content: `CategoryProfile:\n${JSON.stringify(profile, null, 1)}` },
    ],
    { maxTokens: 2000, temperature: 0.5 },
  );
  return normalizeCombos(combos);
}

/** Defensive normalization: clamp arrays, ensure required nested fields exist. */
function normalizeProfile(p: CategoryProfile): CategoryProfile {
  p.matchedAnchors = Array.isArray(p.matchedAnchors) ? p.matchedAnchors : [];
  p.typicalCertifications = Array.isArray(p.typicalCertifications) ? p.typicalCertifications : [];
  p.faqDirections = Array.isArray(p.faqDirections) ? p.faqDirections : [];
  p.sellingPointPriority = Array.isArray(p.sellingPointPriority) ? p.sellingPointPriority : [];
  p.trustDriversRanked = Array.isArray(p.trustDriversRanked) ? p.trustDriversRanked : ['compliance', 'factory'];
  if (!p.buyerPersona) p.buyerPersona = { types: ['importer'], primaryConcerns: [] };
  if (!p.visualConventions) {
    p.visualConventions = {
      recommendedProductPhotoStyle: 'studio-solid',
      recommendedBannerScene: 'production-line',
      recommendedColorMood: 'clean-bright',
      subjectPresentation: 'professional catalog product photo',
      productsLikelyHomogeneous: false,
    };
  }
  return p;
}

function normalizeCombos(combos: RecommendedCombo[]): RecommendedCombo[] {
  const arr = Array.isArray(combos) ? combos : [];
  const wanted: RecommendedCombo['archetype'][] = ['compliance-anchored', 'capacity-strength', 'fast-conversion'];
  // keep at most one of each wanted archetype, in canonical order
  const byType = new Map<string, RecommendedCombo>();
  for (const c of arr) if (c && c.archetype && !byType.has(c.archetype)) byType.set(c.archetype, c);
  return wanted.filter((t) => byType.has(t)).map((t) => byType.get(t)!);
}
