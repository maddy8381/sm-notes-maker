/**
 * Guards the integration suite against pointing at a real database.
 *
 * These tests truncate every table between files. Running them against a
 * database holding actual notes would destroy them, so the URL has to be
 * chosen deliberately: TEST_DATABASE_URL, or nothing.
 */
const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl) {
  process.env.DATABASE_URL = testUrl;
  process.env.DIRECT_URL = testUrl;
}

// Deterministic values so tests do not depend on a developer's .env.local.
// NODE_ENV is typed as readonly by @types/node; Vitest already sets it to
// "test", so this only needs to survive the type checker.
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long-000000";

export {};
