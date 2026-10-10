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

test("the day fills itself in, with a box for the rest", async () => {
  await sam.goto("/planner");
  // Nothing logged in this run, so the summary says so rather than
  // showing an empty table.
  await expect(sam.getByText(/Nothing recorded for this day yet/)).toBeVisible();
  await expect(sam.getByText("Nothing written yet")).toBeVisible();

  await sam.getByLabel("What I mean to do — point 1").fill(PLAN);
  await sam.getByLabel("How it went").fill(PROGRESS);
  await sam.getByRole("button", { name: "Save" }).click();

  await expect(sam.getByText(/Saved \d/)).toBeVisible();
  await sam.reload();
  await expect(sam.getByLabel("What I mean to do — point 1")).toHaveValue(PLAN);
});

test("the week has its own two tabs, and its own entry", async () => {
  await sam.goto("/planner");
  await expect(sam.getByRole("tab", { name: "Daily summary" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await sam.getByRole("tab", { name: "Weekly plan" }).click();
  // The week opens with what is due on it, from the board.
  await expect(sam.getByText("What is due this week")).toBeVisible();
  // Nothing is due in this run, so there is nothing to add from.
  await expect(sam.getByRole("button", { name: /Add these to my plan/ })).toHaveCount(0);
  // Switching to the week shows an empty box, not the day's.
  await expect(sam.getByLabel("What I mean to do — point 1")).toHaveValue("");
  await sam.getByLabel("What I mean to do — point 1").fill("Ship the export this week");
  await sam.getByRole("button", { name: "Save" }).click();
  await expect(sam.getByText(/Saved \d/)).toBeVisible();

  // The third tab is the other half of the same weekly entry: what it came
  // to, and a box for saying so.
  await sam.getByRole("tab", { name: "Weekly summary" }).click();
  await expect(sam.getByText("What the week held").or(sam.getByText(/Nothing recorded for this week/))).toBeVisible();
  await expect(sam.getByLabel("How it went")).toBeVisible();
  await expect(sam.getByLabel(/What I mean to do/)).toHaveCount(0);

  await sam.getByRole("tab", { name: "Weekly plan" }).click();
  await expect(sam.getByLabel("What I mean to do — point 1")).toHaveValue("Ship the export this week");

  await sam.getByRole("tab", { name: "Daily summary" }).click();
  await expect(sam.getByLabel("What I mean to do — point 1")).toHaveValue(PLAN);
});

test("an admin reads it without being able to change it", async () => {
  await admin.goto("/planner");
  const theirs = admin.getByRole("listitem").filter({ hasText: USERS.sam.name });
  await expect(theirs).toContainText(PLAN);
  await expect(theirs).toContainText(PROGRESS);
  // One box, theirs alone — no way to type into somebody else's.
  await expect(admin.getByLabel("What I mean to do — point 1")).toHaveCount(1);
});

test("a member sees nobody else's", async ({ browser }) => {
  const other = await signIn(browser, USERS.olivia);
  await other.goto("/planner");
  await expect(other.getByLabel("What I mean to do — point 1")).toBeVisible();
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

test("clearing it takes the entry back", async () => {
  await sam.goto("/planner");
  // One line per thing, so emptying the plan means emptying its lines.
  await sam.getByLabel("What I mean to do — point 1").fill("");
  await sam.getByLabel("How it went").fill("");
  await sam.getByRole("button", { name: "Save" }).click();
  await expect(sam.getByText("Nothing written yet")).toBeVisible();
});
