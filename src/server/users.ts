import "server-only";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { generateToken, hashToken } from "@/lib/tokens";

/** How long a password-reset link stays usable. */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, passwordHash: true },
  });
}

export async function emailExists(email: string): Promise<boolean> {
  const found = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  return found !== null;
}

export type CreateUserResult =
  | { ok: true; user: { id: string; name: string; email: string } }
  | { ok: false; reason: "email_taken" };

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<CreateUserResult> {
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.user.create({
      data: { name: input.name, email: input.email, passwordHash },
      select: { id: true, name: true, email: true },
    });
    return { ok: true, user };
  } catch (error) {
    // Relying on the unique constraint rather than a prior existence check:
    // two simultaneous signups for the same address would both pass a check
    // and then one would fail here anyway. Let the database be the authority.
    if (isUniqueViolation(error, "email")) {
      return { ok: false, reason: "email_taken" };
    }
    throw error;
  }
}

export async function updatePassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
}

export async function getUserPasswordHash(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  return user?.passwordHash ?? null;
}

export async function updateProfile(
  userId: string,
  data: { name?: string; avatarUrl?: string | null },
): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data });
}

/**
 * Issues a reset token, returning the plaintext for the email link. Only the
 * hash is stored, so a database reader cannot mint a working reset URL.
 */
export async function createPasswordResetToken(userId: string): Promise<string> {
  // Invalidate outstanding tokens: requesting a new link should retire the old
  // one, so a link forwarded or logged earlier stops working.
  await prisma.passwordReset.deleteMany({ where: { userId, usedAt: null } });

  const token = generateToken();
  await prisma.passwordReset.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  return token;
}

export type ResetTokenLookup =
  { valid: true; userId: string; resetId: string } | { valid: false };

export async function findValidResetToken(token: string): Promise<ResetTokenLookup> {
  const record = await prisma.passwordReset.findFirst({
    where: {
      tokenHash: hashToken(token),
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, userId: true },
  });

  return record
    ? { valid: true, userId: record.userId, resetId: record.id }
    : { valid: false };
}

/**
 * Redeems a reset token and sets the new password in one transaction.
 *
 * The `usedAt: null` filter inside the update is what makes the token
 * single-use even under concurrent requests: the second one updates zero rows
 * and the transaction reports failure, rather than both succeeding.
 */
export async function consumeResetToken(
  resetId: string,
  userId: string,
  newPassword: string,
): Promise<boolean> {
  const passwordHash = await hashPassword(newPassword);

  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.passwordReset.updateMany({
        where: { id: resetId, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (count === 0) throw new TokenAlreadyUsed();

      await tx.user.update({ where: { id: userId }, data: { passwordHash } });

      // Anyone holding a session on this account loses it. If the reset was
      // triggered because the account was compromised, leaving the attacker's
      // session alive would defeat the point.
      await tx.session.deleteMany({ where: { userId } });
    });
    return true;
  } catch (error) {
    if (error instanceof TokenAlreadyUsed) return false;
    throw error;
  }
}

class TokenAlreadyUsed extends Error {}

export async function deleteExpiredResetTokens(): Promise<number> {
  const { count } = await prisma.passwordReset.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

function isUniqueViolation(error: unknown, field: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: string; meta?: { target?: unknown } };
  if (e.code !== "P2002") return false;

  const target = e.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  if (typeof target === "string") return target.includes(field);
  // Constraint name unavailable — the only unique column on User is email.
  return true;
}
