import Link from "next/link";
import { FileText } from "lucide-react";

import { TechIcon } from "@/components/layout/tech-icon";
import { relativeTime } from "@/lib/utils";

export type ListedPage = {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
  updatedAt?: Date;
  viewedAt?: Date;
  technology: { name: string; slug: string; icon: string | null };
};

/**
 * The shared list used by Favorites, Recent and tag pages. One component so
 * those three screens cannot drift into three slightly different designs.
 */
export function PageLinkList({ pages }: { pages: ListedPage[] }) {
  return (
    <ul className="divide-border border-border bg-card divide-y overflow-hidden rounded-xl border">
      {pages.map((page) => (
        <li key={page.id}>
          <Link
            href={`/t/${page.technology.slug}/${page.slug}`}
            className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3 transition-colors"
          >
            <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{page.title}</span>
              {page.excerpt ? (
                <span className="text-muted-foreground block truncate text-xs">
                  {page.excerpt}
                </span>
              ) : null}
            </span>

            <span className="text-muted-foreground hidden shrink-0 items-center gap-1.5 text-xs sm:flex">
              <TechIcon name={page.technology.icon} className="size-3.5" />
              {page.technology.name}
            </span>

            {page.viewedAt || page.updatedAt ? (
              <span className="text-muted-foreground w-16 shrink-0 text-right text-xs">
                {relativeTime((page.viewedAt ?? page.updatedAt)!)}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
