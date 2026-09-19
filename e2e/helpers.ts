import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import mysql from "mysql2/promise";
import { E2E_PIN, type E2EUser } from "./users";

/** Run SQL against the throwaway e2e MySQL (both pm_app and attendance). */
export async function withDb<T>(fn: (db: mysql.Connection) => Promise<T>): Promise<T> {
  const db = await mysql.createConnection({
    host: "127.0.0.1",
    port: Number(process.env.E2E_DB_PORT),
    user: "root",
    password: "",
  });
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/** A fresh browser session signed in through the real login form. */
export async function signIn(browser: Browser, user: E2EUser): Promise<Page> {
  const { baseURL, viewport } = test.info().project.use;
  const context = await browser.newContext({ baseURL, viewport, acceptDownloads: true });
  const page = await context.newPage();
  // Confirm prompts (withdraw, complete project, …) are accepted.
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/login");
  await page.getByLabel("Employee ID").fill(user.empId);
  await page.getByLabel("PIN").fill(E2E_PIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return page;
}

/** The board/list card for a task. */
export function taskCard(page: Page, title: string): Locator {
  return page.locator("[draggable]", { hasText: title }).first();
}

/** Open a task's detail dialog from the board. */
export async function openTask(page: Page, title: string): Promise<Locator> {
  await taskCard(page, title).click();
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog.getByRole("heading", { name: "Approval trail" })).toBeVisible();
  return dialog;
}

export async function closeDialog(dialog: Locator) {
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
}

/** A row in the Task requests panel. */
export function requestRow(page: Page, title: string): Locator {
  return page.locator("section li", { hasText: title });
}
