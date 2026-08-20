import type { Metadata } from "next";
import Link from "next/link";
import { Hash } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { requireUser } from "@/lib/dal";
import { pluralize } from "@/lib/utils";
import { listTags } from "@/server/tags";

export const metadata: Metadata = { title: "Tags" };

export default async function TagsPage() {
  const user = await requireUser();
  const tags = await listTags(user.id);

  // Tags with no live pages are noise on this screen — they exist only until
  // the maintenance job sweeps them.
  const used = tags.filter((tag) => tag.pageCount > 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Tags</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Cross-cutting themes — the connections that do not fit the technology a note
          happens to live in.
        </p>
      </header>

      {used.length === 0 ? (
        <EmptyState
          icon={Hash}
          title="No tags yet"
          description="Add tags to a page — #debugging, #architecture, #performance — and they collect here, pulling related notes together across technologies."
        />
      ) : (
        <ul className="flex flex-wrap gap-2">
          {used.map((tag) => (
            <li key={tag.id}>
              <Link
                href={`/tags/${tag.slug}`}
                className="border-border bg-card hover:bg-muted flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors"
              >
                <Hash className="text-muted-foreground size-3.5" aria-hidden />
                {tag.name}
                <span className="text-muted-foreground text-xs">{tag.pageCount}</span>
                <span className="sr-only">{pluralize(tag.pageCount, "page")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
