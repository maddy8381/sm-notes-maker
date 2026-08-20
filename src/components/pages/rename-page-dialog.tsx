"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { renamePage } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RenamePageDialog({
  open,
  onOpenChange,
  page,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: { id: string; title: string };
  onRenamed: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename page</DialogTitle>
        </DialogHeader>

        {/* Mounted only while open, so `page.title` is genuine initial state.
            The alternative — resetting the fields from an effect whenever
            `open` flips — is the cascading-render pattern the React Compiler
            rules flag, and it also loses an in-progress edit if the parent
            re-renders. */}
        {open ? (
          <RenamePageForm
            page={page}
            onDone={onRenamed}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RenamePageForm({
  page,
  onDone,
  onClose,
}: {
  page: { id: string; title: string };
  onDone: () => void;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(page.title);
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await renamePage({ id: page.id, title });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Renamed");
      onClose();
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="page-title">Title</Label>
        <Input
          id="page-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
          maxLength={200}
          disabled={pending}
        />
        <p className="text-muted-foreground text-xs">
          The page&apos;s link stays the same, so anything you have already shared keeps
          working.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} disabled={!title.trim()}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
