import {
  PDFDocument,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from "pdf-lib";

import type { DocJSON, DocNode } from "@/lib/editor/content";
import { CODE_LANGUAGE_LABELS, isCodeLanguage } from "@/lib/editor/schema";

/**
 * Stored document -> PDF.
 *
 * Written against pdf-lib rather than by printing HTML in headless Chrome.
 * A browser would give better fidelity, but it is a ~300 MB dependency that
 * cannot run inside a normal serverless function, and the document vocabulary
 * here is small and fully known (see lib/editor/schema.ts) — the same reason
 * lib/editor/markdown.ts is hand-written.
 *
 * What that costs, stated plainly:
 *
 *  - The standard PDF fonts only encode WinAnsi (Latin-1 plus the cp1252
 *    extras). Text outside it is transliterated where an obvious ASCII
 *    equivalent exists and replaced with "?" otherwise — see `encode`.
 *  - Only PNG and JPEG images can be embedded. Anything else renders as a
 *    labelled placeholder rather than failing the export.
 *  - Code blocks are monospaced but not syntax-highlighted.
 *
 * Everything else — wrapping, nested lists, quotes, page breaks mid-block,
 * links, a cover page and a linked table of contents — is handled here.
 */

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export type PdfImageData = { data: Uint8Array; format: "png" | "jpg" };

/**
 * Resolves an image `src` to embeddable bytes. Injected rather than done here
 * so this module stays free of network access: the route handler owns fetching
 * and the allowlist that goes with it.
 */
export type ImageLoader = (src: string) => Promise<PdfImageData | null>;

export type PdfSection = {
  title: string;
  /** Short muted lines under the section title — dates, tags. */
  meta?: string[];
  doc: DocJSON;
};

export type PdfDocumentInput = {
  title: string;
  subtitle?: string | null;
  /** Lines shown on the cover, under the title. */
  meta?: string[];
  author?: string | null;
  sections: PdfSection[];
  /**
   * "single" is one note: a title block, then the content.
   * "collection" is a whole technology: cover page, table of contents, and
   * every note starting on a fresh page.
   */
  layout?: "single" | "collection";
  loadImage?: ImageLoader;
  /** Appended to the footer, e.g. "Truncated at 200 pages". */
  footerNote?: string | null;
};

// ---------------------------------------------------------------------------
// Geometry and type scale
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;

const MARGIN = { top: 64, bottom: 62, left: 60, right: 60 };
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN.left - MARGIN.right;
const CONTENT_TOP = PAGE_HEIGHT - MARGIN.top;
const FOOTER_BASELINE = 34;

const SIZE = {
  coverTitle: 30,
  coverSubtitle: 13,
  sectionTitle: 18,
  body: 10.5,
  h1: 16,
  h2: 13.5,
  h3: 11.5,
  code: 8.8,
  small: 8.6,
};

/** Multiples of the font size. */
const LINE_HEIGHT = 1.5;
const CODE_LINE_HEIGHT = 1.35;

const COLOR = {
  text: rgb(0.11, 0.12, 0.14),
  muted: rgb(0.45, 0.47, 0.51),
  faint: rgb(0.62, 0.64, 0.68),
  link: rgb(0.15, 0.39, 0.85),
  rule: rgb(0.89, 0.9, 0.92),
  codeBg: rgb(0.965, 0.97, 0.98),
  codeText: rgb(0.16, 0.18, 0.22),
  quoteBar: rgb(0.8, 0.82, 0.85),
  highlight: rgb(0.99, 0.93, 0.7),
};

/** Cycled by nesting depth, since "◦" is not encodable in WinAnsi. */
const BULLETS = ["•", "-", "•"];
const LIST_INDENT = 18;
const QUOTE_INDENT = 16;

// ---------------------------------------------------------------------------
// Text encoding
// ---------------------------------------------------------------------------

/** cp1252's high range — encodable by the standard fonts despite being > 0xFF. */
const CP1252_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** Symbols common in technical notes that have a readable ASCII stand-in. */
const TRANSLITERATIONS: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "⇒": "=>",
  "⇐": "<=",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "≈": "~=",
  "≡": "==",
  "∞": "inf",
  "✓": "*",
  "✔": "*",
  "✗": "x",
  "✘": "x",
  "★": "*",
  "☆": "*",
  "▸": "-",
  "▪": "-",
  "○": "o",
  "─": "-",
  "│": "|",
};

/** Decorative characters that read better dropped than replaced with "?". */
function isDecorative(code: number): boolean {
  return (
    (code >= 0x1f000 && code <= 0x1faff) || // emoji
    (code >= 0x2600 && code <= 0x27bf) || // misc symbols & dingbats
    code === 0xfe0f || // variation selector
    code === 0x200d || // zero-width joiner
    (code >= 0x200b && code <= 0x200f)
  );
}

