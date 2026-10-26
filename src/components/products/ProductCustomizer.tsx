"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus, SpinnerGap } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { useCart, QUOTE_PREFILL_KEY, QUOTE_CART_LINES_KEY, type QuoteCartHandoff } from "@/components/cart/CartProvider";
import { getOrCreateClientSessionToken } from "@/lib/studio/session";
import { blankUnitPrice, calculateCustomizePrice } from "@/lib/studio/pricing";
import { standardLocationsFor } from "@/lib/studio/productDecorationProfile";
import { heroImageFor } from "@/lib/productVariant";
import { SurpriseMePanel } from "@/components/products/SurpriseMePanel";
import { SizeGuidePanel } from "@/components/products/SizeGuidePanel";
import { PaperProductConfigurator } from "@/components/products/PaperProductConfigurator";
import { BannerConfigurator } from "@/components/products/BannerConfigurator";
import { StickerConfigurator } from "@/components/products/StickerConfigurator";
import { LabelConfigurator } from "@/components/products/LabelConfigurator";
import { PosterConfigurator } from "@/components/products/PosterConfigurator";
import { DrinkwareConfigurator } from "@/components/products/DrinkwareConfigurator";
import { PromoConfigurator } from "@/components/products/PromoConfigurator";
import { SignConfigurator } from "@/components/products/SignConfigurator";
import { PackagingConfigurator } from "@/components/products/PackagingConfigurator";
import { QuoteOnlyConfigurator } from "@/components/products/QuoteOnlyConfigurator";
import { PriceListConfigurator } from "@/components/products/PriceListConfigurator";
import { BundleConfigurator } from "@/components/products/BundleConfigurator";
import type { DrinkwareKind } from "@/lib/houseProducts/pricing/drinkware";
import type { PromoKind } from "@/lib/houseProducts/pricing/promo";
import type { SignKind } from "@/lib/houseProducts/pricing/signs";
import type { PackagingKind } from "@/lib/houseProducts/pricing/packaging";
import type { CatalogueProduct } from "@/lib/products";

const VISIBLE_COLOUR_COUNT = 8;

/** The one mount point ProductDetail.tsx renders — branches to a dedicated configurator for
 *  Maple's own house-produced lines (banners/cards/flyers), which need entirely different state
 *  (paper stock/sides, or size/material/add-ons — not garment colour/size) and can't share this
 *  component's hooks. Kept as a branch here, not a houseProductKind check inside the apparel body
 *  below, since conditionally skipping hooks based on a prop violates the rules of hooks. */
export function ProductCustomizer(props: {
  product: CatalogueProduct;
  categoryName: string;
  selectedColour: string;
  onColourChange: (colour: string) => void;
}) {
  const { product } = props;
  const kind = product.houseProductKind;
  if (kind === "business-card" || kind === "flyer" || kind === "postcard") {
    return <PaperProductConfigurator product={product} kind={kind} />;
  }
  if (kind === "banner") {
    return <BannerConfigurator product={product} />;
  }
  if (kind === "sticker") {
    // "Die-Cut Stickers", "Kiss-Cut Stickers" and "Clear Stickers" are three catalogue products
    // sharing this one configurator, distinguished by which shapes their subcategory allows and
    // (for Clear) which material starts selected — see StickerConfigurator's own comment.
    // Clear starts on Oval rather than Square/Circle — those two only ever got a White Plastic
    // price ladder (see stickers.ts's pricedMaterialsForShape comment), so defaulting to Square
    // here would silently fall back to White Plastic on load instead of actually showing Clear.
    const allowedShapes =
      product.subcategorySlug === "die-cut"
        ? (["die-cut"] as const)
        : product.subcategorySlug === "clear"
          ? (["oval", "rectangle", "square", "circle"] as const)
          : (["square", "circle", "rectangle", "oval"] as const);
    const defaultMaterial = product.subcategorySlug === "clear" ? "clear-plastic" : undefined;
    return <StickerConfigurator product={product} allowedShapes={[...allowedShapes]} defaultMaterial={defaultMaterial} />;
  }
  if (kind === "label") {
    return <LabelConfigurator product={product} />;
  }
  if (kind === "poster") {
    return <PosterConfigurator product={product} />;
  }
  if (kind?.startsWith("drinkware-")) {
    return <DrinkwareConfigurator product={product} kind={kind.slice("drinkware-".length) as DrinkwareKind} />;
  }
  if (kind?.startsWith("promo-")) {
    return <PromoConfigurator product={product} kind={kind.slice("promo-".length) as PromoKind} />;
  }
  if (kind === "sign-yard" || kind === "sign-rigid" || kind === "sign-window-cling") {
    return <SignConfigurator product={product} kind={kind.slice("sign-".length) as SignKind} />;
  }
  if (kind === "packaging-product-box" || kind === "packaging-mailer-box" || kind === "packaging-tissue-paper" || kind === "packaging-tape") {
    const packagingKind = (kind === "packaging-tape" ? "packaging-tape" : kind.slice("packaging-".length)) as PackagingKind;
    return <PackagingConfigurator product={product} kind={packagingKind} />;
  }
  if (product.bundlePricing && product.bundlePricing.length > 0) {
    return <BundleConfigurator product={product} categoryName={props.categoryName} onColourChange={props.onColourChange} />;
  }
  if (kind === "price-list") {
    return <PriceListConfigurator product={product} />;
  }
  if (kind === "quote-only") {
    return (
      <QuoteOnlyConfigurator
        product={product}
        sizes={product.quoteOnlyInfo?.sizes}
        materials={product.quoteOnlyInfo?.materials}
      />
    );
  }
  return <ApparelCustomizer {...props} />;
}

