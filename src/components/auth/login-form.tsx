"use client";

import { useActionState } from "react";
import Link from "next/link";

import { signIn } from "@/app/(auth)/actions";
import { Field, FormError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

type State = ActionResult<void> | null;

/**
 * `useActionState` gives progressive enhancement for free: the form posts and
 * works even before React hydrates, which matters on a login page because it
 * is the first thing loaded on a cold cache.
 */
export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_previous, formData) => {
      // A successful sign-in redirects, so this only ever returns on failure.
      return signIn({
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        rememberMe: formData.get("rememberMe") === "on",
      });
    },
    null,
  );

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const formError = state && !state.ok && !state.fieldErrors ? state.error : undefined;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />

      <FormError message={formError} />

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        // Autofocus is right here specifically: the whole purpose of this page
        // is to type into this field.
        autoFocus
        required
        placeholder="you@example.com"
        errors={fieldErrors?.email}
        disabled={pending}
      />

      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        errors={fieldErrors?.password}
        disabled={pending}
        action={
          <Link
            href="/forgot-password"
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
            tabIndex={pending ? -1 : undefined}
          >
            Forgot password?
          </Link>
        }
      />

      <label className="text-muted-foreground flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="rememberMe"
          defaultChecked
          disabled={pending}
          className="border-input accent-primary size-4 rounded"
        />
        Keep me signed in for 30 days
      </label>

      <Button type="submit" className="w-full" loading={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
