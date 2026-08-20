import { expect, test } from "@playwright/test";

import {
  PASSWORD,
  clearRateLimits,
  createPage,
  createTechnology,
  disconnect,
  formError,
  signIn,
  signOut,
  signUp,
  uniqueEmail,
  waitForSaved,
} from "./helpers";

/**
 * The flows that must never break.
 *
 * Each spec drives a real browser against a production build: sign up, write
 * something, confirm it survives a reload, find it again, and remove it. If
 * these pass, the app does the thing it exists to do.
 */

test.beforeEach(async () => {
  await clearRateLimits();
});

test.afterAll(async () => {
  await disconnect();
});

test.describe("critical flows", () => {
  test("signs up, writes a note, and finds it again", async ({ page }) => {
    await signUp(page, uniqueEmail("flow"), "Ada Lovelace");
    await expect(page.getByRole("heading", { name: /Ada/ })).toBeVisible();

    // A new account gets starter content rather than an empty screen.
    await expect(
      page.getByRole("heading", { name: "Getting Started", exact: true }),
    ).toBeVisible();

    await createTechnology(page, "PostgreSQL");
    await expect(
      page.getByRole("heading", { name: "PostgreSQL", exact: true }),
    ).toBeVisible();

    await createPage(page, "Index types");

    const editor = page.locator(".ProseMirror");
    await editor.click();
    await editor.pressSequentially("A GIN index suits containment queries.", {
      delay: 10,
    });

    await waitForSaved(page);

    // The content survives a reload — i.e. it genuinely reached the database.
    await page.reload();
    await expect(page.locator(".ProseMirror")).toContainText(
      "A GIN index suits containment queries.",
      { timeout: 30_000 },
    );

    // …and is findable by a word from the body, not just the title.
    await page.goto("/search?q=containment");
    await expect(page.getByRole("heading", { name: "Index types" })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("keeps bold formatting across a reload", async ({ page }) => {
    await signUp(page, uniqueEmail("bold"));
    await createTechnology(page, "TypeScript");
    await createPage(page, "Generics");

    const editor = page.locator(".ProseMirror");
    await editor.click();
    await editor.pressSequentially("bold words", { delay: 10 });

    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.getByRole("button", { name: /^Bold/ }).click();
    await expect(editor.locator("strong")).toHaveText("bold words");

    await waitForSaved(page);
    await page.reload();

    await expect(page.locator(".ProseMirror strong")).toHaveText("bold words", {
      timeout: 30_000,
    });
  });

  test("keeps a code block's language across a reload", async ({ page }) => {
    await signUp(page, uniqueEmail("code"));
    await createTechnology(page, "Rust");
    await createPage(page, "Ownership");

    const editor = page.locator(".ProseMirror");
    await editor.click();
    await page.getByRole("button", { name: "Code block" }).click();
    await page.keyboard.type("fn main() {}");

    await page.getByLabel("Code language").selectOption("rust");
    await waitForSaved(page);

    await page.reload();

    // Asserted on the rendered class rather than the picker: the picker is
    // chrome that only appears on hover, whereas the class is the language
    // actually applied to the block. This is the regression that silently
    // flattened every note's formatting during development — Server Action
    // deserialization was dropping node attributes.
    await expect(page.locator(".ProseMirror code.language-rust")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator(".ProseMirror")).toContainText("fn main() {}");
  });

  test("deletes a page to trash and restores it", async ({ page }) => {
    await signUp(page, uniqueEmail("trash"));
    await createTechnology(page, "Redis");
    await createPage(page, "Eviction policies");

    await page.getByRole("button", { name: "Page options" }).click();
    await page.getByRole("menuitem", { name: /move to trash/i }).click();
    await page.getByRole("button", { name: /move to trash/i }).click();

    await page.waitForURL("**/t/redis", { timeout: 30_000 });
    await expect(page.getByRole("link", { name: /Eviction policies/ })).toHaveCount(0);

    // Deleting is recoverable — that is the whole point of the trash.
    await page.goto("/trash");
    await expect(page.getByText("Eviction policies").first()).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Restore" }).first().click();

    // Wait for the restore to actually land. Navigating on the click alone
    // races the Server Action and the refresh that follows it, which is why
    // this looked like the restore silently failing.
    await expect(page.getByText("Trash is empty")).toBeVisible({ timeout: 30_000 });

    await page.goto("/t/redis");
    await expect(
      page.getByRole("link", { name: /Eviction policies/ }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("signs out and blocks access afterwards", async ({ page }) => {
    await signUp(page, uniqueEmail("signout"));
    await signOut(page);

    // The session row is deleted, not merely forgotten by the client.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("signs back in with the same credentials", async ({ page }) => {
    const email = uniqueEmail("signin");

    await signUp(page, email);
    await signOut(page);
    await signIn(page, email);

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("rejects a wrong password without saying which field was wrong", async ({
    page,
  }) => {
    const email = uniqueEmail("wrongpw");

    await signUp(page, email);
    await signOut(page);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("definitely-not-it");
    await page.getByRole("button", { name: /^sign in/i }).click();

    const error = formError(page);
    await expect(error).toBeVisible({ timeout: 20_000 });
    // One message for both causes — naming which was wrong would confirm
    // whether the address is registered.
    await expect(error).toContainText(/incorrect email or password/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test("keeps one account's notes invisible to another", async ({ browser }) => {
    const aliceContext = await browser.newContext();
    const alice = await aliceContext.newPage();

    await signUp(alice, uniqueEmail("alice"), "Alice");
    await createTechnology(alice, "Alices Secret Stack");
    await createPage(alice, "Alices Private Note");

    const noteUrl = alice.url();
    await alice.locator(".ProseMirror").click();
    await alice
      .locator(".ProseMirror")
      .pressSequentially("classified material", { delay: 10 });
    await waitForSaved(alice);

    // A second account, holding the exact URL of the first one's note.
    await clearRateLimits();
    const malloryContext = await browser.newContext();
    const mallory = await malloryContext.newPage();
    await signUp(mallory, uniqueEmail("mallory"), "Mallory");

    await mallory.goto(noteUrl);
    await expect(mallory.getByRole("heading", { name: "Not found" })).toBeVisible({
      timeout: 30_000,
    });

    await mallory.goto("/search?q=classified");
    await expect(mallory.getByText("Alices Private Note")).toHaveCount(0);
    await expect(mallory.getByText(/no matches/i)).toBeVisible();

    await aliceContext.close();
    await malloryContext.close();
  });

  test("enforces the sign-up rate limit", async ({ page }) => {
    // The counters were cleared in beforeEach, so this measures the real
    // budget: five per hour per address.
    for (let i = 0; i < 5; i++) {
      await signUp(page, uniqueEmail(`burst-${i}`));
      await signOut(page);
    }

    await page.goto("/signup");
    await page.getByLabel("Name").fill("One Too Many");
    await page.getByLabel("Email").fill(uniqueEmail("blocked"));
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();

    const error = formError(page);
    await expect(error).toBeVisible({ timeout: 20_000 });
    await expect(error).toContainText(/too many sign-up attempts/i);
  });
});