function ApparelCustomizer({
  product,
  categoryName,
  selectedColour,
  onColourChange,
}: {
  product: CatalogueProduct;
  categoryName: string;
  selectedColour: string;
  onColourChange: (colour: string) => void;
}) {
  const { addItem } = useCart();
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [showAllColours, setShowAllColours] = useState(false);
  const [availabilityNotice, setAvailabilityNotice] = useState<string | null>(null);
  const [addedBlank, setAddedBlank] = useState(false);
  const [startingStudio, setStartingStudio] = useState(false);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [showAssistPanel, setShowAssistPanel] = useState(false);
  const [showSizeGuide, setShowSizeGuide] = useState(false);

  const availableSizes = useMemo(
    () => product.sizes.filter((size) => product.variants.some((v) => v.colourName === selectedColour && v.size === size)),
    [product.sizes, product.variants, selectedColour],
  );

  const totalQty = Object.values(quantities).reduce((sum, n) => sum + n, 0);
  const sizeBreakdown = Object.entries(quantities)
    .filter(([, qty]) => qty > 0)
    .map(([size, qty]) => ({ size, qty }));

  const blankPrice = blankUnitPrice(product);
  const quoteOnly = blankPrice === null;
  // Always priced at at least qty 1, even before the customer picks a size, so the page shows a
  // real "from" figure immediately rather than nothing — this is the current/default (front-only)
  // configuration's price, not a fixed number; Studio updates it live as locations are added.
  const customizePricing = calculateCustomizePrice(product, Math.max(1, totalQty), 1);

  const visibleColours = showAllColours ? product.colours : product.colours.slice(0, VISIBLE_COLOUR_COUNT);
  const hiddenColourCount = product.colours.length - VISIBLE_COLOUR_COUNT;

  function setQty(size: string, qty: number) {
    setQuantities((prev) => ({ ...prev, [size]: Math.max(0, qty) }));
  }

  function selectColour(colour: string) {
    const stillAvailable = (size: string) => product.variants.some((v) => v.colourName === colour && v.size === size);
    const lostSizes = Object.entries(quantities)
      .filter(([size, qty]) => qty > 0 && !stillAvailable(size))
      .map(([size]) => size);

    if (lostSizes.length > 0) {
      setQuantities((prev) => {
        const next = { ...prev };
        for (const size of lostSizes) next[size] = 0;
        return next;
      });
      setAvailabilityNotice(
        `${lostSizes.join(", ")} isn't currently available in ${colour}. Choose another size, or a different colour.`,
      );
    } else {
      setAvailabilityNotice(null);
    }
    onColourChange(colour);
  }

  async function handleCustomize() {
    if (totalQty === 0 || !customizePricing) return;
    setStartingStudio(true);
    setStudioError(null);
    try {
      // Ensures the mi-session cookie exists before the request fires — the API route reads it
      // from the request, it doesn't need the value passed explicitly.
      getOrCreateClientSessionToken();

      const frontImage = heroImageFor(product, selectedColour, "front")?.url;
      const backImage = product.images.find((img) => img.colourName === selectedColour && img.imageType === "back")?.url;
      const hasBackPhoto = product.images.some((img) => img.imageType === "back");

      // standardLocationsFor() is the product's ProductDecorationProfile filtered to STANDARD-only
      // locations — the ones with real photography Maple has already confirmed are orderable.
      // Every other location the product's family supports (right chest, sleeves, hood, etc.) is
      // still reachable inside Studio via the "More" location menu, added on demand as
      // REVIEW_REQUIRED (see /api/studio/[id]/locations) rather than created eagerly here.
      const sides = standardLocationsFor(product.categorySlug, product.subcategorySlug, hasBackPhoto);
      const mockupImages = Object.fromEntries(
        sides.map((loc) => [loc, loc === "back" ? backImage : frontImage]),
      );

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
          colourName: selectedColour,
          sizeBreakdown,
          totalQuantity: totalQty,
          pricingSnapshot: {
            unitBasePrice: customizePricing.blankUnitPrice,
            designFee: customizePricing.designFee,
            chartFirstLocationCost: customizePricing.chartFirstLocationCost,
            chartAdditionalLocationCost: customizePricing.chartAdditionalLocationCost,
            quantity: totalQty,
            total: customizePricing.total,
            printRuleVersion: product.printRuleVersion,
          },
          mockupImages,
          sides: sides.map((type) => ({ type })),
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

  function handleBuyBlank() {
    if (totalQty === 0 || blankPrice === null) return;
    addItem(
      {
        id: `${product.categorySlug}-${product.subcategorySlug}-${product.slug}-${selectedColour}-blank`,
        name: product.name,
        image: heroImageFor(product, selectedColour)?.url ?? "",
        categorySlug: product.categorySlug,
        categoryName,
        subcategorySlug: product.subcategorySlug,
        productSlug: product.slug,
        startingPrice: blankPrice,
        colourName: selectedColour,
        sizeBreakdown,
        customizationType: "BLANK",
      },
      totalQty,
    );
    setAddedBlank(true);
    setQuantities({});
    window.setTimeout(() => setAddedBlank(false), 1800);
  }

  function handleRequestQuote() {
    const summary = `${product.name}${selectedColour ? ` (${selectedColour})` : ""}`;
    window.sessionStorage.setItem(QUOTE_PREFILL_KEY, summary);
    // No Studio design/pricing exists for this path (apparel with no catalogue pricing) — still
    // worth a real structured line, same reasoning as QuoteOnlyConfigurator's own fix.
    const line: QuoteCartHandoff = {
      cartItemId: `apparel-quote-${product.slug}-${selectedColour}-${crypto.randomUUID()}`,
      name: product.name,
      quantity: totalQty || 1,
      categorySlug: product.categorySlug,
      categoryName,
      subcategorySlug: product.subcategorySlug,
      productSlug: product.slug,
      colourName: selectedColour,
      sizeBreakdown,
    };
    window.sessionStorage.setItem(QUOTE_CART_LINES_KEY, JSON.stringify([line]));
    router.push("/contact?type=quote");
  }

  return (
    <div>
      {product.colours.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-900/70">
            Colour <span className="font-normal normal-case text-muted">— {selectedColour}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {visibleColours.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => selectColour(c)}
                aria-pressed={c === selectedColour}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  c === selectedColour
                    ? "border-transparent bg-ink-950 text-white"
                    : "border-sand bg-white text-ink-900/70 hover:border-ink-950/25",
                )}
              >
                {c}
              </button>
            ))}
            {!showAllColours && hiddenColourCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllColours(true)}
                className="rounded-full border border-dashed border-sand px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-ink-950/25 hover:text-ink-900"
              >
                Show all {product.colours.length} colours
              </button>
            )}
          </div>
        </div>
      )}

      {availabilityNotice && (
        <p className="mt-3 rounded-lg bg-crimson/10 px-3 py-2 text-xs font-medium text-crimson">{availabilityNotice}</p>
      )}

      {availableSizes.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-900/70">Quantity per size</p>
            <button
              type="button"
              onClick={() => setShowSizeGuide(true)}
              className="text-xs font-semibold text-crimson underline-offset-2 hover:underline"
            >
              Size Guide
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {availableSizes.map((size) => (
              <div key={size} className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                <span className="text-sm font-medium text-ink-900">{size}</span>
                <div className="flex items-center gap-1 rounded-full border border-sand p-1">
                  <button
                    type="button"
                    aria-label={`Decrease ${size} quantity`}
                    onClick={() => setQty(size, (quantities[size] ?? 0) - 1)}
                    className="flex size-7 items-center justify-center rounded-full text-ink-900 transition-colors hover:bg-canvas"
                  >
                    <Minus className="size-3.5" weight="bold" />
                  </button>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={quantities[size] ?? 0}
                    onChange={(e) => setQty(size, Number(e.target.value) || 0)}
                    className="w-10 bg-transparent text-center text-sm font-semibold text-ink-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    aria-label={`Increase ${size} quantity`}
                    onClick={() => setQty(size, (quantities[size] ?? 0) + 1)}
                    className="flex size-7 items-center justify-center rounded-full text-ink-900 transition-colors hover:bg-canvas"
                  >
                    <Plus className="size-3.5" weight="bold" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 rounded-2xl bg-white p-4">
        {quoteOnly ? (
          <p className="text-sm text-muted">
            This product isn&apos;t on our standard print-cost chart yet, so pricing is confirmed in
            a quote rather than shown here.
          </p>
        ) : (
          <div>
            <p className="text-sm text-muted">
              {totalQty > 0 ? `${totalQty} unit${totalQty === 1 ? "" : "s"}` : "Choose at least one size to continue."}
            </p>
            <p className="font-display text-lg font-semibold text-ink-900">
              Blank ${blankPrice!.toFixed(2)} / unit
              {customizePricing && (
                <span className="text-sm font-normal text-muted"> · Customize from ${customizePricing.total.toFixed(2)}</span>
              )}
            </p>
          </div>
        )}
      </div>

      {studioError && (
        <p className="mt-3 rounded-lg bg-crimson/10 px-3 py-2 text-xs font-medium text-crimson">{studioError}</p>
      )}

      <div className="mt-4 space-y-3">
        {quoteOnly ? (
          <button
            type="button"
            onClick={handleRequestQuote}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-maple-gradient px-6 py-3 text-sm font-semibold text-ink-950"
          >
            Request a quote
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleCustomize}
              disabled={totalQty === 0 || startingStudio}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-maple-gradient px-6 py-3.5 text-sm font-semibold text-ink-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {startingStudio ? (
                <SpinnerGap className="size-4 animate-spin" weight="bold" />
              ) : (
                "Customize This Shirt →"
              )}
            </button>
            <p className="text-center text-xs text-muted">Add your logo, artwork or text in Maple Studio.</p>

            <button
              type="button"
              onClick={handleBuyBlank}
              disabled={totalQty === 0}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-full border px-6 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                addedBlank ? "border-transparent bg-ink-950 text-white" : "border-ink-950/20 text-ink-900 hover:bg-canvas",
              )}
            >
              {addedBlank ? (
                <>
                  <Check className="size-4" weight="bold" /> Added to cart
                </>
              ) : (
                "Buy It Blank"
              )}
            </button>
            <p className="text-center text-xs text-muted">No print or design. Just the garment.</p>

            <div className="mt-2 rounded-2xl bg-gradient-to-br from-gold/40 via-orange/40 to-crimson/40 p-px">
              <div className="rounded-[15px] bg-ink-950 p-5 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-orange">✦ Want us to create it?</p>
                <p className="mt-1.5 font-display text-base font-semibold text-white">Surprise Me — Designer&apos;s Choice</p>
                <p className="mt-1.5 text-xs leading-relaxed text-white/65">
                  Give our design team the idea. We&apos;ll create something for your shirt and send it
                  for approval before anything prints.
                </p>
                <button
                  type="button"
                  onClick={() => setShowAssistPanel(true)}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-maple-gradient px-5 py-2.5 text-xs font-semibold text-ink-950"
                >
                  Surprise Me →
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {showSizeGuide && <SizeGuidePanel productSlug={product.slug} onClose={() => setShowSizeGuide(false)} />}

      {showAssistPanel && (
        <SurpriseMePanel
          product={product}
          categoryName={categoryName}
          selectedColour={selectedColour}
          sizeBreakdown={sizeBreakdown.length > 0 ? sizeBreakdown : [{ size: product.sizes[0] ?? "One size", qty: 1 }]}
          totalQuantity={Math.max(1, totalQty)}
          onClose={() => setShowAssistPanel(false)}
        />
      )}
    </div>
  );
}
