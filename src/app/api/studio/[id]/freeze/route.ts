import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createStudioClient } from "@/lib/studio/supabaseClient";
import { STUDIO_SESSION_COOKIE } from "@/lib/studio/session";
import { freezeDesignProject } from "@/lib/studio/freeze";
import { triggerDesignExport } from "@/lib/studio/exportDesign";

/** Called once, at "Approve & add to cart" — turns the live, editable DesignProject into an
 *  immutable snapshot that a cart line / order can safely reference. Idempotent: calling this
 *  again on an already-frozen project just returns the existing snapshot rather than erroring,
 *  since the client may retry after a network blip. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(STUDIO_SESSION_COOKIE)?.value;
  if (!sessionToken) return NextResponse.json({ error: "Missing Studio session." }, { status: 400 });
  const supabase = createStudioClient(sessionToken);

  const result = await freezeDesignProject(supabase, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // Fire-and-forget — the customer's freeze/add-to-cart response must never wait on production
  // file generation. Safe to call repeatedly (triggerDesignExport no-ops once already READY).
  triggerDesignExport(supabase, id).catch((err) => console.error("[studio] export trigger failed:", err));

  return NextResponse.json({ frozenRevision: result.frozenRevision, designSnapshot: result.designSnapshot });
}
