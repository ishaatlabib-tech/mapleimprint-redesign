import { createStudioClient, DESIGN_UPLOADS_BUCKET } from "@/lib/studio/supabaseClient";
import { uploadToDrive } from "@/lib/automation/drive";
import { detectFileType, matchesDeclaredType, type DetectedFileType } from "@/lib/uploads/detectFileType";

// The one shared upload path both /api/studio/upload (Studio canvas images) and /api/upload (the
// quote wizard's file-attach step) write through — previously these were two unconnected systems:
// Studio wrote raster-only files into the Supabase `design-uploads` bucket with no tracking row at
// all, while the quote flow wrote a much wider format set straight to Google Drive and never
// touched Supabase. Every upload now lands in the same bucket and gets a real `Asset` row, so
// staff can trace any original file back to the session/design that produced it regardless of
// which form it came through — Drive is kept as a best-effort secondary mirror for quote-flow
// files only, not the source of truth, so staff's existing Drive-based review habit keeps working.

export type UploadCategory = "studio-image" | "production-file";

const CATEGORY_RULES: Record<UploadCategory, { maxBytes: number; allowed: DetectedFileType[] }> = {
  // Unchanged from today's /api/studio/upload behavior — SVG is deliberately excluded here too
  // (see detectFileType.ts's note on SVG being classification-only, not sanitization; Studio's
  // canvas still can't safely render arbitrary customer SVG).
  "studio-image": { maxBytes: 25 * 1024 * 1024, allowed: ["png", "jpeg"] },
  // Unchanged from today's /api/upload behavior (AI/EPS/PDF/SVG/PNG/JPEG/PSD/ZIP, 100MB) — these
  // are store-and-forward only (no in-Studio preview/rasterization), per the explicit scoping
  // decision that AI/EPS/PSD support means "accept, validate, store the original for staff to
  // download," not "build a conversion/preview pipeline."
  "production-file": { maxBytes: 100 * 1024 * 1024, allowed: ["png", "jpeg", "pdf", "svg", "psd", "eps", "zip"] },
};

const EXTENSION_FOR: Record<DetectedFileType, string> = {
  png: "png",
  jpeg: "jpg",
  pdf: "pdf",
  zip: "zip",
  psd: "psd",
  eps: "eps",
  ai: "ai",
  svg: "svg",
  unknown: "bin",
};

export interface SaveUploadResult {
  assetId: string;
  publicUrl: string;
  fileName: string;
  fileSize: number;
  driveLink: string | null;
}

export interface SaveUploadError {
  error: string;
  status: number;
}

function isError(x: SaveUploadResult | SaveUploadError): x is SaveUploadError {
  return "error" in x;
}
export { isError as isSaveUploadError };

export async function saveUpload(opts: {
  sessionToken: string;
  file: File;
  category: UploadCategory;
  /** True for quote-flow uploads (keeps staff's existing Drive-based review habit); false for
   *  Studio canvas images (never needed Drive, and mirroring every logo/graphic a customer drags
   *  onto a design would be pure noise in that folder). */
  mirrorToDrive: boolean;
}): Promise<SaveUploadResult | SaveUploadError> {
  const rules = CATEGORY_RULES[opts.category];

  if (opts.file.size > rules.maxBytes) {
    const maxMb = Math.round(rules.maxBytes / (1024 * 1024));
    return { error: `That file is too large. Please upload something under ${maxMb}MB.`, status: 422 };
  }

  const bytes = Buffer.from(await opts.file.arrayBuffer());
  const detected = detectFileType(bytes);
  const declaredExt = opts.file.name.split(".").pop()?.toLowerCase() ?? "";

  if (detected === "unknown" || !rules.allowed.includes(detected)) {
    return {
      error:
        opts.category === "studio-image"
          ? "We couldn't use this file type. Upload a PNG or JPG, or let Maple Imprint help prepare it."
          : "Unsupported file type. Allowed: AI, EPS, PDF, SVG, PNG, JPEG, PSD, ZIP.",
      status: 422,
    };
  }
  // Real content must match what the filename claims (beyond the one documented AI/PDF
  // ambiguity handled inside matchesDeclaredType) — this is the actual "validate real file type,
  // not just extension/claimed MIME" check; a mismatch here is a customer error (wrong/corrupted
  // file, or an extension that was changed), not a system failure, so this stays a 422.
  if (declaredExt && !matchesDeclaredType(detected, declaredExt)) {
    return {
      error: `This file's contents don't match its ".${declaredExt}" extension. Please re-export and try again.`,
      status: 422,
    };
  }

  const extension = EXTENSION_FOR[detected];
  const storagePath = `${opts.sessionToken}/${crypto.randomUUID()}.${extension}`;
  const supabase = createStudioClient(opts.sessionToken);

  const { error: uploadError } = await supabase.storage
    .from(DESIGN_UPLOADS_BUCKET)
    .upload(storagePath, bytes, { contentType: opts.file.type || undefined, upsert: false });
  if (uploadError) {
    console.error("[uploads] storage upload failed:", uploadError);
    return { error: "We couldn't save this file. Try again, or let Maple Imprint help prepare it.", status: 502 };
  }

  const { data: urlData } = supabase.storage.from(DESIGN_UPLOADS_BUCKET).getPublicUrl(storagePath);

  const { data: assetRow, error: assetError } = await supabase
    .from("Asset")
    .insert({
      ownerSession: opts.sessionToken,
      originalFileName: opts.file.name,
      storageBucket: DESIGN_UPLOADS_BUCKET,
      storagePath,
      publicUrl: urlData.publicUrl,
      declaredMimeType: opts.file.type || null,
      detectedMimeType: detected,
      fileSizeBytes: bytes.byteLength,
      kind: "upload",
    })
    .select("id")
    .single();
  if (assetError || !assetRow) {
    // The file bytes are already safely in storage at this point — losing just the tracking row
    // would silently break traceability without the customer knowing anything went wrong, so
    // this is treated as a hard failure rather than degrading gracefully.
    console.error("[uploads] asset row insert failed:", assetError);
    return { error: "We couldn't save this file. Try again, or let Maple Imprint help prepare it.", status: 502 };
  }

  let driveLink: string | null = null;
  if (opts.mirrorToDrive) {
    try {
      const driveResult = await uploadToDrive(bytes, opts.file.name, opts.file.type || null);
      driveLink = driveResult?.webViewLink ?? null;
    } catch (err) {
      // Best-effort only — matches every other optional-integration pattern in this codebase
      // (notifyInquiry's Promise.allSettled, remove-background's graceful degradation). The file
      // is already safely stored in Supabase; Drive is a convenience mirror, never load-bearing.
      console.error("[uploads] Drive mirror failed (non-fatal):", err);
    }
  }

  return {
    assetId: assetRow.id,
    publicUrl: urlData.publicUrl,
    fileName: opts.file.name,
    fileSize: bytes.byteLength,
    driveLink,
  };
}
