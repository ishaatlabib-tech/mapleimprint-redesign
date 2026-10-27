import type { ProductFamily } from "@/lib/studio/productDecorationProfile";

// Families that render on real garment photography (front/back are an actual photo, not a flat
// schematic) — a rotatable 3D box/plane doesn't fit that mental model the way it does for a print
// piece, and there's no real-world "this garment as a box" shape to show anyway. Every other
// family (mug, business-card, postcard, flyer, poster, banner, sticker, accessory) gets the 2D/3D
// toggle: mug via the vessel-aware Mug3DPreview, everything else via the generic Flat3DPreview.
// Shared between StudioClient (the editing canvas) and ReviewPanel (the approval screen) so both
// surfaces agree on which families get a 3D toggle at all.
export const FAMILIES_WITHOUT_3D: ProductFamily[] = ["tee", "hoodie", "joggers", "headwear"];

// NOTE: the drinkware vessel for the 3D/2D preview is now resolved by drinkwareConfigFor() in
// src/lib/studio/drinkwareCustomization.ts (a richer 6-vessel model incl. travel mug / skinny
// tumbler), which replaced the old subcategory-only drinkwareKindFor helper that lived here.

// Four "accessory" family products (gifts-promo/packaging) get a bespoke Flat3DPreview shape
// instead of the generic flat card — everything else in that family (stickers, keychains,
// magnets, coasters, packaging boxes, etc.) keeps the plain flat box unchanged. Keyed on the
// catalogue's `productSlug` (DesignProjectRecord.productSlug), NOT `subcategorySlug` — pens and
// notebooks share subcategorySlug "stationery" (see catalogue.ts), so subcategorySlug alone can't
// tell them apart. Falls back to "flat" (today's unchanged box) for every other product.
export type AccessoryKind = "tote-bag" | "pen" | "notebook" | "phone-stand" | "flat";

export function accessoryKindFor(productSlug: string): AccessoryKind {
  switch (productSlug) {
    case "tote-bags": return "tote-bag";
    case "promotional-pens": return "pen";
    case "notebooks-journals": return "notebook";
    case "phone-stands": return "phone-stand";
    default: return "flat";
  }
}
