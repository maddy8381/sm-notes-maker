# SM Notes Maker

A personal knowledge base for engineering notes — debugging write-ups,
architecture decisions, code snippets, the things you look up twice a year and
never remember.

Built for a small group (10–20 people), with per-user isolation strong enough
that it is safe to put real work notes in.

---

## Stack

|           |                                                        |
| --------- | ------------------------------------------------------ |
| Framework | Next.js 16 (App Router), React 19                      |
| Language  | TypeScript, strict                                     |
| Database  | PostgreSQL (Neon) via Prisma 7                         |
| Auth      | Hand-rolled database sessions — no NextAuth, see below |
| Editor    | TipTap 3                                               |
| Styling   | Tailwind v4 + Radix primitives                         |
| Images    | Vercel Blob                                            |
| Tests     | Vitest 4 (unit + jsdom), Playwright                    |

### Why not NextAuth

`next-auth` v5 has been in beta for years, and its Credentials provider forces
JWT sessions. JWTs cannot be revoked before they expire — no "sign out
everywhere", no way to kill a stolen session. For an app holding personal
notes, that trade is backwards. Sessions here are rows in Postgres, keyed by a
SHA-256 of the token; revoking one is a `DELETE`. See `src/server/sessions.ts`.

---

## Local development

### Requirements

- **Node 20.19+, 22.12+ or 24+.** Prisma 7 refuses to install on other
  versions, including odd-numbered releases like 23. `.nvmrc` pins 20.19.0.
