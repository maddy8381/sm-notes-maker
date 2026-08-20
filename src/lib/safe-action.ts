import "server-only";

import { z } from "zod";

import { getCurrentUser, type CurrentUser } from "@/lib/dal";
import { fail, fromZodError, type ActionResult } from "@/lib/action-result";
import { isDevelopment } from "@/lib/env";

/**
 * Wraps a Server Action so that authentication, input validation and error
 * handling cannot be skipped.
 *
 * This is the other half of the isolation guarantee (the first being the
 * ESLint rule that keeps Prisma inside src/server/). A handler written through
 * this wrapper receives an already-authenticated `user` and already-parsed
 * `input`; there is no code path that reaches the body without both. "Forgot
 * to check the session" stops being a mistake that compiles.
 *
 *   export const renamePage = authedAction(
 *     z.object({ id: z.string(), title: z.string().min(1) }),
 *     async ({ user, input }) => { ... },
 *   );
 */
export function authedAction<TInput extends z.ZodType, TOutput>(
  schema: TInput,
  handler: (ctx: {
    user: CurrentUser;
    input: z.infer<TInput>;
  }) => Promise<ActionResult<TOutput>>,
): (input: z.input<TInput>) => Promise<ActionResult<TOutput>> {
  return async (rawInput) => {
    const user = await getCurrentUser();
    if (!user) {
      return fail("You need to sign in to do that.", { code: "unauthorized" });
    }

    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      return fromZodError(parsed.error);
    }

    try {
      return await handler({ user, input: parsed.data });
    } catch (error) {
      return handleUnexpected(error);
    }
  };
}

/**
 * For actions that genuinely take no arguments (sign out, delete all trash).
 */
export function authedActionNoInput<TOutput>(
  handler: (ctx: { user: CurrentUser }) => Promise<ActionResult<TOutput>>,
): () => Promise<ActionResult<TOutput>> {
  return async () => {
    const user = await getCurrentUser();
    if (!user) {
      return fail("You need to sign in to do that.", { code: "unauthorized" });
    }

    try {
      return await handler({ user });
    } catch (error) {
      return handleUnexpected(error);
    }
  };
}

/**
 * Unauthenticated actions — sign up, sign in, request a reset. Still get Zod
 * parsing and the same error contract, just no session requirement.
 */
export function publicAction<TInput extends z.ZodType, TOutput>(
  schema: TInput,
  handler: (ctx: { input: z.infer<TInput> }) => Promise<ActionResult<TOutput>>,
): (input: z.input<TInput>) => Promise<ActionResult<TOutput>> {
  return async (rawInput) => {
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      return fromZodError(parsed.error);
    }

    try {
      return await handler({ input: parsed.data });
    } catch (error) {
      return handleUnexpected(error);
    }
  };
}

function handleUnexpected(error: unknown): ActionResult<never> {
  // redirect() and notFound() work by throwing. Rethrow so Next can do its job
  // rather than reporting a successful navigation as a server error.
  if (isNextControlFlow(error)) throw error;

  console.error("[action]", error instanceof Error ? error.stack : error);

  return fail(
    isDevelopment && error instanceof Error
      ? error.message
      : "Something went wrong. Please try again.",
    { code: "internal" },
  );
}

function isNextControlFlow(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK)/.test(
      (error as { digest: string }).digest,
    )
  );
}
