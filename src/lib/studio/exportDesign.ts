import type { SupabaseClient } from "@supabase/supabase-js";
import { renderDesignForExport } from "./renderDesignForExport";
import { renderDesignToSvg, isVectorEligible } from "./renderDesignToSvg";
import { DESIGN_UPLOADS_BUCKET } from "./supabaseClient";
import { createAdminClient } from "@/lib/server/supabaseAdmin";
import type { DesignProjectRecord } from "./types";

const EXPORT_DPI = 300;

export interface ExportedSideFiles {
  pngUrl: string;
  svgUrl: string | null;
  pngDpi: number;
}

/** Orchestrates "for a frozen designSnapshot, produce a 300dpi transparent PNG (+ true SVG where
 *  the side is purely text/shape — see isVectorEligible) for every side that has objects," and
 *  persists the result onto DesignProject.exportStatus/exportedFiles.
 *
 *  Called from three places, each passing whichever Supabase client fits its own trust boundary:
 *  the freeze route and /api/quote (session-scoped createStudioClient, same customer whose design
 *  this is), and fulfillOrder.ts's post-payment webhook handler (no customer session cookie
 *  exists at that point — uses createAdminClient() instead, which also works fine since it
 *  bypasses RLS). Idempotent/safe to call repeatedly: no-ops if already READY, and PROCESSING is
 *  set up front so a second concurrent call sees that state rather than racing a duplicate run —
 *  this is deliberately NOT a queue/job system (see the Phase 1 plan's explicit scoping of that as
 *  out-of-scope), just a synchronous-per-call version that every caller invokes fire-and-forget. */
export async function triggerDesignExport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  designProjectId: string,
): Promise<void> {
  const { data: project, error: loadError } = await supabase
    .from("DesignProject")
    .select("frozenAt, designSnapshot, exportStatus")
    .eq("id", designProjectId)
    .maybeSingle();
  if (loadError || !project) {
    console.error("[studio] export: couldn't load project", designProjectId, loadError);
    return;
  }
  // Only a frozen design has a stable snapshot worth exporting — a live draft could change under
  // us mid-render. Never label a missing export as ready: just leave status untouched and return.
  if (!project.frozenAt || !project.designSnapshot) return;
  if (project.exportStatus === "READY" || project.exportStatus === "PROCESSING") return;

  await supabase.from("DesignProject").update({ exportStatus: "PROCESSING" }).eq("id", designProjectId);

  // Storage writes specifically go through the service-role client, not whichever `supabase` was
  // passed in for the DesignProject row operations above/below. The bucket's real INSERT policy
  // (confirmed against the live project: `(storage.foldername(name))[1] = x-mi-session header`)
  // requires every uploaded path's first folder segment to equal the uploader's own session token
  // — exactly right for a customer's own design-upload originals, but wrong for these
  // server-computed production derivatives, which aren't really "that session's file" in the same
  // sense and need to be writable regardless of which client (session-scoped or admin) triggered
  // this function. Confirmed via a real failed export in testing: a session-scoped client writing
  // to a `production-exports/...` path (no session-token prefix) was rejected with "new row
  // violates row-level security policy" — not a hypothetical concern.
  const storageClient = createAdminClient();

  try {
    const record = project.designSnapshot as DesignProjectRecord;
    const exportedFiles: Record<string, ExportedSideFiles> = {};

    for (const side of record.sides) {
      if (side.objects.length === 0) continue;

      const pngBuffer = await renderDesignForExport(side.objects, side.printAreaWidth, side.printAreaHeight, EXPORT_DPI, {
        transparent: true,
      });
      const pngPath = `production-exports/${designProjectId}/${side.sideType}.png`;
      const { error: pngError } = await storageClient.storage
        .from(DESIGN_UPLOADS_BUCKET)
        .upload(pngPath, pngBuffer, { contentType: "image/png", upsert: true });
      if (pngError) throw new Error(`PNG upload failed for ${side.sideType}: ${pngError.message}`);
      const { data: pngUrlData } = storageClient.storage.from(DESIGN_UPLOADS_BUCKET).getPublicUrl(pngPath);

      let svgUrl: string | null = null;
      if (isVectorEligible(side)) {
        const svgString = await renderDesignToSvg(side.objects, side.printAreaWidth, side.printAreaHeight);
        const svgPath = `production-exports/${designProjectId}/${side.sideType}.svg`;
        const { error: svgError } = await storageClient.storage
          .from(DESIGN_UPLOADS_BUCKET)
          .upload(svgPath, svgString, { contentType: "image/svg+xml", upsert: true });
        if (svgError) throw new Error(`SVG upload failed for ${side.sideType}: ${svgError.message}`);
        svgUrl = storageClient.storage.from(DESIGN_UPLOADS_BUCKET).getPublicUrl(svgPath).data.publicUrl;
      }

      exportedFiles[side.sideType] = { pngUrl: pngUrlData.publicUrl, svgUrl, pngDpi: EXPORT_DPI };
    }

    await supabase
      .from("DesignProject")
      .update({ exportStatus: "READY", exportedFiles, exportedAt: new Date().toISOString(), exportError: null })
      .eq("id", designProjectId);
  } catch (err) {
    console.error("[studio] export failed for", designProjectId, err);
    const message = err instanceof Error ? err.message : "Unknown export error.";
    await supabase.from("DesignProject").update({ exportStatus: "FAILED", exportError: message }).eq("id", designProjectId);
  }
}
