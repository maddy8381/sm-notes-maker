/**
 * @vitest-environment jsdom
 *
 * ProseMirror builds a real DOM tree and parses pasted HTML through
 * DOMParser, so these tests cannot run in the default node environment.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";

import { normalizeLanguage } from "@/lib/editor/schema";
import { validateDoc, type DocJSON } from "@/lib/editor/content";

/**
 * Copy, paste and image fidelity.
 *
 * These pin the behaviour that makes the editor trustworthy for code notes:
 * a code block that survives a copy/paste round trip with its language, and
 * an image that keeps its size, caption and alt text.
 *
 * The extensions are rebuilt here from the same base packages and attribute
 * definitions the app uses, because the app's versions pull in React node
 * views that need a renderer. What is under test is the schema — the
 * attributes, their parsing and their serialization — which is exactly the
 * part that determines whether information survives a round trip.
 */

const lowlight = createLowlight(common);

const CodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: "plaintext",
        parseHTML: (element: HTMLElement) => {
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
        renderHTML: (attributes: { language?: string }) => ({
          "data-language": attributes.language,
          class: `language-${attributes.language}`,
        }),
      },
    };
  },
}).configure({ lowlight });

const ResizableImage = Image.extend({
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute("width") ?? element.style.width;
          const parsed = Number.parseInt(value ?? "", 10);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        },
        renderHTML: (attributes: { width?: number }) =>
          attributes.width ? { width: attributes.width } : {},
      },
      caption: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-caption"),
        renderHTML: (attributes: { caption?: string }) =>
          attributes.caption ? { "data-caption": attributes.caption } : {},
      },
      align: {
        default: "center",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-align") ?? "center",
        renderHTML: (attributes: { align?: string }) => ({
          "data-align": attributes.align ?? "center",
        }),
      },
    };
  },
}).configure({ inline: false, allowBase64: true });

function makeEditor(content?: unknown) {
  return new Editor({
    extensions: [StarterKit.configure({ codeBlock: false }), CodeBlock, ResizableImage],
    ...(content ? { content: content as never } : {}),
  });
}

let editor: Editor;

beforeEach(() => {
  editor = makeEditor();
});

type Node = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
};

function findNode(doc: unknown, type: string): Node | undefined {
  const stack: Node[] = [doc as Node];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === type) return node;
    if (node.content) stack.push(...node.content);
  }
  return undefined;
}

describe("code block", () => {
  it("keeps its language through a JSON round trip", () => {
    // The failure this guards: a page opened and saved untouched came back
    // with the language reset to plaintext, silently losing highlighting on
    // every note that had it.
    const source: DocJSON = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "typescript" },
          content: [{ type: "text", text: "const a: number = 1;" }],
        },
      ],
    };

    const instance = makeEditor(source);
    const roundTripped = instance.getJSON();

    expect(findNode(roundTripped, "codeBlock")?.attrs?.language).toBe("typescript");
    instance.destroy();
  });

  it("survives validation on the write path with its language intact", () => {
    const instance = makeEditor({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "python" },
          content: [{ type: "text", text: "print('hi')" }],
        },
      ],
    });

    const result = validateDoc(instance.getJSON());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(findNode(result.doc, "codeBlock")?.attrs?.language).toBe("python");
    instance.destroy();
  });

  it("renders HTML carrying the language, so a copy can be pasted back", () => {
    const instance = makeEditor({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "rust" },
          content: [{ type: "text", text: "fn main() {}" }],
        },
      ],
    });

    const html = instance.getHTML();

    // Both forms are emitted: data-language for our own paste handler, and the
    // language- class that every other markdown renderer understands.
    expect(html).toContain('data-language="rust"');
    expect(html).toContain("language-rust");
    instance.destroy();
  });

  describe("parsing pasted HTML", () => {
    it.each([
      ['<pre><code class="language-typescript">x</code></pre>', "typescript"],
      // GitHub and most markdown pipelines abbreviate.
      ['<pre><code class="language-ts">x</code></pre>', "typescript"],
      ['<pre><code class="language-js">x</code></pre>', "javascript"],
      ['<pre><code class="lang-py">x</code></pre>', "python"],
      ['<pre><code class="language-sh">x</code></pre>', "bash"],
      ['<pre><code class="language-yml">x</code></pre>', "yaml"],
      // GitHub's own rendered blobs.
      ['<pre class="highlight-source-go"><code>x</code></pre>', "go"],
      // Our own copy button's output.
      ['<pre data-language="sql"><code>x</code></pre>', "sql"],
      // Unknown language degrades to plaintext rather than being dropped.
      ['<pre><code class="language-brainfuck">x</code></pre>', "plaintext"],
      // No hint at all.
      ["<pre><code>x</code></pre>", "plaintext"],
    ])("maps %s to %s", (html, expected) => {
      editor.commands.setContent(html);
      expect(findNode(editor.getJSON(), "codeBlock")?.attrs?.language).toBe(expected);
    });

    it("preserves the code text exactly, including indentation", () => {
      const code = "function f() {\n  return 1;\n}";
      editor.commands.setContent(
        `<pre><code class="language-javascript">${code}</code></pre>`,
      );

      const block = findNode(editor.getJSON(), "codeBlock");
      expect(block?.content?.[0]?.text).toBe(code);
    });
  });
});

