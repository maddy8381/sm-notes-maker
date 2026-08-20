import type { z } from "zod";

/**
 * The shape every Server Action returns.
 *
 * Actions never throw for expected outcomes — a taken email, a stale
 * revision, a missing page. Throwing across the server/client boundary in
 * production gives the client a redacted "an error occurred", which is useless
 * for showing the user what to fix. Returning a discriminated union keeps the
 * failure typed and displayable.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      /** Per-field messages, keyed by form field name, for inline display. */
      fieldErrors?: Record<string, string[]>;
      code?: ActionErrorCode;
    };

export type ActionErrorCode =
  | "unauthorized"
  | "not_found"
  | "validation"
  | "conflict"
  | "rate_limited"
  | "stale_revision"
  | "internal";

export function ok(): ActionResult<void>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function fail(
  error: string,
  options: { code?: ActionErrorCode; fieldErrors?: Record<string, string[]> } = {},
): ActionResult<never> {
  return {
    ok: false,
    error,
    ...(options.code ? { code: options.code } : {}),
    ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
  };
}

/** Flattens a Zod error into the per-field shape the forms render. */
export function fromZodError(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }

  const first = Object.values(fieldErrors)[0]?.[0];

  return fail(first ?? "Please check the form and try again.", {
    code: "validation",
    fieldErrors,
  });
}
