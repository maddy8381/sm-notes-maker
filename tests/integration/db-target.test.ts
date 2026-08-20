import { afterAll, describe, expect, it } from "vitest";

import { disconnect, hasTestDatabase, prisma } from "../helpers/db";

/**
 * Guards the guard.
 *
 * The integration suite truncates tables. If the modules under test resolve a
 * different database than the helpers do, the suite quietly destroys whatever
 * that other database holds — which is exactly what happened once during
 * development: `?schema=` is a Prisma *CLI* parameter, node-postgres ignores
 * it, so migrations went to the test schema while every runtime query stayed
 * on `public`. The suite wiped the development seed and reported success.
 *
 * The check is behavioural rather than introspective: `current_schema()` is
 * not the right probe, because Prisma's adapter qualifies table names in the
 * SQL it generates instead of changing the session's search_path. What matters
 * is only this — can a write made through the application's own client be seen
 * by the helper that does the truncating?
 */
const describeIfDb = hasTestDatabase ? describe : describe.skip;

describeIfDb("test database targeting", () => {
  afterAll(async () => {
    await disconnect();
  });

  it("rewrites DATABASE_URL to the test database before anything is imported", () => {
    // src/lib/prisma.ts reads DATABASE_URL at module load, so tests/setup.ts
    // must have rewritten it first.
    expect(process.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL);
    expect(process.env.DIRECT_URL).toBe(process.env.TEST_DATABASE_URL);
  });

  it("uses a database whose name marks it as disposable", () => {
    // Isolation is by *database*, not by schema. A schema looks equivalent and
    // is not: Prisma's `?schema=` is honoured by the CLI but ignored by the
    // driver adapter, so migrations and queries end up in different places.
    const name = new URL(process.env.TEST_DATABASE_URL!).pathname.replace("/", "");

    expect(name).toMatch(/test/);
    expect(name).not.toBe("neondb");
  });

  it("writes through the app client where the helpers can see and clean it up", async () => {
    const { prisma: appPrisma } = await import("@/lib/prisma");

    const email = `db-target-${Date.now()}@test.local`;
    const created = await appPrisma.user.create({
      data: { name: "Target Probe", email, passwordHash: "x" },
      select: { id: true },
    });

    try {
      // If these two clients disagreed about the database, this would be null
      // and the truncate in resetDatabase() would be aimed somewhere else.
      const seen = await prisma.user.findUnique({
        where: { id: created.id },
        select: { id: true },
      });

      expect(
        seen,
        "the app client and the test helpers are writing to different databases",
      ).not.toBeNull();
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});
