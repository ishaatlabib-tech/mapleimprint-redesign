-- Customer-preview-file tracking on DesignProject, alongside the existing production exportedFiles.
--
-- Problem: the spec's four file categories are Asset / Design / Production / Customer Preview.
-- The first three are real; "Customer Preview" wasn't. DesignProject.mockupImages is just the
-- catalogue's blank product photo (same for every customer who picks that colour), and the only
-- rendering of the customer's actual design (renderDesignToCanvas.ts) happens live in-browser and
-- is never captured or saved anywhere.
--
-- Fix: a second render pass (src/lib/studio/renderPreview.ts), composited (non-transparent) and
-- web-sized rather than 300dpi, run alongside the existing production export in
-- src/lib/studio/exportDesign.ts. Tracked separately from exportedFiles/exportStatus since a
-- preview failing to render should never block/confuse the production-readiness signal.
--
-- Apply against the `maple-imprint-catalogue` Supabase project (ovqkwedpwmuusnijbxro), same
-- out-of-band process as 001-005.

alter table "DesignProject"
  -- Shape once populated: { [sideType]: { url: string } }
  add column if not exists "previewFiles" jsonb null;
