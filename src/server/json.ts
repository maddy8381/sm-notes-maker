import "server-only";

import type { Prisma } from "@/generated/prisma/client";

/**
 * The one place a document crosses into Prisma's JSON column type.
 *
 * `Prisma.InputJsonValue` is defined with an index signature, which no
 * hand-written interface structurally satisfies — `DocJSON` is a perfectly
 * valid JSON value that TypeScript still refuses to accept. The cast is
 * unavoidable, so it lives here once, named and explained, instead of being
 * repeated as an inline `as any` at every call site.
 *
 * This does not weaken any guarantee: documents are validated by
 * `validateDoc()` before they ever reach a write, and that is what makes the
 * value safe. This function only satisfies the type checker.
 */
export function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
