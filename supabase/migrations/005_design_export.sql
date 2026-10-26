-- Production-file export status tracking on DesignProject.
--
-- Problem: there is no production-ready export capability anywhere in the app today —
-- renderDesignToCanvas.ts is browser-only and feeds nothing but an in-memory 3D-preview texture.
-- A real exporter (src/lib/studio/exportDesign.ts) runs server-side, asynchronously relative to
-- freeze/order-paid/quote-submitted, and must never silently claim a file is ready before it is.
--
-- Fix: explicit status tracking, set to PENDING at freeze time, PROCESSING while the export route
-- runs, and only READY once real files exist in storage. FAILED (with a human-readable reason) on
-- any error — this field is what "never label missing or ungenerated files as ready" means in
-- practice: a caller must check exportStatus === 'READY' before trusting exportedFiles.
--
-- Apply against the `maple-imprint-catalogue` Supabase project (ovqkwedpwmuusnijbxro), same
-- out-of-band process as 001/002/003/004.

alter table "DesignProject"
  add column if not exists "exportStatus" text null
    check ("exportStatus" in ('PENDING', 'PROCESSING', 'READY', 'FAILED')),
  -- Shape once populated: { [sideType]: { pngUrl: string, svgUrl: string | null, pngDpi: number } }
  add column if not exists "exportedFiles" jsonb null,
  add column if not exists "exportError" text null,
  add column if not exists "exportedAt" timestamptz null;
