import type { SupabaseClient } from "@supabase/supabase-js";

/** MI-YYYYMMDD-#### reference generator, backed by the real QuoteRequest table — replaces
 *  src/lib/automation/reference.ts's Sheets-row-count approach for this purpose (that function's
 *  own comment already documents it as racy under concurrent writes, with a Math.random()
 *  fallback when Sheets isn't configured at all). Collisions are handled by retrying against the
 *  table's real unique constraint on `reference`, not by hoping the count-based guess is unique. */
export async function generateQuoteReference(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<string> {
  const now = new Date();
  const prefix = `MI-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}-`;

  for (let attempt = 0; attempt < 5; attempt++) {
    const { count } = await supabase
      .from("QuoteRequest")
      .select("id", { count: "exact", head: true })
      .like("reference", `${prefix}%`);
    const sequence = (count ?? 0) + 1 + attempt;
    const candidate = `${prefix}${String(sequence).padStart(4, "0")}`;

    // Reserve it immediately via a lightweight probe insert-and-rollback isn't available through
    // PostgREST, so the real uniqueness check happens at the actual QuoteRequest insert (caller
    // retries this generator on a 23505 unique-violation against `reference` — see /api/quote).
    // This loop's job is just to produce a plausible next candidate without a second DB round
    // trip per attempt beyond the count query above.
    const { data: existing } = await supabase.from("QuoteRequest").select("id").eq("reference", candidate).maybeSingle();
    if (!existing) return candidate;
  }

  // Exhausted plausible sequential attempts (extremely unlikely at any realistic daily volume) —
  // fall back to a random suffix rather than looping forever.
  return `${prefix}${String(Math.floor(Math.random() * 9000) + 1000)}`;
}
