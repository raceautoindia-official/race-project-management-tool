import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { closeDialog, openTask, requestRow, signIn, taskCard } from "./helpers";
import { USERS } from "./users";

/**
 * The full lifecycle, driven through the UI by five people:
 * create project → lead approves → members raise correction / feature
 * requests → lead approves or rejects → owner works → lead marks Done →
 * requester signs off (task locks) → PDF → project completes (locks) → reopen.
 */
test.describe.configure({ mode: "serial" });

const PROJECT = "E2E Dealer Portal";
const CORRECTION = "Search ignores dealer codes";
const FEATURE_REQUEST = "Dark mode for the portal";
const FEATURE_TASK = "Export dealers as CSV";

let admin: Page, lead: Page, alice: Page, sam: Page, olivia: Page;
let projectPath: string;

test.beforeAll(async ({ browser }) => {
  admin = await signIn(browser, USERS.admin);
  lead = await signIn(browser, USERS.lead);
  alice = await signIn(browser, USERS.alice);
  sam = await signIn(browser, USERS.sam);
  olivia = await signIn(browser, USERS.olivia);
});

test.afterAll(async () => {
  for (const page of [admin, lead, alice, sam, olivia]) await page?.context().close();
});

test("a member requests a project and nominates a lead", async () => {
  await alice.goto("/projects");
  await alice.getByRole("button", { name: "+ Create project" }).click();
  const dialog = alice.getByRole("dialog", { name: "Create a project" });
  await dialog.getByLabel("Name").fill(PROJECT);
  await dialog.getByLabel("Description").fill("Self-service portal for dealers");
  const leadSelect = dialog.getByLabel("Lead (approver)");
  // Only admins and existing leads are offered — not yourself or plain members.
  await expect(leadSelect.locator("option", { hasText: USERS.alice.name })).toHaveCount(0);
  await expect(leadSelect.locator("option", { hasText: USERS.sam.name })).toHaveCount(0);
  await leadSelect.selectOption({ label: USERS.lead.name });
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(alice).toHaveURL(/\/projects\/\d+$/);
  projectPath = new URL(alice.url()).pathname;
  await expect(alice.getByRole("heading", { name: PROJECT })).toBeVisible();
  await expect(alice.getByText("Awaiting lead approval")).toBeVisible();
  await expect(alice.getByText(`Nominated lead: ${USERS.lead.name}`)).toBeVisible();
  // Read-only until approved.
  await expect(alice.getByRole("button", { name: "+ Raise request" })).toHaveCount(0);
});

test("people outside the project can't see it", async () => {
  await olivia.goto("/projects");
  await expect(olivia.getByRole("link", { name: new RegExp(PROJECT) })).toHaveCount(0);
  await olivia.goto(projectPath);
  await expect(olivia).toHaveURL(/\/projects$/);
});

test("My Tasks shows a calendar even for someone with no tasks", async () => {
  // Olivia owns nothing. Picking Calendar must still give her a calendar —
  // swapping it for a line of text reads as a page that failed to load.
  await olivia.goto("/my-tasks");
  await olivia.getByRole("button", { name: "calendar" }).click();
  await expect(olivia.getByText("Sun", { exact: true })).toBeVisible();
  await expect(olivia.getByText("Sat", { exact: true })).toBeVisible();
  await expect(olivia.getByText(/nothing on the calendar/i)).toBeVisible();

  // The list view keeps its own plain empty state. Olivia is on no project,
  // so neither her own work nor anyone else's appears.
  await olivia.getByRole("button", { name: "list" }).click();
  await expect(olivia.getByText(/You have no assigned tasks/)).toBeVisible();
});

test("the nominated lead approves the project and adds a member", async () => {
  await lead.goto(projectPath);
  await expect(lead.getByText("Awaiting lead approval")).toBeVisible();
  await lead.getByRole("button", { name: "Approve project" }).click();
  await expect(lead.getByRole("button", { name: "+ New task" })).toBeVisible();
  await expect(lead.getByText("Awaiting lead approval")).toBeHidden();

  await lead.getByRole("button", { name: /^Members/ }).click();
  const members = lead.getByRole("dialog", { name: "Manage members" });
  await members.getByLabel("Add member").selectOption({ label: `${USERS.sam.name} (${USERS.sam.email})` });
  await members.getByRole("button", { name: "Add", exact: true }).click();
  await expect(members.getByText(USERS.sam.name)).toBeVisible();
  await closeDialog(members);
});

