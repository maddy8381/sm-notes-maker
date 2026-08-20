import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

import { normalizeLanguage } from "@/lib/editor/schema";

/**
 * Paste and drop handling.
 *
 * ProseMirror already round-trips its own content perfectly: an internal copy
 * carries a serialised slice, so formatting survives without any help. What
 * needs work is everything arriving from *outside* the editor, where the
 * default behaviour loses information that the user can plainly see was there.
 *
 * Three cases are handled here:
 *
 *   1. Images pasted or dropped from the OS or another app, which arrive as
 *      files and would otherwise be ignored entirely.
 *   2. Code pasted from GitHub, VS Code, an LLM chat window or a markdown
 *      renderer. These emit `<pre><code class="language-ts">`, or a bare
 *      indented block, and the language is easy to drop on the floor.
 *   3. Markdown fences typed or pasted as plain text — ```ts on its own line
 *      is a strong enough signal to honour.
 */

export type PasteHandlerOptions = {
  /**
   * Called with the dropped or pasted image files.
   *
   * The editor is passed along rather than left for the caller to capture,
   * so the handler never has to reach for it through a ref during render.
   */
  onImageFiles: (files: File[], editor: Editor) => void;
};

export const PasteHandler = Extension.create<PasteHandlerOptions>({
  name: "pasteHandler",

  addOptions() {
    return { onImageFiles: () => undefined };
  },

  addProseMirrorPlugins() {
    const { onImageFiles } = this.options;
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey("pasteHandler"),

        props: {
          handlePaste: (view, event) => {
            const clipboard = event.clipboardData;
            if (!clipboard) return false;

            const images = imageFilesFrom(clipboard.items);
            if (images.length > 0) {
              event.preventDefault();
              onImageFiles(images, editor);
              return true;
            }

            // An internal copy carries ProseMirror's own slice format. Leaving
            // it alone is what preserves every mark and node exactly — any
            // interference here would make copy/paste within the app *worse*
            // than doing nothing.
            const html = clipboard.getData("text/html");
            if (html.includes("data-pm-slice")) return false;

            const text = clipboard.getData("text/plain");

            // A fenced block pasted as plain text. Only when the fence is the
            // whole paste — a fence in the middle of prose is being quoted,
            // not pasted as code.
            if (!html && text) {
              const fence = text.match(/^```([\w+#-]*)\n([\s\S]*?)\n?```$/);
              if (fence) {
                const language = normalizeLanguage(fence[1] ?? null);
                const code = fence[2] ?? "";

                const { schema, tr } = view.state;
                const node = schema.nodes.codeBlock?.create(
                  { language },
                  code ? schema.text(code) : null,
                );
                if (node) {
                  view.dispatch(tr.replaceSelectionWith(node).scrollIntoView());
                  event.preventDefault();
                  return true;
                }
              }
            }

            return false;
          },

          handleDrop: (view, event) => {
            const dataTransfer = (event as DragEvent).dataTransfer;
            if (!dataTransfer) return false;

            // An image being dragged from elsewhere in the document arrives
            // with no files attached — that is ProseMirror moving the node,
            // which must be left alone or the drag silently does nothing.
            const files = Array.from(dataTransfer.files ?? []).filter((file) =>
              file.type.startsWith("image/"),
            );
            if (files.length === 0) return false;

            event.preventDefault();

            // Insert where the image was dropped rather than at the cursor,
            // which is where the user is looking.
            const position = view.posAtCoords({
              left: (event as DragEvent).clientX,
              top: (event as DragEvent).clientY,
            });
            if (position) {
              const $pos = view.state.doc.resolve(position.pos);
              view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
            }

            onImageFiles(files, editor);
            return true;
          },
        },
      }),
    ];
  },
});

function imageFilesFrom(items: DataTransferItemList): File[] {
  const files: File[] = [];

  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    if (!item.type.startsWith("image/")) continue;

    const file = item.getAsFile();
    if (file) files.push(file);
  }

  return files;
}
