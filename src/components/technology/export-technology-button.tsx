"use client";

import { FileDown } from "lucide-react";

import { fileSlug, usePdfDownload } from "@/components/export/use-pdf-download";
import { Button } from "@/components/ui/button";

/**
 * Downloads every note in a technology as one PDF — cover, contents, then the
 * pages in the order they are listed on this screen.
 *
 * Sits next to "New page" rather than behind the overflow menu: exporting a
 * whole module is the reason someone opens this screen with a deadline, and
 * hiding it one click deeper is the difference between a feature being found
 * and not.
 */
export function ExportTechnologyButton({
  technologyId,
  name,
  disabled,
}: {
  technologyId: string;
  name: string;
  disabled?: boolean;
}) {
  const pdf = usePdfDownload();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      loading={pdf.pending}
      onClick={() =>
        void pdf.download({
          url: `/api/export/technologies/${technologyId}`,
          filename: `${fileSlug(name)}-notes.pdf`,
          label: `${name} PDF`,
        })
      }
    >
      {pdf.pending ? null : <FileDown />}
      {pdf.pending ? "Preparing…" : "Download PDF"}
    </Button>
  );
}
