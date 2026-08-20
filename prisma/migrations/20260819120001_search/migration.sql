-- Full-text and fuzzy search.
--
-- Two complementary mechanisms, because they fail in opposite ways:
--
--   tsvector + GIN  matches on stemmed words, so "caching" finds "cache", but
--                   it will not match a misspelling or a partial word.
--   pg_trgm         matches on character trigrams, so "postgre" finds
--                   "postgres" and "recieve" finds "receive", but it has no
--                   notion of relevance across a long document.
--
-- Searching titles with both and content with the first is what makes
-- "react query cache" land on React -> TanStack Query -> Caching.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- Available on Neon without any special provisioning.
--
-- Pinned to `public` and referenced fully qualified everywhere below. Two
-- reasons:
--
--   1. An unqualified `gin_trgm_ops` resolves through search_path, so the same
--      migration fails when applied to any schema other than the one holding
--      the extension — which is exactly what happens to the test schema.
--   2. Depending on search_path for operator resolution is a documented
--      privilege-escalation vector; qualifying removes the question entirely.
--
-- src/server/search.ts qualifies its calls to similarity() and % for the same
-- reason.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- ---------------------------------------------------------------------------
-- Generated search vector
-- ---------------------------------------------------------------------------
-- GENERATED ALWAYS means Postgres maintains this on every INSERT and UPDATE.
-- The application cannot forget to refresh it, and there is no trigger to keep
-- in sync with the schema.
--
-- Every function in the expression must be IMMUTABLE, which is why the text
-- search configuration is the literal 'english' rather than the session's
-- default_text_search_config — the latter is only STABLE and Postgres will
-- reject it here.
--
-- Weight A on the title, B on the body: a page called "Caching" should
-- outrank one that merely mentions caching in passing.
ALTER TABLE "Page"
  DROP COLUMN IF EXISTS "searchVector";

ALTER TABLE "Page"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("contentText", '')), 'B')
  ) STORED;

CREATE INDEX "Page_searchVector_idx" ON "Page" USING GIN ("searchVector");

-- ---------------------------------------------------------------------------
-- Trigram indexes for fuzzy / partial matching
-- ---------------------------------------------------------------------------
CREATE INDEX "Page_title_trgm_idx" ON "Page" USING GIN ("title" public.gin_trgm_ops);

CREATE INDEX "Technology_name_trgm_idx"
  ON "Technology" USING GIN ("name" public.gin_trgm_ops);

CREATE INDEX "Tag_name_trgm_idx" ON "Tag" USING GIN ("name" public.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Partial index for the common case
-- ---------------------------------------------------------------------------
-- Almost every listing query is "this user's live pages, most recent first".
-- A partial index excluding trashed rows keeps it small and lets Postgres skip
-- the deletedAt filter entirely.
CREATE INDEX "Page_userId_updatedAt_live_idx"
  ON "Page" ("userId", "updatedAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Technology_userId_position_live_idx"
  ON "Technology" ("userId", "position" ASC)
  WHERE "deletedAt" IS NULL;
