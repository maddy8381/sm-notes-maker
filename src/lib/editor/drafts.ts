import { del, get, set } from "idb-keyval";

import type { DocJSON } from "@/lib/editor/content";

/**
 * A local mirror of unsaved work.
 *
 * Debounced autosave leaves a window — typically under a second, but longer on
 * a bad connection — where what is on screen exists nowhere but memory.
 * Closing the laptop, losing wifi or a crashed tab in that window loses it.
 * This is the single most common way a notes app loses writing, and it is
 * cheap to prevent.
 *
 * IndexedDB rather than localStorage: it is asynchronous (so it does not block
 * the main thread while typing), has a far larger quota, and stores structured
 * objects without a JSON round trip.
 *
 * The draft is written *before* the save request goes out and cleared once the
 * server acknowledges. So a draft existing on load means exactly one thing:
 * the last edit did not make it to the server.
 */

export type Draft = {
  pageId: string;
  title: string;
  content: DocJSON;
  /** The revision the editor was on when this draft was written. */
  revision: number;
  savedAt: number;
};

const PREFIX = "tn.draft.";

function key(pageId: string): string {
  return `${PREFIX}${pageId}`;
}

export async function writeDraft(draft: Omit<Draft, "savedAt">): Promise<void> {
  try {
    await set(key(draft.pageId), { ...draft, savedAt: Date.now() } satisfies Draft);
  } catch {
    // Private browsing, a full quota, or a browser with IndexedDB disabled.
    // The draft buffer is a safety net; losing it must never break editing.
  }
}

export async function readDraft(pageId: string): Promise<Draft | null> {
  try {
    return (await get<Draft>(key(pageId))) ?? null;
  } catch {
    return null;
  }
}

export async function clearDraft(pageId: string): Promise<void> {
  try {
    await del(key(pageId));
  } catch {
    // As above.
  }
}

/**
 * Whether a stored draft is worth offering to restore.
 *
 * A draft from an older revision than the server currently has means the page
 * was edited elsewhere in the meantime; restoring it blindly would undo that
 * newer work, so the caller has to ask rather than assume.
 */
export function draftIsNewerThan(draft: Draft | null, revision: number): boolean {
  return draft !== null && draft.revision >= revision;
}
