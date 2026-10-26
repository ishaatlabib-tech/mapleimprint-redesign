import type { LineFileInventory } from "@/lib/admin/fileInventory";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Shared by the admin order and quote detail pages — one line's worth of the four file
 *  categories (Asset/Design/Production/Preview), or the Designer's Choice brief when there's no
 *  design at all yet (never fabricated, see buildFileInventory). */
export function LineFileCard({ line }: { line: LineFileInventory }) {
  const hasDesign = Boolean(line.designProjectId);
  const hasBrief = Boolean(line.assistanceBrief);
  // Designer's Choice lines have no design project, but can still have a real uploaded asset
  // (assistanceBrief.uploadedAssetId, resolved by buildFileInventory independent of
  // designProjectId) — so the asset list has to be able to show up even when hasDesign is false.
  const hasAssets = line.assets.length > 0;

  return (
    <div className="rounded-[24px] bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink-900">
          {line.productName}
          {line.colourName ? ` (${line.colourName})` : ""} × {line.quantity}
        </h2>
        {line.customizationType && (
          <span className="rounded-full bg-sand px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-900">
            {line.customizationType}
          </span>
        )}
      </div>

      {!hasDesign && !hasBrief && !hasAssets && <p className="mt-3 text-sm text-muted">No design yet — blank item.</p>}

      {hasBrief && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Designer&apos;s Choice brief</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-canvas p-3 text-sm text-ink-900">
            {JSON.stringify(line.assistanceBrief, null, 2)}
          </pre>
        </div>
      )}

      {(hasDesign || hasAssets) && (
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Asset files (originals)</p>
            {line.assets.length === 0 && <p className="mt-1 text-sm text-muted">None found.</p>}
            <ul className="mt-1 space-y-1">
              {line.assets.map((a) => (
                <li key={a.url}>
                  <a href={a.url} target="_blank" rel="noreferrer" className="text-sm text-ink-900 underline-offset-2 hover:underline">
                    {a.originalFileName}
                  </a>
                  {a.fileSizeBytes ? <span className="ml-1 text-xs text-muted">({formatBytes(a.fileSizeBytes)})</span> : null}
                </li>
              ))}
            </ul>
          </div>

          {hasDesign && (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Design file</p>
                <a
                  href={`/api/admin/design/${line.designProjectId}/json`}
                  className="mt-1 inline-block text-sm text-ink-900 underline-offset-2 hover:underline"
                >
                  Download design.json
                </a>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Production files{" "}
                  <span
                    className={
                      line.exportStatus === "READY"
                        ? "text-emerald-700"
                        : line.exportStatus === "FAILED"
                          ? "text-crimson"
                          : "text-muted"
                    }
                  >
                    ({line.exportStatus ?? "not started"})
                  </span>
                </p>
                {line.exportStatus === "FAILED" && line.exportError && <p className="mt-1 text-xs text-crimson">{line.exportError}</p>}
                {line.production.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">No files yet.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {line.production.map((p) => (
                      <li key={p.sideType} className="text-sm text-ink-900">
                        {p.sideType}:{" "}
                        <a href={p.pngUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                          PNG
                        </a>
                        {p.svgUrl && (
                          <>
                            {" · "}
                            <a href={p.svgUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                              SVG
                            </a>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Preview files</p>
                {line.preview.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">No files yet.</p>
                ) : (
                  <ul className="mt-1 flex flex-wrap gap-3">
                    {line.preview.map((p) => (
                      <li key={p.sideType}>
                        <a href={p.url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element -- internal admin-only view of a Supabase Storage URL, not worth adding to next.config.ts's remotePatterns */}
                          <img src={p.url} alt={`${p.sideType} preview`} className="h-24 w-24 rounded-xl object-cover" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
