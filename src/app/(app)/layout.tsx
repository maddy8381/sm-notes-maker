import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/dal";
import { listTechnologies } from "@/server/technologies";

/**
 * The authorization boundary for everything under (app).
 *
 * `requireUser()` here is the real check — proxy.ts only looked at whether a
 * cookie existed. A layout is the right place for it because it runs before
 * any child route renders, so no page beneath this can be reached without a
 * valid session.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const technologies = await listTechnologies(user.id, { sort: "manual" });

  return (
    <AppShell
      user={{ name: user.name, email: user.email }}
      technologies={technologies.map((tech) => ({
        id: tech.id,
        name: tech.name,
        slug: tech.slug,
        icon: tech.icon,
        isFavorite: tech.isFavorite,
        pageCount: tech.pageCount,
      }))}
    >
      {children}
    </AppShell>
  );
}
