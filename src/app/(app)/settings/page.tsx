import type { Metadata } from "next";

import {
  NameForm,
  PasswordForm,
  SessionList,
} from "@/components/settings/settings-forms";
import { requireUser } from "@/lib/dal";
import { formatBytes } from "@/lib/utils";
import { getStorageUsage } from "@/server/attachments";
import { getPageStats } from "@/server/pages";
import { listSessions } from "@/server/sessions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();

  const [sessions, stats, storage] = await Promise.all([
    listSessions(user.id),
    getPageStats(user.id),
    getStorageUsage(user.id),
  ]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">{user.email}</p>
      </header>

      <div className="space-y-10">
        <Section title="Profile">
          <NameForm initialName={user.name} />
        </Section>

        <Section
          title="Password"
          description="Changing your password signs out every other device."
        >
          <PasswordForm />
        </Section>

        <Section
          title="Active sessions"
          description="Every device currently signed in to this account. Sign out any you do not recognise."
        >
          <SessionList
            sessions={sessions.map((session) => ({
              ...session,
              // Computed on the server by comparing ids — the session token
              // itself never leaves the cookie.
              isCurrent: session.id === user.sessionId,
            }))}
          />
        </Section>

        <Section title="Usage">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Technologies" value={String(stats.totalTechnologies)} />
            <Stat label="Pages" value={String(stats.totalPages)} />
            <Stat label="Favorites" value={String(stats.favorites)} />
            <Stat label="Images" value={formatBytes(storage)} />
          </dl>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-medium">{title}</h2>
      {description ? (
        <p className="text-muted-foreground mt-0.5 mb-4 text-sm">{description}</p>
      ) : (
        <div className="mb-4" />
      )}
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border bg-card rounded-lg border p-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
