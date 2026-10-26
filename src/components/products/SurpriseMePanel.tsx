"use client";

import { useState } from "react";
import { X, Check, SpinnerGap, UploadSimple } from "@phosphor-icons/react/dist/ssr";
import { useCart } from "@/components/cart/CartProvider";
import { heroImageFor } from "@/lib/productVariant";
import { getOrCreateClientSessionToken } from "@/lib/studio/session";
import type { CatalogueProduct } from "@/lib/products";

type Purpose = "business" | "team" | "event" | "gift" | "personal" | "clothing-brand" | "other";
type Vibe = "clean" | "bold" | "fun" | "vintage" | "premium" | "streetwear" | "surprise-me";

const PURPOSE_OPTIONS: { value: Purpose; label: string }[] = [
  { value: "business", label: "Business" },
  { value: "team", label: "Team" },
  { value: "event", label: "Event" },
  { value: "gift", label: "Gift" },
  { value: "personal", label: "Personal" },
  { value: "clothing-brand", label: "Clothing brand" },
  { value: "other", label: "Other" },
];

const VIBE_OPTIONS: { value: Vibe; label: string }[] = [
  { value: "clean", label: "Clean" },
  { value: "bold", label: "Bold" },
  { value: "fun", label: "Fun" },
  { value: "vintage", label: "Vintage" },
  { value: "premium", label: "Premium" },
  { value: "streetwear", label: "Streetwear" },
  { value: "surprise-me", label: "Surprise me completely" },
];

export function SurpriseMePanel({
  product,
  categoryName,
  selectedColour,
  sizeBreakdown,
  totalQuantity,
  onClose,
}: {
  product: CatalogueProduct;
  categoryName: string;
  selectedColour: string;
  sizeBreakdown: { size: string; qty: number }[];
  totalQuantity: number;
  onClose: () => void;
}) {
  const { addItem } = useCart();
  const [purpose, setPurpose] = useState<Purpose>("business");
  const [vibe, setVibe] = useState<Vibe>("clean");
  const [includeNotes, setIncludeNotes] = useState("");
  const [avoidNotes, setAvoidNotes] = useState("");
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const [uploadedAssetId, setUploadedAssetId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      // Opening this panel doesn't guarantee the customer has touched Studio yet (no other
      // product configurator entry point runs first) — same defensive call every configurator
      // makes before its own first upload.
      getOrCreateClientSessionToken();
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/studio/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      setUploadedFileUrl(data.url);
      setUploadedAssetId(data.assetId ?? null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit() {
    addItem(
      {
        id: `designer-${product.categorySlug}-${product.subcategorySlug}-${product.slug}-${selectedColour}-${Date.now()}`,
        name: product.name,
        // Was product.images[0] regardless of selectedColour — the cart line's colourName and its
        // thumbnail could disagree (Black label, White photo) for the exact bug this task fixes.
        image: heroImageFor(product, selectedColour)?.url ?? "",
        categorySlug: product.categorySlug,
        categoryName,
        colourName: selectedColour,
        sizeBreakdown,
        customizationType: "MAPLE_DESIGNER",
        assistanceBrief: {
          purpose,
          vibe,
          includeNotes,
          avoidNotes,
          uploadedFileUrl: uploadedFileUrl ?? undefined,
          uploadedAssetId: uploadedAssetId ?? undefined,
        },
      },
      totalQuantity,
    );
    setSubmitted(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 sm:items-center sm:p-6">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-white p-6 sm:rounded-[28px]">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-crimson">✦ Designer&apos;s choice</p>
            <h2 className="mt-1 font-display text-lg font-semibold text-ink-900">Surprise me</h2>
            <p className="mt-1 text-sm text-muted">
              Give us the idea. Our design team creates something and sends it for your approval before anything prints.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink-900"
          >
            <X className="size-5" />
          </button>
        </div>

        {submitted ? (
          <div className="mt-8 flex flex-col items-center text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-crimson/10 text-crimson">
              <Check className="size-6" weight="bold" />
            </span>
            <p className="mt-4 font-display font-semibold text-ink-900">Added to your cart</p>
            <p className="mt-1.5 text-sm text-muted">
              We&apos;ve saved your brief with this item. Get a quote when you&apos;re ready — our design
              team will create a digital proof for your approval before anything goes to production.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 rounded-full bg-ink-950 px-5 py-2.5 text-sm font-semibold text-white"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <div className="rounded-2xl bg-canvas p-4 text-sm text-ink-900">
              <p className="font-semibold">{product.name}</p>
              <p className="mt-0.5 text-muted">
                {selectedColour} · {sizeBreakdown.map((s) => `${s.size} ×${s.qty}`).join(", ")} · {totalQuantity} total
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">What&apos;s this for?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {PURPOSE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPurpose(opt.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      purpose === opt.value
                        ? "border-transparent bg-ink-950 text-white"
                        : "border-sand text-ink-900/70 hover:border-ink-950/25"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Choose a vibe</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {VIBE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setVibe(opt.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      vibe === opt.value
                        ? "border-transparent bg-ink-950 text-white"
                        : "border-sand text-ink-900/70 hover:border-ink-950/25"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="include-notes" className="text-xs font-semibold uppercase tracking-wide text-muted">
                What should the design include?
              </label>
              <textarea
                id="include-notes"
                value={includeNotes}
                onChange={(e) => setIncludeNotes(e.target.value)}
                rows={2}
                placeholder="Optional"
                className="mt-2 w-full rounded-xl border border-sand px-3 py-2 text-sm text-ink-900 outline-none focus:border-ink-950/25"
              />
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Upload anything you&apos;d like us to use</p>
              <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-sand px-4 py-3 text-sm text-muted transition-colors hover:border-ink-950/25">
                {uploading ? (
                  <SpinnerGap className="size-4 animate-spin" weight="bold" />
                ) : (
                  <UploadSimple className="size-4" weight="bold" />
                )}
                {uploadedFileUrl ? "Replace file" : "Choose a file"}
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file);
                  }}
                />
              </label>
              {uploadedFileUrl && <p className="mt-1.5 text-xs text-crimson">File attached ✓</p>}
              {uploadError && <p className="mt-1.5 text-xs text-crimson">{uploadError}</p>}
            </div>

            <div>
              <label htmlFor="avoid-notes" className="text-xs font-semibold uppercase tracking-wide text-muted">
                Anything we should avoid?
              </label>
              <textarea
                id="avoid-notes"
                value={avoidNotes}
                onChange={(e) => setAvoidNotes(e.target.value)}
                rows={2}
                placeholder="Optional"
                className="mt-2 w-full rounded-xl border border-sand px-3 py-2 text-sm text-ink-900 outline-none focus:border-ink-950/25"
              />
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              className="w-full rounded-full bg-maple-gradient px-6 py-3 text-sm font-semibold text-ink-950"
            >
              Let the designers handle it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
