"use client";

import { useState, useTransition } from "react";
import { Hash, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { setPageTags } from "@/app/(app)/actions";
import { cn } from "@/lib/utils";

type Tag = { id: string; name: string; slug: string; color: string | null };

export function TagEditor({
  pageId,
  initialTags,
}: {
  pageId: string;
  initialTags: Tag[];
}) {
  const [tags, setTags] = useState(initialTags.map((tag) => tag.name));
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [, startTransition] = useTransition();

  function persist(next: string[]) {
    const previous = tags;
    setTags(next);

    startTransition(async () => {
      const result = await setPageTags({ pageId, tags: next });
      if (!result.ok) {
        setTags(previous);
        toast.error(result.error);
      }
    });
  }

  function add() {
    // Leading # is how people type tags; strip it so "#api" and "api" are one
    // tag rather than two.
    const name = draft.trim().replace(/^#+/, "");
    setDraft("");

    if (!name) {
      setAdding(false);
      return;
    }

    if (tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) {
      setAdding(false);
      return;
    }

    persist([...tags, name]);
    // Stay open — adding several tags in a row is the common case.
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="group bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs"
        >
          <Hash className="size-3 shrink-0" aria-hidden />
          {tag}
          <button
            type="button"
            onClick={() => persist(tags.filter((t) => t !== tag))}
            aria-label={`Remove tag ${tag}`}
            className="hover:text-destructive ml-0.5 rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}

      {adding ? (
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={add}
          onKeyDown={(event) => {
            // Comma and Enter both commit — people type tags both ways.
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
            }
            if (event.key === "Escape") {
              setDraft("");
              setAdding(false);
            }
            // Backspace on an empty field removes the last tag, the way every
            // other tag input behaves.
            if (event.key === "Backspace" && !draft && tags.length > 0) {
              persist(tags.slice(0, -1));
            }
          }}
          autoFocus
          maxLength={40}
          placeholder="tag name"
          aria-label="New tag"
          className="border-input bg-background focus-visible:ring-ring/30 h-6 w-28 rounded-md border px-2 text-xs outline-none focus-visible:ring-2"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={cn(
            "text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors",
            tags.length === 0 && "border-border border border-dashed",
          )}
        >
          <Plus className="size-3" aria-hidden />
          {tags.length === 0 ? "Add tags" : "Add"}
        </button>
      )}
    </div>
  );
}
