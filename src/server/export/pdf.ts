import "server-only";

import { prisma } from "@/lib/prisma";
import { EMPTY_DOC, type DocJSON } from "@/lib/editor/content";
import { pathnameFromImageSrc } from "@/lib/editor/image-src";
import { readAttachmentBytes } from "@/server/attachments";
import { renderPdf, type ImageLoader, type PdfImageData } from "@/lib/pdf/render";
import { slugify } from "@/lib/utils";

/**
 * PDF exports — one note, or a whole technology as a single bound document.
 *
 * As everywhere in src/server, `userId` is a required argument and part of
 * every `where`: an export is a read of someone's private notes, and the id in
 * the URL is not evidence of ownership.
 */

const NOT_DELETED = { deletedAt: null } as const;

/**
 * Upper bound on a combined export. Beyond this the request stops being a
 * download and starts being a job — better to cap it, say so in the footer,
 * and keep the response inside a serverless function's budget.
 */
const MAX_SECTIONS = 200;

export type PdfExport = { filename: string; bytes: Uint8Array<ArrayBuffer> };

export async function buildPagePdf(
  userId: string,
  pageId: string,
): Promise<PdfExport | null> {
  const page = await prisma.page.findFirst({
    where: { id: pageId, userId, ...NOT_DELETED },
    select: {
      title: true,
      slug: true,
      content: true,
      updatedAt: true,
      technology: { select: { name: true } },
      tags: { select: { tag: { select: { name: true } } } },
      user: { select: { name: true } },
    },
  });

  if (!page) return null;

  const bytes = await renderPdf({
    title: page.title,
    author: page.user.name,
    layout: "single",
    loadImage: createImageLoader(userId),
    sections: [
      {
        title: page.title,
        meta: metaLines({
          technology: page.technology.name,
          updatedAt: page.updatedAt,
          tags: page.tags.map((entry) => entry.tag.name),
        }),
        doc: (page.content as DocJSON) ?? EMPTY_DOC,
      },
    ],
  });

  return { filename: `${slugify(page.title)}.pdf`, bytes };
}

export async function buildTechnologyPdf(
  userId: string,
  technologyId: string,
): Promise<PdfExport | null> {
  const technology = await prisma.technology.findFirst({
    where: { id: technologyId, userId, ...NOT_DELETED },
    select: {
      name: true,
      slug: true,
      description: true,
      user: { select: { name: true } },
    },
  });

  if (!technology) return null;

  const [pages, total] = await Promise.all([
    prisma.page.findMany({
      where: { userId, technologyId, ...NOT_DELETED },
      select: {
        title: true,
        content: true,
        updatedAt: true,
        tags: { select: { tag: { select: { name: true } } } },
      },
      // The same order the technology page shows, so the PDF matches what the
      // user arranged on screen.
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      take: MAX_SECTIONS,
    }),
    prisma.page.count({ where: { userId, technologyId, ...NOT_DELETED } }),
  ]);

  const truncated = total > pages.length;

  const bytes = await renderPdf({
    title: technology.name,
    subtitle: technology.description,
    author: technology.user.name,
    layout: "collection",
    // One loader for the whole document: an image used on ten pages is
    // fetched and embedded once.
    loadImage: createImageLoader(userId),
    meta: [
      `${pages.length} ${pages.length === 1 ? "page" : "pages"}`,
      `Exported ${formatDate(new Date())}`,
      ...(technology.user.name ? [`By ${technology.user.name}`] : []),
    ],
    footerNote: truncated ? `first ${pages.length} of ${total} pages` : null,
    sections: pages.map((page) => ({
      title: page.title,
      meta: metaLines({
        updatedAt: page.updatedAt,
        tags: page.tags.map((entry) => entry.tag.name),
      }),
      doc: (page.content as DocJSON) ?? EMPTY_DOC,
    })),
  });

  return { filename: `${slugify(technology.name)}-notes.pdf`, bytes };
}

function metaLines(input: {
  technology?: string;
  updatedAt: Date;
  tags: string[];
}): string[] {
  const first = [
    ...(input.technology ? [input.technology] : []),
    `Updated ${formatDate(input.updatedAt)}`,
  ].join(" · ");

  return [
    first,
    ...(input.tags.length > 0 ? [input.tags.map((t) => `#${t}`).join("  ")] : []),
  ];
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Reads an image for embedding.
 *
 * No HTTP at all: the blobs are private, so the export opens them through the
 * same owner-checked path the browser uses (`readAttachmentBytes`) rather than
 * fetching a URL. Passing `userId` down is what makes that a real check — an
 * export can only ever embed images belonging to the person exporting, even if
 * a document somehow references somebody else's pathname.
 *
 * The pleasant side effect is that this function can no longer make an
 * outbound request, so the SSRF surface an export used to carry is gone.
 *
 * Only PNG and JPEG are embeddable by pdf-lib — a WebP or AVIF upload renders
 * as a placeholder rather than failing the export.
 */
function createImageLoader(userId: string): ImageLoader {
  return async (src) => {
    if (src.startsWith("data:image/")) return fromDataUrl(src);

    const pathname = pathnameFromImageSrc(src);
    if (!pathname) return null;

    try {
      const attachment = await readAttachmentBytes(userId, pathname);
      if (!attachment) return null;

      const format = formatFor(attachment.contentType);
      if (!format) {
        await attachment.stream.cancel().catch(() => undefined);
        return null;
      }

      const data = await readStream(attachment.stream, MAX_IMAGE_BYTES);
      return data ? { data, format } : null;
    } catch {
      return null;
    }
  };
}

/** Reads a stream into memory, giving up rather than buffering past `limit`. */
async function readStream(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return data;
}

function fromDataUrl(src: string): PdfImageData | null {
  const match = src.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  if (!match) return null;

  const format = formatFor(match[1] ?? null);
  if (!format) return null;

  try {
    const data = new Uint8Array(Buffer.from(match[2] ?? "", "base64"));
    if (data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) return null;
    return { data, format };
  } catch {
    return null;
  }
}

function formatFor(contentType: string | null): "png" | "jpg" | null {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  if (type === "image/png") return "png";
  if (type === "image/jpeg" || type === "image/jpg") return "jpg";
  return null;
}
