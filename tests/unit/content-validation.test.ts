import { describe, expect, it } from "vitest";

import {
  docJsonStringSchema,
  docSchema,
  extractExcerpt,
  extractHeadings,
  extractText,
  sanitizeHref,
  sanitizeImageSrc,
  serializeDoc,
  validateDoc,
  type DocJSON,
} from "@/lib/editor/content";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const para = (text: string, marks?: unknown[]) => ({
  type: "paragraph",
  content: [marks ? { type: "text", text, marks } : { type: "text", text }],
});

/**
 * The write path is where this app's XSS defence lives. Content is stored as
 * structured JSON and only ever turned into HTML at render time, so anything
 * that survives validation is treated as safe downstream. These tests pin what
 * "survives" means.
 */
describe("validateDoc", () => {
  it("rejects anything that is not a document", () => {
    expect(validateDoc(null).ok).toBe(false);
    expect(validateDoc("string").ok).toBe(false);
    expect(validateDoc({ type: "paragraph" }).ok).toBe(false);
  });

  it("drops node types that are not on the allowlist", () => {
    const result = validateDoc(
      doc(para("kept"), { type: "script", content: [{ type: "text", text: "bad" }] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const types = (result.doc.content ?? []).map((node) => node.type);
    expect(types).toEqual(["paragraph"]);
  });

  it("drops an image whose src did not survive the allowlist", () => {
    // The editor shows an uploading image through a local object URL. If a
    // save lands while that is still the src — or the upload then fails — an
    // image node with no usable src would otherwise be stored forever:
    // invisible in the editor, an "[image]" placeholder in every export.
    const result = validateDoc(
      doc(
        para("kept"),
        { type: "image", attrs: { src: "blob:http://localhost:3000/abc-123" } },
        { type: "image", attrs: { alt: "no src at all" } },
        // A private store's own URL is not usable either: it answers 403 to a
        // browser, so only the app's image route may appear here.
        {
          type: "image",
          attrs: { src: "https://a.private.blob.vercel-storage.com/x.png" },
        },
        { type: "image", attrs: { src: "/api/images/notes/x-abc123.png" } },
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const types = (result.doc.content ?? []).map((node) => node.type);
    expect(types).toEqual(["paragraph", "image"]);
    expect(result.doc.content?.[1]?.attrs?.src).toBe("/api/images/notes/x-abc123.png");
  });

  it("drops marks that are not on the allowlist", () => {
    const result = validateDoc(doc(para("text", [{ type: "onclick" }])));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.doc.content?.[0]?.content?.[0]?.marks).toBeUndefined();
  });

  it("rejects a document nested past the depth limit", () => {
    let node: unknown = { type: "paragraph", content: [{ type: "text", text: "x" }] };
    for (let i = 0; i < 40; i++) {
      node = { type: "blockquote", content: [node] };
    }

    expect(validateDoc(doc(node)).ok).toBe(false);
  });

  /**
   * The bug this pins: `docSchema` was originally `z.custom`, which validates
   * and then passes the *original* object straight through. The rebuilt,
   * allowlisted copy was discarded and the raw client payload was what got
   * stored — so validation was running but achieving nothing.
   */
  describe("docSchema returns the sanitized document, not the input", () => {
    it("strips a disallowed node from the parsed output", () => {
      const input = doc(para("kept"), {
        type: "iframe",
        attrs: { src: "https://evil.example" },
      });

      const parsed = docSchema.parse(input);

      expect(parsed.content).toHaveLength(1);
      expect(parsed.content?.[0]?.type).toBe("paragraph");
    });

    it("returns a different object than the one passed in", () => {
      // Not merely cosmetic: the value handed to Prisma has to be a plain
      // object built on the server. A Server Action argument is a proxy, and
      // Prisma throws when it probes one for Symbol.toStringTag.
      const input = doc(para("hello"));
      const parsed = docSchema.parse(input);

      expect(parsed).not.toBe(input);
      expect(parsed.content?.[0]).not.toBe(input.content[0]);
    });

    it("neutralises a javascript: link inside a parsed document", () => {
      const input = doc(
        para("click", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]),
      );

      const parsed = docSchema.parse(input);
      const marks = parsed.content?.[0]?.content?.[0]?.marks;

      // The mark is dropped entirely rather than kept with an empty href,
      // which would render as an anchor going nowhere.
      expect(marks).toBeUndefined();
    });
  });
});

/**
 * The wire format for autosave.
 *
 * The document travels to the Server Action as a JSON string rather than a
 * nested object. React's action deserialization hands the server a lazily
 * materialized structure for deep arguments: the `attrs` key is present on
 * each node but reading it yields undefined, so validation silently stripped
 * every heading level, code language and image dimension — notes came back
 * with their formatting flattened and nothing reported an error.
 *
 * These tests pin the round trip that fix depends on.
 */
describe("docJsonStringSchema", () => {
  const rich: DocJSON = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "H" }] },
      {
        type: "codeBlock",
        attrs: { language: "rust" },
        content: [{ type: "text", text: "fn main() {}" }],
      },
      {
        type: "image",
        attrs: {
          src: "/api/images/x-abc123.png",
          width: 320,
          caption: "diagram",
          align: "left",
        },
      },
    ],
  };

  it("preserves every node attribute through serialize and parse", () => {
    const parsed = docJsonStringSchema.parse(serializeDoc(rich));

    expect(parsed.content?.[0]?.attrs?.level).toBe(3);
    expect(parsed.content?.[1]?.attrs?.language).toBe("rust");
    expect(parsed.content?.[2]?.attrs?.width).toBe(320);
    expect(parsed.content?.[2]?.attrs?.caption).toBe("diagram");
    expect(parsed.content?.[2]?.attrs?.align).toBe("left");
  });

  it("still sanitizes — serialization is not a way around validation", () => {
    const hostile = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
        { type: "iframe", attrs: { src: "https://evil.example" } },
      ],
    });

    const parsed = docJsonStringSchema.parse(hostile);

    expect(parsed.content).toHaveLength(1);
    expect(parsed.content?.[0]?.content?.[0]?.marks).toBeUndefined();
  });

  it("rejects malformed JSON rather than throwing", () => {
    const result = docJsonStringSchema.safeParse("{not json");
    expect(result.success).toBe(false);
  });

  it("rejects a payload that is not a document", () => {
    expect(
      docJsonStringSchema.safeParse(JSON.stringify({ type: "paragraph" })).success,
    ).toBe(false);
  });
});

