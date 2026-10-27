import type { DesignSideType } from "./types";
import type { LocationViewType } from "./productDecorationProfile";
import type { DrinkwareVesselKind } from "./drinkwareCustomization";
import { drinkwareWrapIllustrationSvg } from "./drinkwareIllustrations";

// MVP print-area template: one representative geometry per location, applied uniformly rather
// than per-product-per-size. This is a deliberate simplification, not a real registered
// print-area spec — a real one needs Maple's actual production measurements per garment/size,
// which isn't in the current supplier data. `PRINT_AREA_TEMPLATE_VERSION` is stored on every
// DesignProject specifically so if/when real per-product geometry replaces this, existing designs
// keep the geometry they were created under rather than silently shifting.
//
// STANDARD locations (front, back, left-chest, joggers' front) are real, physically plausible
// print positions coverable with the photography this site already has. Every other location in
// DesignSideType is REVIEW_REQUIRED (see productDecorationProfile.ts) — its geometry here is an
// approximate placement box, `confirmed: false`, used only to draw the generic Placement Preview
// illustration; it is never shown as, or treated as, a confirmed production spec.
export const PRINT_AREA_TEMPLATE_VERSION = "v5-sleeve-schematic-garment-view";

// The fixed "design space" every box/object coordinate is computed against — see CanvasStage's
// own comment for why this is a virtual pixel buffer, not the container's measured CSS size.
export const CANVAS_NATURAL_WIDTH = 520;
export const CANVAS_NATURAL_HEIGHT = 650; // 4:5, matching the site's product-photo aspect convention

export const PRINT_AREAS: Record<DesignSideType, { widthIn: number; heightIn: number; safeMarginIn: number; confirmed: boolean }> = {
  front: { widthIn: 12, heightIn: 16, safeMarginIn: 0.25, confirmed: true },
  back: { widthIn: 12, heightIn: 16, safeMarginIn: 0.25, confirmed: true },
  // Industry-standard "left chest" logo area — small and fixed-size rather than scaled to the
  // garment, matching how chest-logo decoration is conventionally sized regardless of shirt size.
  "left-chest": { widthIn: 4, heightIn: 4, safeMarginIn: 0.15, confirmed: true },
  "right-chest": { widthIn: 4, heightIn: 4, safeMarginIn: 0.15, confirmed: false },
  "left-sleeve": { widthIn: 3, heightIn: 3, safeMarginIn: 0.15, confirmed: false },
  "right-sleeve": { widthIn: 3, heightIn: 3, safeMarginIn: 0.15, confirmed: false },
  "upper-back": { widthIn: 4, heightIn: 2, safeMarginIn: 0.15, confirmed: false },
  hood: { widthIn: 5, heightIn: 5, safeMarginIn: 0.2, confirmed: false },
  pocket: { widthIn: 3, heightIn: 3, safeMarginIn: 0.15, confirmed: false },
  // Provisional placeholders, not a confirmed spec — the schematic view having visual room for a
  // bigger box doesn't mean a bigger physical print zone is actually approved (Section 17).
  "inside-neck": { widthIn: 2.5, heightIn: 1, safeMarginIn: 0.1, confirmed: false },
  "outside-neck": { widthIn: 2.5, heightIn: 1, safeMarginIn: 0.1, confirmed: false },
  "left-leg": { widthIn: 4, heightIn: 5, safeMarginIn: 0.2, confirmed: false },
  "right-leg": { widthIn: 4, heightIn: 5, safeMarginIn: 0.2, confirmed: false },
  "left-side": { widthIn: 3, heightIn: 1.5, safeMarginIn: 0.1, confirmed: false },
  "right-side": { widthIn: 3, heightIn: 1.5, safeMarginIn: 0.1, confirmed: false },
  // Flat print pieces (STUDIO V4 brief) — real industry-standard dimensions (US business card,
  // US Letter flyer, a common small poster size, an 11oz mug's sublimation wrap), not apparel
  // measurements repurposed. `confirmed: false` on every one, honestly: no live product exists in
  // these subcategories yet (see productDecorationProfile.ts's familyFor comment), so nothing here
  // has been checked against an actual Maple production run.
  "card-front": { widthIn: 3.5, heightIn: 2, safeMarginIn: 0.125, confirmed: false },
  "card-back": { widthIn: 3.5, heightIn: 2, safeMarginIn: 0.125, confirmed: false },
  // Standard VistaPrint-sourced 6x4 landscape postcard — see houseProducts/pricing/postcards.ts.
  // confirmed: false to match card-front/flyer-front's own precedent above (real orderable product,
  // but "confirmed" here tracks calibration against real photography, which flat pieces never have).
  "postcard-front": { widthIn: 6, heightIn: 4, safeMarginIn: 0.125, confirmed: false },
  "postcard-back": { widthIn: 6, heightIn: 4, safeMarginIn: 0.125, confirmed: false },
  "flyer-front": { widthIn: 8.5, heightIn: 11, safeMarginIn: 0.25, confirmed: false },
  "flyer-back": { widthIn: 8.5, heightIn: 11, safeMarginIn: 0.25, confirmed: false },
  "poster-front": { widthIn: 18, heightIn: 24, safeMarginIn: 0.5, confirmed: false },
  "mug-wrap": { widthIn: 8, heightIn: 3.3, safeMarginIn: 0.25, confirmed: false },
  // Placeholder only — a banner's real widthIn/heightIn always comes from its own DesignSide row
  // (the customer's chosen size), passed explicitly as printAreaPixelBox's override param. This
  // entry exists only so the Record stays total and the /api/studio route has a sane fallback if a
  // caller somehow omits the override.
  "banner-face": { widthIn: 24, heightIn: 36, safeMarginIn: 0.5, confirmed: false },
  // Representative sticker size — a real die-cut/kiss-cut product exists (src/lib/houseProducts/
  // pricing/stickers.ts) across many real shapes/sizes; 3x3in square is the common middle of that
  // range, used only for the editing canvas's own box (the customer's actual chosen size prints
  // from the same design scaled to spec, same as every other flat piece here).
  "sticker-face": { widthIn: 3, heightIn: 3, safeMarginIn: 0.125, confirmed: false },
};

