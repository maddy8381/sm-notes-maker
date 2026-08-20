import { expect, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

export const PASSWORD = "a-sufficiently-long-passphrase";

const url = process.env.TEST_DATABASE_URL;

const prisma = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;

/**
 * Clears the rate-limit counters.
 *
 * Every test signs up a fresh account from the same address, and the signup
 * budget is deliberately five per hour per IP. That protection is working as
 * intended — it is simply incompatible with a suite that creates accounts in a
 * loop, so the counters are reset between tests rather than the limit being
 * loosened. `tests/integration/auth.test.ts` covers the limiter itself.
 */
export async function clearRateLimits(): Promise<void> {
  if (!prisma) return;
  await prisma.rateLimit.deleteMany({});
}

export async function disconnect(): Promise<void> {
  await prisma?.$disconnect();
}

/**
 * The app's own error banner.
 *
 * A bare `getByRole("alert")` also matches Next's route announcer, which is an
 * empty live region present on every page — so it resolves to two elements and
 * strict mode rejects it.
 */
export function formError(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)').first();
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.local`;
}

export async function signUp(page: Page, email: string, name = "E2E User") {
  await page.goto("/signup");

  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();

  // Surface the server's own message rather than letting the wait time out.
  // A silent 30-second timeout says nothing; "Too many sign-up attempts" says
  // exactly what happened.
  await expect
    .poll(
      async () => {
        if (page.url().includes("/dashboard")) return "signed-in";
        const alert = formError(page);
        return (await alert.count()) > 0 ? await alert.innerText() : "waiting";
      },
      { timeout: 30_000, message: "sign-up neither completed nor reported an error" },
    )
    .toBe("signed-in");
}

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /^sign in/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

export async function createTechnology(page: Page, name: string) {
  await page.getByRole("button", { name: "New technology" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();

  await page.waitForURL("**/t/**", { timeout: 30_000 });
}

export async function createPage(page: Page, title: string) {
  await page.getByRole("button", { name: /new page|create the first page/i }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByLabel("Page title")).toHaveValue(title, { timeout: 30_000 });
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /sign out/i }).click();
  await page.waitForURL("**/login", { timeout: 30_000 });
}

/**
 * Waits for a save the server has actually acknowledged.
 *
 * Deliberately keyed off data-status rather than the visible words: Playwright's
 * getByText is a case-insensitive substring match, so `getByText("Saved")`
 * also matches "Unsaved" and passes the instant the editor goes dirty.
 */
export async function waitForSaved(page: Page) {
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "data-status",
    "saved",
    { timeout: 30_000 },
  );
}
