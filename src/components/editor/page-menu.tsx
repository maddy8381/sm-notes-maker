"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  Download,
  FileDown,
  FileText,
  FolderInput,
  Layers,
  MoreHorizontal,
  Printer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { deletePage, duplicatePage } from "@/app/(app)/actions";
import { usePdfDownload } from "@/components/export/use-pdf-download";
import { MovePageDialog } from "@/components/pages/move-page-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toMarkdown } from "@/lib/editor/markdown";
import type { PageDetail } from "@/server/pages";

export function PageMenu({
  page,
  title,
  technologies,
  onBeforeNavigate,
}: {
  page: PageDetail;
  title: string;
  technologies: { id: string; name: string }[];
  onBeforeNavigate: () => Promise<void> | void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pdf = usePdfDownload();

  function download(filename: string, contents: string, type: string) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;
    anchor.click();

    URL.revokeObjectURL(url);
  }

  function exportMarkdown() {
    download(
      `${slugForFile(title)}.md`,
      toMarkdown(page.content, title),
      "text/markdown",
    );
  }

  function exportJson() {
    download(
      `${slugForFile(title)}.json`,
      JSON.stringify({ title, content: page.content }, null, 2),
      "application/json",
    );
  }

  function exportPdf() {
    void (async () => {
      // Same reason as `duplicate`: the PDF is rendered from stored content,
      // so anything still sitting in the editor has to be saved first.
      await onBeforeNavigate();
      await pdf.download({
        url: `/api/export/pages/${page.id}`,
        filename: `${slugForFile(title)}.pdf`,
        label: "PDF",
      });
    })();
  }

  /**
   * The whole collection this page belongs to, bound into one PDF. Offered
   * here as well as on the technology screen because "give me everything on
   * this subject" is a thought that arrives while reading one page of it.
   */
  function exportTechnologyPdf() {
    void (async () => {
      await onBeforeNavigate();
      await pdf.download({
        url: `/api/export/technologies/${page.technology.id}`,
        filename: `${slugForFile(page.technology.name)}-notes.pdf`,
        label: `${page.technology.name} PDF`,
      });
    })();
  }

  function duplicate() {
    startTransition(async () => {
      // Flush first, or the copy is made from what the server last saw rather
      // than from what is on screen.
      await onBeforeNavigate();

      const result = await duplicatePage({ id: page.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.push(`/t/${page.technology.slug}/${result.data.slug}`);
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deletePage({ id: page.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Moved to trash");
      router.push(`/t/${page.technology.slug}`);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Page options"
          className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1.5 transition-colors"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={duplicate}>
            <Copy /> Duplicate
          </DropdownMenuItem>
          {technologies.length > 0 ? (
            <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
              <FolderInput /> Move to…
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />

          <DropdownMenuItem disabled={pdf.pending} onSelect={exportPdf}>
            <FileText /> Download this page as PDF
          </DropdownMenuItem>
          <DropdownMenuItem disabled={pdf.pending} onSelect={exportTechnologyPdf}>
            <Layers /> Download all {page.technology.name} pages
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={exportMarkdown}>
            <FileDown /> Export as Markdown
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={exportJson}>
            <Download /> Export as JSON
          </DropdownMenuItem>
          {/* Kept alongside the PDF download: printing uses the browser's own
              renderer, which is the better answer when someone wants the page
              exactly as it looks on screen. */}
          <DropdownMenuItem onSelect={() => window.print()}>
            <Printer /> Print…
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
            <Trash2 /> Move to trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <MovePageDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        page={{ id: page.id, title }}
        technologies={technologies}
        onMoved={(destination) =>
          router.push(`/t/${destination.technologySlug}/${destination.slug}`)
        }
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move “{title}” to trash?</AlertDialogTitle>
            <AlertDialogDescription>
              You can restore it from Trash.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Move to trash</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function slugForFile(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}
