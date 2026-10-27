"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Check, SpinnerGap, WarningCircle, X } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { useCart, QUOTE_PREFILL_KEY, QUOTE_CART_LINES_KEY, type QuoteCartHandoff } from "@/components/cart/CartProvider";
import { ReviewPanel } from "@/components/studio/ReviewPanel";
import { PreviewMode } from "@/components/studio/PreviewMode";
import { PostCartConfirmation } from "@/components/studio/PostCartConfirmation";
import { CropModal, type CropFraction } from "@/components/studio/CropModal";
import { ToolRail } from "@/components/studio/shell/ToolRail";
import { SecondaryPanel } from "@/components/studio/shell/SecondaryPanel";
import { TopBar } from "@/components/studio/shell/TopBar";
import { LocationSelector } from "@/components/studio/shell/LocationSelector";
import { TextToolbar } from "@/components/studio/shell/TextToolbar";
import { ZoomControls } from "@/components/studio/shell/ZoomControls";
import { Inspector, type BgRemovalState } from "@/components/studio/shell/Inspector";
import { InspectorDock } from "@/components/studio/shell/InspectorDock";
import { UploadsPanel, type RecentUpload } from "@/components/studio/panels/UploadsPanel";
import { TextPanel, type TextPreset } from "@/components/studio/panels/TextPanel";
import { ShapesPanel } from "@/components/studio/panels/ShapesPanel";
import { GraphicsPanel } from "@/components/studio/panels/GraphicsPanel";
import { DesignsPanel } from "@/components/studio/panels/DesignsPanel";
import { MyStuffPanel } from "@/components/studio/panels/MyStuffPanel";
import { decorationProfileFor } from "@/lib/studio/productDecorationProfile";
import { FAMILIES_WITHOUT_3D, accessoryKindFor } from "@/lib/studio/preview3d";
import { drinkwareConfigFor } from "@/lib/studio/drinkwareCustomization";
import { backgroundUrlFor, printAreaPixelBox, printAreaOverrideFor, printAreasOverlap, PRINT_AREAS } from "@/lib/studio/printAreas";
import { viewGroupFor } from "@/lib/studio/garmentViews";
import { resolveTemplateAssets, scaleTemplateObjects, type DesignTemplate } from "@/lib/studio/templates";
import {
  generateQr,
  isLikelyUrl,
  normalizeDestination,
  platformPresetFor,
  qrObjectToWire,
  qrPresetFor,
  safestQrConfig,
  validateQrScans,
  wireObjectToAppObject,
  type QrGenerateInput,
  type QrStylePresetId,
} from "@/lib/studio/qr";
import { loadQrAssets, saveQrAssets, type QrAsset } from "@/lib/studio/qrAssets";
import { getOrCreateClientSessionToken } from "@/lib/studio/session";
import { QRPanel } from "@/components/studio/panels/QRPanel";
import type { DesignAsset } from "@/lib/studio/assetProviders";
import type { StudioToolId } from "@/lib/studio/tools";
import type { DesignObjectRecord, DesignProjectRecord, DesignSideType, ShapeKind } from "@/lib/studio/types";
import type { CanvasLayerSpec } from "@/components/studio/CanvasStage";

const CanvasStage = dynamic(() => import("@/components/studio/CanvasStage").then((m) => m.CanvasStage), {
  ssr: false,
  loading: () => (
    <div className="mx-auto flex aspect-[4/5] w-full max-w-[520px] items-center justify-center rounded-3xl bg-white">
      <SpinnerGap className="size-6 animate-spin text-muted" weight="bold" />
    </div>
  ),
});

// WebGL (three.js) needs real browser APIs — same ssr:false reasoning as CanvasStage above.
const Mug3DPreview = dynamic(() => import("@/components/studio/Mug3DPreview").then((m) => m.Mug3DPreview), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-3xl bg-canvas">
      <SpinnerGap className="size-6 animate-spin text-muted" weight="bold" />
    </div>
  ),
});

const Flat3DPreview = dynamic(() => import("@/components/studio/Flat3DPreview").then((m) => m.Flat3DPreview), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-3xl bg-canvas">
      <SpinnerGap className="size-6 animate-spin text-muted" weight="bold" />
    </div>
  ),
});

type SidesState = Partial<Record<DesignSideType, DesignObjectRecord[]>>;

const AUTOSAVE_DELAY_MS = 900;
// Draft-restoration hardening (Scenario D) — see saveNow's retry loop below.
const SAVE_RETRY_DELAYS_MS = [1000, 3000, 8000];


function emptyObject(type: "text" | "image" | "shape" | "qr", overrides: Partial<DesignObjectRecord>): DesignObjectRecord {
  return {
    id: crypto.randomUUID(),
    type,
    assetUrl: null,
    content: null,
    fontFamily: null,
    fontSize: null,
    fill: null,
    normalizedX: 0.25,
    normalizedY: 0.4,
    normalizedWidth: 0.5,
    normalizedHeight: 0.2,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    name: null,
    hidden: false,
    bold: false,
    italic: false,
    align: null,
    letterSpacing: null,
    lineHeight: null,
    curve: null,
    shapeKind: null,
    strokeColor: null,
    strokeWidth: null,
    flipX: false,
    flipY: false,
    cropX: null,
    cropY: null,
    cropWidth: null,
    cropHeight: null,
    qrDestination: null,
    qrErrorCorrection: null,
    qrForegroundColor: null,
    qrBackgroundColor: null,
    qrDotStyle: null,
    qrCornerStyle: null,
    qrLogoUrl: null,
    qrStylePreset: null,
    qrFrameStyle: null,
    qrLabelText: null,
    qrValidated: null,
    qrAssetId: null,
    ...overrides,
  };
}

/** Where a freshly-added asset lands (STUDIO V3 brief, Section 5: "do NOT place it arbitrarily or
 *  make it enormous"). Sizes it to `coverage` (60-75%) of whichever axis the box constrains first,
 *  preserving the asset's own aspect ratio against the print area's REAL pixel aspect ratio (not
 *  assuming the box is square), then centers it — the Canva-like "add object, it appears in a
 *  sensible position" feel instead of a fixed-fraction box that ignores both the asset's shape and
 *  the print area's. */
function autoFitNormalized(
  location: DesignSideType,
  naturalAspect: number,
  coverage = 0.68,
  override?: { widthIn: number; heightIn: number },
) {
  const box = printAreaPixelBox(location, override);
  const boxAspect = box.width / box.height;
  let wFrac: number;
  let hFrac: number;
  if (naturalAspect > boxAspect) {
    wFrac = coverage;
    hFrac = coverage * (boxAspect / naturalAspect);
  } else {
    hFrac = coverage;
    wFrac = coverage * (naturalAspect / boxAspect);
  }
  return {
    normalizedWidth: wFrac,
    normalizedHeight: hFrac,
    normalizedX: (1 - wFrac) / 2,
    normalizedY: (1 - hFrac) / 2,
  };
}

/** Section "LOCATION TRANSFER POSITIONING": moving/copying a QR between print areas must not
 *  preserve raw x/y (different boxes have different real dimensions) but SHOULD "preserve QR's
 *  relative size where sensible" rather than always resetting to one fixed fraction. Both boxes
 *  live in the same shared 520x650 design-space canvas (printAreaPixelBox), so the object's current
 *  real pixel size is directly comparable across locations — this converts that pixel size into the
 *  destination box's own normalized fraction, clamped so it can never overflow past 90% of the
 *  destination's constraining axis and never shrink below 30% of it (a QR that reads as "reasonably
 *  sized" moving from a 12x16 front to a 4x4 chest box, not a barely-visible speck). Always centers,
 *  and — since width/height are derived from the SAME clamped pixel size divided by each axis of
 *  the destination box — always comes out exactly square in real terms, never distorted.
 */
function refitQrForLocation(
  obj: DesignObjectRecord,
  fromSide: DesignSideType,
  toSide: DesignSideType,
  fromOverride?: { widthIn: number; heightIn: number },
  toOverride?: { widthIn: number; heightIn: number },
) {
  const fromBox = printAreaPixelBox(fromSide, fromOverride);
  const toBox = printAreaPixelBox(toSide, toOverride);
  const currentPixelSize = Math.max(obj.normalizedWidth * fromBox.width, obj.normalizedHeight * fromBox.height);
  const minToAxis = Math.min(toBox.width, toBox.height);
  const sizePx = Math.min(Math.max(currentPixelSize, minToAxis * 0.3), minToAxis * 0.9);
  const normalizedWidth = sizePx / toBox.width;
  const normalizedHeight = sizePx / toBox.height;
  return { normalizedWidth, normalizedHeight, normalizedX: (1 - normalizedWidth) / 2, normalizedY: (1 - normalizedHeight) / 2 };
}

