/**
 * One-off: rewrite every existing project's contentDraft.banner and
 * productsDraft[].images to externally-reachable absolute public URLs,
 * based on the assets already on disk.
 *   run on seo: node_modules/.bin/tsx scripts/backfill-urls.ts
 */
import { publicAssetUrl } from '../src/config.js';
import { getProject, listProjects, saveProject } from '../src/store/projects.js';

let updated = 0;
for (const s of listProjects()) {
  const p = getProject(s.code);
  if (!p || !p.assets?.length) continue;
  let changed = false;

  const banner = p.assets.find((a) => a.kind === 'banner');
  if (p.contentDraft && banner) {
    const url = publicAssetUrl(p.code, banner.exportName);
    if (p.contentDraft.banner !== url) {
      p.contentDraft.banner = url;
      changed = true;
    }
  }

  if (p.productsDraft) {
    p.productsDraft.forEach((pd, i) => {
      const imgs = p
        .assets!.filter((a) => a.kind === 'product' && a.productIndex === i)
        .sort((a, b) => a.exportName.localeCompare(b.exportName))
        .map((a) => publicAssetUrl(p.code, a.exportName));
      if (imgs.length && JSON.stringify(pd.images || []) !== JSON.stringify(imgs)) {
        pd.images = imgs;
        changed = true;
      }
    });
  }

  if (changed) {
    saveProject(p);
    updated++;
    console.log('updated', p.code);
  }
}
console.log(`done — ${updated} project(s) updated`);
