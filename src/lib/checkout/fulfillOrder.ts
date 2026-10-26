import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/automation/email/resend";
import { orderConfirmationEmail, adminOrderPaidEmail } from "@/lib/automation/email/templates";
import { triggerDesignExport } from "@/lib/studio/exportDesign";

/**
 * The single place an order is marked PAID and notified — called from BOTH the synchronous
 * /api/checkout/pay response path and the /api/webhooks/square reconciliation path, since either
 * can be the one that first learns a payment succeeded. The conditional update (`neq status PAID`)
 * is what makes calling this twice for the same order safe: whichever call arrives first wins,
 * the other becomes a no-op that skips the email.
 */
export async function markOrderPaidAndNotify(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: SupabaseClient<any, any, any>,
  { orderId, squareOrderId, squarePaymentId }: { orderId: string; squareOrderId: string; squarePaymentId: string },
): Promise<void> {
  const { data: transitioned, error: updateError } = await supabaseAdmin
    .from("MapleOrder")
    .update({ status: "PAID", squareOrderId, squarePaymentId, updatedAt: new Date().toISOString() })
    .eq("id", orderId)
    .neq("status", "PAID")
    .select("reference, contactName, contactEmail, totalCents, emailSentAt")
    .maybeSingle();

  if (updateError) {
    console.error("[checkout] failed to mark order paid:", updateError);
    return;
  }
  // No row returned means either the order didn't exist, or (far more likely) it was already
  // PAID — the other convergent path (sync response vs. webhook) got there first. Either way,
  // there's nothing further to do here.
  if (!transitioned || transitioned.emailSentAt) return;

  const { data: lines } = await supabaseAdmin
    .from("MapleOrderLine")
    .select(
      "id, productName, categorySlug, colourName, quantity, sizeBreakdown, designProjectId, designSnapshot",
    )
    .eq("orderId", orderId);

  const { subject, html, text } = orderConfirmationEmail({
    reference: transitioned.reference,
    contactName: transitioned.contactName,
    contactEmail: transitioned.contactEmail,
    totalCents: transitioned.totalCents,
    lines: lines ?? [],
  });

  await sendEmail({ to: transitioned.contactEmail, subject, html, text });
  await supabaseAdmin.from("MapleOrder").update({ emailSentAt: new Date().toISOString() }).eq("id", orderId);

  // Staff-facing counterpart — until now a paid order notified *only* the customer. Own try/catch,
  // same isolation style as the n8n-webhook block below: a Resend outage or missing
  // OWNER_NOTIFICATION_EMAIL must never affect the PAID transition or the customer's own email,
  // both of which have already succeeded by this point.
  const ownerEmail = process.env.OWNER_NOTIFICATION_EMAIL;
  if (ownerEmail) {
    try {
      const adminEmail = adminOrderPaidEmail({
        reference: transitioned.reference,
        contactName: transitioned.contactName,
        contactEmail: transitioned.contactEmail,
        totalCents: transitioned.totalCents,
        lines: (lines ?? []).map((l) => ({ productName: l.productName, quantity: l.quantity, colourName: l.colourName })),
      });
      await sendEmail({ to: ownerEmail, ...adminEmail });
    } catch (err) {
      console.error("[checkout] admin paid-order notification failed:", err);
    }
  }

  // Production file export (300dpi PNG + SVG where vector-eligible) for every CUSTOM line —
  // customer's payment confirmation must never wait on this, so each line is triggered
  // fire-and-forget rather than awaited in sequence. Uses the service-role client since there's
  // no customer session cookie available in a webhook/server-to-server context; safe because
  // triggerDesignExport only ever touches the one DesignProject row it's given.
  for (const line of lines ?? []) {
    if (!line.designProjectId) continue;
    triggerDesignExport(supabaseAdmin, line.designProjectId).catch((err) =>
      console.error("[checkout] export trigger failed for line", line.id, err),
    );
  }

  // Separate, best-effort production handoff to n8n — isolated in its own try/catch so an n8n
  // outage (or the env var being unset, e.g. in local dev) never blocks the customer email or the
  // PAID transition above. Each line's designSnapshot already carries every asset URL and layout
  // field n8n needs to build that item's Asset file (logos/PNGs) and Design file (the layout spec)
  // — nothing new had to be captured here, just forwarded.
  const n8nWebhookUrl = process.env.N8N_ORDER_CONFIRMATION_WEBHOOK_URL;
  if (n8nWebhookUrl) {
    try {
      await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          reference: transitioned.reference,
          contactName: transitioned.contactName,
          contactEmail: transitioned.contactEmail,
          totalCents: transitioned.totalCents,
          lines: (lines ?? []).map((line) => ({
            orderLineId: line.id,
            productName: line.productName,
            categorySlug: line.categorySlug,
            colourName: line.colourName,
            quantity: line.quantity,
            sizeBreakdown: line.sizeBreakdown,
            designProjectId: line.designProjectId,
            designSnapshot: line.designSnapshot,
          })),
        }),
      });
    } catch (err) {
      console.error("[checkout] n8n order-confirmation webhook failed:", err);
    }
  }
}
