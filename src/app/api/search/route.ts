import { NextResponse, type NextRequest } from "next/server";

import { requireUserForApi } from "@/lib/dal";
import { searchEverything } from "@/server/search";

/**
 * Live search for the command palette.
 *
 * A Route Handler rather than a Server Action because this is a read that
 * fires on every keystroke: actions are POSTs that participate in the router
 * cache and revalidation machinery, none of which is wanted here.
 *
 * Authorization is not optional just because this is a GET — `searchEverything`
 * is scoped to the authenticated user's id, never to anything from the query
 * string.
 */
export async function GET(request: NextRequest) {
  const user = await requireUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query || query.length < 2) {
    return NextResponse.json({ technologies: [], pages: [], tags: [] });
  }

  const results = await searchEverything(user.id, query.slice(0, 200));

  return NextResponse.json(results, {
    headers: {
      // Personal results must never land in a shared or CDN cache.
      "Cache-Control": "private, no-store",
    },
  });
}