export interface PlacementGeometry {
  xFrac: number;
  yFrac: number;
  widthFrac: number;
  heightFrac: number;
  /** Degrees, Konva convention (positive = clockwise). Rotates the print area's local coordinate
   *  frame around its own center — every object inside stays in that LOCAL, unrotated frame (see
   *  CanvasStage's per-location Group), so this is purely a display/mockup transform. It is never
   *  baked into a DesignObject's own normalizedX/Y/rotation. Zero for every location except the
   *  two sleeves, where the garment itself isn't upright. */
  rotationDeg: number;
}

/** Where each location's print area sits over its garment product photo (or, for REVIEW_REQUIRED
 *  locations, the generic Placement Preview illustration/schematic — see backgroundKindFor()), as
 *  a fraction of the image's own width/height. STANDARD boxes (front/back/left-chest/joggers-
 *  front) are calibrated against S&S's actual front-facing flat-lay photography. Every other box
 *  below is an approximate position, not a calibrated overlay on a real photo.
 *
 *  Sleeves no longer sit as a rotated box on the full-shirt photo at all (STUDIO V3 brief, Section
 *  10: "STOP using this as the main sleeve editing interface") — "left-sleeve"/"right-sleeve" each
 *  render on their OWN dedicated flattened schematic illustration (see sleeveSchematicSvg below,
 *  the same pattern innerNeckSchematicSvg already established), so their box here is a plain
 *  upright (rotationDeg: 0) rectangle positioned within that schematic's own layout — never over
 *  garment photography, and never rotated. The two schematics are still deliberately mirror images
 *  of each other (drawn, not just repositioned) so Left/Right stay visually distinct.
 *  These are placement-template data, not something rendered by rotating a border in CSS: the
 *  Konva Group representing each location's local coordinate space is the thing that actually
 *  rotates when rotationDeg is non-zero (see CanvasStage.tsx) — sleeves just no longer need it. */
