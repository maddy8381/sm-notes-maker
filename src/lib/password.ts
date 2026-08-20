import "server-only";

import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id parameters. These are the OWASP-recommended minimums (19 MiB, 2
 * iterations, 1 degree of parallelism) — deliberately not tuned higher,
 * because Vercel functions have limited memory and a login that takes half a
 * second is worse for a 20-person tool than the marginal extra resistance.
 */
const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/**
 * Returns false rather than throwing on a malformed hash, so a corrupted row
 * reads as "wrong password" instead of a 500 that tells an attacker the
 * account exists.
 */
export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password, OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Burns roughly the same time as a real verify.
 *
 * Login calls this when no account matches the submitted email. Without it,
 * "no such user" returns in ~1ms while a real account takes ~50ms, and that
 * gap is enough to enumerate which addresses are registered.
 *
 * This hashes rather than verifies. A hardcoded dummy hash would be faster to
 * write but is easy to get subtly wrong — argon2 rejects a malformed digest
 * immediately, which would silently reintroduce the very timing gap this is
 * meant to close. Hashing uses the same memory and iteration cost, so the
 * timing matches by construction.
 */
export async function fakeVerify(): Promise<void> {
  await hash("timing-equalisation-placeholder", OPTIONS);
}
