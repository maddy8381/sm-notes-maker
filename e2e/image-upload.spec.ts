import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import {
  clearRateLimits,
  disconnect,
  signUp,
  uniqueEmail,
  waitForSaved,
} from "./helpers";

/**
 * The whole image path, end to end.
 *
 * This exists because every part of it has already failed silently once: a CSP
 * that blocked the upload, a store whose access mode rejected it, and a
 * document that kept an image node pointing at a local object URL. In all three
 * the editor looked fine until the page was reloaded, which is precisely what
 * an automated check catches and a manual glance does not.
 *
 * Requires a Blob store — skipped without a token rather than failing, since
 * there is nothing to upload to.
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHUlEQVR42mNkYPhfz0AEYBxVSF+Fo3bTx2EMDAwAcCsPwQTsWJsAAAAASUVORK5CYII=",
  "base64",
);

test.skip(!process.env.BLOB_READ_WRITE_TOKEN, "needs a Blob store");

test.beforeEach(async () => {
  await clearRateLimits();
});

test.afterAll(async () => {
  await disconnect();
});

test("uploads an image, keeps it across a reload, and embeds it in the PDF", async ({
  page,
}) => {
  // Every response the image route gives during this flow. The *first* one
  // matters: the browser does not retry a failed <img>, so a single 404 here
  // is an image broken until the page is reloaded.
  const imageResponses: number[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/images/")) {
      imageResponses.push(response.status());
    }
  });

  // Holds back the row that authorizes reads, which turns a race into a
  // certainty: if the editor publishes the src before this lands, the <img>
  // asks for a blob the server cannot yet see and gets a 404 it will never
  // retry. Without the delay the bug reproduces only sometimes, and a test
  // that catches a bug only sometimes is not a test of it.
  await page.route("**/api/upload/record", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.continue();
  });

  await signUp(page, uniqueEmail("image"));

  await page
    .getByRole("link", { name: /welcome to your notes/i })
    .first()
    .click();
  await expect(page.getByLabel("Page title")).toHaveValue(/welcome/i, {
    timeout: 30_000,
  });

  // The exact shape of a macOS screenshot name, deliberately: spaces and
  // parentheses land in the blob pathname and therefore in the URL the route
  // parses back, and the space before "PM" is U+202F — a narrow no-break space
  // that reads as ASCII, uploads happily, and used to 500 every request for the
  // image the moment it reached a Content-Disposition header.
  await page.setInputFiles('input[type="file"]', {
    name: "Screenshot 2026-07-13 at 2.18.51\u202fPM (2).png",
    mimeType: "image/png",
    buffer: PNG,
  });

  // The optimistic `blob:` src is swapped for the app path once the upload
  // lands. Anything else here means the upload failed.
  const image = page.locator('.tn-prose img[src^="/api/images/"]');
  await expect(image).toHaveCount(1, { timeout: 60_000 });

  // Present in the DOM is not the same as served: the route has to authorize
  // the session and stream the bytes back.
  await expect
    .poll(async () => image.evaluate((node: HTMLImageElement) => node.naturalWidth), {
      timeout: 30_000,
      message: "the image route never served the bytes",
    })
    .toBeGreaterThan(0);

  const src = await image.getAttribute("src");

  // The attachment row has to be written before the src is handed to the
  // browser, or this races and 404s.
  expect(imageResponses).not.toContain(404);
  expect(imageResponses[0]).toBe(200);

  await waitForSaved(page);
  await page.reload();

  // The src survived validation on the write path — the failure this whole
  // migration started from.
  await expect(page.locator(`.tn-prose img[src="${src}"]`)).toHaveCount(1, {
    timeout: 30_000,
  });

  // And the export reads the same private blob server-side.
  await page.getByRole("button", { name: "Page options" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: /download this page as pdf/i }).click(),
  ]);

  const pdf = await readFile(await download.path());
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  // The embedded image object, rather than the "[image]" placeholder text the
  // renderer falls back to when it cannot read the bytes.
  expect(pdf.toString("latin1")).toContain("/Image");
});

test("does not serve one account's image to another", async ({ page, browser }) => {
  await signUp(page, uniqueEmail("image-owner"));

  await page
    .getByRole("link", { name: /welcome to your notes/i })
    .first()
    .click();
  await expect(page.getByLabel("Page title")).toHaveValue(/welcome/i, {
    timeout: 30_000,
  });

  await page.setInputFiles('input[type="file"]', {
    name: "private.png",
    mimeType: "image/png",
    buffer: PNG,
  });

  const image = page.locator('.tn-prose img[src^="/api/images/"]');
  await expect(image).toHaveCount(1, { timeout: 60_000 });
  const src = await image.getAttribute("src");

  // A second account, with a valid session of its own and the exact path.
  const context = await browser.newContext();
  const other = await context.newPage();
  await clearRateLimits();
  await signUp(other, uniqueEmail("image-stranger"));

  const response = await other.request.get(src!);
  expect(response.status()).toBe(404);

  // And signed out entirely.
  const anonymous = await browser.newContext();
  const anonymousResponse = await anonymous.request.get(src!);
  expect(anonymousResponse.status()).toBe(401);

  await context.close();
  await anonymous.close();
});
