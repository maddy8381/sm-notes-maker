"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileDown, MoreHorizontal, Pencil, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteTechnology, setTechnologyFavorite } from "@/app/(app)/actions";
import { fileSlug, usePdfDownload } from "@/components/export/use-pdf-download";
import { TechIcon } from "@/components/layout/tech-icon";
import { RenameTechnologyDialog } from "@/components/technology/rename-technology-dialog";
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
import { cn, pluralize, relativeTime } from "@/lib/utils";
import type { TechnologySummary } from "@/server/technologies";

export function TechnologyCard({ technology }: { technology: TechnologySummary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pdf = usePdfDownload();

  // Optimistic so the star fills the instant it is clicked. The server is the
  // authority; a failure reverts and says so.
  const [favorite, setFavorite] = useState(technology.isFavorite);

  function toggleFavorite(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    const next = !favorite;
    setFavorite(next);

    startTransition(async () => {
      const result = await setTechnologyFavorite({
        id: technology.id,
        isFavorite: next,
      });
      if (!result.ok) {
        setFavorite(!next);
        toast.error(result.error);
      }
    });
  }

  function exportPdf() {
    void pdf.download({
      url: `/api/export/technologies/${technology.id}`,
      filename: `${fileSlug(technology.name)}-notes.pdf`,
      label: `${technology.name} PDF`,
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteTechnology({ id: technology.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Moved ${technology.name} to trash`, {
        description: "Restore it from Trash if that was a mistake.",
      });
      router.refresh();
    });
  }

  return (
    <>
      <Link
        href={`/t/${technology.slug}`}
        className={cn(
          "group border-border bg-card relative flex flex-col gap-3 rounded-xl border p-4 transition-all",
          "hover:border-foreground/15 hover:shadow-sm",
          pending && "opacity-60",
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg"
            aria-hidden
          >
            <TechIcon name={technology.icon} className="size-4.5" />
          </span>

          <div className="min-w-0 flex-1">
            <h3 className="truncate leading-tight font-medium">{technology.name}</h3>
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-sm">
              {technology.description || "No description"}
            </p>
          </div>

          {/* Controls sit above the card link so a click on them does not
              navigate. */}
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={toggleFavorite}
              aria-label={favorite ? "Unpin" : "Pin"}
              aria-pressed={favorite}
              className={cn(
                "rounded p-1 transition-colors",
                favorite
                  ? "text-warning"
                  : "text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              )}
            >
              <Star className={cn("size-4", favorite && "fill-current")} />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                aria-label={`Options for ${technology.name}`}
                className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1 opacity-0 transition-colors group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="end"
                onClick={(event) => event.preventDefault()}
              >
                <DropdownMenuItem
                  onSelect={() => {
                    setRenameOpen(true);
                  }}
                >
                  <Pencil /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={pdf.pending || technology.pageCount === 0}
                  onSelect={exportPdf}
                >
                  <FileDown /> Download as PDF
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive
                  onSelect={() => {
                    setConfirmOpen(true);
                  }}
                >
                  <Trash2 /> Move to trash
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="text-muted-foreground mt-auto flex items-center gap-2 text-xs">
          <span>
            {technology.pageCount} {pluralize(technology.pageCount, "page")}
          </span>
          <span aria-hidden>·</span>
          <span>Updated {relativeTime(technology.updatedAt)}</span>
        </div>
      </Link>

      <RenameTechnologyDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        technology={technology}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move “{technology.name}” to trash?</AlertDialogTitle>
            <AlertDialogDescription>
              Its {technology.pageCount} {pluralize(technology.pageCount, "page")} will
              go with it. You can restore everything from Trash.
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
