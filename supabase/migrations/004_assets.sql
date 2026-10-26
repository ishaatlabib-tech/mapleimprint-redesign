-- Independent Asset tracking for every original customer upload.
--
-- Problem: DesignObject.assetUrl is a flat Supabase Storage URL with no backing row — there is no
-- "original upload" entity at all. When background removal (POST /api/studio/remove-background)
-- produces a derivative, StudioClient's acceptRemovedBackground() overwrites the design object's
-- assetUrl with the no-bg URL; the pre-removal original blob still exists in the design-uploads
-- bucket, but nothing references it anymore once that happens — it's orphaned, not traceable.
--
-- Fix: a real Asset row per upload (and per derivative), independent of what any DesignObject
-- currently points at. kind='derived' rows link back to their source via derivedFromAssetId, so
-- the pre-removal original stays traceable regardless of what the live design currently shows.
--
-- Security model: same session-scoped RLS trust boundary as DesignProject/DesignSide/DesignObject
-- (uploads happen anonymously pre-checkout via the x-mi-session cookie, same low-stakes trust
-- boundary as the design rows describing them) — NOT the deny-all regime QuoteRequest/MapleOrder
-- use. Accessed through src/lib/studio/supabaseClient.ts's createStudioClient(sessionToken), not
-- the service-role client.
--
-- Policy predicate copied verbatim from the live "owner_all" policy on DesignProject (confirmed
-- via `select qual from pg_policies where tablename = 'DesignProject'` against the
-- maple-imprint-catalogue project, 2026-10-26) rather than reconstructed from documentation, so
-- Asset is scoped identically to its siblings.
--
-- Apply against the `maple-imprint-catalogue` Supabase project (ovqkwedpwmuusnijbxro), same
-- out-of-band process as 001/002/003.

create table if not exists "Asset" (
  id uuid primary key default gen_random_uuid(),
  -- Owning anonymous session — same value as DesignProject.ownerSession, matched against the
  -- x-mi-session header by RLS below. Not a foreign key (no Session table exists).
  "ownerSession" text not null,
  "originalFileName" text not null,
  "storageBucket" text not null default 'design-uploads',
  "storagePath" text not null,
  -- getPublicUrl snapshot at upload time — the bucket is public, so this is stable; kept
  -- denormalized so a reader never has to re-derive it.
  "publicUrl" text not null,
  "declaredMimeType" text null,
  -- Magic-byte-sniffed actual type (src/lib/uploads/detectFileType.ts) — what the file really is,
  -- not what the browser/form claimed.
  "detectedMimeType" text null,
  "fileSizeBytes" integer not null,
  -- "upload" = original customer upload (Studio canvas image, or quote-flow attachment).
  -- "derived" = a processed version of another Asset (today: background-removal output).
  kind text not null default 'upload' check (kind in ('upload', 'derived')),
  "derivedFromAssetId" uuid null references "Asset"(id) on delete set null,
  "derivationType" text null,
  "createdAt" timestamptz not null default now()
);

create index if not exists "Asset_ownerSession_idx" on "Asset" ("ownerSession");
create index if not exists "Asset_derivedFromAssetId_idx" on "Asset" ("derivedFromAssetId");

alter table "Asset" enable row level security;

create policy "owner_all_asset" on "Asset"
  for all
  using ("ownerSession" = (current_setting('request.headers', true)::json ->> 'x-mi-session'))
  with check ("ownerSession" = (current_setting('request.headers', true)::json ->> 'x-mi-session'));

-- Links an image/qr-logo DesignObject back to the Asset row that tracks its original upload.
-- Unlike qrAssetId (which is collapsed into DesignObject.content as JSON, not a real column —
-- see types.ts's comment on why QR fields never got dedicated columns), this is a genuine new
-- column: image objects don't already repurpose `content` for anything, so there's no existing
-- packing convention to follow, and a real column is directly queryable for the admin/export work
-- in later phases without needing to parse JSON out of `content` first.
alter table "DesignObject"
  add column if not exists "assetId" uuid null references "Asset"(id) on delete set null;
