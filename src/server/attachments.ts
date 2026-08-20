import "server-only";

import { del, get } from "@vercel/blob";

import { env } from "@/lib/env";
import { imageSrcForPathname } from "@/lib/editor/image-src";
import { prisma } from "@/lib/prisma";

/**
 * Bookkeeping for uploaded images.
 *
 * The rows exist so that blobs can be attributed to an owner and, more
 * importantly, cleaned up: without a record, an image deleted from a note
 * would sit in storage forever and nothing would know it was orphaned.
 *
 * With a private blob store the table earns a second job: it is the only
 * record of who may read a given blob, so every read goes through
 * `readAttachmentBytes` below rather than through a URL.
 */

export type AttachmentBytes = {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number | null;
  filename: string;
};

/**
 * Opens a private blob for one user.
 *
 * Returns null both when the blob does not exist and when it belongs to
 * somebody else — the caller has no way to tell the two apart, which is what
 * stops this becoming a way to probe which pathnames are real.
 */
export async function readAttachmentBytes(
  userId: string,
  pathname: string,
): Promise<AttachmentBytes | null> {
  const attachment = await prisma.attachment.findFirst({
    where: { pathname, userId },
    select: { filename: true, mimeType: true, size: true },
  });

  if (!attachment) return null;
  if (!env.BLOB_READ_WRITE_TOKEN) return null;

  const result = await get(pathname, { access: "private" }).catch(() => null);
  if (!result?.stream) return null;

  return {
    stream: result.stream,
    // The stored MIME type is the one the upload route allowlisted. Preferring
    // it over whatever storage reports keeps a mislabelled blob from being
    // served back as something the allowlist would have rejected.
    contentType: attachment.mimeType || result.blob.contentType || "image/png",
    size: attachment.size > 0 ? attachment.size : (result.blob.size ?? null),
    // Passed through as stored; making it safe for a header is the caller's
    // job, and lib/http-headers.ts is the single place that knows how.
    filename: attachment.filename || "image",
  };
}

export async function recordAttachment(
  userId: string,
  input: {
    url: string;
    pathname: string;
    filename: string;
    mimeType: string;
    size: number;
    width?: number;
    height?: number;
    pageId?: string;
  },
) {
  // Upsert because two paths can record the same blob: the Vercel webhook
  // (production) and the client (which is the only one that fires on
  // localhost, where the webhook cannot reach us).
  return prisma.attachment.upsert({
    where: { pathname: input.pathname },
    create: {
      userId,
      url: input.url,
      pathname: input.pathname,
      filename: input.filename.slice(0, 255),
      mimeType: input.mimeType,
      size: input.size,
      width: input.width ?? null,
      height: input.height ?? null,
      pageId: input.pageId ?? null,
    },
    update: {
      // Only fills in what the webhook could not know. Never reassigns
      // `userId` — that would let a second write steal ownership of a blob.
      ...(input.size > 0 ? { size: input.size } : {}),
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
      ...(input.pageId ? { pageId: input.pageId } : {}),
    },
    select: { id: true, url: true },
  });
}

export async function listAttachments(userId: string, pageId?: string) {
  return prisma.attachment.findMany({
    where: { userId, ...(pageId ? { pageId } : {}) },
    select: {
      id: true,
      url: true,
      filename: true,
      mimeType: true,
      size: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

/**
 * Deletes blobs that no note references any more.
 *
 * Deliberately conservative on two counts. It only considers uploads older
 * than a day, so a blob created seconds ago — uploaded but not yet saved into
 * the document — is never swept away mid-edit. And it checks the actual
 * document text for the URL rather than trusting `pageId`, because an image
 * can be copied into a different page than the one it was uploaded to.
 */
export async function deleteOrphanedAttachments(
  options: {
    olderThanMs?: number;
    dryRun?: boolean;
  } = {},
): Promise<{ examined: number; deleted: number }> {
  const cutoff = new Date(Date.now() - (options.olderThanMs ?? 24 * 60 * 60 * 1000));

  const candidates = await prisma.attachment.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, url: true, pathname: true, userId: true },
    take: 500,
  });

  if (candidates.length === 0) return { examined: 0, deleted: 0 };

  let deleted = 0;

  for (const attachment of candidates) {
    // Documents hold the app path, not the storage URL — see lib/editor/
    // image-src.ts. Searching for the wrong one would find nothing and sweep
    // away every image that is still on a page.
    const src = imageSrcForPathname(attachment.pathname);

    const referenced = await prisma.page.count({
      where: {
        userId: attachment.userId,
        OR: [{ content: { string_contains: src } }, { coverImage: src }],
      },
    });

    if (referenced > 0) continue;

    if (!options.dryRun) {
      if (env.BLOB_READ_WRITE_TOKEN) {
        // By pathname rather than URL: a private blob's URL is not something
        // anything else in the app holds on to.
        // A blob that is already gone should not stop the sweep.
        await del(attachment.pathname).catch(() => undefined);
      }
      await prisma.attachment.delete({ where: { id: attachment.id } });
    }

    deleted++;
  }

  return { examined: candidates.length, deleted };
}

export async function getStorageUsage(userId: string): Promise<number> {
  const result = await prisma.attachment.aggregate({
    where: { userId },
    _sum: { size: true },
  });
  return result._sum.size ?? 0;
}
