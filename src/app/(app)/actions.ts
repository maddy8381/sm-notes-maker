"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, ok } from "@/lib/action-result";
import { authedAction } from "@/lib/safe-action";
import { computeMovePosition, needsRebalance } from "@/lib/position";
import {
  createPageSchema,
  createTechnologySchema,
  favoriteSchema,
  idSchema,
  movePageSchema,
  pageTitleSchema,
  reorderSchema,
  savePageSchema,
  setTagsSchema,
  updateTechnologySchema,
} from "@/lib/validation/content";
import * as pages from "@/server/pages";
import * as tags from "@/server/tags";
import * as technologies from "@/server/technologies";
import { templateContent } from "@/lib/editor/templates";

/**
 * Every mutation in the app.
 *
 * All of them go through `authedAction`, which resolves the session and parses
 * input before the body runs, then pass `user.id` into a src/server/ function
 * that filters on it. Neither layer trusts the other to have done the check.
 */

// ---------------------------------------------------------------------------
// Technologies
// ---------------------------------------------------------------------------

export const createTechnology = authedAction(
  createTechnologySchema,
  async ({ user, input }) => {
    const technology = await technologies.createTechnology(user.id, input);
    revalidatePath("/", "layout");
    return ok(technology);
  },
);

export const updateTechnology = authedAction(
  updateTechnologySchema,
  async ({ user, input }) => {
    const { id, ...data } = input;
    const updated = await technologies.updateTechnology(user.id, id, data);
    if (!updated) return notFound("technology");

    revalidatePath("/", "layout");
    return ok();
  },
);

export const setTechnologyFavorite = authedAction(
  favoriteSchema,
  async ({ user, input }) => {
    const updated = await technologies.setTechnologyFavorite(
      user.id,
      input.id,
      input.isFavorite,
    );
    if (!updated) return notFound("technology");

    revalidatePath("/", "layout");
    return ok();
  },
);

export const deleteTechnology = authedAction(
  z.object({ id: idSchema }),
  async ({ user, input }) => {
    const deleted = await technologies.deleteTechnology(user.id, input.id);
    if (!deleted) return notFound("technology");

    revalidatePath("/", "layout");
    return ok();
  },
);

export const restoreTechnology = authedAction(
  z.object({ id: idSchema }),
  async ({ user, input }) => {
    const restored = await technologies.restoreTechnology(user.id, input.id);
    if (!restored) return notFound("technology");

    revalidatePath("/", "layout");
    return ok();
  },
);

export const purgeTechnology = authedAction(
  z.object({ id: idSchema }),
  async ({ user, input }) => {
    const purged = await technologies.purgeTechnology(user.id, input.id);
    if (!purged) return notFound("technology");

    revalidatePath("/trash");
    return ok();
  },
);

export const reorderTechnology = authedAction(
  reorderSchema,
  async ({ user, input }) => {
    const list = await technologies.listTechnologies(user.id, { sort: "manual" });
    const fromIndex = list.findIndex((t) => t.id === input.id);
    if (fromIndex === -1) return notFound("technology");

    const positions = list.map((t) => t.position);
    const position = computeMovePosition(positions, fromIndex, input.toIndex);

    await technologies.moveTechnology(user.id, input.id, position);

    // Fractional positions eventually run out of room between neighbours.
    // Renumbering right after the move keeps the next drag cheap, and happens
    // rarely enough not to matter.
    const without = positions.filter((_, i) => i !== fromIndex);
    const clamped = Math.max(0, Math.min(input.toIndex, without.length));
    if (needsRebalance(without[clamped - 1], without[clamped])) {
      await technologies.rebalanceTechnologies(user.id);
    }

    revalidatePath("/", "layout");
    return ok();
  },
);

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export const createPage = authedAction(createPageSchema, async ({ user, input }) => {
  const page = await pages.createPage(user.id, {
    technologyId: input.technologyId,
    title: input.title,
    content: templateContent(input.template),
  });

  // Null means the technology does not exist *for this user*. Reported as not
  // found rather than forbidden so the response cannot be used to probe which
  // ids exist on other accounts.
  if (!page) return notFound("technology");

  revalidatePath("/", "layout");
  return ok(page);
});

export const renamePage = authedAction(
  z.object({ id: idSchema, title: pageTitleSchema }),
  async ({ user, input }) => {
    const renamed = await pages.renamePage(user.id, input.id, input.title);
    if (!renamed) return notFound("page");

    revalidatePath("/", "layout");
    return ok();
  },
);

/**
 * The autosave endpoint. Called on a debounce while typing, so it is the
 * hottest mutation in the app — no revalidatePath here, because busting the
 * router cache on every keystroke would refetch the whole layout.
 */
