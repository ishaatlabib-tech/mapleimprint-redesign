"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, PaperclipHorizontal, PencilSimple } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/Button";
import {
  CheckboxField,
  FieldError,
  FieldLabel,
  RadioCardGroup,
  TextArea,
  TextInput,
} from "@/components/ui/Field";
import { cn } from "@/lib/cn";
import { QUOTE_PREFILL_KEY, QUOTE_CART_LINES_KEY, type QuoteCartHandoff } from "@/components/cart/CartProvider";
import { getOrCreateClientSessionToken } from "@/lib/studio/session";

type ProjectType =
  | "apparel"
  | "uniforms"
  | "print"
  | "signs"
  | "stickers"
  | "promo"
  | "mixed"
  | "unsure";

type DeliveryMethod = "pickup" | "shipping";
type ContactMethod = "email" | "phone";

type UploadedFile = { fileId: string; fileName: string; webViewLink: string | null; assetId?: string };

type QuoteData = {
  projectType: ProjectType | null;
  productDescription: string;
  quantity: string;
  sizesVariants: string;
  budgetRange: string;
  decorationMethod: string;
  placements: string;
  personalization: boolean;
  designHelp: boolean;
  fileNotes: string;
  fileNames: string[];
  uploadedFiles: UploadedFile[];
  neededBy: string;
  eventDate: string;
  deliveryMethod: DeliveryMethod | null;
  postalCode: string;
  name: string;
  organization: string;
  email: string;
  phone: string;
  preferredContact: ContactMethod | null;
  consent: boolean;
};

const initialData: QuoteData = {
  projectType: null,
  productDescription: "",
  quantity: "",
  sizesVariants: "",
  budgetRange: "",
  decorationMethod: "",
  placements: "",
  personalization: false,
  designHelp: false,
  fileNotes: "",
  fileNames: [],
  uploadedFiles: [],
  neededBy: "",
  eventDate: "",
  deliveryMethod: null,
  postalCode: "",
  name: "",
  organization: "",
  email: "",
  phone: "",
  preferredContact: null,
  consent: false,
};

const STEP_LABELS = [
  "Project type",
  "Product & quantity",
  "Customization",
  "Files",
  "Deadline & delivery",
  "Contact",
  "Review",
];

const PROJECT_TYPE_OPTIONS: { value: ProjectType; label: string }[] = [
  { value: "apparel", label: "Custom apparel" },
  { value: "uniforms", label: "Uniforms" },
  { value: "print", label: "Business printing" },
  { value: "signs", label: "Signs & banners" },
  { value: "stickers", label: "Stickers & labels" },
  { value: "promo", label: "Promotional products" },
  { value: "mixed", label: "Mixed project" },
  { value: "unsure", label: "Not sure yet" },
];

