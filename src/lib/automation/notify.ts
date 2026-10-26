import { sendEmail } from "./email/resend";
import { customerConfirmationEmail, ownerNotificationEmail } from "./email/templates";
import { sendTelegramMessage } from "./telegram";
import { SITE_URL } from "@/lib/constants";
import type { ScoredInquiry } from "./types";

/**
 * Fires customer confirmation + owner email + Telegram notification.
 * Best-effort: each channel is isolated with its own try/catch so a failure
 * in one (or a missing env var) never surfaces to the customer as a broken
 * submission — the inquiry is already saved by the time this runs.
 */
export async function notifyInquiry(inquiry: ScoredInquiry): Promise<void> {
  const ownerEmail = process.env.OWNER_NOTIFICATION_EMAIL;

  await Promise.allSettled([
    (async () => {
      // Only quotes get a status page (/quote/[reference]/status) today — contact/appointment
      // inquiries have no QuoteRequest row or files behind them to show.
      const statusUrl = inquiry.source === "quote" ? `${SITE_URL}/quote/${inquiry.reference}/status` : undefined;
      const { subject, html, text } = customerConfirmationEmail(inquiry, { statusUrl });
      await sendEmail({ to: inquiry.email, subject, html, text });
    })(),
    (async () => {
      if (!ownerEmail) return;
      const { subject, html, text } = ownerNotificationEmail(inquiry);
      await sendEmail({ to: ownerEmail, subject, html, text });
    })(),
    (async () => {
      const lines = [
        `New ${inquiry.source} — score ${inquiry.score}`,
        `Reference: ${inquiry.reference}`,
        `${inquiry.name}${inquiry.organization ? ` (${inquiry.organization})` : ""}`,
        inquiry.email,
        inquiry.phone ?? "",
        inquiry.tags.length ? `Tags: ${inquiry.tags.join(", ")}` : "",
      ].filter(Boolean);
      await sendTelegramMessage(lines.join("\n"));
    })(),
  ]);
}
