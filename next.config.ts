import path from "node:path";
import type { NextConfig } from "next";

/**
 * Blob uploads land on a per-store subdomain of blob.vercel-storage.com. Both
 * `next/image` and the editor's image `src` allowlist read from this, so the
 * set of hosts an image may come from is defined exactly once.
 */
export const BLOB_IMAGE_HOSTNAME = "*.public.blob.vercel-storage.com";

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
  "img-src 'self' blob: data: https://*.public.blob.vercel-storage.com",
  "font-src 'self' data:",
  `connect-src 'self' https://*.public.blob.vercel-storage.com${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(import.meta.dirname),
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: BLOB_IMAGE_HOSTNAME }],
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
