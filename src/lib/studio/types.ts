// Application-level design model — deliberately decoupled from whichever canvas engine renders it
// (react-konva today). Nothing outside src/components/studio/CanvasStage.tsx should ever import a
// Konva type; everything else in the app talks in these normalized, print-area-relative shapes so
// swapping the rendering engine later doesn't touch the storefront/order model.

// The full set of print locations across every product family Studio knows about (tees, hoodies,
// joggers, headwear). NOT every product offers every location — see productDecorationProfile.ts
// for which locations exist per product family and whether each is STANDARD (real photography,
// auto-orderable), REVIEW_REQUIRED (Maple confirms before production) or UNAVAILABLE (not shown).
// "Location," not strictly "side" — left-chest shares the front garment photo (a smaller print
// area within the same view), it isn't a distinct camera angle.
export type DesignSideType =
  | "front"
  | "back"
  | "left-chest"
  | "right-chest"
  | "left-sleeve"
  | "right-sleeve"
  | "upper-back"
  | "hood"
  | "pocket"
  | "inside-neck"
  | "outside-neck"
  | "left-leg"
  | "right-leg"
  | "left-side"
  | "right-side"
  // Flat print pieces (STUDIO V4 brief: business cards, flyers, posters, mug wraps) — no
  // photography involved at all, each renders on its own dedicated flat schematic (see
  // printAreas.ts's printPieceSchematicSvg) rather than a garment mockup.
  | "card-front"
  | "card-back"
  | "postcard-front"
  | "postcard-back"
  | "flyer-front"
  | "flyer-back"
  | "poster-front"
  | "mug-wrap"
  // Vinyl banners — the one face of a house-produced banner. Unlike every other flat print piece
  // above, its real-world size varies per order (28 offered sizes, 2.5'x4' up to 8'x30'), so its
  // PRINT_AREAS/PLACEMENT_GEOMETRY entries (printAreas.ts) are placeholders only — the real
  // dimensions live on this side's own DesignSide row and are threaded through explicitly wherever
  // geometry is computed (see printAreaPixelBox's override param).
  | "banner-face"
  // Stickers/labels (die-cut, kiss-cut, roll labels) — a real orderable house product
  // (src/lib/houseProducts/catalogue.ts) with no photography involved, same "flat print piece on
  // its own schematic" pattern as card-front/flyer-front/mug-wrap.
  | "sticker-face";

export type DesignObjectType = "image" | "text" | "shape" | "qr";
// Native, Maple-owned shape primitives (STUDIO V4 brief, "do not depend on external libraries for
// basic shapes") — every one is a real editable Konva object (fill/stroke/opacity/rotation/resize),
// not a bitmap. "rectangle"/"circle"/"line" are the original three; the rest were added in the same
// pass. See CanvasStage.tsx's ShapeNode for how each maps onto a Konva primitive or Path.
export type ShapeKind =
  | "rectangle"
  | "rounded-rectangle"
  | "circle"
  | "ellipse"
  | "triangle"
  | "line"
  | "arrow"
  | "star"
  | "polygon"
  | "speech-bubble"
  | "banner"
  | "heart"
  | "diamond";
export type TextAlign = "left" | "center" | "right";
export type DesignProjectStatus = "draft" | "reviewed" | "ordered";

