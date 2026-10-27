"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, SpinnerGap, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { EASE_PREMIUM } from "@/lib/motion";
import { backgroundUrlFor, printAreaOverrideFor, PRINT_AREAS } from "@/lib/studio/printAreas";
import { groupLocationsByView } from "@/lib/studio/garmentViews";
import { decorationProfileFor, type DecorationLocation } from "@/lib/studio/productDecorationProfile";
import { FAMILIES_WITHOUT_3D, accessoryKindFor } from "@/lib/studio/preview3d";
import type { DrinkwareVesselKind } from "@/lib/studio/drinkwareCustomization";
import type { DesignObjectRecord, DesignProjectRecord, DesignSideType } from "@/lib/studio/types";

const CanvasStage = dynamic(() => import("@/components/studio/CanvasStage").then((m) => m.CanvasStage), {
  ssr: false,
  loading: () => (
    <div className="mx-auto flex aspect-[4/5] w-full max-w-[420px] items-center justify-center rounded-3xl bg-white">
      <SpinnerGap className="size-6 animate-spin text-muted" weight="bold" />
    </div>
  ),
});

const Mug3DPreview = dynamic(() => import("@/components/studio/Mug3DPreview").then((m) => m.Mug3DPreview), {
  ssr: false,
  loading: () => (
    <div className="mx-auto flex aspect-[4/5] w-full max-w-[420px] items-center justify-center rounded-3xl bg-white">
      <SpinnerGap className="size-6 animate-spin text-muted" weight="bold" />
    </div>
  ),
});

const Flat3DPreview = dynamic(() => import("@/components/studio/Flat3DPreview").then((m) => m.Flat3DPreview), {
  ssr: false,
  loading: () => (
    <div className="mx-auto flex aspect-[4/5] w-full max-w-[420px] items-center justify-center rounded-3xl bg-white">
      <SpinnerGap className="size-6 animate-spin text-muted" weight="bold" />
    </div>
  ),
});

interface PriceBreakdown {
  blankSubtotal: number;
  designFee: number;
  printingSubtotal: number;
  total: number;
  quantity: number;
  locations: number;
}

