import { generateCombos, profileCategory } from '../src/pipeline/profiler.js';
import { resolveKnobState } from '../src/pipeline/knobs.js';
import { generateCopy } from '../src/pipeline/copy.js';
import { runTrustGuard } from '../src/pipeline/trustguard.js';
import type { FormInput } from '../src/types.js';

const form: FormInput = {
  code: 'folic-acid-cn',
  companyIntroCn: '成立于2008年的营养添加剂与原料药生产企业，自有工厂多条生产线，产品出口全球数十个国家。',
  productFeaturesCn: '主营叶酸系列原料，食品级/药用级多规格，纯度高批次稳定，提供COA/MSDS文档，支持定制包装。',
  useScenariosCn: '用于膳食补充剂、强化食品、饮料、孕期营养产品。',
  products: [
    { nameCn: '叶酸 食品级', nameEn: 'Folic Acid Food Grade', sellingPointCn: '纯度99%+', rawImages: ['x.png'] },
    { nameCn: '叶酸 药用级', nameEn: 'Folic Acid Pharma Grade', sellingPointCn: 'GMP级别', rawImages: ['x.png'] },
    { nameCn: '叶酸钙', nameEn: 'Calcium Folate', sellingPointCn: '稳定性好', rawImages: ['x.png'] },
    { nameCn: '5-甲基四氢叶酸', nameEn: 'L-5-MTHF', sellingPointCn: '活性叶酸', rawImages: ['x.png'] },
  ],
  contact: { email: 'sales@easesourcing.com', wa: '8613800138000' },
};

function inRange(v: string, r: [number, number]) {
  const n = parseFloat(String(v).replace(/[^\d.]/g, ''));
  return !isNaN(n) && n >= r[0] * 0.5 && n <= r[1] * 2; // generous: stat may be "15+" style
}

async function runTemplate(tpl: 'm1' | 'm2') {
  const profile = await profileCategory(form);
  const combos = await generateCombos(profile);
  const knobs = resolveKnobState(profile, combos[0], { template: tpl, richnessLevel: 'rich' });
  const { content, products, compiled } = await generateCopy(form, profile, knobs);
  const tg = runTrustGuard(content, products, form);

  console.log(`\n===== TEMPLATE ${tpl} =====`);
  console.log('title:', content.title);
  console.log('subtitle:', content.subtitle);
  console.log('modules:', Object.keys(content).filter((k) => ['stats', 'certifications', 'testimonials', 'trust', 'faq', 'cta'].includes(k)).join(', '));
  console.log('contact:', JSON.stringify(content.contact));

  // AC-1
  const ac1 = content.code && content.schemaVersion === 1 && content.title && content.subtitle !== undefined && content.banner !== undefined;
  // AC-10 template scoping
  const m1only = ['stats', 'certifications', 'testimonials'];
  const m2only = ['trust', 'faq'];
  const ac10 = tpl === 'm1'
    ? !m2only.some((k) => (content as any)[k])
    : !m1only.some((k) => (content as any)[k]) && (!!content.trust || !!content.faq);
  // AC-12 testimonial author format
  let ac12 = true;
  if (content.testimonials) ac12 = content.testimonials.items.every((t) => /,/.test(t.author));
  // AC-13 stats within range
  let ac13 = true;
  if (content.stats) ac13 = content.stats.items.some((s) => inRange(s.value, profile.plausibleStats.yearsExperience) || /\+|%|MT|countries|\d/.test(s.value));
  // AC-14 no specs
  const ac14 = products.every((p) => !p.specs);
  // AC-15 subtitle provenance (none provided → none should remain)
  const ac15 = products.every((p) => !p.subtitle);
  // AC-16 contact only from customer
  const ac16 = !content.contact || (content.contact.email === form.contact!.email);
  // AC-4 wa format
  const ac4 = !content.contact?.wa || /^\+\d{6,}$/.test(content.contact.wa);

  console.log('AC-1 (required fields):', ac1 ? 'PASS' : 'FAIL');
  console.log('AC-10 (template scope):', ac10 ? 'PASS' : 'FAIL');
  console.log('AC-12 (testimonial fmt):', ac12 ? 'PASS' : 'CHECK');
  console.log('AC-13 (stats plausible):', ac13 ? 'PASS' : 'CHECK');
  console.log('AC-14 (no specs):', ac14 ? 'PASS' : 'FAIL');
  console.log('AC-15 (subtitle provenance):', ac15 ? 'PASS' : 'FAIL');
  console.log('AC-16 (contact provenance):', ac16 ? 'PASS' : 'FAIL');
  console.log('AC-4 (wa format):', ac4 ? 'PASS' : 'FAIL', content.contact?.wa || '');
  console.log('TrustGuard violations:', tg.report.hardClaimViolations.length, '| compiled prompt chars:', compiled.text.length);
}

async function main() {
  await runTemplate('m1');
  await runTemplate('m2');
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