export const savePage = authedAction(savePageSchema, async ({ user, input }) => {
  const result = await pages.savePageContent(user.id, input);

  switch (result.status) {
    case "saved":
      return ok({ revision: result.revision, updatedAt: result.updatedAt });

    case "not_found":
      return notFound("page");

    case "stale":
      return fail(
        "This page was edited somewhere else. Reload to get the latest version.",
        { code: "stale_revision" },
      );
  }
});

export const setPageFavorite = authedAction(favoriteSchema, async ({ user, input }) => {
  const updated = await pages.setPageFavorite(user.id, input.id, input.isFavorite);
  if (!updated) return notFound("page");

  revalidatePath("/", "layout");
  return ok();
});

export const duplicatePage = authedAction(
  z.object({ id: idSchema }),
  async ({ user, input }) => {
    const copy = await pages.duplicatePage(user.id, input.id);
    if (!copy) return notFound("page");

    revalidatePath("/", "layout");
    return ok(copy);
  },
);

export const movePage = authedAction(movePageSchema, async ({ user, input }) => {
  const moved = await pages.movePageToTechnology(user.id, input.id, input.technologyId);
  if (!moved) return notFound("page");

  revalidatePath("/", "layout");
  return ok(moved);
});

export const deletePage = authedAction(
  z.object({ id: idSchema }),
  async ({ user, input }) => {
    const deleted = await pages.deletePage(user.id, input.id);
    if (!deleted) return notFound("page");

    revalidatePath("/", "layout");
    return ok();
  },
);

export const restorePage = authedAction(
  z.object({ id: idSchema }),
  async ({ user, input }) => {
    const restored = await pages.restorePage(user.id, input.id);
    if (!restored) {
      return fail(
        "That page cannot be restored — the technology it belonged to is also in the trash.",
        { code: "conflict" },
      );
    }

    revalidatePath("/", "layout");
    return ok();
  },
);

export const purgePage = authedAction(
  z.object({ id: idSchema }),
  async ({ user, input }) => {
    const purged = await pages.purgePage(user.id, input.id);
    if (!purged) return notFound("page");

    revalidatePath("/trash");
    return ok();
  },
);

export const reorderPage = authedAction(
  z.object({ ...reorderSchema.shape, technologyId: idSchema }),
  async ({ user, input }) => {
    const technology = await technologies.getTechnologyById(
      user.id,
      input.technologyId,
    );
    if (!technology) return notFound("technology");

    const list = await pages.listPagesForTechnology(user.id, input.technologyId);
    const fromIndex = list.findIndex((p) => p.id === input.id);
    if (fromIndex === -1) return notFound("page");

    const positions = list.map((p) => p.position);
    const position = computeMovePosition(positions, fromIndex, input.toIndex);

    await pages.movePage(user.id, input.id, position);

    const without = positions.filter((_, i) => i !== fromIndex);
    const clamped = Math.max(0, Math.min(input.toIndex, without.length));
    if (needsRebalance(without[clamped - 1], without[clamped])) {
      await pages.rebalancePages(user.id, input.technologyId);
    }

    revalidatePath("/", "layout");
    return ok();
  },
);

export const recordPageView = authedAction(
  z.object({ id: idSchema }),
  async ({ user, input }) => {
    await pages.recordPageView(user.id, input.id);
    // No revalidate: this fires on every page open and only affects the
    // "recently viewed" list, which is allowed to be a moment stale.
    return ok();
  },
);

export const setPageCover = authedAction(
  z.object({ id: idSchema, coverImage: z.string().url().nullable() }),
  async ({ user, input }) => {
    const updated = await pages.setCoverImage(user.id, input.id, input.coverImage);
    if (!updated) return notFound("page");

    revalidatePath("/", "layout");
    return ok();
  },
);

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export const setPageTags = authedAction(setTagsSchema, async ({ user, input }) => {
  const updated = await tags.setPageTags(user.id, input.pageId, input.tags);
  if (!updated) return notFound("page");

  revalidatePath("/", "layout");
  return ok();
});

export const deleteTag = authedAction(
  z.object({ id: idSchema }),
  async ({ user, input }) => {
    const deleted = await tags.deleteTag(user.id, input.id);
    if (!deleted) return notFound("tag");

    revalidatePath("/tags");
    return ok();
  },
);

export const renameTag = authedAction(
  z.object({ id: idSchema, name: z.string().trim().min(1).max(40) }),
  async ({ user, input }) => {
    const renamed = await tags.renameTag(user.id, input.id, input.name);
    if (!renamed) return notFound("tag");

    revalidatePath("/tags");
    return ok();
  },
);

/**
 * One message for "does not exist" and "belongs to someone else".
 *
 * Distinguishing them would confirm that a given id is real, which is a
 * membership oracle over other people's data. The user's own missing rows are
 * rare enough that the vaguer message costs nothing.
 */
function notFound(what: string) {
  return fail(`That ${what} no longer exists.`, { code: "not_found" });
}
