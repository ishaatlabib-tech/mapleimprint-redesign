-- Real QuoteRequest backend for the "Request a Quote" checkout flow.
--
-- Problem: POST /api/quote today only writes a Google Sheets row and fires best-effort email/
-- Telegram notifications — there is no database row at all behind a quote. The "reference" shown
-- to the customer is a Sheets-row-count string (src/lib/automation/reference.ts), not a lookup
-- key into anything queryable, and nothing prevents a double-submission from creating two
-- references for the same request.
--
-- Fix: a real QuoteRequest/QuoteRequestLine pair, modeled as a near-mirror of MapleOrder/
-- MapleOrderLine (002_maple_orders.sql) so a future "convert this quote into an order" flow is a
-- near-direct copy rather than a translation layer. Same deny-all RLS model as MapleOrder — this
-- table holds customer PII (name/email/phone), every access path is server-only through
-- src/lib/server/supabaseAdmin.ts (service-role key, bypasses RLS entirely).
--
-- Columns mirror NormalizedInquiry (src/lib/automation/types.ts) field-for-field — nothing
-- invented beyond what the quote wizard already collects.
--
-- Apply against the `maple-imprint-catalogue` Supabase project (ovqkwedpwmuusnijbxro), same
-- out-of-band process as 001/002.

create table if not exists "QuoteRequest" (
  id uuid primary key default gen_random_uuid(),
  -- MI-YYYYMMDD-#### format, kept for continuity with the existing Sheets/email reference shown
  -- to customers, but now backed by a real unique column instead of a Sheets-row-count guess.
  reference text not null unique,
  status text not null default 'SUBMITTED'
    check (status in ('SUBMITTED', 'REVIEWING', 'QUOTED', 'WON', 'LOST', 'CANCELLED')),

  "contactName" text not null,
  "contactEmail" text not null,
  "contactPhone" text null,
  organization text null,
  "preferredContact" text null,
  "projectType" text null,
  "productDescription" text null,
  quantity text null,
  "budgetRange" text null,
  "decorationMethod" text null,
  placements text null,
  "designHelp" boolean not null default false,
  message text null,
  "neededBy" text null,
  "eventDate" text null,
  "deliveryMethod" text null,
  "postalCode" text null,

  -- Carried over from the existing scoreInquiry() output — queryable now instead of living only
  -- in a Sheets row/email.
  score integer null,
  tags text[] null,

  -- Generated once per wizard submission attempt (crypto.randomUUID(), reused across retries) so
  -- a double-click or a lost-response retry can't create two QuoteRequest rows. Nullable so this
  -- migration doesn't require backfilling anything; new application code always sends one.
  "idempotencyKey" text null,

  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create unique index if not exists "QuoteRequest_idempotencyKey_key" on "QuoteRequest" ("idempotencyKey")
  where "idempotencyKey" is not null;

create table if not exists "QuoteRequestLine" (
  id uuid primary key default gen_random_uuid(),
  "quoteRequestId" uuid not null references "QuoteRequest"(id) on delete cascade,
  -- The CartItem.id string this line came from — traceability only, not a foreign key (cart is
  -- client-side/localStorage, has no server row). Same convention as MapleOrderLine.cartItemId.
  "cartItemId" text null,
  "productName" text not null,
  "categorySlug" text null,
  "subcategorySlug" text null,
  "productSlug" text null,
  "colourName" text null,
  "sizeBreakdown" jsonb null,
  quantity integer null,
  -- "BLANK" | "CUSTOM" | "MAPLE_DESIGNER" | null (null for quote-only products with no Studio
  -- customization concept at all, e.g. QuoteOnlyConfigurator-backed products).
  "customizationType" text null,

  -- Studio-backed line (CUSTOM): same denormalization MapleOrderLine already does for paid
  -- orders. Nullable because a quote-only product or a no-Studio apparel quote has no
  -- DesignProject at all — never synthesize a fake one to satisfy a NOT NULL here.
  "designProjectId" uuid null,
  "designFrozenRevision" integer null,
  "designSnapshot" jsonb null,

  -- Mystery/Designer's Choice brief (MAPLE_DESIGNER): the customer's creative intent, no formal
  -- design exists yet. Deliberately not constrained mutually-exclusive with designProjectId — a
  -- later "designer actually built something off this brief" state could plausibly have both.
  "assistanceBrief" jsonb null,

  "createdAt" timestamptz not null default now()
);

create index if not exists "QuoteRequestLine_quoteRequestId_idx" on "QuoteRequestLine" ("quoteRequestId");

alter table "QuoteRequest" enable row level security;
alter table "QuoteRequestLine" enable row level security;
-- Deliberately no policies created for anon/authenticated — deny-all, same rationale as
-- MapleOrder/MapleOrderLine in 002_maple_orders.sql. Service-role connections
-- (src/lib/server/supabaseAdmin.ts) bypass RLS entirely and are the only intended access path.
