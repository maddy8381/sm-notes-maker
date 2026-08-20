import { upload } from "@vercel/blob/client";

import { imageSrcForPathname } from "@/lib/editor/image-src";

/**
 * Uploads an image straight from the browser to Blob storage.
 *
 * The token comes from /api/upload, which authenticates the request before
 * issuing one. The bytes go directly to Blob and never pass through a
 * serverless function, which sidesteps the 4.5 MB request body limit — a limit
 * an ordinary retina screenshot can exceed.
 *
 * The upload is private. What comes back is therefore a pathname rather than a
 * usable URL — the store answers 403 to a browser — so this returns the app
 * path that /api/images serves, and that is what goes into the document.
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
];

export type UploadResult =
  | { ok: true; src: string; width: number | null; height: number | null }
  | { ok: false; error: string };

export function isAcceptedImage(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.includes(file.type);
}

export async function uploadImage(file: File): Promise<UploadResult> {
  if (!isAcceptedImage(file)) {
    return {
      ok: false,
      error: `${file.type || "That file"} is not a supported image. Use PNG, JPEG, GIF, WebP or AVIF.`,
    };
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`,
    };
  }

  try {
    // Dimensions are read here rather than server-side: the browser already
    // has to decode the image to show it, so this is free, and the server
    // would otherwise need an image library to find out.
    const dimensions = await readDimensions(file).catch(() => null);

    const blob = await upload(file.name, file, {
      access: "private",
      handleUploadUrl: "/api/upload",
    });

    // Awaited, and its failure is the upload's failure.
    //
    // This used to be fire-and-forget, which was defensible when the row was
    // only bookkeeping for the cleanup job. It is not any more: with a private
    // store the row is what authorizes reads, so returning a src before it
    // exists is a race against the browser's own <img> request. Losing that
    // race gives a 404 the browser never retries — an image broken until the
    // page is reloaded, while the same note exports to PDF perfectly, because
    // by then the row has landed.
    //
    // Vercel's onUploadCompleted webhook writes the same row in production and
    // cannot reach localhost, which is why this path exists at all; the server
    // upserts, so both arriving cannot duplicate.
    const recorded = await fetch("/api/upload/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: blob.url,
        pathname: blob.pathname,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
      }),
    }).catch(() => null);

    if (!recorded?.ok) {
      // The bytes are in storage but nothing can serve them. Better to say so
      // and drop the placeholder than to leave a broken image in the note.
      return {
        ok: false,
        error: "The image uploaded but could not be attached to this note.",
      };
    }

    return {
      ok: true,
      src: imageSrcForPathname(blob.pathname),
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";

    // The most common real-world failure is a missing BLOB_READ_WRITE_TOKEN,
    // which surfaces as an opaque 503. Say what to do about it.
    if (message.includes("503") || message.includes("not configured")) {
      return {
        ok: false,
        error: "Image upload is not configured on this deployment.",
      };
    }

    // The browser posts the file to Vercel's API, and that API answers errors
    // without CORS headers — so a rejected upload (a private Blob store, an
    // expired token) reaches this catch as a bare "Failed to fetch" with the
    // real reason unreadable from script. Anything more specific has to come
    // from the server logs, so say where to look instead of showing a message
    // that sounds like a network blip.
    if (/failed to fetch|load failed|networkerror/i.test(message)) {
      return {
        ok: false,
        error:
          "Upload was rejected by Blob storage. Check that the store is public and its token is current.",
      };
    }

    return { ok: false, error: message };
  }
}

function readDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };

    image.src = url;
  });
}
