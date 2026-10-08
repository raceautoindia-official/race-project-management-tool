import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { USERS } from "./users";

// The admin credentials vault: website logins the team shares.

let admin: Page;
let member: Page;

const NAME = "Dealer portal (e2e)";
const PASSWORD = "correct-horse-battery-staple";

test.beforeAll(async ({ browser }) => {
  admin = await signIn(browser, USERS.admin);
  member = await signIn(browser, USERS.sam);
});

test("a member cannot reach it at all", async () => {
  await member.goto("/admin/credentials");
  // Not a hidden link: the page itself turns them away.
  await expect(member).not.toHaveURL(/\/admin\/credentials$/);
});

test("an admin saves a login and reads it back", async () => {
  await admin.goto("/admin/credentials");
  await admin.getByRole("button", { name: "+ Add login" }).click();

  const form = admin.getByRole("dialog", { name: "Add a login" });
  await form.getByLabel(/^Name/).fill(NAME);
  await form.getByLabel(/^Website/).fill("https://portal.example.com/login");
  await form.getByLabel(/^Username/).fill("race-admin");
  await form.getByLabel(/^Password/).fill(PASSWORD);
  await form.getByLabel(/^Notes/).fill("Security question: first car");
  await form.getByRole("button", { name: "Add login" }).click();
  await expect(form).toBeHidden();

  // Saved, but not on show: a list is seen far more often than it is needed.
  await expect(admin.getByText(NAME)).toBeVisible();
  await expect(admin.getByText(PASSWORD)).toHaveCount(0);
  await expect(admin.getByText("Never read")).toBeVisible();

  await admin.getByRole("button", { name: "Show password" }).click();
  await expect(admin.getByText(PASSWORD)).toBeVisible();
  await expect(admin.getByText("Security question: first car")).toBeVisible();

  await admin.getByRole("button", { name: "Hide" }).click();
  await expect(admin.getByText(PASSWORD)).toHaveCount(0);
});

test("reading it is recorded against the person who read it", async () => {
  await admin.goto("/admin/credentials");
  // Read more than once by the time this runs; one entry per read.
  await expect(admin.getByText(`${USERS.admin.name} read ${NAME}`).first()).toBeVisible();
  await expect(admin.getByText(/Read 1 time/)).toBeVisible();
});

test("an edit with a blank password keeps the saved one", async () => {
  await admin.goto("/admin/credentials");
  await admin.getByRole("button", { name: "Edit" }).click();
  const form = admin.getByRole("dialog", { name: "Edit login" });
  // The form cannot show the stored password, so it cannot send it back.
  await expect(form.getByLabel(/^Password/)).toHaveValue("");
  await form.getByLabel(/^Username/).fill("race-admin-2");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();

  await admin.getByRole("button", { name: "Show password" }).click();
  await expect(admin.getByText(PASSWORD)).toBeVisible();
  await expect(admin.getByText("race-admin-2", { exact: true })).toBeVisible();
});

test("deleting it keeps the record of who read it", async () => {
  await admin.goto("/admin/credentials");
  await admin.getByRole("button", { name: "Delete" }).click();
  await expect(admin.getByText("Nothing saved yet.")).toBeVisible();
  // The login is gone; the fact that someone read it is not.
  await expect(admin.getByText(`${USERS.admin.name} read ${NAME}`).first()).toBeVisible();
});
