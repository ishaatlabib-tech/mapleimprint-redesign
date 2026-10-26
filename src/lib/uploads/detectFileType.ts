// Magic-byte file-type detection — every upload route in this app today validates by claimed
// `file.type` (MIME, set by the browser from the OS's file association, easy to spoof/wrong) or
// by filename extension alone (/api/upload's ALLOWED_EXTENSIONS). Neither actually looks at the
// bytes. This is the one shared place that does, so saveUpload.ts can reject a file whose content
// doesn't match what it claims to be, regardless of which upload route it came through.

export type DetectedFileType =
  | "png"
  | "jpeg"
  | "pdf"
  | "zip"
  | "psd"
  | "eps"
  | "ai"
  | "svg"
  | "unknown";

/** AI files are PDF-compatible since Illustrator CS2+ (they open as valid PDFs with embedded
 *  Illustrator-specific data), so an AI file's magic bytes are legitimately identical to a plain
 *  PDF's — there is no byte-level way to tell them apart without parsing much deeper into the
 *  file. Classify both as "pdf" at the detection layer; callers that need to accept "AI or PDF"
 *  (the quote-flow's production-file category) treat them as the same detected type, and the
 *  original filename/extension (preserved separately, never discarded) is what a human/staff
 *  member uses to tell them apart when it matters. */
export function detectFileType(bytes: Uint8Array): DetectedFileType {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, asciiBytes("%PDF"))) return "pdf";
  if (startsWith(bytes, asciiBytes("8BPS"))) return "psd";
  if (startsWith(bytes, asciiBytes("%!PS-Adobe"))) return "eps";
  // ZIP-based formats (plain .zip, but also docx/xlsx/etc. — not a concern here since those
  // aren't in any allowed-extension list) all share the same local-file-header signature.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  if (looksLikeSvg(bytes)) return "svg";
  return "unknown";
}

/** `declaredExtension` is the original filename's extension (lowercased, no dot) — used only to
 *  resolve the genuine PDF/AI byte-level ambiguity documented above in favour of whichever the
 *  customer's own filename claims; every other mismatch between declared and detected type is a
 *  real validation failure, not resolved here. */
export function matchesDeclaredType(detected: DetectedFileType, declaredExtension: string): boolean {
  const ext = declaredExtension.toLowerCase();
  if (detected === "pdf") return ext === "pdf" || ext === "ai";
  if (detected === "jpeg") return ext === "jpg" || ext === "jpeg";
  return detected === ext;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

function asciiBytes(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}

/** SVG is plain-text XML, not a fixed binary signature — sniff the first chunk of bytes as text
 *  (after stripping a possible UTF-8 BOM and leading whitespace/XML declaration) for an opening
 *  `<svg` tag. This is classification only (does this file look like SVG), not sanitization —
 *  the existing "SVG upload isn't accepted in Studio yet" XSS-risk note in
 *  src/app/api/studio/upload/route.ts still applies; this function doesn't change that policy. */
function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 512));
  const trimmed = head.replace(/^﻿/, "").trimStart();
  return /^<\?xml[\s\S]*?\?>\s*(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(trimmed) || /^<svg[\s>]/i.test(trimmed);
}
