import crypto from "crypto";

// One shared staff password (env var), not per-staff accounts — decided during Phase 1 planning.
// Separate from the mi-session customer cookie (src/lib/studio/session.ts, deliberately
// non-httpOnly since it guards nothing secret): this cookie guards a real shared secret, so it's
// httpOnly, and its value is HMAC-signed so it can't be forged even though there's no per-user
// identity behind it.
export const ADMIN_SESSION_COOKIE = "mi-staff-session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
export const ADMIN_SESSION_MAX_AGE_SECONDS = SESSION_DURATION_MS / 1000;

function sha256(value: string): Buffer {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

function hmac(value: string): Buffer {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not set");
  return crypto.createHmac("sha256", secret).update(value, "utf8").digest();
}

/** Fixed-length SHA-256 digests compared via timingSafeEqual — avoids both a timing leak and a
 *  length leak on the raw password (timingSafeEqual itself throws on mismatched-length buffers,
 *  which a raw string comparison of different-length passwords would otherwise expose). */
export function verifyPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return crypto.timingSafeEqual(sha256(input), sha256(expected));
}

export function createSessionCookieValue(): string {
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const signature = hmac(String(expiresAt)).toString("hex");
  return `${expiresAt}.${signature}`;
}

export function isValidSessionCookie(value: string | undefined | null): boolean {
  if (!value) return false;
  const [expiresAtRaw, signature] = value.split(".");
  if (!expiresAtRaw || !signature) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = hmac(expiresAtRaw);
  const actual = Buffer.from(signature, "hex");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
