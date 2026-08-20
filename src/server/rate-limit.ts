import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Fixed-window rate limiting backed by Postgres.
 *
 * Redis would be the reflexive choice, but at 10-20 users it would be a second
 * piece of infrastructure to provision, pay for and monitor in order to
 * protect a table that is already one query away. A fixed window is also
 * slightly leakier than a sliding one — a burst can straddle a boundary and
 * get 2x the budget — which does not matter for stopping password guessing.
 *
 * Swapping this for Upstash later means reimplementing one function.
 */

export type RateLimitRule = {
  /** Requests permitted per window. */
  limit: number;
  windowMs: number;
};

export const RATE_LIMITS = {
  // Per email. Tight, because this is the one that stops credential stuffing.
  login: { limit: 8, windowMs: 15 * 60 * 1000 },
  // Per IP, looser: a household or office behind one NAT would otherwise lock
  // itself out when two people sign in.
  loginByIp: { limit: 40, windowMs: 15 * 60 * 1000 },
  signup: { limit: 5, windowMs: 60 * 60 * 1000 },
  passwordReset: { limit: 4, windowMs: 60 * 60 * 1000 },
  upload: { limit: 100, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** When the current window ends — surfaced to the user as "try again in X". */
  resetAt: Date;
};

/**
 * Consumes one unit against `key`. Call this before doing the expensive or
 * sensitive work, and only on failure paths where that makes sense (a
 * successful login resets its own counter via `resetRateLimit`).
 */
export async function checkRateLimit(
  scope: keyof typeof RATE_LIMITS,
  identifier: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[scope];
  const key = `${scope}:${identifier}`;
  const now = new Date();
  const windowStart = new Date(
    Math.floor(now.getTime() / rule.windowMs) * rule.windowMs,
  );
  const resetAt = new Date(windowStart.getTime() + rule.windowMs);

  // Upsert keyed on the window: when `windowStart` moves on, the update resets
  // the counter rather than incrementing a stale one. Doing this in a single
  // statement avoids the read-then-write race two simultaneous logins would hit.
  const record = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key") DO UPDATE
      SET "count" = CASE
            WHEN "RateLimit"."windowStart" < ${windowStart} THEN 1
            ELSE "RateLimit"."count" + 1
          END,
          "windowStart" = GREATEST("RateLimit"."windowStart", ${windowStart})
    RETURNING "count"
  `;

  const count = record[0]?.count ?? 1;

  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetAt,
  };
}

/**
 * Clears a counter. Called after a successful login so that someone who
 * fat-fingered their password four times is not still throttled afterwards.
 */
export async function resetRateLimit(
  scope: keyof typeof RATE_LIMITS,
  identifier: string,
): Promise<void> {
  await prisma.rateLimit.deleteMany({ where: { key: `${scope}:${identifier}` } });
}

/** Housekeeping for the maintenance cron. */
export async function deleteStaleRateLimits(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { count } = await prisma.rateLimit.deleteMany({
    where: { windowStart: { lt: cutoff } },
  });
  return count;
}

/** Human-readable "try again in ..." for the error message. */
export function describeRetryAfter(resetAt: Date, now: Date = new Date()): string {
  const seconds = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
