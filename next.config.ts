import path from "node:path";
import type { NextConfig } from "next";

/**
 * Where a client upload actually goes.
 *
 * `@vercel/blob`'s browser client does not PUT to the store subdomain — it
 * POSTs the file to Vercel's own API at https://vercel.com/api/blob and gets
 * redirected on to the storage host. Leaving vercel.com out of connect-src
 * means every upload is blocked by our own CSP, the editor keeps its optimistic
 * `blob:` placeholder, and the note is saved with an image node the allowlist
 * then strips — an image that silently disappears on reload.
 */
const BLOB_UPLOAD_ORIGINS = [
  "https://vercel.com",
  // Multipart uploads for larger files address the store host directly.
  "https://*.blob.vercel-storage.com",
].join(" ");

const isDev = process.env.NODE_ENV !== "production";

/**
 * Locked down by default. Note `'unsafe-inline'` on styles: Tailwind and the
 * editor's inline colour/highlight marks both need it, and it is far less
 * dangerous than script-src equivalents. Dev additionally needs 'unsafe-eval'
 * for React Refresh, which is why the policy is environment-dependent.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // No storage host: blobs are private, so every image is served by this app
  // from /api/images. `blob:` stays for the editor's optimistic preview while
  // an upload is still in flight.
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  `connect-src 'self' ${BLOB_UPLOAD_ORIGINS}${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(import.meta.dirname),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
