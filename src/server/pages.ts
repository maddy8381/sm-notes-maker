import "server-only";

import { prisma } from "@/lib/prisma";
import {
  EMPTY_DOC,
  extractExcerpt,
  extractText,
  type DocJSON,
} from "@/lib/editor/content";
import { positionAfter, rebalance } from "@/lib/position";
import { asJson } from "@/server/json";
import { slugify, uniqueSlug } from "@/lib/utils";

/**
 * Pages — the actual notes.
 *
 * As in technologies.ts, `userId` is a required first argument on everything
 * and appears in every `where`. Ownership is never inferred from the parent
 * technology, even though a page always has one: checking the page's own
 * `userId` means a mismatched pair cannot be exploited.
 */

const NOT_DELETED = { deletedAt: null } as const;

export type PageSummary = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  isFavorite: boolean;
  position: number;
  coverImage: string | null;
  updatedAt: Date;
  createdAt: Date;
  tags: { id: string; name: string; slug: string; color: string | null }[];
};

export type PageDetail = PageSummary & {
  content: DocJSON;
  revision: number;
  technology: { id: string; name: string; slug: string };
  author: { id: string; name: string };
};

const summarySelect = {
  id: true,
  title: true,
  slug: true,
  contentText: true,
  isFavorite: true,
  position: true,
  coverImage: true,
  createdAt: true,
  updatedAt: true,
  tags: {
    select: { tag: { select: { id: true, name: true, slug: true, color: true } } },
  },
} as const;

type SummaryRow = {
  id: string;
  title: string;
  slug: string;
  contentText: string;
  isFavorite: boolean;
  position: number;
  coverImage: string | null;
  createdAt: Date;
  updatedAt: Date;
  tags: { tag: { id: string; name: string; slug: string; color: string | null } }[];
};

function toSummary(row: SummaryRow): PageSummary {
  const { contentText, tags, ...rest } = row;
  return {
    ...rest,
    // Excerpt comes from the flattened text rather than the JSON: it is
    // already stored, already plain, and avoids parsing the document just to
    // render a list.
    excerpt: contentText.slice(0, 180),
    tags: tags.map((t) => t.tag),
  };
}

