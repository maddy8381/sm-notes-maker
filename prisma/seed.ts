import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: false, quiet: true });
loadEnv({ path: ".env", override: false, quiet: true });

import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client.ts";

/**
 * Seeds a demo account with enough real-looking content to exercise search,
 * tags, favourites and the editor.
 *
 * Idempotent: re-running replaces the demo user's data rather than
 * accumulating duplicates. It never touches any other account, so it is safe
 * to run against a database that already has real notes in it.
 */

const DEMO_EMAIL = "demo@sm-notes-maker.local";
const DEMO_PASSWORD = "demo-password-1234";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// --- document helpers ------------------------------------------------------

type Node = Record<string, unknown>;

const text = (value: string, marks?: Node[]) =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };

const p = (...content: Node[]) => ({ type: "paragraph", content });
const h = (level: number, value: string) => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
const code = (language: string, value: string) => ({
  type: "codeBlock",
  attrs: { language },
  content: [text(value)],
});
const ul = (...items: string[]) => ({
  type: "bulletList",
  content: items.map((item) => ({ type: "listItem", content: [p(text(item))] })),
});
const doc = (...content: Node[]) => ({ type: "doc", content });

const bold = [{ type: "bold" }];
const inline = [{ type: "code" }];

/**
 * Plain text for the search index. Mirrors extractText in
 * src/lib/editor/content.ts closely enough for seed data; the app itself
 * always uses the real implementation on save.
 */
