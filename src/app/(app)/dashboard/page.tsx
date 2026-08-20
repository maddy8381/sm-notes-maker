import type { Metadata } from "next";
import Link from "next/link";
import { Clock, FileText, Layers, Star } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { TechnologyCard } from "@/components/technology/technology-card";
import { TechIcon } from "@/components/layout/tech-icon";
import { requireUser } from "@/lib/dal";
import { relativeTime } from "@/lib/utils";
import { getPageStats, listRecentlyUpdated, listRecentlyViewed } from "@/server/pages";
import { listTechnologies } from "@/server/technologies";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();

  // One round trip rather than four sequential ones. Each of these is scoped
  // to `user.id` inside src/server/ — the page never filters anything itself.
  const [technologies, stats, recentlyUpdated, recentlyViewed] = await Promise.all([
    listTechnologies(user.id, { sort: "manual" }),
    getPageStats(user.id),
    listRecentlyUpdated(user.id, 5),
    listRecentlyViewed(user.id, 5),
  ]);

  const firstName = user.name.split(/\s+/)[0] ?? user.name;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {greeting()}, {firstName}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {stats.totalPages === 0
            ? "Nothing written yet — start with a technology below."
            : `${stats.totalPages} ${stats.totalPages === 1 ? "page" : "pages"} across ${stats.totalTechnologies} ${stats.totalTechnologies === 1 ? "technology" : "technologies"}.`}
        </p>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Layers} label="Technologies" value={stats.totalTechnologies} />
        <Stat icon={FileText} label="Pages" value={stats.totalPages} />
        <Stat icon={Clock} label="Updated this week" value={stats.updatedThisWeek} />
        <Stat icon={Star} label="Favorites" value={stats.favorites} />
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
            My Notes
          </h2>
        </div>

        {technologies.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No technologies yet"
            description="A technology is a collection of notes about one thing — React, Postgres, a service you own. Use the + button above to add your first."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {technologies.map((technology) => (
              <TechnologyCard key={technology.id} technology={technology} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <PageList
          heading="Recently updated"
          href="/recent"
          pages={recentlyUpdated}
          emptyMessage="Pages you edit will show up here."
          timestamp={(page) => relativeTime(page.updatedAt)}
        />
        <PageList
          heading="Recently viewed"
          href="/recent"
          pages={recentlyViewed}
          emptyMessage="Pages you open will show up here."
          timestamp={(page) => relativeTime(page.viewedAt)}
        />
      </div>
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="border-border bg-card rounded-xl border p-4">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

type ListedPage = {
  id: string;
  title: string;
  slug: string;
  technology: { name: string; slug: string; icon: string | null };
};

function PageList<T extends ListedPage>({
  heading,
  href,
  pages,
  emptyMessage,
  timestamp,
}: {
  heading: string;
  href: string;
  pages: T[];
  emptyMessage: string;
  timestamp: (page: T) => string;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
          {heading}
        </h2>
        {pages.length > 0 ? (
          <Link
            href={href}
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
          >
            View all
          </Link>
        ) : null}
      </div>

      {pages.length === 0 ? (
        <p className="border-border text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm">
          {emptyMessage}
        </p>
      ) : (
        <ul className="divide-border border-border bg-card divide-y overflow-hidden rounded-xl border">
          {pages.map((page) => (
            <li key={page.id}>
              <Link
                href={`/t/${page.technology.slug}/${page.slug}`}
                className="hover:bg-muted/50 flex items-center gap-3 px-4 py-2.5 transition-colors"
              >
                <TechIcon
                  name={page.technology.icon}
                  className="text-muted-foreground size-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{page.title}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {page.technology.name}
                  </span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {timestamp(page)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
