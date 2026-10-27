import type { CatalogueProduct } from "@/lib/products";
import type { DesignSideType } from "@/lib/studio/types";

// The shared "what shape is this vessel" abstraction, used by BOTH the 2D editing illustration
// (drinkwareIllustrations.ts) and the 3D preview (Mug3DPreview.tsx's VESSEL_PARAMS). Deliberately
// richer than the pricing module's DrinkwareKind (mug/tumbler/water-bottle/pint-glass): a travel
// mug and a skinny tumbler are visibly different vessels a customer must be able to recognise, even
// though they price/print like a mug and a tumbler respectively.
export type DrinkwareVesselKind = "mug" | "travel-mug" | "tumbler" | "skinny-tumbler" | "glass" | "bottle";

export interface DrinkwareCustomizationConfig {
  vesselKind: DrinkwareVesselKind;
  /** Print locations this product offers in the Studio. Phase 1: the full cylindrical wrap only.
   *  Phase 2 adds "bottom" (gated on per-product bottom-support config). */
  locations: DesignSideType[];
  /** True = a finished design routes through Request a Quote rather than instant checkout.
   *  True for all drinkware in Phase 1 because there is no automated print-pricing rule for it
   *  (see the plan / priceCartItem) — never invent a printing charge. */
  requiresQuote: boolean;
}

/** The minimal fields vessel/customization resolution needs. A full CatalogueProduct satisfies it
 *  directly; the Studio (which only has a DesignProjectRecord, not the catalogue entry) adapts its
 *  own fields into this shape at the call site — so one config implementation serves both the
 *  product pages and the editor. */
export interface DrinkwareProductLike {
  slug: string;
  name: string;
  categorySlug: string;
  subcategorySlug: string;
  houseProductKind?: CatalogueProduct["houseProductKind"];
}

// Per-slug vessel overrides, for the rare product the name/subcategory heuristic below gets wrong.
// This is the "scalable, not per-product patches" escape hatch: the heuristic handles the whole
// Joto catalogue by type, and anything it misclassifies gets one line here rather than a code fork.
const VESSEL_OVERRIDES: Record<string, DrinkwareVesselKind> = {};

/** Every drinkware product is customizable EXCEPT laser-engraving items — engraving is a different
 *  decoration process from sublimation printing, with its own template/UX not built here, so those
 *  stay quote-only (subcategory "engraved-personalized"). Covers both the pack-priced Joto bundle
 *  products (no houseProductKind) and the VistaPrint house drinkware (houseProductKind: drinkware-*). */
export function isCustomizableDrinkware(product: DrinkwareProductLike): boolean {
  if (product.categorySlug !== "drinkware") return false;
  if (product.subcategorySlug === "engraved-personalized") return false;
  return true;
}

function inferVesselKind(product: DrinkwareProductLike): DrinkwareVesselKind {
  const override = VESSEL_OVERRIDES[product.slug];
  if (override) return override;

  // Keyword cues win over the subcategory default — a "travel mug" lives in the tumblers
  // subcategory, a "skinny tumbler" is a slim variant. Search BOTH the display name and the slug:
  // the skinny tumbler is literally "...Tumbler with Straw & Lid" in its name but has "skinny" in
  // its slug, so name-only misses it. "travel" is checked first so a large travel tumbler that also
  // mentions a straw isn't mistaken for a skinny one. "straw" is a reliable skinny-tumbler cue
  // across the Joto catalogue once travel is ruled out.
  const hay = `${product.name} ${product.slug}`.toLowerCase();
  if (/\btravel\b/.test(hay)) return "travel-mug";
  if (/\bskinny\b/.test(hay) || /\bstraw\b/.test(hay)) return "skinny-tumbler";

  // houseProductKind is authoritative for the VistaPrint house drinkware line.
  switch (product.houseProductKind) {
    case "drinkware-mug":
      return "mug";
    case "drinkware-tumbler":
      return "tumbler";
    case "drinkware-water-bottle":
      return "bottle";
    case "drinkware-pint-glass":
      return "glass";
  }

  switch (product.subcategorySlug) {
    case "mugs":
      return "mug";
    case "tumblers":
      return "tumbler";
    case "glassware":
      return "glass";
    case "bottles":
      return "bottle";
    default:
      return "mug";
  }
}

/** Resolves a drinkware product to its customization config, or null if the product isn't
 *  customizable drinkware. One place every caller (product configurators, Studio, 3D preview)
 *  reads vessel kind + locations + quote-routing from, so a new Joto import becomes customizable
 *  automatically by type with no per-product wiring. */
export function drinkwareConfigFor(product: DrinkwareProductLike): DrinkwareCustomizationConfig | null {
  if (!isCustomizableDrinkware(product)) return null;
  return {
    vesselKind: inferVesselKind(product),
    locations: ["mug-wrap"],
    requiresQuote: true,
  };
}
