import type { DocJSON, DocNode } from "@/lib/editor/content";
import { normalizeLanguage } from "@/lib/editor/schema";

/**
 * Converts a stored document to Markdown.
 *
 * Written by hand rather than pulled from a library because the document
 * vocabulary is small and fully known (see lib/editor/schema.ts), and a
 * general-purpose converter would still need per-node configuration for the
 * custom image attributes. This is about a hundred lines and has no
 * dependencies.
 *
 * Round-trip fidelity is the goal for everything Markdown can express.
 * Alignment and explicit image widths have no Markdown equivalent and are
 * dropped — noted here so it is a known limitation rather than a surprise.
 */

export function toMarkdown(doc: DocJSON, title?: string): string {
  const body = (doc.content ?? []).map((node) => blockToMarkdown(node, 0)).join("\n\n");

  return title ? `# ${title}\n\n${body}\n` : `${body}\n`;
}

function blockToMarkdown(node: DocNode, depth: number): string {
  switch (node.type) {
    case "paragraph":
      return inlineToMarkdown(node.content ?? []);

    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      // Offset by one because the page title already occupies H1.
      return `${"#".repeat(level + 1)} ${inlineToMarkdown(node.content ?? [])}`;
    }

    case "codeBlock": {
      const language = normalizeLanguage(node.attrs?.language as string);
      const code = (node.content ?? []).map((child) => child.text ?? "").join("");
      const fence = longestFence(code);
      return `${fence}${language === "plaintext" ? "" : language}\n${code}\n${fence}`;
    }

    case "blockquote":
      return (node.content ?? [])
        .map((child) => blockToMarkdown(child, depth))
        .join("\n\n")
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");

    case "bulletList":
      return (node.content ?? [])
        .map((item) => listItemToMarkdown(item, depth, "-"))
        .join("\n");

    case "orderedList": {
      const start = Number(node.attrs?.start) || 1;
      return (node.content ?? [])
        .map((item, index) => listItemToMarkdown(item, depth, `${start + index}.`))
        .join("\n");
    }

    case "taskList":
      return (node.content ?? [])
        .map((item) =>
          listItemToMarkdown(
            item,
            depth,
            item.attrs?.checked === true ? "- [x]" : "- [ ]",
          ),
        )
        .join("\n");

    case "horizontalRule":
      return "---";

    case "image": {
      const alt = String(node.attrs?.alt ?? "");
      const src = String(node.attrs?.src ?? "");
      const caption = node.attrs?.caption;
      const image = `![${escapeBrackets(alt)}](${src})`;
      // Markdown has no caption syntax; italic text underneath is the
      // convention most renderers display sensibly.
      return caption ? `${image}\n\n*${escapeMarkdown(String(caption))}*` : image;
    }

    default:
      return node.content ? inlineToMarkdown(node.content) : "";
  }
}

function listItemToMarkdown(item: DocNode, depth: number, marker: string): string {
  const indent = "  ".repeat(depth);

  const blocks = (item.content ?? []).map((child) =>
    child.type === "bulletList" ||
    child.type === "orderedList" ||
    child.type === "taskList"
      ? blockToMarkdown(child, depth + 1)
      : blockToMarkdown(child, depth),
  );

  const [first, ...rest] = blocks;
  const head = `${indent}${marker} ${first ?? ""}`;

  if (rest.length === 0) return head;

  // Continuation lines have to align past the marker or Markdown treats them
  // as a new paragraph outside the list.
  const continuation = rest
    .map((block) =>
      block
        .split("\n")
        .map((line) => (line.startsWith(indent) ? line : `${indent}  ${line}`))
        .join("\n"),
    )
    .join("\n\n");

  return `${head}\n${continuation}`;
}

function inlineToMarkdown(nodes: DocNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "hardBreak") return "  \n";
      if (node.type === "image") return blockToMarkdown(node, 0);
      if (node.type !== "text" || typeof node.text !== "string") return "";

      let text = node.text;
      const marks = node.marks ?? [];

      // Code first: inside inline code, ** and _ are literal, so applying
      // other marks inside it would produce visible asterisks.
      if (marks.some((m) => m.type === "code")) {
        return `\`${text.replace(/`/g, "\\`")}\``;
      }

      text = escapeMarkdown(text);

      // Innermost outwards, so the emphasis nests in a readable order.
      if (marks.some((m) => m.type === "strike")) text = `~~${text}~~`;
      if (marks.some((m) => m.type === "italic")) text = `*${text}*`;
      if (marks.some((m) => m.type === "bold")) text = `**${text}**`;

      // Markdown has no underline or highlight. HTML tags survive in most
      // renderers and are the least lossy option available.
      if (marks.some((m) => m.type === "underline")) text = `<u>${text}</u>`;
      if (marks.some((m) => m.type === "highlight")) text = `==${text}==`;

      const link = marks.find((m) => m.type === "link");
      if (link?.attrs?.href) text = `[${text}](${String(link.attrs.href)})`;

      return text;
    })
    .join("");
}

/**
 * Picks a fence longer than any backtick run inside the code, so a snippet
 * that itself contains ``` does not terminate its own block.
 */
