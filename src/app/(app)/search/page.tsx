import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { TechIcon } from "@/components/layout/tech-icon";
import { requireUser } from "@/lib/dal";
import { pluralize, relativeTime } from "@/lib/utils";
import { countSearchResults, searchPages } from "@/server/search";

export const metadata: Metadata = { title: "Search" };

const PAGE_SIZE = 20;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page } = await searchParams;
  const user = await requireUser();

  const query = q?.trim() ?? "";
  const pageNumber = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);

  if (!query) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
        <h1 className="mb-6 text-xl font-semibold tracking-tight">Search</h1>
        <EmptyState
          icon={Search}
          title="Search your notes"
          description="Press ⌘K anywhere, or add ?q= to this URL. Search looks inside the text of every page, not just titles."
        />
      </div>
    );
  }

  const [results, total] = await Promise.all([
    searchPages(user.id, query, {
      limit: PAGE_SIZE,
      cursor: (pageNumber - 1) * PAGE_SIZE,
    }),
    countSearchResults(user.id, query),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Results for “{query}”</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {total} {pluralize(total, "page")}
        </p>
      </header>

      {results.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matches"
          description={`Nothing in your notes matches “${query}”. Try fewer words — search also matches near-misses and partial words.`}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {results.map((result) => (
              <li key={result.id}>
                <Link
                  href={`/t/${result.technologySlug}/${result.slug}`}
                  className="border-border bg-card hover:bg-muted/40 block rounded-xl border px-4 py-3 transition-colors"
                >
                  <div className="flex items-baseline gap-2">
                    <h2 className="min-w-0 flex-1 truncate font-medium">
                      {result.title}
                    </h2>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {relativeTime(result.updatedAt)}
                    </span>
                  </div>

                  {result.snippet ? (
                    <p
                      className="text-muted-foreground [&_mark]:bg-warning/30 [&_mark]:text-foreground mt-1 text-sm [&_mark]:rounded [&_mark]:px-0.5"
                      // Safe: renderSnippet has already HTML-escaped the note
                      // text on the server and inserted these <mark> tags
                      // itself. See the comment on MARK_START in
                      // src/server/search.ts.
                      dangerouslySetInnerHTML={{ __html: result.snippet }}
                    />
                  ) : null}

                  <p className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
                    <TechIcon name={result.technologyIcon} className="size-3.5" />
                    {result.technologyName}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          {totalPages > 1 ? (
            <nav
              aria-label="Pagination"
              className="mt-6 flex items-center justify-between text-sm"
            >
              {pageNumber > 1 ? (
                <Link
                  href={`/search?q=${encodeURIComponent(query)}&page=${pageNumber - 1}`}
                  className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                >
                  ← Previous
                </Link>
              ) : (
                <span />
              )}

              <span className="text-muted-foreground">
                Page {pageNumber} of {totalPages}
              </span>

              {pageNumber < totalPages ? (
                <Link
                  href={`/search?q=${encodeURIComponent(query)}&page=${pageNumber + 1}`}
                  className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                >
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
