import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { createAdminClient } from "@/lib/server/supabaseAdmin";
import { buildFileInventory } from "@/lib/admin/fileInventory";

/**
 * `reference` is a high-entropy, non-sequential token (see generateQuoteReference.ts) — it IS the
 * access control for this page, since it reads via the service-role client. Same security model
 * as src/app/(site)/order/[reference]/confirmation/page.tsx: do not add a lookup that also works
 * by internal id, and never list/enumerate quotes from this route.
 *
 * Customer-facing, so only ever shows the customer's own uploaded originals and the composited
 * preview image — never the 300dpi production files (those are for the print shop, not the
 * customer) and never a fabricated design for a line that's genuinely design-less (Designer's
 * Choice before Maple has actually designed anything).
 */
export default async function QuoteStatusPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const supabaseAdmin = createAdminClient();

  const { data: quote } = await supabaseAdmin
    .from("QuoteRequest")
    .select("id, reference, status, contactName, contactEmail, productDescription, createdAt")
    .eq("reference", reference)
    .maybeSingle();

  if (!quote) {
    return (
      <Container className="max-w-lg py-24 text-center">
        <h1 className="font-display text-2xl font-semibold text-ink-900">Quote not found</h1>
        <p className="mt-3 text-sm text-muted">
          We couldn&apos;t find a quote request with that reference. Double-check the link, or{" "}
          <Link href="/contact" className="underline underline-offset-2">
            contact us
          </Link>{" "}
          if you think this is a mistake.
        </p>
      </Container>
    );
  }

  const { data: lines } = await supabaseAdmin
    .from("QuoteRequestLine")
    .select("productName, colourName, quantity, customizationType, designProjectId, designSnapshot, assistanceBrief")
    .eq("quoteRequestId", quote.id);

  const inventory = await buildFileInventory(supabaseAdmin, lines ?? []);
  const firstName = quote.contactName.split(" ")[0] || quote.contactName;

  return (
    <Container className="max-w-lg py-16 text-center lg:py-24">
      <h1 className="font-display text-2xl font-semibold text-ink-900 lg:text-3xl">Quote request received</h1>
      <p className="mt-2 text-sm font-semibold text-ink-900">{quote.reference}</p>
      <p className="mt-4 text-sm text-muted">
        Thanks, {firstName}. Status: <span className="font-semibold text-ink-900">{quote.status}</span>
      </p>

      <div className="mt-8 space-y-4 text-left">
        {inventory.map((line) => (
          <div key={line.lineIndex} className="rounded-[24px] bg-white p-6">
            <h2 className="font-display text-base font-semibold text-ink-900">
              {line.productName}
              {line.colourName ? ` (${line.colourName})` : ""} × {line.quantity}
            </h2>

            {line.assistanceBrief && (
              <p className="mt-2 text-sm text-muted">We&apos;ll design this one for you — no preview yet.</p>
            )}

            {line.preview.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-3">
                {line.preview.map((p) => (
                  <li key={p.sideType}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL */}
                    <img src={p.url} alt={`${p.sideType} preview`} className="h-28 w-28 rounded-xl object-cover" />
                  </li>
                ))}
              </ul>
            )}

            {line.assets.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your uploaded files</p>
                <ul className="mt-1 space-y-1">
                  {line.assets.map((a) => (
                    <li key={a.url}>
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-sm text-ink-900 underline-offset-2 hover:underline">
                        {a.originalFileName}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!line.assistanceBrief && line.assets.length === 0 && line.preview.length === 0 && (
              <p className="mt-2 text-sm text-muted">No design yet.</p>
            )}
          </div>
        ))}
      </div>

      <Link href="/shop" className="mt-8 inline-block rounded-full bg-maple-gradient px-6 py-3 text-sm font-semibold text-ink-950">
        Continue shopping
      </Link>
    </Container>
  );
}