function longestFence(code: string): string {
  const runs = code.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

function escapeMarkdown(text: string): string {
  // Only the characters that would change the rendering. Escaping every
  // punctuation mark makes exported prose unreadable in a plain text editor.
  return text.replace(/([\\`*_[\]])/g, "\\$1");
}

function escapeBrackets(text: string): string {
  return text.replace(/([[\]])/g, "\\$1");
}

// ---------------------------------------------------------------------------
// Markdown -> document
// ---------------------------------------------------------------------------

/**
 * Parses Markdown into a document.
 *
 * Covers the constructs that actually appear in technical notes: headings,
 * fenced code, lists, checklists, quotes, rules, and inline emphasis, code and
 * links. Anything it does not recognise becomes a paragraph, which is the
 * right failure mode — text is never lost, only its formatting.
 */
export function fromMarkdown(markdown: string): DocJSON {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const content: DocNode[] = [];

  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index++;
      continue;
    }

    // Fenced code. Consumed first because everything inside is literal.
    const fence = line.match(/^(`{3,}|~{3,})\s*([\w+#-]*)/);
    if (fence) {
      const marker = fence[1] ?? "```";
      const language = normalizeLanguage(fence[2] ?? null);
      const body: string[] = [];
      index++;

      while (index < lines.length && !(lines[index] ?? "").startsWith(marker)) {
        body.push(lines[index] ?? "");
        index++;
      }
      index++; // closing fence

      const code = body.join("\n");
      content.push({
        type: "codeBlock",
        attrs: { language },
        ...(code ? { content: [{ type: "text", text: code }] } : {}),
      });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      // The document only models H1–H3; deeper levels clamp rather than being
      // silently dropped.
      const level = Math.min(heading[1]?.length ?? 1, 3);
      content.push({
        type: "heading",
        attrs: { level },
        content: parseInline(heading[2] ?? ""),
      });
      index++;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      content.push({ type: "horizontalRule" });
      index++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index] ?? "")) {
        quoted.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
        index++;
      }
      const inner = fromMarkdown(quoted.join("\n"));
      content.push({ type: "blockquote", content: inner.content ?? [] });
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (listMatch) {
      const { node, next } = parseList(lines, index);
      content.push(node);
      index = next;
      continue;
    }

    // Everything else is a paragraph, gathering consecutive non-blank lines.
    const paragraph: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim()) {
      const current = lines[index] ?? "";
      if (
        /^(#{1,6})\s/.test(current) ||
        /^(`{3,}|~{3,})/.test(current) ||
        /^\s*>/.test(current) ||
        /^(\s*)([-*+]|\d+[.)])\s+/.test(current)
      ) {
        break;
      }
      paragraph.push(current);
      index++;
    }

    if (paragraph.length > 0) {
      content.push({ type: "paragraph", content: parseInline(paragraph.join(" ")) });
    }
  }

  return {
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
}

function parseList(lines: string[], start: number): { node: DocNode; next: number } {
  const first = (lines[start] ?? "").match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
  const baseIndent = first?.[1]?.length ?? 0;
  const ordered = /\d/.test(first?.[2] ?? "");

  const items: DocNode[] = [];
  let index = start;
  let isTaskList = false;

  while (index < lines.length) {
    const match = (lines[index] ?? "").match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (!match) break;

    const indent = match[1]?.length ?? 0;
    if (indent < baseIndent) break;

    // A deeper indent belongs to the previous item, not this list.
    if (indent > baseIndent) {
      const nested = parseList(lines, index);
      const last = items.at(-1);
      if (last) (last.content ??= []).push(nested.node);
      index = nested.next;
      continue;
    }

    let text = match[3] ?? "";
    const task = text.match(/^\[([ xX])\]\s*(.*)$/);

    if (task) {
      isTaskList = true;
      items.push({
        type: "taskItem",
        attrs: { checked: (task[1] ?? " ").toLowerCase() === "x" },
        content: [{ type: "paragraph", content: parseInline(task[2] ?? "") }],
      });
    } else {
      items.push({
        type: "listItem",
        content: [{ type: "paragraph", content: parseInline(text) }],
      });
    }

    void text;
    index++;
  }

  return {
    node: {
      type: isTaskList ? "taskList" : ordered ? "orderedList" : "bulletList",
      ...(ordered && !isTaskList ? { attrs: { start: 1 } } : {}),
      content: items,
    },
    next: index,
  };
}

/**
 * Inline emphasis, code and links.
 *
 * Code spans are matched first and their contents left untouched, so
 * `**not bold**` inside backticks stays literal.
 */
function parseInline(text: string): DocNode[] {
  const nodes: DocNode[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)|(~~[^~]+~~)|(\[[^\]]*\]\([^)]+\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", text: unescape(text.slice(lastIndex, match.index)) });
    }

    const token = match[0];

    if (token.startsWith("`")) {
      nodes.push({
        type: "text",
        text: token.slice(1, -1),
        marks: [{ type: "code" }],
      });
    } else if (token.startsWith("**")) {
      nodes.push({
        type: "text",
        text: unescape(token.slice(2, -2)),
        marks: [{ type: "bold" }],
      });
    } else if (token.startsWith("~~")) {
      nodes.push({
        type: "text",
        text: unescape(token.slice(2, -2)),
        marks: [{ type: "strike" }],
      });
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
      if (link) {
        nodes.push({
          type: "text",
          text: unescape(link[1] ?? ""),
          marks: [{ type: "link", attrs: { href: link[2] ?? "" } }],
        });
      }
    } else {
      nodes.push({
        type: "text",
        text: unescape(token.slice(1, -1)),
        marks: [{ type: "italic" }],
      });
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: "text", text: unescape(text.slice(lastIndex)) });
  }

  return nodes.filter((node) => node.text !== "");
}

function unescape(text: string): string {
  return text.replace(/\\([\\`*_[\]])/g, "$1");
}