/**
 * Makes a string safe for the standard fonts. Unencodable characters would
 * otherwise throw at draw time and fail the whole export, so this runs on
 * every string before it is measured or drawn.
 */
export function encode(input: string): string {
  let out = "";
  let lastWasPlaceholder = false;

  for (const char of input.replace(/\t/g, "  ")) {
    const code = char.codePointAt(0) ?? 0;

    if (code === 0xa0) {
      out += " ";
      lastWasPlaceholder = false;
      continue;
    }

    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff)) {
      out += char;
      lastWasPlaceholder = false;
      continue;
    }

    if (CP1252_EXTRAS.has(code)) {
      out += char;
      lastWasPlaceholder = false;
      continue;
    }

    const ascii = TRANSLITERATIONS[char];
    if (ascii) {
      out += ascii;
      lastWasPlaceholder = false;
      continue;
    }

    if (isDecorative(code)) continue;

    // One "?" per run, so a paragraph of unsupported script degrades to a
    // visible gap rather than a wall of question marks.
    if (!lastWasPlaceholder) {
      out += "?";
      lastWasPlaceholder = true;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Inline model
// ---------------------------------------------------------------------------

type InlineStyle = {
  font: PDFFont;
  size: number;
  color: RGB;
  underline: boolean;
  strike: boolean;
  highlight: boolean;
  code: boolean;
  link: string | null;
};

type Token =
  | { kind: "text"; text: string; width: number; style: InlineStyle }
  | { kind: "space"; width: number; style: InlineStyle }
  | { kind: "break" };

type Fonts = {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
};

type TocEntry = { title: string; pageRef: PDFPage; bodyIndex: number };

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

class PdfBuilder {
  private constructor(
    private readonly pdf: PDFDocument,
    private readonly fonts: Fonts,
    private readonly input: PdfDocumentInput,
  ) {}

  private page!: PDFPage;
  private y = CONTENT_TOP;

  /** Fired just before a page break, so a block spanning pages can close off
   *  its decoration (the blockquote bar) on the page being left behind. */
  private breakHooks: ((page: PDFPage, y: number) => void)[] = [];

  private readonly imageCache = new Map<string, PDFImage | null>();

  static async create(input: PdfDocumentInput): Promise<PdfBuilder> {
    const pdf = await PDFDocument.create();

    const fonts: Fonts = {
      regular: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
      boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
      mono: await pdf.embedFont(StandardFonts.Courier),
      monoBold: await pdf.embedFont(StandardFonts.CourierBold),
    };

    pdf.setTitle(encode(input.title));
    if (input.author) pdf.setAuthor(encode(input.author));
    pdf.setCreator("SM Notes Maker");
    pdf.setProducer("SM Notes Maker");
    pdf.setCreationDate(new Date());

    return new PdfBuilder(pdf, fonts, input);
  }

  // -- page management ------------------------------------------------------

  private newPage(): void {
    if (this.page) {
      for (const hook of this.breakHooks) hook(this.page, this.y);
    }
    this.page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = CONTENT_TOP;
  }

  private atPageTop(): boolean {
    return this.y >= CONTENT_TOP - 0.5;
  }

  /** Vertical whitespace, collapsed at the top of a page. */
  private gap(amount: number): void {
    if (!this.atPageTop()) this.y -= amount;
  }

  /** Guarantees `height` of room below the cursor, breaking the page if not. */
  private ensure(height: number): void {
    if (this.y - height < MARGIN.bottom) this.newPage();
  }

  private available(): number {
    return this.y - MARGIN.bottom;
  }

  // -- primitives -----------------------------------------------------------

  private width(text: string, font: PDFFont, size: number): number {
    return font.widthOfTextAtSize(text, size);
  }

  /** Single line of already-encoded text, optionally truncated to fit. */
  private drawLine(
    page: PDFPage,
    text: string,
    options: {
      x: number;
      baseline: number;
      font: PDFFont;
      size: number;
      color: RGB;
      maxWidth?: number;
      align?: "left" | "right";
    },
  ): number {
    let value = text;

    if (options.maxWidth !== undefined) {
      while (
        value.length > 1 &&
        this.width(value, options.font, options.size) > options.maxWidth
      ) {
        value = value.slice(0, -1);
      }
      if (value !== text && value.length > 1) value = `${value.slice(0, -1)}…`;
    }

    const width = this.width(value, options.font, options.size);
    const x = options.align === "right" ? options.x - width : options.x;

    page.drawText(value, {
      x,
      y: options.baseline,
      size: options.size,
      font: options.font,
      color: options.color,
    });

    return width;
  }

  private drawExternalLink(page: PDFPage, url: string, rect: number[]): void {
    const annotation = this.pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: rect,
      Border: [0, 0, 0],
      A: {
        Type: "Action",
        S: "URI",
        URI: PDFString.of(url.slice(0, 2000)),
      },
    });
    page.node.addAnnot(this.pdf.context.register(annotation));
  }

  private drawInternalLink(page: PDFPage, target: PDFPage, rect: number[]): void {
    const annotation = this.pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: rect,
      Border: [0, 0, 0],
      // "XYZ" with nulls means "top of that page, keep the current zoom".
      A: { Type: "Action", S: "GoTo", D: [target.ref, "XYZ", null, null, null] },
    });
    page.node.addAnnot(this.pdf.context.register(annotation));
  }

  // -- inline layout --------------------------------------------------------

  private styleFor(marks: DocNode["marks"], base: InlineStyle): InlineStyle {
    const has = (type: string) => (marks ?? []).some((mark) => mark.type === type);

    const bold = has("bold");
    const italic = has("italic");
    const code = has("code");

    const link = (marks ?? []).find((mark) => mark.type === "link");
    const href = typeof link?.attrs?.href === "string" ? link.attrs.href : null;

    const font = code
      ? bold
        ? this.fonts.monoBold
        : this.fonts.mono
      : bold && italic
        ? this.fonts.boldItalic
        : bold
          ? this.fonts.bold
          : italic
            ? this.fonts.italic
            : this.fonts.regular;

    return {
      font,
      // Courier runs visually large next to Helvetica at the same point size.
      size: code ? base.size * 0.92 : base.size,
      color: href ? COLOR.link : base.color,
      underline: has("underline") || href !== null,
      strike: has("strike"),
      highlight: has("highlight"),
      code,
      link: href,
    };
  }

  private tokenize(nodes: DocNode[], base: InlineStyle): Token[] {
    const tokens: Token[] = [];

    for (const node of nodes) {
      if (node.type === "hardBreak") {
        tokens.push({ kind: "break" });
        continue;
      }
      if (node.type !== "text" || typeof node.text !== "string") continue;

      const style = this.styleFor(node.marks, base);
      const text = encode(node.text);

      for (const part of text.split(/(\s+)/)) {
        if (!part) continue;

        if (/^\s+$/.test(part)) {
          tokens.push({
            kind: "space",
            width: this.width(" ", style.font, style.size),
            style,
          });
          continue;
        }

        tokens.push({
          kind: "text",
          text: part,
          width: this.width(part, style.font, style.size),
          style,
        });
      }
    }

    return tokens;
  }

  /**
   * Greedy word wrap. Draws line by line rather than block by block, so a long
   * paragraph flows across a page break instead of jumping to the next page
   * whole.
   */
  private drawTokens(tokens: Token[], indent: number, maxWidth: number): void {
    let line: Token[] = [];
    let lineWidth = 0;

    const flush = () => {
      // Trailing spaces would push the last word off a justified edge and add
      // a stray underline for a linked space.
      while (line.length > 0 && line[line.length - 1]?.kind === "space") line.pop();
      if (line.length > 0) this.drawTokenLine(line, indent);
      line = [];
      lineWidth = 0;
    };

    for (const token of tokens) {
      if (token.kind === "break") {
        flush();
        continue;
      }

      if (token.kind === "space") {
        if (line.length === 0) continue;
        line.push(token);
        lineWidth += token.width;
        continue;
      }

      if (token.width > maxWidth) {
        // A single unbreakable run (a long URL, a hash). Split it by character
        // so it wraps instead of running into the margin.
        flush();
        for (const chunk of this.splitToWidth(token, maxWidth)) {
          this.drawTokenLine([chunk], indent);
        }
        continue;
      }

      if (lineWidth + token.width > maxWidth) flush();

      line.push(token);
      lineWidth += token.width;
    }

    flush();
  }

  private splitToWidth(
    token: Extract<Token, { kind: "text" }>,
    maxWidth: number,
  ): Extract<Token, { kind: "text" }>[] {
    const chunks: Extract<Token, { kind: "text" }>[] = [];
    let current = "";

    for (const char of token.text) {
      const next = current + char;
      if (current && this.width(next, token.style.font, token.style.size) > maxWidth) {
        chunks.push({
          kind: "text",
          text: current,
          width: this.width(current, token.style.font, token.style.size),
          style: token.style,
        });
        current = char;
        continue;
      }
      current = next;
    }

    if (current) {
      chunks.push({
        kind: "text",
        text: current,
        width: this.width(current, token.style.font, token.style.size),
        style: token.style,
      });
    }

    return chunks;
  }

  private drawTokenLine(line: Token[], indent: number): void {
    const maxSize = line.reduce(
      (max, token) => (token.kind === "break" ? max : Math.max(max, token.style.size)),
      SIZE.body * 0.5,
    );

    const lineHeight = maxSize * LINE_HEIGHT;
    this.ensure(lineHeight);

    const leading = lineHeight - maxSize;
    const baseline = this.y - leading / 2 - maxSize * 0.78;

    let x = MARGIN.left + indent;

    for (const token of line) {
      if (token.kind === "break") continue;

      const { style } = token;

      if (token.kind === "space") {
        // Decorations still apply across a space inside a marked run.
        if (style.highlight) {
          this.page.drawRectangle({
            x,
            y: baseline - style.size * 0.22,
            width: token.width,
            height: style.size * 1.12,
            color: COLOR.highlight,
          });
        }
        x += token.width;
        continue;
      }

      if (style.highlight) {
        this.page.drawRectangle({
          x,
          y: baseline - style.size * 0.22,
          width: token.width,
          height: style.size * 1.12,
          color: COLOR.highlight,
        });
      }

      if (style.code) {
        this.page.drawRectangle({
          x: x - 1,
          y: baseline - style.size * 0.24,
          width: token.width + 2,
          height: style.size * 1.16,
          color: COLOR.codeBg,
        });
      }

      this.page.drawText(token.text, {
        x,
        y: baseline,
        size: style.size,
        font: style.font,
        color: style.code && !style.link ? COLOR.codeText : style.color,
      });

      if (style.underline) {
        this.page.drawLine({
          start: { x, y: baseline - style.size * 0.13 },
          end: { x: x + token.width, y: baseline - style.size * 0.13 },
          thickness: Math.max(0.4, style.size * 0.055),
          color: style.color,
        });
      }

      if (style.strike) {
        this.page.drawLine({
          start: { x, y: baseline + style.size * 0.27 },
          end: { x: x + token.width, y: baseline + style.size * 0.27 },
          thickness: Math.max(0.4, style.size * 0.055),
          color: style.color,
        });
      }

      if (style.link) {
        this.drawExternalLink(this.page, style.link, [
          x,
          baseline - style.size * 0.25,
          x + token.width,
          baseline + style.size,
        ]);
      }

      x += token.width;
    }

    this.y -= lineHeight;
  }

  private paragraph(
    nodes: DocNode[],
    indent: number,
    options: { size?: number; color?: RGB; font?: PDFFont } = {},
  ): void {
    const base: InlineStyle = {
      font: options.font ?? this.fonts.regular,
      size: options.size ?? SIZE.body,
      color: options.color ?? COLOR.text,
      underline: false,
      strike: false,
      highlight: false,
      code: false,
      link: null,
    };

    const tokens = this.tokenize(nodes, base);
    if (tokens.length === 0) {
      // An empty paragraph is a deliberate blank line in the editor.
      this.y -= base.size * LINE_HEIGHT;
      return;
    }

    this.drawTokens(tokens, indent, CONTENT_WIDTH - indent);
  }

  private plainParagraph(
    text: string,
    indent: number,
    options: { size?: number; color?: RGB; font?: PDFFont } = {},
  ): void {
    this.paragraph([{ type: "text", text }], indent, options);
  }

  // -- blocks ---------------------------------------------------------------

  private async renderBlocks(nodes: DocNode[], indent: number): Promise<void> {
    for (const node of nodes) await this.renderBlock(node, indent);
  }

  private async renderBlock(node: DocNode, indent: number): Promise<void> {
    switch (node.type) {
      case "paragraph": {
        const children = node.content ?? [];
        // Images are modelled as block nodes but can arrive inside a
        // paragraph; splitting keeps them from being silently dropped.
        const inline = children.filter((child) => child.type !== "image");
        const images = children.filter((child) => child.type === "image");

        if (inline.length > 0 || images.length === 0) {
          this.paragraph(inline, indent);
          this.gap(6);
        }
        for (const image of images) await this.renderImage(image, indent);
        return;
      }

      case "heading": {
        const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 3);
        const size = level === 1 ? SIZE.h1 : level === 2 ? SIZE.h2 : SIZE.h3;

        this.gap(level === 1 ? 15 : level === 2 ? 13 : 10);
        // Keep-with-next: a heading alone at the foot of a page is worse than
        // a slightly short page.
        this.ensure(size * LINE_HEIGHT + SIZE.body * LINE_HEIGHT * 1.5);

        this.paragraph(node.content ?? [], indent, {
          size,
          font: this.fonts.bold,
        });
        this.gap(4);
        return;
      }

      case "bulletList":
      case "orderedList":
      case "taskList":
        await this.renderList(node, indent, 0);
        this.gap(4);
        return;

      case "blockquote":
        await this.renderBlockquote(node, indent);
        return;

      case "codeBlock":
        this.renderCodeBlock(node, indent);
        return;

      case "horizontalRule": {
        this.gap(9);
        this.ensure(10);
        this.page.drawLine({
          start: { x: MARGIN.left + indent, y: this.y },
          end: { x: PAGE_WIDTH - MARGIN.right, y: this.y },
          thickness: 0.7,
          color: COLOR.rule,
        });
        this.y -= 10;
        return;
      }

      case "image":
        await this.renderImage(node, indent);
        return;

      default:
        if (node.content) await this.renderBlocks(node.content, indent);
    }
  }

  private async renderList(
    node: DocNode,
    indent: number,
    depth: number,
  ): Promise<void> {
    const items = node.content ?? [];
    const ordered = node.type === "orderedList";
    const task = node.type === "taskList";
    const start = Number(node.attrs?.start) || 1;

    for (const [index, item] of items.entries()) {
      const marker = ordered
        ? `${start + index}.`
        : task
          ? ""
          : (BULLETS[depth % BULLETS.length] ?? "•");

      // The marker and the item's first line have to land on the same page.
      this.ensure(SIZE.body * LINE_HEIGHT);

      const markerTop = this.y;
      const leading = SIZE.body * LINE_HEIGHT - SIZE.body;
      const baseline = markerTop - leading / 2 - SIZE.body * 0.78;
      const gutterX = MARGIN.left + indent;
      const markerPage = this.page;

      if (task) {
        this.drawCheckbox(
          markerPage,
          gutterX + 1,
          baseline,
          item.attrs?.checked === true,
        );
      } else {
        this.drawLine(markerPage, encode(marker), {
          x: gutterX,
          baseline,
          font: this.fonts.regular,
          size: SIZE.body,
          color: ordered ? COLOR.muted : COLOR.text,
        });
      }

      const childIndent = indent + LIST_INDENT;

      for (const child of item.content ?? []) {
        if (
          child.type === "bulletList" ||
          child.type === "orderedList" ||
          child.type === "taskList"
        ) {
          await this.renderList(child, childIndent, depth + 1);
        } else if (child.type === "paragraph") {
          // Tighter than a standalone paragraph: list items are a unit.
          this.paragraph(child.content ?? [], childIndent);
          this.gap(2);
        } else {
          await this.renderBlock(child, childIndent);
        }
      }
    }
  }

  private drawCheckbox(
    page: PDFPage,
    x: number,
    baseline: number,
    checked: boolean,
  ): void {
    const size = SIZE.body * 0.78;
    const y = baseline - size * 0.12;

    page.drawRectangle({
      x,
      y,
      width: size,
      height: size,
      borderColor: checked ? COLOR.muted : COLOR.faint,
      borderWidth: 0.8,
      color: checked ? COLOR.muted : undefined,
    });

    if (!checked) return;

    // Drawn rather than typed: the check glyph is not in WinAnsi.
    page.drawLine({
      start: { x: x + size * 0.22, y: y + size * 0.5 },
      end: { x: x + size * 0.42, y: y + size * 0.26 },
      thickness: 1,
      color: rgb(1, 1, 1),
    });
    page.drawLine({
      start: { x: x + size * 0.42, y: y + size * 0.26 },
      end: { x: x + size * 0.8, y: y + size * 0.74 },
      thickness: 1,
      color: rgb(1, 1, 1),
    });
  }

  private async renderBlockquote(node: DocNode, indent: number): Promise<void> {
    this.gap(7);
    this.ensure(SIZE.body * LINE_HEIGHT);

    const barX = MARGIN.left + indent;
    let barTop = this.y;

    const drawBar = (page: PDFPage, top: number, bottom: number) => {
      const height = top - bottom;
      if (height <= 0) return;
      page.drawRectangle({
        x: barX,
        y: bottom,
        width: 2.5,
        height,
        color: COLOR.quoteBar,
      });
    };

    const hook = (page: PDFPage, y: number) => {
      drawBar(page, barTop, Math.max(y, MARGIN.bottom));
      barTop = CONTENT_TOP;
    };

    this.breakHooks.push(hook);
    try {
      await this.renderBlocks(node.content ?? [], indent + QUOTE_INDENT);
    } finally {
      this.breakHooks = this.breakHooks.filter((entry) => entry !== hook);
    }

    drawBar(this.page, barTop, this.y + 2);
    this.gap(6);
  }

  private renderCodeBlock(node: DocNode, indent: number): void {
    const raw = (node.content ?? []).map((child) => child.text ?? "").join("");
    const language = node.attrs?.language;
    const label = isCodeLanguage(language) ? CODE_LANGUAGE_LABELS[language] : null;

    const padding = 9;
    const width = CONTENT_WIDTH - indent;
    const innerWidth = width - padding * 2;
    const lineHeight = SIZE.code * CODE_LINE_HEIGHT;

    // Split before encoding: `encode` has no representation for a newline, so
    // encoding the block whole would flatten it into a single run.
    const lines: string[] = [];
    for (const source of raw.replace(/\r\n?/g, "\n").split("\n").map(encode)) {
      if (!source) {
        lines.push("");
        continue;
      }

      // Wrap by character: code has no safe word boundaries, and a line that
      // ran into the margin would simply be unreadable.
      let current = "";
      for (const char of source) {
        const next = current + char;
        if (current && this.width(next, this.fonts.mono, SIZE.code) > innerWidth) {
          lines.push(current);
          current = char;
          continue;
        }
        current = next;
      }
      lines.push(current);
    }

    this.gap(8);

    let cursor = 0;
    let first = true;

    while (cursor < lines.length) {
      // The language label gets a band of its own above the code — drawn into
      // the same padding it would overlap the first line.
      const band = first && label ? SIZE.small + 5 : 0;

      // At least a couple of lines, or the block starts with a stub at the
      // bottom of a page.
      this.ensure(lineHeight * 2 + padding * 2 + band);

      const room = this.available() - padding * 2 - band;
      const fit = Math.max(
        1,
        Math.min(lines.length - cursor, Math.floor(room / lineHeight)),
      );
      const chunk = lines.slice(cursor, cursor + fit);
      const height = chunk.length * lineHeight + padding * 2 + band;

      this.page.drawRectangle({
        x: MARGIN.left + indent,
        y: this.y - height,
        width,
        height,
        color: COLOR.codeBg,
      });

      if (band > 0 && label) {
        this.drawLine(this.page, encode(label), {
          x: PAGE_WIDTH - MARGIN.right - padding,
          baseline: this.y - padding - SIZE.small,
          font: this.fonts.regular,
          size: SIZE.small,
          color: COLOR.faint,
          align: "right",
        });
      }

      let baseline = this.y - padding - band - SIZE.code;

      for (const line of chunk) {
        if (line) {
          this.page.drawText(line, {
            x: MARGIN.left + indent + padding,
            y: baseline,
            size: SIZE.code,
            font: this.fonts.mono,
            color: COLOR.codeText,
          });
        }
        baseline -= lineHeight;
      }

      this.y -= height;
      cursor += fit;
      first = false;

      if (cursor < lines.length) this.newPage();
    }

    this.gap(8);
  }

  private async renderImage(node: DocNode, indent: number): Promise<void> {
    const src = typeof node.attrs?.src === "string" ? node.attrs.src : null;
    const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : null;
    const caption = typeof node.attrs?.caption === "string" ? node.attrs.caption : null;
    const maxWidth = CONTENT_WIDTH - indent;

    const embedded = src ? await this.embedImage(src) : null;

    if (!embedded) {
      // The label carries whatever the user wrote about the image, so an
      // export that cannot embed it still says what was there.
      const description = alt ?? caption;
      this.gap(6);
      this.plainParagraph(`[image${description ? `: ${description}` : ""}]`, indent, {
        size: SIZE.small,
        color: COLOR.faint,
        font: this.fonts.italic,
      });
      this.gap(4);
      return;
    }

    // CSS pixels to PDF points at the usual 96 dpi.
    const requested = Number(node.attrs?.width);
    const naturalWidth =
      Number.isFinite(requested) && requested > 0
        ? requested * 0.75
        : embedded.width * 0.75;

    let drawWidth = Math.min(naturalWidth, maxWidth);
    let drawHeight = (embedded.height / embedded.width) * drawWidth;

    // A tall image must still fit one page, or it can never be placed.
    const maxHeight = CONTENT_TOP - MARGIN.bottom;
    if (drawHeight > maxHeight) {
      drawHeight = maxHeight;
      drawWidth = (embedded.width / embedded.height) * drawHeight;
    }

    this.gap(8);
    this.ensure(drawHeight);

    const align = node.attrs?.align;
    const left =
      align === "left"
        ? MARGIN.left + indent
        : align === "right"
          ? PAGE_WIDTH - MARGIN.right - drawWidth
          : MARGIN.left + indent + (maxWidth - drawWidth) / 2;

    this.page.drawImage(embedded, {
      x: left,
      y: this.y - drawHeight,
      width: drawWidth,
      height: drawHeight,
    });
    this.y -= drawHeight;

    if (caption) {
      this.gap(5);
      this.plainParagraph(caption, indent, {
        size: SIZE.small,
        color: COLOR.muted,
        font: this.fonts.italic,
      });
    }

    this.gap(8);
  }

  private async embedImage(src: string): Promise<PDFImage | null> {
    const cached = this.imageCache.get(src);
    if (cached !== undefined) return cached;

    let image: PDFImage | null = null;

    try {
      const loaded = await this.input.loadImage?.(src);
      if (loaded) {
        image =
          loaded.format === "png"
            ? await this.pdf.embedPng(loaded.data)
            : await this.pdf.embedJpg(loaded.data);
      }
    } catch {
      // A corrupt or unsupported image must not fail the export.
      image = null;
    }

    this.imageCache.set(src, image);
    return image;
  }

  // -- document assembly ----------------------------------------------------

  private drawCover(): void {
    this.newPage();
    this.y = PAGE_HEIGHT * 0.62;

    this.plainParagraph("SM NOTES MAKER", 0, {
      size: SIZE.small,
      color: COLOR.faint,
    });
    this.gap(10);

    this.paragraph([{ type: "text", text: this.input.title }], 0, {
      size: SIZE.coverTitle,
      font: this.fonts.bold,
    });

    if (this.input.subtitle) {
      this.gap(6);
      this.plainParagraph(this.input.subtitle, 0, {
        size: SIZE.coverSubtitle,
        color: COLOR.muted,
      });
    }

    this.gap(18);
    this.page.drawLine({
      start: { x: MARGIN.left, y: this.y },
      end: { x: MARGIN.left + 64, y: this.y },
      thickness: 2,
      color: COLOR.text,
    });
    this.y -= 18;

    for (const line of this.input.meta ?? []) {
      this.plainParagraph(line, 0, { size: SIZE.small, color: COLOR.muted });
    }
  }

  private drawSectionHeader(section: PdfSection, index: number): void {
    if (this.input.layout === "collection") {
      this.plainParagraph(`${index + 1}`, 0, {
        size: SIZE.small,
        color: COLOR.faint,
        font: this.fonts.bold,
      });
      this.gap(2);
    }

    this.paragraph([{ type: "text", text: section.title }], 0, {
      size:
        this.input.layout === "collection" ? SIZE.sectionTitle : SIZE.coverSubtitle + 7,
      font: this.fonts.bold,
    });

    for (const line of section.meta ?? []) {
      this.gap(3);
      this.plainParagraph(line, 0, { size: SIZE.small, color: COLOR.muted });
    }

    this.gap(10);
    this.page.drawLine({
      start: { x: MARGIN.left, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN.right, y: this.y },
      thickness: 0.7,
      color: COLOR.rule,
    });
    this.y -= 16;
  }

  /** Table of contents pages, inserted after the cover once the body exists. */
  private drawContents(entries: TocEntry[], insertAt: number, pageCount: number): void {
    const entryHeight = SIZE.body * 1.9;
    const headerHeight = 46;

    const pages: PDFPage[] = [];
    for (let index = 0; index < pageCount; index++) {
      pages.push(this.pdf.insertPage(insertAt + index, [PAGE_WIDTH, PAGE_HEIGHT]));
    }

    let pageIndex = 0;
    let page = pages[0];
    if (!page) return;

    let y = CONTENT_TOP;

    this.drawLine(page, "Contents", {
      x: MARGIN.left,
      baseline: y - SIZE.h1,
      font: this.fonts.bold,
      size: SIZE.h1,
      color: COLOR.text,
    });
    y -= headerHeight;

    for (const [index, entry] of entries.entries()) {
      if (y - entryHeight < MARGIN.bottom) {
        pageIndex += 1;
        const next = pages[pageIndex];
        if (!next) break;
        page = next;
        y = CONTENT_TOP;
      }

      const baseline = y - SIZE.body;
      // Cover + contents + how far into the body the section starts.
      const displayed = 1 + pageCount + entry.bodyIndex + 1;
      const numberText = String(displayed);
      const numberWidth = this.width(numberText, this.fonts.regular, SIZE.body);

      const numberLabel = `${index + 1}.`;
      const numberLabelWidth = this.drawLine(page, encode(numberLabel), {
        x: MARGIN.left,
        baseline,
        font: this.fonts.regular,
        size: SIZE.body,
        color: COLOR.faint,
      });

      const titleX = MARGIN.left + Math.max(numberLabelWidth + 6, 22);
      const titleMax = CONTENT_WIDTH - (titleX - MARGIN.left) - numberWidth - 24;
      const titleWidth = this.drawLine(page, encode(entry.title), {
        x: titleX,
        baseline,
        font: this.fonts.regular,
        size: SIZE.body,
        color: COLOR.text,
        maxWidth: titleMax,
      });

      // Dot leader between the title and the page number.
      const leaderStart = titleX + titleWidth + 5;
      const leaderEnd = PAGE_WIDTH - MARGIN.right - numberWidth - 5;
      if (leaderEnd > leaderStart) {
        page.drawLine({
          start: { x: leaderStart, y: baseline + 2 },
          end: { x: leaderEnd, y: baseline + 2 },
          thickness: 0.5,
          color: COLOR.rule,
          dashArray: [0.6, 2.6],
        });
      }

      this.drawLine(page, numberText, {
        x: PAGE_WIDTH - MARGIN.right,
        baseline,
        font: this.fonts.regular,
        size: SIZE.body,
        color: COLOR.muted,
        align: "right",
      });

      this.drawInternalLink(page, entry.pageRef, [
        MARGIN.left,
        baseline - 3,
        PAGE_WIDTH - MARGIN.right,
        baseline + SIZE.body,
      ]);

      y -= entryHeight;
    }
  }

  private countContentsPages(entries: number): number {
    const entryHeight = SIZE.body * 1.9;
    const usable = CONTENT_TOP - MARGIN.bottom;
    const first = Math.max(1, Math.floor((usable - 46) / entryHeight));
    const rest = Math.max(1, Math.floor(usable / entryHeight));

    if (entries <= first) return 1;
    return 1 + Math.ceil((entries - first) / rest);
  }

  /**
   * Footers are drawn last, over the finished page list, so numbering already
   * accounts for the contents pages spliced in after the body was laid out.
   */
  private drawFooters(skipFirst: boolean): void {
    const pages = this.pdf.getPages();
    const total = pages.length;

    for (const [index, page] of pages.entries()) {
      if (skipFirst && index === 0) continue;

      page.drawLine({
        start: { x: MARGIN.left, y: FOOTER_BASELINE + 14 },
        end: { x: PAGE_WIDTH - MARGIN.right, y: FOOTER_BASELINE + 14 },
        thickness: 0.5,
        color: COLOR.rule,
      });

      const left = this.input.footerNote
        ? `${this.input.title} · ${this.input.footerNote}`
        : this.input.title;

      this.drawLine(page, encode(left), {
        x: MARGIN.left,
        baseline: FOOTER_BASELINE,
        font: this.fonts.regular,
        size: SIZE.small,
        color: COLOR.faint,
        maxWidth: CONTENT_WIDTH - 70,
      });

      this.drawLine(page, `${index + 1} / ${total}`, {
        x: PAGE_WIDTH - MARGIN.right,
        baseline: FOOTER_BASELINE,
        font: this.fonts.regular,
        size: SIZE.small,
        color: COLOR.faint,
        align: "right",
      });
    }
  }

  async build(): Promise<Uint8Array<ArrayBuffer>> {
    const collection = this.input.layout === "collection";
    const sections = this.input.sections;

    if (collection) this.drawCover();

    const bodyStart = this.pdf.getPageCount();
    const entries: TocEntry[] = [];

    for (const [index, section] of sections.entries()) {
      this.newPage();

      entries.push({
        title: section.title,
        pageRef: this.page,
        bodyIndex: this.pdf.getPageCount() - 1 - bodyStart,
      });

      this.drawSectionHeader(section, index);

      const blocks = section.doc.content ?? [];
      if (blocks.length === 0) {
        this.plainParagraph("This page is empty.", 0, {
          size: SIZE.body,
          color: COLOR.faint,
          font: this.fonts.italic,
        });
      } else {
        await this.renderBlocks(blocks, 0);
      }
    }

    if (sections.length === 0) {
      this.newPage();
      this.drawSectionHeader({ title: this.input.title, doc: { type: "doc" } }, 0);
      this.plainParagraph("Nothing to export yet.", 0, {
        size: SIZE.body,
        color: COLOR.faint,
        font: this.fonts.italic,
      });
    }

    if (collection && entries.length > 0) {
      this.drawContents(entries, bodyStart, this.countContentsPages(entries.length));
    }

    this.drawFooters(collection);

    // pdf-lib always allocates a plain ArrayBuffer; the narrowing is what lets
    // the bytes be handed straight to a Response without a copy.
    return (await this.pdf.save()) as Uint8Array<ArrayBuffer>;
  }
}

export async function renderPdf(
  input: PdfDocumentInput,
): Promise<Uint8Array<ArrayBuffer>> {
  const builder = await PdfBuilder.create(input);
  return builder.build();
}
