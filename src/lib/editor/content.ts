import { z } from "zod";

import { imageSrcForPathname, pathnameFromImageSrc } from "@/lib/editor/image-src";
import {
  ALLOWED_LINK_PROTOCOLS,
  MARK_TYPES,
  NODE_TYPES,
  isCodeLanguage,
  type MarkType,
  type NodeType,
} from "@/lib/editor/schema";

/**
 * Validation and analysis of stored ProseMirror documents.
 *
 * Everything here runs on the server, on the write path. The rule is that a
 * document which fails validation is never persisted, so anything already in
 * the database is safe to render without sanitizing.
 */

export type DocNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

export type DocJSON = { type: "doc"; content?: DocNode[] };

export const EMPTY_DOC: DocJSON = { type: "doc", content: [] };

/**
 * Caps. A single note is a note, not a database — these keep one runaway
 * paste from becoming a row nothing can load, and bound the work that
 * validation and text extraction have to do.
 */
const MAX_DEPTH = 24;
const MAX_NODES = 20_000;
const MAX_TEXT_LENGTH = 2_000_000;

const nodeTypeSet = new Set<string>(NODE_TYPES);
const markTypeSet = new Set<string>(MARK_TYPES);

export type ValidationResult =
  { ok: true; doc: DocJSON } | { ok: false; reason: string };

/**
 * Validates and normalizes an incoming document.
 *
 * Unknown node and mark types are dropped rather than rejected. That choice is
 * deliberate: a version skew — user on an older tab, or a paste carrying a
 * node the app does not model — should lose that fragment, not fail the whole
 * save and leave the user unable to write. Structural problems (wrong root,
 * excessive depth) still reject outright.
 */
export function validateDoc(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, reason: "Content must be an object" };
  }

  const root = input as DocNode;
  if (root.type !== "doc") {
    return { ok: false, reason: "Content must be a document" };
  }

  let nodeCount = 0;
  let textLength = 0;

  const visit = (node: DocNode, depth: number): DocNode | null => {
    if (depth > MAX_DEPTH) throw new DocTooComplex("Content is nested too deeply");
    if (++nodeCount > MAX_NODES) throw new DocTooComplex("Content is too large");

    if (typeof node?.type !== "string" || !nodeTypeSet.has(node.type)) {
      return null;
    }

    const cleaned: DocNode = { type: node.type };

    if (node.type === "text") {
      if (typeof node.text !== "string") return null;
      textLength += node.text.length;
      if (textLength > MAX_TEXT_LENGTH) {
        throw new DocTooComplex("Content is too large");
      }
      cleaned.text = node.text;
    }

    const attrs = sanitizeAttrs(node.type as NodeType, node.attrs);
    if (attrs) cleaned.attrs = attrs;

    // An image is nothing but its src. When the src does not survive the host
    // allowlist — a `blob:` placeholder saved while an upload was still in
    // flight, or one whose upload then failed — keeping the node stores a
    // permanent ghost: invisible in the editor, and an "[image]" placeholder
    // in any export. Same reasoning as the link mark above: drop it.
    if (node.type === "image" && !cleaned.attrs?.src) return null;

    if (Array.isArray(node.marks)) {
      const marks = node.marks
        .filter((m) => typeof m?.type === "string" && markTypeSet.has(m.type))
        .map((m) => {
          const markAttrs = sanitizeMarkAttrs(m.type as MarkType, m.attrs);
          return markAttrs ? { type: m.type, attrs: markAttrs } : { type: m.type };
        })
        // A link whose href did not survive sanitizing would render as an
        // anchor with no destination; drop the mark instead.
        .filter((m) => m.type !== "link" || m.attrs?.href);

      if (marks.length > 0) cleaned.marks = marks;
    }

    if (Array.isArray(node.content)) {
      const children = node.content
        .map((child) => visit(child, depth + 1))
        .filter((child): child is DocNode => child !== null);
      if (children.length > 0) cleaned.content = children;
    }

    return cleaned;
  };

  try {
    const children = Array.isArray(root.content)
      ? root.content
          .map((child) => visit(child, 1))
          .filter((child): child is DocNode => child !== null)
      : [];

    return { ok: true, doc: { type: "doc", content: children } };
  } catch (error) {
    if (error instanceof DocTooComplex) return { ok: false, reason: error.message };
    throw error;
  }
}

