import { renderDesignForExport } from "./renderDesignForExport";
import type { DesignObjectRecord } from "./types";

const TARGET_LONG_EDGE_PX = 1200;
const MIN_DPI = 72;
const MAX_DPI = 150;

// Neutral canvas colour, not an attempt to simulate the actual product colourway — Studio's own
// live 2D/3D preview (renderDesignToCanvas.ts, Flat3DPreview.tsx/Mug3DPreview.tsx) already does
// that while the customer is editing. This render's only job is "what did they actually design,"
// composited onto something other than transparent so it's viewable as a flat image later.
const PREVIEW_BACKGROUND = "#F2F0EB";

/** Customer-preview render: same object model and renderer as the 300dpi production export
 *  (renderDesignForExport), but non-transparent and sized for on-screen viewing rather than print —
 *  a banner's print area at 300dpi would be tens of megapixels, which is wasted bandwidth for
 *  something that's only ever going to be looked at in a browser. */
export async function renderPreview(objects: DesignObjectRecord[], widthIn: number, heightIn: number): Promise<Buffer> {
  const longEdgeIn = Math.max(widthIn, heightIn);
  const rawDpi = TARGET_LONG_EDGE_PX / longEdgeIn;
  const dpi = Math.min(MAX_DPI, Math.max(MIN_DPI, rawDpi));
  return renderDesignForExport(objects, widthIn, heightIn, dpi, { transparent: false, background: PREVIEW_BACKGROUND });
}
