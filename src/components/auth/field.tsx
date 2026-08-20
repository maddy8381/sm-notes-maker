"use client";

import { useId } from "react";
import { AlertCircle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A labelled input that knows how to display its own server-side errors.
 *
 * The wiring matters more than it looks: `aria-invalid` plus
 * `aria-describedby` are what make a validation failure reach a screen reader
 * at all. Red text on its own announces nothing.
 */
export function Field({
  label,
  errors,
  action,
  description,
  ...props
}: Omit<React.ComponentProps<"input">, "id"> & {
  label: string;
  errors?: string[] | undefined;
  /** Rendered opposite the label — the "Forgot password?" link, typically. */
  action?: React.ReactNode;
  /** Persistent helper text, e.g. password requirements. */
  description?: React.ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  const hasError = Boolean(errors?.length);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {action}
      </div>

      <Input
        id={id}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : description ? descriptionId : undefined}
        {...props}
      />

      {hasError ? (
        <p
          id={errorId}
          // role="alert" so the message is announced when it appears after a
          // failed submit, not only when the field receives focus.
          role="alert"
          className="text-destructive flex items-start gap-1.5 text-xs"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{errors?.[0]}</span>
        </p>
      ) : description ? (
        <p id={descriptionId} className="text-muted-foreground text-xs">
          {description}
        </p>
      ) : null}
    </div>
  );
}

/** Form-level error banner, for failures that belong to no single field. */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
