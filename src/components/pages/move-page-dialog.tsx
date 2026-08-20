"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { movePage } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function MovePageDialog({
  open,
  onOpenChange,
  page,
  technologies,
  onMoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: { id: string; title: string };
  technologies: { id: string; name: string }[];
  onMoved: (destination: { slug: string; technologySlug: string }) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | null>(null);

  function submit() {
    if (!selected) return;

    startTransition(async () => {
      const result = await movePage({ id: page.id, technologyId: selected });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Moved");
      onOpenChange(false);
      onMoved(result.data);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move “{page.title}”</DialogTitle>
          <DialogDescription>
            Pick where it should live. Its link changes to match.
          </DialogDescription>
        </DialogHeader>

        <div
          role="radiogroup"
          aria-label="Destination"
          className="max-h-64 scrollbar-thin space-y-1 overflow-y-auto"
        >
          {technologies.map((technology) => (
            <button
              key={technology.id}
              type="button"
              role="radio"
              aria-checked={selected === technology.id}
              onClick={() => setSelected(technology.id)}
              disabled={pending}
              className={cn(
                "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                selected === technology.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "hover:bg-muted",
              )}
            >
              {technology.name}
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={!selected}>
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
