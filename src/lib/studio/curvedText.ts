// Per-character arc layout for curved text (Section 7). Konva has no built-in curved-text node, so
// curved text is rendered as one Konva.Text per character, each placed and rotated along a circular
// arc — the standard technique for canvas-based curved type. `curve` is a unitless -100..100 knob
// (not a physical radius): magnitude controls how tight the arc is, sign controls direction
// (positive arcs upward/"smile", negative arcs downward/"frown"). 0 (or null) means straight text
// and callers should skip this entirely and render a single flat Konva.Text instead.

export interface CurvedGlyph {
  char: string;
  x: number;
  y: number;
  rotationDeg: number;
}

// Empirically-chosen scale, not a physical unit: at curve=100 a ~200px-wide string arcs into a
// clearly-curved band without letters overlapping; at curve=10 it's barely perceptible.
const RADIUS_CONSTANT = 14000;

// QA pass root cause: curved text lays out each character as its own independent Konva.Text node
// (CanvasStage's DesignTextNode), positioned along the arc by this file — unlike a normal single
// Konva.Text string, nothing here previously measured each glyph's REAL rendered width; every
// character (bar space) was given the exact same fixed advance (fontSize*0.58), regardless of the
// font's actual glyph metrics. A narrow letter like "I" (≈3.8px at 13px Bricolage Grotesque Bold)
// was allocated the same slot as a wide one like "N" (≈10px) — visually reading as an uneven gap
// mid-word ("CELEBRATI ON") even though the layout math itself was perfectly smooth. Fixed by
// measuring each glyph with the SAME 2D canvas text-measurement API the browser already uses to
// actually draw it, using a font string that matches the real rendered font (family/weight/style)
// instead of a uniform guess. Browser-only (curved text only ever renders client-side, inside the
// dynamically-imported, ssr:false CanvasStage) — safe to use `document` directly here.
let measureCtx: CanvasRenderingContext2D | null | undefined;
function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  measureCtx = typeof document === "undefined" ? null : (document.createElement("canvas").getContext("2d") ?? null);
  return measureCtx;
}

/** Minimal shape both the browser's native CanvasRenderingContext2D and @napi-rs/canvas's
 *  server-side equivalent satisfy — just enough for glyph measurement. */
export interface TextMeasurer {
  font: string;
  measureText(text: string): { width: number };
}

function glyphAdvance(
  char: string,
  fontSize: number,
  fontFamily: string,
  bold: boolean,
  italic: boolean,
  ctx: TextMeasurer | null,
): number {
  if (char === " ") return fontSize * 0.28;
  if (!ctx) return fontSize * 0.58; // SSR/no-canvas fallback — never hit in practice, see comment above
  const style = `${italic ? "italic " : ""}${bold ? "700" : "400"} ${fontSize}px ${fontFamily}`;
  ctx.font = style;
  return ctx.measureText(char).width;
}

export function layoutCurvedText(
  text: string,
  fontSize: number,
  letterSpacing: number,
  curve: number,
  fontFamily = "Manrope, sans-serif",
  bold = false,
  italic = false,
  /** Injected so the server-side export renderer (src/lib/studio/renderDesignForExport.ts, which
   *  has no `document`) can pass its own @napi-rs/canvas context — defaults to the lazy
   *  browser-only singleton above, so every existing CanvasStage call site (which never passes
   *  this) keeps its exact original behavior unchanged. */
  measurer: TextMeasurer | null | undefined = undefined,
): CurvedGlyph[] {
  if (!curve) return [];
  const radius = RADIUS_CONSTANT / Math.abs(curve);
  const direction = curve > 0 ? 1 : -1;

  const resolvedMeasurer = measurer === undefined ? getMeasureContext() : measurer;
  const glyphs = [...text];
  const advances = glyphs.map(
    (c) => glyphAdvance(c, fontSize, fontFamily, bold, italic, resolvedMeasurer) + letterSpacing,
  );
  const totalWidth = advances.reduce((a, b) => a + b, 0);
  const totalAngle = totalWidth / radius;

  let angle = -totalAngle / 2;
  const out: CurvedGlyph[] = [];
  for (let i = 0; i < glyphs.length; i++) {
    angle += advances[i] / radius / 2;
    // QA fix: `angle` alone already walks monotonically left-to-right as i increases (glyphs[0]
    // gets the most-negative angle, glyphs[last] the most-positive) — that ordering must stay
    // direction-independent, or a negative (downward) curve reverses the whole word's reading
    // order ("MAPLE IMPRINT" rendering as "TN RPM ELPAM"). Only the vertical bulge and each
    // glyph's own tilt should flip for a downward curve, via `theta` — x is deliberately computed
    // from the un-flipped `angle`, never from `theta`.
    const theta = angle * direction;
    out.push({
      char: glyphs[i],
      x: radius * Math.sin(angle),
      y: direction * (radius - radius * Math.cos(theta)) * -1,
      rotationDeg: theta * (180 / Math.PI),
    });
    angle += advances[i] / radius / 2;
  }
  return out;
}
