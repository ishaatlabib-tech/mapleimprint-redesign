import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDesignProjectRecord } from "@/lib/studio/loadProjectRecord";
import type { DesignProjectRecord } from "@/lib/studio/types";

export type FreezeResult =
  | { ok: true; frozenRevision: number; designSnapshot: DesignProjectRecord }
  | { ok: false; status: number; error: string };

/** Turns the live, editable DesignProject into an immutable snapshot a cart line / order / quote
 *  line can safely reference. Idempotent: calling this again on an already-frozen project just
 *  returns the existing snapshot rather than erroring, since a caller may retry after a network
 *  blip. Shared by POST /api/studio/[id]/freeze (the normal "Approve & add to cart" path) and
 *  /api/quote's defensive freeze-on-submit (for the rare case a CUSTOM cart line somehow reaches
 *  a quote without having gone through that button first) — one implementation, not a route
 *  calling another route over HTTP, so the freeze logic can't drift between the two callers. */
export async function freezeDesignProject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  id: string,
): Promise<FreezeResult> {
  const { data: current, error: currentError } = await supabase
    .from("DesignProject")
    .select("frozenAt, designSnapshot, frozenRevision")
    .eq("id", id)
    .maybeSingle();
  if (currentError) {
    console.error("[studio] freeze status check failed:", currentError);
    return { ok: false, status: 502, error: "Couldn't finalize your design." };
  }
  if (!current) return { ok: false, status: 404, error: "Design not found." };

  if (current.frozenAt) {
    return { ok: true, frozenRevision: current.frozenRevision, designSnapshot: current.designSnapshot };
  }

  const { record, error } = await loadDesignProjectRecord(supabase, id);
  if (error) return { ok: false, status: 502, error: "Couldn't finalize your design." };
  if (!record) return { ok: false, status: 404, error: "Design not found." };
  if (!record.sides.some((s) => s.objects.length > 0)) {
    return { ok: false, status: 422, error: "Add at least one design element before approving." };
  }

  const frozenAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("DesignProject")
    .update({ frozenAt, designSnapshot: record, frozenRevision: record.revision, status: "ordered", updatedAt: frozenAt })
    .eq("id", id);
  if (updateError) {
    console.error("[studio] freeze update failed:", updateError);
    return { ok: false, status: 502, error: "Couldn't finalize your design." };
  }

  return { ok: true, frozenRevision: record.revision, designSnapshot: record };
}
