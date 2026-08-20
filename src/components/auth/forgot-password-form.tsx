"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";

import { requestPasswordReset } from "@/app/(auth)/actions";
import { Field, FormError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

type State = ActionResult<void> | null;

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_previous, formData) =>
      requestPasswordReset({ email: String(formData.get("email") ?? "") }),
    null,
  );

  // Success here means "we processed the request", not "that account exists".
  // The copy is worded to be true either way — telling the user whether the
  // address was found is exactly the leak this flow is designed to avoid.
  if (state?.ok) {
    return (
      <div className="border-border bg-muted/40 space-y-3 rounded-lg border p-4 text-center">
        <MailCheck className="text-success mx-auto size-6" aria-hidden />
        <p className="text-sm font-medium">Check your email</p>
        <p className="text-muted-foreground text-sm">
          If an account exists for that address, a link to reset the password is on its
          way. The link expires in an hour.
        </p>
      </div>
    );
  }

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const formError = state && !state.ok && !state.fieldErrors ? state.error : undefined;

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={formError} />

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        autoFocus
        required
        placeholder="you@example.com"
        errors={fieldErrors?.email}
        disabled={pending}
      />

      <Button type="submit" className="w-full" loading={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
