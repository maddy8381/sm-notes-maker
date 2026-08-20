import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Global search.
 *
 * Written as raw SQL rather than through Prisma's query builder because the
 * ranking is the entire point, and `ts_rank_cd` + `ts_headline` + trigram
 * similarity have no Prisma equivalent.
 *
 * Every query here is parameterised through Prisma.sql tagged templates, so
 * user input is bound rather than interpolated. `userId` is bound the same way
 * and appears in every WHERE — dropping to raw SQL changes how the isolation
 * is written, not whether it holds.
 */

export type SearchResult = {
  id: string;
  title: string;
  slug: string;
  technologyName: string;
  technologySlug: string;
  technologyIcon: string | null;
  /**
   * Body excerpt, HTML-escaped, with <mark> around matched terms. Safe to
   * render as HTML — see `renderSnippet`.
   */
  snippet: string;
  updatedAt: Date;
  isFavorite: boolean;
  rank: number;
};

/**
 * Sentinels that `ts_headline` wraps around matches.
 *
 * Emphatically not `<mark>`. The text `ts_headline` highlights is the user's
 * own note content, and the snippet is the one string this app renders as
 * HTML. Letting Postgres emit the tags directly would mean trusting whatever
 * the note happens to contain.
 *
 * It is tempting to assume `ts_headline` sanitizes: its text-search parser
 * does tokenize away *well-formed* tags, so `<img src=x onerror=alert(1)>`
 * vanishes on its own. That is a side effect of tokenizing, not a security
 * property, and it does not hold. Measured against Postgres 17:
 *
 *   <img src=x onerror=alert(1)   (unclosed)  -> survives verbatim
 *   " onmouseover="alert(1)       (attribute) -> survives verbatim
 *   < script > alert(1)           (spaced)    -> survives verbatim
 *
 * Any of those rendered unescaped is stored XSS that fires for whoever
 * searches those words — usually the author, on every device.
 *
 * So: Postgres marks matches with bytes that cannot occur in real prose, the
 * whole string is HTML-escaped, and only then are the sentinels swapped for
 * real tags. Escaping *after* highlighting is what makes the output safe.
 * tests/unit/search-snippet.test.ts pins each of the payloads above.
 */
// Control characters: they cannot be typed into a note, and extractText strips
// them on write. A word-like sentinel would collide with real prose eventually.
const MARK_START = "\u0001";
const MARK_END = "\u0002";

const HEADLINE_OPTIONS =
  `StartSel=${MARK_START}, StopSel=${MARK_END}, ` +
  "MaxFragments=2, MinWords=8, MaxWords=22, FragmentDelimiter= … ";

/**
 * Escapes a raw `ts_headline` result and converts its sentinels into <mark>.
 * The output contains no markup that did not originate here.
 */
export function renderSnippet(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .split(MARK_START)
    .join("<mark>")
    .split(MARK_END)
    .join("</mark>");
}

export type SearchOptions = {
  limit?: number;
  cursor?: number;
  technologyId?: string;
  tagSlugs?: string[];
};

const DEFAULT_LIMIT = 20;

/**
 * Turns what someone typed into a tsquery.
 *
 * `websearch_to_tsquery` is the right parser for a search box — it understands
 * quoted phrases and `-exclusion` and, crucially, never throws on malformed
 * input the way `to_tsquery` does on a stray operator.
 *
 * The prefix match on the final term is what makes results appear while
 * typing: "cachi" should already be finding "caching" rather than waiting for
 * the word to be finished.
 */
function buildTsQuery(query: string): { websearch: string; prefix: string | null } {
  const trimmed = query.trim().slice(0, 200);
  const terms = trimmed.split(/\s+/).filter(Boolean);
  const last = terms.at(-1);

  // Only offer a prefix match on a bare word — doing it to a quoted phrase or
  // an exclusion would change what the user asked for.
  const prefix =
    last && /^[a-zA-Z0-9]+$/.test(last) && last.length >= 2
      ? terms
          .slice(0, -1)
          .map((t) => `${t} &`)
          .join(" ") + ` ${last}:*`
      : null;

  return { websearch: trimmed, prefix: prefix?.trim() ?? null };
}

