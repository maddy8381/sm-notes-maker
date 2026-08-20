import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import { encode, renderPdf, type PdfSection } from "@/lib/pdf/render";
import type { DocJSON } from "@/lib/editor/content";

/**
 * The PDF renderer draws directly with pdf-lib, which means two classes of
 * failure that no type checks catch: text the standard fonts cannot encode
 * (which throws at draw time and takes the whole export with it), and layout
 * arithmetic that quietly puts content in the wrong place.
 *
 * These tests pin the first class exactly and the second structurally — page
 * counts and "does not throw" for the documents most likely to break it.
 */

const para = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const lorem =
  "Every line here exists to make the greedy wrapper do real work, because a paragraph that fits on one line proves nothing about how the next page begins. ";

function docOf(...content: unknown[]): DocJSON {
  return { type: "doc", content } as DocJSON;
}

async function load(bytes: Uint8Array) {
  return PDFDocument.load(bytes);
}

describe("encode", () => {
  it("keeps text the standard fonts can already draw", () => {
    expect(encode("Hello — “quoted”, café, naïve… 100% €5")).toBe(
      "Hello — “quoted”, café, naïve… 100% €5",
    );
  });

  it("transliterates technical symbols instead of losing them", () => {
    expect(encode("a → b, x ≤ y, done ✓")).toBe("a -> b, x <= y, done *");
  });

  it("drops decorative characters and collapses the rest to one placeholder", () => {
    expect(encode("ship it 🎉🚀")).toBe("ship it ");
    // A run of unsupported script becomes a single "?", not one per glyph.
    expect(encode("日本語のテキスト")).toBe("?");
    expect(encode("before 日本語 after")).toBe("before ? after");
  });

  it("expands tabs, which have no width in a PDF text run", () => {
    expect(encode("a\tb")).toBe("a  b");
  });
});

describe("renderPdf", () => {
  it("produces a loadable single-note PDF carrying its title", async () => {
    const bytes = await renderPdf({
      title: "Indexes in Postgres",
      author: "Sam",
      layout: "single",
      sections: [{ title: "Indexes in Postgres", doc: docOf(para(lorem)) }],
    });

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

    const pdf = await load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe("Indexes in Postgres");
  });

  it("flows a long document across pages", async () => {
    const bytes = await renderPdf({
      title: "Long",
      layout: "single",
      sections: [
        {
          title: "Long",
          doc: docOf(...Array.from({ length: 40 }, () => para(lorem.repeat(3)))),
        },
      ],
    });

    const pdf = await load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(3);
  });

  it("gives a collection a cover, contents, and a page per note", async () => {
    const sections: PdfSection[] = Array.from({ length: 5 }, (_, index) => ({
      title: `Note ${index + 1}`,
      meta: ["Updated 20 Aug 2026"],
      doc: docOf(para("Short enough to stay on one page.")),
    }));

    const pdf = await load(
      await renderPdf({ title: "React", layout: "collection", sections }),
    );

    // Cover + one contents page + one page per note.
    expect(pdf.getPageCount()).toBe(1 + 1 + sections.length);
  });

  it("still exports a technology whose notes are all empty", async () => {
    const pdf = await load(
      await renderPdf({
        title: "Empty",
        layout: "collection",
        sections: [{ title: "Nothing here", doc: { type: "doc", content: [] } }],
      }),
    );

    expect(pdf.getPageCount()).toBe(3);
  });

  it("renders every node type the schema allows without throwing", async () => {
    const doc = docOf(
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "H1 →" }],
      },
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "H3" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " code", marks: [{ type: "code" }] },
          { type: "hardBreak" },
          {
            type: "text",
            text: "link",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
          {
            type: "text",
            text: "mark",
            marks: [{ type: "highlight" }, { type: "strike" }],
          },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              para("outer"),
              {
                type: "orderedList",
                attrs: { start: 4 },
                content: [{ type: "listItem", content: [para("inner")] }],
              },
            ],
          },
        ],
      },
      {
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: true }, content: [para("done")] },
          { type: "taskItem", attrs: { checked: false }, content: [para("todo")] },
        ],
      },
      { type: "blockquote", content: [para("quoted")] },
      {
        type: "codeBlock",
        attrs: { language: "sql" },
        content: [{ type: "text", text: "select 1\nfrom t;" }],
      },
      { type: "horizontalRule" },
      // Unknown to the renderer: dropped, never fatal.
      { type: "somethingNew", content: [{ type: "text", text: "kept as text" }] },
    );

    const pdf = await load(
      await renderPdf({
        title: "All nodes",
        layout: "single",
        sections: [{ title: "All nodes", doc }],
      }),
    );
    expect(pdf.getPageCount()).toBeGreaterThan(0);
  });

  it("wraps a code block that is wider and taller than a page", async () => {
    const line = "const value = ".padEnd(400, "x");
    const doc = docOf({
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [
        { type: "text", text: Array.from({ length: 120 }, () => line).join("\n") },
      ],
    });

    const pdf = await load(
      await renderPdf({
        title: "Code",
        layout: "single",
        sections: [{ title: "Code", doc }],
      }),
    );

    expect(pdf.getPageCount()).toBeGreaterThan(2);
  });

  it("falls back to a placeholder when an image cannot be loaded", async () => {
    const doc = docOf({
      type: "image",
      attrs: { src: "https://x.public.blob.vercel-storage.com/a.webp", alt: "diagram" },
    });

    const pdf = await load(
      await renderPdf({
        title: "Image",
        layout: "single",
        // What the route handler does for a format pdf-lib cannot embed.
        loadImage: async () => null,
        sections: [{ title: "Image", doc }],
      }),
    );

    expect(pdf.getPageCount()).toBe(1);
  });

  it("embeds an image and keeps it inside the page", async () => {
    const doc = docOf({
      type: "image",
      attrs: { src: "data:image/png;base64,x", alt: "gradient", width: 4000 },
    });

    const pdf = await load(
      await renderPdf({
        title: "Image",
        layout: "single",
        loadImage: async () => ({ data: pngPixel(), format: "png" }),
        sections: [{ title: "Image", doc }],
      }),
    );

    // A 4000px-wide image has to be scaled down rather than overflow.
    expect(pdf.getPageCount()).toBe(1);
  });
});

/** Smallest valid PNG: one opaque pixel. */
function pngPixel(): Uint8Array {
  return new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
}
