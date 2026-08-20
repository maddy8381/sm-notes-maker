import "server-only";

import { cookies } from "next/headers";

import { isSecureOrigin } from "@/lib/env";

/**
 * The `__Host-` prefix is a browser-enforced guarantee: a cookie carrying it
 * must be Secure, path=/, and have no Domain attribute, which means a
 * subdomain cannot overwrite it. That closes off session fixation via a
 * sibling host.
 *
 * Both the prefix and the `Secure` flag key off whether the app is actually
 * reached over https — not off NODE_ENV. A production build served over
 * http on loopback (the E2E suite, or checking a real build locally) would
 * otherwise set cookies the browser then refuses to send back, and sign-in
 * would appear to do nothing at all.
 */
export const SESSION_COOKIE_NAME = isSecureOrigin ? "__Host-tn_session" : "tn_session";

export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecureOrigin,
    // Lax, not Strict: Strict would mean following a link from your email
    // client into the app lands you on a logged-out page. Lax still blocks
    // cross-site POSTs, which is the attack that matters here.
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: isSecureOrigin,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
