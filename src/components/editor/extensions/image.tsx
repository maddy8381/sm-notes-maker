"use client";

import { useCallback, useRef, useState } from "react";
import Image from "@tiptap/extension-image";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { AlignCenter, AlignLeft, AlignRight, Trash2, Type } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Image node with drag-to-move, drag-to-resize, captions and alt text.
 *
 * Two behaviours worth calling out, because both are easy to get subtly wrong:
 *
 * 1. **Dragging to reposition.** `draggable: true` on the node spec plus
 *    `data-drag-handle` on an element inside the node view is what makes
 *    ProseMirror move the node through the document rather than starting a
 *    text selection. The handle is the image itself, so it behaves the way it
 *    looks like it should.
 *
 * 2. **Resizing.** The width is written back into the node's attributes, so it
 *    is part of the document and survives reload, copy/paste and export.
 *    Resizing is driven by pointer events on window rather than by React
 *    state per frame — a state update per mousemove makes the drag stutter on
 *    a large document.
 */

const MIN_WIDTH = 80;

type Align = "left" | "center" | "right";

function ImageView({
  node,
  updateAttributes,
  deleteNode,
  editor,
  selected,
}: NodeViewProps) {
  const { src, alt, caption, width, align } = node.attrs as {
    src: string;
    alt: string | null;
    caption: string | null;
    width: number | null;
    align: Align;
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [resizing, setResizing] = useState(false);
  const [editingCaption, setEditingCaption] = useState(false);
  const [draftCaption, setDraftCaption] = useState(caption ?? "");

  // Follow the stored caption when it changes underneath — an undo, say.
  // Adjusted during render rather than in an effect, so the input never shows
  // a stale value for a frame.
  const [lastCaption, setLastCaption] = useState(caption);
  if (caption !== lastCaption) {
    setLastCaption(caption);
    setDraftCaption(caption ?? "");
  }

  const startResize = useCallback(
    (event: React.PointerEvent, edge: "left" | "right") => {
      if (!editor.isEditable) return;

      event.preventDefault();
      event.stopPropagation();

      const image = imageRef.current;
      const container = containerRef.current;
      if (!image || !container) return;

      const startX = event.clientX;
      const startWidth = image.offsetWidth;
      // Never let an image exceed the column it sits in.
      const maxWidth = container.parentElement?.offsetWidth ?? 10_000;

      setResizing(true);

      // The element is mutated directly during the drag and the attribute is
      // written once on release. Doing it through React state instead would
      // dispatch a ProseMirror transaction per frame, which is both janky and
      // fills the undo stack with dozens of intermediate widths.
      const onMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        const next = edge === "right" ? startWidth + delta : startWidth - delta;
        image.style.width = `${Math.max(MIN_WIDTH, Math.min(next, maxWidth))}px`;
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setResizing(false);
        updateAttributes({ width: Math.round(image.offsetWidth) });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [editor.isEditable, updateAttributes],
  );

  function commitCaption() {
    setEditingCaption(false);
    const trimmed = draftCaption.trim();
    if (trimmed !== (caption ?? "")) {
      updateAttributes({ caption: trimmed || null });
    }
  }

  return (
    <NodeViewWrapper
      className={cn(
        "my-4 flex",
        align === "left" && "justify-start",
        align === "right" && "justify-end",
        align === "center" && "justify-center",
      )}
    >
      <div
        ref={containerRef}
        className={cn(
          "group relative inline-block max-w-full",
          selected && "ring-ring ring-offset-background ring-2 ring-offset-2",
          resizing && "select-none",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the width is
            user-controlled and changes per drag, which next/image's required
            static dimensions cannot express. Sources are restricted to our own
            blob storage by sanitizeImageSrc, so there is no untrusted origin. */}
        <img
          ref={imageRef}
          src={src}
          alt={alt ?? ""}
          // This attribute is what tells ProseMirror the image itself is the
          // drag handle, so it can be picked up and dropped anywhere in the
          // document.
          data-drag-handle
          draggable={editor.isEditable}
          style={width ? { width: `${width}px` } : undefined}
          className={cn(
            "block h-auto max-w-full rounded-lg",
            editor.isEditable && "cursor-grab active:cursor-grabbing",
          )}
        />

        {editor.isEditable ? (
          <>
            {(["left", "right"] as const).map((edge) => (
              <button
                key={edge}
                type="button"
                aria-label={`Resize from the ${edge}`}
                onPointerDown={(event) => startResize(event, edge)}
                contentEditable={false}
                className={cn(
                  "bg-primary absolute top-1/2 h-12 w-1.5 -translate-y-1/2 cursor-ew-resize rounded-full opacity-0 transition-opacity",
                  "group-hover:opacity-90 focus-visible:opacity-100",
                  edge === "left" ? "left-1.5" : "right-1.5",
                )}
              />
            ))}

            <div
              contentEditable={false}
              className="border-border bg-background/95 absolute top-2 right-2 flex items-center gap-0.5 rounded-md border p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 focus-within:opacity-100"
            >
              {(
                [
                  ["left", AlignLeft],
                  ["center", AlignCenter],
                  ["right", AlignRight],
                ] as const
              ).map(([value, Icon]) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`Align ${value}`}
                  aria-pressed={align === value}
                  onClick={() => updateAttributes({ align: value })}
                  className={cn(
                    "rounded p-1 transition-colors",
                    align === value
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                </button>
              ))}

              <span className="bg-border mx-0.5 h-4 w-px" aria-hidden />

              <button
                type="button"
                aria-label="Edit caption and alt text"
                onClick={() => setEditingCaption(true)}
                className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1 transition-colors"
              >
                <Type className="size-3.5" />
              </button>

              <button
                type="button"
                aria-label="Delete image"
                onClick={() => deleteNode()}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded p-1 transition-colors"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </>
        ) : null}

        {editingCaption ? (
          <div contentEditable={false} className="mt-2 space-y-1.5">
            <input
              value={draftCaption}
              onChange={(event) => setDraftCaption(event.target.value)}
              onBlur={commitCaption}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitCaption();
                }
                if (event.key === "Escape") {
                  setDraftCaption(caption ?? "");
                  setEditingCaption(false);
                }
              }}
              placeholder="Caption"
              autoFocus
              maxLength={500}
              className="border-input bg-background focus-visible:ring-ring/30 w-full rounded border px-2 py-1 text-sm outline-none focus-visible:ring-2"
            />
            <input
              defaultValue={alt ?? ""}
              onBlur={(event) =>
                updateAttributes({ alt: event.target.value.trim() || null })
              }
              placeholder="Alt text — describe the image for screen readers"
              maxLength={500}
              className="border-input bg-background focus-visible:ring-ring/30 w-full rounded border px-2 py-1 text-xs outline-none focus-visible:ring-2"
            />
          </div>
        ) : caption ? (
          <figcaption
            contentEditable={false}
            className="text-muted-foreground mt-2 text-center text-xs"
          >
            {caption}
          </figcaption>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}

export const ResizableImage = Image.extend({
  // Makes ProseMirror treat the node as a unit that can be picked up and
  // dropped elsewhere, rather than as inline content to select through.
  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("width") ?? element.style.width;
          const parsed = Number.parseInt(value ?? "", 10);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        },
        renderHTML: (attributes) =>
          attributes.width ? { width: attributes.width } : {},
      },
      height: {
        default: null,
        parseHTML: (element) => {
          const parsed = Number.parseInt(element.getAttribute("height") ?? "", 10);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        },
        renderHTML: (attributes) =>
          attributes.height ? { height: attributes.height } : {},
      },
      // Carried on the node so a copied image keeps its caption and alignment
      // when pasted somewhere else.
      caption: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-caption"),
        renderHTML: (attributes) =>
          attributes.caption ? { "data-caption": attributes.caption } : {},
      },
      align: {
        default: "center",
        parseHTML: (element) => element.getAttribute("data-align") ?? "center",
        renderHTML: (attributes) => ({ "data-align": attributes.align ?? "center" }),
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
}).configure({
  inline: false,
  // Only ever set to a blob URL this app issued — see sanitizeImageSrc.
  allowBase64: true,
});
