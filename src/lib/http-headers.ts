/**
 * Header values built from stored user input.
 *
 * HTTP header values are ByteStrings: every character has to fit in a byte.
 * Node throws when constructing a `Response` with anything above U+00FF, and
 * that throw happens *after* the handler's own error handling, so it surfaces
 * as a bare 500 with no clue as to which header caused it.
 *
 * This is not hypothetical. macOS names screenshots with U+202F (a narrow
 * no-break space) before "AM"/"PM" — "Screenshot 2026-07-13 at 2.18.51 PM.png"
 * looks like plain ASCII, uploads fine, and then every request for it fails
 * with a 500 the moment the filename reaches Content-Disposition.
 */

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

/**
 * `inline` disposition carrying both forms of the filename: an ASCII-safe
 * fallback in the quoted parameter, and the real name in `filename*` for
 * clients that read RFC 5987.
 */
export function inlineDisposition(filename: string): string {
  const ascii =
    filename
      // Anything outside printable ASCII becomes a space, so a narrow no-break
      // space still reads as a space rather than vanishing.
      .replace(/[^\x20-\x7e]/g, " ")
      // Quotes and backslashes would end the quoted string early.
      .replace(/["\\]/g, "")
      .trim()
      .slice(0, 200) || "image";

  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * The Content-Type an upload may be served back as.
 *
 * The upload route allowlists what may be *written*, but the attachment row's
 * mime type arrives from the client, and serving arbitrary types from our own
 * origin is how an "image" becomes stored HTML. Anything unrecognised is
 * served as a generic download instead.
 */
export function safeImageContentType(value: string | null | undefined): string {
  const type = value?.split(";")[0]?.trim().toLowerCase();
  return type && ACCEPTED_IMAGE_TYPES.has(type) ? type : "application/octet-stream";
}
