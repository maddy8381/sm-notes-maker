"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, RotateCcw, Star, X } from "lucide-react";
import { toast } from "sonner";

import { recordPageView, setPageFavorite } from "@/app/(app)/actions";
import { Editor } from "@/components/editor/editor";
import { PageMenu } from "@/components/editor/page-menu";
import { SaveIndicator } from "@/components/editor/save-indicator";
import { TagEditor } from "@/components/editor/tag-editor";
import { useAutosave } from "@/components/editor/use-autosave";
import { Button } from "@/components/ui/button";
import type { DocJSON } from "@/lib/editor/content";
import { clearDraft, readDraft, type Draft } from "@/lib/editor/drafts";
import { cn } from "@/lib/utils";
import type { PageDetail } from "@/server/pages";

export function PageEditor({
  page,
  technologies,
}: {
  page: PageDetail;
  technologies: { id: string; name: string }[];
}) {
  const router = useRouter();

  const [title, setTitle] = useState(page.title);
  const [favorite, setFavorite] = useState(page.isFavorite);
  const [recoverable, setRecoverable] = useState<Draft | null>(null);

  const contentRef = useRef<DocJSON>(page.content);
  const editorRef = useRef<{ commands: { setContent: (c: unknown) => void } } | null>(
    null,
  );

  const autosave = useAutosave({
    pageId: page.id,
    initialRevision: page.revision,
  });

  // Record the view once per mount. Not awaited — "recently viewed" being a
  // moment behind is fine, and blocking the editor on it would not be.
  useEffect(() => {
    void recordPageView({ id: page.id });
  }, [page.id]);

  /**
   * A draft left behind means the previous session's last edit never reached
   * the server. Rather than restoring it silently — which would quietly
   * discard whatever the server does have — offer the choice.
   */
  useEffect(() => {
    let cancelled = false;

    void readDraft(page.id).then((draft) => {
      if (cancelled || !draft) return;

      // Older than what the server holds: the page has been edited since, so
      // this draft is stale and safe to drop.
      if (draft.revision < page.revision) {
        void clearDraft(page.id);
        return;
      }

      // Identical to what loaded — the save did land, the acknowledgement just
      // never got written. Nothing to recover.
      if (JSON.stringify(draft.content) === JSON.stringify(page.content)) {
        void clearDraft(page.id);
        return;
      }

      setRecoverable(draft);
    });

    return () => {
      cancelled = true;
    };
  }, [page.id, page.revision, page.content]);

  const onContentChange = useCallback(
    (content: DocJSON) => {
      contentRef.current = content;
      autosave.schedule({ title, content });
    },
    [autosave, title],
  );

  const onTitleChange = useCallback(
    (next: string) => {
      setTitle(next);
      autosave.schedule({ title: next, content: contentRef.current });
    },
    [autosave],
  );

  function toggleFavorite() {
    const next = !favorite;
    setFavorite(next);

    void setPageFavorite({ id: page.id, isFavorite: next }).then((result) => {
      if (!result.ok) {
        setFavorite(!next);
        toast.error(result.error);
      }
    });
  }

  function restoreDraft() {
    if (!recoverable) return;

    editorRef.current?.commands.setContent(recoverable.content);
    setTitle(recoverable.title);
    contentRef.current = recoverable.content;
    autosave.schedule({ title: recoverable.title, content: recoverable.content });
    setRecoverable(null);
    toast.success("Restored your unsaved changes");
  }

  function discardDraft() {
    void clearDraft(page.id);
    setRecoverable(null);
  }

  return (
    <div className="tn-print-page mx-auto max-w-3xl px-4 py-6 md:px-8">
      <div className="tn-print-hide">
        <nav
          aria-label="Breadcrumb"
          className="text-muted-foreground mb-4 flex items-center gap-1 text-sm"
        >
          <Link
            href={`/t/${page.technology.slug}`}
            className="hover:text-foreground truncate transition-colors"
          >
            {page.technology.name}
          </Link>
          <ChevronRight className="size-3.5 shrink-0" aria-hidden />
          <span className="text-foreground truncate">{title || "Untitled"}</span>
        </nav>

        {recoverable ? (
          <div
            role="alert"
            className="border-warning/40 bg-warning/10 mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-3 text-sm"
          >
            <RotateCcw className="text-warning size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              You have unsaved changes from{" "}
              {new Date(recoverable.savedAt).toLocaleString()} that never reached the
              server.
            </span>
            <span className="flex shrink-0 gap-2">
              <Button size="sm" onClick={restoreDraft}>
                Restore
              </Button>
              <Button size="sm" variant="outline" onClick={discardDraft}>
                <X className="size-3.5" /> Discard
              </Button>
            </span>
          </div>
        ) : null}

        <div className="mb-2 flex items-center gap-2">
          <SaveIndicator
            status={autosave.status}
            lastSavedAt={autosave.lastSavedAt}
            onReload={() => router.refresh()}
          />

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={toggleFavorite}
              aria-label={favorite ? "Unfavorite" : "Favorite"}
              aria-pressed={favorite}
              className={cn(
                "rounded p-1.5 transition-colors",
                favorite
                  ? "text-warning"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Star className={cn("size-4", favorite && "fill-current")} />
            </button>

            <PageMenu
              page={page}
              title={title}
              technologies={technologies}
              onBeforeNavigate={() => autosave.flushNow()}
            />
          </div>
        </div>
      </div>

      <input
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        onBlur={() => void autosave.flushNow()}
        placeholder="Untitled"
        maxLength={200}
        aria-label="Page title"
        className="placeholder:text-muted-foreground/50 w-full border-0 bg-transparent text-3xl font-semibold tracking-tight outline-none"
      />

      <div className="tn-print-hide mt-3">
        <TagEditor pageId={page.id} initialTags={page.tags} />
      </div>

      <Editor
        content={page.content}
        onChange={onContentChange}
        onReady={(editor) => {
          editorRef.current = editor as never;
        }}
      />
    </div>
  );
}
