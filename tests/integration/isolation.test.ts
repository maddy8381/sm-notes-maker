import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTestPage,
  createTestTechnology,
  createTestUser,
  disconnect,
  hasTestDatabase,
  resetDatabase,
} from "../helpers/db";

import * as pages from "@/server/pages";
import * as tags from "@/server/tags";
import * as technologies from "@/server/technologies";
import { searchEverything, searchPages } from "@/server/search";

/**
 * The suite this app exists to pass.
 *
 * Every function in src/server/ takes `userId` as its first argument and is
 * expected to filter on it. These tests assert that from the outside: Mallory
 * holds a valid session and a correct id for one of Alice's rows, and gets
 * nothing back from every single operation.
 *
 * A regression here is not a bug, it is a data breach, so the coverage is
 * exhaustive rather than representative — every exported mutation and read
 * that accepts an id is exercised.
 */

const describeIfDb = hasTestDatabase ? describe : describe.skip;

if (!hasTestDatabase) {
  console.warn(
    "\n  ⚠ TEST_DATABASE_URL is not set — the isolation suite was SKIPPED.\n" +
      "    Point it at a scratch database (these tests truncate tables).\n",
  );
}

describeIfDb("user isolation", () => {
  let alice: { id: string };
  let mallory: { id: string };
  let aliceTech: { id: string; slug: string };
  let alicePage: { id: string; slug: string; revision: number };

  beforeAll(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnect();
  });

  // Deliberately no truncate per test. Every helper mints a unique email, so
  // each test gets its own pair of users, and every assertion here is scoped
  // to one of them — leftover rows from a previous test cannot affect the
  // result. Truncating each time meant 37 round trips to a remote database and
  // took two minutes for work that runs in seconds.
  beforeEach(async () => {
    alice = await createTestUser("Alice");
    mallory = await createTestUser("Mallory");

    aliceTech = await createTestTechnology(alice.id, "Alices Tech");
    alicePage = await createTestPage(alice.id, aliceTech.id, "Alices Page");
  });

  describe("reads", () => {
    it("does not list another user's technologies", async () => {
      expect(await technologies.listTechnologies(mallory.id)).toHaveLength(0);
      expect(await technologies.listTechnologies(alice.id)).toHaveLength(1);
    });

    it("does not resolve another user's technology by slug", async () => {
      expect(
        await technologies.getTechnologyBySlug(mallory.id, aliceTech.slug),
      ).toBeNull();
    });

    it("does not resolve another user's technology by id", async () => {
      expect(await technologies.getTechnologyById(mallory.id, aliceTech.id)).toBeNull();
    });

    it("does not list another user's pages", async () => {
      expect(await pages.listPagesForTechnology(mallory.id, aliceTech.id)).toHaveLength(
        0,
      );
    });

    it("does not resolve another user's page by slug", async () => {
      expect(
        await pages.getPageBySlug(mallory.id, aliceTech.id, alicePage.slug),
      ).toBeNull();
    });

    it("does not resolve another user's page by id", async () => {
      expect(await pages.getPageById(mallory.id, alicePage.id)).toBeNull();
    });

    it("reports zero stats for an account with no content", async () => {
      const stats = await pages.getPageStats(mallory.id);
      expect(stats).toMatchObject({ totalPages: 0, totalTechnologies: 0 });
    });

    it("does not surface another user's pages in favorites or recents", async () => {
      await pages.setPageFavorite(alice.id, alicePage.id, true);
      await pages.recordPageView(alice.id, alicePage.id);

      expect(await pages.listFavoritePages(mallory.id)).toHaveLength(0);
      expect(await pages.listRecentlyUpdated(mallory.id)).toHaveLength(0);
      expect(await pages.listRecentlyViewed(mallory.id)).toHaveLength(0);
    });

    it("does not surface another user's pages in trash", async () => {
      await pages.deletePage(alice.id, alicePage.id);

      expect(await pages.listTrashedPages(mallory.id)).toHaveLength(0);
      expect(await technologies.listTrashedTechnologies(mallory.id)).toHaveLength(0);
    });
  });

  describe("search", () => {
    it("does not match another user's content", async () => {
      // The word is present in Alice's page and nowhere else.
      expect(await searchPages(alice.id, "secret")).not.toHaveLength(0);
      expect(await searchPages(mallory.id, "secret")).toHaveLength(0);
    });

    it("does not match another user's titles", async () => {
      expect(await searchPages(mallory.id, "Alices Page")).toHaveLength(0);
    });

    it("returns nothing across the whole command palette", async () => {
      const results = await searchEverything(mallory.id, "Alices");

      expect(results.pages).toHaveLength(0);
      expect(results.technologies).toHaveLength(0);
      expect(results.tags).toHaveLength(0);
    });

    it("does not leak through a tag filter", async () => {
      await tags.setPageTags(alice.id, alicePage.id, ["confidential"]);

      expect(
        await searchPages(mallory.id, "secret", { tagSlugs: ["confidential"] }),
      ).toHaveLength(0);
      expect(await tags.listPagesByTag(mallory.id, "confidential")).toHaveLength(0);
    });

    it("does not leak through a technologyId filter", async () => {
      // Passing a correct id for someone else's technology must not widen the
      // scope — the userId predicate is the one that decides.
      expect(
        await searchPages(mallory.id, "secret", { technologyId: aliceTech.id }),
      ).toHaveLength(0);
    });
  });

  describe("mutations", () => {
    it("cannot rename another user's page", async () => {
      expect(await pages.renamePage(mallory.id, alicePage.id, "Pwned")).toBe(false);

      const after = await pages.getPageById(alice.id, alicePage.id);
      expect(after?.title).toBe("Alices Page");
    });

    it("cannot overwrite another user's page content", async () => {
      const result = await pages.savePageContent(mallory.id, {
        id: alicePage.id,
        title: "Pwned",
        content: { type: "doc", content: [] },
        expectedRevision: alicePage.revision,
      });

      expect(result.status).toBe("not_found");

      const after = await pages.getPageBySlug(alice.id, aliceTech.id, alicePage.slug);
      expect(after?.title).toBe("Alices Page");
    });

    it("cannot delete another user's page", async () => {
      expect(await pages.deletePage(mallory.id, alicePage.id)).toBe(false);
      expect(await pages.getPageById(alice.id, alicePage.id)).not.toBeNull();
    });

    it("cannot purge another user's trashed page", async () => {
      await pages.deletePage(alice.id, alicePage.id);

      expect(await pages.purgePage(mallory.id, alicePage.id)).toBe(false);
      expect(await pages.listTrashedPages(alice.id)).toHaveLength(1);
    });

    it("cannot restore another user's trashed page", async () => {
      await pages.deletePage(alice.id, alicePage.id);

      expect(await pages.restorePage(mallory.id, alicePage.id)).toBe(false);
      expect(await pages.getPageById(alice.id, alicePage.id)).toBeNull();
    });

    it("cannot favorite another user's page", async () => {
      expect(await pages.setPageFavorite(mallory.id, alicePage.id, true)).toBe(false);
      expect(await pages.listFavoritePages(alice.id)).toHaveLength(0);
    });

    it("cannot reorder another user's page", async () => {
      expect(await pages.movePage(mallory.id, alicePage.id, 9999)).toBe(false);
    });

    it("cannot duplicate another user's page", async () => {
      expect(await pages.duplicatePage(mallory.id, alicePage.id)).toBeNull();
      expect(await pages.listPagesForTechnology(alice.id, aliceTech.id)).toHaveLength(
        1,
      );
    });

    it("cannot set a cover image on another user's page", async () => {
      expect(
        await pages.setCoverImage(mallory.id, alicePage.id, "https://x.test/a.png"),
      ).toBe(false);
    });

    it("cannot tag another user's page", async () => {
      expect(await tags.setPageTags(mallory.id, alicePage.id, ["pwned"])).toBe(false);
    });

    it("cannot record a view on another user's page", async () => {
      // Silently ignored rather than throwing — but it must not create a row,
      // which would put someone else's page in Mallory's recents.
      await pages.recordPageView(mallory.id, alicePage.id);
      expect(await pages.listRecentlyViewed(mallory.id)).toHaveLength(0);
    });

    it("cannot rename another user's technology", async () => {
      expect(
        await technologies.updateTechnology(mallory.id, aliceTech.id, {
          name: "Pwned",
        }),
      ).toBe(false);
    });

    it("cannot delete another user's technology", async () => {
      expect(await technologies.deleteTechnology(mallory.id, aliceTech.id)).toBe(false);
      expect(await technologies.listTechnologies(alice.id)).toHaveLength(1);
    });

    it("cannot favorite another user's technology", async () => {
      expect(
        await technologies.setTechnologyFavorite(mallory.id, aliceTech.id, true),
      ).toBe(false);
    });

    it("cannot reorder another user's technology", async () => {
      expect(await technologies.moveTechnology(mallory.id, aliceTech.id, 9999)).toBe(
        false,
      );
    });

    it("cannot restore or purge another user's technology", async () => {
      await technologies.deleteTechnology(alice.id, aliceTech.id);

      expect(await technologies.restoreTechnology(mallory.id, aliceTech.id)).toBe(
        false,
      );
      expect(await technologies.purgeTechnology(mallory.id, aliceTech.id)).toBe(false);
      expect(await technologies.listTrashedTechnologies(alice.id)).toHaveLength(1);
    });

    it("cannot create a page inside another user's technology", async () => {
      // The most tempting hole: the technology id is valid, and only the
      // ownership check on it stands in the way.
      expect(
        await pages.createPage(mallory.id, {
          technologyId: aliceTech.id,
          title: "Planted",
        }),
      ).toBeNull();

      expect(await pages.listPagesForTechnology(alice.id, aliceTech.id)).toHaveLength(
        1,
      );
    });

    it("cannot move its own page into another user's technology", async () => {
      const malloryTech = await createTestTechnology(mallory.id, "Mallorys Tech");
      const malloryPage = await createTestPage(mallory.id, malloryTech.id, "Mine");

      expect(
        await pages.movePageToTechnology(mallory.id, malloryPage.id, aliceTech.id),
      ).toBeNull();

      expect(await pages.listPagesForTechnology(alice.id, aliceTech.id)).toHaveLength(
        1,
      );
    });

    it("cannot move another user's page into its own technology", async () => {
      const malloryTech = await createTestTechnology(mallory.id, "Mallorys Tech");

      expect(
        await pages.movePageToTechnology(mallory.id, alicePage.id, malloryTech.id),
      ).toBeNull();
    });

    it("cannot delete another user's tag", async () => {
      await tags.setPageTags(alice.id, alicePage.id, ["private"]);
      const aliceTag = await tags.getTagBySlug(alice.id, "private");

      expect(aliceTag).not.toBeNull();
      expect(await tags.deleteTag(mallory.id, aliceTag!.id)).toBe(false);
      expect(await tags.getTagBySlug(alice.id, "private")).not.toBeNull();
    });

    it("cannot rename another user's tag", async () => {
      await tags.setPageTags(alice.id, alicePage.id, ["private"]);
      const aliceTag = await tags.getTagBySlug(alice.id, "private");

      expect(await tags.renameTag(mallory.id, aliceTag!.id, "pwned")).toBe(false);
    });
  });

  describe("tags are per-user", () => {
    it("keeps identically named tags separate", async () => {
      await tags.setPageTags(alice.id, alicePage.id, ["debugging"]);

      const malloryTech = await createTestTechnology(mallory.id, "Mallorys Tech");
      const malloryPage = await createTestPage(mallory.id, malloryTech.id, "Mine");
      await tags.setPageTags(mallory.id, malloryPage.id, ["debugging"]);

      const aliceTags = await tags.listTags(alice.id);
      const malloryTags = await tags.listTags(mallory.id);

      expect(aliceTags).toHaveLength(1);
      expect(malloryTags).toHaveLength(1);
      // Same name, different rows — a shared tag table would leak the
      // existence of other people's vocabulary through autocomplete.
      expect(aliceTags[0]!.id).not.toBe(malloryTags[0]!.id);
      expect(aliceTags[0]!.pageCount).toBe(1);
      expect(malloryTags[0]!.pageCount).toBe(1);
    });
  });

  describe("cascade behaviour", () => {
    it("removes everything belonging to a deleted user", async () => {
      await tags.setPageTags(alice.id, alicePage.id, ["x"]);
      await pages.recordPageView(alice.id, alicePage.id);

      const { prisma } = await import("../helpers/db");
      await prisma.user.delete({ where: { id: alice.id } });

      expect(await prisma.technology.count({ where: { userId: alice.id } })).toBe(0);
      expect(await prisma.page.count({ where: { userId: alice.id } })).toBe(0);
      expect(await prisma.tag.count({ where: { userId: alice.id } })).toBe(0);
      expect(await prisma.pageView.count({ where: { userId: alice.id } })).toBe(0);

      // And Mallory is untouched.
      expect(await prisma.user.count({ where: { id: mallory.id } })).toBe(1);
    });
  });
});
