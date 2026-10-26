import { BUSINESS, BUSINESS_ADDRESS_ONE_LINE, SITE_URL } from "@/lib/constants";
import type { ScoredInquiry } from "../types";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function summaryLines(inquiry: ScoredInquiry): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [{ label: "Reference", value: inquiry.reference }];
  if (inquiry.projectType) lines.push({ label: "Project type", value: inquiry.projectType });
  if (inquiry.productDescription) lines.push({ label: "Product", value: inquiry.productDescription });
  if (inquiry.quantity) lines.push({ label: "Quantity", value: inquiry.quantity });
  if (inquiry.neededBy) lines.push({ label: "Needed by", value: inquiry.neededBy });
  if (inquiry.message) lines.push({ label: "Message", value: inquiry.message });
  return lines;
}

const SOURCE_LABEL: Record<ScoredInquiry["source"], string> = {
  quote: "quote request",
  contact: "general inquiry",
  appointment: "appointment request",
};

export function customerConfirmationEmail(
  inquiry: ScoredInquiry,
  opts: { statusUrl?: string } = {},
): { subject: string; html: string; text: string } {
  const firstName = inquiry.name.split(" ")[0] || inquiry.name;
  const lines = summaryLines(inquiry);
  const subject = "We've received your request!";

  const text = [
    `Hello ${firstName},`,
    "",
    `Thank you for contacting ${BUSINESS.name}. We've received your ${SOURCE_LABEL[inquiry.source]} and our team will review the details.`,
    "You'll typically hear back within one business day.",
    "",
    ...lines.map((l) => `${l.label}: ${l.value}`),
    "",
    ...(opts.statusUrl ? [`View your request: ${opts.statusUrl}`, ""] : []),
    `${BUSINESS.name}`,
    BUSINESS.phoneDisplay,
    SITE_URL,
    BUSINESS_ADDRESS_ONE_LINE,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;color:#1a1a1a;max-width:520px;margin:0 auto;">
      <p>Hello ${escapeHtml(firstName)},</p>
      <p>Thank you for contacting <strong>${escapeHtml(BUSINESS.name)}</strong>. We've received your
        ${escapeHtml(SOURCE_LABEL[inquiry.source])} and our team will review the details.</p>
      <p>You'll typically hear back within one business day.</p>
      <table cellpadding="6" cellspacing="0" style="width:100%;background:#f7f4ef;border-radius:8px;margin:16px 0;">
        ${lines
          .map(
            (l) =>
              `<tr><td style="font-weight:600;white-space:nowrap;">${escapeHtml(l.label)}</td><td>${escapeHtml(l.value)}</td></tr>`,
          )
          .join("")}
      </table>
      ${opts.statusUrl ? `<p><a href="${opts.statusUrl}">View your request &amp; files</a></p>` : ""}
      <p style="margin-top:24px;">
        ${escapeHtml(BUSINESS.name)}<br/>
        ${escapeHtml(BUSINESS.phoneDisplay)}<br/>
        <a href="${SITE_URL}">${SITE_URL}</a><br/>
        ${escapeHtml(BUSINESS_ADDRESS_ONE_LINE)}
      </p>
    </div>
  `;

  return { subject, html, text };
}

interface OrderConfirmationInput {
  reference: string;
  contactName: string;
  contactEmail: string;
  totalCents: number;
  lines: { productName: string; quantity: number; colourName: string | null }[];
}

export function orderConfirmationEmail(order: OrderConfirmationInput): { subject: string; html: string; text: string } {
  const firstName = order.contactName.split(" ")[0] || order.contactName;
  const total = `$${(order.totalCents / 100).toFixed(2)}`;
  const subject = `Order confirmed — ${order.reference}`;
  const confirmationUrl = `${SITE_URL}/order/${order.reference}/confirmation`;

  const itemLines = order.lines.map((l) => `${l.productName}${l.colourName ? ` (${l.colourName})` : ""} × ${l.quantity}`);

  const text = [
    `Hi ${firstName},`,
    "",
    `Thanks — we've received your order and payment.`,
    "",
    `Order: ${order.reference}`,
    `Total paid: ${total}`,
    "",
    "Items:",
    ...itemLines.map((l) => `- ${l}`),
    "",
    "What happens next: your design(s) move into production preparation, then printing, then shipping.",
    "We'll be in touch if we need anything from you.",
    "",
    `View your order & files: ${confirmationUrl}`,
    "",
    `${BUSINESS.name}`,
    BUSINESS.phoneDisplay,
    SITE_URL,
    BUSINESS_ADDRESS_ONE_LINE,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;color:#1a1a1a;max-width:520px;margin:0 auto;">
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>Thanks — we've received your order and payment.</p>
      <table cellpadding="6" cellspacing="0" style="width:100%;background:#f7f4ef;border-radius:8px;margin:16px 0;">
        <tr><td style="font-weight:600;white-space:nowrap;">Order</td><td>${escapeHtml(order.reference)}</td></tr>
        <tr><td style="font-weight:600;white-space:nowrap;">Total paid</td><td>${escapeHtml(total)}</td></tr>
        <tr><td style="font-weight:600;white-space:nowrap;vertical-align:top;">Items</td><td>${itemLines.map(escapeHtml).join("<br/>")}</td></tr>
      </table>
      <p>What happens next: your design(s) move into production preparation, then printing, then shipping. We'll
        be in touch if we need anything from you.</p>
      <p><a href="${confirmationUrl}">View your order &amp; files</a></p>
      <p style="margin-top:24px;">
        ${escapeHtml(BUSINESS.name)}<br/>
        ${escapeHtml(BUSINESS.phoneDisplay)}<br/>
        <a href="${SITE_URL}">${SITE_URL}</a><br/>
        ${escapeHtml(BUSINESS_ADDRESS_ONE_LINE)}
      </p>
    </div>
  `;

  return { subject, html, text };
}

interface AdminOrderPaidInput {
  reference: string;
  contactName: string;
  contactEmail: string;
  totalCents: number;
  lines: { productName: string; quantity: number; colourName: string | null }[];
}

/** Staff-facing counterpart to orderConfirmationEmail above — until now, a paid order notified
 *  *only* the customer; staff had no signal a new order existed at all short of checking Square
 *  directly. Links to the new /admin/orders/[reference] detail page. */
export function adminOrderPaidEmail(order: AdminOrderPaidInput): { subject: string; html: string; text: string } {
  const total = `$${(order.totalCents / 100).toFixed(2)}`;
  const subject = `New paid order — ${order.reference} (${order.contactName})`;
  const adminUrl = `${SITE_URL}/admin/orders/${order.reference}`;
  const itemLines = order.lines.map((l) => `${l.productName}${l.colourName ? ` (${l.colourName})` : ""} × ${l.quantity}`);

  const text = [
    `New paid order: ${order.reference}`,
    `Customer: ${order.contactName} (${order.contactEmail})`,
    `Total: ${total}`,
    "",
    "Items:",
    ...itemLines.map((l) => `- ${l}`),
    "",
    `Manage: ${adminUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;">
      <h2 style="margin-bottom:12px;">New paid order</h2>
      <table cellpadding="6" cellspacing="0" style="width:100%;">
        <tr><td style="font-weight:600;white-space:nowrap;">Reference</td><td>${escapeHtml(order.reference)}</td></tr>
        <tr><td style="font-weight:600;white-space:nowrap;">Customer</td><td>${escapeHtml(order.contactName)} (${escapeHtml(order.contactEmail)})</td></tr>
        <tr><td style="font-weight:600;white-space:nowrap;">Total</td><td>${escapeHtml(total)}</td></tr>
        <tr><td style="font-weight:600;white-space:nowrap;vertical-align:top;">Items</td><td>${itemLines.map(escapeHtml).join("<br/>")}</td></tr>
      </table>
      <p style="margin-top:16px;"><a href="${adminUrl}">View order & files</a></p>
    </div>
  `;

  return { subject, html, text };
}

export function ownerNotificationEmail(inquiry: ScoredInquiry): { subject: string; html: string; text: string } {
  const subject = `New ${SOURCE_LABEL[inquiry.source]} — ${inquiry.name}${inquiry.organization ? ` (${inquiry.organization})` : ""} — score ${inquiry.score}`;

  const rows: { label: string; value: string }[] = [
    { label: "Reference", value: inquiry.reference },
    { label: "Score", value: String(inquiry.score) },
    { label: "Tags", value: inquiry.tags.join(", ") || "none" },
    { label: "Customer", value: inquiry.name },
    ...(inquiry.organization ? [{ label: "Company", value: inquiry.organization }] : []),
    { label: "Email", value: inquiry.email },
    ...(inquiry.phone ? [{ label: "Phone", value: inquiry.phone }] : []),
    ...(inquiry.projectType ? [{ label: "Project type", value: inquiry.projectType }] : []),
    ...(inquiry.productDescription ? [{ label: "Product", value: inquiry.productDescription }] : []),
    ...(inquiry.quantity ? [{ label: "Quantity", value: inquiry.quantity }] : []),
    ...(inquiry.budgetRange ? [{ label: "Budget", value: inquiry.budgetRange }] : []),
    ...(inquiry.neededBy ? [{ label: "Deadline", value: inquiry.neededBy }] : []),
    ...(inquiry.message ? [{ label: "Message", value: inquiry.message }] : []),
    ...(inquiry.fileNames && inquiry.fileNames.length > 0
      ? [{ label: "Attachments", value: inquiry.fileNames.join(", ") }]
      : []),
    // Only quotes have an admin detail page today (contact/appointment inquiries have no
    // QuoteRequest row behind them) — see src/app/(admin)/admin/quotes/[reference]/page.tsx.
    ...(inquiry.source === "quote" ? [{ label: "Manage", value: `${SITE_URL}/admin/quotes/${inquiry.reference}` }] : []),
  ];

  const text = rows.map((r) => `${r.label}: ${r.value}`).join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;">
      <h2 style="margin-bottom:12px;">New ${escapeHtml(SOURCE_LABEL[inquiry.source])}</h2>
      <table cellpadding="6" cellspacing="0" style="width:100%;">
        ${rows
          .map(
            (r) =>
              `<tr><td style="font-weight:600;white-space:nowrap;vertical-align:top;">${escapeHtml(r.label)}</td><td>${escapeHtml(r.value)}</td></tr>`,
          )
          .join("")}
      </table>
    </div>
  `;

  return { subject, html, text };
}
