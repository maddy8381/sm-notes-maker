"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { savePage } from "@/app/(app)/actions";
import { serializeDoc, type DocJSON } from "@/lib/editor/content";
import { clearDraft, writeDraft } from "@/lib/editor/drafts";

export type SaveStatus =
  "idle" | "dirty" | "saving" | "saved" | "offline" | "conflict" | "error";

const DEBOUNCE_MS = 800;

type Payload = { title: string; content: DocJSON };

/**
 * Debounced autosave with two safeguards the plain version lacks.
 *
 * **Conflict detection.** Every save carries the revision the editor loaded.
 * If the stored revision has moved on — a second tab, another device — the
 * server refuses the write instead of silently overwriting. The user is told
 * rather than losing a paragraph they never saw disappear.
 *
 * **A local draft.** The pending document is mirrored to IndexedDB *before*
 * the request goes out and cleared on acknowledgement, so a dropped connection
 * or a closed laptop mid-keystroke does not lose the text.
 */
export function useAutosave({
  pageId,
  initialRevision,
  onSaved,
}: {
  pageId: string;
  initialRevision: number;
  onSaved?: (revision: number) => void;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const revisionRef = useRef(initialRevision);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Payload | null>(null);
  const inFlightRef = useRef(false);

  // No reset-on-page-change logic here by design. PageEditor is mounted with
  // `key={page.id}`, so navigating to another note unmounts this hook and
  // mounts a fresh one. That is stronger than resetting: there is no window in
  // which a debounced flush could fire with the previous page's payload
  // against the new page's id, and no refs to clear.

  // `flush` re-arms itself when edits land mid-request. Referencing itself
  // directly inside its own useCallback defeats the React Compiler's
  // memoization analysis, so the retry goes through this ref instead.
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  const flush = useCallback(async () => {
    const payload = pendingRef.current;
    if (!payload || inFlightRef.current) return;

    inFlightRef.current = true;
    setStatus("saving");

    // Written before the request, so an interrupted save still leaves the text
    // recoverable on next load.
    await writeDraft({
      pageId,
      title: payload.title,
      content: payload.content,
      revision: revisionRef.current,
    });

    try {
      const result = await savePage({
        id: pageId,
        title: payload.title,
        // Serialized deliberately: a nested object passed to a Server Action
        // arrives lazily materialized and loses node attributes. See
        // docJsonStringSchema in lib/editor/content.ts.
        content: serializeDoc(payload.content),
        expectedRevision: revisionRef.current,
      });

      if (result.ok) {
        revisionRef.current = result.data.revision;
        // Only clear the pending payload if nothing new arrived while the
        // request was in flight; otherwise those keystrokes would be dropped.
        if (pendingRef.current === payload) pendingRef.current = null;

        await clearDraft(pageId);
        setStatus("saved");
        setLastSavedAt(new Date());
        onSaved?.(result.data.revision);
      } else if (result.code === "stale_revision") {
        // The draft is deliberately left in place: it is the only copy of
        // these edits, and the conflict banner offers to restore it.
        setStatus("conflict");
      } else {
        setStatus("error");
      }
    } catch {
      // Network failure. The draft survives, so this is recoverable.
      setStatus(navigator.onLine ? "error" : "offline");
    } finally {
      inFlightRef.current = false;

      // Something was typed during the request — go round again.
      if (pendingRef.current) {
        timerRef.current = setTimeout(() => void flushRef.current?.(), DEBOUNCE_MS);
      }
    }
  }, [pageId, onSaved]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const schedule = useCallback(
    (payload: Payload) => {
      pendingRef.current = payload;
      setStatus((current) => (current === "conflict" ? current : "dirty"));

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [flush],
  );

  /** Saves immediately — on blur, or before navigating away. */
  const flushNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    return flush();
  }, [flush]);

  // Flush on tab hide rather than on unload: `beforeunload` is unreliable on
  // mobile, where a backgrounded tab is often killed without firing it, and
  // visibilitychange is the event that actually fires when you switch apps.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "hidden" && pendingRef.current) {
        void flush();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [flush]);

  useEffect(() => {
    function onOnline() {
      if (pendingRef.current) void flush();
      else setStatus((current) => (current === "offline" ? "idle" : current));
    }
    function onOffline() {
      setStatus("offline");
    }

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flush]);

  // Warn only when there is genuinely unsaved work.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (pendingRef.current) event.preventDefault();
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    status,
    lastSavedAt,
    schedule,
    flushNow,
    revision: revisionRef,
    hasPendingChanges: () => pendingRef.current !== null,
  };
}
