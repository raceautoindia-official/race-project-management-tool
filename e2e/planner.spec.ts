import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { USERS } from "./users";

// The daily / weekly planner: written by the person, read by their lead.

let sam: Page;
let admin: Page;

const PLAN = "Finish the dealer CSV export";
const PROGRESS = "Done, waiting on review";

test.beforeAll(async ({ browser }) => {
  sam = await signIn(browser, USERS.sam);
  admin = await signIn(browser, USERS.admin);
});

test("someone writes their plan for today", async () => {
  await sam.goto("/planner");
  await expect(sam.getByText("Nothing written yet.")).toBeVisible();

  await sam.getByLabel("What I mean to do").fill(PLAN);
  await sam.getByLabel("How it went").fill(PROGRESS);
  await sam.getByRole("button", { name: "Save" }).click();

  await expect(sam.getByText(/Last saved/)).toBeVisible();
  await sam.reload();
  await expect(sam.getByLabel("What I mean to do")).toHaveValue(PLAN);
});

test("the week is a separate tab, and a separate entry", async () => {
  await sam.goto("/planner");
  await expect(sam.getByRole("tab", { name: "Daily summary" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await sam.getByRole("tab", { name: "Weekly plan" }).click();
  // Switching to the week shows an empty one, not the day's.
  await expect(sam.getByLabel("What I mean to do")).toHaveValue("");
  await sam.getByLabel("What I mean to do").fill("Ship the export this week");
  await sam.getByRole("button", { name: "Save" }).click();
  await expect(sam.getByText(/Last saved/)).toBeVisible();

  await sam.getByRole("tab", { name: "Daily summary" }).click();
  await expect(sam.getByLabel("What I mean to do")).toHaveValue(PLAN);
});

test("an admin reads it without being able to change it", async () => {
  await admin.goto("/planner");
  const theirs = admin.getByRole("listitem").filter({ hasText: USERS.sam.name });
  await expect(theirs).toContainText(PLAN);
  await expect(theirs).toContainText(PROGRESS);
  // One box, theirs alone — no way to type into somebody else's.
  await expect(admin.getByLabel("What I mean to do")).toHaveCount(1);
});

test("a member sees nobody else's", async ({ browser }) => {
  const other = await signIn(browser, USERS.olivia);
  await other.goto("/planner");
  await expect(other.getByLabel("What I mean to do")).toBeVisible();
  await expect(other.getByText(PLAN)).toHaveCount(0);
  await expect(other.getByRole("link", { name: /Download the team/ })).toHaveCount(0);
});

test("it downloads as a spreadsheet", async () => {
  await sam.goto("/planner");
  const [download] = await Promise.all([
    sam.waitForEvent("download"),
    sam.getByRole("link", { name: /Download mine/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^planner-day-.*\.xlsx$/);

  await admin.goto("/planner");
  const [teamFile] = await Promise.all([
    admin.waitForEvent("download"),
    admin.getByRole("link", { name: /Download the team/ }).click(),
  ]);
  expect(teamFile.suggestedFilename()).toMatch(/^team-day-.*\.xlsx$/);
});

test("clearing both boxes takes the entry back", async () => {
  await sam.goto("/planner");
  await sam.getByLabel("What I mean to do").fill("");
  await sam.getByLabel("How it went").fill("");
  await sam.getByRole("button", { name: "Save" }).click();
  await expect(sam.getByText("Nothing written yet.")).toBeVisible();
});
