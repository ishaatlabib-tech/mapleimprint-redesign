// Server-side sibling of renderDesignToCanvas.ts, for production-file export — a SEPARATE
// implementation, not a modification of the original (which stays exactly as-is, still used only
// by Mug3DPreview.tsx/Flat3DPreview.tsx for the in-browser 3D-preview texture). The original is
// browser-only (DOM `canvas`/`Image`) and can't run in a Next.js API route; this uses
// @napi-rs/canvas instead, and additionally:
//   - sizes the canvas at real DPI (widthIn/heightIn * dpi actual pixels), not an arbitrary CSS-px
//     supersample
//   - supports a transparent background (production files are print-ready transparent assets,
//     never a solid-fill mockup backing)
//   - implements every effect/shape kind the original explicitly skips (shadow/glow/lift/
//     background/hollow text effects, curved text, speech-bubble/banner/heart/arrow shapes) —
//     production output can't silently drop a customer's actual styling choice the way a
//     best-effort 3D-preview texture reasonably can
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type { DesignObjectRecord, ShapeKind } from "./types";
import { outlineFor } from "./shapePaths";
import { layoutCurvedText } from "./curvedText";
import { ensureServerFont } from "./serverFonts";

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

function drawShape(ctx: SKRSContext2D, kind: ShapeKind, w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  switch (kind) {
    case "circle": {
      const r = Math.min(w, h) / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      return;
    }
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      return;
    case "rounded-rectangle": {
      const r = Math.min(w, h) * 0.15;
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, r);
      return;
    }
    case "triangle":
    case "polygon":
    case "diamond": {
      const sides = kind === "triangle" ? 3 : kind === "diamond" ? 4 : 6;
      const r = Math.min(w, h) / 2;
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
        const px = cx + r * Math.cos(angle);
        const py = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      return;
    }
    case "star": {
      const outerR = Math.min(w, h) / 2;
      const innerR = outerR * 0.5;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI * i) / 5 - Math.PI / 2;
        const px = cx + r * Math.cos(angle);
        const py = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      return;
    }
    case "line":
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      return;
    case "speech-bubble":
    case "banner":
    case "heart":
    case "arrow": {
      // Production parity with the four shape kinds renderDesignToCanvas.ts intentionally skips —
      // outlineFor gives the exact same point data the SVG exporter uses, so a design containing
      // one of these renders identically whether it ends up as the PNG or the SVG.
      const outline = outlineFor(kind, w, h);
      ctx.beginPath();
      for (const subpath of outline) {
        subpath.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        ctx.closePath();
      }
      return;
    }
    default:
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
  }
}

/** Converts a hex colour + 0-1 opacity into an rgba() string — Canvas2D's shadowColor has no
 *  separate opacity channel the way Konva's shadowOpacity prop does, so the two have to be
 *  pre-composited here to match what the interactive editor shows. */
