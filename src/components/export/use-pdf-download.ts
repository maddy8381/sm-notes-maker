"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { downloadFromApi } from "@/lib/export/download";

/**
 * Shared behaviour for every "Download PDF" control.
 *
 * Rendering happens on the server and can take a few seconds for a whole
 * technology, so the call has to be visible: a loading toast that resolves
 * into a success or an error, and a `pending` flag the caller can use to
 * disable its trigger. Without the guard, an impatient double-click renders
 * the same document twice.
 */
export function usePdfDownload() {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const download = useCallback(
    async (options: { url: string; filename: string; label: string }) => {
      if (inFlight.current) return;

      inFlight.current = true;
      setPending(true);

      const toastId = toast.loading(`Preparing ${options.label}…`);

      try {
        await downloadFromApi(options.url, options.filename);
        toast.success("PDF downloaded", { id: toastId });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Export failed", {
          id: toastId,
        });
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [],
  );

  return { pending, download };
}

/** Matches `slugify` on the server, for the fallback filename only. */
export function fileSlug(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled"
  );
}
