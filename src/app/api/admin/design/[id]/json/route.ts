import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/server/supabaseAdmin";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabaseAdmin = createAdminClient();

  const { data } = await supabaseAdmin.from("DesignProject").select("designSnapshot").eq("id", id).maybeSingle();
  if (!data?.designSnapshot) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(JSON.stringify(data.designSnapshot, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="design-${id}.json"`,
    },
  });
}