export async function listPagesForTechnology(
  userId: string,
  technologyId: string,
): Promise<PageSummary[]> {
  const rows = await prisma.page.findMany({
    where: { userId, technologyId, ...NOT_DELETED },
    select: summarySelect,
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toSummary);
}

export async function getPageBySlug(
  userId: string,
  technologyId: string,
  slug: string,
): Promise<PageDetail | null> {
  const row = await prisma.page.findFirst({
    where: { userId, technologyId, slug, ...NOT_DELETED },
    select: {
      ...summarySelect,
      content: true,
      revision: true,
      technology: { select: { id: true, name: true, slug: true } },
      user: { select: { id: true, name: true } },
    },
  });

  if (!row) return null;

  const { content, revision, technology, user, ...summary } = row;
  return {
    ...toSummary(summary),
    content: (content as DocJSON) ?? EMPTY_DOC,
    revision,
    technology,
    author: user,
  };
}

export async function getPageById(userId: string, id: string) {
  return prisma.page.findFirst({
    where: { id, userId, ...NOT_DELETED },
    select: {
      id: true,
      title: true,
      slug: true,
      revision: true,
      technologyId: true,
      technology: { select: { slug: true } },
    },
  });
}

export async function createPage(
  userId: string,
  input: {
    technologyId: string;
    title: string;
    content?: DocJSON;
    tagIds?: string[];
  },
): Promise<{ id: string; slug: string } | null> {
  // The technology has to belong to the same user, or a caller could create a
  // page inside someone else's collection by guessing an id.
  const technology = await prisma.technology.findFirst({
    where: { id: input.technologyId, userId, ...NOT_DELETED },
    select: { id: true },
  });
  if (!technology) return null;

  const [existing, last] = await Promise.all([
    prisma.page.findMany({
      where: { technologyId: input.technologyId },
      select: { slug: true },
    }),
    prisma.page.findFirst({
      where: { technologyId: input.technologyId, ...NOT_DELETED },
      orderBy: { position: "desc" },
      select: { position: true },
    }),
  ]);

  const content = input.content ?? EMPTY_DOC;
  const slug = uniqueSlug(
    slugify(input.title),
    existing.map((p) => p.slug),
  );

  const page = await prisma.page.create({
    data: {
      userId,
      technologyId: input.technologyId,
      title: input.title,
      slug,
      content: asJson(content),
      contentText: extractText(content),
      position: positionAfter(last?.position),
      ...(input.tagIds?.length
        ? { tags: { create: input.tagIds.map((tagId) => ({ tagId })) } }
        : {}),
    },
    select: { id: true, slug: true },
  });

  await touchTechnology(input.technologyId);
  return page;
}

export type SaveResult =
  | { status: "saved"; revision: number; updatedAt: Date }
  | { status: "not_found" }
  | { status: "stale"; currentRevision: number };

/**
 * The autosave write path.
 *
 * `expectedRevision` is what the editor had when it loaded. If the stored
 * revision has moved on, another tab (or another device) saved in the
 * meantime and this write is refused rather than allowed to overwrite it.
 * Losing a paragraph to a silently-clobbered save is the failure mode this
 * exists to prevent.
 */
export async function savePageContent(
  userId: string,
  input: {
    id: string;
    title?: string;
    content?: DocJSON;
    expectedRevision: number;
  },
): Promise<SaveResult> {
  const current = await prisma.page.findFirst({
    where: { id: input.id, userId, ...NOT_DELETED },
    select: { id: true, revision: true, technologyId: true },
  });

  if (!current) return { status: "not_found" };

  if (current.revision !== input.expectedRevision) {
    return { status: "stale", currentRevision: current.revision };
  }

  // The revision check is repeated inside the update. Between the read above
  // and this write, a concurrent save could land; making `revision` part of
  // the WHERE turns that race into an affected-rows count of zero rather than
  // a lost update.
  const { count } = await prisma.page.updateMany({
    where: { id: input.id, userId, revision: input.expectedRevision },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined
        ? { content: asJson(input.content), contentText: extractText(input.content) }
        : {}),
      revision: { increment: 1 },
    },
  });

  if (count === 0) {
    const latest = await prisma.page.findUnique({
      where: { id: input.id },
      select: { revision: true },
    });
    return { status: "stale", currentRevision: latest?.revision ?? 0 };
  }

  const saved = await prisma.page.findUniqueOrThrow({
    where: { id: input.id },
    select: { revision: true, updatedAt: true },
  });

  await touchTechnology(current.technologyId);

  return { status: "saved", revision: saved.revision, updatedAt: saved.updatedAt };
}

export async function renamePage(
  userId: string,
  id: string,
  title: string,
): Promise<boolean> {
  // The slug deliberately does not follow the title. Changing it would break
  // any link the user has already shared or bookmarked, and the slug is not
  // shown anywhere that makes a stale one confusing.
  const { count } = await prisma.page.updateMany({
    where: { id, userId, ...NOT_DELETED },
    data: { title },
  });
  return count > 0;
}

export async function setPageFavorite(
  userId: string,
  id: string,
  isFavorite: boolean,
): Promise<boolean> {
  const { count } = await prisma.page.updateMany({
    where: { id, userId, ...NOT_DELETED },
    data: { isFavorite },
  });
  return count > 0;
}

