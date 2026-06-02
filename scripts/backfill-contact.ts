/**
 * One-off: write the fixed site-wide contact into every existing task's content.
 *   run on seo: node_modules/.bin/tsx scripts/backfill-contact.ts
 */
import { config } from '../src/config.js';
import { getProject, listProjects, saveProject } from '../src/store/projects.js';

const want = { wa: config.siteContact.wa, email: config.siteContact.email };
let updated = 0;
for (const s of listProjects()) {
  const p = getProject(s.code);
  if (!p?.contentDraft) continue;
  if (JSON.stringify(p.contentDraft.contact) !== JSON.stringify(want)) {
    p.contentDraft.contact = { ...want };
    saveProject(p);
    updated++;
    console.log('updated', p.code);
  }
}
console.log(`done — ${updated} task(s) got contact ${want.wa} / ${want.email}`);
