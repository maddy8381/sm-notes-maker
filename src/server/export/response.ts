import "server-only";

import type { PdfExport } from "@/server/export/pdf";

/**
 * Turns rendered bytes into a download.
 *
 * `attachment` is what makes the browser save the file instead of opening it
 * in the built-in viewer, and the filename is what the user ends up with on
 * disk — both matter more here than any header tuning.
 */
export function pdfResponse({ filename, bytes }: PdfExport): Response {
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.byteLength),
      // `filename*` carries the UTF-8 form for clients that understand it;
      // the plain `filename` is the ASCII fallback.
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(
        filename,
      )}`,
      // Someone's private notes must never sit in a shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}
