import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireUserForApi } from "@/lib/dal";
import { recordAttachment } from "@/server/attachments";

/**
 * Records an upload that the client has just completed.
 *
 * Exists because Vercel's onUploadCompleted webhook cannot call back to
 * localhost, so in development the attachment row would otherwise never be
 * written and the orphan-cleanup job would have nothing to reason about.
 *
 * In production both paths run; `recordAttachment` upserts on `pathname`, so
 * whichever arrives second fills in what the first could not know rather than
 * creating a duplicate.
 *
 * The user id comes from the session. A caller can lie about the pathname, but
 * only ever to claim a blob for their own account, which is where it was going
 * to land anyway.
 */
const schema = z.object({
  url: z.url(),
  pathname: z.string().min(1).max(500),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  size: z
    .number()
    .int()
    .min(0)
    .max(50 * 1024 * 1024),
  width: z.number().int().positive().max(20000).nullable(),
  height: z.number().int().positive().max(20000).nullable(),
});

export async function POST(request: NextRequest) {
  const user = await requireUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Only accept URLs on our own blob host. Without this the table could be
  // filled with references to arbitrary external images — and since this table
  // is what authorizes reads through /api/images, a row pointing anywhere else
  // would be worse than useless.
  const host = new URL(parsed.data.url).hostname;
  if (!host.endsWith(".blob.vercel-storage.com")) {
    return NextResponse.json({ error: "Unexpected upload host" }, { status: 400 });
  }

  await recordAttachment(user.id, {
    url: parsed.data.url,
    pathname: parsed.data.pathname,
    filename: parsed.data.filename,
    mimeType: parsed.data.mimeType,
    size: parsed.data.size,
    ...(parsed.data.width ? { width: parsed.data.width } : {}),
    ...(parsed.data.height ? { height: parsed.data.height } : {}),
  });

  return NextResponse.json({ ok: true });
}
