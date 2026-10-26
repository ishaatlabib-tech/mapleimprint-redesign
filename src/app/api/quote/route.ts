import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { appendInquiryRow } from "@/lib/automation/sheets";
import { notifyInquiry } from "@/lib/automation/notify";
import { scoreInquiry } from "@/lib/automation/scoring";
import { generateQuoteReference } from "@/lib/checkout/generateQuoteReference";
import { createAdminClient } from "@/lib/server/supabaseAdmin";
import { createStudioClient } from "@/lib/studio/supabaseClient";
import { STUDIO_SESSION_COOKIE } from "@/lib/studio/session";
import { freezeDesignProject } from "@/lib/studio/freeze";
import { triggerDesignExport } from "@/lib/studio/exportDesign";
import type { NormalizedInquiry } from "@/lib/automation/types";

type UploadedFile = { fileId: string; fileName: string; webViewLink: string | null };

interface QuoteCartLine {
  cartItemId?: string;
  name?: string;
  quantity?: number;
  categorySlug?: string;
  categoryName?: string;
  colourName?: string;
  sizeBreakdown?: { size: string; qty: number }[];
  customizationType?: "BLANK" | "CUSTOM" | "MAPLE_DESIGNER" | null;
  designProjectId?: string;
  designFrozenRevision?: number;
  assistanceBrief?: unknown;
  productSlug?: string;
  subcategorySlug?: string;
}

