import { NextResponse } from "next/server";

import { requireUserForApi } from "@/lib/dal";
import { buildTechnologyPdf } from "@/server/export/pdf";
import { pdfResponse } from "@/server/export/response";
import { checkRateLimit } from "@/server/rate-limit";

/**
 * Downloads a whole technology as one bound PDF: cover page, table of
 * contents, then every note in the order the user arranged them.
 *
 * Costlier than the single-page export — it reads every document in the
 * collection and may embed a lot of images — hence the longer duration budget
 * and the same rate limit bucket.
 */
export const maxDuration = 120;

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
    const result = await buildTechnologyPdf(user.id, id);
    if (!result) {
      return NextResponse.json({ error: "Technology not found" }, { status: 404 });
    }

    return pdfResponse(result);
  } catch (error) {
    console.error("[export:technology]", error);
    return NextResponse.json({ error: "Could not build the PDF" }, { status: 500 });
  }
}