export function StudioClient({ projectId }: { projectId: string }) {
  const { addItem } = useCart();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [project, setProject] = useState<DesignProjectRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sides, setSides] = useState<SidesState>({});
  const [activeSide, setActiveSide] = useState<DesignSideType>("front");
  // 2D is the only editable surface — 3D is read-only preview, same object data rendered as a
  // rotatable model instead of the flat canvas. Keyed to a ref of the side it was opened for isn't
  // needed: switching location goes through setActiveSide, which this file's own handleSelectLocation
  // already routes through, so resetting there (not here) keeps this a single source of truth.
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [recentUploads, setRecentUploads] = useState<RecentUpload[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview" | "review" | "post-cart">("edit");
  // "adding" while the freeze call is in flight, "success" once it lands (the button itself shows
  // "✓ Added to Cart" for a beat before `mode` advances to "post-cart" — see handleApproveAndAddToCart),
  // "error" if it failed (never silently treated as success). Initialized from the loaded project's
  // own status, not just local interaction — reopening an already-ordered design (fresh load, or
  // browser Back after approving) must never present a fresh, clickable Approve button that would
  // add a second cart line for the same design (Section 18/34).
  const [approveState, setApproveState] = useState<"idle" | "adding" | "success" | "error">("idle");
  const [activeTool, setActiveTool] = useState<StudioToolId | null>(null);
  // Per-location, not a single shared value — Section 22 wants Inner Neck to auto-fit rather than
  // inherit whatever zoom level Front happened to be at, and Front to come back the way the
  // customer left it rather than staying zoomed in on a collar schematic's scale. Keying by
  // location and defaulting to 1 (fit) gives both for free: a location's first visit is always a
  // fresh fit, and revisiting it restores whatever the customer last set.
  const [zoomByLocation, setZoomByLocation] = useState<Partial<Record<DesignSideType, number>>>({});
  const [addingLocation, setAddingLocation] = useState<DesignSideType | null>(null);
  const [cropTargetId, setCropTargetId] = useState<string | null>(null);
  const [bgRemoval, setBgRemoval] = useState<BgRemovalState>({ forObjectId: null, status: "idle" });
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [backNavigating, setBackNavigating] = useState(false);
  const [qrCreating, setQrCreating] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  // Object ids currently mid-regeneration (style/destination/logo just changed and a fresh
  // render+scan check is in flight) — Inspector shows a small pending state per id rather than one
  // global spinner, since "fix all" (below) can have several regenerating at once.
  const [qrRegeneratingIds, setQrRegeneratingIds] = useState<string[]>([]);
  // Object ids that failed the pre-Review scan check (Section "QR REVIEW VALIDATION") — non-null
  // means the gate modal is showing instead of switching to Review.
  const [qrReviewGate, setQrReviewGate] = useState<string[] | null>(null);
  const [fixingAllQr, setFixingAllQr] = useState(false);
  // QR ASSET library (Section "CORE UX DECISION") — every reusable generated QR for this browser
  // session, independent of which/how many print areas currently place it. Hydrated synchronously
  // from localStorage via useState's lazy initializer (not an effect + setState — react-hooks/
  // set-state-in-effect flags a synchronous setState in an effect body as a cascading-render risk;
  // a lazy initializer runs once, during the first render, with no such risk). `sessionTokenRef`/
  // `qrAssetsHydrated` are refs, not state — writing to them here during render is the accepted
  // "cache a render-time computation" pattern, since ref writes don't themselves trigger a re-render.
  const sessionTokenRef = useRef<string | null>(null);
  const qrAssetsHydrated = useRef(false);
  const [qrAssets, setQrAssets] = useState<QrAsset[]>(() => {
    if (typeof window === "undefined") return [];
    const token = getOrCreateClientSessionToken();
    sessionTokenRef.current = token;
    qrAssetsHydrated.current = true;
    return loadQrAssets(token);
  });
  // Non-null while the "this QR is used in N places" confirmation is showing (Section "QR ASSET
  // EDITING") — only a DESTINATION change on a shared asset triggers this; style/colour/logo edits
  // always apply per-placement only (see requestQrPatch's own comment for why).
  const [qrSharedEditPrompt, setQrSharedEditPrompt] = useState<{
    objectId: string;
    assetId: string;
    siblingIds: string[];
    pendingChanges: Partial<QrGenerateInput>;
  } | null>(null);
  const [qrSharedEditBusy, setQrSharedEditBusy] = useState(false);

  const [history, setHistory] = useState<{ past: SidesState[]; future: SidesState[] }>({ past: [], future: [] });
  // Text toolbar's "Copy style" / "Paste style" — deliberately NOT part of undo history (copying a
  // style is a read, not a design mutation) and deliberately NOT persisted with the project (a
  // clipboard that outlives the tab would be surprising) — plain component state is the right home.
  const [copiedStyle, setCopiedStyle] = useState<Partial<DesignObjectRecord> | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirtySinceLoad = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const qrLogoInputRef = useRef<HTMLInputElement | null>(null);
  const [qrLogoTargetId, setQrLogoTargetId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/studio/${projectId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Design not found.");
        return res.json() as Promise<DesignProjectRecord>;
      })
      .then((data) => {
        if (cancelled) return;
        setProject(data);
        const nextSides: SidesState = {};
        // Every object loaded from the API is written on the wire as "image"/"text"/"shape" only
        // (see qr.ts) — this is the one place a QR object still secretly stored as an image gets
        // turned back into its rich, first-class `type: "qr"` in-app shape.
        for (const side of data.sides) nextSides[side.sideType] = side.objects.map(wireObjectToAppObject);
        setSides(nextSides);
        setActiveSide(data.sides[0]?.sideType ?? "front");
        const hasAnyObject = data.sides.some((s) => s.objects.length > 0);
        // Section 1: no full-screen "choose one of four options" gate. A brand-new design opens
        // straight into the Designs panel (template-first, Canva-style first impression) with a
        // small dismissible hint instead of a modal blocking the product; a design that already has
        // objects (returning customer) opens straight into plain editing.
        setShowOnboarding(!hasAnyObject);
        if (!hasAnyObject) setActiveTool("designs");
        if (data.status === "ordered") setApproveState("success");
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Section "MY STUFF PERSISTENCE": QR assets survive tool switches, Review, and page refresh —
  // persist on every change after the lazy-init hydration above has run. See qrAssets.ts's header
  // for why localStorage is the right home for this (small structured data, no accounts to hang a
  // server-side table off yet).
  useEffect(() => {
    if (!qrAssetsHydrated.current || !sessionTokenRef.current) return;
    saveQrAssets(sessionTokenRef.current, qrAssets);
  }, [qrAssets]);

  const pushHistory = useCallback((before: SidesState) => {
    setHistory((h) => ({ past: [...h.past.slice(-49), JSON.parse(JSON.stringify(before))], future: [] }));
  }, []);

  const applySides = useCallback((next: SidesState) => {
    setSides(next);
    dirtySinceLoad.current = true;
  }, []);

  function undo() {
    if (history.past.length === 0) return;
    const prev = history.past[history.past.length - 1];
    setHistory((h) => ({ past: h.past.slice(0, -1), future: [...h.future, JSON.parse(JSON.stringify(sides))] }));
    setSides(prev);
    dirtySinceLoad.current = true;
  }

  function redo() {
    if (history.future.length === 0) return;
    const next = history.future[history.future.length - 1];
    setHistory((h) => ({ past: [...h.past, JSON.parse(JSON.stringify(sides))], future: h.future.slice(0, -1) }));
    setSides(next);
    dirtySinceLoad.current = true;
  }

  // Extracted so "Back to Product" can flush a pending save immediately instead of either losing
  // it (a plain navigation would abandon the debounce timer) or forcing the customer through a
  // "you have unsaved changes" confirmation modal for something Studio can just finish on its own.
  // A bare network blip previously set saveStatus to "error" and gave up — the design change the
  // customer just made was never persisted, and nothing stopped them from closing the tab none
  // the wiser. Retries with backoff before surfacing an error at all; a 409 (design already
  // frozen) is never retried since no amount of retrying fixes that.
  const saveNow = useCallback(
    async (sidesToSave: SidesState) => {
      const payload = {
        sides: (Object.entries(sidesToSave) as [DesignSideType, DesignObjectRecord[]][]).map(([sideType, objects]) => ({
          sideType,
          objects: objects.map((o) => {
            const { id: _id, ...rest } = qrObjectToWire(o);
            return rest;
          }),
        })),
      };
      for (let attempt = 0; attempt <= SAVE_RETRY_DELAYS_MS.length; attempt++) {
        try {
          const res = await fetch(`/api/studio/${projectId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            setSaveStatus("saved");
            return;
          }
          if (res.status === 409) {
            // Finalized design — retrying can't help, and shouldn't silently keep trying to save
            // over something the customer already approved.
            setSaveStatus("error");
            return;
          }
        } catch {
          // Network failure — fall through to retry below.
        }
        if (attempt < SAVE_RETRY_DELAYS_MS.length) {
          await new Promise((resolve) => setTimeout(resolve, SAVE_RETRY_DELAYS_MS[attempt]));
        }
      }
      setSaveStatus("error");
    },
    [projectId],
  );

  // Warn before the tab closes with real unsaved risk — "saving" covers the retry window above
  // (a request may still be in flight or about to retry), "error" covers exhausted retries. Not
  // registered for "idle"/"saved", so this never nags on a genuinely clean exit.
  useEffect(() => {
    if (saveStatus !== "saving" && saveStatus !== "error") return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveStatus]);

  useEffect(() => {
    if (!project || !dirtySinceLoad.current) return;
    setSaveStatus("saving");
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = undefined;
      saveNow(sides);
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [sides, project, projectId, saveNow]);

  /** Resolves once any pending autosave has actually landed — a save already in flight or already
   *  "saved" resolves immediately; a still-debounced one is fired right now instead of waiting out
   *  the rest of its delay. Nothing to confirm with the customer either way: the design was never
   *  actually at risk, so "Back to Product" never needs a blocking "unsaved changes" dialog. */
  const flushPendingSave = useCallback(async () => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = undefined;
      await saveNow(sides);
    }
  }, [sides, saveNow]);

  async function handleBackToProduct(productHref: string) {
    setBackNavigating(true);
    await flushPendingSave();
    router.push(productHref);
  }

  // Keyboard precision (Section 17): Delete/Backspace, Cmd/Ctrl+D duplicate, Cmd/Ctrl+Z undo,
  // Cmd/Ctrl+Shift+Z or Ctrl+Y redo, arrow keys nudge (Shift = 10x). Every shortcut backs off the
  // instant the inline text editor is open or focus is anywhere inside an input/textarea/
  // contenteditable — a customer typing "Delete" as part of their own copy must never delete the
  // object they're editing.
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (mode !== "edit" || editingTextId || isTypingTarget(e.target)) return;
      const meta = e.metaKey || e.ctrlKey;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (meta && e.key.toLowerCase() === "d" && selectedId) {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (meta && selectedObject?.type === "text" && ["b", "i", "u"].includes(e.key.toLowerCase())) {
        e.preventDefault();
        const key = e.key.toLowerCase();
        if (key === "b") commitObjectPatch(selectedObject.id, { bold: !selectedObject.bold });
        if (key === "i") commitObjectPatch(selectedObject.id, { italic: !selectedObject.italic });
        if (key === "u") commitObjectPatch(selectedObject.id, { underline: !selectedObject.underline });
        return;
      }
      if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (meta && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }
      if (selectedId && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const step = e.shiftKey ? 0.02 : 0.002;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const obj = activeObjects.find((o) => o.id === selectedId);
        if (obj) commitObjectPatch(selectedId, { normalizedX: obj.normalizedX + dx, normalizedY: obj.normalizedY + dy });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editingTextId, selectedId, sides, activeSide, history]);

  // Mobile has no permanent right-hand panel (there's no room) — selecting something is the
  // customer's clearest signal they want its properties, so the details sheet opens itself rather
  // than requiring an extra tap to discover it. (Desktop ignores this entirely — InspectorDock's
  // `mobileOpen` prop only affects its `lg:hidden` mobile rendering.) Adjusted during render, not
  // in an effect, per the "derived state from a changed value" pattern already used in
  // PageTransition.tsx — avoids the extra render pass a useEffect-based setState would cause.
  if (selectedId !== lastSelectedId) {
    setLastSelectedId(selectedId);
    if (selectedId) setMobileInspectorOpen(true);
  }

  const activeObjects = sides[activeSide] ?? [];
  const selectedObject = activeObjects.find((o) => o.id === selectedId) ?? null;
  const openSides = project?.sides.map((s) => s.sideType) ?? [];
  const hasBackPhoto = Boolean(project?.mockupImages.back);
  const decorationProfile = project ? decorationProfileFor(project.categorySlug, project.subcategorySlug, hasBackPhoto) : null;
  const profile = decorationProfile?.locations ?? [];
  const activeLocation = profile.find((l) => l.id === activeSide) ?? null;
  const zoom = zoomByLocation[activeSide] ?? 1;
  const setZoom = (next: number) => setZoomByLocation((prev) => ({ ...prev, [activeSide]: next }));

  const family = decorationProfile?.family ?? null;
  const can3D = Boolean(family && !FAMILIES_WITHOUT_3D.includes(family) && activeLocation);
  // Drinkware vessel + quote routing (one resolver shared with the product pages). vesselKind picks
  // the per-vessel 2D illustration and 3D silhouette; requiresQuote routes a finished design through
  // Request a Quote rather than instant checkout (no automated drinkware print price — see plan).
  const drinkwareConfig = project
    ? drinkwareConfigFor({
        slug: project.productSlug,
        name: project.productName,
        categorySlug: project.categorySlug,
        subcategorySlug: project.subcategorySlug,
      })
    : null;
  const vesselKind = drinkwareConfig?.vesselKind;
  const requiresQuote = drinkwareConfig?.requiresQuote ?? false;
  // Banner's real dimensions vary per order (no fixed PRINT_AREAS entry to trust) — reuse the same
  // override lookup the 2D canvas already threads through for it, same reasoning as printAreaPixelBox.
  // "accessory" family (gifts-promo/packaging) reuses the generic "front"/"back" DesignSideType IDs
  // that PRINT_AREAS otherwise defines for APPAREL (a 12x16in chest print) — there's no real per-
  // product physical size tracked anywhere for a coaster vs. a tote bag vs. a packaging box (see
  // productDecorationProfile's own "too physically varied for one dedicated print area" comment),
  // so pulling PRINT_AREAS[activeSide] here would silently render every accessory-family item as a
  // tall apparel-chest-shaped slab. A neutral near-square fallback is the honest "we don't know
  // this item's real proportions" stand-in instead.
  const flatPrintAreaIn = project
    ? (printAreaOverrideFor(project.sides, activeSide) ?? (family === "accessory" ? { widthIn: 4, heightIn: 4 } : PRINT_AREAS[activeSide]))
    : PRINT_AREAS[activeSide];

  // GarmentView vs PrintArea (STUDIO V3 brief, Section 8): every OPEN location that shares the
  // active location's view (front/left-chest/right-chest all sit on the same front photo, etc.)
  // gets composited into the same canvas so switching to Left Chest never makes Front's artwork
  // disappear — only the active one is actually editable. Production data stays fully separate:
  // this is rendering-only, `sides` itself is never merged (Section 17).
  const compositeLocations = viewGroupFor(activeSide, profile).filter((loc) => openSides.includes(loc));
  const compositeLayers: CanvasLayerSpec[] = compositeLocations.map((loc) => ({
    location: loc,
    objects: sides[loc] ?? [],
    active: loc === activeSide,
    printAreaOverrideIn: printAreaOverrideFor(project?.sides ?? [], loc),
  }));
  // Gentle, non-blocking collision hint (Section 8's "overlapping locations") — only surfaced when
  // two open, ARTWORKED locations in the same view actually occupy overlapping print-area boxes;
  // never auto-blocks anything.
  const overlappingWith = compositeLocations.find(
    (loc) => loc !== activeSide && (sides[loc]?.length ?? 0) > 0 && (activeObjects.length ?? 0) > 0 && printAreasOverlap(activeSide, loc),
  );

  function addText(preset: TextPreset) {
    pushHistory(sides);
    const width = 0.55;
    const height = 0.12;
    const obj = emptyObject("text", {
      content: preset.label === "Body text" ? "Your text" : preset.label,
      fontFamily: "Manrope, sans-serif",
      fontSize: preset.fontSize,
      fill: "#171412",
      bold: preset.bold,
      align: "center",
      normalizedWidth: width,
      normalizedHeight: height,
      // Centered within the current print area, never x=0/y=0 (Section 21) — a fresh text object
      // should read as "placed for you," not "dropped in the corner."
      normalizedX: (1 - width) / 2,
      normalizedY: (1 - height) / 2,
    });
    applySides({ ...sides, [activeSide]: [...activeObjects, obj] });
    setSelectedId(obj.id);
    setEditingTextId(obj.id);
    setShowOnboarding(false);
    setActiveTool(null);
  }

  function addShape(kind: ShapeKind) {
    pushHistory(sides);
    // Sensible per-kind defaults (Section 22 of the earlier brief, "auto-fit to a sensible
    // fraction, center, select") — a line/arrow reads as a thin horizontal stroke, a banner/
    // speech-bubble as a wide badge, everything else as a moderate square-ish mark.
    const [width, height] =
      kind === "line" || kind === "arrow"
        ? [0.5, 0.01]
        : kind === "banner"
          ? [0.5, 0.18]
          : kind === "speech-bubble"
            ? [0.4, 0.32]
            : [0.3, 0.3];
    const obj = emptyObject("shape", {
      shapeKind: kind,
      fill: "#D41414",
      normalizedWidth: width,
      normalizedHeight: height,
      normalizedX: (1 - width) / 2,
      normalizedY: (1 - height) / 2,
    });
    applySides({ ...sides, [activeSide]: [...activeObjects, obj] });
    setSelectedId(obj.id);
    setShowOnboarding(false);
    setActiveTool(null);
  }

  function addGraphic(asset: DesignAsset) {
    pushHistory(sides);
    const obj = emptyObject("image", {
      assetUrl: asset.productionSource,
      name: asset.title,
      normalizedWidth: 0.35,
      normalizedHeight: 0.35,
      normalizedX: 0.325,
      normalizedY: 0.15,
    });
    applySides({ ...sides, [activeSide]: [...activeObjects, obj] });
    setSelectedId(obj.id);
    setShowOnboarding(false);
    setActiveTool(null);
  }

  async function applyTemplate(template: DesignTemplate) {
    pushHistory(sides);
    // QA pass (Section "TEMPLATE GROUP SCALING"): every template is authored against the "front"
    // print area's own box size — scale absolute-unit fields (fontSize/letterSpacing/strokeWidth;
    // position/size fields are already box-relative fractions and need no change) by how much
    // smaller/larger the ACTUAL active box is, so a badge template applied to Left Chest or a
    // sleeve renders proportionally, not at full "front" scale inside a much smaller box. See
    // scaleTemplateObjects's own doc comment for why this is the correct place to do it once,
    // rather than re-tuning every template's numbers per print area.
    const referenceBox = printAreaPixelBox("front");
    const activeBox = printAreaPixelBox(activeSide, printAreaOverrideFor(project?.sides ?? [], activeSide));
    const scale = Math.min(activeBox.width / referenceBox.width, activeBox.height / referenceBox.height);
    const scaledSeeds = scaleTemplateObjects(template.objects, scale);
    const resolved = await resolveTemplateAssets(scaledSeeds);
    const newObjects = resolved.map((seed) => ({ ...seed, id: crypto.randomUUID() }));
    applySides({ ...sides, [activeSide]: [...activeObjects, ...newObjects] });
    setSelectedId(null);
    setShowOnboarding(false);
    setActiveTool(null);
  }

  async function handleUploadFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/studio/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");

      const img = new Image();
      img.src = data.url;
      await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      });
      const naturalAspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
      const fit = autoFitNormalized(activeSide, naturalAspect, 0.68, printAreaOverrideFor(project?.sides ?? [], activeSide));

      pushHistory(sides);
      const obj = emptyObject("image", {
        assetUrl: data.url,
        normalizedWidth: fit.normalizedWidth,
        normalizedHeight: fit.normalizedHeight,
        normalizedX: fit.normalizedX,
        normalizedY: fit.normalizedY,
      });
      applySides({ ...sides, [activeSide]: [...activeObjects, obj] });
      setSelectedId(obj.id);
      setShowOnboarding(false);
      setRecentUploads((prev) => [{ url: data.url, name: file.name }, ...prev].slice(0, 12));
      setActiveTool(null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function useRecentUpload(url: string) {
    pushHistory(sides);
    const obj = emptyObject("image", { assetUrl: url, normalizedX: 0.25, normalizedY: 0.3 });
    applySides({ ...sides, [activeSide]: [...activeObjects, obj] });
    setSelectedId(obj.id);
    setShowOnboarding(false);
    setActiveTool(null);
  }

  function commitObjectPatch(id: string, patch: Partial<DesignObjectRecord>, side: DesignSideType = activeSide) {
    pushHistory(sides);
    applySides({
      ...sides,
      [side]: (sides[side] ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o)),
    });
  }

  function findQrObject(id: string): { obj: DesignObjectRecord; side: DesignSideType } | null {
    for (const side of openSides) {
      const obj = (sides[side] ?? []).find((o) => o.id === id && o.type === "qr");
      if (obj) return { obj, side };
    }
    return null;
  }

  /** Section "NEW LEFT TOOL — QR CODE" / "AFTER CREATING A QR": create a QR from a validated
   *  destination, using the chosen platform's recommended style preset (everything is still
   *  adjustable afterward in the Inspector). Generates locally (qr-code-styling), checks it
   *  actually scans (jsQR), THEN — new in this pass — saves it as a reusable QrAsset (so it shows
   *  up in Recent QR Codes / My Stuff going forward) before placing the first instance on the
   *  active print area and selecting it. */
  async function addQrCode(destinationRaw: string, platformId: string) {
    const destination = normalizeDestination(destinationRaw);
    if (!isLikelyUrl(destination)) return;
    setQrCreating(true);
    setQrError(null);
    try {
      const platform = platformPresetFor(platformId);
      const preset = qrPresetFor(platform.stylePreset);
      const input: QrGenerateInput = {
        destination,
        errorCorrection: "M",
        foregroundColor: preset.foregroundColor,
        backgroundColor: preset.backgroundColor,
        dotStyle: preset.dotStyle,
        cornerStyle: preset.cornerStyle,
        logoUrl: null,
        frameStyle: "none",
        labelText: null,
      };
      const { displayDataUrl, bareDataUrl } = await generateQr(input);
      const validation = await validateQrScans(bareDataUrl, destination);

      const now = new Date().toISOString();
      const asset: QrAsset = {
        id: crypto.randomUUID(),
        sessionId: sessionTokenRef.current ?? "",
        destination,
        platform: platform.id,
        displayName: `${platform.label} QR`,
        stylePreset: preset.id,
        foregroundColor: input.foregroundColor,
        backgroundColor: input.backgroundColor,
        dotStyle: input.dotStyle,
        cornerStyle: input.cornerStyle,
        logoUrl: null,
        frameStyle: "none",
        labelText: null,
        errorCorrection: input.errorCorrection,
        quietZone: 16,
        displayDataUrl,
        bareDataUrl,
        scanValidated: validation.scans,
        validatedAt: now,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      setQrAssets((prev) => [asset, ...prev]);

      pushHistory(sides);
      // Square (naturalAspect 1) sized against the real box aspect ratio — Section "QR ASPECT
      // RATIO" ("resize maintains 1:1") starts true from the moment it's placed, not just once
      // the customer first resizes it.
      const fit = autoFitNormalized(activeSide, 1, 0.55, printAreaOverrideFor(project?.sides ?? [], activeSide));
      const obj = emptyObject("qr", {
        name: asset.displayName,
        assetUrl: displayDataUrl,
        normalizedWidth: fit.normalizedWidth,
        normalizedHeight: fit.normalizedHeight,
        normalizedX: fit.normalizedX,
        normalizedY: fit.normalizedY,
        qrDestination: destination,
        qrErrorCorrection: input.errorCorrection,
        qrForegroundColor: input.foregroundColor,
        qrBackgroundColor: input.backgroundColor,
        qrDotStyle: input.dotStyle,
        qrCornerStyle: input.cornerStyle,
        qrLogoUrl: null,
        qrStylePreset: preset.id,
        qrFrameStyle: "none",
        qrLabelText: null,
        qrValidated: validation.scans,
        qrAssetId: asset.id,
      });
      applySides({ ...sides, [activeSide]: [...activeObjects, obj] });
      setSelectedId(obj.id);
      setShowOnboarding(false);
      // Section "QR PANEL should show active asset" — leave the QR tool panel open (rather than
      // closing it like every other add-* action) so the customer immediately sees "Current QR" +
      // Recent QR Codes with their new code already at the top, instead of having to reopen the
      // tool to discover it saved.
    } catch (err) {
      setQrError(err instanceof Error ? err.message : "We couldn't create this QR code.");
    } finally {
      setQrCreating(false);
    }
  }

  /** Section "QR PANEL — RECENT QR CODES" / "MY STUFF — QR CODES": places another instance of an
   *  EXISTING asset onto the current print area without regenerating or re-validating it — "Do not
   *  regenerate/pay/revalidate from scratch unless underlying data changed." Used by both "Recent
   *  QR Codes" cards and My Stuff's "Add to Design". */
  function placeQrAsset(asset: QrAsset) {
    pushHistory(sides);
    const fit = autoFitNormalized(activeSide, 1, 0.55, printAreaOverrideFor(project?.sides ?? [], activeSide));
    const obj = emptyObject("qr", {
      name: asset.displayName,
      assetUrl: asset.displayDataUrl,
      normalizedWidth: fit.normalizedWidth,
      normalizedHeight: fit.normalizedHeight,
      normalizedX: fit.normalizedX,
      normalizedY: fit.normalizedY,
      qrDestination: asset.destination,
      qrErrorCorrection: asset.errorCorrection,
      qrForegroundColor: asset.foregroundColor,
      qrBackgroundColor: asset.backgroundColor,
      qrDotStyle: asset.dotStyle,
      qrCornerStyle: asset.cornerStyle,
      qrLogoUrl: asset.logoUrl,
      qrStylePreset: asset.stylePreset,
      qrFrameStyle: asset.frameStyle,
      qrLabelText: asset.labelText,
      qrValidated: asset.scanValidated,
      qrAssetId: asset.id,
    });
    applySides({ ...sides, [activeSide]: [...activeObjects, obj] });
    setSelectedId(obj.id);
    setShowOnboarding(false);
    return obj.id;
  }

  function useRecentQrAsset(assetId: string) {
    const asset = qrAssets.find((a) => a.id === assetId);
    if (asset) placeQrAsset(asset);
  }

  /** My Stuff's "Edit QR": if this asset already has a placement somewhere in the open design,
   *  jump straight to it (switching view if needed) rather than creating a duplicate — otherwise
   *  place a fresh instance on the current side, exactly like "Add to Design". Either way the
   *  customer lands with the QR selected and the Inspector already open on it (Section 11). */
  function editQrAsset(assetId: string) {
    for (const side of openSides) {
      const existing = (sides[side] ?? []).find((o) => o.type === "qr" && o.qrAssetId === assetId);
      if (existing) {
        setActiveSide(side);
        setSelectedId(existing.id);
        setActiveTool(null);
        return;
      }
    }
    const asset = qrAssets.find((a) => a.id === assetId);
    if (asset) {
      placeQrAsset(asset);
      setActiveTool(null);
    }
  }

  /** My Stuff's "Duplicate" — a genuinely independent copy (new asset id), so Front can point at
   *  one Instagram account and Back at another without either edit touching the shared original
   *  (Section "CREATE COPY"). Does not place it anywhere; the customer adds it from My Stuff like
   *  any other asset once duplicated. */
  function duplicateQrAsset(assetId: string) {
    const asset = qrAssets.find((a) => a.id === assetId);
    if (!asset) return;
    const now = new Date().toISOString();
    const copy: QrAsset = { ...asset, id: crypto.randomUUID(), displayName: `${asset.displayName} copy`, createdAt: now, updatedAt: now };
    setQrAssets((prev) => [copy, ...prev]);
  }

  /** My Stuff's "Delete" — archives instead of hard-deleting when the CURRENTLY LOADED design still
   *  places this asset somewhere (Section "MY STUFF — QR CODES": "must not silently break that
   *  design"); existing placements keep rendering regardless either way since their own qr* fields
   *  are fully denormalized (types.ts), this only controls whether the asset is offered again from
   *  Recent/My Stuff. Cross-project usage genuinely can't be checked — there's no server-side
   *  QrAsset table to query other DesignProjects against (see qrAssets.ts's header) — so the safety
   *  check is honestly scoped to this open design only. */
  function deleteQrAsset(assetId: string) {
    const stillUsed = openSides.some((side) => (sides[side] ?? []).some((o) => o.type === "qr" && o.qrAssetId === assetId));
    setQrAssets((prev) => (stillUsed ? prev.map((a) => (a.id === assetId ? { ...a, archived: true, updatedAt: new Date().toISOString() } : a)) : prev.filter((a) => a.id !== assetId)));
  }

  function renameQrAsset(assetId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setQrAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, displayName: trimmed, updatedAt: new Date().toISOString() } : a)));
  }

  /** Regenerates a QR object's rendered image + re-validates against its own destination whenever
   *  any style/colour/logo/frame/label field changes (Section "QR LIVE EDITING") — `assetUrl` is
   *  always a fresh render derived from the individually-stored qr* fields, never edited directly,
   *  so those fields stay the real source of truth (Section "QR OBJECT MODEL": "store the DATA and
   *  STYLE," not just a flattened PNG). Returns whether the new render scans correctly. */
  async function patchQrObject(
    id: string,
    changes: Partial<QrGenerateInput> & { stylePreset?: QrStylePresetId | null; assetId?: string | null },
  ): Promise<boolean> {
    const found = findQrObject(id);
    if (!found) return false;
    const { obj, side } = found;
    const input: QrGenerateInput = {
      destination: changes.destination ?? obj.qrDestination ?? "",
      errorCorrection: changes.errorCorrection ?? obj.qrErrorCorrection ?? "M",
      foregroundColor: changes.foregroundColor ?? obj.qrForegroundColor ?? "#171412",
      backgroundColor: changes.backgroundColor ?? obj.qrBackgroundColor ?? "#FFFFFF",
      dotStyle: changes.dotStyle ?? obj.qrDotStyle ?? "square",
      cornerStyle: changes.cornerStyle ?? obj.qrCornerStyle ?? "square",
      logoUrl: changes.logoUrl !== undefined ? changes.logoUrl : obj.qrLogoUrl,
      frameStyle: changes.frameStyle ?? obj.qrFrameStyle ?? "none",
      labelText: changes.labelText !== undefined ? changes.labelText : obj.qrLabelText,
    };
    const nextAssetId = changes.assetId !== undefined ? changes.assetId : obj.qrAssetId;
    setQrRegeneratingIds((prev) => [...prev, id]);
    try {
      const { displayDataUrl, bareDataUrl } = await generateQr(input);
      const validation = await validateQrScans(bareDataUrl, input.destination);
      const nextStylePreset = changes.stylePreset !== undefined ? changes.stylePreset : obj.qrStylePreset;
      commitObjectPatch(
        id,
        {
          assetUrl: displayDataUrl,
          qrDestination: input.destination,
          qrErrorCorrection: input.errorCorrection,
          qrForegroundColor: input.foregroundColor,
          qrBackgroundColor: input.backgroundColor,
          qrDotStyle: input.dotStyle,
          qrCornerStyle: input.cornerStyle,
          qrLogoUrl: input.logoUrl,
          qrStylePreset: nextStylePreset,
          qrFrameStyle: input.frameStyle,
          qrLabelText: input.labelText,
          qrValidated: validation.scans,
          qrAssetId: nextAssetId,
        },
        side,
      );
      // Keep the QrAsset library's own copy of destination/style in sync with the LATEST edited
      // placement, so a fresh "Recent"/"My Stuff" reuse reflects what the customer actually settled
      // on rather than whatever the code looked like at creation time (Section "QR ASSET EDITING":
      // "Destination + base QR style belong to QrAsset").
      if (nextAssetId) {
        setQrAssets((prev) =>
          prev.map((a) =>
            a.id === nextAssetId
              ? {
                  ...a,
                  destination: input.destination,
                  foregroundColor: input.foregroundColor,
                  backgroundColor: input.backgroundColor,
                  dotStyle: input.dotStyle,
                  cornerStyle: input.cornerStyle,
                  logoUrl: input.logoUrl,
                  stylePreset: nextStylePreset,
                  frameStyle: input.frameStyle,
                  labelText: input.labelText,
                  displayDataUrl,
                  bareDataUrl,
                  scanValidated: validation.scans,
                  validatedAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }
              : a,
          ),
        );
      }
      return validation.scans;
    } catch {
      commitObjectPatch(id, { qrValidated: false }, side);
      return false;
    } finally {
      setQrRegeneratingIds((prev) => prev.filter((x) => x !== id));
    }
  }

  /** Section "SAME-VIEW DRAGGING"/"MOVE VS DUPLICATE": every placement-level QR change coming from
   *  the Inspector routes through here rather than straight to patchQrObject, so a DESTINATION edit
   *  on a QR shared by more than one placement can pause for "update all, or create a copy" first
   *  (Section "QR ASSET EDITING"/"CREATE COPY"). Style/colour/logo/frame/label edits are
   *  deliberately NOT gated — they apply to this placement only, immediately, exactly like today;
   *  gating every colour-picker drag behind a confirmation modal would make styling unusable, and
   *  the brief's own worked example for the shared-edit prompt is specifically about destination
   *  ("instagram.com/account1" vs "account2"), not visual style. */
  function requestQrPatch(id: string, changes: Partial<QrGenerateInput> & { stylePreset?: QrStylePresetId | null }) {
    if (changes.destination === undefined) {
      void patchQrObject(id, changes);
      return;
    }
    const found = findQrObject(id);
    if (!found) return;
    const siblingIds = found.obj.qrAssetId
      ? openSides.flatMap((s) => (sides[s] ?? []).filter((o) => o.type === "qr" && o.qrAssetId === found.obj.qrAssetId && o.id !== id).map((o) => o.id))
      : [];
    if (siblingIds.length === 0) {
      void patchQrObject(id, changes);
      return;
    }
    setQrSharedEditPrompt({ objectId: id, assetId: found.obj.qrAssetId!, siblingIds, pendingChanges: changes });
  }

  /** "UPDATE ALL": the new destination applies to this placement AND every sibling sharing the same
   *  QrAsset (Section 26). */
  async function resolveQrSharedEditUpdateAll() {
    if (!qrSharedEditPrompt) return;
    setQrSharedEditBusy(true);
    const { objectId, siblingIds, pendingChanges } = qrSharedEditPrompt;
    await Promise.all([objectId, ...siblingIds].map((id) => patchQrObject(id, pendingChanges)));
    setQrSharedEditBusy(false);
    setQrSharedEditPrompt(null);
  }

  /** "CREATE A COPY": this placement detaches onto a brand-new QrAsset (Section 27) and gets the
   *  new destination; every sibling placement keeps pointing at the original, untouched. */
  async function resolveQrSharedEditCreateCopy() {
    if (!qrSharedEditPrompt) return;
    setQrSharedEditBusy(true);
    const { objectId, assetId, pendingChanges } = qrSharedEditPrompt;
    const original = qrAssets.find((a) => a.id === assetId);
    const now = new Date().toISOString();
    const newAssetId = crypto.randomUUID();
    if (original) {
      setQrAssets((prev) => [{ ...original, id: newAssetId, displayName: `${original.displayName} copy`, createdAt: now, updatedAt: now }, ...prev]);
    }
    await patchQrObject(objectId, { ...pendingChanges, assetId: newAssetId });
    setQrSharedEditBusy(false);
    setQrSharedEditPrompt(null);
  }

  async function uploadQrLogo(id: string, file: File) {
    setQrRegeneratingIds((prev) => [...prev, id]);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/studio/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      await patchQrObject(id, { logoUrl: data.url });
    } catch (err) {
      setQrError(err instanceof Error ? err.message : "We couldn't add that logo.");
    } finally {
      setQrRegeneratingIds((prev) => prev.filter((x) => x !== id));
    }
  }

  function triggerQrLogoUpload(id: string) {
    setQrLogoTargetId(id);
    qrLogoInputRef.current?.click();
  }

  function applyQrPreset(id: string, presetId: QrStylePresetId) {
    const preset = qrPresetFor(presetId);
    void patchQrObject(id, {
      dotStyle: preset.dotStyle,
      cornerStyle: preset.cornerStyle,
      foregroundColor: preset.foregroundColor,
      backgroundColor: preset.backgroundColor,
      stylePreset: presetId,
    });
  }

  /** "Fix QR" (Section "QR QUALITY STATES") — reverts to the one maximally-safe configuration
   *  rather than asking the customer to reason about contrast/error-correction tradeoffs. */
  async function fixQr(id: string): Promise<boolean> {
    const found = findQrObject(id);
    if (!found) return false;
    const { obj } = found;
    const safe = safestQrConfig({
      destination: obj.qrDestination ?? "",
      errorCorrection: obj.qrErrorCorrection ?? "M",
      foregroundColor: obj.qrForegroundColor ?? "#171412",
      backgroundColor: obj.qrBackgroundColor ?? "#FFFFFF",
      dotStyle: obj.qrDotStyle ?? "square",
      cornerStyle: obj.qrCornerStyle ?? "square",
      logoUrl: obj.qrLogoUrl,
      frameStyle: obj.qrFrameStyle ?? "none",
      labelText: obj.qrLabelText,
    });
    return patchQrObject(id, { ...safe, stylePreset: null });
  }

  /** Section "QR MUST BE MOVABLE TO OTHER PRINT LOCATIONS" — MOVE removes the placement from its
   *  current print area and creates it on the destination instead; the QR data/style never changes
   *  (moving never re-triggers generation or scan validation — only WHERE it sits changes), only its
   *  size/position are refit to the new box (refitQrForLocation) and Studio switches straight to
   *  that view with the moved object already selected (Section 10). Silently no-ops if the
   *  destination location can't be opened (ensureLocationOpen's network call failed). */
  async function moveQrToLocation(objId: string, toSide: DesignSideType) {
    const found = findQrObject(objId);
    if (!found || found.side === toSide) return;
    const ok = await ensureLocationOpen(toSide);
    if (!ok) return;
    const { obj, side: fromSide } = found;
    const fit = refitQrForLocation(
      obj,
      fromSide,
      toSide,
      printAreaOverrideFor(project?.sides ?? [], fromSide),
      printAreaOverrideFor(project?.sides ?? [], toSide),
    );
    pushHistory(sides);
    applySides({
      ...sides,
      [fromSide]: (sides[fromSide] ?? []).filter((o) => o.id !== objId),
      [toSide]: [...(sides[toSide] ?? []), { ...obj, ...fit }],
    });
    setActiveSide(toSide);
    setSelectedId(objId);
  }

  /** COPY — Section "MOVE VS DUPLICATE": the original placement stays exactly where it is; a brand
   *  NEW placement (fresh id, same qrAssetId) is added to the destination. Both instances render
   *  from the same already-validated bare code, so no regeneration/re-validation is needed here
   *  either. */
  async function copyQrToLocation(objId: string, toSide: DesignSideType) {
    const found = findQrObject(objId);
    if (!found) return;
    const ok = await ensureLocationOpen(toSide);
    if (!ok) return;
    const { obj, side: fromSide } = found;
    const fit = refitQrForLocation(
      obj,
      fromSide,
      toSide,
      printAreaOverrideFor(project?.sides ?? [], fromSide),
      printAreaOverrideFor(project?.sides ?? [], toSide),
    );
    pushHistory(sides);
    const copy: DesignObjectRecord = { ...obj, ...fit, id: crypto.randomUUID() };
    applySides({ ...sides, [toSide]: [...(sides[toSide] ?? []), copy] });
    setActiveSide(toSide);
    setSelectedId(copy.id);
  }

  // Section "QR REVIEW VALIDATION": "Before Review/approval... if one cannot be decoded, show a
  // clear warning. Do NOT silently print an unreadable QR." Gates the Review transition itself
  // (TopBar's Review button) rather than only the final Approve click, so the customer sees the
  // problem at the same moment they're asking "is this ready" rather than one step later.
  function handleReviewClick() {
    const failing = openSides
      .flatMap((s) => sides[s] ?? [])
      .filter((o) => o.type === "qr" && o.qrValidated !== true)
      .map((o) => o.id);
    if (failing.length > 0) {
      setQrReviewGate(failing);
      return;
    }
    setMode("review");
  }

  async function fixAllQrAndProceed() {
    if (!qrReviewGate) return;
    setFixingAllQr(true);
    // Use fixQr's own return value, not a re-read of `sides` afterward — `sides` here is a stale
    // closure captured when this handler started, and React doesn't refresh it mid-async-function
    // just because commitObjectPatch ran a state update in the meantime. Reading it after the
    // await reliably reported the PRE-fix validation state, so the gate never actually cleared
    // even after a successful fix (found live: Inspector showed "scans correctly" underneath a
    // modal that stayed open regardless).
    const ids = qrReviewGate;
    const results = await Promise.all(ids.map((id) => fixQr(id)));
    setFixingAllQr(false);
    const stillFailingIds = ids.filter((_, i) => !results[i]);
    setQrReviewGate(stillFailingIds.length > 0 ? stillFailingIds : null);
    if (stillFailingIds.length === 0) setMode("review");
  }

  // Curved-text/mirroring brief: "live visual update while dragging, then commit a history state
  // when interaction ends" — a slider's onChange fires on every tick of a drag, and
  // commitObjectPatch pushes one history entry per call, so wiring a slider straight to it would
  // spam dozens of undo steps per gesture. This coalesces an entire drag into exactly one history
  // entry: the first live-patch of a gesture pushes history (capturing the pre-drag state, exactly
  // like commitObjectPatch always has), every subsequent one during the same gesture just updates
  // `sides` directly; liveEditEndRef flags the next call to start a new gesture again. Genuinely
  // discrete interactions (clicks, drag-end, blur) keep using commitObjectPatch unchanged.
  const liveEditActiveRef = useRef(false);
  function livePatchObject(id: string, patch: Partial<DesignObjectRecord>, side: DesignSideType = activeSide) {
    if (!liveEditActiveRef.current) {
      pushHistory(sides);
      liveEditActiveRef.current = true;
    }
    applySides({
      ...sides,
      [side]: (sides[side] ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o)),
    });
  }
  function endLivePatch() {
    liveEditActiveRef.current = false;
  }

  async function handleRemoveBackground(objectId: string, imageUrl: string) {
    setBgRemoval({ forObjectId: objectId, status: "processing" });
    try {
      const res = await fetch("/api/studio/remove-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "We couldn't remove this background automatically.");
      setBgRemoval({ forObjectId: objectId, status: "ready", resultUrl: data.url });
    } catch (err) {
      setBgRemoval({
        forObjectId: objectId,
        status: "error",
        error: err instanceof Error ? err.message : "We couldn't remove this background automatically.",
      });
    }
  }

  function acceptRemovedBackground(objectId: string) {
    if (bgRemoval.status !== "ready" || !bgRemoval.resultUrl) return;
    commitObjectPatch(objectId, { assetUrl: bgRemoval.resultUrl });
    setBgRemoval({ forObjectId: null, status: "idle" });
  }

  function dismissBackgroundRemoval() {
    setBgRemoval({ forObjectId: null, status: "idle" });
  }

  function commitTextEdit(id: string, content: string) {
    setEditingTextId(null);
    pushHistory(sides);
    applySides({
      ...sides,
      [activeSide]: activeObjects.map((o) => (o.id === id ? { ...o, content } : o)),
    });
  }

  function deleteSelected() {
    if (!selectedId) return;
    pushHistory(sides);
    applySides({ ...sides, [activeSide]: activeObjects.filter((o) => o.id !== selectedId) });
    setSelectedId(null);
  }

  function duplicateSelected() {
    if (!selectedObject) return;
    pushHistory(sides);
    const copy: DesignObjectRecord = {
      ...selectedObject,
      id: crypto.randomUUID(),
      normalizedX: Math.min(0.9, selectedObject.normalizedX + 0.04),
      normalizedY: Math.min(0.9, selectedObject.normalizedY + 0.04),
    };
    applySides({ ...sides, [activeSide]: [...activeObjects, copy] });
    setSelectedId(copy.id);
  }

  function moveLayer(id: string, direction: "up" | "down") {
    const index = activeObjects.findIndex((o) => o.id === id);
    if (index === -1) return;
    const swapWith = direction === "up" ? index + 1 : index - 1;
    if (swapWith < 0 || swapWith >= activeObjects.length) return;
    pushHistory(sides);
    const next = [...activeObjects];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    applySides({ ...sides, [activeSide]: next });
  }

  // Text toolbar's "To front" / "To back" — moveLayer only swaps one adjacent step at a time
  // (matches the Layers panel's up/down arrows); this splices straight to either end of the
  // z-order array in one history entry instead of requiring N calls to moveLayer.
  // Text toolbar's "Copy style" / "Paste style" (format painter) — deliberately excludes `content`
  // (never copy the actual wording) and position/size/rotation fields (those describe placement,
  // not typography). Reused verbatim as the Partial<DesignObjectRecord> patch onPasteStyle commits.
  const STYLE_FIELDS = [
    "fontFamily",
    "fontSize",
    "fill",
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "textTransform",
    "align",
    "letterSpacing",
    "lineHeight",
    "opacity",
    "curve",
    "effectType",
    "shadowColor",
    "shadowOpacity",
    "shadowBlur",
    "shadowOffsetX",
    "shadowOffsetY",
    "bgColor",
    "bgPadding",
    "bgCornerRadius",
    "strokeColor",
    "strokeWidth",
  ] as const satisfies readonly (keyof DesignObjectRecord)[];

  function copyStyle() {
    if (!selectedObject) return;
    const style: Partial<DesignObjectRecord> = {};
    for (const key of STYLE_FIELDS) (style as Record<string, unknown>)[key] = selectedObject[key];
    setCopiedStyle(style);
  }

  function pasteStyle() {
    if (!selectedObject || !copiedStyle) return;
    commitObjectPatch(selectedObject.id, copiedStyle);
  }

  function moveLayerToEdge(id: string, edge: "front" | "back") {
    const index = activeObjects.findIndex((o) => o.id === id);
    if (index === -1) return;
    pushHistory(sides);
    const next = [...activeObjects];
    const [obj] = next.splice(index, 1);
    if (edge === "front") next.push(obj);
    else next.unshift(obj);
    applySides({ ...sides, [activeSide]: next });
  }

  function toggleLayerHidden(id: string) {
    commitObjectPatch(id, { hidden: !activeObjects.find((o) => o.id === id)?.hidden });
  }

  // Section "QR OBJECT LAYER NAME": "Customer may rename" — a small, generic rename affordance on
  // every layer (not just QR objects; there's no reason to special-case it), since LayersPanel
  // already falls back to `obj.name` whenever it's set (defaultLabel in LayersPanel.tsx).
  function renameLayer(id: string, name: string) {
    commitObjectPatch(id, { name: name.trim() || null });
  }

  function duplicateLayer(id: string) {
    const obj = activeObjects.find((o) => o.id === id);
    if (!obj) return;
    pushHistory(sides);
    const copy = { ...obj, id: crypto.randomUUID(), normalizedX: Math.min(0.9, obj.normalizedX + 0.04), normalizedY: Math.min(0.9, obj.normalizedY + 0.04) };
    applySides({ ...sides, [activeSide]: [...activeObjects, copy] });
    setSelectedId(copy.id);
  }

  function deleteLayer(id: string) {
    pushHistory(sides);
    applySides({ ...sides, [activeSide]: activeObjects.filter((o) => o.id !== id) });
    if (selectedId === id) setSelectedId(null);
  }

  // Every location the product's family supports is already visible in the strip (Section 1 — no
  // "More" dropdown to hide the create-on-demand step behind), so selecting one that doesn't have
  // a real DesignSide row yet needs to transparently create it first — the customer never sees a
  // separate "add this location" action, just a brief pending spinner on that pill. Extracted from
  // the original handleSelectLocation so "Move To"/"Copy To" (QR PLACEMENT brief) can silently open
  // a not-yet-visited destination location the same way, without duplicating this network call.
  async function ensureLocationOpen(side: DesignSideType): Promise<boolean> {
    if (!project) return false;
    if (openSides.includes(side)) return true;
    setAddingLocation(side);
    try {
      const res = await fetch(`/api/studio/${projectId}/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sideType: side }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setProject((p) => (p ? { ...p, sides: [...p.sides, { id: `pending-${side}`, sideType: side, printAreaWidth: 0, printAreaHeight: 0, objects: [] }] } : p));
      setSides((s) => ({ ...s, [side]: s[side] ?? [] }));
      return true;
    } catch {
      return false;
    } finally {
      setAddingLocation(null);
    }
  }

  async function handleSelectLocation(side: DesignSideType) {
    if (openSides.includes(side)) {
      setActiveSide(side);
      setSelectedId(null);
      setViewMode("2d");
      return;
    }
    const ok = await ensureLocationOpen(side);
    if (ok) {
      setActiveSide(side);
      setSelectedId(null);
      setViewMode("2d");
    }
    // Silent no-op on failure — the location simply doesn't switch; the customer can just click it
    // again.
  }

  const locationsWithArt = openSides.filter((s) => (sides[s]?.length ?? 0) > 0).length;

  const priceBreakdown = (() => {
    const snapshot = project?.pricingSnapshot;
    if (!snapshot) return null;
    const locations = Math.max(1, locationsWithArt);
    const perUnitPrinting = snapshot.chartFirstLocationCost + snapshot.chartAdditionalLocationCost * (locations - 1);
    const blankSubtotal = snapshot.unitBasePrice * snapshot.quantity;
    const printingSubtotal = perUnitPrinting * snapshot.quantity;
    const total = blankSubtotal + snapshot.designFee + printingSubtotal;
    return {
      blankSubtotal: Math.round(blankSubtotal * 100) / 100,
      designFee: snapshot.designFee,
      printingSubtotal: Math.round(printingSubtotal * 100) / 100,
      total: Math.round(total * 100) / 100,
      quantity: snapshot.quantity,
      locations,
    };
  })();

  const hasAnyDesign = openSides.some((s) => (sides[s]?.length ?? 0) > 0);

  // Freezing (POST .../freeze) is awaited and happens BEFORE the local cart mutation,
  // deliberately — a failed freeze must never leave a cart line pointing at a project the server
  // still considers a draft. Unlike the plain status PATCH this replaces, freezing actually locks
  // the design server-side: PATCH /api/studio/[id] now rejects further autosaves once frozen (409),
  // so — unlike before — this comment's "ordered/frozen" claim is actually enforced, not just
  // stated. `approveState` guards against a double-click or a stray extra call re-running this
  // mid-flight or after it already succeeded (Section 18); reopening an already-"ordered" project
  // starts in "success" already (see the load effect above), so browser Back after approving can't
  // reach a fresh, clickable button either.
  async function handleApproveAndAddToCart() {
    if (!project || !priceBreakdown) return;
    if (approveState === "adding" || approveState === "success") return;
    setApproveState("adding");
    try {
      const res = await fetch(`/api/studio/${projectId}/freeze`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't save your approval.");

      if (requiresQuote) {
        // Drinkware has no automated print price — the frozen design routes to Request a Quote,
        // carrying its designProjectId so /api/quote captures the snapshot + asset/production/
        // preview files (the Phase 1/2 pipeline), rather than into the pay-checkout cart. The
        // design is already saved and frozen server-side; this is just the handoff.
        const line: QuoteCartHandoff = {
          cartItemId: `studio-${project.id}`,
          name: project.productName,
          quantity: project.totalQuantity,
          categorySlug: project.categorySlug,
          categoryName: project.categorySlug,
          subcategorySlug: project.subcategorySlug,
          productSlug: project.productSlug,
          colourName: project.colourName,
          sizeBreakdown: project.sizeBreakdown,
          customizationType: "CUSTOM",
          designProjectId: project.id,
          designFrozenRevision: data?.frozenRevision,
        };
        window.sessionStorage.setItem(
          QUOTE_PREFILL_KEY,
          `${project.productName} — custom printed, ${project.totalQuantity} units`,
        );
        window.sessionStorage.setItem(QUOTE_CART_LINES_KEY, JSON.stringify([line]));
        setApproveState("success");
        router.push("/contact?type=quote");
        return;
      }

      addItem(
        {
          id: `studio-${project.id}`,
          name: project.productName,
          image: project.mockupImages.front ?? project.mockupImages.back ?? "",
          categorySlug: project.categorySlug,
          categoryName: project.categorySlug,
          colourName: project.colourName,
          sizeBreakdown: project.sizeBreakdown,
          startingPrice: priceBreakdown.total / project.totalQuantity,
          customizationType: "CUSTOM",
          designProjectId: project.id,
          designRevision: project.revision,
          designFrozenRevision: data?.frozenRevision,
        },
        project.totalQuantity,
      );
      setApproveState("success");
      // A short beat showing the button's own "✓ Added to Cart" state (Section 2's "success
      // moment") before advancing to the full post-cart header+tray view — long enough to
      // register, short enough not to feel like a delay.
      window.setTimeout(() => setMode("post-cart"), 400);
    } catch {
      setApproveState("error");
    }
  }

  const productHref = project ? `/products/${project.categorySlug}/${project.subcategorySlug}/${project.productSlug}` : "/shop";

  let content: React.ReactNode;

  if (loadError) {
    content = (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
        <WarningCircle className="size-10 text-crimson" weight="light" />
        <p className="font-display text-lg font-semibold text-ink-900">We couldn&apos;t open this design</p>
        <p className="max-w-sm text-sm text-muted">{loadError}</p>
      </div>
    );
  } else if (!project) {
    content = (
      <div className="flex h-full items-center justify-center bg-canvas">
        <SpinnerGap className="size-8 animate-spin text-muted" weight="bold" />
      </div>
    );
  } else if (mode === "post-cart") {
    content = <PostCartConfirmation project={project} onClose={() => setMode("review")} />;
  } else if (mode === "review") {
    content = (
      <ReviewPanel
        project={project}
        sides={sides}
        profile={profile}
        priceBreakdown={priceBreakdown}
        onBack={() => setMode("edit")}
        onApprove={handleApproveAndAddToCart}
        approveState={approveState}
        vesselKind={vesselKind}
        requiresQuote={requiresQuote}
      />
    );
  } else if (mode === "preview") {
    content = (
      <PreviewMode
        openSides={openSides}
        sides={sides}
        activeSide={activeSide}
        onSelectSide={setActiveSide}
        mockupImages={project.mockupImages}
        colourName={project.colourName}
        profile={profile}
        onBack={() => setMode("edit")}
        printAreaOverrides={project.sides}
        categorySlug={project.categorySlug}
        subcategorySlug={project.subcategorySlug}
        productSlug={project.productSlug}
        vesselKind={vesselKind}
      />
    );
  } else {
    const mockupUrl = activeLocation
      ? backgroundUrlFor(activeLocation.viewType, project.mockupImages, project.colourName, activeLocation.usesPlacementPreview, vesselKind)
      : null;
    const cropTarget = cropTargetId ? activeObjects.find((o) => o.id === cropTargetId) ?? null : null;

    content = (
      // h-full + overflow-hidden: this shell fills exactly the (studio) route layout's `h-dvh`
      // box and never grows past it — the document itself has nothing left to scroll. Every
      // scrollable surface below (SecondaryPanel, InspectorDock) manages its OWN overflow
      // internally instead.
      <div className="flex h-full flex-col overflow-hidden bg-canvas">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUploadFile(file);
            e.target.value = "";
          }}
        />
        <input
          ref={qrLogoInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && qrLogoTargetId) uploadQrLogo(qrLogoTargetId, file);
            e.target.value = "";
          }}
        />

        <div className="shrink-0">
          <TopBar
            onBack={() => handleBackToProduct(productHref)}
            backPending={backNavigating}
            productName={project.productName}
            colourName={project.colourName}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            onUndo={undo}
            onRedo={redo}
            saveStatus={saveStatus}
            priceTotal={priceBreakdown?.total ?? null}
            canPreview={hasAnyDesign}
            onPreview={() => setMode("preview")}
            onReview={handleReviewClick}
          />
        </div>

        {/* min-h-0 is what lets this row actually shrink to "remaining space after the toolbar"
            instead of growing to fit its tallest child (the classic nested-flex trap) — every
            descendant below that needs to scroll internally, rather than pushing this row taller,
            repeats the same min-h-0 rule down the tree. */}
        <div className="flex min-h-0 flex-1">
          <ToolRail activeTool={activeTool} onSelectTool={(t) => setActiveTool((cur) => (cur === t ? null : t))} />
          {activeTool && (
            <SecondaryPanel
              title={{ designs: "Designs", uploads: "Uploads", text: "Text", graphics: "Graphics", shapes: "Shapes", qr: "QR Code", "my-stuff": "My Stuff" }[activeTool]}
              onClose={() => setActiveTool(null)}
            >
              {activeTool === "designs" && <DesignsPanel family={decorationProfileFor(project.categorySlug, project.subcategorySlug, hasBackPhoto).family} onApplyTemplate={applyTemplate} />}
              {activeTool === "uploads" && (
                <UploadsPanel
                  onTriggerUpload={() => fileInputRef.current?.click()}
                  uploading={uploading}
                  uploadError={uploadError}
                  recent={recentUploads}
                  onUseRecent={useRecentUpload}
                />
              )}
              {activeTool === "text" && <TextPanel onAddText={addText} />}
              {activeTool === "graphics" && <GraphicsPanel onAddGraphic={addGraphic} />}
              {activeTool === "shapes" && <ShapesPanel onAddShape={addShape} />}
              {activeTool === "qr" && (
                <QRPanel
                  onCreate={addQrCode}
                  creating={qrCreating}
                  recentAssets={qrAssets.filter((a) => !a.archived)}
                  onUseRecent={useRecentQrAsset}
                  currentQr={selectedObject?.type === "qr" ? selectedObject : null}
                  onEditCurrentDestination={() => setActiveTool(null)}
                />
              )}
              {activeTool === "my-stuff" && (
                <MyStuffPanel
                  recent={recentUploads}
                  onUseRecent={useRecentUpload}
                  qrAssets={qrAssets.filter((a) => !a.archived)}
                  onAddQrToDesign={useRecentQrAsset}
                  onEditQr={editQrAsset}
                  onDuplicateQr={duplicateQrAsset}
                  onDeleteQr={deleteQrAsset}
                  onRenameQr={renameQrAsset}
                />
              )}
            </SecondaryPanel>
          )}

          {/* Canvas — min-h-0/min-w-0/overflow-hidden so the workspace never expands past its
              share of the shell; zoom controls float over it (absolute) instead of sitting in
              flow, so they can never add to this column's height. */}
          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col items-center gap-4 overflow-hidden p-6 pb-20 lg:pb-6">
            <div className="shrink-0 space-y-2">
              <LocationSelector
                profile={profile}
                activeSide={activeSide}
                sidesWithArt={new Set(openSides.filter((s) => (sides[s]?.length ?? 0) > 0))}
                onSelect={handleSelectLocation}
                pendingLocation={addingLocation}
              />
              {/* The strip itself only carries a quiet dot for REVIEW_REQUIRED (Section 4) — the
                  actual explanation shows here, only for whichever location is currently active,
                  so it never clutters the selector for the other eight locations. */}
              {activeLocation?.status === "REVIEW_REQUIRED" && (
                <p className="px-1 text-xs text-orange">
                  Special placement — our team will confirm this location before production.
                </p>
              )}
              {overlappingWith && (
                <p className="px-1 text-xs text-orange">
                  These two print placements overlap. Adjust one design to prevent printing conflicts.
                </p>
              )}
            </div>

            {/* Contextual text toolbar — fast access to the formatting customers reach for most;
                the Inspector panel still carries every control in full detail underneath this. */}
            {selectedObject?.type === "text" && (
              <div className="w-full max-w-full shrink-0">
                <TextToolbar
                  obj={selectedObject}
                  onPatch={(patch) => commitObjectPatch(selectedObject.id, patch)}
                  onLivePatch={(patch) => livePatchObject(selectedObject.id, patch)}
                  onLivePatchEnd={endLivePatch}
                  onDuplicate={duplicateSelected}
                  onDelete={deleteSelected}
                  onMoveLayer={(direction) => moveLayer(selectedObject.id, direction)}
                  onMoveLayerToEdge={(edge) => moveLayerToEdge(selectedObject.id, edge)}
                  onCopyStyle={copyStyle}
                  onPasteStyle={pasteStyle}
                  hasCopiedStyle={copiedStyle !== null}
                />
              </div>
            )}

            {/* No items-center/justify-center here on purpose — CanvasStage's own root div needs
                to actually stretch to fill this box's real width AND height (default flex
                align-items: stretch) so its ResizeObserver has real dimensions to fit against;
                it centers the rendered stage inside itself once it knows how much space it has. */}
            <div className="relative flex min-h-0 min-w-0 w-full flex-1">
              {(uploadError || qrError) && (
                <div className="absolute left-1/2 top-0 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-crimson/10 px-4 py-2 text-xs font-medium text-crimson">
                  <WarningCircle className="size-4" weight="bold" />
                  {uploadError || qrError}
                </div>
              )}
              {viewMode === "3d" && can3D ? (
                // 3D is read-only preview, not a second editing surface — same object data as the
                // 2D canvas, rendered as a rotatable model instead. family === "mug" gets the
                // vessel-aware preview (mug/tumbler/bottle/glass all have their own real shape);
                // every other 3D-eligible family gets the generic flat-piece box, sized to this
                // location's own real print-area dimensions so a card and a banner don't share a
                // box shaped like neither of them.
                <div className="h-full w-full">
                  {family === "mug" ? (
                    <Mug3DPreview objects={activeObjects} kind={vesselKind ?? "mug"} />
                  ) : (
                    <Flat3DPreview
                      objects={activeObjects}
                      widthIn={flatPrintAreaIn.widthIn}
                      heightIn={flatPrintAreaIn.heightIn}
                      kind={project ? accessoryKindFor(project.productSlug) : "flat"}
                    />
                  )}
                </div>
              ) : (
                <CanvasStage
                  layers={compositeLayers}
                  mockupUrl={mockupUrl}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onCommitObject={(id, patch) => commitObjectPatch(id, patch)}
                  editingTextId={editingTextId}
                  onEditRequest={setEditingTextId}
                  onEditCommit={commitTextEdit}
                  onSwitchLocation={handleSelectLocation}
                  placementPreview={activeLocation?.usesPlacementPreview ?? false}
                  zoom={zoom}
                />
              )}

              {/* Section 1: subtle, dismissible hint — never covers the product, never blocks
                  interaction. The Designs panel is already open beside it (see the load effect
                  above), so this is just a one-line pointer rather than a gate the customer must
                  clear before touching anything. */}
              {showOnboarding && viewMode === "2d" && (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-4">
                  <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-ink-950/90 py-1.5 pl-3.5 pr-1.5 text-xs font-medium text-white shadow-lg">
                    <span>Pick a template to start, or upload/add your own.</span>
                    <button
                      type="button"
                      aria-label="Dismiss hint"
                      onClick={() => setShowOnboarding(false)}
                      className="rounded-full p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <X className="size-3.5" weight="bold" />
                    </button>
                  </div>
                </div>
              )}

              {/* Floating canvas toolbar — deliberately absolute/out-of-flow so it can never add
                  to the workspace's height (previously it sat in normal flow below the canvas and
                  was part of what forced the whole page to scroll). */}
              <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center gap-2">
                {viewMode === "2d" && (
                  <div className="pointer-events-auto">
                    <ZoomControls zoom={zoom} onZoomChange={setZoom} />
                  </div>
                )}
                {/* "So customers can see the design they picked on the actual product," not just
                    the flat canvas — available for every family except real-garment-photo ones
                    (tee/hoodie/joggers/headwear), where front/back already show a real photo, not
                    a flat schematic a 2D/3D toggle would add anything to. */}
                {can3D && (
                  <div className="pointer-events-auto flex items-center rounded-full border border-sand bg-white/95 p-1 text-xs font-semibold shadow-sm backdrop-blur">
                    <button
                      type="button"
                      onClick={() => setViewMode("2d")}
                      aria-pressed={viewMode === "2d"}
                      className={cn(
                        "rounded-full px-3.5 py-1.5 transition-colors",
                        viewMode === "2d" ? "bg-ink-950 text-white" : "text-ink-900 hover:bg-canvas",
                      )}
                    >
                      2D
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("3d")}
                      aria-pressed={viewMode === "3d"}
                      className={cn(
                        "rounded-full px-3.5 py-1.5 transition-colors",
                        viewMode === "3d" ? "bg-ink-950 text-white" : "text-ink-900 hover:bg-canvas",
                      )}
                    >
                      3D
                    </button>
                  </div>
                )}
              </div>

              {viewMode === "3d" && can3D && (
                <p className="pointer-events-none absolute inset-x-0 bottom-[4.25rem] text-center text-xs font-medium text-ink-900/50">
                  Drag to rotate · scroll to zoom
                </p>
              )}

              {/* Mobile has no permanent price/details panel — this pill is the entry point into
                  InspectorDock's bottom sheet when nothing is selected on canvas. */}
              {priceBreakdown && (
                <button
                  type="button"
                  onClick={() => setMobileInspectorOpen(true)}
                  className="absolute right-3 top-3 z-10 rounded-full bg-ink-950/90 px-3 py-1.5 text-xs font-semibold text-white shadow-lg lg:hidden"
                >
                  ${priceBreakdown.total.toFixed(2)} · Details
                </button>
              )}
            </div>
          </main>

          <InspectorDock mobileOpen={mobileInspectorOpen} onCloseMobile={() => setMobileInspectorOpen(false)}>
            <Inspector
              selectedObject={selectedObject}
              onPatch={(id, patch) => commitObjectPatch(id, patch)}
              onLivePatch={(id, patch) => livePatchObject(id, patch)}
              onLivePatchEnd={endLivePatch}
              onDuplicate={duplicateSelected}
              onDelete={deleteSelected}
              onOpenCrop={() => selectedObject && setCropTargetId(selectedObject.id)}
              bgRemoval={bgRemoval}
              onRemoveBackground={() => selectedObject?.assetUrl && handleRemoveBackground(selectedObject.id, selectedObject.assetUrl)}
              onAcceptRemovedBackground={() => selectedObject && acceptRemovedBackground(selectedObject.id)}
              onDismissBackgroundRemoval={dismissBackgroundRemoval}
              onQrPatch={(id, changes) => requestQrPatch(id, changes)}
              onQrApplyPreset={applyQrPreset}
              onQrFix={(id) => void fixQr(id)}
              onQrTriggerLogoUpload={triggerQrLogoUpload}
              onQrRemoveLogo={(id) => void patchQrObject(id, { logoUrl: null })}
              qrRegenerating={selectedObject ? qrRegeneratingIds.includes(selectedObject.id) : false}
              qrCurrentLocationLabel={activeLocation?.label ?? activeSide}
              qrLocationOptions={profile.filter((l) => l.status !== "UNAVAILABLE" && l.id !== activeSide).map((l) => ({ id: l.id, label: l.label }))}
              onQrMoveTo={(id, side) => void moveQrToLocation(id, side)}
              onQrCopyTo={(id, side) => void copyQrToLocation(id, side)}
              activeSide={activeSide}
              printAreaOverrideIn={printAreaOverrideFor(project.sides, activeSide)}
              layerObjects={activeObjects}
              selectedId={selectedId}
              onSelectLayer={setSelectedId}
              onMoveLayer={moveLayer}
              onToggleHiddenLayer={toggleLayerHidden}
              onDuplicateLayer={duplicateLayer}
              onDeleteLayer={deleteLayer}
              onRenameLayer={renameLayer}
              productName={project.productName}
              brandName={project.brandName}
              colourName={project.colourName}
              sizeBreakdown={project.sizeBreakdown}
              totalQuantity={project.totalQuantity}
              priceBreakdown={priceBreakdown}
            />
          </InspectorDock>
        </div>

        {approveState === "success" && (
          <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white shadow-xl">
            <Check className="size-4" weight="bold" />
            Added to cart
          </div>
        )}

        {cropTarget && cropTarget.assetUrl && (
          <CropModal
            imageUrl={cropTarget.assetUrl}
            initialCrop={
              cropTarget.cropWidth && cropTarget.cropHeight
                ? { x: cropTarget.cropX ?? 0, y: cropTarget.cropY ?? 0, width: cropTarget.cropWidth, height: cropTarget.cropHeight }
                : null
            }
            onCancel={() => setCropTargetId(null)}
            onConfirm={(crop: CropFraction | null) => {
              commitObjectPatch(cropTarget.id, {
                cropX: crop?.x ?? null,
                cropY: crop?.y ?? null,
                cropWidth: crop?.width ?? null,
                cropHeight: crop?.height ?? null,
              });
              setCropTargetId(null);
            }}
          />
        )}

        {qrReviewGate && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/50 p-6">
            <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-xl">
              <WarningCircle className="mx-auto size-8 text-orange" weight="bold" />
              <h2 className="mt-3 font-display text-lg font-semibold text-ink-900">
                {qrReviewGate.length === 1 ? "One QR code may not scan" : `${qrReviewGate.length} QR codes may not scan`}
              </h2>
              <p className="mt-1.5 text-sm text-muted">
                We couldn&apos;t confirm {qrReviewGate.length === 1 ? "it decodes" : "they decode"} correctly. Fix
                automatically for a guaranteed-readable style, or go back and adjust it yourself.
              </p>
              <div className="mt-5 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={fixAllQrAndProceed}
                  disabled={fixingAllQr}
                  className="rounded-full bg-maple-gradient px-4 py-2.5 text-sm font-semibold text-ink-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {fixingAllQr ? "Fixing…" : "Fix Automatically"}
                </button>
                <button
                  type="button"
                  onClick={() => setQrReviewGate(null)}
                  className="rounded-full border border-sand px-4 py-2.5 text-sm font-semibold text-ink-900 hover:bg-canvas"
                >
                  Back to Edit
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Section "QR ASSET EDITING": a destination change on a QR shared by more than one
            placement pauses here instead of silently propagating or silently diverging. */}
        {qrSharedEditPrompt && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/50 p-6">
            <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-xl">
              <WarningCircle className="mx-auto size-8 text-orange" weight="bold" />
              <h2 className="mt-3 font-display text-lg font-semibold text-ink-900">
                This QR is used in {qrSharedEditPrompt.siblingIds.length + 1} places
              </h2>
              <p className="mt-1.5 text-sm text-muted">Update the destination everywhere it&apos;s placed, or split this one off with its own link.</p>
              <div className="mt-5 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={resolveQrSharedEditUpdateAll}
                  disabled={qrSharedEditBusy}
                  className="rounded-full bg-maple-gradient px-4 py-2.5 text-sm font-semibold text-ink-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {qrSharedEditBusy ? "Updating…" : "Update All"}
                </button>
                <button
                  type="button"
                  onClick={resolveQrSharedEditCreateCopy}
                  disabled={qrSharedEditBusy}
                  className="rounded-full border border-sand px-4 py-2.5 text-sm font-semibold text-ink-900 hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Create a Copy Instead
                </button>
                <button
                  type="button"
                  onClick={() => setQrSharedEditPrompt(null)}
                  disabled={qrSharedEditBusy}
                  className="text-xs font-semibold text-ink-900/60 underline underline-offset-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    // The one-time "I was configuring my shirt, now I'm designing it" entrance (180-250ms fade +
    // subtle scale) — mounted once for StudioClient's whole lifetime, so switching between
    // edit/preview/review afterward (which swaps `content`, not this wrapper) never replays it.
    <motion.div
      className="h-full"
      initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      {content}
    </motion.div>
  );
}
