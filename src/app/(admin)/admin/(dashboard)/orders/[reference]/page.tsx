import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/server/supabaseAdmin";
import { buildFileInventory } from "@/lib/admin/fileInventory";
import { LineFileCard } from "@/components/admin/LineFileCard";

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const supabaseAdmin = createAdminClient();

  const { data: order } = await supabaseAdmin
    .from("MapleOrder")
    .select(
      "id, reference, status, contactName, contactEmail, contactPhone, shippingAddress, totalCents, currency, createdAt",
    )
    .eq("reference", reference)
    .maybeSingle();

  if (!order) notFound();

  const { data: lines } = await supabaseAdmin
    .from("MapleOrderLine")
    .select("productName, colourName, quantity, customizationType, designProjectId, designSnapshot")
    .eq("orderId", order.id);

  const inventory = await buildFileInventory(supabaseAdmin, lines ?? []);
  const address = order.shippingAddress as { line1?: string; city?: string; province?: string; postalCode?: string } | null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900">Order {order.reference}</h1>
          <p className="mt-1 text-sm text-muted">
            {order.contactName} · {order.contactEmail}
            {order.contactPhone ? ` · ${order.contactPhone}` : ""}
          </p>
          {address?.city && (
            <p className="mt-1 text-sm text-muted">
              Shipping to {address.line1 ? `${address.line1}, ` : ""}
              {address.city}
              {address.province ? `, ${address.province}` : ""} {address.postalCode ?? ""}
            </p>
          )}
        </div>
        <div className="text-right">
          <span className="rounded-full bg-sand px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-900">
            {order.status}
          </span>
          <p className="mt-2 font-display text-lg font-semibold text-ink-900">
            ${(order.totalCents / 100).toFixed(2)} {order.currency}
          </p>
          <a
            href={`/api/admin/orders/${order.reference}/zip`}
            className="mt-3 inline-block rounded-full bg-ink-900 px-5 py-2 text-sm font-semibold text-white"
          >
            Download all files (.zip)
          </a>
        </div>
      </div>

      <div className="mt-8 space-y-4">
        {inventory.map((line) => (
          <LineFileCard key={line.lineIndex} line={line} />
        ))}
      </div>

      <Link href="/admin/orders" className="mt-8 inline-block text-sm text-muted hover:text-ink-900">
        ← Back to orders
      </Link>
    </div>
  );
}