function str(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = str(body, "email");
  const name = str(body, "name");
  if (!email || !name) {
    return NextResponse.json(
      { error: "Name and email are required to submit a quote request." },
      { status: 422 },
    );
  }

  const idempotencyKey = str(body, "idempotencyKey");
  if (!idempotencyKey) {
    return NextResponse.json({ error: "Missing idempotency key." }, { status: 400 });
  }

  const cartLines: QuoteCartLine[] = Array.isArray(body.cartLines) ? (body.cartLines as QuoteCartLine[]) : [];
  const uploadedFiles: UploadedFile[] = Array.isArray(body.uploadedFiles)
    ? (body.uploadedFiles as UploadedFile[]).filter(
        (f) => f && typeof f.fileId === "string" && typeof f.fileName === "string",
      )
    : [];

  const admin = createAdminClient();

  // Idempotency check first, same pattern as /api/checkout/pay's PaymentAttempt lookup — a
  // double-click or a lost-response retry reuses the same key, so this recognizes the
  // resubmission and skips straight to returning the already-created reference rather than
  // creating a second QuoteRequest (and re-running the Sheets/email/Telegram side effects).
  const { data: existing } = await admin
    .from("QuoteRequest")
    .select("reference")
    .eq("idempotencyKey", idempotencyKey)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ reference: existing.reference });
  }

  const inquiry: NormalizedInquiry = {
    source: "quote",
    name,
    email,
    organization: str(body, "organization") || undefined,
    phone: str(body, "phone") || undefined,
    preferredContact: str(body, "preferredContact") || undefined,
    projectType: str(body, "projectType") || undefined,
    productDescription: str(body, "productDescription") || undefined,
    quantity: str(body, "quantity") || undefined,
    budgetRange: str(body, "budgetRange") || undefined,
    decorationMethod: str(body, "decorationMethod") || undefined,
    placements: str(body, "placements") || undefined,
    designHelp: body.designHelp === true,
    neededBy: str(body, "neededBy") || undefined,
    eventDate: str(body, "eventDate") || undefined,
    deliveryMethod: str(body, "deliveryMethod") || undefined,
    postalCode: str(body, "postalCode") || undefined,
    fileNames: uploadedFiles.map((f) => f.fileName),
  };

  const { score, tags } = scoreInquiry(inquiry);

  // Wrapped in a small retry loop against the table's real unique constraint on `reference` —
  // generateQuoteReference's own count-based candidate can still race under concurrent
  // submissions on the same day; a 23505 here means another request claimed that exact reference
  // between the candidate check and this insert, so just roll a new one and try again.
  let quoteRequest: { id: string } | null = null;
  let reference = "";
  for (let attempt = 0; attempt < 3 && !quoteRequest; attempt++) {
    reference = await generateQuoteReference(admin);
    const { data, error: insertError } = await admin
      .from("QuoteRequest")
      .insert({
        reference,
        idempotencyKey,
        contactName: inquiry.name,
        contactEmail: inquiry.email,
        contactPhone: inquiry.phone ?? null,
        organization: inquiry.organization ?? null,
        preferredContact: inquiry.preferredContact ?? null,
        projectType: inquiry.projectType ?? null,
        productDescription: inquiry.productDescription ?? null,
        quantity: inquiry.quantity ?? null,
        budgetRange: inquiry.budgetRange ?? null,
        decorationMethod: inquiry.decorationMethod ?? null,
        placements: inquiry.placements ?? null,
        designHelp: inquiry.designHelp ?? false,
        neededBy: inquiry.neededBy ?? null,
        eventDate: inquiry.eventDate ?? null,
        deliveryMethod: inquiry.deliveryMethod ?? null,
        postalCode: inquiry.postalCode ?? null,
        score,
        tags,
      })
      .select("id")
      .single();

    if (data) {
      quoteRequest = data;
    } else if (insertError?.code !== "23505") {
      console.error("[quote] QuoteRequest insert failed:", insertError);
      return NextResponse.json({ error: "Couldn't submit your quote request. Please try again." }, { status: 502 });
    }
    // code === "23505": reference collision — loop and try a fresh one.
  }

  if (!quoteRequest) {
    return NextResponse.json({ error: "Couldn't submit your quote request. Please try again." }, { status: 502 });
  }

  // Studio-backed lines need the customer's own session to read/freeze their DesignProject (that
  // table is session-scoped RLS, not deny-all like QuoteRequest) — best-effort: a missing/expired
  // cookie just means those lines get inserted without a snapshot rather than failing the whole
  // submission, since the quote itself (contact info, description, uploaded files) is still valid
  // and worth capturing regardless.
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(STUDIO_SESSION_COOKIE)?.value;
  const studioClient = sessionToken ? createStudioClient(sessionToken) : null;

  const linesToExport: string[] = [];
  for (const line of cartLines) {
    let designSnapshot: unknown = null;
    let designFrozenRevision = line.designFrozenRevision ?? null;

    if (line.designProjectId && line.customizationType === "CUSTOM") {
      if (studioClient) {
        // Defensive — CUSTOM items normally only reach the cart already frozen (handleApproveAndAddToCart
        // freezes before addItem), so this is expected to be a no-op read in the common case, not a
        // fresh freeze.
        const freezeResult = await freezeDesignProject(studioClient, line.designProjectId);
        if (freezeResult.ok) {
          designSnapshot = freezeResult.designSnapshot;
          designFrozenRevision = freezeResult.frozenRevision;
          linesToExport.push(line.designProjectId);
        } else {
          console.error("[quote] couldn't freeze design project", line.designProjectId, freezeResult.error);
        }
      } else {
        console.error("[quote] CUSTOM line has no session cookie to read its design:", line.designProjectId);
      }
    }

    const { error: lineError } = await admin.from("QuoteRequestLine").insert({
      quoteRequestId: quoteRequest.id,
      cartItemId: line.cartItemId ?? null,
      productName: line.name ?? "Untitled item",
      categorySlug: line.categorySlug ?? null,
      subcategorySlug: line.subcategorySlug ?? null,
      productSlug: line.productSlug ?? null,
      colourName: line.colourName ?? null,
      sizeBreakdown: line.sizeBreakdown ?? null,
      quantity: line.quantity ?? null,
      customizationType: line.customizationType ?? null,
      designProjectId: line.designProjectId ?? null,
      designFrozenRevision,
      designSnapshot,
      assistanceBrief: line.assistanceBrief ?? null,
    });
    if (lineError) console.error("[quote] QuoteRequestLine insert failed:", lineError);
  }

  // Fire-and-forget — the customer's submit response must never wait on production file
  // generation. Uses the same session-scoped client that successfully froze each design above.
  if (studioClient) {
    for (const designProjectId of linesToExport) {
      triggerDesignExport(studioClient, designProjectId).catch((err) =>
        console.error("[quote] export trigger failed:", err),
      );
    }
  }

  // Existing Sheets/email/Telegram notifications — kept exactly as before, just run after the
  // real DB insert succeeds rather than being the only persistence at all.
  const scored = { ...inquiry, reference, score, tags };
  const fileLinks = uploadedFiles.map((f) => f.webViewLink).filter((l): l is string => Boolean(l));
  await appendInquiryRow(scored, fileLinks);
  await notifyInquiry(scored);

  return NextResponse.json({ reference });
}
