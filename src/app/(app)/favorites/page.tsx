import type { Metadata } from "next";
import Link from "next/link";
import { Star } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { TechIcon } from "@/components/layout/tech-icon";
import { PageLinkList } from "@/components/pages/page-link-list";
import { requireUser } from "@/lib/dal";
import { pluralize } from "@/lib/utils";
import { listFavoritePages } from "@/server/pages";
import { listTechnologies } from "@/server/technologies";

export const metadata: Metadata = { title: "Favorites" };

export default async function FavoritesPage() {
  const user = await requireUser();

  const [pages, technologies] = await Promise.all([
    listFavoritePages(user.id),
    listTechnologies(user.id, { sort: "manual" }),
  ]);

  const pinned = technologies.filter((technology) => technology.isFavorite);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Favorites</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Pages and technologies you have starred.
        </p>
      </header>

      {pinned.length === 0 && pages.length === 0 ? (
        <EmptyState
          icon={Star}
          title="Nothing starred yet"
          description="Star a technology or a page and it will show up here, so the things you reach for most are one click away."
        />
      ) : (
        <div className="space-y-8">
          {pinned.length > 0 ? (
            <section>
              <h2 className="text-muted-foreground mb-3 text-sm font-medium tracking-wide uppercase">
                Technologies
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {pinned.map((technology) => (
                  <li key={technology.id}>
                    <Link
                      href={`/t/${technology.slug}`}
                      className="border-border bg-card hover:bg-muted/50 flex items-center gap-3 rounded-lg border px-3.5 py-2.5 transition-colors"
                    >
                      <TechIcon
                        name={technology.icon}
                        className="text-muted-foreground size-4 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {technology.name}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {technology.pageCount} {pluralize(technology.pageCount, "page")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {pages.length > 0 ? (
            <section>
              <h2 className="text-muted-foreground mb-3 text-sm font-medium tracking-wide uppercase">
                Pages
              </h2>
              <PageLinkList pages={pages} />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
