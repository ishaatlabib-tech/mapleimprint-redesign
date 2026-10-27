"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SpinnerGap, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { getOrCreateClientSessionToken } from "@/lib/studio/session";
import { DRINKWARE_VARIANTS, quoteDrinkware, type DrinkwareKind } from "@/lib/houseProducts/pricing/drinkware";
import { isQuoteError } from "@/lib/houseProducts/pricing/types";
import { OptionCardGrid, type OptionCardGridItem } from "@/components/products/OptionCardGrid";
import { QUOTE_PREFILL_KEY, QUOTE_CART_LINES_KEY, type QuoteCartHandoff } from "@/components/cart/CartProvider";
import type { CatalogueProduct } from "@/lib/products";

/** One configurator shared across every drinkware kind (mug/tumbler/water-bottle/pint-glass) —
 *  same shape as PaperProductConfigurator's `kind` branch: a size/style picker plus quantity,
 *  pointed at a different slice of DRINKWARE_VARIANTS. */
export function DrinkwareConfigurator({ product, kind }: { product: CatalogueProduct; kind: DrinkwareKind }) {
  const router = useRouter();
  const variants = DRINKWARE_VARIANTS[kind];
  const [variantKey, setVariantKey] = useState<string>(variants[0].key);
  const variant = variants.find((v) => v.key === variantKey) ?? variants[0];
  const [quantity, setQuantity] = useState(variant.minQty);
  const [startingStudio, setStartingStudio] = useState(false);
  const [studioError, setStudioError] = useState<string | null>(null);

  const quote = useMemo(() => quoteDrinkware({ kind, variantKey, quantity }), [kind, variantKey, quantity]);

  const variantOptions: OptionCardGridItem[] = variants.map((v) => {
    const q = quoteDrinkware({ kind, variantKey: v.key, quantity: v.minQty });
    return {
      value: v.key,
      label: v.label,
      sublabel: `Min ${v.minQty.toLocaleString()}`,
      priceDelta: !isQuoteError(q) ? `From $${(q.unitPriceCents / 100).toFixed(2)}` : undefined,
    };
  });

  function handleVariantChange(nextKey: string) {
    setVariantKey(nextKey);
    const next = variants.find((v) => v.key === nextKey);
    if (next && quantity < next.minQty) setQuantity(next.minQty);
  }

  async function handleDesign() {
    if (isQuoteError(quote) || startingStudio) return;
    setStartingStudio(true);
    setStudioError(null);
    try {
      getOrCreateClientSessionToken();

      const res = await fetch("/api/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          productSlug: product.slug,
          categorySlug: product.categorySlug,
          subcategorySlug: product.subcategorySlug,
          productName: product.name,
          brandName: product.brandName,
          colourName: variant.label,
          sizeBreakdown: [{ size: variant.label, qty: quantity }],
          totalQuantity: quantity,
          pricingSnapshot: {
            unitBasePrice: quote.unitPriceCents / 100,
            designFee: 0,
            chartFirstLocationCost: 0,
            chartAdditionalLocationCost: 0,
            quantity,
            total: quote.totalCents / 100,
            printRuleVersion: product.printRuleVersion,
          },
          mockupImages: {},
          // Every drinkware kind (mug/tumbler/water-bottle/pint-glass) shares the one real
          // "mug-wrap" print area/schematic — a full cylindrical wrap print is the same shape of
          // surface regardless of which vessel it's on; see productDecorationProfile.ts's "mug"
          // family (REVIEW_REQUIRED either way, Maple confirms exact curvature before production).
          sides: [{ type: "mug-wrap" }],
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't start your design.");
      router.push(`/studio/${data.id}`);
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : "Couldn't start your design. Please try again.");
      setStartingStudio(false);
    }
  }

  function handleCustomQuote() {
    window.sessionStorage.setItem(
      QUOTE_PREFILL_KEY,
      `${product.name} (${variant.label}) — custom printed, ${quantity} units`,
    );
    const line: QuoteCartHandoff = {
      cartItemId: `drinkware-quote-${product.slug}-${variant.key}-${crypto.randomUUID()}`,
      name: product.name,
      quantity,
      categorySlug: product.categorySlug,
      subcategorySlug: product.subcategorySlug,
      productSlug: product.slug,
      colourName: variant.label,
    };
    window.sessionStorage.setItem(QUOTE_CART_LINES_KEY, JSON.stringify([line]));
    router.push("/contact?type=quote");
  }

  return (
    <div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-900/70">Style</p>
        <div className="mt-2">
          <OptionCardGrid options={variantOptions} selected={variantKey} onSelect={handleVariantChange} />
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-900/70">Quantity (min {variant.minQty.toLocaleString()})</p>
        <input
          type="number"
          min={variant.minQty}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(variant.minQty, Math.round(Number(e.target.value) || variant.minQty)))}
          className="mt-2 w-full rounded-xl border border-sand bg-white px-4 py-3 text-sm text-ink-900 focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20"
        />
      </div>

      <div className="mt-6 rounded-2xl bg-white p-4">
        {isQuoteError(quote) ? (
          <p className="flex items-start gap-1.5 text-sm text-crimson">
            <WarningCircle className="mt-0.5 size-4 shrink-0" weight="bold" />
            {quote.error}
          </p>
        ) : (
          <>
            <p className="font-display text-lg font-semibold text-ink-900">
              ${(quote.totalCents / 100).toFixed(2)}
              <span className="text-sm font-normal text-muted"> for {quantity.toLocaleString()}</span>
            </p>
            <p className="text-xs text-muted">${(quote.unitPriceCents / 100).toFixed(2)} each</p>
            {quote.priceIsEstimate && <p className="mt-1 text-xs text-muted">Estimated pricing at this quantity.</p>}
          </>
        )}
      </div>

      {studioError && <p className="mt-3 rounded-lg bg-crimson/10 px-3 py-2 text-xs font-medium text-crimson">{studioError}</p>}

      <button
        type="button"
        onClick={handleDesign}
        disabled={isQuoteError(quote) || startingStudio}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-maple-gradient px-6 py-3.5 text-sm font-semibold text-ink-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      >
        {startingStudio ? <SpinnerGap className="size-4 animate-spin" weight="bold" /> : "Customize Your Product →"}
      </button>
      <p className="mt-2 text-center text-xs text-muted">Add your logo, text or artwork in Maple Studio.</p>

      <button
        type="button"
        onClick={handleCustomQuote}
        className="mt-4 w-full text-center text-sm font-semibold text-ink-900 underline-offset-4 hover:underline"
      >
        Request Custom Quote
      </button>
    </div>
  );
}