class DocTooComplex extends Error {}

/**
 * Zod wrapper for use inside action schemas.
 *
 * This *transforms* rather than merely validating, and that distinction is
 * load-bearing. `z.custom` would check the document and then hand the original
 * object through untouched — so the rebuilt, allowlisted copy that
 * `validateDoc` constructs would be thrown away and the raw client payload
 * stored instead, defeating the entire sanitizing pass.
 *
 * Returning `result.doc` also guarantees the value reaching Prisma is a plain
 * object built here. Objects that arrive through a Server Action are proxies,
 * and Prisma's JSON serializer throws when it probes them for Symbol.toStringTag.
 */
export const docSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    const result = validateDoc(value);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.reason });
    }
  })
  .transform((value) => {
    const result = validateDoc(value);
    // Unreachable: superRefine above has already rejected anything invalid.
    return result.ok ? result.doc : EMPTY_DOC;
  });

/** Roughly 8 MB of JSON — far beyond any real note, but bounded. */
const MAX_SERIALIZED_LENGTH = 8_000_000;

/**
 * The document as it crosses the network to a Server Action: a JSON string,
 * not a nested object.
 *
 * This is not stylistic. React's Server Action deserialization hands the
 * server a lazily-materialized structure for deeply nested arguments — the
 * `attrs` key is present on each node but reading it yields `undefined`, so
 * validation silently dropped every heading level, code language and image
 * dimension. The same proxying made Prisma throw when it probed the value for
 * `Symbol.toStringTag` on the way into a jsonb column.
 *
 * A string has neither problem: it arrives whole, and `JSON.parse` produces a
 * plain object built here on the server. It also gives a natural place to
 * bound the payload.
 */
export const docJsonStringSchema = z
  .string()
  .max(MAX_SERIALIZED_LENGTH, "That note is too large to save")
  .transform((value, ctx) => {
    let parsed: unknown;

    try {
      parsed = JSON.parse(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Content is not valid JSON" });
      return z.NEVER;
    }

    const result = validateDoc(parsed);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.reason });
      return z.NEVER;
    }

    return result.doc;
  });

/** Counterpart for the client, so the two sides cannot drift. */
export function serializeDoc(doc: DocJSON): string {
  return JSON.stringify(doc);
}

function sanitizeAttrs(
  type: NodeType,
  attrs: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!attrs || typeof attrs !== "object") return null;

  switch (type) {
    case "heading": {
      const level = Number(attrs.level);
      return { level: level >= 1 && level <= 3 ? level : 1 };
    }

    case "codeBlock": {
      const language = attrs.language;
      return { language: isCodeLanguage(language) ? language : "plaintext" };
    }

    case "orderedList": {
      const start = Number(attrs.start);
      return { start: Number.isFinite(start) && start > 0 ? Math.floor(start) : 1 };
    }

    case "taskItem":
      return { checked: attrs.checked === true };

    case "image": {
      // The src allowlist is the reason an <img> cannot become a tracking
      // pixel or an SSRF probe: only blobs this app uploaded are permitted.
      const src = sanitizeImageSrc(attrs.src);
      if (!src) return null;

      return {
        src,
        alt: str(attrs.alt, 500),
        title: str(attrs.title, 500),
        caption: str(attrs.caption, 500),
        width: dimension(attrs.width),
        height: dimension(attrs.height),
        align:
          attrs.align === "left" || attrs.align === "right" ? attrs.align : "center",
      };
    }

    default:
      return null;
  }
}

function sanitizeMarkAttrs(
  type: MarkType,
  attrs: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!attrs || typeof attrs !== "object") return null;

  switch (type) {
    case "link": {
      const href = sanitizeHref(attrs.href);
      return href
        ? { href, target: "_blank", rel: "noopener noreferrer nofollow" }
        : null;
    }

    case "textStyle": {
      const color = sanitizeColor(attrs.color);
      return color ? { color } : null;
    }

    case "highlight": {
      const color = sanitizeColor(attrs.color);
      return color ? { color } : null;
    }

    default:
      return null;
  }
}

/**
 * Rejects anything whose scheme is not explicitly permitted — which is what
 * stops `javascript:alert(1)` surviving into rendered HTML.
 */