describe("image", () => {
  const src = "https://abc.public.blob.vercel-storage.com/diagram.png";

  it("keeps width, caption, alt and alignment through a round trip", () => {
    // Everything a user can adjust has to survive reload and copy/paste, or
    // resizing an image looks like it did not take.
    const instance = makeEditor({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src,
            alt: "request flow",
            caption: "How a request travels",
            width: 420,
            align: "left",
          },
        },
      ],
    });

    const image = findNode(instance.getJSON(), "image");

    expect(image?.attrs?.src).toBe(src);
    expect(image?.attrs?.alt).toBe("request flow");
    expect(image?.attrs?.caption).toBe("How a request travels");
    expect(image?.attrs?.width).toBe(420);
    expect(image?.attrs?.align).toBe("left");

    instance.destroy();
  });

  it("survives validation with its dimensions and caption", () => {
    const instance = makeEditor({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src, alt: "a", caption: "c", width: 300, align: "right" },
        },
      ],
    });

    const result = validateDoc(instance.getJSON());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const image = findNode(result.doc, "image");
    expect(image?.attrs?.width).toBe(300);
    expect(image?.attrs?.caption).toBe("c");
    expect(image?.attrs?.align).toBe("right");

    instance.destroy();
  });

  it("is draggable, which is what lets it be moved within the document", () => {
    // Without draggable on the node spec, dragging starts a text selection and
    // the image cannot be repositioned at all.
    expect(editor.schema.nodes.image?.spec.draggable).toBe(true);
  });

  it("round-trips through rendered HTML", () => {
    const instance = makeEditor({
      type: "doc",
      content: [{ type: "image", attrs: { src, width: 250, caption: "cap" } }],
    });

    const html = instance.getHTML();
    instance.destroy();

    const reparsed = makeEditor();
    reparsed.commands.setContent(html);

    const image = findNode(reparsed.getJSON(), "image");
    expect(image?.attrs?.src).toBe(src);
    expect(image?.attrs?.width).toBe(250);
    expect(image?.attrs?.caption).toBe("cap");

    reparsed.destroy();
  });
});

describe("formatting round trip", () => {
  it("preserves every supported mark through HTML", () => {
    const source = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: "italic", marks: [{ type: "italic" }] },
            { type: "text", text: "strike", marks: [{ type: "strike" }] },
            { type: "text", text: "code", marks: [{ type: "code" }] },
            {
              type: "text",
              text: "link",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    };

    const instance = makeEditor(source);
    const html = instance.getHTML();
    instance.destroy();

    const reparsed = makeEditor();
    reparsed.commands.setContent(html);
    const json = JSON.stringify(reparsed.getJSON());

    for (const mark of ["bold", "italic", "strike", "code", "link"]) {
      expect(json).toContain(`"${mark}"`);
    }

    reparsed.destroy();
  });

  it("preserves list structure and headings", () => {
    const instance = makeEditor({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "H" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "one" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "two" }] },
              ],
            },
          ],
        },
      ],
    });

    const html = instance.getHTML();
    instance.destroy();

    const reparsed = makeEditor();
    reparsed.commands.setContent(html);
    const doc = reparsed.getJSON();

    expect(findNode(doc, "heading")?.attrs?.level).toBe(2);
    expect(findNode(doc, "bulletList")?.content).toHaveLength(2);

    reparsed.destroy();
  });
});
