"use client";

import { useMemo } from "react";

import { estimatePasswordStrength } from "@/lib/validation/auth";
import { cn } from "@/lib/utils";

const BAR_COLORS = [
  "bg-destructive",
  "bg-destructive",
  "bg-warning",
  "bg-warning",
  "bg-success",
] as const;

/**
 * A hint, not a gate. The server enforces `passwordSchema`; this only tells
 * the user how they are doing while typing, which is what actually moves
 * people off weak passwords.
 */
export function PasswordStrength({ password }: { password: string }) {
  const strength = useMemo(() => estimatePasswordStrength(password), [password]);

  if (!password) return null;

  return (
    <div className="space-y-1.5 pt-0.5">
      <div className="flex items-center gap-1.5">
        <div className="flex flex-1 gap-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i < strength.score ? BAR_COLORS[strength.score] : "bg-muted",
              )}
            />
          ))}
        </div>
        <span className="text-muted-foreground w-16 text-right text-xs">
          {strength.label}
        </span>
      </div>

      {/* Announced politely so it does not interrupt typing. */}
      <p className="sr-only" aria-live="polite">
        Password strength: {strength.label}
      </p>

      {strength.suggestions.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          {strength.suggestions.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
