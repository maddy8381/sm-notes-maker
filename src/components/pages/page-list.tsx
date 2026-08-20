"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Copy,
  FileText,
  FolderInput,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  deletePage,
  duplicatePage,
  reorderPage,
  setPageFavorite,
} from "@/app/(app)/actions";
import { MovePageDialog } from "@/components/pages/move-page-dialog";
import { RenamePageDialog } from "@/components/pages/rename-page-dialog";
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
import { cn, relativeTime } from "@/lib/utils";
import type { PageSummary } from "@/server/pages";

type Props = {
  pages: PageSummary[];
  technologyId: string;
  technologySlug: string;
  otherTechnologies: { id: string; name: string }[];
};

export function PageList({
  pages: initialPages,
  technologyId,
  technologySlug,
  otherTechnologies,
}: Props) {
  const router = useRouter();
  // Local copy so a drag reorders immediately instead of waiting for the
  // server round trip.
  const [pages, setPages] = useState(initialPages);

  // The server remains the source of truth: after a revalidate the prop
  // changes and local state has to follow, or a rename made elsewhere never
  // appears here. Adjusted during render rather than in an effect, so the list
  // never paints one frame of stale order.
  const [lastServerPages, setLastServerPages] = useState(initialPages);
  if (initialPages !== lastServerPages) {
    setLastServerPages(initialPages);
    setPages(initialPages);
  }

  const sensors = useSensors(
    // A small activation distance so a click on the row still navigates —
    // without it, every click registers as a drag of zero pixels.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = useMemo(() => pages.map((page) => page.id), [pages]);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = pages.findIndex((page) => page.id === active.id);
    const to = pages.findIndex((page) => page.id === over.id);
    if (from === -1 || to === -1) return;

    const previous = pages;
    // Reorder locally first: waiting for the round trip makes the row snap
    // back under the cursor, which reads as the drag having failed.
    setPages(arrayMove(pages, from, to));

    void reorderPage({ id: String(active.id), toIndex: to, technologyId }).then(
      (result) => {
        if (!result.ok) {
          setPages(previous);
          toast.error(result.error);
        }
      },
    );
  }

  if (pages.length === 0) return null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="divide-border border-border bg-card divide-y overflow-hidden rounded-xl border">
          {pages.map((page) => (
            <PageRow
              key={page.id}
              page={page}
              technologySlug={technologySlug}
              otherTechnologies={otherTechnologies}
              onChanged={() => router.refresh()}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function PageRow({
  page,
  technologySlug,
  otherTechnologies,
  onChanged,
}: {
  page: PageSummary;
  technologySlug: string;
  otherTechnologies: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [favorite, setFavorite] = useState(page.isFavorite);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: page.id });

  function toggleFavorite(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    const next = !favorite;
    setFavorite(next);

    startTransition(async () => {
      const result = await setPageFavorite({ id: page.id, isFavorite: next });
      if (!result.ok) {
        setFavorite(!next);
        toast.error(result.error);
      }
    });
  }

  function duplicate() {
    startTransition(async () => {
      const result = await duplicatePage({ id: page.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Duplicated");
      onChanged();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deletePage({ id: page.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Moved “${page.title}” to trash`);
      onChanged();
    });
  }

  return (
    <>
      <li
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cn(
          "group bg-card relative",
          isDragging && "z-10 shadow-lg",
          pending && "opacity-60",
        )}
      >
        <div className="flex items-center gap-1 pr-2">
          <button
            type="button"
            // Drag handle rather than a draggable row: dragging from anywhere
            // would make text selection inside the list impossible.
            className="text-muted-foreground cursor-grab touch-none p-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
            aria-label={`Reorder ${page.title}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>

          <Link
            href={`/t/${technologySlug}/${page.slug}`}
            className="flex min-w-0 flex-1 items-center gap-3 py-2.5 transition-colors"
          >
            <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{page.title}</span>
              {page.excerpt ? (
                <span className="text-muted-foreground block truncate text-xs">
                  {page.excerpt}
                </span>
              ) : (
                <span className="text-muted-foreground block truncate text-xs italic">
                  Empty page
                </span>
              )}
            </span>

            {page.tags.length > 0 ? (
              <span className="hidden shrink-0 items-center gap-1 sm:flex">
                {page.tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag.id}
                    className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]"
                  >
                    #{tag.name}
                  </span>
                ))}
              </span>
            ) : null}

            <span className="text-muted-foreground hidden shrink-0 text-xs sm:block">
              {relativeTime(page.updatedAt)}
            </span>
          </Link>

          <button
            type="button"
            onClick={toggleFavorite}
            aria-label={favorite ? "Unfavorite" : "Favorite"}
            aria-pressed={favorite}
            className={cn(
              "shrink-0 rounded p-1.5 transition-colors",
              favorite
                ? "text-warning"
                : "text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            )}
          >
            <Star className={cn("size-4", favorite && "fill-current")} />
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Options for ${page.title}`}
              className="text-muted-foreground hover:bg-muted hover:text-foreground shrink-0 rounded p-1.5 opacity-0 transition-colors group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                <Pencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={duplicate}>
                <Copy /> Duplicate
              </DropdownMenuItem>
              {otherTechnologies.length > 0 ? (
                <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
                  <FolderInput /> Move to…
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
                <Trash2 /> Move to trash
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </li>

      <RenamePageDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        page={page}
        onRenamed={onChanged}
      />

      <MovePageDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        page={page}
        technologies={otherTechnologies}
        onMoved={(destination) => {
          router.push(`/t/${destination.technologySlug}/${destination.slug}`);
        }}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move “{page.title}” to trash?</AlertDialogTitle>
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
