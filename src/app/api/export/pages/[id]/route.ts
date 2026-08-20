import { NextResponse } from "next/server";

import { requireUserForApi } from "@/lib/dal";
import { buildPagePdf } from "@/server/export/pdf";
import { pdfResponse } from "@/server/export/response";
import { checkRateLimit } from "@/server/rate-limit";

/**
 * Downloads one note as a PDF.
 *
 * A Route Handler rather than a Server Action because the response is a file:
 * actions return serialized values through the router, and getting bytes out
 * of one means round-tripping them through a base64 payload for no reason.
 *
 * Rendering is CPU-bound and reads the whole document, so it is rate limited
 * like any other expensive endpoint.
 */
export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await checkRateLimit("export", user.id);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many exports. Try again shortly." },
      { status: 429 },
    );
  }

  const { id } = await params;

  try {
    // Scoped to the session's user: another account's page id reads as
    // missing, so the endpoint cannot be used to probe what exists.
    const result = await buildPagePdf(user.id, id);
    if (!result) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    return pdfResponse(result);
  } catch (error) {
    console.error("[export:page]", error);
    return NextResponse.json({ error: "Could not build the PDF" }, { status: 500 });
  }
}