export const PLACEMENT_GEOMETRY: Record<DesignSideType, PlacementGeometry> = {
  // widthFrac/heightFrac corrected to the real 12x16in (0.75) aspect from PRINT_AREAS above —
  // the box was previously 208x234px (0.889 aspect), stretching anything placed inside it
  // (icons, the canvas itself) by ~12%. Same center and area as the old box, so it still sits
  // over the same spot on the S&S flat-lay photo, just correctly proportioned.
  front: { xFrac: 0.3163, yFrac: 0.2041, widthFrac: 0.3674, heightFrac: 0.3919, rotationDeg: 0 },
  back: { xFrac: 0.3163, yFrac: 0.2041, widthFrac: 0.3674, heightFrac: 0.3919, rotationDeg: 0 },
  "left-chest": { xFrac: 0.56, yFrac: 0.22, widthFrac: 0.14, heightFrac: 0.11, rotationDeg: 0 },
  "right-chest": { xFrac: 0.3, yFrac: 0.22, widthFrac: 0.14, heightFrac: 0.11, rotationDeg: 0 },
  // Positioned within each sleeve's own schematic illustration (sleeveSchematicSvg) — large enough
  // ("large enough that design work is easy", Section 11) relative to that illustration's own
  // 520x650 canvas that ordinary logo/text work doesn't feel cramped, same idea as inside-neck.
  "left-sleeve": { xFrac: 0.28, yFrac: 0.36, widthFrac: 0.44, heightFrac: 0.32, rotationDeg: 0 },
  "right-sleeve": { xFrac: 0.28, yFrac: 0.36, widthFrac: 0.44, heightFrac: 0.32, rotationDeg: 0 },
  "upper-back": { xFrac: 0.38, yFrac: 0.18, widthFrac: 0.24, heightFrac: 0.08, rotationDeg: 0 },
  hood: { xFrac: 0.34, yFrac: 0.06, widthFrac: 0.32, heightFrac: 0.14, rotationDeg: 0 },
  pocket: { xFrac: 0.36, yFrac: 0.55, widthFrac: 0.28, heightFrac: 0.12, rotationDeg: 0 },
  // Positioned within INNER_NECK_SCHEMATIC's own illustration space (see innerNeckSchematicSvg),
  // not over garment photography at all.
  "inside-neck": { xFrac: 0.36, yFrac: 0.48, widthFrac: 0.28, heightFrac: 0.22, rotationDeg: 0 },
  "outside-neck": { xFrac: 0.4, yFrac: 0.14, widthFrac: 0.2, heightFrac: 0.06, rotationDeg: 0 },
  // Joggers front reuses the "front" mockup view but the box sits low/centered on the thigh, not
  // chest-height — see productDecorationProfile.ts's note on why this isn't the tee's chest box.
  "left-leg": { xFrac: 0.28, yFrac: 0.42, widthFrac: 0.18, heightFrac: 0.22, rotationDeg: 0 },
  "right-leg": { xFrac: 0.54, yFrac: 0.42, widthFrac: 0.18, heightFrac: 0.22, rotationDeg: 0 },
  "left-side": { xFrac: 0.16, yFrac: 0.3, widthFrac: 0.18, heightFrac: 0.12, rotationDeg: 0 },
  "right-side": { xFrac: 0.66, yFrac: 0.3, widthFrac: 0.18, heightFrac: 0.12, rotationDeg: 0 },
  // Flat print pieces render on their own dedicated schematic (printPieceSchematicSvg), not a
  // garment photo — each box below is sized at the piece's REAL aspect ratio (from PRINT_AREAS
  // above) and centered generously within the 520x650 canvas, same "large enough that design work
  // is easy" principle the sleeve/inner-neck schematics already established.
  "card-front": { xFrac: 0.075, yFrac: 0.306, widthFrac: 0.85, heightFrac: 0.389, rotationDeg: 0 },
  "card-back": { xFrac: 0.075, yFrac: 0.306, widthFrac: 0.85, heightFrac: 0.389, rotationDeg: 0 },
  // Sized at the real 6x4 (1.5) aspect from PRINT_AREAS above, same centered/generous-margin
  // convention as card-front/poster-front.
  "postcard-front": { xFrac: 0.075, yFrac: 0.2733, widthFrac: 0.85, heightFrac: 0.4533, rotationDeg: 0 },
  "postcard-back": { xFrac: 0.075, yFrac: 0.2733, widthFrac: 0.85, heightFrac: 0.4533, rotationDeg: 0 },
  "flyer-front": { xFrac: 0.075, yFrac: 0.06, widthFrac: 0.85, heightFrac: 0.88, rotationDeg: 0 },
  "flyer-back": { xFrac: 0.075, yFrac: 0.06, widthFrac: 0.85, heightFrac: 0.88, rotationDeg: 0 },
  "poster-front": { xFrac: 0.075, yFrac: 0.047, widthFrac: 0.85, heightFrac: 0.907, rotationDeg: 0 },
  "mug-wrap": { xFrac: 0.075, yFrac: 0.36, widthFrac: 0.85, heightFrac: 0.28, rotationDeg: 0 },
  // Placeholder — never actually read for a real banner project (both printAreaPixelBox and
  // CanvasStage's boxFor compute the real box from bannerPlacementGeometry() instead whenever an
  // override is supplied, which it always is for "banner-face"). Kept only so this Record stays
  // total.
  "banner-face": { xFrac: 0.075, yFrac: 0.075, widthFrac: 0.85, heightFrac: 0.85, rotationDeg: 0 },
  // Square box at the sticker-face PRINT_AREAS real aspect ratio (3x3in = 1:1), same centered
  // "generous but bounded" sizing as card-front/poster-front above.
  "sticker-face": { xFrac: 0.075, yFrac: 0.16, widthFrac: 0.85, heightFrac: 0.68, rotationDeg: 0 },
};