export function sanitizeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  try {
    // Relative hrefs resolve against this base; the result is still checked
    // against the protocol allowlist below.
    const url = new URL(trimmed, "https://example.invalid");
    return (ALLOWED_LINK_PROTOCOLS as readonly string[]).includes(url.protocol)
      ? trimmed
      : null;
  } catch {
    return null;
  }
}

/**
 * An image may only be one of two things: a path served by this app's own
 * image route, or a data: URI.
 *
 * Note what is *not* on the list any more — an absolute URL to blob storage.
 * Uploads go to a private store, whose URLs return 403 to a browser, so the
 * document holds `/api/images/<pathname>` and the route streams the bytes
 * after checking the session owns them. Keeping the old host here would leave
 * a hole for exactly the thing the private store exists to prevent: an image
 * readable by anyone holding the link.
 */
export function sanitizeImageSrc(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  if (trimmed.startsWith("data:image/")) return trimmed;

  // Round-tripped rather than pattern-matched: whatever survives is exactly
  // what the route will resolve, so the two cannot drift apart.
  const pathname = pathnameFromImageSrc(trimmed);
  return pathname ? imageSrcForPathname(pathname) : null;
}

/** Hex or a short rgb()/hsl() — never a url() or an arbitrary CSS expression. */
function sanitizeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 32);
  return /^(#[0-9a-fA-F]{3,8}|rgb\([\d\s,.%]+\)|rgba\([\d\s,.%]+\)|hsl\([\d\s,.%]+\))$/.test(
    trimmed,
  )
    ? trimmed
    : null;
}

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
}

function dimension(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), 8000);
}

/**
 * Flattens a document to searchable plain text.
 *
 * Block boundaries become newlines so that words from adjacent blocks do not
 * fuse into a phrase that never appears on the page ("...end of paragraphNext
 * heading..."), which would produce false positives in phrase search.
 */
export function extractText(doc: unknown): string {
  const parts: string[] = [];

  const walk = (node: DocNode | undefined): void => {
    if (!node || typeof node !== "object") return;

    if (node.type === "text" && typeof node.text === "string") {
      parts.push(node.text);
      return;
    }

    // Alt text and captions describe content the search would otherwise miss
    // entirely, since an image contributes no text of its own.
    if (node.type === "image") {
      const alt = node.attrs?.alt;
      const caption = node.attrs?.caption;
      if (typeof alt === "string") parts.push(alt);
      if (typeof caption === "string") parts.push(caption);
      return;
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }

    if (BLOCK_TYPES.has(node.type)) parts.push("\n");
  };

  walk(doc as DocNode);

  return (
    parts
      .join("")
      // Control characters are stripped because search highlighting uses two
      // of them (U+0001/U+0002) as match delimiters — see MARK_START in
      // src/server/search.ts. Leaving them in the indexed text would let a
      // pasted byte produce a stray <mark> in someone's search results.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_TEXT_LENGTH)
  );
}

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
]);

/** First non-empty line of prose, for dashboard and search previews. */
export function extractExcerpt(doc: unknown, maxLength = 180): string {
  const text = extractText(doc);
  if (!text) return "";

  const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? "";
  return firstLine.length > maxLength
    ? `${firstLine.slice(0, maxLength).trimEnd()}…`
    : firstLine;
}

/** Headings, for the table of contents. */
export function extractHeadings(
  doc: unknown,
): { level: number; text: string; id: string }[] {
  const headings: { level: number; text: string; id: string }[] = [];
  const seen = new Map<string, number>();

  const walk = (node: DocNode | undefined): void => {
    if (!node || typeof node !== "object") return;

    if (node.type === "heading") {
      const text = extractText({ type: "doc", content: node.content ?? [] }).trim();
      if (text) {
        const base = text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        // Two headings with the same words must still get distinct anchors,
        // or the second link scrolls to the first.
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);

        headings.push({
          level: Number(node.attrs?.level) || 1,
          text,
          id: count === 0 ? base : `${base}-${count}`,
        });
      }
      return;
    }

    if (Array.isArray(node.content)) for (const child of node.content) walk(child);
  };

  walk(doc as DocNode);
  return headings;
}

export function isDocEmpty(doc: unknown): boolean {
  return extractText(doc).length === 0;
}