export interface DesignObjectRecord {
  id: string;
  type: DesignObjectType;
  assetUrl: string | null;
  /** Links this image/qr-logo placement back to the Asset row (see src/lib/uploads/saveUpload.ts)
   *  that tracks the original upload independent of whatever assetUrl currently points at — same
   *  precedent as qrAssetId below. Null for objects placed before this field existed, or whose
   *  asset predates the Asset table; both keep working exactly like today since assetUrl is still
   *  fully authoritative for rendering, this is only for traceability back to the original file. */
  assetId?: string | null;
  content: string | null;
  fontFamily: string | null;
  fontSize: number | null;
  fill: string | null;
  /** All position/size fields are normalized 0-1 against the side's print area, not pixels —
   *  see PRINT_AREA in printAreas.ts. This is what makes the design portable across screen sizes
   *  and, eventually, a real production-file renderer. */
  normalizedX: number;
  normalizedY: number;
  normalizedWidth: number;
  normalizedHeight: number;
  rotation: number;
  opacity: number;
  /** Source of truth for z-order is each side's `objects` ARRAY INDEX (last = topmost, matching
   *  the Layers panel's top-of-list-is-front convention) — this field is kept only so a fresh
   *  read from the DB (which has no inherent order) can be sorted back into that order. Never
   *  read this to decide render order; always resort by it once on load, then trust array order. */
  zIndex: number;
  /** Custom layer name shown in the Layers panel; falls back to a generated label (e.g. "Text",
   *  "Logo.png") when null. */
  name: string | null;
  /** Hidden from canvas/preview/production but still part of the design (kept for re-enabling) —
   *  distinct from deleting. */
  hidden: boolean;
  // --- text-only fields (null for image/shape) ---
  bold: boolean;
  italic: boolean;
  align: TextAlign | null;
  /** Extra spacing between letters, in px at the object's own font size. */
  letterSpacing: number | null;
  /** Line-height multiplier (e.g. 1.2). Null = engine default. */
  lineHeight: number | null;
  /** 0 = straight text. Positive/negative bends the baseline into an arc; magnitude is the arc's
   *  strength, not a physical unit. Null/0 both mean "no curve." */
  curve: number | null;
  // --- text typography upgrade (all optional — every field below is undefined on any record
  // written before this pass, template seed, or old saved design; every read site treats
  // undefined exactly like its documented "off" default, so nothing needs a migration). ---
  /** Default false/undefined. Rendered via Konva's native textDecoration (combines with
   *  strikethrough — see CanvasStage). */
  underline?: boolean;
  strikethrough?: boolean;
  /** Display-only transform — never mutates `content`, so switching back to "none" always
   *  restores the customer's originally typed casing. Undefined/"none" = as typed. */
  textTransform?: "none" | "uppercase" | "lowercase" | "title";
  /** At most one "look" preset is active at a time (deliberately not an arbitrary stack — see the
   *  text-toolbar brief's "Effect stacking" section) — but the *outline* fields below are always
   *  independent of this, so Outline can combine with Shadow/Glow/etc. "hollow" renders fill as
   *  transparent (see CanvasStage) so only the outline shows, revealing the garment underneath.
   *  Undefined/"none" = no preset effect. */
  effectType?: "none" | "shadow" | "lift" | "glow" | "background" | "hollow";
  shadowColor?: string | null;
  /** 0-1, independent of the object's own overall `opacity`. */
  shadowOpacity?: number | null;
  shadowBlur?: number | null;
  shadowOffsetX?: number | null;
  shadowOffsetY?: number | null;
  /** Background box behind the text (effectType "background") — straight text only; see
   *  CanvasStage's known-limitations note on curved text. */
  bgColor?: string | null;
  bgPadding?: number | null;
  bgCornerRadius?: number | null;
  // --- shape-only fields (null for image/text) — strokeColor/strokeWidth are ALSO reused for the
  // text Outline effect (Konva.Text supports stroke/strokeWidth natively, same as shapes; adding
  // a second pair of fields with identical semantics just for text would be pure duplication). ---
  shapeKind: ShapeKind | null;
  strokeColor: string | null;
  strokeWidth: number | null;
  // --- image-only fields (false/null for text/shape) ---
  flipX: boolean;
  flipY: boolean;
  /** Crop window as fractions (0-1) of the image's natural pixel size. All null = uncropped
   *  (show the full source image) — see Konva's native `crop`/`cropWidth`/`cropHeight` support,
   *  which this maps onto directly in CanvasStage. */
  cropX: number | null;
  cropY: number | null;
  cropWidth: number | null;
  cropHeight: number | null;
  // --- qr-only fields (null for image/text/shape) — see src/lib/studio/qr.ts's file-level
  // comment for why a "qr" object is written to the wire as an ordinary "image" with these
  // collapsed into `content`, rather than as new database columns. ---
  qrDestination: string | null;
  qrErrorCorrection: "L" | "M" | "Q" | "H" | null;
  qrForegroundColor: string | null;
  qrBackgroundColor: string | null;
  qrDotStyle: "square" | "dots" | "rounded" | "classy" | "classy-rounded" | "extra-rounded" | null;
  qrCornerStyle: "square" | "dot" | "extra-rounded" | null;
  qrLogoUrl: string | null;
  qrStylePreset: "classic" | "rounded" | "soft" | "bold" | "minimal" | null;
  qrFrameStyle: "none" | "border" | null;
  qrLabelText: string | null;
  /** Last-known result of validating this QR against its own destination — see qr.ts. */
  qrValidated: boolean | null;
  /** Links this PLACEMENT back to the reusable QrAsset (see qrAssets.ts) it was created from — the
   *  QR ASSET vs QR PLACEMENT split (Section "CORE UX DECISION"). Null for a QR placed before this
   *  field existed, or a placement whose asset has since been deleted from My Stuff; both keep
   *  working exactly like today (every qr* field below is still fully denormalized onto the
   *  placement itself), they just can't be found again from "Recent QR Codes"/My Stuff. */
  qrAssetId: string | null;
}

export interface DesignSideRecord {
  id: string;
  sideType: DesignSideType;
  printAreaWidth: number;
  printAreaHeight: number;
  objects: DesignObjectRecord[];
}

export interface PricingSnapshot {
  /** Blank-garment unit price (wholesale x markup only, no decoration) — constant regardless of
   *  how many sides end up designed. */
  unitBasePrice: number;
  designFee: number;
  /** Per-unit chart cost for 1 print location, at this order's quantity tier — lets Studio
   *  recompute the printing line live as sides gain/lose artwork without re-deriving pricing. */
  chartFirstLocationCost: number;
  /** Per-unit chart cost for each additional location beyond the first, same tier. */
  chartAdditionalLocationCost: number;
  quantity: number;
  /** Snapshot total at creation time — Studio recomputes the live total from the fields above as
   *  the design changes; this is what gets frozen into the cart line at Review/Add to cart. */
  total: number;
  printRuleVersion: string;
}

export interface SizeQty {
  size: string;
  qty: number;
}

export interface DesignProjectRecord {
  id: string;
  productSlug: string;
  categorySlug: string;
  subcategorySlug: string;
  productName: string;
  brandName: string;
  colourName: string;
  sizeBreakdown: SizeQty[];
  totalQuantity: number;
  productTemplateVersion: string;
  pricingSnapshot: PricingSnapshot | null;
  mockupImages: Partial<Record<DesignSideType, string>>;
  status: DesignProjectStatus;
  revision: number;
  sides: DesignSideRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateDesignProjectInput {
  productSlug: string;
  categorySlug: string;
  subcategorySlug: string;
  productName: string;
  brandName: string;
  colourName: string;
  sizeBreakdown: SizeQty[];
  totalQuantity: number;
  pricingSnapshot: PricingSnapshot;
  mockupImages: Partial<Record<DesignSideType, string>>;
  /** widthIn/heightIn are only meaningful for "banner-face" (its real size varies per order) —
   *  every other DesignSideType ignores them and falls back to PRINT_AREAS[type] server-side. */
  sides: { type: DesignSideType; widthIn?: number; heightIn?: number }[];
}