// A banner's real aspect ratio varies per order (2.5'x4' ~0.63 vs 8'x30' ~0.27 — over a 2x spread),
// which a fixed per-DesignSideType PLACEMENT_GEOMETRY entry can't represent. Computed fresh from
// the customer's actual chosen widthIn/heightIn instead: fit centered into ~85% of the canvas on
// whichever axis constrains first. An 8'x30' banner renders as a noticeably thin strip at this
// canvas size — workable but tighter to design on than a 2.5'x4' banner; no further fix attempted
// for this pass.
const BANNER_FIT_MAX_FRAC = 0.85;

export function bannerPlacementGeometry(widthIn: number, heightIn: number): PlacementGeometry {
  const aspect = widthIn / heightIn;
  const canvasAspect = CANVAS_NATURAL_WIDTH / CANVAS_NATURAL_HEIGHT;
  let widthFrac: number;
  let heightFrac: number;
  if (aspect > canvasAspect) {
    widthFrac = BANNER_FIT_MAX_FRAC;
    heightFrac = (widthFrac * CANVAS_NATURAL_WIDTH) / aspect / CANVAS_NATURAL_HEIGHT;
  } else {
    heightFrac = BANNER_FIT_MAX_FRAC;
    widthFrac = (heightFrac * CANVAS_NATURAL_HEIGHT) * aspect / CANVAS_NATURAL_WIDTH;
  }
  return { xFrac: (1 - widthFrac) / 2, yFrac: (1 - heightFrac) / 2, widthFrac, heightFrac, rotationDeg: 0 };
}

/** @deprecated kept only as a type-compatible alias while any stale import lingers — use
 *  PLACEMENT_GEOMETRY, which carries rotationDeg. */
export const MOCKUP_PRINT_AREA_BOX = PLACEMENT_GEOMETRY;

/** The joggers family's one STANDARD location uses this lower-centered box instead of the tee
 *  chest box — same "front" mockup photo, anatomically different placement. */
