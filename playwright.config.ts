import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: false, quiet: true });

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

  // The default 30s is not enough here. A single flow signs up (argon2 plus
  // seeding starter content), creates a technology and a page, types, waits
  // out an 800 ms autosave debounce and reloads — every step a round trip to a
  // hosted database. The old limit made slow-but-working runs look like
  // failures.
  timeout: 120_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // Runs against a production build. The dev server's on-demand compilation
    // makes the first hit to each route take seconds, which turns every
    // timeout into a question of whether the app is broken or merely cold.
    //
    // The build is a separate step (see the `test:e2e` script) rather than part
    // of this command: folding it in means Playwright's readiness check races a
    // multi-second build, and repeat runs pay for a rebuild they do not need.
    command: `npx next start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Surfaced so a server-side failure shows up in the test output instead of
    // presenting as an unexplained timeout on the sign-up form.
    stdout: "pipe",
    stderr: "pipe",
    env: {
      // Spread explicitly: this object *replaces* the child environment rather
      // than extending it, so omitting process.env strips PATH, HOME and
      // everything else the server needs.
      ...(process.env as Record<string, string>),

      // The suite signs up real accounts and truncates tables, so it must not
      // reach the database holding real notes.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      DIRECT_URL: process.env.TEST_DATABASE_URL ?? "",
      NEXT_PUBLIC_APP_URL: baseURL,
      // `||`, not `??`: .env.example ships AUTH_SECRET="" and an empty string
      // is not nullish, so `??` passes it straight through and the server
      // refuses to boot in production mode.
      AUTH_SECRET:
        process.env.AUTH_SECRET || "e2e-secret-at-least-32-characters-long-0000",
    },
  },
});
