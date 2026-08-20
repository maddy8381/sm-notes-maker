import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { readSessionCookie, setSessionCookie } from "@/lib/session-cookie";
import { validateSessionToken, type SessionUser } from "@/server/sessions";

/**
 * The Data Access Layer.
 *
 * Every Server Component, Server Action and Route Handler that needs to know
 * who is asking goes through here — never through the cookie directly, and
 * never by trusting an id passed in from the client.
 *
 * `cache()` deduplicates within a single request: a layout, three nested
 * components and an action can all call requireUser() and only one database
 * round-trip happens.
 */

export type CurrentUser = SessionUser & { sessionId: string };

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = await readSessionCookie();
  if (!token) return null;

  const session = await validateSessionToken(token);
  if (!session) return null;

  // Sliding expiry: push the cookie out to match the row that was just
  // extended. Wrapped because Next forbids setting cookies while rendering a
  // Server Component — in that context the row is still extended and the
  // cookie catches up on the next action or route handler, which is fine.
  if (session.renewedTo) {
    try {
      await setSessionCookie(token, session.renewedTo);
    } catch {
      // Read-only rendering context. Harmless.
    }
  }

  return { ...session.user, sessionId: session.sessionId };
});

/**
 * The gate for every authenticated surface. Redirects rather than throwing,
 * so a signed-out visitor lands on the login page instead of an error screen.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Route-handler variant. Handlers must return a Response rather than redirect,
 * so this reports failure through a null instead.
 */
export async function requireUserForApi(): Promise<CurrentUser | null> {
  return getCurrentUser();
}