export const JOGGERS_FRONT_BOX = { xFrac: 0.36, yFrac: 0.48, widthFrac: 0.28, heightFrac: 0.2 };

export type BackgroundKind =
  | "front-photo"
  | "back-photo"
  | "inner-neck-schematic"
  | "sleeve-left-schematic"
  | "sleeve-right-schematic"
  | "card-front-flat"
  | "card-back-flat"
  | "postcard-front-flat"
  | "postcard-back-flat"
  | "flyer-front-flat"
  | "flyer-back-flat"
  | "poster-flat"
  | "mug-wrap-flat"
  | "banner-flat"
  | "sticker-face-flat";

/** What kind of background a location's viewType calls for — this is what let Section 20's
 *  viewType enum replace the old hardcoded "is this front or back" special-casing. A schematic
 *  never depends on the product's own photography at all.
 *
 *  This doubles as the GARMENT VIEW grouping key (STUDIO V3 brief, Section 8): two locations that
 *  resolve to the same BackgroundKind are, by definition, looking at the same physical surface —
 *  the same front photo, the same back photo, or the same dedicated schematic — so compositing
 *  their artwork together (garmentViews.ts) is exactly "what does the customer see when they look
 *  at this side of the garment," independent of which print area happens to be active for editing. */
export function backgroundKindFor(viewType: LocationViewType): BackgroundKind {
  switch (viewType) {
    case "PRODUCT_BACK":
    case "PRODUCT_BACK_PLACEMENT":
    case "HOOD_PLACEMENT":
    case "OUTER_NECK_PLACEMENT":
      return "back-photo";
    case "INNER_NECK_SCHEMATIC":
      return "inner-neck-schematic";
    case "SLEEVE_LEFT_PLACEMENT":
      return "sleeve-left-schematic";
    case "SLEEVE_RIGHT_PLACEMENT":
      return "sleeve-right-schematic";
    case "CARD_FRONT_FLAT":
      return "card-front-flat";
    case "CARD_BACK_FLAT":
      return "card-back-flat";
    case "POSTCARD_FRONT_FLAT":
      return "postcard-front-flat";
    case "POSTCARD_BACK_FLAT":
      return "postcard-back-flat";
    case "FLYER_FRONT_FLAT":
      return "flyer-front-flat";
    case "FLYER_BACK_FLAT":
      return "flyer-back-flat";
    case "POSTER_FLAT":
      return "poster-flat";
    case "MUG_WRAP_FLAT":
      return "mug-wrap-flat";
    case "BANNER_FLAT":
      return "banner-flat";
    case "STICKER_FLAT":
      return "sticker-face-flat";
    default:
      return "front-photo";
  }
}

/** Pixel size (in the fixed 520x650 design space) of a location's print-area box — the one place
 *  Inspector's Position/Align controls and StudioClient's new-asset auto-fit sizing get a box's
 *  real aspect ratio from, so "fit inside 60-75% of the usable area" (Section 5) is measured
 *  against the box's actual shape rather than assuming it's square. */
export function printAreaPixelBox(
  location: DesignSideType,
  override?: { widthIn: number; heightIn: number },
): { width: number; height: number } {
  const g = override ? bannerPlacementGeometry(override.widthIn, override.heightIn) : PLACEMENT_GEOMETRY[location];
  return { width: g.widthFrac * CANVAS_NATURAL_WIDTH, height: g.heightFrac * CANVAS_NATURAL_HEIGHT };
}

/** Resolves a project's real per-side dimensions for the one DesignSideType that varies per order
 *  — "banner-face" — or undefined for every other location (which should keep using the fixed
 *  PRINT_AREAS/PLACEMENT_GEOMETRY constants). Shared by every printAreaPixelBox/CanvasStage caller
 *  that has access to a DesignProjectRecord's `sides`, so the override logic lives in one place. */
