import type { SupabaseClient } from "@supabase/supabase-js";
import type { DesignProjectRecord } from "@/lib/studio/types";

export interface FileInventoryAssetFile {
  originalFileName: string;
  url: string;
  fileSizeBytes: number | null;
}

export interface FileInventoryProductionFile {
  sideType: string;
  pngUrl: string;
  svgUrl: string | null;
}

export interface FileInventoryPreviewFile {
  sideType: string;
  url: string;
}

export interface LineFileInventory {
  lineIndex: number;
  productName: string;
  colourName: string | null;
  quantity: number;
  customizationType: string | null;
  designProjectId: string | null;
  exportStatus: string | null;
  exportError: string | null;
  designSnapshot: DesignProjectRecord | null;
  assets: FileInventoryAssetFile[];
  production: FileInventoryProductionFile[];
  preview: FileInventoryPreviewFile[];
  assistanceBrief: Record<string, unknown> | null;
}

interface LineLike {
  productName: string;
  colourName?: string | null;
  quantity: number;
  customizationType?: string | null;
  designProjectId?: string | null;
  designSnapshot?: unknown;
  assistanceBrief?: Record<string, unknown> | null;
}

interface DesignProjectExportRow {
  id: string;
  exportStatus: string | null;
  exportError: string | null;
  exportedFiles: Record<string, { pngUrl: string; svgUrl: string | null }> | null;
  previewFiles: Record<string, { url: string }> | null;
}

interface AssetRow {
  id: string;
  originalFileName: string;
  publicUrl: string;
  fileSizeBytes: number | null;
}

/** Shared by the admin order/quote detail pages (rendering links) and the bulk-ZIP routes
 *  (fetching the same files) — one place that knows how to walk a frozen designSnapshot plus a
 *  Designer's Choice assistanceBrief and resolve every real Asset/Design/Production/Preview file
 *  behind a set of order or quote lines, so the two call sites can't silently drift apart. */
export async function buildFileInventory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: SupabaseClient<any, any, any>,
  lines: LineLike[],
): Promise<LineFileInventory[]> {
  const designProjectIds = [...new Set(lines.map((l) => l.designProjectId).filter((id): id is string => Boolean(id)))];
  const { data: designProjectRows } = designProjectIds.length
    ? await supabaseAdmin
        .from("DesignProject")
        .select("id, exportStatus, exportError, exportedFiles, previewFiles")
        .in("id", designProjectIds)
    : { data: [] as DesignProjectExportRow[] };
  const designProjectById = new Map((designProjectRows ?? []).map((p: DesignProjectExportRow) => [p.id, p]));

  const assetIds = new Set<string>();
  for (const line of lines) {
    const snapshot = line.designSnapshot as DesignProjectRecord | null | undefined;
    for (const side of snapshot?.sides ?? []) {
      for (const obj of side.objects) {
        if (obj.assetId) assetIds.add(obj.assetId);
      }
    }
    const uploadedAssetId = line.assistanceBrief?.uploadedAssetId;
    if (typeof uploadedAssetId === "string") assetIds.add(uploadedAssetId);
  }
  const { data: assetRows } = assetIds.size
    ? await supabaseAdmin.from("Asset").select("id, originalFileName, publicUrl, fileSizeBytes").in("id", [...assetIds])
    : { data: [] as AssetRow[] };
  const assetById = new Map((assetRows ?? []).map((a: AssetRow) => [a.id, a]));

  return lines.map((line, lineIndex) => {
    const snapshot = (line.designSnapshot as DesignProjectRecord | null) ?? null;
    const project = line.designProjectId ? designProjectById.get(line.designProjectId) : null;

    const seenUrls = new Set<string>();
    const assets: FileInventoryAssetFile[] = [];
    const addAsset = (file: FileInventoryAssetFile) => {
      if (seenUrls.has(file.url)) return;
      seenUrls.add(file.url);
      assets.push(file);
    };

    for (const side of snapshot?.sides ?? []) {
      for (const obj of side.objects) {
        // Per renderDesignForExport.ts's own drawObject logic, a QR placement is written to the
        // wire as an ordinary "image" object — this check intentionally mirrors that, not just
        // obj.type === "image" vs some separate "qr" case.
        if (obj.type !== "image") continue;
        const asset = obj.assetId ? assetById.get(obj.assetId) : null;
        if (asset) {
          addAsset({ originalFileName: asset.originalFileName, url: asset.publicUrl, fileSizeBytes: asset.fileSizeBytes });
        } else if (obj.assetUrl) {
          addAsset({ originalFileName: obj.assetUrl.split("/").pop() ?? "asset", url: obj.assetUrl, fileSizeBytes: null });
        }
      }
    }
    const uploadedAssetId = line.assistanceBrief?.uploadedAssetId;
    if (typeof uploadedAssetId === "string") {
      const asset = assetById.get(uploadedAssetId);
      if (asset) addAsset({ originalFileName: asset.originalFileName, url: asset.publicUrl, fileSizeBytes: asset.fileSizeBytes });
    }

    const exportedFiles = project?.exportedFiles ?? {};
    const previewFiles = project?.previewFiles ?? {};

    return {
      lineIndex,
      productName: line.productName,
      colourName: line.colourName ?? null,
      quantity: line.quantity,
      customizationType: line.customizationType ?? null,
      designProjectId: line.designProjectId ?? null,
      exportStatus: project?.exportStatus ?? null,
      exportError: project?.exportError ?? null,
      designSnapshot: snapshot,
      assets,
      production: Object.entries(exportedFiles).map(([sideType, f]) => ({ sideType, pngUrl: f.pngUrl, svgUrl: f.svgUrl })),
      preview: Object.entries(previewFiles).map(([sideType, f]) => ({ sideType, url: f.url })),
      assistanceBrief: line.assistanceBrief ?? null,
    };
  });
}
