import "server-only";

import { del } from "@vercel/blob";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

/**
 * Bookkeeping for uploaded images.
 *
 * The rows exist so that blobs can be attributed to an owner and, more
 * importantly, cleaned up: without a record, an image deleted from a note
 * would sit in storage forever and nothing would know it was orphaned.
 */

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
    const referenced = await prisma.page.count({
      where: {
        userId: attachment.userId,
        OR: [
          { content: { string_contains: attachment.url } },
          { coverImage: attachment.url },
        ],
      },
    });

    if (referenced > 0) continue;

    if (!options.dryRun) {
      if (env.BLOB_READ_WRITE_TOKEN) {
        // A blob that is already gone should not stop the sweep.
        await del(attachment.url).catch(() => undefined);
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
