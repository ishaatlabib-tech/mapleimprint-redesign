// Pure path-point generators per ShapeKind, shared by the Canvas2D production renderer
// (renderDesignForExport.ts) and the SVG exporter (renderDesignToSvg.ts) so a design's PNG and
// SVG output are geometrically identical rather than two independently-maintained
// implementations that could silently drift apart. renderDesignToCanvas.ts's existing
// drawShapePath covers circle/ellipse/rounded-rectangle/triangle/polygon/diamond/star/line/
// rectangle already — this file adds the four it explicitly skips (speech-bubble, banner, heart,
// arrow), since production output can't silently drop a customer's actual shape choice the way a
// best-effort 3D-preview texture reasonably can.
import type { ShapeKind } from "./types";

/** A path as a flat list of subpaths, each a list of [x, y] points connected by straight lines in
 *  order, with the subpath implicitly closed (last point connects back to the first) — enough to
 *  describe every shape below without needing arcs/beziers, which keeps the SVG-path-string
 *  conversion in renderDesignToSvg.ts trivial (M/L/Z only). */
export type ShapeOutline = [number, number][][];

function rect(w: number, h: number): ShapeOutline {
  return [[[0, 0], [w, 0], [w, h], [0, h]]];
}

/** Classic cartoon speech bubble: a rounded-rectangle-ish body (approximated here as a plain
 *  rectangle, since the outline format is straight-line-only and the tail is the part that
 *  actually reads as "speech bubble") with a small triangular tail at the bottom-left pointing
 *  down and out. */
function speechBubble(w: number, h: number): ShapeOutline {
  const bodyH = h * 0.78;
  const tailW = w * 0.14;
  const tailX = w * 0.18;
  const body: [number, number][] = [[0, 0], [w, 0], [w, bodyH], [tailX + tailW, bodyH], [tailX, h], [tailX, bodyH], [0, bodyH]];
  return [body];
}

/** A ribbon/pennant banner: a rectangle with two small inward-pointing notches cut from the
 *  bottom-left and bottom-right corners, giving the classic "banner" silhouette. */
function banner(w: number, h: number): ShapeOutline {
  const notch = Math.min(w, h) * 0.18;
  return [[
    [0, 0],
    [w, 0],
    [w, h],
    [w - notch, h - notch],
    [w, h],
    [w, h],
    [w - notch, h],
    [notch, h],
    [0, h],
    [notch, h - notch],
    [0, h],
  ]];
}

/** Two overlapping circles for the top lobes plus a point at the bottom — approximated with
 *  straight-line segments (enough points around each lobe to read as a heart at typical print
 *  sizes) rather than true arcs, keeping this consistent with every other shape in this file. */
function heart(w: number, h: number): ShapeOutline {
  const points: [number, number][] = [];
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    // Standard parametric heart curve, normalized to [-1, 1] then mapped into [0, w] x [0, h].
    const hx = 16 * Math.sin(t) ** 3;
    const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    points.push([((hx + 16) / 32) * w, ((hy + 17) / 34) * h]);
  }
  return [points];
}

/** Simple right-pointing arrow: a rectangular shaft plus a triangular head, both within the
 *  object's own bounding box. */
function arrow(w: number, h: number): ShapeOutline {
  const shaftH = h * 0.4;
  const headW = w * 0.38;
  const shaftTop = (h - shaftH) / 2;
  return [[
    [0, shaftTop],
    [w - headW, shaftTop],
    [w - headW, 0],
    [w, h / 2],
    [w - headW, h],
    [w - headW, shaftTop + shaftH],
    [0, shaftTop + shaftH],
  ]];
}

export function outlineFor(kind: ShapeKind, w: number, h: number): ShapeOutline {
  switch (kind) {
    case "speech-bubble":
      return speechBubble(w, h);
    case "banner":
      return banner(w, h);
    case "heart":
      return heart(w, h);
    case "arrow":
      return arrow(w, h);
    default:
      // Every other kind (circle/ellipse/rounded-rectangle/triangle/polygon/diamond/star/line/
      // rectangle) already has real curve/arc support in renderDesignToCanvas.ts's drawShapePath —
      // this module only needs to cover the four that function explicitly skips. A plain
      // rectangle outline here is just a safe, visible fallback should this ever be called for
      // one of those, never actually exercised in practice.
      return rect(w, h);
  }
}
