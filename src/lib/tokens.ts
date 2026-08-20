import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque credential tokens — session cookies and password-reset links.
 *
 * The pattern throughout: generate a high-entropy random token, hand the
 * plaintext to the user exactly once, and persist only its SHA-256. Reading
 * the database then yields nothing usable, which is what makes a leaked
 * backup or an accidental log dump survivable.
 *
 * SHA-256 without a salt or work factor is the right call here, unlike for
 * passwords: these tokens are 256 bits of CSPRNG output, so there is no
 * dictionary to attack and no need to slow lookup down.
 */

const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Constant-time comparison for hex digests. Session lookup goes through a
 * unique index rather than this, but reset-token checks compare directly and
 * should not leak position-of-first-difference through timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
