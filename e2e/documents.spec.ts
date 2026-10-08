import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { USERS } from "./users";

// Personal documents: what someone uploads about themselves, and what an
// administrator can see of it.

let admin: Page;
let member: Page;

const FILE = {
  name: "aadhaar-e2e.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4 e2e test document"),
};

test.beforeAll(async ({ browser }) => {
  admin = await signIn(browser, USERS.admin);
  member = await signIn(browser, USERS.sam);
});

test("someone uploads their own document", async () => {
  await member.goto("/profile");
  await expect(member.getByText("You have not uploaded anything yet.")).toBeVisible();
  // Said plainly rather than left to assume.
  await expect(member.getByText("An administrator can open them")).toBeVisible();

  await member.getByLabel("What is it?").selectOption("id_proof");
  await member.getByLabel(/^Note/).fill("Front and back");
  await member.getByLabel("Choose a document to upload").setInputFiles(FILE);

  await expect(member.getByText(FILE.name)).toBeVisible();
  await expect(member.getByText(/ID proof · Front and back/)).toBeVisible();
});

test("an admin sees it, filed under the person it belongs to", async () => {
  await admin.goto("/admin/documents");
  await expect(admin.getByRole("heading", { name: "Personal documents" })).toBeVisible();
  await expect(admin.getByText(USERS.sam.name)).toBeVisible();
  await expect(admin.getByText(FILE.name)).toBeVisible();

  const [download] = await Promise.all([
    admin.waitForEvent("download"),
    admin.getByRole("link", { name: "Download" }).first().click(),
  ]);
  expect(download.suggestedFilename()).toBe(FILE.name);
});

test("the admin opening it is recorded", async () => {
  await admin.goto("/admin/activity");
  await expect(admin.getByText(FILE.name).first()).toBeVisible();
});

test("another member cannot see it at all", async ({ browser }) => {
  const other = await signIn(browser, USERS.alice);
  await other.goto("/profile");
  // Their own page shows their own documents, which is none.
  await expect(other.getByText("You have not uploaded anything yet.")).toBeVisible();
  await expect(other.getByText(FILE.name)).toHaveCount(0);
  // And the admin page is not theirs to open.
  await other.goto("/admin/documents");
  await expect(other).not.toHaveURL(/\/admin\/documents$/);
});

test("the owner can remove it", async () => {
  await member.goto("/profile");
  await member.getByRole("button", { name: "Remove" }).click();
  await expect(member.getByText("You have not uploaded anything yet.")).toBeVisible();
});