function withAlpha(hex: string, opacity: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

async function drawObject(ctx: SKRSContext2D, obj: DesignObjectRecord, boxW: number, boxH: number) {
  if (obj.hidden) return;
  const x = obj.normalizedX * boxW;
  const y = obj.normalizedY * boxH;
  const w = obj.normalizedWidth * boxW;
  const h = obj.normalizedHeight * boxH;

  ctx.save();
  ctx.globalAlpha = obj.opacity;
  if (obj.rotation) {
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((obj.rotation * Math.PI) / 180);
    ctx.translate(-(x + w / 2), -(y + h / 2));
  }

  const shadowActive = obj.effectType === "shadow" || obj.effectType === "lift" || obj.effectType === "glow";
  if (shadowActive) {
    ctx.shadowColor = withAlpha(obj.shadowColor ?? "#000000", obj.shadowOpacity ?? 0.5);
    ctx.shadowBlur = obj.shadowBlur ?? 6;
    ctx.shadowOffsetX = obj.shadowOffsetX ?? 2;
    ctx.shadowOffsetY = obj.shadowOffsetY ?? 2;
  }

  if (obj.type === "image" && obj.assetUrl) {
    try {
      const img = await loadImage(obj.assetUrl);
      ctx.save();
      ctx.translate(x, y);
      if (obj.flipX || obj.flipY) {
        ctx.translate(obj.flipX ? w : 0, obj.flipY ? h : 0);
        ctx.scale(obj.flipX ? -1 : 1, obj.flipY ? -1 : 1);
      }
      if (obj.cropX !== null && obj.cropWidth !== null && obj.cropY !== null && obj.cropHeight !== null) {
        const sx = obj.cropX * img.width;
        const sy = obj.cropY * img.height;
        const sw = obj.cropWidth * img.width;
        const sh = obj.cropHeight * img.height;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      } else {
        ctx.drawImage(img, 0, 0, w, h);
      }
      ctx.restore();
    } catch (err) {
      console.error(`[studio] export: couldn't load image asset ${obj.assetUrl}:`, err);
    }
  } else if (obj.type === "shape" && obj.shapeKind) {
    ctx.translate(x, y);
    drawShape(ctx, obj.shapeKind, w, h);
    if (obj.fill) {
      ctx.fillStyle = obj.fill;
      ctx.fill();
    }
    if (obj.strokeColor && obj.strokeWidth) {
      ctx.strokeStyle = obj.strokeColor;
      ctx.lineWidth = obj.strokeWidth;
      ctx.stroke();
    }
  } else if (obj.type === "text" && obj.content) {
    const fontSize = obj.fontSize ?? 24;
    const weight = obj.bold ? 700 : 400;
    const resolvedFamily = await ensureServerFont(obj.fontFamily, weight, obj.italic);
    const style = obj.italic ? "italic" : "normal";
    ctx.font = `${style} ${weight} ${fontSize}px "${resolvedFamily}"`;
    const fill = obj.effectType === "hollow" ? "transparent" : (obj.fill ?? "#171412");
    ctx.textBaseline = "middle";
    const align = obj.align ?? "center";
    ctx.textAlign = align;
    const text = applyTextTransform(obj.content, obj.textTransform);

    // "background" effect — a rounded rect behind the text, drawn before the glyphs so it sits
    // underneath; uses the UNrotated/untranslated-by-shadow local box since it's relative to the
    // already-applied object transform above.
    if (obj.effectType === "background") {
      const padding = obj.bgPadding ?? 10;
      ctx.save();
      ctx.shadowColor = "transparent"; // the background box itself isn't shadowed, only the glyphs
      ctx.fillStyle = obj.bgColor ?? "#171412";
      ctx.beginPath();
      ctx.roundRect(x - padding, y - padding, w + padding * 2, h + padding * 2, obj.bgCornerRadius ?? 8);
      ctx.fill();
      ctx.restore();
    }

    if (obj.curve) {
      const glyphs = layoutCurvedText(
        text,
        fontSize,
        obj.letterSpacing ?? 0,
        obj.curve,
        resolvedFamily,
        obj.bold,
        obj.italic,
        ctx,
      );
      const centerX = x + w / 2;
      const centerY = y + h / 2;
      ctx.textAlign = "center";
      for (const g of glyphs) {
        ctx.save();
        ctx.translate(centerX + g.x, centerY + g.y);
        ctx.rotate((g.rotationDeg * Math.PI) / 180);
        ctx.fillStyle = fill;
        ctx.fillText(g.char, 0, 0);
        if (obj.strokeColor && obj.strokeWidth) {
          ctx.strokeStyle = obj.strokeColor;
          ctx.lineWidth = obj.strokeWidth;
          ctx.strokeText(g.char, 0, 0);
        }
        ctx.restore();
      }
    } else {
      ctx.fillStyle = fill;
      const textX = align === "left" ? x : align === "right" ? x + w : x + w / 2;
      const textY = y + h / 2;
      if (obj.letterSpacing) {
        const chars = [...text];
        const widths = chars.map((c) => ctx.measureText(c).width);
        const totalWidth = widths.reduce((a, b) => a + b, 0) + obj.letterSpacing * (chars.length - 1);
        let cursor = align === "left" ? textX : align === "right" ? textX - totalWidth : textX - totalWidth / 2;
        ctx.textAlign = "left";
        for (let i = 0; i < chars.length; i++) {
          ctx.fillText(chars[i], cursor, textY);
          if (obj.strokeColor && obj.strokeWidth) {
            ctx.strokeStyle = obj.strokeColor;
            ctx.lineWidth = obj.strokeWidth;
            ctx.strokeText(chars[i], cursor, textY);
          }
          cursor += widths[i] + obj.letterSpacing;
        }
      } else {
        ctx.fillText(text, textX, textY);
        if (obj.strokeColor && obj.strokeWidth) {
          ctx.strokeStyle = obj.strokeColor;
          ctx.lineWidth = obj.strokeWidth;
          ctx.strokeText(text, textX, textY);
        }
      }
    }
  }

  ctx.restore();
}

/** `widthIn`/`heightIn` are the print area's real physical dimensions (PRINT_AREAS[sideType], with
 *  the banner-face per-order override already applied by the caller); `dpi` is 300 for production
 *  output. `transparent: true` skips the background fill entirely (print-ready transparent PNG);
 *  `transparent: false` (used only if this is ever reused for a non-production preview) fills
 *  `background` first, matching renderDesignToCanvas.ts's own default behavior. */
export async function renderDesignForExport(
  objects: DesignObjectRecord[],
  widthIn: number,
  heightIn: number,
  dpi: number,
  opts: { transparent: boolean; background?: string } = { transparent: true },
): Promise<Buffer> {
  const boxW = Math.round(widthIn * dpi);
  const boxH = Math.round(heightIn * dpi);
  const canvas = createCanvas(boxW, boxH);
  const ctx = canvas.getContext("2d");

  if (!opts.transparent) {
    ctx.fillStyle = opts.background ?? "#FFFFFF";
    ctx.fillRect(0, 0, boxW, boxH);
  }

  for (const obj of objects) {
    await drawObject(ctx, obj, boxW, boxH);
  }

  return canvas.toBuffer("image/png");
}
