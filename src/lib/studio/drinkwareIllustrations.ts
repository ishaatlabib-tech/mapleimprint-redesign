import type { DrinkwareVesselKind } from "./drinkwareCustomization";

// Clean, original vector illustrations of each drinkware vessel, used as the 2D editing background
// in the Studio (replacing the near-empty "MUG WRAP" card from printPieceSchematicSvg). Same
// division of responsibility as sleeveSchematicSvg/innerNeckSchematicSvg in printAreas.ts: this
// draws the product + a flat "wrap" band for context; CanvasStage overlays the real dashed
// print-area box (PLACEMENT_GEOMETRY["mug-wrap"], aspect 8:3.3 — already the true flat-wrap aspect)
// and the "placement confirmed before production" note on top. These are recognizable visual aids,
// NOT dimensionally-accurate production templates — real per-vessel print dimensions still need
// Maple's confirmed specs (see the plan's limitations).
//
// Layout within the fixed 520x650 design space:
//   y  24..214  — vessel hero illustration (what you're designing)
//   y 224..426  — flat wrap band (sits under the dashed print box at yFrac .36 / heightFrac .28)
//   y 448..     — caption

const C = {
  bg: "#F6F1E9",
  band: "#FFFFFF",
  bandStroke: "#D8CFC0",
  line: "#B4A892",
  label: "#8C816E",
  ceramic: "#EFE7DA",
  ceramicShade: "#E2D8C7",
  steel: "#DBDFE3",
  steelShade: "#C5CAD0",
  steelRim: "#B9BFC6",
  glass: "#E7F0F2",
  glassRim: "#C8DADE",
  dark: "#3A3A3E",
  darkSoft: "#55555B",
};

const VESSEL_LABEL: Record<DrinkwareVesselKind, string> = {
  mug: "mug",
  "travel-mug": "travel mug",
  tumbler: "tumbler",
  "skinny-tumbler": "skinny tumbler",
  glass: "glass",
  bottle: "bottle",
};

