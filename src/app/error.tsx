"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The root error boundary.
 *
 * Deliberately does not show `error.message`: in production Next replaces it
 * with a generic string anyway, and in development the overlay already gives a
 * far better view. The digest is shown because it is the one thing that lets
 * a reported problem be matched to a server log line.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <span
        className="bg-destructive/10 text-destructive mb-4 flex size-12 items-center justify-center rounded-full"
        aria-hidden
      >
        <AlertTriangle className="size-6" />
      </span>

      <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground mt-1.5 max-w-sm text-sm">
        The page could not be loaded. Your notes are safe — this failed while displaying
        them, not while saving.
      </p>

      <div className="mt-6 flex gap-2">
        <Button onClick={reset}>
          <RotateCcw /> Try again
        </Button>
        <Button variant="outline" asChild>
          <a href="/dashboard">Go to dashboard</a>
        </Button>
      </div>

      {error.digest ? (
        <p className="text-muted-foreground mt-6 font-mono text-xs">
          Reference: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
