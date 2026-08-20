"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  Download,
  FileDown,
  FolderInput,
  MoreHorizontal,
  Printer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { deletePage, duplicatePage } from "@/app/(app)/actions";
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

          <DropdownMenuItem onSelect={exportMarkdown}>
            <FileDown /> Export as Markdown
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={exportJson}>
            <Download /> Export as JSON
          </DropdownMenuItem>
          {/* Print rather than a server-side renderer: the browser already has
              the fonts and styles, and it avoids shipping headless Chrome. */}
          <DropdownMenuItem onSelect={() => window.print()}>
            <Printer /> Print / Save as PDF
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
