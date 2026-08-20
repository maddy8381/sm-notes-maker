import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Database handle for the integration suite.
 *
 * Deliberately constructed here rather than imported from src/lib/prisma.ts:
 * these tests truncate tables, and going through the app's singleton would
 * make it possible to point that destruction at whatever DATABASE_URL happened
 * to be set.
 */

const url = process.env.TEST_DATABASE_URL;

export const hasTestDatabase = Boolean(url);

function schemaOf(connectionString: string): string | undefined {
  try {
    const value = new URL(connectionString).searchParams.get("schema");
    return value && value !== "public" ? value : undefined;
  } catch {
    return undefined;
  }
}

// The schema has to be passed to the adapter explicitly — node-postgres
// ignores Prismas ?schema= parameter, so without this the helpers would
// truncate public while believing they were in the test schema.
export const prisma = url
  ? new PrismaClient({
      adapter: new PrismaPg({
        connectionString: url,
        ...(schemaOf(url) ? { schema: schemaOf(url)! } : {}),
      }),
    })
  : (null as unknown as PrismaClient);

/**
 * Empties every table.
 *
 * CASCADE plus RESTART IDENTITY in one statement, so foreign keys do not
 * dictate the order and each test file starts from the same state.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "PageView", "PageTag", "Attachment", "Page", "Tag",
      "Technology", "Session", "PasswordReset", "RateLimit", "User"
    RESTART IDENTITY CASCADE
  `);
}

export async function disconnect(): Promise<void> {
  if (prisma) await prisma.$disconnect();
}

let counter = 0;

/** A user with a unique email, so parallel files cannot collide. */
export async function createTestUser(name = "Test User") {
  counter++;
  return prisma.user.create({
    data: {
      name,
      email: `user-${Date.now()}-${counter}@test.local`,
      // Not a real hash. Tests that exercise login create their users through
      // the sign-up action instead.
      passwordHash: "not-a-real-hash",
    },
    select: { id: true, name: true, email: true },
  });
}

export async function createTestTechnology(userId: string, name = "React") {
  counter++;
  return prisma.technology.create({
    data: { userId, name, slug: `${name.toLowerCase()}-${counter}`, position: 1024 },
    select: { id: true, name: true, slug: true },
  });
}

export async function createTestPage(
  userId: string,
  technologyId: string,
  title = "A page",
) {
  counter++;
  return prisma.page.create({
    data: {
      userId,
      technologyId,
      title,
      slug: `page-${counter}`,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "secret content" }] },
        ],
      },
      contentText: "secret content",
      position: 1024,
    },
    select: { id: true, title: true, slug: true, revision: true },
  });
}
