"use client";

import { AlertTriangle, Check, CloudOff, Loader2, RefreshCw } from "lucide-react";

import type { SaveStatus } from "@/components/editor/use-autosave";
import { cn } from "@/lib/utils";

/**
 * Tells the truth about where the user's writing currently lives.
 *
 * "Saved" here means the server acknowledged it. The other states matter more:
 * "Offline" and "Conflict" both mean the text exists only in this browser, and
 * saying so is the difference between a recoverable situation and someone
 * closing the tab believing their work was safe.
 */
export function SaveIndicator({
  status,
  lastSavedAt,
  onReload,
}: {
  status: SaveStatus;
  lastSavedAt: Date | null;
  onReload?: () => void;
}) {
  if (status === "conflict") {
    return (
      <span className="text-warning flex items-center gap-1.5 text-xs">
        <AlertTriangle className="size-3.5" aria-hidden />
        Edited elsewhere
        {onReload ? (
          <button
            type="button"
            onClick={onReload}
            className="hover:text-foreground inline-flex items-center gap-1 underline underline-offset-2"
          >
            <RefreshCw className="size-3" aria-hidden />
            Reload
          </button>
        ) : null}
      </span>
    );
  }

  if (status === "offline") {
    return (
      <span className="text-warning flex items-center gap-1.5 text-xs">
        <CloudOff className="size-3.5" aria-hidden />
        Offline — changes kept on this device
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="text-destructive flex items-center gap-1.5 text-xs">
        <AlertTriangle className="size-3.5" aria-hidden />
        Could not save — retrying
      </span>
    );
  }

  return (
    <span
      className={cn(
        "text-muted-foreground flex items-center gap-1.5 text-xs",
        status === "saving" && "text-muted-foreground",
      )}
      // Announced politely so a screen reader mentions saves between
      // sentences rather than interrupting typing.
      aria-live="polite"
      // A stable hook for the E2E suite. Matching on the visible words is a
      // trap here: Playwright's getByText is a case-insensitive *substring*
      // match, so "Saved" also matches "Unsaved" — which made a test pass the
      // moment the editor went dirty, long before anything reached the server.
      data-testid="save-status"
      data-status={status}
    >
      {status === "saving" ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Saving…
        </>
      ) : status === "dirty" ? (
        <>
          <span className="bg-muted-foreground size-1.5 rounded-full" aria-hidden />
          Unsaved
        </>
      ) : status === "saved" || lastSavedAt ? (
        <>
          <Check className="text-success size-3.5" aria-hidden />
          Saved
        </>
      ) : null}
    </span>
  );
}
