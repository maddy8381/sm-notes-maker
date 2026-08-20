"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Layers, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  purgePage,
  purgeTechnology,
  restorePage,
  restoreTechnology,
} from "@/app/(app)/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/utils";

type Item = {
  id: string;
  kind: "technology" | "page";
  title: string;
  context?: string;
  deletedAt: Date;
};

export function TrashList({ items }: { items: Item[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function restore(item: Item) {
    startTransition(async () => {
      const result =
        item.kind === "technology"
          ? await restoreTechnology({ id: item.id })
          : await restorePage({ id: item.id });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(`Restored “${item.title}”`);
      router.refresh();
    });
  }

  function purge(item: Item) {
    startTransition(async () => {
      const result =
        item.kind === "technology"
          ? await purgeTechnology({ id: item.id })
          : await purgePage({ id: item.id });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Deleted permanently");
      router.refresh();
    });
  }

  return (
    <ul className="divide-border border-border bg-card divide-y overflow-hidden rounded-xl border">
      {items.map((item) => (
        <li
          key={`${item.kind}-${item.id}`}
          className="flex items-center gap-3 px-4 py-3"
        >
          {item.kind === "technology" ? (
            <Layers className="text-muted-foreground size-4 shrink-0" aria-hidden />
          ) : (
            <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
          )}

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{item.title}</span>
            <span className="text-muted-foreground block truncate text-xs">
              {item.context ? `${item.context} · ` : ""}
              Deleted {relativeTime(item.deletedAt)}
            </span>
          </span>

          <Button
            size="sm"
            variant="outline"
            onClick={() => restore(item)}
            disabled={pending}
          >
            <RotateCcw /> Restore
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete ${item.title} permanently`}
                disabled={pending}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>

            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Permanently delete “{item.title}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  {/* Stated plainly, because this is the one action in the app
                      that cannot be undone. */}
                  This cannot be undone.
                  {item.kind === "technology" ? " Every page inside it goes too." : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => purge(item)}>
                  Delete permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </li>
      ))}
    </ul>
  );
}