export function printAreaOverrideFor(
  sides: { sideType: DesignSideType; printAreaWidth: number; printAreaHeight: number }[],
  location: DesignSideType,
): { widthIn: number; heightIn: number } | undefined {
  if (location !== "banner-face") return undefined;
  const side = sides.find((s) => s.sideType === location);
  return side ? { widthIn: side.printAreaWidth, heightIn: side.printAreaHeight } : undefined;
}

/** Axis-aligned overlap test between two OPEN locations' print-area boxes, in the shared design
 *  space — only meaningful (and only ever called) for locations already confirmed to share a
 *  GarmentView, where both boxes sit over the exact same background and rotationDeg is 0 for
 *  every current location. Section 8's "gentle warning, never an automatic block": this is a hint,
 *  not a production constraint, so a simple rectangle test is enough — it doesn't need to reason
 *  about actual artwork pixels, just whether the two PLACEMENT areas themselves visually collide. */
export function printAreasOverlap(a: DesignSideType, b: DesignSideType): boolean {
  const ga = PLACEMENT_GEOMETRY[a];
  const gb = PLACEMENT_GEOMETRY[b];
  const aLeft = ga.xFrac, aRight = ga.xFrac + ga.widthFrac, aTop = ga.yFrac, aBottom = ga.yFrac + ga.heightFrac;
  const bLeft = gb.xFrac, bRight = gb.xFrac + gb.widthFrac, bTop = gb.yFrac, bBottom = gb.yFrac + gb.heightFrac;
  return aLeft < bRight && aRight > bLeft && aTop < bBottom && aBottom > bTop;
}

/** Back-compat wrapper for call sites that only know the DesignSideType, not its viewType —
 *  resolves the same way LOCATION_VIEW_TYPES + backgroundKindFor() would. Prefer the explicit
 *  viewType path in new code (CanvasStage, StudioClient); this exists for the few remaining
 *  call sites that pre-date Section 20 and haven't been threaded through yet. */
export function mockupViewFor(location: DesignSideType): DesignSideType {
  const backLocations: DesignSideType[] = ["back", "upper-back", "hood", "outside-neck"];
  return backLocations.includes(location) ? "back" : "front";
}

// Rare fallback — only used when a location's own background resolves to a camera angle the
// product genuinely has no photo for at all (e.g. a colourway with no back shot). A plain neutral
// card, deliberately NOT styled to look like a specific garment, so it can never be mistaken for
// real product photography — the "Placement Preview" badge (CanvasStage) pairs with this, but even
// without it this shouldn't read as an actual photo.
const GENERIC_SILHOUETTE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="650">
  <rect width="520" height="650" fill="#F6F1E9"/>
  <rect x="40" y="40" width="440" height="570" rx="24" fill="none" stroke="#D8CFC0" stroke-width="2" stroke-dasharray="8 8"/>
  <text x="260" y="335" font-family="sans-serif" font-size="15" fill="#9C9284" text-anchor="middle">Photo not yet available for this placement</text>
