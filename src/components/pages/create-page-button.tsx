"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { createPage } from "@/app/(app)/actions";
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
import { TEMPLATES } from "@/lib/editor/templates";
import { cn } from "@/lib/utils";

export function CreatePageButton({
  technologyId,
  technologySlug,
  variant = "default",
  label = "New page",
}: {
  technologyId: string;
  technologySlug: string;
  variant?: "default" | "outline";
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState("blank");
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createPage({ technologyId, title, template });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setOpen(false);
      setTitle("");
      setTemplate("blank");
      // Straight into the editor — creating a page and then having to find it
      // would be a pointless extra step.
      router.push(`/t/${technologySlug}/${result.data.slug}`);
    });
  }

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus /> {label}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setTitle("");
            setTemplate("blank");
            setError(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New page</DialogTitle>
            <DialogDescription>
              Pick a template to start with some structure, or go blank.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-page-title">Title</Label>
              <Input
                id="new-page-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Server Components"
                autoFocus
                required
                maxLength={200}
                disabled={pending}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Template</Label>
              <div
                role="radiogroup"
                aria-label="Template"
                className="grid max-h-56 scrollbar-thin gap-1 overflow-y-auto sm:grid-cols-2"
              >
                {TEMPLATES.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={template === option.id}
                    onClick={() => setTemplate(option.id)}
                    disabled={pending}
                    className={cn(
                      "rounded-md border p-2.5 text-left transition-colors",
                      template === option.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      {option.description}
                    </span>
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
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" loading={pending} disabled={!title.trim()}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
