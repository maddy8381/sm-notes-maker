import { z } from "zod";

/**
 * Server-side environment. Parsed once, at first import, so a missing or
 * malformed variable fails loudly at boot rather than as a confusing runtime
 * error three screens into the app.
 *
 * Nothing here is safe to import from a Client Component. The only value the
 * browser needs is NEXT_PUBLIC_APP_URL, which Next inlines at build time.
 */
/**
 * Treats an empty string as absent.
 *
 * `.env` files conventionally carry unset keys as `KEY=""` — .env.example
 * ships several that way. Without this, an untouched placeholder fails a
 * `.min(32)` check instead of falling through to the optional branch, which
 * produces a confusing "too small" error for a variable the user never set.
 */
const optionalString = (schema: z.ZodString) =>
  z
    .string()
    .optional()
    .transform((value) => (value === "" ? undefined : value))
    .pipe(schema.optional());

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: optionalString(z.string().min(1)),

  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),

  // Long enough that a brute force is not the weak link. Only enforced in
  // production so that `npm run dev` works the moment you clone the repo.
  AUTH_SECRET: optionalString(
    z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  ),

  // Optional: image upload degrades gracefully when absent, so a contributor
  // without a Blob store can still run everything else.
  BLOB_READ_WRITE_TOKEN: optionalString(z.string().min(1)),

  CRON_SECRET: optionalString(z.string().min(1)),
});

function loadEnv() {
  const parsed = serverSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        "Copy .env.example to .env.local and fill in the missing values.",
    );
  }

  const env = parsed.data;

  // `next build` evaluates these modules to collect route metadata, and that
  // happens in CI where production secrets legitimately are not present. The
  // checks below are about how the app *runs*, so they are skipped during the
  // build phase — the same assertions still fire on the first request if a
  // deployment is missing them, which is where they actually matter.
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

  if (env.NODE_ENV === "production" && !isBuildPhase) {
    if (!env.AUTH_SECRET) {
      throw new Error(
        "AUTH_SECRET must be set in production. Generate one with: openssl rand -base64 48",
      );
    }
    // Plain http is only tolerated on loopback, where a production build is
    // being exercised locally (the E2E suite does exactly this). Anywhere else
    // it means session cookies would be marked Secure and then never sent,
    // which presents as "login silently does nothing".
    if (
      env.NEXT_PUBLIC_APP_URL.startsWith("http://") &&
      !isLoopback(env.NEXT_PUBLIC_APP_URL)
    ) {
      throw new Error(
        "NEXT_PUBLIC_APP_URL must use https in production — session cookies are Secure-only and will not be sent over http.",
      );
    }
  }

  return env;
}

function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";

/**
 * Whether this deployment is actually reached over https.
 *
 * Session cookie flags key off this rather than off NODE_ENV. The two usually
 * agree, but not always: a production build served over http on loopback — the
 * E2E suite, or a quick local check of a real build — would otherwise set
 * `Secure` cookies that the browser refuses to send back, and sign-in would
 * appear to do nothing at all.
 */
export const isSecureOrigin = env.NEXT_PUBLIC_APP_URL.startsWith("https://");

/**
 * Deterministic dev fallback so a fresh clone runs without any setup. Never
 * reachable in production — loadEnv() throws above if AUTH_SECRET is missing.
 */
export const authSecret =
  env.AUTH_SECRET ?? "dev-only-insecure-secret-do-not-use-in-production-000000";