</svg>`;
export const GENERIC_PLACEMENT_MOCKUP = `data:image/svg+xml,${encodeURIComponent(GENERIC_SILHOUETTE_SVG)}`;

// A conservative, non-exhaustive list of colour-name substrings that read as "dark" — good enough
// to pick a legible fabric tone for the inner-neck schematic without needing to fabricate a real
// per-colour luminance value the supplier data doesn't provide. Ties go light, since a wrongly
// "light" schematic on a dark shirt is still perfectly legible; a wrongly "dark" one risks the
// dark-on-dark illegibility Section 16 explicitly warns against.
const DARK_COLOUR_HINTS = ["black", "navy", "charcoal", "dark", "forest", "maroon", "midnight", "graphite", "espresso", "jet", "purple", "burgundy"];

export function isDarkGarmentColour(colourName: string): boolean {
  const lower = colourName.toLowerCase();
  return DARK_COLOUR_HINTS.some((hint) => lower.includes(hint));
}

/** Dedicated interior-collar illustration for INNER_NECK_SCHEMATIC (Section 14) — an original
 *  Maple technical diagram, not a photo and not a copy of any reference image: collar seam, the
 *  garment's interior fabric, and the actual print/label zone, drawn plainly enough that "this is
 *  the inside of the collar" reads immediately. Two legibility variants (light/dark fabric) picked
 *  by isDarkGarmentColour() — see Section 16's "clarity over photorealism" instruction. The
 *  PLACEMENT_GEOMETRY box for "inside-neck" is positioned against THIS illustration's own layout,
 *  not against any garment photo. */
export function innerNeckSchematicSvg(colourName: string): string {
  const dark = isDarkGarmentColour(colourName);
  const fabric = dark ? "#2A2724" : "#F3EEE4";
  const fabricShade = dark ? "#38342F" : "#E9E2D3";
  const seam = dark ? "#6B6459" : "#B9AD98";
  const label = dark ? "#B9AD98" : "#8C816E";
  // No print-zone rectangle is drawn into the illustration itself — CanvasStage already overlays
  // the real dashed print-area box (from PLACEMENT_GEOMETRY["inside-neck"]) plus the "Placement
  // Preview" badge on top of every location's background, this one included. Drawing a second box
  // baked into the SVG would risk two slightly-misaligned rectangles competing for attention.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="650">
    <rect width="520" height="650" fill="${dark ? "#171412" : "#F6F1E9"}"/>
    <!-- Interior collar opening: a wide shallow arc, as if looking down inside the neckline -->
    <path d="M110 210 Q260 90 410 210 L410 260 Q260 150 110 260 Z" fill="${fabricShade}" stroke="${seam}" stroke-width="2"/>
    <!-- Collar seam line -->
    <path d="M110 260 Q260 150 410 260" fill="none" stroke="${seam}" stroke-width="2" stroke-dasharray="5 5"/>
    <!-- Main interior garment panel, hanging below the collar -->
    <rect x="90" y="255" width="340" height="330" rx="18" fill="${fabric}" stroke="${seam}" stroke-width="2"/>
    <text x="260" y="150" font-family="sans-serif" font-size="13" font-weight="600" letter-spacing="1.5" fill="${label}" text-anchor="middle">INSIDE COLLAR VIEW</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Dedicated flattened sleeve schematic (Section 11-13) — an original Maple illustration, NOT a
 *  copy of the owner's Printify reference: a laid-flat sleeve panel (tapered trapezoid, shoulder
 *  seam at top, cuff at bottom) with the print area sitting as a plain upright rectangle inside it.
 *  Left and right are two genuinely mirrored drawings (the taper leans the opposite direction),
 *  not the same artwork repositioned — see PLACEMENT_GEOMETRY's identical box for both, which only
 *  works because the mirroring lives in the artwork itself. Replaces the old approach of rotating
 *  a dashed box over the full garment photo: production coordinates for whatever the customer
 *  places here are still ordinary LOCAL, unrotated print-area coordinates (Section 14), exactly
 *  like every other location — only the mockup/editing surface changed. */
export function sleeveSchematicSvg(side: "left" | "right", colourName: string): string {
  const dark = isDarkGarmentColour(colourName);
  const fabric = dark ? "#2A2724" : "#F3EEE4";
  const fabricShade = dark ? "#38342F" : "#E9E2D3";
  const seam = dark ? "#6B6459" : "#B9AD98";
  const label = dark ? "#B9AD98" : "#8C816E";
  // A tapered panel — wide at the shoulder seam (top), narrowing toward the cuff (bottom) — mirrored
  // by flipping which side leans in. Drawn once as a left-leaning panel, then mirrored via a
  // horizontal transform for the right sleeve, which is what actually guarantees the two are true
  // mirror images rather than two independently-eyeballed shapes.
  const panel = side === "left"
    ? "M150 60 L400 100 L370 560 Q260 600 150 560 Z"
    : "M370 60 L120 100 L150 560 Q260 600 370 560 Z";
  const seamLine = side === "left" ? "M150 60 L400 100" : "M370 60 L120 100";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="650">
    <rect width="520" height="650" fill="${dark ? "#171412" : "#F6F1E9"}"/>
    <path d="${panel}" fill="${fabric}" stroke="${seam}" stroke-width="2"/>
    <path d="${seamLine}" fill="none" stroke="${seam}" stroke-width="2" stroke-dasharray="5 5"/>
    <rect x="180" y="180" width="160" height="220" rx="6" fill="${fabricShade}" opacity="0.5"/>
    <text x="260" y="632" font-family="sans-serif" font-size="13" font-weight="600" letter-spacing="1.5" fill="${label}" text-anchor="middle">${side.toUpperCase()} SLEEVE — LAID FLAT</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Dedicated flat-print schematic (STUDIO V4 brief) for business cards/flyers/posters/mug wraps —
 *  deliberately NOT a garment photo or garment-shaped illustration: a plain neutral card/sheet
 *  surface with a soft drop shadow so its own edges read clearly against the canvas background,
 *  labeled with which piece it is. The actual print-area box (PLACEMENT_GEOMETRY) sits exactly on
 *  top of this at the piece's real aspect ratio — this schematic is just ambience, same division
 *  of responsibility as the sleeve/inner-neck schematics. */
export function printPieceSchematicSvg(label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="650">
    <rect width="520" height="650" fill="#F6F1E9"/>
    <text x="260" y="628" font-family="sans-serif" font-size="12" font-weight="600" letter-spacing="1.5" fill="#9C9284" text-anchor="middle">${label.toUpperCase()}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The one place that resolves "what background image does this location actually show" — every
 *  caller (StudioClient, PreviewMode, ReviewPanel) goes through this instead of re-deriving
 *  front/back/schematic logic itself, which is what let three call sites drift in earlier passes.
 *  Falls back to the generic "photo not available" card when the product genuinely has no photo
 *  for the required camera angle (e.g. a colourway with no back shot) — never a silently wrong one. */
export function backgroundUrlFor(
  viewType: LocationViewType,
  mockupImages: Partial<Record<DesignSideType, string>>,
  colourName: string,
  usesPlacementPreview: boolean,
  /** For drinkware (mug-wrap-flat): which vessel to draw, so a tumbler/bottle/glass each get their
   *  own recognizable illustration instead of the generic "Mug Wrap" card. Resolved by
   *  drinkwareConfigFor() at the call site; omit for every non-drinkware location. */
  vesselKind?: DrinkwareVesselKind,
): string | null {
  const kind = backgroundKindFor(viewType);
  if (kind === "inner-neck-schematic") return innerNeckSchematicSvg(colourName);
  if (kind === "sleeve-left-schematic") return sleeveSchematicSvg("left", colourName);
  if (kind === "sleeve-right-schematic") return sleeveSchematicSvg("right", colourName);
  if (kind === "mug-wrap-flat" && vesselKind) return drinkwareWrapIllustrationSvg(vesselKind);
  switch (kind) {
    case "card-front-flat":
      return printPieceSchematicSvg("Business Card — Front");
    case "card-back-flat":
      return printPieceSchematicSvg("Business Card — Back");
    case "postcard-front-flat":
      return printPieceSchematicSvg("Postcard — Front");
    case "postcard-back-flat":
      return printPieceSchematicSvg("Postcard — Back");
    case "flyer-front-flat":
      return printPieceSchematicSvg("Flyer — Front");
    case "flyer-back-flat":
      return printPieceSchematicSvg("Flyer — Back");
    case "poster-flat":
      return printPieceSchematicSvg("Poster");
    case "mug-wrap-flat":
      return printPieceSchematicSvg("Mug Wrap");
    case "banner-flat":
      return printPieceSchematicSvg("Vinyl Banner");
    case "sticker-face-flat":
      return printPieceSchematicSvg("Custom Sticker");
  }
  const key: DesignSideType = kind === "back-photo" ? "back" : "front";
  return mockupImages[key] ?? (usesPlacementPreview ? GENERIC_PLACEMENT_MOCKUP : null);
}