test("members raise requests; each type's required fields are enforced", async () => {
  await alice.goto(projectPath);
  await alice.getByRole("button", { name: "+ Raise request" }).click();
  let dialog = alice.getByRole("dialog", { name: "Raise a task request" });
  await expect(dialog.getByLabel("Existing work correction")).toBeChecked();
  await dialog.getByLabel(/^Title/).fill(CORRECTION);
  await dialog.getByLabel(/^Existing behavior/).fill("Searching D-1042 finds nothing.");
  await dialog.getByLabel(/^Expected behavior/).fill("Searching a dealer code finds that dealer.");
  const criteria = dialog.getByLabel(/^Acceptance criteria/);
  await dialog.getByRole("button", { name: "Raise request", exact: true }).click();
  // Blocked: acceptance criteria is required for a correction.
  await expect(dialog).toBeVisible();
  expect(await criteria.evaluate((el: HTMLTextAreaElement) => el.validity.valueMissing)).toBe(true);
  await criteria.fill("Typing D-1042 shows dealer D-1042.");
  await dialog.getByRole("button", { name: "Raise request", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(requestRow(alice, CORRECTION).getByText("Awaiting approval")).toBeVisible();

  await alice.getByRole("button", { name: "+ Raise request" }).click();
  dialog = alice.getByRole("dialog", { name: "Raise a task request" });
  await dialog.getByText("New feature", { exact: true }).click();
  await expect(dialog.getByLabel(/^Existing behavior/)).toHaveCount(0);
  await dialog.getByLabel(/^Title/).fill(FEATURE_REQUEST);
  await dialog.getByLabel(/^Features/).fill("A dark colour theme toggle.");
  await dialog.getByLabel(/^Rules/).fill("Remember the choice per user.");
  await dialog.getByRole("button", { name: "Raise request", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(requestRow(alice, FEATURE_REQUEST)).toBeVisible();
});

test("the lead rejects a request with a reason and the requester sees it", async () => {
  await lead.goto(projectPath);
  await requestRow(lead, FEATURE_REQUEST).getByRole("button", { name: "Reject" }).click();
  const dialog = lead.getByRole("dialog", { name: "Reject request" });
  await dialog.getByLabel(/Reason for rejecting/).fill("Not planned this quarter");
  await dialog.getByRole("button", { name: "Reject request" }).click();
  await expect(dialog).toBeHidden();
  await expect(requestRow(lead, FEATURE_REQUEST)).toHaveCount(0);

  await alice.goto(projectPath);
  await alice.getByRole("button", { name: /Show decided/ }).click();
  const decided = requestRow(alice, FEATURE_REQUEST);
  // Who, why, and — since the decision is now timestamped — when.
  await expect(decided).toContainText(`Rejected by ${USERS.lead.name}`);
  await expect(decided).toContainText("“Not planned this quarter”");
  await expect(decided).toContainText(/\d{1,2} \w{3,5} \d{4}/); // e.g. 25 Sept 2026
});

test("the lead approves a request with an owner and the task records its trail", async () => {
  await lead.goto(projectPath);
  await requestRow(lead, CORRECTION).getByRole("button", { name: "Approve" }).click();
  const dialog = lead.getByRole("dialog", { name: "Approve request" });
  await dialog.getByLabel(/Assigned owner/).selectOption({ label: USERS.sam.name });
  // Priority, effort and dates are the requester's — the approver only sees
  // them, and picks who does the work.
  await expect(dialog).toContainText("As requested:");
  await expect(dialog).toContainText("Medium priority");
  await expect(dialog.getByLabel("Priority")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Approve & create task" }).click();
  await expect(dialog).toBeHidden();

  await expect(taskCard(lead, CORRECTION)).toContainText("Existing work correction");
  const task = await openTask(lead, CORRECTION);
  const trail = task.getByRole("region", { name: "Approval trail" });
  await expect(trail.getByRole("listitem").nth(0)).toContainText(USERS.alice.name);
  await expect(trail.getByRole("listitem").nth(1)).toContainText(USERS.lead.name);
  await expect(trail.getByRole("listitem").nth(2)).toContainText(USERS.sam.name);
  await expect(trail.getByRole("listitem").nth(4)).toContainText("Pending");
  // It reads twice now, on purpose: once in the specification, and once as a
  // checklist item built from it.
  await expect(task.getByText("Typing D-1042 shows dealer D-1042.").first()).toBeVisible();
  await expect(task.getByText(/Checklist \(0\/\d+\)/)).toBeVisible();
  await closeDialog(task);

  // The approved request links to the task it became.
  await lead.getByRole("button", { name: /Show decided/ }).click();
  await requestRow(lead, CORRECTION).getByRole("button", { name: "Open task" }).click();
  const opened = lead.getByRole("dialog", { name: CORRECTION });
  await expect(opened.getByRole("heading", { name: "Approval trail" })).toBeVisible();
  await closeDialog(opened);
});

test("the lead creates a new-feature task directly", async () => {
  await lead.getByRole("button", { name: "+ New task" }).click();
  const dialog = lead.getByRole("dialog", { name: "New task" });
  await dialog.getByText("New feature", { exact: true }).click();
  await dialog.getByLabel(/^Features/).fill("Download the dealer list as a CSV file.");
  await dialog.getByLabel(/^Flow/).fill("Dealers → Export → file downloads");
  await dialog.getByLabel(/^Rules/).fill("Only leads can export.");
  await dialog.getByLabel(/^Title/).fill(FEATURE_TASK);
  await dialog.getByLabel(/^Requested by/).selectOption({ label: USERS.alice.name });
  await dialog.getByLabel(/^Assigned owner/).selectOption({ label: USERS.sam.name });
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();
  await expect(taskCard(lead, FEATURE_TASK)).toContainText("New feature");
});

test("the owner submits for review but can't mark the task Done", async () => {
  await sam.goto(projectPath);
  const task = await openTask(sam, CORRECTION);
  const status = task.getByLabel("Task status");
  await expect(status.locator("option")).toHaveText(["To Do", "In Progress", "Review (submit)"]);
  await status.selectOption("review");
  await expect(task.getByText("Review", { exact: true }).first()).toBeVisible();
  await expect(task.getByRole("button", { name: "Sign off", exact: true })).toHaveCount(0);
  await closeDialog(task);
});

test("the lead marks it Done, the requester signs off, and the task locks", async () => {
  await lead.goto(projectPath);
  let task = await openTask(lead, CORRECTION);
  await task.getByLabel("Task status").selectOption("done");
  await expect(task.getByRole("button", { name: "Sign off", exact: true })).toBeVisible();
  await closeDialog(task);

  await alice.goto(projectPath);
  task = await openTask(alice, CORRECTION);
  await task.getByRole("button", { name: "Sign off", exact: true }).click();
  await task.getByLabel("Note (optional)").fill("Verified search on staging");
  await task.getByRole("button", { name: "Confirm sign-off" }).click();

  await expect(task.getByText("This task is signed off and read-only.")).toBeVisible();
  await expect(task).toContainText(`Signed off by ${USERS.alice.name}`);
  await expect(task).toContainText("“Verified search on staging”");
  const trail = task.getByRole("region", { name: "Approval trail" });
  await expect(trail.getByRole("listitem").nth(3)).toContainText(USERS.lead.name); // marked Done
  await expect(trail.getByRole("listitem").nth(4)).toContainText(USERS.alice.name); // signed off
  await closeDialog(task);
});

test("everyone sees the signed-off task as read-only", async () => {
  for (const page of [sam, lead]) {
    await page.goto(projectPath);
    await expect(taskCard(page, CORRECTION)).toContainText("Signed off");
    const task = await openTask(page, CORRECTION);
    await expect(task.getByText("This task is signed off and read-only.")).toBeVisible();
    for (const control of ["Edit", "Delete", "Sign off", "Log time", "+ Attach file"]) {
      await expect(task.getByRole("button", { name: control, exact: true })).toHaveCount(0);
    }
    await expect(task.getByLabel("Task status")).toHaveCount(0);
    await expect(task.getByPlaceholder(/Write a comment/)).toHaveCount(0);
    await expect(task.getByPlaceholder(/Add a checklist item/)).toHaveCount(0);
    await closeDialog(task);
  }
});

test("the task downloads as a PDF", async () => {
  await alice.goto(projectPath);
  const task = await openTask(alice, CORRECTION);
  const [download] = await Promise.all([
    alice.waitForEvent("download"),
    task.getByRole("button", { name: "Download PDF" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^task-\d+-search-ignores-dealer-codes\.pdf$/);
  const file = test.info().outputPath("task.pdf");
  await download.saveAs(file);
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1000);
  await closeDialog(task);
});

test("the project can't be completed while a task is not signed off", async () => {
  await lead.goto(projectPath);
  await lead.getByRole("button", { name: "Edit project" }).click();
  const dialog = lead.getByRole("dialog", { name: "Edit project" });
  await dialog.getByLabel("Status").selectOption("completed");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toContainText("The project can't be completed yet: 1 task is not signed off yet.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("after the last sign-off the lead completes the project and it locks", async () => {
  await lead.goto(projectPath);
  const task = await openTask(lead, FEATURE_TASK);
  await task.getByLabel("Task status").selectOption("done");
  await task.getByRole("button", { name: "Sign off", exact: true }).click();
  await task.getByRole("button", { name: "Confirm sign-off" }).click();
  await expect(task.getByText("This task is signed off and read-only.")).toBeVisible();
  await closeDialog(task);

  await expect(lead.getByText("All tasks are signed off")).toBeVisible();
  await lead.getByRole("button", { name: "Mark completed" }).click();
  await expect(lead.getByText("Project completed — read-only")).toBeVisible();
  for (const control of ["+ New task", "Edit project", "Import Excel", "Recurring"]) {
    await expect(lead.getByRole("button", { name: control })).toHaveCount(0);
  }

  await alice.goto(projectPath);
  await expect(alice.getByText("Project completed — read-only")).toBeVisible();
  await expect(alice.getByRole("button", { name: "+ Raise request" })).toHaveCount(0);
  // Only an admin may reopen.
  await expect(lead.getByRole("button", { name: "Reopen project" })).toHaveCount(0);
});

test("an admin reopens the completed project", async () => {
  await admin.goto(projectPath);
  await admin.getByRole("button", { name: "Reopen project" }).click();
  await expect(admin.getByText("Project completed — read-only")).toBeHidden();

  await lead.goto(projectPath);
  await expect(lead.getByRole("button", { name: "+ New task" })).toBeVisible();
  // Signed-off tasks stay locked after reopening.
  const task = await openTask(lead, CORRECTION);
  await expect(task.getByText("This task is signed off and read-only.")).toBeVisible();
  await closeDialog(task);
});

test("a rejected project request shows the reason and can be deleted", async () => {
  const side = "E2E Side Project";
  await alice.goto("/projects");
  await alice.getByRole("button", { name: "+ Create project" }).click();
  const dialog = alice.getByRole("dialog", { name: "Create a project" });
  await dialog.getByLabel("Name").fill(side);
  await dialog.getByLabel("Lead (approver)").selectOption({ label: USERS.lead.name });
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(alice.getByRole("heading", { name: side })).toBeVisible();
  const sidePath = new URL(alice.url()).pathname;

  await admin.goto(sidePath);
  await admin.getByRole("button", { name: "Reject…" }).click();
  await admin.getByLabel(/Reason for rejecting/).fill("Merge into Dealer Portal");
  await admin.getByRole("button", { name: "Reject request" }).click();
  await expect(admin.getByRole("heading", { name: "Project request rejected" })).toBeVisible();

  await alice.goto(sidePath);
  await expect(alice.getByRole("heading", { name: "Project request rejected" })).toBeVisible();
  await expect(alice.getByText("“Merge into Dealer Portal”")).toBeVisible();
  await alice.getByRole("button", { name: "Delete request" }).click();
  await expect(alice).toHaveURL(/\/projects$/);
  await expect(alice.getByRole("link", { name: new RegExp(side) })).toHaveCount(0);
});
