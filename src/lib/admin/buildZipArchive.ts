import { ZipArchive, type Archiver } from "archiver";
import type { LineFileInventory } from "./fileInventory";

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "item";
}

interface ManifestHeader {
  type: "order" | "quote";
  reference: string;
  customerName: string;
  customerEmail: string;
  createdAt: string;
}

/** Shared by both the order and quote bulk-ZIP routes: given the same LineFileInventory the
 *  admin detail pages render, fetches every real file (Asset originals, the design snapshot,
 *  production PNG/SVG, preview images) and packages them with a manifest.json describing exactly
 *  what's inside — the literal "manifest" + "organized folder structure" the original spec asked
 *  for. Returns the archive stream already finalizing in the background; the caller only needs to
 *  bridge it to a Response, not call `.finalize()` itself. */
export function buildZipArchive(header: ManifestHeader, inventory: LineFileInventory[]): Archiver {
  const archive = new ZipArchive({ zlib: { level: 6 } });

  const manifest = {
    ...header,
    lines: inventory.map((line) => ({
      lineIndex: line.lineIndex,
      productName: line.productName,
      quantity: line.quantity,
      exportStatus: line.exportStatus,
      assets: line.assets.map((a) => a.originalFileName),
      production: line.production.map((p) => p.sideType),
      preview: line.preview.map((p) => p.sideType),
      hasDesignersChoiceBrief: Boolean(line.assistanceBrief),
    })),
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  void appendAllFiles(archive, inventory).finally(() => archive.finalize());

  return archive;
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error("[admin] zip: failed to fetch", url, err);
    return null;
  }
}

async function appendAllFiles(archive: Archiver, inventory: LineFileInventory[]): Promise<void> {
  for (const line of inventory) {
    const folder = `${line.lineIndex}-${slugify(line.productName)}`;

    for (const asset of line.assets) {
      const buffer = await fetchBuffer(asset.url);
      if (buffer) archive.append(buffer, { name: `${folder}/assets/${asset.originalFileName}` });
    }

    if (line.designSnapshot) {
      archive.append(JSON.stringify(line.designSnapshot, null, 2), { name: `${folder}/design/design.json` });
    }

    for (const p of line.production) {
      const pngBuffer = await fetchBuffer(p.pngUrl);
      if (pngBuffer) archive.append(pngBuffer, { name: `${folder}/production/${p.sideType}.png` });
      if (p.svgUrl) {
        const svgBuffer = await fetchBuffer(p.svgUrl);
        if (svgBuffer) archive.append(svgBuffer, { name: `${folder}/production/${p.sideType}.svg` });
      }
    }

    for (const p of line.preview) {
      const buffer = await fetchBuffer(p.url);
      if (buffer) archive.append(buffer, { name: `${folder}/preview/${p.sideType}.png` });
    }

    if (line.assistanceBrief) {
      archive.append(JSON.stringify(line.assistanceBrief, null, 2), { name: `${folder}/designers-choice-brief.json` });
    }
  }
}
