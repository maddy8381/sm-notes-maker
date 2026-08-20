"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EditorContent,
  useEditor,
  type Editor as TiptapEditor,
  type JSONContent,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CharacterCount from "@tiptap/extension-character-count";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { toast } from "sonner";

import { CodeBlock } from "@/components/editor/extensions/code-block";
import { ResizableImage } from "@/components/editor/extensions/image";
import { PasteHandler } from "@/components/editor/extensions/paste-handler";
import { Toolbar } from "@/components/editor/toolbar";
import { uploadImage } from "@/lib/editor/upload";
import type { DocJSON } from "@/lib/editor/content";
import { cn } from "@/lib/utils";

export function Editor({
  content,
  editable = true,
  onChange,
  onReady,
}: {
  content: DocJSON;
  editable?: boolean;
  onChange?: (content: DocJSON) => void;
  onReady?: (editor: TiptapEditor) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);

  // The editor is always passed in explicitly — by the paste/drop plugin, or
  // by the file input below. Reaching for it through a ref would mean reading
  // a ref during render, which React forbids.
  const handleImageFiles = useCallback(
    async (files: File[], instance: TiptapEditor) => {
      for (const file of files) {
        setUploading((count) => count + 1);

        // A local object URL goes in immediately so the image appears at once
        // rather than after the network round trip. It is swapped for the real
        // URL below, and never reaches the database — sanitizeImageSrc would
        // reject a blob: URL anyway.
        const objectUrl = URL.createObjectURL(file);

        instance.chain().focus().setImage({ src: objectUrl, alt: file.name }).run();

        const result = await uploadImage(file);
        setUploading((count) => count - 1);

        if (!result.ok) {
          toast.error(result.error);
          // Remove the placeholder, or the note keeps an image that only
          // renders in this tab and vanishes on reload.
          removeImageBySrc(instance, objectUrl);
          URL.revokeObjectURL(objectUrl);
          continue;
        }

        replaceImageSrc(instance, objectUrl, {
          src: result.url,
          width: result.width,
          height: result.height,
        });
        URL.revokeObjectURL(objectUrl);
      }
    },
    [],
  );

  // The last content reported as saved, serialized. See onCreate/onUpdate.
  const baselineRef = useRef<string | null>(null);

  const editor = useEditor({
    // Rendering on the server produces markup React then has to reconcile with
    // ProseMirror's own DOM, which reliably warns about hydration mismatch.
    immediatelyRender: false,
    editable,
    content: content as JSONContent,

    extensions: [
      StarterKit.configure({
        // Replaced by the version with syntax highlighting and a copy button.
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: {
            // External links open in a new tab; rel closes the reverse-tabnabbing
            // hole that target="_blank" otherwise opens.
            target: "_blank",
            rel: "noopener noreferrer nofollow",
          },
        },
      }),
      CodeBlock,
      ResizableImage,
      TaskList,
      TaskItem.configure({ nested: true }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      CharacterCount,
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading"
            ? "Heading"
            : "Write something, or press / for commands",
      }),
      PasteHandler.configure({
        onImageFiles: (files, instance) => void handleImageFiles(files, instance),
      }),
    ],

    editorProps: {
      attributes: {
        class: "focus:outline-none",
        spellcheck: "true",
      },
    },

    onCreate: ({ editor: instance }) => {
      // The baseline is the editor's *own* serialization of the loaded
      // document, not the JSON that came from the database. Parsing fills in
      // attribute defaults the stored JSON does not carry, so the two never
      // match byte for byte and comparing against the stored copy would report
      // a change on every load.
      baselineRef.current = JSON.stringify(instance.getJSON());
    },

    onUpdate: ({ editor: instance, transaction }) => {
      if (!transaction.docChanged) return;

      const json = instance.getJSON();

      // Loading content is itself a document change, so without this an
      // untouched page would autosave — bumping the revision on every open and
      // making a second tab look like a conflict for no reason.
      const serialized = JSON.stringify(json);
      if (serialized === baselineRef.current) return;
      baselineRef.current = serialized;

      onChange?.(json as DocJSON);
    },
  });

  useEffect(() => {
    if (editor) onReady?.(editor);

    // Dev-only handle for debugging from the console. Stripped in production
    // builds because the condition folds to false at compile time.
    if (process.env.NODE_ENV !== "production" && editor) {
      (window as unknown as { __tnEditor?: unknown }).__tnEditor = editor;
    }
  }, [editor, onReady]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  if (!editor) {
    return (
      <div className="space-y-3 py-4" aria-busy>
        <div className="bg-muted h-4 w-3/4 animate-pulse rounded" />
        <div className="bg-muted h-4 w-full animate-pulse rounded" />
        <div className="bg-muted h-4 w-5/6 animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div>
      {editable ? (
        <>
          <Toolbar editor={editor} onPickImage={() => fileInputRef.current?.click()} />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
            multiple
            className="sr-only"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) void handleImageFiles(files, editor);
              // Reset so picking the same file twice in a row still fires.
              event.target.value = "";
            }}
          />
        </>
      ) : null}

      {uploading > 0 ? (
        <p className="text-muted-foreground py-2 text-xs" aria-live="polite">
          Uploading {uploading} {uploading === 1 ? "image" : "images"}…
        </p>
      ) : null}

      <EditorContent
        editor={editor}
        className={cn(
          "tn-prose py-4",
          // Enough height that clicking below the last line still puts the
          // cursor in the document.
          "min-h-[60vh]",
        )}
      />

      {editable ? (
        <p className="border-border text-muted-foreground border-t pt-3 text-xs">
          {editor.storage.characterCount.words()} words ·{" "}
          {editor.storage.characterCount.characters()} characters
        </p>
      ) : null}
    </div>
  );
}

/**
 * Swaps a placeholder object URL for the uploaded one, preserving whatever the
 * user may have already done to the node (moved it, resized it, captioned it)
 * while the upload was in flight.
 */
function replaceImageSrc(
  editor: TiptapEditor,
  from: string,
  to: { src: string; width: number | null; height: number | null },
) {
  const { state, view } = editor;
  let transaction = state.tr;
  let found = false;

  state.doc.descendants((node, pos) => {
    if (node.type.name === "image" && node.attrs.src === from) {
      transaction = transaction.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        src: to.src,
        // Only set intrinsic dimensions if the user has not resized already.
        width: node.attrs.width ?? to.width,
        height: node.attrs.height ?? to.height,
      });
      found = true;
    }
  });

  if (found) view.dispatch(transaction);
}

function removeImageBySrc(editor: TiptapEditor, src: string) {
  const { state, view } = editor;
  let transaction = state.tr;
  let found = false;

  // Walked in reverse so that deleting one node does not shift the positions
  // of the ones not yet visited.
  const positions: { pos: number; size: number }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === "image" && node.attrs.src === src) {
      positions.push({ pos, size: node.nodeSize });
    }
  });

  for (const { pos, size } of positions.reverse()) {
    transaction = transaction.delete(pos, pos + size);
    found = true;
  }

  if (found) view.dispatch(transaction);
}