export function QuoteWizard() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<QuoteData>(initialData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [cartLines, setCartLines] = useState<QuoteCartHandoff[]>([]);
  // Generated once per mount, reused across every submit retry (including a double-click or a
  // network-error retry) so /api/quote's idempotency check can recognize a resubmission instead
  // of creating a second QuoteRequest with a second reference.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    // One-shot read from a browser-only external store (sessionStorage) on
    // mount, written by the cart page's "Get a quote" handoff.
    const prefill = window.sessionStorage.getItem(QUOTE_PREFILL_KEY);
    if (prefill) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData((prev) => (prev.productDescription ? prev : { ...prev, productDescription: prefill }));
      window.sessionStorage.removeItem(QUOTE_PREFILL_KEY);
    }
    // Structured counterpart to the text prefill above — carries real designProjectId/
    // assistanceBrief/etc. through instead of collapsing the cart into a string (see
    // CartView.handleGetQuote). Kept separate from the text key since QuoteData.productDescription
    // still wants a human-readable summary regardless of whether structure is also available.
    const rawLines = window.sessionStorage.getItem(QUOTE_CART_LINES_KEY);
    if (rawLines) {
      try {
        setCartLines(JSON.parse(rawLines));
      } catch {
        // Malformed/stale sessionStorage value — fail open to an empty array rather than block
        // the wizard; the free-text prefill above still carries a human-readable summary.
      }
      window.sessionStorage.removeItem(QUOTE_CART_LINES_KEY);
    }
  }, []);

  function update<K extends keyof QuoteData>(key: K, value: QuoteData[K]) {
    setData((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
  }

  function validateStep(index: number): Record<string, string> {
    const next: Record<string, string> = {};
    if (index === 0 && !data.projectType) next.projectType = "Choose the option closest to your project.";
    if (index === 1 && !data.productDescription.trim()) next.productDescription = "Tell us what you'd like to order.";
    if (index === 4 && !data.neededBy) next.neededBy = "Let us know when you need this by.";
    if (index === 4 && !data.deliveryMethod) next.deliveryMethod = "Choose a delivery method.";
    if (index === 4 && data.deliveryMethod === "shipping" && !data.postalCode.trim())
      next.postalCode = "Add a postal code for a shipping estimate.";
    if (index === 5 && !data.name.trim()) next.name = "Your name is required.";
    if (index === 5 && !/^\S+@\S+\.\S+$/.test(data.email)) next.email = "Enter a valid email address.";
    return next;
  }

  function goNext() {
    const stepErrors = validateStep(step);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }
    setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  }

  function goTo(index: number) {
    setStep(index);
  }

  async function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      // Establishes the shared mi-session cookie if this is the customer's first upload anywhere
      // on the site (e.g. they landed straight on /contact?type=quote) — /api/upload now requires
      // it, same as /api/studio/upload, so every Asset row is owner-scoped consistently regardless
      // of entry point.
      getOrCreateClientSessionToken();
      const uploaded: UploadedFile[] = [];
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Couldn't upload ${file.name}.`);
        uploaded.push(json);
      }
      setData((prev) => ({
        ...prev,
        fileNames: [...prev.fileNames, ...uploaded.map((f) => f.fileName)],
        uploadedFiles: [...prev.uploadedFiles, ...uploaded],
      }));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    const stepErrors = { ...validateStep(1), ...validateStep(4), ...validateStep(5) };
    if (!data.consent) stepErrors.consent = "Please confirm we can contact you about this request.";
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, idempotencyKey, cartLines }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Something went wrong.");
      setReference(json.reference);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (reference) {
    return (
      <div className="rounded-[28px] bg-white p-8 lg:p-10">
        <span className="inline-flex size-14 items-center justify-center rounded-full bg-orange/10">
          <Check className="size-7 text-crimson" weight="bold" />
        </span>
        <h2 className="mt-5 font-display text-2xl font-semibold text-ink-900">Request submitted</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Your reference number is <span className="font-semibold text-ink-900">{reference}</span>. Our team will
          review the details and follow up by email with a scoped quote.
        </p>
        <div className="mt-6 space-y-2 rounded-2xl bg-canvas p-5 text-sm text-ink-900/80">
          <p className="font-semibold text-ink-900">What happens next</p>
          <p>Reviewing → Quote sent → Proof approval → Payment → Production → Ready for pickup or shipped.</p>
        </div>
        <Button
          variant="secondary"
          tone="light"
          className="mt-6"
          onClick={() => {
            setData(initialData);
            setStep(0);
            setReference(null);
          }}
        >
          Start another request
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-[28px] bg-white p-6 lg:p-10">
      <ol className="flex flex-wrap gap-x-2 gap-y-2 text-xs font-medium text-muted">
        {STEP_LABELS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-[10px]",
                i === step ? "bg-orange text-ink-950" : i < step ? "bg-ink-900 text-white" : "bg-canvas text-muted",
              )}
            >
              {i < step ? <Check className="size-3" weight="bold" /> : i + 1}
            </span>
            <span className={cn("hidden sm:inline", i === step && "text-ink-900")}>{label}</span>
            {i < STEP_LABELS.length - 1 && <span className="mx-1 hidden text-sand sm:inline">/</span>}
          </li>
        ))}
      </ol>

      <div className="mt-8 min-h-[280px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            {step === 0 && (
              <div>
                <h2 className="font-display text-xl font-semibold text-ink-900">What&apos;s this project for?</h2>
                <p className="mt-1.5 text-sm text-muted">Choose the closest match. You can add detail next.</p>
                <div className="mt-6">
                  <RadioCardGroup
                    name="projectType"
                    columns={2}
                    value={data.projectType}
                    onChange={(v) => update("projectType", v)}
                    options={PROJECT_TYPE_OPTIONS}
                  />
                  <FieldError>{errors.projectType}</FieldError>
                </div>
              </div>
            )}

            {step === 1 && (
              <div>
                <h2 className="font-display text-xl font-semibold text-ink-900">Product and quantity</h2>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <FieldLabel htmlFor="productDescription">Desired product or service</FieldLabel>
                    <TextInput
                      id="productDescription"
                      placeholder="e.g. Embroidered polos for staff"
                      value={data.productDescription}
                      onChange={(e) => update("productDescription", e.target.value)}
                    />
                    <FieldError>{errors.productDescription}</FieldError>
                  </div>
                  <div>
                    <FieldLabel htmlFor="quantity" optional>Approximate quantity</FieldLabel>
                    <TextInput
                      id="quantity"
                      placeholder="e.g. 75"
                      value={data.quantity}
                      onChange={(e) => update("quantity", e.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="budgetRange" optional>Budget range</FieldLabel>
                    <TextInput
                      id="budgetRange"
                      placeholder="e.g. $1,000-$1,500"
                      value={data.budgetRange}
                      onChange={(e) => update("budgetRange", e.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <FieldLabel htmlFor="sizesVariants" optional>Sizes / variants</FieldLabel>
                    <TextInput
                      id="sizesVariants"
                      placeholder="e.g. 20x S, 30x M, 25x L"
                      value={data.sizesVariants}
                      onChange={(e) => update("sizesVariants", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <h2 className="font-display text-xl font-semibold text-ink-900">Customization</h2>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <div>
                    <FieldLabel htmlFor="decorationMethod" optional>Decoration method, if known</FieldLabel>
                    <TextInput
                      id="decorationMethod"
                      placeholder="e.g. Laser engraving"
                      value={data.decorationMethod}
                      onChange={(e) => update("decorationMethod", e.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="placements" optional>Print locations / placements</FieldLabel>
                    <TextInput
                      id="placements"
                      placeholder="e.g. Left chest + back"
                      value={data.placements}
                      onChange={(e) => update("placements", e.target.value)}
                    />
                  </div>
                </div>
                <div className="mt-6 space-y-3">
                  <CheckboxField
                    id="personalization"
                    checked={data.personalization}
                    onChange={(v) => update("personalization", v)}
                  >
                    This includes personalization (names or numbers per item)
                  </CheckboxField>
                  <CheckboxField id="designHelp" checked={data.designHelp} onChange={(v) => update("designHelp", v)}>
                    I&apos;d like help from your design team
                  </CheckboxField>
                </div>
              </div>
            )}

            {step === 3 && (
              <div>
                <h2 className="font-display text-xl font-semibold text-ink-900">Files</h2>
                <p className="mt-1.5 text-sm text-muted">
                  Attach reference files below, or describe them and we&apos;ll follow up to collect the final versions securely.
                </p>
                <div className="mt-6">
                  <FieldLabel htmlFor="fileUpload" optional>Attach files</FieldLabel>
                  <label
                    htmlFor="fileUpload"
                    className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-sand bg-canvas px-6 py-8 text-center text-sm text-muted hover:border-orange/50"
                  >
                    <PaperclipHorizontal className="size-6 text-crimson" />
                    {uploading ? (
                      <span className="text-ink-900">Uploading…</span>
                    ) : data.fileNames.length > 0 ? (
                      <span className="text-ink-900">{data.fileNames.join(", ")}</span>
                    ) : (
                      <span>Click to attach logos, artwork or reference images (AI, EPS, PDF, SVG, PNG, JPEG, PSD, ZIP — up to 100MB each)</span>
                    )}
                  </label>
                  <input
                    id="fileUpload"
                    type="file"
                    multiple
                    className="sr-only"
                    disabled={uploading}
                    onChange={(e) => {
                      handleFileSelect(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <FieldError>{uploadError ?? undefined}</FieldError>
                </div>
                <div className="mt-5">
                  <FieldLabel htmlFor="fileNotes" optional>Notes about your files</FieldLabel>
                  <TextArea
                    id="fileNotes"
                    placeholder="e.g. Logo needs to be recreated as vector art"
                    value={data.fileNotes}
                    onChange={(e) => update("fileNotes", e.target.value)}
                  />
                </div>
              </div>
            )}

            {step === 4 && (
              <div>
                <h2 className="font-display text-xl font-semibold text-ink-900">Deadline and delivery</h2>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <div>
                    <FieldLabel htmlFor="neededBy">Needed by</FieldLabel>
                    <TextInput
                      id="neededBy"
                      type="date"
                      value={data.neededBy}
                      onChange={(e) => update("neededBy", e.target.value)}
                    />
                    <FieldError>{errors.neededBy}</FieldError>
                  </div>
                  <div>
                    <FieldLabel htmlFor="eventDate" optional>Event date</FieldLabel>
                    <TextInput
                      id="eventDate"
                      type="date"
                      value={data.eventDate}
                      onChange={(e) => update("eventDate", e.target.value)}
                    />
                  </div>
                </div>
                <div className="mt-6">
                  <FieldLabel htmlFor="deliveryMethod">Delivery method</FieldLabel>
                  <RadioCardGroup
                    name="deliveryMethod"
                    columns={2}
                    value={data.deliveryMethod}
                    onChange={(v) => update("deliveryMethod", v)}
                    options={[
                      { value: "pickup", label: "Ottawa pickup" },
                      { value: "shipping", label: "Shipping" },
                    ]}
                  />
                  <FieldError>{errors.deliveryMethod}</FieldError>
                </div>
                {data.deliveryMethod === "shipping" && (
                  <div className="mt-5 max-w-xs">
                    <FieldLabel htmlFor="postalCode">Shipping postal code</FieldLabel>
                    <TextInput
                      id="postalCode"
                      placeholder="e.g. K1P 1J1"
                      value={data.postalCode}
                      onChange={(e) => update("postalCode", e.target.value)}
                    />
                    <FieldError>{errors.postalCode}</FieldError>
                  </div>
                )}
              </div>
            )}

            {step === 5 && (
              <div>
                <h2 className="font-display text-xl font-semibold text-ink-900">Your contact details</h2>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <div>
                    <FieldLabel htmlFor="name">Full name</FieldLabel>
                    <TextInput id="name" value={data.name} onChange={(e) => update("name", e.target.value)} />
                    <FieldError>{errors.name}</FieldError>
                  </div>
                  <div>
                    <FieldLabel htmlFor="organization" optional>Business / organization</FieldLabel>
                    <TextInput
                      id="organization"
                      value={data.organization}
                      onChange={(e) => update("organization", e.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    <TextInput
                      id="email"
                      type="email"
                      value={data.email}
                      onChange={(e) => update("email", e.target.value)}
                    />
                    <FieldError>{errors.email}</FieldError>
                  </div>
                  <div>
                    <FieldLabel htmlFor="phone" optional>Phone</FieldLabel>
                    <TextInput id="phone" type="tel" value={data.phone} onChange={(e) => update("phone", e.target.value)} />
                  </div>
                </div>
                <div className="mt-6">
                  <FieldLabel htmlFor="preferredContact" optional>Preferred contact method</FieldLabel>
                  <RadioCardGroup
                    name="preferredContact"
                    columns={2}
                    value={data.preferredContact}
                    onChange={(v) => update("preferredContact", v)}
                    options={[
                      { value: "email", label: "Email" },
                      { value: "phone", label: "Phone" },
                    ]}
                  />
                </div>
              </div>
            )}

            {step === 6 && (
              <div>
                <h2 className="font-display text-xl font-semibold text-ink-900">Review your request</h2>
                <div className="mt-6 divide-y divide-sand">
                  <ReviewRow label="Project type" value={PROJECT_TYPE_OPTIONS.find((o) => o.value === data.projectType)?.label} onEdit={() => goTo(0)} />
                  <ReviewRow label="Product & quantity" value={[data.productDescription, data.quantity && `Qty: ${data.quantity}`].filter(Boolean).join(" · ")} onEdit={() => goTo(1)} />
                  <ReviewRow label="Customization" value={[data.decorationMethod, data.placements].filter(Boolean).join(" · ") || "Not specified"} onEdit={() => goTo(2)} />
                  <ReviewRow label="Files" value={data.fileNames.length ? data.fileNames.join(", ") : "None attached"} onEdit={() => goTo(3)} />
                  <ReviewRow label="Deadline & delivery" value={[data.neededBy && `By ${data.neededBy}`, data.deliveryMethod].filter(Boolean).join(" · ")} onEdit={() => goTo(4)} />
                  <ReviewRow label="Contact" value={[data.name, data.email].filter(Boolean).join(" · ")} onEdit={() => goTo(5)} />
                </div>
                <div className="mt-6">
                  <CheckboxField id="consent" checked={data.consent} onChange={(v) => update("consent", v)}>
                    I agree to be contacted by Maple Imprint about this request.
                  </CheckboxField>
                  <FieldError>{errors.consent}</FieldError>
                </div>
                {submitError && <FieldError>{submitError}</FieldError>}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-8 flex items-center justify-between border-t border-sand pt-6">
        <Button
          variant="secondary"
          tone="light"
          onClick={() => setStep((s) => Math.max(s - 1, 0))}
          className={step === 0 ? "invisible" : ""}
        >
          Back
        </Button>
        {step < STEP_LABELS.length - 1 ? (
          <Button onClick={goNext} showArrow>
            Continue
          </Button>
        ) : (
          <Button onClick={handleSubmit} showArrow>
            {submitting ? "Submitting…" : "Submit request"}
          </Button>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ label, value, onEdit }: { label: string; value?: string; onEdit: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
        <p className="mt-1 text-sm text-ink-900">{value || "Not provided"}</p>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="flex shrink-0 items-center gap-1 text-xs font-semibold text-crimson hover:text-ink-900"
      >
        <PencilSimple className="size-3.5" weight="bold" /> Edit
      </button>
    </div>
  );
}
