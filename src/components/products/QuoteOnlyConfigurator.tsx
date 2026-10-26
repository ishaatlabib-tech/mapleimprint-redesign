"use client";

import { useRouter } from "next/navigation";
import { QUOTE_PREFILL_KEY, QUOTE_CART_LINES_KEY, type QuoteCartHandoff } from "@/components/cart/CartProvider";
import type { CatalogueProduct } from "@/lib/products";

/** For real VistaPrint product types whose live per-configuration pricing sits behind a JS
 *  configurator this build couldn't reliably sample (yard signs, rigid/foam signs, window clings,
 *  packaging boxes, tissue paper, tape, roll labels) — rather than invent a price, these ship as
 *  real, browsable products with real sourced size/material info and a direct "Get a quote" path,
 *  same mechanism ApparelCustomizer.handleRequestQuote already uses for unpriced apparel. */
export function QuoteOnlyConfigurator({
  product,
  sizes,
  materials,
}: {
  product: CatalogueProduct;
  sizes?: string[];
  materials?: string[];
}) {
  const router = useRouter();

  function handleRequestQuote() {
    window.sessionStorage.setItem(QUOTE_PREFILL_KEY, product.name);
    // No Studio design exists for this path (that's the whole reason this component exists) —
    // still worth a real structured line so staff get queryable product/colour data instead of
    // parsing it back out of free text, same reasoning as the mixed-cart fix in CartView.
    const line: QuoteCartHandoff = {
      cartItemId: `quote-only-${product.slug}-${crypto.randomUUID()}`,
      name: product.name,
      quantity: 1,
      categorySlug: product.categorySlug,
      subcategorySlug: product.subcategorySlug,
      productSlug: product.slug,
    };
    window.sessionStorage.setItem(QUOTE_CART_LINES_KEY, JSON.stringify([line]));
    router.push("/contact?type=quote");
  }

  return (
    <div>
      {sizes && sizes.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-900/70">Available sizes</p>
          <p className="mt-2 text-sm text-ink-900/80">{sizes.join(", ")}</p>
        </div>
      )}
      {materials && materials.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-900/70">Materials &amp; finishes</p>
          <p className="mt-2 text-sm text-ink-900/80">{materials.join(", ")}</p>
        </div>
      )}
      <div className="mt-6 rounded-2xl bg-white p-4">
        <p className="text-sm text-ink-900/80">
          This product&apos;s price depends on your exact size, material and quantity — tell us what you
          need and we&apos;ll send a firm quote within one business day.
        </p>
      </div>
      <button
        type="button"
        onClick={handleRequestQuote}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-maple-gradient px-6 py-3.5 text-sm font-semibold text-ink-950"
      >
        Request a quote
      </button>
    </div>
  );
}
