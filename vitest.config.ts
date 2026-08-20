import path from "node:path";
import { defineConfig } from "vitest/config";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: false, quiet: true });
loadEnv({ path: ".env", override: false, quiet: true });

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Default is node. Files needing a DOM opt in with a
    // `@vitest-environment jsdom` docblock — Vitest 4 removed
    // environmentMatchGlobs, and the per-file directive keeps the requirement
    // visible in the file that has it.
    // Integration tests share one database and truncate between files. Running
    // files in parallel would have them deleting each other's fixtures.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // The `server-only` package exists to throw when imported outside a
      // Server Component, which is exactly what happens under Vitest. Stubbing
      // it lets the server modules be tested directly — the guarantee it
      // provides is a build-time one that `next build` still enforces.
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
});
