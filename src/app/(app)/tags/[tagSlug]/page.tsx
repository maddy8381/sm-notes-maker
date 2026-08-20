import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Hash } from "lucide-react";

import { PageLinkList } from "@/components/pages/page-link-list";
import { requireUser } from "@/lib/dal";
import { pluralize } from "@/lib/utils";
import { getTagBySlug, listPagesByTag } from "@/server/tags";

type Params = { params: Promise<{ tagSlug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { tagSlug } = await params;
  const user = await requireUser();
  const tag = await getTagBySlug(user.id, tagSlug);

  return { title: tag ? `#${tag.name}` : "Not found" };
}

export default async function TagPage({ params }: Params) {
  const { tagSlug } = await params;
  const user = await requireUser();

  const tag = await getTagBySlug(user.id, tagSlug);
  if (!tag) notFound();

  const pages = await listPagesByTag(user.id, tag.slug);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
      <nav
        aria-label="Breadcrumb"
        className="text-muted-foreground mb-4 flex items-center gap-1 text-sm"
      >
        <Link href="/tags" className="hover:text-foreground transition-colors">
          Tags
        </Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <span className="text-foreground">{tag.name}</span>
      </nav>

      <header className="mb-6 flex items-center gap-2">
        <Hash className="text-muted-foreground size-5" aria-hidden />
        <h1 className="text-xl font-semibold tracking-tight">{tag.name}</h1>
        <span className="text-muted-foreground text-sm">
          {pages.length} {pluralize(pages.length, "page")}
        </span>
      </header>

      {pages.length === 0 ? (
        <p className="border-border text-muted-foreground rounded-xl border border-dashed px-4 py-10 text-center text-sm">
          Nothing carries this tag any more.
        </p>
      ) : (
        <PageLinkList pages={pages} />
      )}
    </div>
  );
}
