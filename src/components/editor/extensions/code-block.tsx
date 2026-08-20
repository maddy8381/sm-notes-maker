"use client";

import { useCallback, useState } from "react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Check, Copy } from "lucide-react";
import { createLowlight, common } from "lowlight";

import {
  CODE_LANGUAGES,
  CODE_LANGUAGE_LABELS,
  normalizeLanguage,
  type CodeLanguage,
} from "@/lib/editor/schema";
import { cn } from "@/lib/utils";

const lowlight = createLowlight(common);

/**
 * Code block with syntax highlighting, a language picker and a copy button.
 *
 * The copy behaviour is the interesting part. Two different things are wanted
 * from the same block:
 *
 *   - Copying the block to paste into a terminal or an IDE, where only the
 *     raw text matters and any markup would be noise.
 *   - Copying the block to paste back into a note, where it should arrive as a
 *     code block with its language still set, not as a flattened paragraph.
 *
 * Both are satisfied by writing two flavours to the clipboard at once:
 * `text/plain` carries the bare source, `text/html` carries
 * `<pre><code class="language-x">`. Whichever target receives the paste picks
 * the flavour it understands. See `parseHTML` below for the receiving half.
 */
function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const [copied, setCopied] = useState(false);
  const language = normalizeLanguage(node.attrs.language as string | null);

  const copy = useCallback(async () => {
    const code = node.textContent;

    try {
      // ClipboardItem lets one copy carry several representations. Without the
      // text/html flavour, pasting back into the editor produces a plain
      // paragraph and the language is lost.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const html =
          `<pre data-language="${language}">` +
          `<code class="language-${language}">${escapeHtml(code)}</code></pre>`;

        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([code], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
      } else {
        // Firefox has historically lacked clipboard.write. Plain text still
        // works, which is the flavour that matters most.
        await navigator.clipboard.writeText(code);
      }

      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [node.textContent, language]);

  return (
    <NodeViewWrapper className="group relative my-4">
      <div className="tn-print-hide absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <select
          value={language}
          onChange={(event) => updateAttributes({ language: event.target.value })}
          disabled={!editor.isEditable}
          aria-label="Code language"
          className="border-border bg-background text-muted-foreground focus-visible:ring-ring/30 h-7 rounded border px-1.5 text-xs outline-none focus-visible:ring-2"
          // Keep ProseMirror from treating interaction with the select as
          // editing the document.
          contentEditable={false}
        >
          {CODE_LANGUAGES.map((value) => (
            <option key={value} value={value}>
              {CODE_LANGUAGE_LABELS[value as CodeLanguage]}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
          contentEditable={false}
          className={cn(
            "border-border bg-background flex h-7 items-center gap-1 rounded border px-2 text-xs transition-colors",
            copied ? "text-success" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <pre className="border-border bg-muted/50 overflow-x-auto rounded-lg border p-4 text-sm">
        {/* The element type is passed explicitly: NodeViewContent wraps `as` in
            NoInfer, so TypeScript cannot deduce it from the prop alone. */}
        <NodeViewContent<"code"> as="code" className={`language-${language}`} />
      </pre>
    </NodeViewWrapper>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const CodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: "plaintext",
        // Normalising on the way in is what makes a paste from GitHub, VS Code
        // or a markdown file keep its language: those sources write
        // `language-ts`, `lang-sh`, `highlight-source-js` and similar, none of
        // which match our own vocabulary without mapping.
        parseHTML: (element) => {
          const fromData = element.getAttribute("data-language");
          if (fromData) return normalizeLanguage(fromData);

          const code = element.querySelector("code");
          const classes = [
            code?.getAttribute("class") ?? "",
            element.getAttribute("class") ?? "",
          ].join(" ");

          const match = classes.match(
            /(?:language|lang|highlight-source|highlight-text)[-_]([\w+#-]+)/i,
          );
          return normalizeLanguage(match?.[1] ?? null);
        },
        renderHTML: (attributes) => ({
          "data-language": attributes.language,
          class: `language-${attributes.language}`,
        }),
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({
  lowlight,
  // Off: it makes every triple-backtick in prose become a code block, which is
  // wrong more often than it is right when writing about markdown.
  exitOnTripleEnter: false,
  // Arrow-down out of a trailing code block, which is otherwise a trap at the
  // end of a document.
  exitOnArrowDown: true,
});