export async function duplicatePage(
  userId: string,
  id: string,
): Promise<{ id: string; slug: string } | null> {
  const source = await prisma.page.findFirst({
    where: { id, userId, ...NOT_DELETED },
    select: {
      title: true,
      content: true,
      contentText: true,
      coverImage: true,
      technologyId: true,
      position: true,
      tags: { select: { tagId: true } },
    },
  });
  if (!source) return null;

  const existing = await prisma.page.findMany({
    where: { technologyId: source.technologyId },
    select: { slug: true },
  });

  const title = `${source.title} (copy)`;
  const last = await prisma.page.findFirst({
    where: { technologyId: source.technologyId, ...NOT_DELETED },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const copy = await prisma.page.create({
    data: {
      userId,
      technologyId: source.technologyId,
      title,
      slug: uniqueSlug(
        slugify(title),
        existing.map((p) => p.slug),
      ),
      content: asJson(source.content ?? EMPTY_DOC),
      contentText: source.contentText,
      coverImage: source.coverImage,
      position: positionAfter(last?.position),
      tags: { create: source.tags.map((t) => ({ tagId: t.tagId })) },
    },
    select: { id: true, slug: true },
  });

  await touchTechnology(source.technologyId);
  return copy;
}

/**
 * Moves a page into another technology. The destination slug may collide with
 * something already there, so it is recomputed rather than carried over.
 */
export async function movePageToTechnology(
  userId: string,
  id: string,
  technologyId: string,
): Promise<{ slug: string; technologySlug: string } | null> {
  const [page, destination] = await Promise.all([
    prisma.page.findFirst({
      where: { id, userId, ...NOT_DELETED },
      select: { id: true, title: true, technologyId: true },
    }),
    prisma.technology.findFirst({
      where: { id: technologyId, userId, ...NOT_DELETED },
      select: { id: true, slug: true },
    }),
  ]);

  if (!page || !destination) return null;
  if (page.technologyId === technologyId) return null;

  const [existing, last] = await Promise.all([
    prisma.page.findMany({ where: { technologyId }, select: { slug: true } }),
    prisma.page.findFirst({
      where: { technologyId, ...NOT_DELETED },
      orderBy: { position: "desc" },
      select: { position: true },
    }),
  ]);

  const slug = uniqueSlug(
    slugify(page.title),
    existing.map((p) => p.slug),
  );

  await prisma.page.updateMany({
    where: { id, userId },
    data: { technologyId, slug, position: positionAfter(last?.position) },
  });

  await Promise.all([
    touchTechnology(page.technologyId),
    touchTechnology(technologyId),
  ]);

  return { slug, technologySlug: destination.slug };
}

export async function movePage(
  userId: string,
  id: string,
  newPosition: number,
): Promise<boolean> {
  const { count } = await prisma.page.updateMany({
    where: { id, userId, ...NOT_DELETED },
    data: { position: newPosition },
  });
  return count > 0;
}

export async function rebalancePages(
  userId: string,
  technologyId: string,
): Promise<void> {
  const rows = await prisma.page.findMany({
    where: { userId, technologyId, ...NOT_DELETED },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  await prisma.$transaction(
    rebalance(rows).map(({ item, position }) =>
      prisma.page.update({ where: { id: item.id }, data: { position } }),
    ),
  );
}

export async function deletePage(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.page.updateMany({
    where: { id, userId, ...NOT_DELETED },
    data: { deletedAt: new Date() },
  });
  return count > 0;
}

export async function restorePage(userId: string, id: string): Promise<boolean> {
  // A page cannot come back into a technology that is itself in the trash —
  // it would be unreachable and look like the restore silently failed.
  const page = await prisma.page.findFirst({
    where: { id, userId, deletedAt: { not: null } },
    select: { technology: { select: { deletedAt: true } } },
  });
  if (!page || page.technology.deletedAt) return false;

  const { count } = await prisma.page.updateMany({
    where: { id, userId },
    data: { deletedAt: null },
  });
  return count > 0;
}

export async function purgePage(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.page.deleteMany({
    where: { id, userId, deletedAt: { not: null } },
  });
  return count > 0;
}

export async function listTrashedPages(userId: string) {
  return prisma.page.findMany({
    where: { userId, deletedAt: { not: null } },
    select: {
      id: true,
      title: true,
      deletedAt: true,
      technologyId: true,
      technology: { select: { name: true, slug: true, deletedAt: true } },
    },
    orderBy: { deletedAt: "desc" },
    take: 200,
  });
}

export async function listRecentlyUpdated(userId: string, limit = 8) {
  const rows = await prisma.page.findMany({
    where: { userId, ...NOT_DELETED },
    select: {
      id: true,
      title: true,
      slug: true,
      updatedAt: true,
      contentText: true,
      technology: { select: { name: true, slug: true, icon: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  return rows.map(({ contentText, ...row }) => ({
    ...row,
    excerpt: contentText.slice(0, 120),
  }));
}

export async function listFavoritePages(userId: string, limit = 50) {
  const rows = await prisma.page.findMany({
    where: { userId, isFavorite: true, ...NOT_DELETED },
    select: {
      id: true,
      title: true,
      slug: true,
      updatedAt: true,
      contentText: true,
      technology: { select: { name: true, slug: true, icon: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  return rows.map(({ contentText, ...row }) => ({
    ...row,
    excerpt: contentText.slice(0, 120),
  }));
}

/**
 * Records a page open for the "recently viewed" list. Upserted per (user,
 * page), so the table stays proportional to how many pages exist rather than
 * to how often they are read.
 */
export async function recordPageView(userId: string, pageId: string): Promise<void> {
  const owns = await prisma.page.findFirst({
    where: { id: pageId, userId, ...NOT_DELETED },
    select: { id: true },
  });
  if (!owns) return;

  await prisma.pageView.upsert({
    where: { userId_pageId: { userId, pageId } },
    create: { userId, pageId },
    update: { viewedAt: new Date() },
  });
}

export async function listRecentlyViewed(userId: string, limit = 8) {
  const rows = await prisma.pageView.findMany({
    where: { userId, page: NOT_DELETED },
    select: {
      viewedAt: true,
      page: {
        select: {
          id: true,
          title: true,
          slug: true,
          technology: { select: { name: true, slug: true, icon: true } },
        },
      },
    },
    orderBy: { viewedAt: "desc" },
    take: limit,
  });

  return rows.map((row) => ({ ...row.page, viewedAt: row.viewedAt }));
}

export async function setCoverImage(
  userId: string,
  id: string,
  coverImage: string | null,
): Promise<boolean> {
  const { count } = await prisma.page.updateMany({
    where: { id, userId, ...NOT_DELETED },
    data: { coverImage },
  });
  return count > 0;
}

/**
 * Bumps the parent technology's `updatedAt` so the dashboard's "last updated"
 * reflects activity inside it. Prisma's `@updatedAt` only fires on a write to
 * the row itself, and editing a page is not one.
 */
async function touchTechnology(technologyId: string): Promise<void> {
  await prisma.technology.update({
    where: { id: technologyId },
    data: { updatedAt: new Date() },
  });
}

export async function getPageStats(userId: string) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Promise.all, not $transaction. These are four independent counts with no
  // atomicity requirement, and wrapping them in a transaction makes Prisma
  // reserve a dedicated connection for the whole batch. Against Neon's pooler
  // that is enough to exhaust the pool while the rest of the dashboard is
  // querying in parallel, which surfaces as P2028 "unable to start a
  // transaction in the given time".
  //
  // Reserve $transaction for writes that must succeed or fail together.
  const [totalPages, totalTechnologies, updatedThisWeek, favorites] = await Promise.all(
    [
      prisma.page.count({ where: { userId, ...NOT_DELETED } }),
      prisma.technology.count({ where: { userId, ...NOT_DELETED } }),
      prisma.page.count({
        where: { userId, ...NOT_DELETED, updatedAt: { gte: weekAgo } },
      }),
      prisma.page.count({ where: { userId, isFavorite: true, ...NOT_DELETED } }),
    ],
  );

  return { totalPages, totalTechnologies, updatedThisWeek, favorites };
}

export { extractExcerpt };
