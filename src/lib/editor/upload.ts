import { upload } from "@vercel/blob/client";

/**
 * Uploads an image straight from the browser to Blob storage.
 *
 * The token comes from /api/upload, which authenticates the request before
 * issuing one. The bytes go directly to Blob and never pass through a
 * serverless function, which sidesteps the 4.5 MB request body limit — a limit
 * an ordinary retina screenshot can exceed.
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
  | { ok: true; url: string; width: number | null; height: number | null }
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
      access: "public",
      handleUploadUrl: "/api/upload",
    });

    // Vercel's onUploadCompleted webhook cannot reach localhost, so the
    // attachment row would never be written in development. Recording it from
    // here as well covers that; the server upserts, so the two paths cannot
    // produce duplicates.
    void fetch("/api/upload/record", {
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
    }).catch(() => undefined);

    return {
      ok: true,
      url: blob.url,
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
