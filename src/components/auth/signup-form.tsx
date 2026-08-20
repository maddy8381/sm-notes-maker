"use client";

import { useActionState, useState } from "react";

import { signUp } from "@/app/(auth)/actions";
import { Field, FormError } from "@/components/auth/field";
import { PasswordStrength } from "@/components/auth/password-strength";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

type State = ActionResult<void> | null;

export function SignupForm() {
  // Tracked in state purely to drive the strength meter — the value posts
  // through the form like everything else.
  const [password, setPassword] = useState("");

  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_previous, formData) =>
      signUp({
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
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

      <Field
        label="Name"
        name="name"
        autoComplete="name"
        autoFocus
        required
        placeholder="Ada Lovelace"
        errors={fieldErrors?.name}
        disabled={pending}
      />

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="you@example.com"
        errors={fieldErrors?.email}
        disabled={pending}
      />

      <div className="space-y-1.5">
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          errors={fieldErrors?.password}
          disabled={pending}
          description="At least 12 characters. A memorable phrase beats a short scramble."
        />
        <PasswordStrength password={password} />
      </div>

      <Field
        label="Confirm password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        errors={fieldErrors?.confirmPassword}
        disabled={pending}
      />

      <Button type="submit" className="w-full" loading={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
