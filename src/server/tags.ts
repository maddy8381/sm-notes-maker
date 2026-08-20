import "server-only";

import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

/**
 * Tags are per-user, not global. Two people can both have "#debugging" and
 * they are separate rows — a shared tag table would leak the existence of
 * other users' vocabulary through autocomplete.
 */

export type TagWithCount = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  pageCount: number;
};

export async function listTags(userId: string): Promise<TagWithCount[]> {
  const rows = await prisma.tag.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      slug: true,
      color: true,
      _count: { select: { pages: { where: { page: { deletedAt: null } } } } },
    },
    orderBy: { name: "asc" },
  });

  return rows.map(({ _count, ...tag }) => ({ ...tag, pageCount: _count.pages }));
}

/**
 * Finds or creates a tag by name.
 *
 * Upsert rather than check-then-insert: two pages tagged simultaneously would
 * both pass an existence check and one would then violate the unique
 * constraint.
 */
export async function ensureTag(
  userId: string,
  name: string,
): Promise<{ id: string; name: string; slug: string; color: string | null }> {
  const trimmed = name.trim().replace(/^#/, "").slice(0, 40);
  const slug = slugify(trimmed);

  return prisma.tag.upsert({
    where: { userId_slug: { userId, slug } },
    create: { userId, name: trimmed, slug },
    update: {},
    select: { id: true, name: true, slug: true, color: true },
  });
}

/**
 * Replaces a page's tags wholesale. Simpler than diffing, and the page tag
 * count is small enough that the extra writes do not matter.
 */
export async function setPageTags(
  userId: string,
  pageId: string,
  tagNames: string[],
): Promise<boolean> {
  const owns = await prisma.page.findFirst({
    where: { id: pageId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!owns) return false;

  const unique = [...new Set(tagNames.map((n) => n.trim()).filter(Boolean))].slice(
    0,
    20,
  );

  const tags = await Promise.all(unique.map((name) => ensureTag(userId, name)));

  await prisma.$transaction([
    prisma.pageTag.deleteMany({ where: { pageId } }),
    prisma.pageTag.createMany({
      data: tags.map((tag) => ({ pageId, tagId: tag.id })),
      skipDuplicates: true,
    }),
  ]);

  return true;
}

export async function getTagBySlug(userId: string, slug: string) {
  return prisma.tag.findFirst({
    where: { userId, slug },
    select: { id: true, name: true, slug: true, color: true },
  });
}

export async function listPagesByTag(userId: string, tagSlug: string) {
  const rows = await prisma.page.findMany({
    where: {
      userId,
      deletedAt: null,
      tags: { some: { tag: { userId, slug: tagSlug } } },
    },
    select: {
      id: true,
      title: true,
      slug: true,
      contentText: true,
      updatedAt: true,
      isFavorite: true,
      technology: { select: { name: true, slug: true, icon: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return rows.map(({ contentText, ...row }) => ({
    ...row,
    excerpt: contentText.slice(0, 140),
  }));
}

export async function renameTag(
  userId: string,
  id: string,
  name: string,
): Promise<boolean> {
  const { count } = await prisma.tag.updateMany({
    where: { id, userId },
    data: { name: name.trim().replace(/^#/, "").slice(0, 40) },
  });
  return count > 0;
}

export async function deleteTag(userId: string, id: string): Promise<boolean> {
  // The PageTag rows go with it via cascade; the pages themselves are
  // untouched.
  const { count } = await prisma.tag.deleteMany({ where: { id, userId } });
  return count > 0;
}

/** Tags with no remaining pages, cleared by the maintenance cron. */
export async function deleteOrphanedTags(userId: string): Promise<number> {
  const { count } = await prisma.tag.deleteMany({
    where: { userId, pages: { none: {} } },
  });
  return count;
}
