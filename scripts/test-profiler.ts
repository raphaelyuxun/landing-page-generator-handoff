/**
 * Smoke test for the CategoryProfiler (AC-5..AC-8).
 * Requires the AIGW relay reachable at AIGW_RELAY_URL (use an SSH local-forward
 * to seo's 4500 when running from a dev machine).
 */
import { relayHealth } from '../src/aigw/client.js';
import { generateCombos, profileCategory } from '../src/pipeline/profiler.js';
import { resolveKnobState } from '../src/pipeline/knobs.js';
import type { FormInput } from '../src/types.js';

const folicAcid: FormInput = {
  code: 'folic-acid-cn',
  companyIntroCn:
    '我们是一家成立于2008年的营养添加剂与原料药生产企业，拥有自有工厂和多条生产线，产品出口全球数十个国家，具备完善的质量管理体系。',
  productFeaturesCn:
    '主营叶酸（维生素B9）系列原料，提供食品级、药用级等多种规格，纯度高、批次稳定，可提供COA、MSDS等完整文档，支持定制包装。',
  useScenariosCn: '广泛用于膳食补充剂、强化食品、饮料、孕期营养产品等领域。',
  products: [
    { nameCn: '叶酸 食品级', nameEn: 'Folic Acid Food Grade', sellingPointCn: '纯度99%+，食品强化首选', rawImages: ['placeholder.png'] },
    { nameCn: '叶酸 药用级', nameEn: 'Folic Acid Pharma Grade', sellingPointCn: 'GMP级别，文档齐全', rawImages: ['placeholder.png'] },
    { nameCn: '叶酸钙', nameEn: 'Calcium Folate', sellingPointCn: '稳定性好，吸收率高', rawImages: ['placeholder.png'] },
    { nameCn: '5-甲基四氢叶酸', nameEn: 'L-5-MTHF', sellingPointCn: '活性叶酸，高端配方', rawImages: ['placeholder.png'] },
  ],
};

async function main() {
  console.log('relay healthy:', await relayHealth());
  console.log('--- profiling category ---');
  const profile = await profileCategory(folicAcid);
  console.log('categoryLabel:', profile.categoryLabel);
  console.log('matchedAnchors:', profile.matchedAnchors);
  console.log('plausibleStats:', JSON.stringify(profile.plausibleStats));
  console.log('productsLikelyHomogeneous:', profile.visualConventions.productsLikelyHomogeneous);
  console.log('typicalCertifications:', profile.typicalCertifications.join(', '));

  console.log('--- generating combos ---');
  const combos = await generateCombos(profile);
  console.log('combo count:', combos.length);
  for (const c of combos) console.log(`  - ${c.archetype} / ${c.displayName}: ${c.fitFor}`);

  console.log('--- resolve knob state (compliance combo) ---');
  const ks = resolveKnobState(profile, combos.find((c) => c.archetype === 'compliance-anchored') ?? null);
  console.log('template:', ks.template, '| trustDriver:', ks.trustDriver, '| photoStyle:', ks.productPhotoStyle, '| i2i:', ks.i2iStrength);

  // AC checks
  const ac5 = /chemical|raw material|nutraceutical|ingredient|vitamin/i.test(profile.categoryLabel);
  const ac7 = combos.length === 3 && new Set(combos.map((c) => c.archetype)).size === 3;
  const ac8 = profile.visualConventions.productsLikelyHomogeneous === true;
  console.log('\nAC-5 (chemical label):', ac5 ? 'PASS' : 'CHECK');
  console.log('AC-7 (3 distinct combos):', ac7 ? 'PASS' : 'FAIL');
  console.log('AC-8 (homogeneous=true):', ac8 ? 'PASS' : 'CHECK');
}

main().catch((e) => {
  console.error('TEST FAILED:', e);
  process.exit(1);
});