export function ReviewPanel({
  project,
  sides,
  profile,
  priceBreakdown,
  onBack,
  onApprove,
  approveState,
  vesselKind,
  requiresQuote = false,
}: {
  project: DesignProjectRecord;
  sides: Partial<Record<DesignSideType, DesignObjectRecord[]>>;
  profile: DecorationLocation[];
  priceBreakdown: PriceBreakdown | null;
  onBack: () => void;
  onApprove: () => void;
  approveState: "idle" | "adding" | "success" | "error";
  vesselKind?: DrinkwareVesselKind;
  /** Drinkware: finished design goes to Request a Quote rather than the pay cart (no automated
   *  print price). Only changes button/wording here; the actual routing lives in StudioClient. */
  requiresQuote?: boolean;
}) {
  const availableSides = project.sides.map((s) => s.sideType);
  const hasArt = (side: DesignSideType) => (sides[side]?.length ?? 0) > 0;
  const labelFor = (side: DesignSideType) => profile.find((l) => l.id === side)?.label ?? side;
  const mockupFor = (side: DesignSideType) => {
    const loc = profile.find((l) => l.id === side);
    if (!loc) return null;
    return backgroundUrlFor(loc.viewType, project.mockupImages, project.colourName, loc.usesPlacementPreview, vesselKind);
  };

  // Same "can this family show a rotatable 3D preview" rule Studio's own canvas uses (see
  // StudioClient's FAMILIES_WITHOUT_3D) — real-garment-photo families (tee/hoodie/joggers/headwear)
  // keep the flat photo-backed preview here too, since a 3D box adds nothing over an actual photo.
  const hasBackPhoto = Boolean(project.mockupImages.back);
  const family = decorationProfileFor(project.categorySlug, project.subcategorySlug, hasBackPhoto).family;
  const canShow3D = !FAMILIES_WITHOUT_3D.includes(family);

  // One 2D/3D toggle per view group (front/back can each be flipped independently) rather than a
  // single page-wide switch — a two-sided product's Review should let you check each side's 3D look
  // on its own.
  const [viewModeByGroup, setViewModeByGroup] = useState<Record<string, "2d" | "3d">>({});
  const viewModeFor = (groupKey: string) => viewModeByGroup[groupKey] ?? "2d";
  const setViewModeFor = (groupKey: string, mode: "2d" | "3d") =>
    setViewModeByGroup((prev) => ({ ...prev, [groupKey]: mode }));

  // Mirrors StudioClient's flatPrintAreaIn: the accessory family (gifts-promo/packaging) reuses
  // apparel's "front"/"back" DesignSideType IDs with no real per-item print-area entry of its own,
  // so PRINT_AREAS[side] would silently render every coaster/tote/etc. at a 12x16in chest-print
  // aspect ratio — fall back to a neutral square instead.
  const flatPrintAreaInFor = (side: DesignSideType) =>
    printAreaOverrideFor(project.sides, side) ?? (family === "accessory" ? { widthIn: 4, heightIn: 4 } : PRINT_AREAS[side]);

  // Section 25: "do not show Left Chest as if it were an entirely different shirt" — group every
  // decorated location back into the GarmentView it actually shares (front/left-chest/right-chest
  // are one composite picture, not three), so Review reads as a handful of real views rather than
  // nine nearly-identical shirt photos. Pricing/production below is completely unaffected — it
  // still reads per-location `sides`/`priceBreakdown`, never this grouping.
  const viewGroups = groupLocationsByView(availableSides, profile);
  const groupLabel = (locations: DesignSideType[]) =>
    locations.length === 1 ? labelFor(locations[0]) : `${labelFor(locations[0])} + ${locations.slice(1).map(labelFor).join(", ")}`;

  return (
    // h-full + overflow-y-auto, not min-h-screen: Review lives inside Studio's fixed h-dvh shell
    // (same route, just a different `mode`, not a page navigation — see StudioClient), which is
    // itself overflow-hidden, so this is what actually lets a tall review (many locations, full
    // price breakdown) scroll on its own instead of being silently clipped by that ancestor.
    <div className="h-full overflow-y-auto bg-canvas">
      <header className="border-b border-sand bg-white px-4 py-3 lg:px-6">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-full border border-sand px-3 py-1.5 text-xs font-semibold text-ink-900 transition-colors hover:border-ink-950/25"
        >
          <ArrowLeft className="size-3.5" weight="bold" />
          Back to Studio
        </button>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="font-display text-2xl font-semibold text-ink-900 md:text-3xl">Review your design</h1>
        <p className="mt-2 text-sm text-muted">
          Confirm everything looks right — this becomes your production reference once approved.
        </p>

        <div className="mt-8 grid gap-8 md:grid-cols-2">
          <div className="min-w-0 space-y-6">
            {viewGroups.map((group) => {
              const primary = group.locations[0];
              const groupHasArt = group.locations.some(hasArt);
              const groupKey = group.view;
              const viewMode = viewModeFor(groupKey);
              const flatPrintAreaIn = flatPrintAreaInFor(primary);
              return (
                <div key={groupKey}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                      {groupLabel(group.locations)} preview
                      <span className={groupHasArt ? "text-crimson" : "text-muted/50"}>{groupHasArt ? "✓" : "—"}</span>
                    </p>
                    {canShow3D && (
                      <div className="flex items-center rounded-full border border-sand bg-white p-0.5 text-[11px] font-semibold">
                        <button
                          type="button"
                          onClick={() => setViewModeFor(groupKey, "2d")}
                          aria-pressed={viewMode === "2d"}
                          className={cn(
                            "rounded-full px-2.5 py-1 transition-colors",
                            viewMode === "2d" ? "bg-ink-950 text-white" : "text-ink-900 hover:bg-canvas",
                          )}
                        >
                          2D
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewModeFor(groupKey, "3d")}
                          aria-pressed={viewMode === "3d"}
                          className={cn(
                            "rounded-full px-2.5 py-1 transition-colors",
                            viewMode === "3d" ? "bg-ink-950 text-white" : "text-ink-900 hover:bg-canvas",
                          )}
                        >
                          3D
                        </button>
                      </div>
                    )}
                  </div>
                  {viewMode === "3d" && canShow3D ? (
                    <div className="mx-auto aspect-[4/5] w-full max-w-[420px] overflow-hidden rounded-3xl bg-white">
                      {family === "mug" ? (
                        <Mug3DPreview objects={sides[primary] ?? []} kind={vesselKind ?? "mug"} />
                      ) : (
                        <Flat3DPreview
                          objects={sides[primary] ?? []}
                          widthIn={flatPrintAreaIn.widthIn}
                          heightIn={flatPrintAreaIn.heightIn}
                          kind={accessoryKindFor(project.productSlug)}
                        />
                      )}
                    </div>
                  ) : (
                    <CanvasStage
                      layers={group.locations.map((loc) => ({
                        location: loc,
                        objects: sides[loc] ?? [],
                        active: false,
                        printAreaOverrideIn: printAreaOverrideFor(project.sides, loc),
                      }))}
                      mockupUrl={mockupFor(primary)}
                      selectedId={null}
                      onSelect={() => {}}
                      onCommitObject={() => {}}
                      editingTextId={null}
                      onEditRequest={() => {}}
                      onEditCommit={() => {}}
                      readOnly
                      fitMode="width"
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="min-w-0 space-y-6">
            <div className="rounded-2xl bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Product</p>
              <p className="mt-1 font-display font-semibold text-ink-900">{project.productName}</p>
              <p className="text-sm text-muted">{project.brandName}</p>

              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Colour</p>
              <p className="mt-1 text-sm text-ink-900">{project.colourName}</p>

              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Sizes &amp; quantities</p>
              <p className="mt-1 text-sm text-ink-900">
                {project.sizeBreakdown.map((s) => `${s.size} ×${s.qty}`).join(", ")} · {project.totalQuantity} total
              </p>
            </div>

            {priceBreakdown && (
              <div className="rounded-2xl bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Price breakdown</p>
                <div className="mt-3 space-y-1.5 text-sm">
                  <div className="flex justify-between text-ink-900/80">
                    <span>Items × {priceBreakdown.quantity}</span>
                    <span>${priceBreakdown.blankSubtotal.toFixed(2)}</span>
                  </div>
                  {/* Section "REMOVE DOUBLE-CHARGING OF DESIGN FEE": a standard self-service order
                      never carries a design fee (see pricing.ts's header note) — this row only
                      shows at all for an OLD frozen DesignProject snapshot created before that fix,
                      which may still carry a real nonzero designFee. Never show a $0.00 line for a
                      charge that genuinely doesn't apply. */}
                  {priceBreakdown.designFee > 0 && (
                    <div className="flex justify-between text-ink-900/80">
                      <span>Design/customization</span>
                      <span>${priceBreakdown.designFee.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-ink-900/80">
                    <span>
                      Printing ({priceBreakdown.locations} {priceBreakdown.locations === 1 ? "location" : "locations"})
                    </span>
                    <span>${priceBreakdown.printingSubtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between border-t border-sand pt-2 font-display text-base font-semibold text-ink-900">
                    <span>Total</span>
                    <span>${priceBreakdown.total.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-canvas p-5 text-xs leading-relaxed text-muted">
              <WarningCircle className="mb-1 size-4 text-ink-900/50" weight="bold" />
              By approving, you confirm this design is ready to produce as shown. This serves as your
              digital proof for standard orders — reach out afterward if anything needs to change.
            </div>

            <button
              type="button"
              disabled={approveState === "adding" || approveState === "success"}
              onClick={onApprove}
              className={cn(
                "flex w-full items-center justify-center gap-2 overflow-hidden rounded-full px-6 py-3.5 text-sm font-semibold transition-colors",
                approveState === "success" ? "bg-ink-950 text-white" : "bg-maple-gradient text-ink-950 hover:opacity-95",
                approveState === "adding" && "cursor-wait opacity-80",
              )}
            >
              {/* Crossfade the label rather than swap it instantly — Section 1's "150-250ms
                  ordinary button-state transitions," no scale/bounce. */}
              <AnimatePresence mode="wait" initial={false}>
                {approveState === "adding" ? (
                  <motion.span
                    key="adding"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, ease: EASE_PREMIUM }}
                    className="flex items-center gap-2"
                  >
                    <SpinnerGap className="size-4 animate-spin" weight="bold" />
                    Adding…
                  </motion.span>
                ) : approveState === "success" ? (
                  <motion.span
                    key="success"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, ease: EASE_PREMIUM }}
                    className="flex items-center gap-2"
                  >
                    <Check className="size-4" weight="bold" /> {requiresQuote ? "Design saved" : "Added to Cart"}
                  </motion.span>
                ) : (
                  <motion.span
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, ease: EASE_PREMIUM }}
                  >
                    {requiresQuote ? "Approve & Request a Quote" : "Approve & add to cart"}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>

            {approveState === "error" && (
              <div className="rounded-2xl bg-crimson/10 p-4 text-sm text-crimson">
                <p className="font-semibold">
                  {requiresQuote ? "We couldn't submit your design." : "We couldn't add your design to the cart."}
                </p>
                <p className="mt-1 text-xs text-crimson/80">
                  Your design is safe — nothing was lost. Please try again.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={onApprove}
                    className="rounded-full bg-crimson px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={onBack}
                    className="rounded-full border border-crimson/30 px-4 py-2 text-xs font-semibold text-crimson transition-colors hover:bg-crimson/5"
                  >
                    Back to Studio
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
