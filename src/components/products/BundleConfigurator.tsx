"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus, SpinnerGap } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import {
  useCart,
  QUOTE_PREFILL_KEY,
  QUOTE_CART_LINES_KEY,
  type QuoteCartHandoff,
} from "@/components/cart/CartProvider";
import { formatUnitPrice } from "@/lib/pricing/formatUnitPrice";
import {
  bundleCartTiers,
  bundleEntryFor,
  bundleOption,
  bundleUnitLabel,
  bundleUnitPrice,
} from "@/lib/houseProducts/pricing/bundles";
import { getOrCreateClientSessionToken } from "@/lib/studio/session";
import { drinkwareConfigFor } from "@/lib/studio/drinkwareCustomization";
import type { CatalogueProduct } from "@/lib/products";

const MONEY = new Intl.NumberFormat("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => `$${MONEY.format(n)}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** For supplier-bundle products (CatalogueProduct.bundlePricing — the Joto drinkware line): pick the
 *  option (colour/size/finish), see every quantity tier, choose how many cases/packs, add to cart.
 *  All prices come from src/lib/houseProducts/pricing/bundles.ts, the same module checkout's
 *  server-side priceCartItem uses, so the cart can't be charged anything different. */
export function BundleConfigurator({
  product,
  categoryName,
  onColourChange,
}: {
  product: CatalogueProduct;
  categoryName: string;
  onColourChange: (colour: string) => void;
}) {
  const { addItem } = useCart();
  const router = useRouter();
  const optionGroup = bundleOption(product);
  const [option, setOption] = useState<string | null>(optionGroup?.values[0] ?? null);
  const entry = bundleEntryFor(product, option);
  const minBundles = entry?.tiers[0]?.bundleCount ?? 1;
  const [qtyText, setQtyText] = useState(String(minBundles));
  const qty = Math.max(minBundles, Math.floor(Number(qtyText)) || minBundles);
  const setQty = (n: number) => setQtyText(String(Math.max(minBundles, n)));
  const [added, setAdded] = useState(false);
  const [startingStudio, setStartingStudio] = useState(false);
  const [studioError, setStudioError] = useState<string | null>(null);
  // Drinkware bundle products (Joto) are customizable — they get "Customize" + "Request Custom
  // Quote" alongside the blank "Add to cart". Non-drinkware bundles keep the existing two actions.
  const drinkwareCfg = drinkwareConfigFor(product);

  // Show the chosen option's own photos when it has any (colours/finishes); size options have none,
  // so the gallery keeps showing every photo rather than a misleading "not available" notice.
  function galleryColourFor(value: string | null) {
    return value && product.images.some((img) => img.colourName === value) ? value : "";
  }
  useEffect(() => {
    onColourChange(galleryColourFor(option));
    // Only the initial option needs syncing here; later changes go through chooseOption.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function chooseOption(value: string) {
    setOption(value);
    onColourChange(galleryColourFor(value));
  }

  if (!entry) {
    return <p className="text-sm text-muted">Pricing for this option isn&apos;t available yet — please request a quote.</p>;
  }

  const unitLabel = bundleUnitLabel(entry);
  const isUnit = entry.sellUnit === "unit";
  const bundleWord = isUnit ? "unit" : entry.sellUnit;
  const unitPrice = bundleUnitPrice(entry, qty);
  const total = unitPrice !== null ? unitPrice * qty : null;
  const activeTier = [...entry.tiers].reverse().find((t) => qty >= t.bundleCount) ?? null;

  function handleAddToCart() {
    if (!entry || unitPrice === null) return;
    const optionText = option ? ` — ${option}` : "";
    addItem(
      {
        id: `${product.categorySlug}-${product.subcategorySlug}-${product.slug}-${option ?? "default"}-bundle`,
        name: `${product.name}${optionText}`,
        image: (product.images.find((i) => option && i.colourName === option) ?? product.images[0])?.url ?? "",
        categorySlug: product.categorySlug,
        categoryName,
        subcategorySlug: product.subcategorySlug,
        productSlug: product.slug,
        startingPrice: bundleCartTiers(entry)[0].pricePerUnit,
        priceTiers: bundleCartTiers(entry),
        colourName: option ?? undefined,
        customizationType: "BLANK",
      },
      qty,
    );
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1800);
  }

  function handleRequestQuote() {
    const summary = `${product.name}${option ? ` (${option})` : ""} — ${plural(qty, bundleWord)}${
      total !== null ? `, ${money(total)} CAD` : ""
    }`;
    window.sessionStorage.setItem(QUOTE_PREFILL_KEY, summary);
    router.push("/contact?type=quote");
  }

  // Total individual products across the selected packs — the quantity the design applies to and
  // the figure staff need to see ("2 packs of 6 = 12 mugs"), not the pack count.
  const totalItems = entry.sellUnit === "unit" ? qty : qty * entry.itemsPerBundle;
  // Per-individual-item blank base price, for the design project's pricingSnapshot. Printing is
  // kept at zero here (base vs print stay separate) — drinkware has no automated print price, so
  // the finished design routes to a quote where Maple confirms the printing cost.
  const perItemBase = unitPrice !== null ? Math.round((unitPrice / (entry.sellUnit === "unit" ? 1 : entry.itemsPerBundle)) * 100) / 100 : 0;

  async function handleDesign() {
    if (!entry || !drinkwareCfg || startingStudio) return;
    setStartingStudio(true);
    setStudioError(null);
    try {
      // Ensures the mi-session cookie exists before /api/studio reads it from the request.
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
          colourName: option ?? "Standard",
          sizeBreakdown: [{ size: option ?? bundleUnitLabel(entry), qty: totalItems }],
          totalQuantity: totalItems,
          pricingSnapshot: {
            unitBasePrice: perItemBase,
            designFee: 0,
            chartFirstLocationCost: 0,
            chartAdditionalLocationCost: 0,
            quantity: totalItems,
            total: perItemBase * totalItems,
            printRuleVersion: product.printRuleVersion,
          },
          mockupImages: {},
          sides: drinkwareCfg.locations.map((type) => ({ type })),
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
    const optionText = option ? ` (${option})` : "";
    window.sessionStorage.setItem(
      QUOTE_PREFILL_KEY,
      `${product.name}${optionText} — custom printed, ${plural(totalItems, "unit")}`,
    );
    const line: QuoteCartHandoff = {
      cartItemId: `drinkware-quote-${product.slug}-${option ?? "default"}-${crypto.randomUUID()}`,
      name: product.name,
      quantity: totalItems,
      categorySlug: product.categorySlug,
      categoryName,
      subcategorySlug: product.subcategorySlug,
      productSlug: product.slug,
      colourName: option ?? undefined,
    };
    window.sessionStorage.setItem(QUOTE_CART_LINES_KEY, JSON.stringify([line]));
    router.push("/contact?type=quote");
  }

  return (
    <div>
      <p className="font-display text-3xl font-semibold text-ink-900">
        {unitPrice !== null ? money(unitPrice) : "—"}
        <span className="text-base font-normal text-muted"> / {unitLabel}</span>
      </p>
      {!isUnit && unitPrice !== null && (
        <p className="mt-1 text-sm text-muted">
          {formatUnitPrice(Math.round((unitPrice / entry.itemsPerBundle) * 100) / 100)} per item ·{" "}
          {entry.itemsPerBundle} items in every {entry.sellUnit}
        </p>
      )}

      {optionGroup && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-900/70">
            {optionGroup.name} <span className="font-normal normal-case text-muted">— {option}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {optionGroup.values.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => chooseOption(v)}
                aria-pressed={v === option}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                  v === option ? "bg-ink-950 text-white" : "bg-white text-ink-900 hover:bg-ink-950/5",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-2xl bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-950/10">
              <th className="px-4 py-3 font-semibold text-ink-900">Buy</th>
              <th className="px-4 py-3 font-semibold text-ink-900">Price per {bundleWord}</th>
              {!isUnit && <th className="px-4 py-3 font-semibold text-ink-900">Per item</th>}
            </tr>
          </thead>
          <tbody>
            {entry.tiers.map((t) => {
              const per = Math.round((t.totalCad / t.bundleCount) * 100) / 100;
              return (
                <tr
                  key={t.bundleCount}
                  className={cn("border-b border-ink-950/5 last:border-0", t === activeTier && "bg-canvas")}
                >
                  <td className="px-4 py-3 text-ink-900">
                    {isUnit ? `${t.bundleCount}+ units` : `${t.bundleCount}+ ${t.bundleCount === 1 ? bundleWord : `${bundleWord}s`}`}
                    {!isUnit && <span className="block text-xs text-muted">{t.totalItems} items</span>}
                  </td>
                  <td className="px-4 py-3 font-semibold text-ink-900">{money(per)}</td>
                  {!isUnit && (
                    <td className="px-4 py-3 text-ink-900/80">
                      {formatUnitPrice(Math.round((per / entry.itemsPerBundle) * 100) / 100)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <label htmlFor="bundle-qty" className="text-xs font-semibold uppercase tracking-wide text-ink-900/70">
          Number of {bundleWord}s
        </label>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            aria-label={`Decrease number of ${bundleWord}s`}
            onClick={() => setQty(qty - 1)}
            disabled={qty <= minBundles}
            className="flex size-10 items-center justify-center rounded-full bg-white text-ink-900 disabled:opacity-40"
          >
            <Minus weight="bold" className="size-4" />
          </button>
          <input
            id="bundle-qty"
            type="number"
            inputMode="numeric"
            min={minBundles}
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            onBlur={() => setQty(qty)}
            className="h-10 w-24 rounded-full bg-white px-4 text-center text-sm font-semibold text-ink-900"
          />
          <button
            type="button"
            aria-label={`Increase number of ${bundleWord}s`}
            onClick={() => setQty(qty + 1)}
            className="flex size-10 items-center justify-center rounded-full bg-white text-ink-900"
          >
            <Plus weight="bold" className="size-4" />
          </button>
          {total !== null && (
            <p className="ml-auto text-right text-sm text-muted">
              <span className="block font-display text-xl font-semibold text-ink-900">{money(total)}</span>
              {isUnit ? plural(qty, "unit") : `${qty * entry.itemsPerBundle} items`} · CAD, before tax
            </p>
          )}
        </div>
      </div>

      {drinkwareCfg ? (
        // Customizable drinkware: design is the primary action; blank "Add to cart" stays as a
        // secondary option; a custom quote is the third path. Pack pricing above is untouched.
        <>
          <button
            type="button"
            onClick={handleDesign}
            disabled={unitPrice === null || startingStudio}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-maple-gradient px-6 py-3.5 text-sm font-semibold text-ink-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {startingStudio ? <SpinnerGap className="size-4 animate-spin" weight="bold" /> : "Customize Your Product →"}
          </button>
          <p className="mt-2 text-center text-xs text-muted">Add your logo, text or artwork in Maple Studio.</p>
          {studioError && (
            <p className="mt-3 rounded-lg bg-crimson/10 px-3 py-2 text-xs font-medium text-crimson">{studioError}</p>
          )}

          <button
            type="button"
            onClick={handleAddToCart}
            disabled={unitPrice === null}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-ink-950/20 px-6 py-3 text-sm font-semibold text-ink-900 transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
          >
            {added ? (
              <>
                <Check weight="bold" className="size-4" /> Added to cart
              </>
            ) : (
              "Add to cart — blank"
            )}
          </button>
          <p className="mt-2 text-center text-xs text-muted">Undecorated packs, no printing.</p>

          <button
            type="button"
            onClick={handleCustomQuote}
            className="mt-4 w-full text-center text-sm font-semibold text-ink-900 underline-offset-4 hover:underline"
          >
            Request Custom Quote
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={unitPrice === null}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-maple-gradient px-6 py-3.5 text-sm font-semibold text-ink-950 disabled:opacity-50"
          >
            {added ? (
              <>
                <Check weight="bold" className="size-4" /> Added to cart
              </>
            ) : (
              "Add to cart"
            )}
          </button>
          <button
            type="button"
            onClick={handleRequestQuote}
            className="mt-3 w-full text-center text-sm font-semibold text-ink-900 underline-offset-4 hover:underline"
          >
            Need printing or a larger order? Request a quote
          </button>
        </>
      )}
    </div>
  );
}