export async function searchPages(
  userId: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, 50);
  const offset = options.cursor ?? 0;
  const { websearch, prefix } = buildTsQuery(trimmed);

  const technologyFilter = options.technologyId
    ? Prisma.sql`AND p."technologyId" = ${options.technologyId}`
    : Prisma.empty;

  const tagFilter =
    options.tagSlugs && options.tagSlugs.length > 0
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM "PageTag" pt
          JOIN "Tag" tg ON tg."id" = pt."tagId"
          WHERE pt."pageId" = p."id"
            AND tg."userId" = ${userId}
            AND tg."slug" IN (${Prisma.join(options.tagSlugs)})
        )`
      : Prisma.empty;

  // The two tsquery forms are OR'd: the websearch form handles phrases and
  // operators, the prefix form catches the word still being typed. COALESCE
  // keeps a null prefix from nulling the whole predicate.
  const matchesText = prefix
    ? Prisma.sql`(
        p."searchVector" @@ websearch_to_tsquery('english', ${websearch})
        OR p."searchVector" @@ to_tsquery('english', ${prefix})
      )`
    : Prisma.sql`p."searchVector" @@ websearch_to_tsquery('english', ${websearch})`;

  const rows = await prisma.$queryRaw<
    {
      id: string;
      title: string;
      slug: string;
      technologyName: string;
      technologySlug: string;
      technologyIcon: string | null;
      snippet: string;
      updatedAt: Date;
      isFavorite: boolean;
      rank: number;
    }[]
  >`
    SELECT
      p."id",
      p."title",
      p."slug",
      t."name" AS "technologyName",
      t."slug" AS "technologySlug",
      t."icon" AS "technologyIcon",
      ts_headline(
        'english',
        p."contentText",
        websearch_to_tsquery('english', ${websearch}),
        ${HEADLINE_OPTIONS}
      ) AS "snippet",
      p."updatedAt",
      p."isFavorite",
      (
        ts_rank_cd(p."searchVector", websearch_to_tsquery('english', ${websearch}))
        -- Trigram similarity on the title lifts near-miss titles that the
        -- stemmer alone would rank below an incidental body mention.
        + public.similarity(p."title", ${trimmed}) * 2.0
        -- A small nudge for favourites, enough to break ties without letting
        -- a starred page outrank a genuinely better match.
        + CASE WHEN p."isFavorite" THEN 0.15 ELSE 0 END
      ) AS "rank"
    FROM "Page" p
    JOIN "Technology" t ON t."id" = p."technologyId"
    WHERE p."userId" = ${userId}
      AND p."deletedAt" IS NULL
      AND t."deletedAt" IS NULL
      AND (
        ${matchesText}
        -- Falls back to a fuzzy title match so a typo still finds the page.
        OR p."title" OPERATOR(public.%) ${trimmed}
      )
      ${technologyFilter}
      ${tagFilter}
    ORDER BY "rank" DESC, p."updatedAt" DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  // Escaping happens here rather than at the call site so there is no way to
  // consume a SearchResult and forget it. By the time a snippet leaves this
  // module it is already safe to render.
  return rows.map((row) => ({ ...row, snippet: renderSnippet(row.snippet) }));
}

export type TechnologySearchResult = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  pageCount: number;
};

export async function searchTechnologies(
  userId: string,
  query: string,
  limit = 5,
): Promise<TechnologySearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return prisma.$queryRaw<TechnologySearchResult[]>`
    SELECT
      t."id",
      t."name",
      t."slug",
      t."description",
      t."icon",
      COUNT(p."id")::int AS "pageCount"
    FROM "Technology" t
    LEFT JOIN "Page" p ON p."technologyId" = t."id" AND p."deletedAt" IS NULL
    WHERE t."userId" = ${userId}
      AND t."deletedAt" IS NULL
      AND (
        t."name" ILIKE ${"%" + trimmed + "%"}
        OR t."name" OPERATOR(public.%) ${trimmed}
        OR t."description" ILIKE ${"%" + trimmed + "%"}
      )
    GROUP BY t."id"
    ORDER BY
      -- Exact prefix first: typing "rea" should put React above anything that
      -- merely mentions it.
      (t."name" ILIKE ${trimmed + "%"}) DESC,
      public.similarity(t."name", ${trimmed}) DESC,
      t."name" ASC
    LIMIT ${limit}
  `;
}

/**
 * Everything at once, for the command palette. One round trip rather than
 * three sequential ones, because this runs on every keystroke.
 */
export async function searchEverything(
  userId: string,
  query: string,
): Promise<{
  technologies: TechnologySearchResult[];
  pages: SearchResult[];
  tags: { id: string; name: string; slug: string; color: string | null }[];
}> {
  const trimmed = query.trim();
  if (!trimmed) return { technologies: [], pages: [], tags: [] };

  const [technologies, pages, tags] = await Promise.all([
    searchTechnologies(userId, trimmed, 4),
    searchPages(userId, trimmed, { limit: 8 }),
    prisma.tag.findMany({
      where: { userId, name: { contains: trimmed, mode: "insensitive" } },
      select: { id: true, name: true, slug: true, color: true },
      take: 4,
      orderBy: { name: "asc" },
    }),
  ]);

  return { technologies, pages, tags };
}

export async function countSearchResults(
  userId: string,
  query: string,
): Promise<number> {
  const trimmed = query.trim();
  if (!trimmed) return 0;

  const { websearch } = buildTsQuery(trimmed);

  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS "count"
    FROM "Page" p
    JOIN "Technology" t ON t."id" = p."technologyId"
    WHERE p."userId" = ${userId}
      AND p."deletedAt" IS NULL
      AND t."deletedAt" IS NULL
      AND (
        p."searchVector" @@ websearch_to_tsquery('english', ${websearch})
        OR p."title" OPERATOR(public.%) ${trimmed}
      )
  `;

  return Number(rows[0]?.count ?? 0);
}
