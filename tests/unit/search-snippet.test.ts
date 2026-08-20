import { describe, expect, it } from "vitest";

import { renderSnippet } from "@/server/search";
import { extractText } from "@/lib/editor/content";

const MARK_START = "\u0001";
const MARK_END = "\u0002";

/**
 * Search snippets are the one place this app renders a string as HTML.
 *
 * The string comes from Postgres's ts_headline, which echoes the user's own
 * note text back verbatim. If a note contains markup, ts_headline returns that
 * markup. Rendering it unescaped would be stored XSS that fires for anyone who
 * later searches the same words — including the author, on every device.
 *
 * These tests pin the two properties that make it safe: everything from the
 * note is escaped, and the only tags in the output are the ones we added.
 */
describe("renderSnippet", () => {
  it("escapes markup that came from the note body", () => {
    const raw = 'Notes on <img src=x onerror="alert(1)"> caching';
    const result = renderSnippet(raw);

    expect(result).not.toContain("<img");
    expect(result).toContain("&lt;img");
    // The attribute's quotes are escaped too, so it cannot break out even if
    // the fragment were spliced into an attribute context.
    expect(result).toContain("&quot;");
  });

  it("escapes a script tag rather than emitting it", () => {
    const result = renderSnippet("before <script>alert(1)</script> after");

    expect(result).not.toContain("<script");
    expect(result).toContain("&lt;script&gt;");
  });

  it("converts only our own sentinels into mark tags", () => {
    const raw = `React ${MARK_START}Query${MARK_END} caching`;
    const result = renderSnippet(raw);

    expect(result).toBe("React <mark>Query</mark> caching");
  });

  it("escapes ampersands before adding markup, so entities cannot be forged", () => {
    // Were the order reversed, "&lt;script&gt;" typed literally by the user
    // would survive as a real tag after the entity pass.
    const result = renderSnippet("a &lt;script&gt; b");

    expect(result).toBe("a &amp;lt;script&amp;gt; b");
    expect(result).not.toContain("<script");
  });

  it("leaves ordinary prose untouched", () => {
    expect(renderSnippet("plain text, nothing special")).toBe(
      "plain text, nothing special",
    );
  });

  /**
   * These three are the payloads that Postgres's own tokenizer does *not*
   * strip — verified against the live database. They are why the escaping in
   * renderSnippet is load-bearing rather than belt-and-braces, so each one is
   * pinned individually.
   */
  describe("payloads that survive ts_headline's tokenizer", () => {
    it("neutralises an unclosed tag", () => {
      const result = renderSnippet("caching <img src=x onerror=alert");

      expect(result).not.toContain("<img");
      expect(result).toBe("caching &lt;img src=x onerror=alert");
    });

    it("neutralises an attribute breakout", () => {
      const result = renderSnippet('caching " onmouseover="alert');

      expect(result).not.toContain('"');
      expect(result).toBe("caching &quot; onmouseover=&quot;alert");
    });

    it("neutralises a spaced-out tag", () => {
      const result = renderSnippet("caching < script > alert(1)");

      expect(result).not.toContain("<");
      expect(result).toBe("caching &lt; script &gt; alert(1)");
    });
  });
});

describe("extractText control character stripping", () => {
  it("removes the characters used as highlight sentinels", () => {
    // Without this, a note containing U+0001 could forge a <mark> in someone's
    // search results — cosmetic, but it means user bytes reach the HTML path.
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: `a${MARK_START}b${MARK_END}c` }],
        },
      ],
    };

    expect(extractText(doc)).toBe("abc");
  });

  it("keeps newlines and tabs, which are legitimate in code blocks", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "typescript" },
          content: [{ type: "text", text: "const a = 1;\n\tconst b = 2;" }],
        },
      ],
    };

    const text = extractText(doc);
    expect(text).toContain("const a = 1;");
    expect(text).toContain("const b = 2;");
  });
});
