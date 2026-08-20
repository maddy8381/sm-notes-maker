import { NextResponse, type NextRequest } from "next/server";

/**
 * Formerly `middleware.ts` — renamed in Next.js 16.
 *
 * This performs an *optimistic* check only: it looks for the presence of a
 * session cookie and nothing more. It does not validate the session, and it is
 * not the authorization layer.
 *
 * That is deliberate, and the Next.js docs are explicit about it: proxy runs on
 * every request including prefetches, so a database lookup here would mean a
 * query per hovered link. It also runs before the request reaches any route,
 * which makes it the wrong place to reason about what a specific user may see.
 *
 * Real authorization lives in the Data Access Layer (src/lib/dal.ts) and in
 * every function in src/server/. Someone who forges this cookie gets past the
 * redirect and straight into `requireUser()`, which rejects them. All this
 * saves is rendering a page that would have redirected anyway.
 */

const PUBLIC_ROUTES = ["/login", "/signup", "/forgot-password", "/reset-password"];

// Must match src/lib/session-cookie.ts. Both names are checked because the
// __Host- prefix is production-only and this file has no access to the parsed
// env module (proxy runs in a restricted runtime).
const COOKIE_NAMES = ["__Host-tn_session", "tn_session"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasSessionCookie = COOKIE_NAMES.some(
    (name) => request.cookies.get(name)?.value,
  );
  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  if (!hasSessionCookie && !isPublicRoute) {
    const url = new URL("/login", request.url);
    // Preserve where they were headed so login can send them back rather than
    // dumping everyone on the dashboard.
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSessionCookie && isPublicRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Skips API routes (they authenticate themselves and must return JSON, not a
  // redirect), Next internals, and static files.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
