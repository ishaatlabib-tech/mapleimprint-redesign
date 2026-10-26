import { Readable } from "stream";
import { createAdminClient } from "@/lib/server/supabaseAdmin";
import { buildFileInventory } from "@/lib/admin/fileInventory";
import { buildZipArchive } from "@/lib/admin/buildZipArchive";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const supabaseAdmin = createAdminClient();

  const { data: order } = await supabaseAdmin
    .from("MapleOrder")
    .select("id, reference, contactName, contactEmail, createdAt")
    .eq("reference", reference)
    .maybeSingle();
  if (!order) return new Response("Not found", { status: 404 });

  const { data: lines } = await supabaseAdmin
    .from("MapleOrderLine")
    .select("productName, colourName, quantity, customizationType, designProjectId, designSnapshot")
    .eq("orderId", order.id);

  const inventory = await buildFileInventory(supabaseAdmin, lines ?? []);
  const archive = buildZipArchive(
    { type: "order", reference: order.reference, customerName: order.contactName, customerEmail: order.contactEmail, createdAt: order.createdAt },
    inventory,
  );

  return new Response(Readable.toWeb(archive) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="order-${order.reference}.zip"`,
    },
  });
}
