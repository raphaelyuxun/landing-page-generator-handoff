/**
 * TrustGuard (PRD §8) — field trust tiers + provenance check on the only three
 * 🔴 hard-claim types: numeric tech params (specs.value), model number
 * (products[].subtitle), contact (content.contact.*). Everything else is 🟢.
 */
import { config } from '../config.js';
import type { ContentData, FormInput, ProductData, ValidationReport } from '../types.js';

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-_/.]/g, '');
}

/** A model-number string has provenance if it appears in the customer's input for that product. */
function modelHasProvenance(value: string, form: FormInput, productIndex: number): boolean {
  const fp = form.products[productIndex];
  if (!fp) return false;
  const haystacks = [fp.nameCn, fp.nameEn, fp.sellingPointCn || '', fp.modelNo || ''];
  const v = normalize(value);
  if (!v) return false;
  return haystacks.some((h) => normalize(h).includes(v));
}

export function runTrustGuard(
  content: ContentData,
  products: ProductData[],
  form: FormInput,
): { content: ContentData; products: ProductData[]; report: ValidationReport } {
  const report: ValidationReport = { hardClaimViolations: [], tierWarnings: [], passed: true };

  // ---- contact (🔴): must equal customer input OR the fixed site-wide default ----
  const allowedEmail = form.contact?.email?.trim() || config.siteContact.email;
  const allowedWa = form.contact?.wa?.trim() || config.siteContact.wa;
  if (content.contact) {
    if (content.contact.email && content.contact.email.trim() !== allowedEmail) {
      report.hardClaimViolations.push({ path: 'content.contact.email', value: content.contact.email, reason: 'mismatch', action: 'cleared' });
      content.contact.email = allowedEmail; // correct to the trusted value, never AI's
    }
    if (content.contact.wa && content.contact.wa.trim() !== allowedWa) {
      report.hardClaimViolations.push({ path: 'content.contact.wa', value: content.contact.wa, reason: 'mismatch', action: 'cleared' });
      content.contact.wa = allowedWa;
    }
    if (!content.contact.email && !content.contact.wa) delete content.contact;
  }

  // ---- contact.wa format (AC-4): must have +, no spaces/hyphens ----
  if (content.contact?.wa) {
    const wa = content.contact.wa;
    if (!/^\+\d{6,}$/.test(wa)) {
      const cleaned = '+' + wa.replace(/[^\d]/g, '');
      if (/^\+\d{6,}$/.test(cleaned)) {
        content.contact.wa = cleaned;
        report.tierWarnings.push({ path: 'content.contact.wa', note: `normalized to ${cleaned}` });
      } else {
        report.hardClaimViolations.push({ path: 'content.contact.wa', value: wa, reason: 'mismatch', action: 'cleared' });
        delete content.contact.wa;
        if (!content.contact.email) delete content.contact;
      }
    }
  }

  // ---- products[].subtitle (🔴 model no): only if provenance ----
  products.forEach((p, i) => {
    if (p.subtitle && p.subtitle.trim()) {
      if (!modelHasProvenance(p.subtitle, form, i)) {
        report.hardClaimViolations.push({ path: `products[${i}].subtitle`, value: p.subtitle, reason: 'no-provenance', action: 'module-hidden' });
        delete p.subtitle;
      }
    }
    // ---- products[].specs (🔴): never generated this version — strip if present ----
    if (p.specs) {
      report.hardClaimViolations.push({ path: `products[${i}].specs`, value: JSON.stringify(p.specs), reason: 'no-provenance', action: 'module-hidden' });
      delete p.specs;
    }
  });

  report.passed = report.hardClaimViolations.length === 0;
  return { content, products, report };
}
