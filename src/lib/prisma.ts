import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * The Prisma client.
 *
 * Nothing outside src/server/ may import this — an ESLint rule enforces it.
 * See the comment on that rule in eslint.config.mjs for why: every query in
 * this app must be scoped to the signed-in user, and the only way to keep that
 * true as the codebase grows is to funnel all database access through
 * functions that take `userId` as a required argument.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/** Reads Prisma's `?schema=` parameter out of a connection string. */
function readSchemaParam(connectionString: string): string | undefined {
  try {
    const value = new URL(connectionString).searchParams.get("schema");
    return value && value !== "public" ? value : undefined;
  } catch {
    return undefined;
  }
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  // Runtime traffic goes through Neon's pooler. Migrations use DIRECT_URL
  // instead — see prisma.config.ts.
  //
  // The pool is deliberately small. Each serverless instance keeps its own,
  // and Neon's pooler has a finite ceiling shared across all of them, so a
  // large per-instance pool starves other instances rather than making any
  // one faster. Ten is comfortable for this workload — the heaviest page
  // issues four parallel reads.
  // `?schema=` in the URL is a Prisma *CLI* parameter. The driver adapter
  // hands the connection string to node-postgres, which does not understand
  // it, so runtime queries silently stay on `public` while migrations go to
  // the named schema. That mismatch is invisible until something writes to the
  // wrong place — during development it let the integration suite truncate the
  // dev database. Parsing it out and passing it to the adapter explicitly is
  // what actually moves the queries.
  const schema = readSchemaParam(connectionString);

  const adapter = new PrismaPg({
    connectionString,
    ...(schema ? { schema } : {}),
    max: 10,
    // Neon closes idle connections at the edge anyway; releasing them sooner
    // avoids handing out a socket the far end has already dropped.
    idleTimeoutMillis: 30_000,
    // Fail fast rather than hanging a request for the default 30 seconds when
    // the pool really is exhausted.
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? [
            { level: "warn", emit: "stdout" },
            { level: "error", emit: "stdout" },
          ]
        : [{ level: "error", emit: "stdout" }],
  });
}

// Reused across hot reloads in dev, which otherwise exhausts the connection
// pool within a few edits.
export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
