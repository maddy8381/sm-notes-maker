import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { deleteOrphanedAttachments } from "@/server/attachments";
import { deleteStaleRateLimits } from "@/server/rate-limit";
import { deleteExpiredSessions } from "@/server/sessions";
import { deleteExpiredResetTokens } from "@/server/users";

/**
 * Nightly housekeeping.
 *
 * Everything here is data the app creates as a side effect and never reads
 * again: expired sessions, spent reset tokens, rate-limit counters from
 * yesterday, and blobs whose image was deleted from the note that referenced
 * it. None of it is urgent, all of it grows without bound.
 *
 * Scheduled from vercel.json. Protected by CRON_SECRET — the endpoint deletes
 * things, so it must not be callable by anyone who finds the URL.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }

  // Vercel Cron sends the secret as a bearer token.
  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();

  // Run sequentially rather than in parallel: this is a background job with no
  // one waiting, and a burst of concurrent connections would compete with real
  // traffic for the pool.
  const sessions = await deleteExpiredSessions();
  const resetTokens = await deleteExpiredResetTokens();
  const rateLimits = await deleteStaleRateLimits();
  const attachments = await deleteOrphanedAttachments();

  const result = {
    sessions,
    resetTokens,
    rateLimits,
    attachments: attachments.deleted,
    attachmentsExamined: attachments.examined,
    ms: Date.now() - started,
  };

  console.warn("[cron:maintenance]", JSON.stringify(result));

  return NextResponse.json(result);
}
