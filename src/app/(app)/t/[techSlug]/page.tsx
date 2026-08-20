import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { TechIcon } from "@/components/layout/tech-icon";
import { CreatePageButton } from "@/components/pages/create-page-button";
import { PageList } from "@/components/pages/page-list";
import { requireUser } from "@/lib/dal";
import { pluralize } from "@/lib/utils";
import { listPagesForTechnology } from "@/server/pages";
import { getTechnologyBySlug, listTechnologies } from "@/server/technologies";

type Params = { params: Promise<{ techSlug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { techSlug } = await params;
  const user = await requireUser();
  const technology = await getTechnologyBySlug(user.id, techSlug);

  return { title: technology?.name ?? "Not found" };
}

export default async function TechnologyPage({ params }: Params) {
  const { techSlug } = await params;
  const user = await requireUser();

  const technology = await getTechnologyBySlug(user.id, techSlug);

  // `getTechnologyBySlug` is scoped to this user, so another account's slug
  // reads as missing rather than forbidden — no way to probe what exists.
  if (!technology) notFound();

  const [pages, allTechnologies] = await Promise.all([
    listPagesForTechnology(user.id, technology.id),
    listTechnologies(user.id, { sort: "manual" }),
  ]);

  const otherTechnologies = allTechnologies
    .filter((t) => t.id !== technology.id)
    .map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 flex items-start gap-4">
        <span
          className="bg-muted text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded-xl"
          aria-hidden
        >
          <TechIcon name={technology.icon} className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{technology.name}</h1>
          {technology.description ? (
            <p className="text-muted-foreground mt-0.5 text-sm">
              {technology.description}
            </p>
          ) : null}
          <p className="text-muted-foreground mt-1 text-xs">
            {pages.length} {pluralize(pages.length, "page")}
          </p>
        </div>

        {pages.length > 0 ? (
          <CreatePageButton
            technologyId={technology.id}
            technologySlug={technology.slug}
          />
        ) : null}
      </header>

      {pages.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No pages yet"
          description={`Everything you learn about ${technology.name} goes here. Start with a template, or a blank page.`}
          action={
            <CreatePageButton
              technologyId={technology.id}
              technologySlug={technology.slug}
              label="Create the first page"
            />
          }
        />
      ) : (
        <PageList
          pages={pages}
          technologyId={technology.id}
          technologySlug={technology.slug}
          otherTechnologies={otherTechnologies}
        />
      )}
    </div>
  );
}
