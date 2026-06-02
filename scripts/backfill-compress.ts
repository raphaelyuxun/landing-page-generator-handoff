/**
 * One-off: compress every existing task's images to JPEG (<500KB), convert
 * .png → .jpg, and fix the asset exportName/localPath + draft image URLs.
 *   run on seo: node_modules/.bin/tsx scripts/backfill-compress.ts
 */
import fs from 'node:fs';
import { publicAssetUrl } from '../src/config.js';
import { compressImage } from '../src/pipeline/image.js';
import { getProject, listProjects, saveProject } from '../src/store/projects.js';

let updated = 0;
for (const s of listProjects()) {
  const p = getProject(s.code);
  if (!p?.assets?.length) continue;
  let changed = false;

  for (const a of p.assets) {
    if (a.localPath?.endsWith('.png') && fs.existsSync(a.localPath)) {
      const role = a.kind === 'banner' ? 'banner' : a.kind === 'style-reference' ? 'ref' : 'product';
      const jbuf = await compressImage(fs.readFileSync(a.localPath), role);
      const newPath = a.localPath.replace(/\.png$/, '.jpg');
      fs.writeFileSync(newPath, jbuf);
      if (newPath !== a.localPath) fs.unlinkSync(a.localPath);
      a.localPath = newPath;
      a.exportName = a.exportName.replace(/\.png$/, '.jpg');
      changed = true;
    }
  }

  if (changed) {
    const banner = p.assets.find((a) => a.kind === 'banner');
    if (p.contentDraft && banner) p.contentDraft.banner = publicAssetUrl(p.code, banner.exportName);
    if (p.productsDraft) {
      p.productsDraft.forEach((pd, i) => {
        const imgs = p
          .assets!.filter((a) => a.kind === 'product' && a.productIndex === i)
          .sort((x, y) => x.exportName.localeCompare(y.exportName))
          .map((a) => publicAssetUrl(p.code, a.exportName));
        if (imgs.length) pd.images = imgs;
      });
    }
    saveProject(p);
    updated++;
    console.log('compressed', p.code);
  }
}
console.log(`done — ${updated} task(s) compressed to JPEG`);
