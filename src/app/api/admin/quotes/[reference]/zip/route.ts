import { Readable } from "stream";
import { createAdminClient } from "@/lib/server/supabaseAdmin";
import { buildFileInventory } from "@/lib/admin/fileInventory";
import { buildZipArchive } from "@/lib/admin/buildZipArchive";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const supabaseAdmin = createAdminClient();

  const { data: quote } = await supabaseAdmin
    .from("QuoteRequest")
    .select("id, reference, contactName, contactEmail, createdAt")
    .eq("reference", reference)
    .maybeSingle();
  if (!quote) return new Response("Not found", { status: 404 });

  const { data: lines } = await supabaseAdmin
    .from("QuoteRequestLine")
    .select("productName, colourName, quantity, customizationType, designProjectId, designSnapshot, assistanceBrief")
    .eq("quoteRequestId", quote.id);

  const inventory = await buildFileInventory(supabaseAdmin, lines ?? []);
  const archive = buildZipArchive(
    { type: "quote", reference: quote.reference, customerName: quote.contactName, customerEmail: quote.contactEmail, createdAt: quote.createdAt },
    inventory,
  );

  return new Response(Readable.toWeb(archive) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="quote-${quote.reference}.zip"`,
    },
  });
}
