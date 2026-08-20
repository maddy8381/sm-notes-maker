import { NextResponse } from "next/server";

import { requireUserForApi } from "@/lib/dal";
import { pathnameFromImageSrc, IMAGE_ROUTE_PREFIX } from "@/lib/editor/image-src";
import { inlineDisposition, safeImageContentType } from "@/lib/http-headers";
import { readAttachmentBytes } from "@/server/attachments";

/**
 * Serves an uploaded image.
 *
 * Blobs live in a private store: their storage URLs answer 403 to a browser,
 * and the only way to the bytes is through here. That is the point — an image
 * is now scoped to its owner exactly like every other row in this app, rather
 * than being readable forever by anyone who once saw the link.
 *
 * Ownership is checked against the `Attachment` table, not inferred from the
 * pathname. Without that check this route would be a public CDN with extra
 * steps: any signed-in account could read any other account's screenshots by
 * guessing a path.
 */
export const maxDuration = 30;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pathname: string[] }> },
) {
  const user = await requireUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { pathname: segments } = await params;

  // Re-parsed through the same helper the write path uses, so what is served
  // can only ever be something that could have been stored.
  const pathname = pathnameFromImageSrc(
    `${IMAGE_ROUTE_PREFIX}${segments.map(encodeURIComponent).join("/")}`,
  );

  if (!pathname) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await readAttachmentBytes(user.id, pathname);

  // Deliberately the same answer for "no such blob" and "not yours": the
  // difference would tell a caller which paths exist.
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new Response(result.stream, {
    headers: {
      // Both of these are built from stored user input, so both go through
      // lib/http-headers.ts — a filename or mime type carrying one character
      // above U+00FF makes this constructor throw, and the request 500s with
      // nothing to say why.
      "Content-Type": safeImageContentType(result.contentType),
      ...(result.size ? { "Content-Length": String(result.size) } : {}),
      // Private, because this response is one user's image and the CDN sits in
      // front of it. Immutable is safe: uploads carry a random suffix, so a
      // pathname's bytes never change.
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Disposition": inlineDisposition(result.filename),
      // The bytes are user-supplied. Nothing should sniff them into something
      // executable.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
