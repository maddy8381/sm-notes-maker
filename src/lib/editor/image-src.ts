/**
 * How an uploaded image is addressed inside a document.
 *
 * Blobs live in a **private** store, so they have no URL a browser can load.
 * What goes in the document is an app-relative path — `/api/images/<pathname>`
 * — which the route of the same name serves after checking the session owns
 * that blob. The consequence worth stating plainly: an image is exactly as
 * private as the note holding it, which is the same guarantee every other row
 * in this app already has.
 *
 * Storing the pathname rather than a signed URL is deliberate. A signed URL
 * expires, and a document is not a cache — an expiring string written into a
 * note would rot in place.
 *
 * Client and server both import this, so it must stay free of `server-only`
 * and of any Node built-in.
 */

export const IMAGE_ROUTE_PREFIX = "/api/images/";

/** Blob pathnames are `a/b/c.png`; each segment is encoded, the slashes are not. */
export function imageSrcForPathname(pathname: string): string {
  const encoded = pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${IMAGE_ROUTE_PREFIX}${encoded}`;
}

/**
 * The inverse. Returns null for anything that is not one of our image paths —
 * which is what makes this usable as the allowlist check on the write path.
 *
 * Rejects `..` outright. The route reads the pathname straight from the URL
 * and hands it to the Blob SDK, so traversal is refused here rather than
 * relied upon to be meaningless there.
 */
export function pathnameFromImageSrc(src: string): string | null {
  if (typeof src !== "string" || !src.startsWith(IMAGE_ROUTE_PREFIX)) return null;

  // A query string or fragment would survive into the stored src and make two
  // references to one blob look different to the cleanup job.
  const path = src.slice(IMAGE_ROUTE_PREFIX.length);
  if (!path || /[?#]/.test(path)) return null;

  let decoded: string;
  try {
    decoded = path
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }

  if (!decoded || decoded.length > 500) return null;
  if (decoded.includes("..") || decoded.startsWith("/")) return null;
  // Control characters would be dropped or reinterpreted by whatever consumes
  // the pathname next; refuse rather than normalize.
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return null;

  return decoded;
}
