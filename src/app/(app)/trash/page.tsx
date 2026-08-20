import type { Metadata } from "next";
import { Trash2 } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { TrashList } from "@/components/trash/trash-list";
import { requireUser } from "@/lib/dal";
import { listTrashedPages } from "@/server/pages";
import { listTrashedTechnologies } from "@/server/technologies";

export const metadata: Metadata = { title: "Trash" };

export default async function TrashPage() {
  const user = await requireUser();

  const [technologies, pages] = await Promise.all([
    listTrashedTechnologies(user.id),
    listTrashedPages(user.id),
  ]);

  const items = [
    ...technologies.map((technology) => ({
      id: technology.id,
      kind: "technology" as const,
      title: technology.name,
      deletedAt: technology.deletedAt!,
    })),
    // Pages that went to the trash as part of their technology are already
    // represented by that technology. Listing them separately would offer a
    // Restore button that cannot work — restorePage refuses while the parent
    // is still deleted.
    ...pages
      .filter((page) => page.technology.deletedAt === null)
      .map((page) => ({
        id: page.id,
        kind: "page" as const,
        title: page.title,
        context: page.technology.name,
        deletedAt: page.deletedAt!,
      })),
  ].sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Trash</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Deleted items stay here until you remove them for good.
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title="Trash is empty"
          description="Anything you delete lands here first, so a misclick is never the end of a note."
        />
      ) : (
        <TrashList items={items} />
      )}
    </div>
  );
}
