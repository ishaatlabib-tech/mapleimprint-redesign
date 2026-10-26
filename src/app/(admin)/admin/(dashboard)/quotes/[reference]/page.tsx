import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/server/supabaseAdmin";
import { buildFileInventory } from "@/lib/admin/fileInventory";
import { LineFileCard } from "@/components/admin/LineFileCard";

export default async function AdminQuoteDetailPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const supabaseAdmin = createAdminClient();

  const { data: quote } = await supabaseAdmin
    .from("QuoteRequest")
    .select(
      "id, reference, status, contactName, contactEmail, contactPhone, organization, productDescription, quantity, budgetRange, message, score, tags, createdAt",
    )
    .eq("reference", reference)
    .maybeSingle();

  if (!quote) notFound();

  const { data: lines } = await supabaseAdmin
    .from("QuoteRequestLine")
    .select("productName, colourName, quantity, customizationType, designProjectId, designSnapshot, assistanceBrief")
    .eq("quoteRequestId", quote.id);

  const inventory = await buildFileInventory(supabaseAdmin, lines ?? []);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900">Quote {quote.reference}</h1>
          <p className="mt-1 text-sm text-muted">
            {quote.contactName} · {quote.contactEmail}
            {quote.contactPhone ? ` · ${quote.contactPhone}` : ""}
            {quote.organization ? ` · ${quote.organization}` : ""}
          </p>
          {quote.productDescription && <p className="mt-2 text-sm text-ink-900">{quote.productDescription}</p>}
          {quote.message && <p className="mt-1 text-sm text-muted">{quote.message}</p>}
        </div>
        <div className="text-right">
          <span className="rounded-full bg-sand px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-900">
            {quote.status}
          </span>
          <p className="mt-2 text-sm text-muted">Score {quote.score}</p>
          <a
            href={`/api/admin/quotes/${quote.reference}/zip`}
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
        {inventory.length === 0 && <p className="text-sm text-muted">No structured lines on this quote.</p>}
      </div>

      <Link href="/admin/quotes" className="mt-8 inline-block text-sm text-muted hover:text-ink-900">
        ← Back to quotes
      </Link>
    </div>
  );
}