/** Per-vessel hero drawing, centered around x=260, occupying roughly y 24..214. */
function vesselArt(kind: DrinkwareVesselKind): string {
  switch (kind) {
    case "mug":
      return `
        <path d="M318 96 C366 100 366 160 318 164" fill="none" stroke="${C.line}" stroke-width="12" stroke-linecap="round"/>
        <path d="M318 96 C360 100 360 160 318 164" fill="none" stroke="${C.ceramic}" stroke-width="5" stroke-linecap="round"/>
        <path d="M198 86 Q198 80 205 80 L315 80 Q322 80 322 86 L318 198 Q318 206 311 206 L209 206 Q202 206 202 198 Z" fill="${C.ceramic}" stroke="${C.line}" stroke-width="2.5"/>
        <ellipse cx="260" cy="84" rx="62" ry="13" fill="${C.ceramicShade}" stroke="${C.line}" stroke-width="2.5"/>
        <ellipse cx="260" cy="84" rx="49" ry="8.5" fill="${C.bg}"/>`;
    case "travel-mug":
      return `
        <path d="M222 70 L298 70 Q304 70 304 76 L300 92 L220 92 L216 76 Q216 70 222 70 Z" fill="${C.dark}" stroke="${C.darkSoft}" stroke-width="2"/>
        <rect x="246" y="56" width="28" height="18" rx="5" fill="${C.darkSoft}"/>
        <path d="M212 92 L308 92 L296 206 Q295 212 289 212 L231 212 Q225 212 224 206 Z" fill="${C.steel}" stroke="${C.steelRim}" stroke-width="2.5"/>
        <path d="M224 118 L296 118" stroke="${C.steelShade}" stroke-width="1.5" opacity="0.7"/>
        <ellipse cx="260" cy="206" rx="33" ry="7" fill="${C.steelShade}"/>`;
    case "tumbler":
      return `
        <path d="M224 66 L296 66 Q302 66 302 72 L300 86 L220 86 Q218 72 218 72 Q218 66 224 66 Z" fill="${C.dark}" stroke="${C.darkSoft}" stroke-width="2"/>
        <circle cx="286" cy="76" r="5" fill="${C.darkSoft}"/>
        <path d="M216 86 L304 86 L294 208 Q293 214 287 214 L233 214 Q227 214 226 208 Z" fill="${C.steel}" stroke="${C.steelRim}" stroke-width="2.5"/>
        <path d="M232 110 Q260 118 288 110" fill="none" stroke="${C.steelShade}" stroke-width="1.5" opacity="0.7"/>
        <ellipse cx="260" cy="208" rx="31" ry="7" fill="${C.steelShade}"/>`;
    case "skinny-tumbler":
      return `
        <rect x="268" y="24" width="7" height="60" rx="3.5" fill="${C.dark}"/>
        <path d="M236 70 L292 70 Q297 70 297 75 L295 88 L233 88 Q231 75 231 75 Q231 70 236 70 Z" fill="${C.dark}" stroke="${C.darkSoft}" stroke-width="2"/>
        <path d="M234 88 L294 88 L285 214 Q284 220 278 220 L250 220 Q244 220 243 214 Z" fill="${C.steel}" stroke="${C.steelRim}" stroke-width="2.5"/>
        <path d="M248 112 L280 112" stroke="${C.steelShade}" stroke-width="1.5" opacity="0.7"/>
        <ellipse cx="264" cy="214" rx="21" ry="6" fill="${C.steelShade}"/>`;
    case "glass":
      return `
        <path d="M212 78 L308 78 L292 206 Q291 212 285 212 L235 212 Q229 212 228 206 Z" fill="${C.glass}" stroke="${C.glassRim}" stroke-width="2.5"/>
        <ellipse cx="260" cy="78" rx="48" ry="10" fill="${C.bg}" stroke="${C.glassRim}" stroke-width="2.5"/>
        <path d="M224 96 L236 190" stroke="#FFFFFF" stroke-width="5" opacity="0.6" stroke-linecap="round"/>
        <ellipse cx="260" cy="206" rx="31" ry="7" fill="${C.glassRim}" opacity="0.6"/>`;
    case "bottle":
      return `
        <rect x="246" y="26" width="28" height="22" rx="5" fill="${C.dark}" stroke="${C.darkSoft}" stroke-width="2"/>
        <path d="M250 48 L270 48 L272 72 L248 72 Z" fill="${C.steelShade}" stroke="${C.steelRim}" stroke-width="2"/>
        <path d="M226 72 Q260 60 294 72 L296 196 Q296 212 282 212 L238 212 Q224 212 224 196 Z" fill="${C.steel}" stroke="${C.steelRim}" stroke-width="2.5"/>
        <path d="M238 104 L282 104" stroke="${C.steelShade}" stroke-width="1.5" opacity="0.7"/>
        <ellipse cx="260" cy="206" rx="35" ry="7" fill="${C.steelShade}"/>`;
  }
}

/** The 2D editing background for a drinkware wrap — one clean illustration per vessel kind. (The
 *  vessel palette is fixed today; per-colourway tinting can be added later by threading colourName
 *  through backgroundUrlFor, as the garment schematics do.) */
export function drinkwareWrapIllustrationSvg(kind: DrinkwareVesselKind): string {
  const label = VESSEL_LABEL[kind];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="650">
    <rect width="520" height="650" fill="${C.bg}"/>
    ${vesselArt(kind)}
    <!-- Flat wrap band: the surface the customer actually designs (dashed print box overlays here) -->
    <rect x="30" y="224" width="460" height="202" rx="14" fill="${C.band}" stroke="${C.bandStroke}" stroke-width="2"/>
    <path d="M30 234 Q22 325 30 416" fill="none" stroke="${C.bandStroke}" stroke-width="2" opacity="0.7"/>
    <path d="M490 234 Q498 325 490 416" fill="none" stroke="${C.bandStroke}" stroke-width="2" opacity="0.7"/>
    <text x="260" y="462" font-family="sans-serif" font-size="13" font-weight="600" letter-spacing="1.2" fill="${C.label}" text-anchor="middle">FLAT WRAP · WRAPS AROUND YOUR ${label.toUpperCase()}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
