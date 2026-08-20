import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { requireUserForApi } from "@/lib/dal";
import { recordAttachment } from "@/server/attachments";
import { checkRateLimit } from "@/server/rate-limit";

/**
 * Issues short-lived tokens for direct browser-to-Blob uploads.
 *
 * The file never passes through this function. That is the point: a Server
 * Action body is capped at 4.5 MB on Vercel, and streaming a screenshot
 * through a serverless function costs execution time for no benefit. Instead
 * the browser asks here for permission, uploads straight to Blob storage, and
 * Blob calls back on completion.
 *
 * Authorization happens when the token is minted — an unauthenticated caller
 * never gets one, so there is no way to write into the store.
 */
export const maxDuration = 30;

const MAX_SIZE = 10 * 1024 * 1024;

const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  // Deliberately excluded: image/svg+xml. An SVG is a document that can carry
  // <script>, and it would be served from our own blob host — same-origin
  // enough to matter.
];

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await requireUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Image upload is not configured. Set BLOB_READ_WRITE_TOKEN to enable it.",
      },
      { status: 503 },
    );
  }

  const limit = await checkRateLimit("upload", user.id);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many uploads. Try again shortly." },
      { status: 429 },
    );
  }

  const body = (await request.json()) as HandleUploadBody;

  // Vercel has to be able to reach the callback, so only an https origin is
  // worth handing it.
  const callbackUrl = env.NEXT_PUBLIC_APP_URL.startsWith("https://")
    ? `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/upload`
    : undefined;

  try {
    const result = await handleUpload({
      body,
      request,

      onBeforeGenerateToken: async (pathname) => {
        return {
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: MAX_SIZE,
          // Blob appends a random suffix, so two people uploading
          // "screenshot.png" cannot collide or overwrite each other. It also
          // makes a pathname unguessable, which matters because the pathname
          // is what a document stores.
          addRandomSuffix: true,
          // Stated rather than inferred. Vercel can work it out from the
          // request when deployed, but on localhost it cannot and warns on
          // every single upload; passing null there says "no webhook" plainly.
          // Development does not need one — the browser records the attachment
          // itself, see uploadImage in lib/editor/upload.ts.
          ...(callbackUrl ? { callbackUrl } : {}),
          // Echoed back to onUploadCompleted. The user id comes from the
          // session here, never from the client payload — otherwise a caller
          // could attribute their upload to somebody else's account.
          tokenPayload: JSON.stringify({ userId: user.id, pathname }),
        };
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Vercel calls this from its own infrastructure once the upload lands.
        // It does not run at all on localhost, which is why the client also
        // records the attachment — see uploadImage in lib/editor/upload.ts.
        if (!tokenPayload) return;

        const { userId } = JSON.parse(tokenPayload) as { userId: string };

        await recordAttachment(userId, {
          url: blob.url,
          pathname: blob.pathname,
          filename: blob.pathname.split("/").pop() ?? "image",
          mimeType: blob.contentType ?? "application/octet-stream",
          size: 0,
        });
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[upload]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 },
    );
  }
}