- A PostgreSQL database. [Neon](https://neon.tech) free tier is what this is
  built against; any Postgres 14+ with the `pg_trgm` extension available works.

```bash
nvm use            # or: fnm use
npm install
```

### Database

Copy the example environment file and fill in your connection strings:

```bash
cp .env.example .env.local
```

You need two URLs from Neon (Connection Details → the toggle switches between
them):

- `DATABASE_URL` — the **pooled** string, used by the app at runtime.
- `DIRECT_URL` — the **direct** string, used by migrations. Prisma's advisory
  migration lock and DDL both need session state that a connection pooler does
  not preserve, so pointing migrate at the pooled URL fails intermittently.

Then:

```bash
npm run db:deploy   # apply migrations
npm run seed        # optional: a demo account with realistic content
npm run dev
```

The seed prints its credentials. It only ever touches the demo account, so it
is safe to re-run against a database that already has real notes in it.

### Scripts

| Command              | Does                                                  |
| -------------------- | ----------------------------------------------------- |
| `npm run dev`        | Development server                                    |
| `npm run build`      | Production build (runs `prisma generate` first)       |
| `npm run db:migrate` | Create and apply a migration                          |
| `npm run db:deploy`  | Apply existing migrations — use this in CI/production |
| `npm run db:reset`   | Drop, re-migrate and re-seed                          |
| `npm run seed`       | Seed demo content                                     |
| `npm test`           | Vitest (unit + editor)                                |
| `npm run test:e2e`   | Playwright                                            |
| `npm run typecheck`  | `tsc --noEmit`                                        |
| `npm run lint`       | ESLint                                                |

> `npm run db:studio` needs Node 22+ — one of Prisma Studio's dependencies
> declares it. Everything else runs on 20.19.

---

## Architecture

### How user isolation is enforced

Not by remembering to check. Two mechanisms make the check structural:

**1. Prisma is reachable from exactly one directory.** An ESLint rule
(`eslint.config.mjs`) forbids importing `@/lib/prisma` outside `src/server/`.
Every function there takes `userId` as its first argument and puts it in the
`where` clause. A component that wanted to skip the check would have to import
Prisma directly, and that fails lint.

**2. Every mutation goes through `authedAction`.** The wrapper in
`src/lib/safe-action.ts` resolves the session and Zod-parses the input before
the handler body runs. There is no code path into a handler without both.

```
src/lib/dal.ts          getCurrentUser() — React cache(), one lookup per request
src/lib/safe-action.ts  authedAction(schema, handler)
src/server/*.ts         the only modules that import prisma
src/proxy.ts            optimistic cookie check only — NOT authorization
```

`proxy.ts` (Next 16's renamed middleware) checks only whether a session cookie
exists. It runs on every request including prefetches, so a database lookup
there would mean a query per hovered link — and the Next docs are explicit that
it is the wrong layer for authorization. Forging that cookie gets you past the
redirect and straight into `requireUser()`, which rejects you.

### How content is stored

Notes are stored as **ProseMirror JSON in a `jsonb` column**, never as HTML.
HTML is only ever generated at render time from that JSON.

This is the app's main XSS defence, and it is structural rather than a
sanitizer: `validateDoc()` in `src/lib/editor/content.ts` rebuilds every
incoming document from an allowlist of node types, mark types, link protocols
and image hosts. A node type that is not on the list cannot be stored, so it
can never be rendered. Adding an editor extension means adding it there too.

Two subtleties worth knowing before changing this code:

- **The document crosses the wire as a JSON string, not an object.** React's
  Server Action deserialization hands the server a lazily materialized
  structure for deeply nested arguments — the `attrs` key is present on each
  node but reading it yields `undefined`. That silently stripped every heading
  level, code language and image dimension on save. `docJsonStringSchema`
  exists for this; do not "simplify" it back to passing the object.
- **Search snippets are escaped after highlighting, not before.** Postgres's
  `ts_headline` echoes the user's own note text back verbatim, and it does not
  sanitize — unclosed tags and attribute-breakout payloads pass straight
  through. `renderSnippet()` in `src/server/search.ts` is what makes the
  snippet safe to render.

### Search

Two complementary mechanisms, because they fail in opposite directions:

- A **generated `tsvector` column** on `Page`, GIN-indexed, weighted title-over-
  body. Handles stemming, so "caching" finds "cache".
- **`pg_trgm`** on titles. Handles typos and partial words, which stemming
  cannot.

Together, `react query cache` finds _React → TanStack Query → Caching_, and
`tanstck` still finds _TanStack Query_. The generated column means the
application cannot forget to update the index.

### Not losing your writing

Three independent safeguards, because autosave alone is not enough:

1. **Debounced autosave** (~800 ms), flushed on blur and on tab hide.
   `visibilitychange` rather than `beforeunload`, which mobile browsers often
   skip when killing a backgrounded tab.
2. **Optimistic concurrency.** Every save carries the revision the editor
   loaded. A stale write is refused rather than silently overwriting whatever
   the other tab saved.
3. **A local draft buffer.** The pending document is written to IndexedDB
   _before_ the request goes out and cleared on acknowledgement. A draft
   surviving on load means exactly one thing: the last edit never reached the
   server — so the editor offers to restore it.

---

## Deployment

### Vercel + Neon

1. **Neon** — create a project. Optionally create a `dev` branch so local work
   does not touch production data.
2. **Vercel Blob** — create a store under Storage. Without
   `BLOB_READ_WRITE_TOKEN` everything works except image upload, which reports
   that it is unconfigured rather than failing obscurely.
3. **Vercel project** — import the repository and set:

   | Variable                | Value                                         |
   | ----------------------- | --------------------------------------------- |
   | `DATABASE_URL`          | Neon pooled connection string                 |
   | `DIRECT_URL`            | Neon direct connection string                 |
   | `NEXT_PUBLIC_APP_URL`   | `https://your-app.vercel.app` — must be https |
   | `AUTH_SECRET`           | `openssl rand -base64 48`                     |
   | `BLOB_READ_WRITE_TOKEN` | From the Blob store                           |
   | `CRON_SECRET`           | `openssl rand -base64 32`                     |

4. **Migrations** — run `npm run db:deploy` against the production database as
   part of your release, or add it to the Vercel build command.

The app refuses to boot in production without `AUTH_SECRET`, or with an
`http://` app URL — session cookies are `Secure`-only and would never be sent.

### Image upload

Uploads go **directly from the browser to Blob storage**, using a short-lived
token minted by `/api/upload` after authenticating the request. The file never
passes through a serverless function, which sidesteps the 4.5 MB Server Action
body limit — a limit an ordinary retina screenshot exceeds.

SVG is deliberately not an accepted type: it is a document that can carry
`<script>`, and it would be served from our own blob host.

---

## Testing

```bash
npm test           # unit + editor round-trip
npm run test:e2e   # Playwright
```

Integration and E2E tests need `TEST_DATABASE_URL` pointing at a **separate
database** — they truncate tables and sign up real accounts. `tests/setup.ts`
never falls back to `DATABASE_URL`, and `tests/integration/db-target.test.ts`
asserts the isolation actually holds.

> **Use a separate database, not a separate schema.** `?schema=` is a Prisma
> _CLI_ parameter: `prisma migrate` honours it, but the `pg` driver adapter
> ignores it, so migrations land in the named schema while every runtime query
> stays on `public`. That mismatch is invisible until something writes to the
> wrong place — here it let the test suite truncate the development database
> while reporting success.

Create one alongside your main database:

```sql
CREATE DATABASE sm_notes_maker_test;
```

then point `TEST_DATABASE_URL` at it (same host and credentials, different
database name) and apply the migrations:

```bash
DATABASE_URL="$TEST_DATABASE_URL" DIRECT_URL="$TEST_DATABASE_URL" \
  npx prisma migrate deploy
```

What the suites cover:

- **Unit** — document validation and sanitizing, search-snippet escaping,
  fractional-index maths, slugs, Markdown conversion.
- **Editor (jsdom)** — the copy/paste round trip: a code block keeps its
  language through JSON, through rendered HTML, and through a paste from
  GitHub/VS Code-style markup; an image keeps its width, caption, alt text and
  alignment.
- **Integration** — auth flows, rate limiting, and the isolation suite: user B
  gets nothing on every read, write, delete, reorder, move and search touching
  user A's data.
- **E2E** — signup → create technology → create page → edit → autosave →
  search → delete → sign out.

---

## Project layout

```
prisma/
  schema.prisma          models, indexes, cascade rules
  migrations/            includes the raw SQL for tsvector + pg_trgm
  seed.ts

src/
  app/
    (auth)/              login, signup, forgot/reset password
    (app)/               everything behind requireUser()
    api/                 search, upload
  components/
    editor/              TipTap, toolbar, autosave, node views
    layout/              shell, sidebar, command palette, theme
    ui/                  primitives
  lib/
    dal.ts               getCurrentUser / requireUser
    safe-action.ts       authedAction wrapper
    editor/              document schema, validation, markdown
    validation/          Zod schemas shared with the client
  server/                the only place Prisma is imported
  proxy.ts               optimistic redirect (Next 16's middleware)
```
