"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { updateTechnology } from "@/app/(app)/actions";
import { ICON_NAMES, TechIcon } from "@/components/layout/tech-icon";
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
import { cn } from "@/lib/utils";

export function RenameTechnologyDialog({
  open,
  onOpenChange,
  technology,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technology: {
    id: string;
    name: string;
    description: string | null;
    icon: string | null;
  };
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit technology</DialogTitle>
        </DialogHeader>

        {/* Mounted only while open, so the props are real initial state and a
            cancelled edit is discarded by unmounting. Re-seeding from an
            effect instead is the cascading-render pattern React now warns
            about. */}
        {open ? (
          <EditTechnologyForm
            technology={technology}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditTechnologyForm({
  technology,
  onClose,
}: {
  technology: {
    id: string;
    name: string;
    description: string | null;
    icon: string | null;
  };
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(technology.name);
  const [description, setDescription] = useState(technology.description ?? "");
  const [icon, setIcon] = useState(technology.icon ?? "Hexagon");
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await updateTechnology({
        id: technology.id,
        name,
        description: description || null,
        icon,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.success("Saved");
      onClose();
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="rename-name">Name</Label>
        <Input
          id="rename-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
          maxLength={60}
          disabled={pending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rename-description">Description</Label>
        <Input
          id="rename-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
          disabled={pending}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Icon</Label>
        <div role="radiogroup" aria-label="Icon" className="grid grid-cols-8 gap-1">
          {ICON_NAMES.map((iconName) => (
            <button
              key={iconName}
              type="button"
              role="radio"
              aria-checked={icon === iconName}
              aria-label={iconName}
              onClick={() => setIcon(iconName)}
              disabled={pending}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md border transition-colors",
                icon === iconName
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground border-transparent",
              )}
            >
              <TechIcon name={iconName} className="size-4" />
            </button>
          ))}
        </div>
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
        <Button type="submit" loading={pending} disabled={!name.trim()}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