describe("sanitizeHref", () => {
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)  ",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ])("rejects %s", (href) => {
    expect(sanitizeHref(href)).toBeNull();
  });

  it.each([
    "https://example.com/docs",
    "http://localhost:3000",
    "mailto:someone@example.com",
    "/relative/path",
    "#anchor",
  ])("allows %s", (href) => {
    expect(sanitizeHref(href)).toBe(href);
  });
});

describe("sanitizeImageSrc", () => {
  it("allows a path served by our own image route", () => {
    const src = "/api/images/notes/img-x1.png";
    expect(sanitizeImageSrc(src)).toBe(src);
    // Encoded segments round-trip to exactly what the route will resolve.
    expect(sanitizeImageSrc("/api/images/a%20b/c.png")).toBe("/api/images/a%20b/c.png");
  });

  it("rejects an absolute URL, including blob storage's own", () => {
    // Uploads go to a private store: its URLs answer 403 to a browser, so an
    // absolute URL in a document is either useless or a way back to the
    // public-host hole the private store exists to close.
    expect(
      sanitizeImageSrc("https://abc123.public.blob.vercel-storage.com/img-x1.png"),
    ).toBeNull();
    expect(
      sanitizeImageSrc("https://abc123.private.blob.vercel-storage.com/img-x1.png"),
    ).toBeNull();
  });

  it("rejects an arbitrary external host", () => {
    // Otherwise an <img> becomes a tracking pixel, or a probe of internal
    // network addresses from whoever opens the note.
    expect(sanitizeImageSrc("https://evil.example/pixel.png")).toBeNull();
    expect(sanitizeImageSrc("http://169.254.169.254/latest/meta-data")).toBeNull();
  });

  it("rejects traversal and lookalike paths", () => {
    // The route hands whatever survives here to the Blob SDK as a pathname.
    expect(sanitizeImageSrc("/api/images/../../etc/passwd")).toBeNull();
    expect(sanitizeImageSrc("/api/images/%2e%2e/secret.png")).toBeNull();
    expect(sanitizeImageSrc("/api/images/")).toBeNull();
    expect(sanitizeImageSrc("/api/imagesx/a.png")).toBeNull();
    expect(sanitizeImageSrc("//api/images/a.png")).toBeNull();
    expect(sanitizeImageSrc("/api/images/a.png?download=1")).toBeNull();
  });

  it("rejects a host that merely ends with a lookalike suffix", () => {
    expect(
      sanitizeImageSrc(
        "https://evil-public.blob.vercel-storage.com.attacker.test/x.png",
      ),
    ).toBeNull();
  });

  it("allows a data: URI mid-upload", () => {
    expect(sanitizeImageSrc("data:image/png;base64,iVBORw0KGgo=")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
  });
});

describe("extractText", () => {
  it("separates blocks so words from adjacent blocks do not fuse", () => {
    const text = extractText(doc(para("end of paragraph"), para("Next heading")));

    // Without the block boundary this would read "paragraphNext", producing a
    // phrase match that appears nowhere on the page.
    expect(text).not.toContain("paragraphNext");
    expect(text).toContain("end of paragraph");
    expect(text).toContain("Next heading");
  });

  it("includes image alt text and captions", () => {
    // An image contributes no text of its own, so without this a diagram is
    // invisible to search.
    const text = extractText(
      doc({
        type: "image",
        attrs: {
          src: "https://x.public.blob.vercel-storage.com/a.png",
          alt: "architecture diagram",
          caption: "request flow",
        },
      }),
    );

    expect(text).toContain("architecture diagram");
    expect(text).toContain("request flow");
  });
});

describe("extractHeadings", () => {
  it("gives duplicate headings distinct anchors", () => {
    const headings = extractHeadings(
      doc(
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Setup" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Setup" }],
        },
      ),
    );

    // Otherwise the second entry in a table of contents scrolls to the first.
    expect(headings.map((h) => h.id)).toEqual(["setup", "setup-1"]);
  });
});

describe("extractExcerpt", () => {
  it("uses the first non-empty line", () => {
    expect(extractExcerpt(doc(para(""), para("The real first line")))).toBe(
      "The real first line",
    );
  });
});