function flatten(node: unknown): string {
  const parts: string[] = [];

  const walk = (current: unknown): void => {
    if (!current || typeof current !== "object") return;
    const n = current as { type?: string; text?: string; content?: unknown[] };

    if (n.type === "text" && typeof n.text === "string") {
      parts.push(n.text);
      return;
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
    if (n.type && n.type !== "text") parts.push("\n");
  };

  walk(node);
  return parts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// --- content ---------------------------------------------------------------

const TECHNOLOGIES = [
  {
    name: "Next.js",
    icon: "Layers",
    description: "App Router, server components, caching, deployment",
    isFavorite: true,
    pages: [
      {
        title: "Server Components",
        tags: ["frontend", "architecture"],
        content: doc(
          p(
            text(
              "Server Components render on the server and never ship their code to the browser. The mental model that finally made this click: ",
            ),
            text("the component tree is split, not the app", bold),
            text("."),
          ),
          h(2, "What they can do"),
          ul(
            "Read from the database directly — no API layer in between",
            "Use secrets, because the code never reaches the client",
            "Await data inline instead of coordinating loading state",
          ),
          h(2, "What they cannot do"),
          ul(
            "useState, useEffect, or any other hook",
            "Event handlers — onClick and friends need a Client Component",
            "Browser APIs",
          ),
          h(2, "The boundary"),
          p(
            text(
              'Marking a file "use client" does not make one component a Client Component — it marks the ',
            ),
            text("entry point", bold),
            text(
              " of a client subtree. Everything imported from there is bundled too.",
            ),
          ),
          code(
            "typescript",
            `// Server Component — the default\nexport default async function Page() {\n  const notes = await db.note.findMany();\n  return <NoteList notes={notes} />;\n}`,
          ),
        ),
      },
      {
        title: "Caching",
        tags: ["performance", "architecture"],
        content: doc(
          p(
            text(
              "Four separate caches, and confusing them is the usual source of 'why is my data stale'.",
            ),
          ),
          ul(
            "Request memoization — dedupes identical fetches within one render",
            "Data Cache — persists across requests and deployments",
            "Full Route Cache — the rendered HTML for a static route",
            "Router Cache — client-side, holds visited segments",
          ),
          h(2, "Invalidating"),
          code(
            "typescript",
            `import { revalidateTag, revalidatePath } from "next/cache";\n\nrevalidateTag("notes");\nrevalidatePath("/dashboard", "layout");`,
          ),
          p(
            text("Note: "),
            text("revalidatePath", inline),
            text(
              " with 'layout' clears the whole subtree, which is usually what you want after a mutation.",
            ),
          ),
        ),
      },
      {
        title: "Debugging hydration mismatches",
        tags: ["debugging", "frontend"],
        content: doc(
          h(2, "Symptom"),
          p(text("Text content does not match server-rendered HTML.")),
          h(2, "Usual causes"),
          ul(
            "Date or time formatted differently on server and client",
            "Math.random() or Date.now() in render",
            "Reading localStorage during the first render",
            "A browser extension injecting markup into the body",
          ),
          h(2, "Fix"),
          p(
            text("Move the varying value into an effect, or mark the element "),
            text("suppressHydrationWarning", inline),
            text(
              " when the mismatch is intentional — a theme class on <html>, for instance.",
            ),
          ),
        ),
      },
    ],
  },
  {
    name: "PostgreSQL",
    icon: "Database",
    description: "Indexes, query plans, full-text search, and the gotchas",
    isFavorite: true,
    pages: [
      {
        title: "Full-text search",
        tags: ["backend", "performance"],
        content: doc(
          p(
            text(
              "Postgres full-text search is good enough to postpone a dedicated search service for a long time.",
            ),
          ),
          h(2, "Generated column"),
          p(
            text(
              "Let Postgres maintain the vector so the application cannot forget to:",
            ),
          ),
          code(
            "sql",
            `ALTER TABLE "Page"\n  ADD COLUMN "searchVector" tsvector\n  GENERATED ALWAYS AS (\n    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||\n    setweight(to_tsvector('english', coalesce("contentText", '')), 'B')\n  ) STORED;\n\nCREATE INDEX ON "Page" USING GIN ("searchVector");`,
          ),
          h(2, "Querying"),
          p(
            text("Use "),
            text("websearch_to_tsquery", inline),
            text(
              " for anything a human typed — it handles quoted phrases and never throws on a stray operator, unlike ",
            ),
            text("to_tsquery", inline),
            text("."),
          ),
          h(2, "Fuzzy matching"),
          p(text("pg_trgm covers the typos that stemming cannot:")),
          code(
            "sql",
            `CREATE EXTENSION IF NOT EXISTS pg_trgm;\nSELECT * FROM "Page" WHERE title % 'postgre';`,
          ),
        ),
      },
      {
        title: "Reading EXPLAIN output",
        tags: ["performance", "debugging"],
        content: doc(
          p(
            text("Always "),
            text("EXPLAIN (ANALYZE, BUFFERS)", inline),
            text(
              " — plain EXPLAIN is an estimate, and the estimate is often the thing that is wrong.",
            ),
          ),
          h(2, "What to look at first"),
          ul(
            "Rows removed by filter — a large number means a missing index",
            "Estimated vs actual rows — a big gap means stale statistics",
            "Seq Scan on a large table inside a nested loop",
          ),
          code(
            "sql",
            `EXPLAIN (ANALYZE, BUFFERS)\nSELECT * FROM "Page"\nWHERE "userId" = $1 AND "deletedAt" IS NULL\nORDER BY "updatedAt" DESC\nLIMIT 20;`,
          ),
        ),
      },
    ],
  },
  {
    name: "System Design",
    icon: "Network",
    description: "Decisions, trade-offs and the reasoning behind them",
    pages: [
      {
        title: "Choosing session storage",
        tags: ["architecture", "security"],
        content: doc(
          h(2, "Context"),
          p(
            text(
              "Credentials-based login for a small internal tool. JWT or database sessions?",
            ),
          ),
          h(2, "Options"),
          ul(
            "JWT — stateless, no lookup per request, but cannot be revoked before expiry",
            "Database session — one indexed lookup per request, revocable instantly",
          ),
          h(2, "Decision"),
          p(
            text("Database sessions. At this scale the lookup is irrelevant, and "),
            text("being able to revoke", bold),
            text(
              " is worth far more than saving a query — 'sign out everywhere' and killing a stolen session both become a DELETE.",
            ),
          ),
          h(2, "Consequences"),
          ul(
            "Every request touches the sessions table — index it on the token hash",
            "Expired rows need periodic cleanup",
            "Only the hash of the token is stored, so a database leak yields nothing usable",
          ),
        ),
      },
    ],
  },
  {
    name: "Docker",
    icon: "Container",
    description: "Images, layers, and making builds not take ten minutes",
    pages: [
      {
        title: "Layer caching",
        tags: ["devops", "performance"],
        content: doc(
          p(text("Order matters: put what changes least at the top.")),
          code(
            "dockerfile",
            `FROM node:20-alpine\nWORKDIR /app\n\n# Dependencies change rarely — cache this layer.\nCOPY package*.json ./\nRUN npm ci\n\n# Source changes constantly, so it goes last.\nCOPY . .\nRUN npm run build`,
          ),
          p(
            text("Copying the whole source before "),
            text("npm ci", inline),
            text(" busts the dependency layer on every single edit."),
          ),
        ),
      },
    ],
  },
  {
    name: "Redis",
    icon: "Zap",
    description: "Caching patterns and when not to reach for it",
    pages: [
      {
        title: "When not to use Redis",
        tags: ["architecture", "backend"],
        content: doc(
          p(
            text(
              "Redis is excellent and frequently unnecessary. Things it gets reached for that Postgres already handles:",
            ),
          ),
          ul(
            "Rate limiting at low volume — a table with a fixed window is fine",
            "Session storage — a lookup on an indexed column is not the bottleneck",
            "Job queues under modest load — SKIP LOCKED works well",
          ),
          p(
            text(
              "Each of those adds a service to provision, monitor and pay for. Reach for Redis when the ",
            ),
            text("measured", bold),
            text(" load justifies it, not in anticipation."),
          ),
        ),
      },
    ],
  },
];

async function main() {
  console.log("Seeding…");

  const passwordHash = await hash(DEMO_PASSWORD, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: { name: "Demo User", email: DEMO_EMAIL, passwordHash },
    update: { passwordHash },
    select: { id: true },
  });

  // Wipe only this account's content, so seeding never disturbs real data.
  await prisma.technology.deleteMany({ where: { userId: user.id } });
  await prisma.tag.deleteMany({ where: { userId: user.id } });

  let technologyPosition = 1024;
  let pageCount = 0;

  for (const tech of TECHNOLOGIES) {
    const technology = await prisma.technology.create({
      data: {
        userId: user.id,
        name: tech.name,
        slug: tech.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
        description: tech.description,
        icon: tech.icon,
        isFavorite: tech.isFavorite ?? false,
        position: technologyPosition,
      },
      select: { id: true },
    });
    technologyPosition += 1024;

    let pagePosition = 1024;

    for (const page of tech.pages) {
      const tagIds: string[] = [];

      for (const name of page.tags) {
        const tag = await prisma.tag.upsert({
          where: { userId_slug: { userId: user.id, slug: name } },
          create: { userId: user.id, name, slug: name },
          update: {},
          select: { id: true },
        });
        tagIds.push(tag.id);
      }

      await prisma.page.create({
        data: {
          userId: user.id,
          technologyId: technology.id,
          title: page.title,
          slug: page.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, ""),
          content: page.content as never,
          contentText: flatten(page.content),
          position: pagePosition,
          isFavorite: pageCount % 4 === 0,
          tags: { create: tagIds.map((tagId) => ({ tagId })) },
        },
      });

      pagePosition += 1024;
      pageCount++;
    }
  }

  console.log(`  ${TECHNOLOGIES.length} technologies, ${pageCount} pages`);
  console.log();
  console.log("  Sign in with:");
  console.log(`    email    ${DEMO_EMAIL}`);
  console.log(`    password ${DEMO_PASSWORD}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
