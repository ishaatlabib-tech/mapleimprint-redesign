// True-vector production export for any print area whose design is 100% text/shape objects (zero
// raster "image" objects — see isVectorEligible below) — satisfies "don't rasterize designs
// unnecessarily when vector output is needed" without a new paid dependency (no PDF library; SVG
// is plain string templating). Geometry for the four non-trivial shape kinds (speech-bubble/
// banner/heart/arrow) comes from the SAME shapePaths.ts outlineFor() the PNG renderer uses, so the
// two output formats are never independently-maintained/divergent for the same design.
import { createCanvas } from "@napi-rs/canvas";
import type { DesignObjectRecord, DesignSideRecord, ShapeKind } from "./types";
import { outlineFor } from "./shapePaths";
import { layoutCurvedText } from "./curvedText";
import { ensureServerFont } from "./serverFonts";

const PX_PER_IN = 96; // standard CSS reference pixel density, used only for the SVG viewBox units

export function isVectorEligible(side: DesignSideRecord): boolean {
  return side.objects.length > 0 && side.objects.every((o) => o.type === "text" || o.type === "shape");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function applyTextTransform(text: string, transform: DesignObjectRecord["textTransform"]): string {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "title":
      return text.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    default:
      return text;
  }
}

function pathDFor(kind: ShapeKind, w: number, h: number): string {
  const outline = outlineFor(kind, w, h);
  return outline
    .map((subpath) => `M ${subpath.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L ")} Z`)
    .join(" ");
}

function shapeElement(obj: DesignObjectRecord, x: number, y: number, w: number, h: number): string {
  const fill = obj.fill ? esc(obj.fill) : "none";
  const stroke = obj.strokeColor && obj.strokeWidth ? ` stroke="${esc(obj.strokeColor)}" stroke-width="${obj.strokeWidth}"` : "";
  const kind = obj.shapeKind;
  switch (kind) {
    case "circle": {
      const r = Math.min(w, h) / 2;
      return `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${r}" fill="${fill}"${stroke} />`;
    }
    case "ellipse":
      return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}"${stroke} />`;
    case "rounded-rectangle": {
      const r = Math.min(w, h) * 0.15;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${stroke} />`;
    }
    case "line":
      return `<line x1="${x}" y1="${y + h / 2}" x2="${x + w}" y2="${y + h / 2}"${stroke || ` stroke="${fill}" stroke-width="2"`} />`;
    default: {
      // triangle/polygon/diamond/star/rectangle (native-rect fallback) and the four bespoke kinds
      // (speech-bubble/banner/heart/arrow) all go through the same path-string route — simplest
      // way to guarantee this stays geometrically identical to the PNG renderer's drawShape().
      const d = kind ? pathDFor(kind, w, h) : `M 0,0 L ${w},0 L ${w},${h} L 0,${h} Z`;
      return `<path d="${d}" transform="translate(${x},${y})" fill="${fill}"${stroke} />`;
    }
  }
}

async function textElements(obj: DesignObjectRecord, x: number, y: number, w: number, h: number): Promise<string> {
  const fontSize = obj.fontSize ?? 24;
  const weight = obj.bold ? 700 : 400;
  const resolvedFamily = await ensureServerFont(obj.fontFamily, weight, obj.italic);
  const text = applyTextTransform(obj.content ?? "", obj.textTransform);
  const fill = obj.effectType === "hollow" ? "none" : esc(obj.fill ?? "#171412");
  const stroke = obj.strokeColor && obj.strokeWidth ? ` stroke="${esc(obj.strokeColor)}" stroke-width="${obj.strokeWidth}"` : "";
  const align = obj.align ?? "center";
  const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
  const textX = align === "left" ? x : align === "right" ? x + w : x + w / 2;
  const textY = y + h / 2;
  const fontAttrs = `font-family="${esc(resolvedFamily)}" font-size="${fontSize}" font-weight="${weight}" font-style="${obj.italic ? "italic" : "normal"}"${obj.letterSpacing ? ` letter-spacing="${obj.letterSpacing}"` : ""}`;

  let backgroundRect = "";
  if (obj.effectType === "background") {
    const padding = obj.bgPadding ?? 10;
    backgroundRect = `<rect x="${x - padding}" y="${y - padding}" width="${w + padding * 2}" height="${h + padding * 2}" rx="${obj.bgCornerRadius ?? 8}" fill="${esc(obj.bgColor ?? "#171412")}" />`;
  }

  if (!obj.curve) {
    return `${backgroundRect}<text x="${textX}" y="${textY}" text-anchor="${anchor}" dominant-baseline="middle" ${fontAttrs} fill="${fill}"${stroke}>${esc(text)}</text>`;
  }

  // Curved text has no native SVG single-element equivalent that matches our arc model exactly —
  // same per-character placement approach as the PNG renderer, reusing the identical layout math
  // (layoutCurvedText) so the two outputs agree. A throwaway canvas supplies glyph measurement
  // (SVG itself can't measure text server-side without actually rendering it).
  const measureCanvas = createCanvas(8, 8).getContext("2d");
  const glyphs = layoutCurvedText(text, fontSize, obj.letterSpacing ?? 0, obj.curve, resolvedFamily, obj.bold, obj.italic, measureCanvas);
  const centerX = x + w / 2;
  const centerY = y + h / 2;
  const glyphEls = glyphs
    .map(
      (g) =>
        `<text x="0" y="0" text-anchor="middle" dominant-baseline="middle" ${fontAttrs} fill="${fill}"${stroke} transform="translate(${(centerX + g.x).toFixed(2)},${(centerY + g.y).toFixed(2)}) rotate(${g.rotationDeg.toFixed(2)})">${esc(g.char)}</text>`,
    )
    .join("");
  return `${backgroundRect}${glyphEls}`;
}

/** `widthIn`/`heightIn` are the print area's real physical dimensions. Caller must have already
 *  checked isVectorEligible(side) — this doesn't re-check, and an image object silently produces
 *  no output for that layer rather than erroring, so check first. */
export async function renderDesignToSvg(objects: DesignObjectRecord[], widthIn: number, heightIn: number): Promise<string> {
  const vbW = widthIn * PX_PER_IN;
  const vbH = heightIn * PX_PER_IN;
  const parts: string[] = [];

  for (const obj of objects) {
    if (obj.hidden) continue;
    const x = obj.normalizedX * vbW;
    const y = obj.normalizedY * vbH;
    const w = obj.normalizedWidth * vbW;
    const h = obj.normalizedHeight * vbH;
    const rotation = obj.rotation ? ` rotate(${obj.rotation} ${x + w / 2} ${y + h / 2})` : "";
    const opacityAttr = obj.opacity < 1 ? ` opacity="${obj.opacity}"` : "";

    let inner = "";
    if (obj.type === "shape" && obj.shapeKind) {
      inner = shapeElement(obj, x, y, w, h);
    } else if (obj.type === "text" && obj.content) {
      inner = await textElements(obj, x, y, w, h);
    } else {
      continue;
    }
    parts.push(`<g${rotation ? ` transform="${rotation.trim()}"` : ""}${opacityAttr}>${inner}</g>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${widthIn}in" height="${heightIn}in" viewBox="0 0 ${vbW} ${vbH}">${parts.join("")}</svg>`;
}
