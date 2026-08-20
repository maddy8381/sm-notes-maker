import "server-only";

import { prisma } from "@/lib/prisma";
import { positionAfter, rebalance } from "@/lib/position";
import { slugify, uniqueSlug } from "@/lib/utils";

/**
 * Technology collections.
 *
 * Every exported function takes `userId` first and filters on it. That is not
 * defensive duplication of the caller's own check — it is the check. Nothing
 * above this layer is trusted to have done it.
 */

export type TechnologySummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  isFavorite: boolean;
  position: number;
  pageCount: number;
  updatedAt: Date;
  createdAt: Date;
};

export type TechnologySort = "manual" | "name" | "recent" | "pages";

const NOT_DELETED = { deletedAt: null } as const;

export async function listTechnologies(
  userId: string,
  options: { sort?: TechnologySort; query?: string } = {},
): Promise<TechnologySummary[]> {
  const { sort = "manual", query } = options;

  const rows = await prisma.technology.findMany({
    where: {
      userId,
      ...NOT_DELETED,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { description: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      icon: true,
      color: true,
      isFavorite: true,
      position: true,
      createdAt: true,
      updatedAt: true,
      // Counting only live pages: a technology whose pages are all in the
      // trash should read "0 pages", not advertise deleted ones.
      _count: { select: { pages: { where: NOT_DELETED } } },
    },
    orderBy: orderFor(sort),
  });

  const mapped = rows.map(({ _count, ...row }) => ({
    ...row,
    pageCount: _count.pages,
  }));

  // Page count is an aggregate, so it cannot be an ORDER BY on the query
  // above without a groupBy that costs more than sorting a short list here.
  if (sort === "pages") {
    mapped.sort((a, b) => b.pageCount - a.pageCount || a.name.localeCompare(b.name));
  }

  return mapped;
}

function orderFor(sort: TechnologySort) {
  switch (sort) {
    case "name":
      return [{ name: "asc" as const }];
    case "recent":
      return [{ updatedAt: "desc" as const }];
    case "pages":
      return [{ name: "asc" as const }];
    case "manual":
    default:
      // Favourites float to the top of the manual ordering — the whole point
      // of pinning is not having to scroll to them.
      return [
        { isFavorite: "desc" as const },
        { position: "asc" as const },
        { createdAt: "asc" as const },
      ];
  }
}

export async function getTechnologyBySlug(userId: string, slug: string) {
  return prisma.technology.findFirst({
    where: { userId, slug, ...NOT_DELETED },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      icon: true,
      color: true,
      isFavorite: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getTechnologyById(userId: string, id: string) {
  return prisma.technology.findFirst({
    where: { id, userId, ...NOT_DELETED },
    select: { id: true, name: true, slug: true },
  });
}

export async function createTechnology(
  userId: string,
  input: {
    name: string;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
  },
) {
  const [existingSlugs, last] = await Promise.all([
    prisma.technology.findMany({ where: { userId }, select: { slug: true } }),
    prisma.technology.findFirst({
      where: { userId, ...NOT_DELETED },
      orderBy: { position: "desc" },
      select: { position: true },
    }),
  ]);

  // Soft-deleted rows still hold their slug, so they are included above:
  // reusing the slug of something in the trash would break restoring it.
  const slug = uniqueSlug(
    slugify(input.name),
    existingSlugs.map((t) => t.slug),
  );

  return prisma.technology.create({
    data: {
      userId,
      name: input.name,
      slug,
      description: input.description ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      position: positionAfter(last?.position),
    },
    select: { id: true, name: true, slug: true },
  });
}

export async function updateTechnology(
  userId: string,
  id: string,
  data: {
    name?: string;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
  },
): Promise<boolean> {
  // updateMany rather than update: it takes a full `where`, so ownership is
  // part of the same statement instead of a separate read that could pass
  // while the row changes underneath.
  const { count } = await prisma.technology.updateMany({
    where: { id, userId, ...NOT_DELETED },
    data,
  });
  return count > 0;
}

export async function setTechnologyFavorite(
  userId: string,
  id: string,
  isFavorite: boolean,
): Promise<boolean> {
  const { count } = await prisma.technology.updateMany({
    where: { id, userId, ...NOT_DELETED },
    data: { isFavorite },
  });
  return count > 0;
}

/**
 * Soft delete. The pages underneath are marked too, so they stop appearing in
 * search and recents, and both come back together on restore.
 */
export async function deleteTechnology(userId: string, id: string): Promise<boolean> {
  const deletedAt = new Date();

  const [technology] = await prisma.$transaction([
    prisma.technology.updateMany({
      where: { id, userId, ...NOT_DELETED },
      data: { deletedAt },
    }),
    prisma.page.updateMany({
      where: { technologyId: id, userId, ...NOT_DELETED },
      data: { deletedAt },
    }),
  ]);

  return technology.count > 0;
}

export async function restoreTechnology(userId: string, id: string): Promise<boolean> {
  const technology = await prisma.technology.findFirst({
    where: { id, userId, deletedAt: { not: null } },
    select: { deletedAt: true },
  });
  if (!technology?.deletedAt) return false;

  await prisma.$transaction([
    prisma.technology.updateMany({
      where: { id, userId },
      data: { deletedAt: null },
    }),
    // Only pages deleted as part of this cascade come back. A page the user
    // had already trashed on its own stays trashed.
    prisma.page.updateMany({
      where: { technologyId: id, userId, deletedAt: technology.deletedAt },
      data: { deletedAt: null },
    }),
  ]);

  return true;
}

export async function purgeTechnology(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.technology.deleteMany({
    where: { id, userId, deletedAt: { not: null } },
  });
  return count > 0;
}

export async function moveTechnology(
  userId: string,
  id: string,
  newPosition: number,
): Promise<boolean> {
  const { count } = await prisma.technology.updateMany({
    where: { id, userId, ...NOT_DELETED },
    data: { position: newPosition },
  });
  return count > 0;
}

/** Renumbers the whole list when fractional gaps get too small to split. */
export async function rebalanceTechnologies(userId: string): Promise<void> {
  const rows = await prisma.technology.findMany({
    where: { userId, ...NOT_DELETED },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  await prisma.$transaction(
    rebalance(rows).map(({ item, position }) =>
      prisma.technology.update({ where: { id: item.id }, data: { position } }),
    ),
  );
}

export async function countTechnologies(userId: string): Promise<number> {
  return prisma.technology.count({ where: { userId, ...NOT_DELETED } });
}

export async function listTrashedTechnologies(userId: string) {
  return prisma.technology.findMany({
    where: { userId, deletedAt: { not: null } },
    select: { id: true, name: true, slug: true, deletedAt: true },
    orderBy: { deletedAt: "desc" },
  });
}
