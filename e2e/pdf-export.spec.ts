import { readFile } from "node:fs/promises";

import { expect, test, type Download } from "@playwright/test";

import { clearRateLimits, disconnect, signUp, uniqueEmail } from "./helpers";

/**
 * The two ways a note leaves this app as a document.
 *
 * Both have a failure mode that only a real browser reveals: a PDF that never
 * downloads because the route errored, and a printed page carrying the sidebar
 * and the formatting toolbar. Neither shows up in a unit test — the renderer
 * is happy in isolation, and print styles have no runtime to assert against.
 */

test.beforeEach(async () => {
  await clearRateLimits();
});

test.afterAll(async () => {
  await disconnect();
});

/** Reads the download and returns its first bytes, which identify the format. */
async function magic(download: Download): Promise<string> {
  const path = await download.path();
  const bytes = await readFile(path);
  return bytes.subarray(0, 5).toString("latin1");
}

test.describe("PDF export", () => {
  test("downloads one page and the whole collection, and prints only the note", async ({
    page,
  }) => {
    await signUp(page, uniqueEmail("pdf"));

    // The starter content seeded at sign-up.
    await page
      .getByRole("link", { name: /welcome to your notes/i })
      .first()
      .click();
    await expect(page.getByLabel("Page title")).toHaveValue(/welcome/i, {
      timeout: 30_000,
    });

    // -- one page ----------------------------------------------------------
    await page.getByRole("button", { name: "Page options" }).click();

    const [pageDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: /download this page as pdf/i }).click(),
    ]);

    expect(pageDownload.suggestedFilename()).toMatch(/\.pdf$/);
    expect(await magic(pageDownload)).toBe("%PDF-");

    // -- the whole collection, from inside a note --------------------------
    await page.getByRole("button", { name: "Page options" }).click();

    const [collectionDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: /download all .* pages/i }).click(),
    ]);

    expect(collectionDownload.suggestedFilename()).toMatch(/-notes\.pdf$/);
    expect(await magic(collectionDownload)).toBe("%PDF-");

    // -- print view --------------------------------------------------------
    await page.emulateMedia({ media: "print" });

    // App chrome, in the order someone would notice it on paper.
    await expect(page.getByRole("button", { name: "Account menu" })).toBeHidden();
    await expect(page.getByRole("button", { name: /^Bold/ })).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Page options" })).toBeHidden();

    // The note itself stays.
    await expect(page.getByLabel("Page title")).toBeVisible();
    await expect(page.getByText("Organising things")).toBeVisible();
  });

  test("exports a technology from its own screen", async ({ page }) => {
    await signUp(page, uniqueEmail("pdf-tech"));

    await page
      .getByRole("link", { name: /getting started/i })
      .first()
      .click();
    await page.waitForURL("**/t/**", { timeout: 30_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /download pdf/i }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/-notes\.pdf$/);
    expect(await magic(download)).toBe("%PDF-");
  });
});
