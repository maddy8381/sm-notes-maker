import type { Metadata } from "next";
import { Clock } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PageLinkList } from "@/components/pages/page-link-list";
import { requireUser } from "@/lib/dal";
import { listRecentlyUpdated, listRecentlyViewed } from "@/server/pages";

export const metadata: Metadata = { title: "Recent" };

export default async function RecentPage() {
  const user = await requireUser();

  const [viewed, updated] = await Promise.all([
    listRecentlyViewed(user.id, 25),
    listRecentlyUpdated(user.id, 25),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Recent</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Where you have been, and what you have changed.
        </p>
      </header>

      {viewed.length === 0 && updated.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Nothing yet"
          description="Pages you open and edit will collect here, so picking up where you left off does not mean hunting through the sidebar."
        />
      ) : (
        <div className="space-y-8">
          {viewed.length > 0 ? (
            <section>
              <h2 className="text-muted-foreground mb-3 text-sm font-medium tracking-wide uppercase">
                Recently viewed
              </h2>
              <PageLinkList pages={viewed} />
            </section>
          ) : null}

          {updated.length > 0 ? (
            <section>
              <h2 className="text-muted-foreground mb-3 text-sm font-medium tracking-wide uppercase">
                Recently updated
              </h2>
              <PageLinkList pages={updated} />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
