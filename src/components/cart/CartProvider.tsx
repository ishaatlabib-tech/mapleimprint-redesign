"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type CartItemPriceTier = { minQty: number; maxQty: number | null; pricePerUnit: number };

export type CartItem = {
  id: string;
  name: string;
  image: string;
  categorySlug: string;
  categoryName: string;
  /** Set on BLANK lines only (ProductCustomizer.handleBuyBlank) — needed so /api/checkout/quote
   *  can look the real CatalogueProduct back up server-side and recompute its price authoritatively
   *  rather than trusting this line's stored `startingPrice`. Not stored anywhere before this
   *  (ACTIVATE REAL CHECKOUT brief) — `id` alone encodes these as an unparseable composite string,
   *  which is why the checkout brief's server-authoritative quote endpoint needed real fields to
   *  look products up by. Optional so existing localStorage carts from before this change don't
   *  break; a line missing these is simply treated as QUOTE_REQUIRED by the quote endpoint. */
  subcategorySlug?: string;
  productSlug?: string;
  quantity: number;
  /** Price at the lowest quantity tier, from the real print-cost chart — null when this item has
   *  no real catalogue product yet (shown as quote-only in the cart, never a guessed number). */
  startingPrice?: number | null;
  /** Set only by the product customizer (colour + per-size quantity picker). When present, the
   *  cart prices this item off the tier matching its CURRENT quantity rather than startingPrice's
   *  fixed lowest-tier number — so the price stays accurate if the customer adjusts quantity from
   *  the cart, instead of quietly showing a stale 1-2-unit price for a 50-unit order. */
  priceTiers?: CartItemPriceTier[];
  colourName?: string;
  sizeBreakdown?: { size: string; qty: number }[];
  /** How this line was configured. Absent/undefined on older cart items and on non-apparel
   *  quick-add items — treat as equivalent to a plain quote-required line. */
  customizationType?: "BLANK" | "CUSTOM" | "MAPLE_DESIGNER";
  /** Set only for customizationType "CUSTOM" — the Studio project this line was built from. */
  designProjectId?: string;
  designRevision?: number;
  /** The `DesignProject.frozenRevision` this cart line was added at — set by the freeze endpoint
   *  (POST /api/studio/[id]/freeze), called right before addItem in handleApproveAndAddToCart.
   *  Order creation uses this (not the live, possibly-newer `revision`) to confirm the frozen
   *  snapshot it's about to price/produce is the exact one the customer approved. */
  designFrozenRevision?: number;
  /** Set only for "MAPLE_DESIGNER" — the customer's mystery-design brief (see SurpriseMePanel).
   *  Maple always sends a digital proof for approval before producing a designer-created piece —
   *  this is never blind/unapproved production. */
  assistanceBrief?: {
    purpose: "business" | "team" | "event" | "gift" | "personal" | "clothing-brand" | "other";
    vibe: "clean" | "bold" | "fun" | "vintage" | "premium" | "streetwear" | "surprise-me";
    includeNotes: string;
    avoidNotes: string;
    uploadedFileUrl?: string;
    /** The Asset row (src/lib/uploads/saveUpload.ts) tracking the uploaded file above — needed so
     *  this brief's file survives a "Get a quote" handoff with a real traceable reference instead
     *  of just a bare URL. Undefined for briefs submitted before this field existed. */
    uploadedAssetId?: string;
  };
  previewImageUrl?: string;
};

type CartContextValue = {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "quantity">, qty?: number) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, qty: number) => void;
  clearCart: () => void;
  totalCount: number;
  /** False until the one-time localStorage read on mount completes — checkout's empty-cart
   *  redirect (ACTIVATE REAL CHECKOUT brief, Section 11) needs this so it doesn't mistake "hasn't
   *  loaded yet" for "genuinely empty" and bounce a customer with a real cart back to /cart. */
  hydrated: boolean;
};

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "mi-cart";

// Written by the cart page's "Get a quote" action, read once by QuoteWizard
// on mount to prefill the product description — a plain sessionStorage
// handoff rather than routing state, so it survives the full navigation.
export const QUOTE_PREFILL_KEY = "mi-quote-prefill";

/** One structured line per cart item, forwarded (not discarded) when a cart needs a quote —
 *  previously handleGetQuote collapsed the entire cart, including an already-frozen Studio design
 *  or a Mystery/Designer's Choice brief with its uploaded file, into a single plain-text summary
 *  string, silently losing everything structured. Field set is deliberately just "everything
 *  already on CartItem," so every quote-eligible cart item — CUSTOM, BLANK, or MAPLE_DESIGNER —
 *  can be represented without inventing new shapes per customizationType. */
export type QuoteCartHandoff = {
  cartItemId: string;
  name: string;
  quantity: number;
  categorySlug: string;
  categoryName?: string;
  colourName?: string;
  sizeBreakdown?: { size: string; qty: number }[];
  customizationType?: CartItem["customizationType"];
  designProjectId?: string;
  designFrozenRevision?: number;
  assistanceBrief?: CartItem["assistanceBrief"];
  productSlug?: string;
  subcategorySlug?: string;
};

// Structured counterpart to QUOTE_PREFILL_KEY, written alongside it (not instead of it — the
// wizard still wants a human-readable text summary regardless of whether structure is available).
export const QUOTE_CART_LINES_KEY = "mi-quote-cart-lines";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // One-time sync from a browser-only external store (localStorage) on
    // mount, to avoid an SSR/client hydration mismatch — not a candidate for
    // useSyncExternalStore since this is a one-shot read, not a subscription.
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setItems(JSON.parse(raw));
    } catch {
      // Ignore malformed/unavailable storage — cart just starts empty.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items, hydrated]);

  const addItem = useCallback((item: Omit<CartItem, "quantity">, qty = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) {
        return prev.map((i) => {
          if (i.id !== item.id) return i;
          // Merge per-size quantities (same colour/product re-configured) rather than losing the
          // original breakdown — sizes in common get summed, new sizes get appended.
          const mergedSizes = item.sizeBreakdown
            ? [...(i.sizeBreakdown ?? [])]
            : i.sizeBreakdown;
          if (item.sizeBreakdown && mergedSizes) {
            for (const incoming of item.sizeBreakdown) {
              const match = mergedSizes.find((s) => s.size === incoming.size);
              if (match) match.qty += incoming.qty;
              else mergedSizes.push({ ...incoming });
            }
          }
          return { ...i, quantity: i.quantity + qty, sizeBreakdown: mergedSizes ?? item.sizeBreakdown };
        });
      }
      return [...prev, { ...item, quantity: qty }];
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const updateQuantity = useCallback((id: string, qty: number) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, quantity: Math.max(1, qty) } : i)),
    );
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const totalCount = useMemo(() => items.reduce((sum, i) => sum + i.quantity, 0), [items]);

  const value = useMemo(
    () => ({ items, addItem, removeItem, updateQuantity, clearCart, totalCount, hydrated }),
    [items, addItem, removeItem, updateQuantity, clearCart, totalCount, hydrated],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
