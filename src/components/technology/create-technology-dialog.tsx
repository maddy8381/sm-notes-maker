"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createTechnology } from "@/app/(app)/actions";
import { ICON_NAMES, TechIcon } from "@/components/layout/tech-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function CreateTechnologyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string>("Hexagon");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setDescription("");
    setIcon("Hexagon");
    setError(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createTechnology({
        name,
        description: description || undefined,
        icon,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.success(`Created ${result.data.name}`);
      onOpenChange(false);
      reset();
      router.push(`/t/${result.data.slug}`);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New technology</DialogTitle>
          <DialogDescription>
            A collection of notes about one thing — React, Postgres, a service you own.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tech-name">Name</Label>
            <Input
              id="tech-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Next.js"
              autoFocus
              required
              maxLength={60}
              disabled={pending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tech-description">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="tech-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="App Router, server components, caching"
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
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!name.trim()}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
