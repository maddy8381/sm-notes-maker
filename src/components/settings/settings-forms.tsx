"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Laptop, LogOut } from "lucide-react";
import { toast } from "sonner";

import {
  changePassword,
  revokeSession,
  signOutOtherSessions,
  updateName,
} from "@/app/(app)/settings/actions";
import { Field, FormError } from "@/components/auth/field";
import { PasswordStrength } from "@/components/auth/password-strength";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/utils";

export function NameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await updateName({ name });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Name updated");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <FormError message={error} />
      <Field
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={80}
        required
        disabled={pending}
      />
      <Button type="submit" loading={pending} disabled={name === initialName}>
        Save
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setErrors(null);

    const form = event.target as HTMLFormElement;
    const data = new FormData(form);

    startTransition(async () => {
      const result = await changePassword({
        currentPassword: String(data.get("currentPassword") ?? ""),
        password: String(data.get("password") ?? ""),
        confirmPassword: String(data.get("confirmPassword") ?? ""),
      });

      if (!result.ok) {
        setErrors(result.fieldErrors ?? null);
        if (!result.fieldErrors) setError(result.error);
        return;
      }

      form.reset();
      setPassword("");
      toast.success("Password changed", {
        description: "Every other session has been signed out.",
      });
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <FormError message={error} />

      <Field
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        errors={errors?.currentPassword}
        disabled={pending}
      />

      <div className="space-y-1.5">
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          errors={errors?.password}
          disabled={pending}
          description="At least 12 characters."
        />
        <PasswordStrength password={password} />
      </div>

      <Field
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        errors={errors?.confirmPassword}
        disabled={pending}
      />

      <Button type="submit" loading={pending}>
        Change password
      </Button>
    </form>
  );
}

export type SessionRow = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  isCurrent: boolean;
};

export function SessionList({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function revoke(sessionId: string) {
    startTransition(async () => {
      const result = await revokeSession({ sessionId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Signed out");
      router.refresh();
    });
  }

  function revokeAll() {
    startTransition(async () => {
      const result = await signOutOtherSessions({});
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.count === 0
          ? "No other sessions were active"
          : `Signed out ${result.data.count} other ${result.data.count === 1 ? "session" : "sessions"}`,
      );
      router.refresh();
    });
  }

  const others = sessions.filter((session) => !session.isCurrent);

  return (
    <div className="space-y-3">
      <ul className="divide-border border-border divide-y overflow-hidden rounded-lg border">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center gap-3 px-3.5 py-3">
            <Laptop className="text-muted-foreground size-4 shrink-0" aria-hidden />

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                {describeUserAgent(session.userAgent)}
                {session.isCurrent ? (
                  <span className="bg-success/15 text-success ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium">
                    This device
                  </span>
                ) : null}
              </span>
              <span className="text-muted-foreground block truncate text-xs">
                {session.ip ? `${session.ip} · ` : ""}
                Last used {relativeTime(session.lastUsedAt)}
              </span>
            </span>

            {!session.isCurrent ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => revoke(session.id)}
                disabled={pending}
              >
                Sign out
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {others.length > 0 ? (
        <Button variant="outline" onClick={revokeAll} disabled={pending}>
          <LogOut /> Sign out everywhere else
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A readable device name from a user agent string.
 *
 * Rough on purpose: this exists so someone can recognise their own devices in
 * the list, not to fingerprint them. A full UA string is unreadable and a
 * proper parser is a dependency for no gain here.
 */
function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";

  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser";

  const platform = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";

  return platform ? `${browser} on ${platform}` : browser;
}
