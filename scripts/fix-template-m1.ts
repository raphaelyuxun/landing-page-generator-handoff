/**
 * One-off: convert any existing M2 task to M1.
 * Re-generates ONLY the copy (template=m1), keeping the same products & images.
 *   run on seo: node_modules/.bin/tsx scripts/fix-template-m1.ts
 */
import { generateCopy } from '../src/pipeline/copy.js';
import { runTrustGuard } from '../src/pipeline/trustguard.js';
import { getProject, listProjects, saveProject } from '../src/store/projects.js';

let fixed = 0;
for (const s of listProjects()) {
  const p = getProject(s.code);
  if (!p || !p.contentDraft || !p.categoryProfile || !p.knobState) continue;
  const isM2 = p.knobState.template === 'm2' || !!(p.contentDraft as any).trust || !!(p.contentDraft as any).faq;
  if (!isM2) continue;

  console.log(`fixing ${p.code} (was m2) → m1 …`);
  p.knobState = { ...p.knobState, template: 'm1' };
  const { content, products, compiled } = await generateCopy(p.formInput, p.categoryProfile, p.knobState);
  const tg = runTrustGuard(content, products, p.formInput);
  // keep existing product images (already absolute URLs)
  tg.products.forEach((pd, i) => {
    pd.images = p.productsDraft?.[i]?.images || [];
  });
  // keep existing banner URL
  tg.content.banner = p.contentDraft.banner || tg.content.banner;
  p.contentDraft = tg.content;
  p.productsDraft = tg.products;
  p.validationReport = tg.report;
  p.l2Prompts = { ...(p.l2Prompts || {}), copy: compiled };
  saveProject(p);
  fixed++;
  console.log(`  done: ${p.code}`);
}
console.log(`\nfixed ${fixed} M2 task(s) → M1`);
