import "server-only";

import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/tokens";

export const SESSION_COOKIE = "__Host-tn_session";

/** "Remember me" checked. */
export const REMEMBER_ME_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
/** Unchecked — a shared or public machine. */
export const DEFAULT_DURATION_MS = 12 * 60 * 60 * 1000;

/**
 * A session is extended when it is used, but only once it is past this
 * fraction of its life. Refreshing on literally every request would mean a
 * database write per page load; refreshing at the halfway mark keeps sessions
 * sliding without that cost.
 */
const REFRESH_THRESHOLD = 0.5;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

export type ValidatedSession = {
  user: SessionUser;
  sessionId: string;
  expiresAt: Date;
  /** Set when the session slid forward; the caller must re-set the cookie. */
  renewedTo: Date | null;
};

/**
 * Issues a session. Returns the plaintext token, which is the only time it
 * exists outside the user's cookie jar — only its hash is stored.
 */
export async function createSession(
  userId: string,
  options: { rememberMe: boolean; userAgent?: string | null; ip?: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const duration = options.rememberMe ? REMEMBER_ME_DURATION_MS : DEFAULT_DURATION_MS;
  const expiresAt = new Date(Date.now() + duration);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      // Truncated: this is for the user recognising their own devices in
      // settings, not forensics, and a full UA string is mostly noise.
      userAgent: options.userAgent?.slice(0, 255) ?? null,
      ip: options.ip?.slice(0, 45) ?? null,
    },
  });

  return { token, expiresAt };
}

/**
 * Resolves a raw cookie value to its owner, or null.
 *
 * Deliberately does the expiry check in SQL rather than in JS: an expired row
 * must never match, even if the server clock and the database clock have
 * drifted apart.
 */
export async function validateSessionToken(
  token: string,
): Promise<ValidatedSession | null> {
  const tokenHash = hashToken(token);

  const session = await prisma.session.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      expiresAt: true,
      createdAt: true,
      user: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
    },
  });

  if (!session) return null;

  const now = Date.now();
  const totalLife = session.expiresAt.getTime() - session.createdAt.getTime();
  const remaining = session.expiresAt.getTime() - now;

  let renewedTo: Date | null = null;
  if (remaining < totalLife * REFRESH_THRESHOLD) {
    renewedTo = new Date(now + totalLife);
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: renewedTo, lastUsedAt: new Date() },
    });
  }

  return {
    user: session.user,
    sessionId: session.id,
    expiresAt: renewedTo ?? session.expiresAt,
    renewedTo,
  };
}

export async function revokeSession(token: string): Promise<void> {
  // deleteMany, not delete: logging out twice, or with a stale cookie, should
  // succeed quietly rather than throw a record-not-found.
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** "Sign out everywhere", and the forced logout after a password change. */
export async function revokeAllSessions(
  userId: string,
  options: { exceptSessionId?: string } = {},
): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: {
      userId,
      ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}),
    },
  });
  return count;
}

export async function revokeSessionById(
  userId: string,
  sessionId: string,
): Promise<void> {
  // Scoped by userId so one account cannot terminate another's session by id.
  await prisma.session.deleteMany({ where: { id: sessionId, userId } });
}

export async function listSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      userAgent: true,
      ip: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
    orderBy: { lastUsedAt: "desc" },
  });
}

/** Housekeeping for the maintenance cron. */
export async function deleteExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
