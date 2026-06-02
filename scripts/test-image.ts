import fs from 'node:fs';
import { generateImages, pngDimensions } from '../src/pipeline/image.js';
import { defaultKnobsFromProfile } from '../src/pipeline/knobs.js';
import type { CategoryProfile, FormInput } from '../src/types.js';

const profile: CategoryProfile = {
  categoryLabel: 'Bulk Nutraceutical Ingredient',
  matchedAnchors: ['chemical-raw-material'],
  buyerPersona: { types: ['brand'], primaryConcerns: ['purity'] },
  trustDriversRanked: ['compliance', 'factory'],
  plausibleStats: { yearsExperience: [10, 20], annualCapacity: { range: [100, 1000], unit: 'MT' }, countriesExported: [20, 60] },
  typicalCertifications: ['ISO 9001', 'GMP'],
  visualConventions: {
    recommendedProductPhotoStyle: 'studio-solid',
    recommendedBannerScene: 'production-line',
    recommendedColorMood: 'clean-bright',
    subjectPresentation: 'foil bag of fine white powder with neutral label, sample of powder beside it',
    productsLikelyHomogeneous: true,
  },
  faqDirections: ['lead time'],
  sellingPointPriority: ['purity'],
};

const form: FormInput = {
  code: 'img-test',
  companyIntroCn: '原料生产商',
  productFeaturesCn: '高纯度叶酸粉末',
  useScenariosCn: '膳食补充剂',
  products: [{ nameCn: '叶酸 食品级', nameEn: 'Folic Acid Food Grade', sellingPointCn: '99%纯度', rawImages: ['none.png'] }],
};

async function main() {
  console.log('generating images (banner + reference + 1 product i2i)...');
  const t0 = Date.now();
  const res = await generateImages(form, profile, defaultKnobsFromProfile(profile));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${res.assets.length} assets`);
  for (const a of res.assets) {
    const buf = fs.readFileSync(a.localPath);
    const dim = pngDimensions(buf);
    console.log(`  ${a.kind.padEnd(16)} ${a.exportName.padEnd(22)} ${dim ? `${dim.width}x${dim.height}` : '??'} ${(buf.length / 1024).toFixed(0)}KB qa=${JSON.stringify(a.qa)}`);
  }
  console.log('compiled prompts:', res.compiledPrompts.length);
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
