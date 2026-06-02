/**
 * Exporter (PRD §10) — packages a project into a zip:
 *   content.json   (ContentData, banner = {{ASSET:...}} placeholder)
 *   products.json  ({ data, success, message, code } shell, images placeholders)
 *   images/        (banner.png, product-N.png — style-references excluded)
 *   manifest.json  (placeholder<->file map, knobState, l2Prompts)
 *
 * §11.3: Exporter is abstracted; LocalZipExporter implemented, OnlinePublishExporter is a stub.
 */
import archiver from 'archiver';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import { publicAssetUrl } from '../config.js';
import type { ContentData, GeneratedAsset, GenerationProject, ProductData } from '../types.js';

export const ASSET_PREFIX = '{{ASSET:';
export function assetPlaceholder(exportName: string): string {
  return `{{ASSET:${exportName}}}`;
}

export interface ExportResult {
  content: ContentData;
  productsShell: { data: ProductData[]; success: true; message: string; code: number };
  manifest: unknown;
  exportableAssets: GeneratedAsset[];
}

/** Build the export payloads (pure, testable) without zipping. */
export function buildExportPayload(project: GenerationProject): ExportResult {
  const assets = project.assets || [];
  const banner = assets.find((a) => a.kind === 'banner');
  const productAssets = assets.filter((a) => a.kind === 'product');

  // content with banner placeholder
  const content: ContentData = JSON.parse(JSON.stringify(project.contentDraft));
  content.banner = banner ? publicAssetUrl(project.code, banner.exportName) : content.banner || '';

  // products with externally-reachable absolute image URLs
  const products: ProductData[] = JSON.parse(JSON.stringify(project.productsDraft || []));
  products.forEach((p, i) => {
    const imgs = productAssets
      .filter((a) => a.productIndex === i)
      .sort((a, b) => a.exportName.localeCompare(b.exportName))
      .map((a) => publicAssetUrl(project.code, a.exportName));
    if (imgs.length) p.images = imgs;
  });

  const productsShell = { data: products, success: true as const, message: '', code: 200 };

  const exportableAssets = [...(banner ? [banner] : []), ...productAssets];

  const manifest = {
    code: project.code,
    generatedAt: project.updatedAt,
    template: project.knobState?.template,
    assets: exportableAssets.map((a) => ({
      url: publicAssetUrl(project.code, a.exportName),
      file: a.exportName,
      kind: a.kind,
      productIndex: a.productIndex,
      qa: a.qa ? { needsAttention: a.qa.needsAttention, hasUnexpectedText: a.qa.hasUnexpectedText } : { needsAttention: false },
    })),
    knobState: project.knobState,
    l2Prompts: project.l2Prompts,
  };

  return { content, productsShell, manifest, exportableAssets };
}

/** Stream a zip of the project. Returns a readable stream. */
export function exportZip(project: GenerationProject): PassThrough {
  const { content, productsShell, manifest, exportableAssets } = buildExportPayload(project);
  const out = new PassThrough();
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => out.destroy(err));
  archive.pipe(out);

  archive.append(JSON.stringify(content, null, 2), { name: 'content.json' });
  archive.append(JSON.stringify(productsShell, null, 2), { name: 'products.json' });
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

  for (const a of exportableAssets) {
    if (fs.existsSync(a.localPath)) {
      archive.file(a.localPath, { name: a.exportName });
    }
  }
  archive.finalize();
  return out;
}
