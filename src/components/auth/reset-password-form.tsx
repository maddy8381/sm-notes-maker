"use client";

import { useActionState, useState } from "react";

import { resetPassword } from "@/app/(auth)/actions";
import { Field, FormError } from "@/components/auth/field";
import { PasswordStrength } from "@/components/auth/password-strength";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

type State = ActionResult<void> | null;

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");

  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_previous, formData) =>
      resetPassword({
        token,
        password: String(formData.get("password") ?? ""),
        confirmPassword: String(formData.get("confirmPassword") ?? ""),
      }),
    null,
  );

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const formError = state && !state.ok && !state.fieldErrors ? state.error : undefined;

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={formError} />

      <div className="space-y-1.5">
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          errors={fieldErrors?.password}
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
        errors={fieldErrors?.confirmPassword}
        disabled={pending}
      />

      <p className="text-muted-foreground text-xs">
        Changing your password signs you out everywhere else.
      </p>

      <Button type="submit" className="w-full" loading={pending}>
        {pending ? "Updating…" : "Set new password"}
      </Button>
    </form>
  );
}
