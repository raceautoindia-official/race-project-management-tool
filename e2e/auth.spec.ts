import { expect, test, type Page } from "@playwright/test";
import { signIn, withDb } from "./helpers";
import { E2E_PIN, USERS } from "./users";

// The login error (Next also renders an empty route-announcer alert).
const loginError = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

test.describe("login (Employee ID + PIN from the attendance DB)", () => {
  test("pages require a session", async ({ page }) => {
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/login\?next=%2Fprojects$/);
  });

  test("a wrong PIN is rejected without revealing which field was wrong", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Employee ID").fill(USERS.alice.empId);
    await page.getByLabel("PIN").fill("0000");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(loginError(page)).toHaveText("Invalid Employee ID or PIN");

    await page.getByLabel("Employee ID").fill("NOBODY");
    await page.getByLabel("PIN").fill(E2E_PIN);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(loginError(page)).toHaveText("Invalid Employee ID or PIN");
  });

  test("a deactivated employee cannot sign in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Employee ID").fill(USERS.gone.empId);
    await page.getByLabel("PIN").fill(E2E_PIN);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(loginError(page)).toHaveText("This account has been deactivated");
  });

  test("deactivating an employee in Attendance ends their open session", async ({ browser }) => {
    const page = await signIn(browser, USERS.leaver);
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/projects$/);

    await withDb(async (db) => {
      await db.query("UPDATE attendance.employees SET is_active = 0 WHERE emp_id = ?", [USERS.leaver.empId]);
      // Skip the once-a-minute wait: pretend the last check was a while ago.
      await db.query(
        "UPDATE pm_app.users SET last_seen_at = UTC_TIMESTAMP() - INTERVAL 5 MINUTE WHERE emp_id = ?",
        [USERS.leaver.empId]
      );
    });

    // No redirect loop: the stale cookie is cleared and the login page shows.
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);
    await page.context().close();
  });

  test("a valid login lands on the dashboard and can log out", async ({ browser }) => {
    const page = await signIn(browser, USERS.sam);
    await expect(page.getByText(USERS.sam.name).first()).toBeVisible();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await page.context().close();
  });
});
