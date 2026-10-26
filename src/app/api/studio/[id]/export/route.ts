import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createStudioClient } from "@/lib/studio/supabaseClient";
import { STUDIO_SESSION_COOKIE } from "@/lib/studio/session";
import { triggerDesignExport } from "@/lib/studio/exportDesign";

/** Thin HTTP wrapper around triggerDesignExport — the freeze route, fulfillOrder.ts, and
 *  /api/quote all call triggerDesignExport directly in-process (no HTTP round trip), so this
 *  route exists mainly as an explicit retry trigger (e.g. a future admin "regenerate production
 *  files" action) and for completeness. Awaits the export and returns its resulting status rather
 *  than firing fully fire-and-forget, since an explicit caller of this route presumably wants to
 *  know the outcome. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(STUDIO_SESSION_COOKIE)?.value;
  if (!sessionToken) return NextResponse.json({ error: "Missing Studio session." }, { status: 400 });
  const supabase = createStudioClient(sessionToken);

  await triggerDesignExport(supabase, id);

  const { data: project } = await supabase
    .from("DesignProject")
    .select("exportStatus, exportedFiles, exportError")
    .eq("id", id)
    .maybeSingle();

  if (!project) return NextResponse.json({ error: "Design not found." }, { status: 404 });
  return NextResponse.json(project);
}
