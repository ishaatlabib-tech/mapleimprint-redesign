// Best-effort font registration for the server-side production export renderer. @napi-rs/canvas
// has no access to a browser's installed/webfont-loaded fonts — it only draws text in whatever
// has been explicitly registered into its process-wide font database via GlobalFonts.register().
// This repo has no bundled TTF/OTF files for any of fontRegistry.ts's ~90 families (confirmed: no
// public/fonts directory exists), so this fetches each family's real font file from Google Fonts
// at export time and registers it, with an in-process cache so the same family is only ever
// fetched once per server instance, not once per export.
//
// Known limitation, documented rather than silently assumed away: this is genuinely best-effort.
// If the font fetch fails (network issue, family renamed upstream, etc.), the export silently
// falls back to @napi-rs/canvas's default font rather than failing the whole export — a slightly
// wrong typeface on a production file is a far smaller problem than no file at all. "system"-
// source families (Arial/Georgia/etc., including the two brand fonts Manrope/Bricolage Grotesque)
// aren't real Google Fonts entries and have no reliable fetch source here either; they fall back
// to the same default. Revisit by bundling real font files into the repo if exact typeface
// fidelity in production output becomes a real business requirement.
import { GlobalFonts } from "@napi-rs/canvas";
import { getFontEntry } from "./fontRegistry";

const registered = new Set<string>();
const failed = new Set<string>();

// Google's CSS2 endpoint serves WOFF2 by default, which @napi-rs/canvas's underlying font stack
// doesn't parse — requesting with an old/limited-capability user agent is the standard, widely
// documented technique to make Google fall back to serving plain TTF instead.
const LEGACY_UA =
  "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1; Trident/4.0; SV1; .NET CLR 2.0.50727; .NET CLR 3.0.04506.30)";

async function fetchFontBuffer(family: string, weight: number, italic: boolean): Promise<Buffer | null> {
  const familyParam = `${family.replace(/\s+/g, "+")}:ital,wght@${italic ? 1 : 0},${weight}`;
  const cssUrl = `https://fonts.googleapis.com/css2?family=${familyParam}&display=swap`;
  const cssRes = await fetch(cssUrl, { headers: { "User-Agent": LEGACY_UA } });
  if (!cssRes.ok) return null;
  const css = await cssRes.text();
  const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/);
  if (!match) return null;
  const fontRes = await fetch(match[1]);
  if (!fontRes.ok) return null;
  return Buffer.from(await fontRes.arrayBuffer());
}

/** Ensures `family` (at the given weight/italic, falling back to the entry's own closest
 *  available weight) is registered with @napi-rs/canvas before it's used in a `ctx.font` string.
 *  Returns the alias actually usable in a font string — may differ from `family` only in that
 *  it's always the same string registered under, so callers never need to guess. Safe to call
 *  repeatedly; resolves instantly for an already-registered or already-failed family. */
export async function ensureServerFont(
  family: string | null | undefined,
  weight: number,
  italic: boolean,
): Promise<string> {
  const entry = getFontEntry(family);
  const resolvedFamily = entry?.family ?? (family?.trim() || "sans-serif");
  const cacheKey = `${resolvedFamily}|${weight}|${italic}`;
  if (registered.has(cacheKey)) return resolvedFamily;
  if (failed.has(cacheKey) || entry?.source !== "google") return resolvedFamily;

  try {
    // Fall back to the closest weight the family actually publishes if the exact requested
    // weight isn't one of them (same "don't invent data" principle as fontRegistry's own
    // weights list — requesting a non-published weight from Google's API 400s).
    const closestWeight = entry.weights.reduce((best, w) =>
      Math.abs(w - weight) < Math.abs(best - weight) ? w : best,
    );
    const buffer = await fetchFontBuffer(resolvedFamily, closestWeight, italic && entry.hasItalic);
    if (!buffer) {
      failed.add(cacheKey);
      return resolvedFamily;
    }
    GlobalFonts.register(buffer, resolvedFamily);
    registered.add(cacheKey);
  } catch (err) {
    console.error(`[studio] server font registration failed for "${resolvedFamily}":`, err);
    failed.add(cacheKey);
  }
  return resolvedFamily;
}
