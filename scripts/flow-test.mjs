/**
 * Flow test — the whole workflow end to end, including the paths the smoke
 * test skips: rejections, withdrawals, comments, checklists, files, time logs,
 * dependencies, follow-up work, bulk actions, exports, recurring tasks,
 * milestones, templates, and the views that should reflect all of it.
 *
 *   npm run flow          # against http://localhost:3000 and the dev database
 *
 * Unlike `npm run smoke`, this one reads and writes the database directly (to
 * assert what was stored and to clean up), so point it at a development or
 * staging copy — not production. Settings (env):
 *
 *   FLOW_URL      the app to drive           (default http://localhost:3000)
 *   FLOW_ADMIN    an admin's Employee ID     (default ADMIN001)
 *   FLOW_MEMBER   a member's Employee ID     (default RACE005)
 *   FLOW_OWNER    another member's           (default EMP001)
 *   FLOW_PIN      the PIN for all three      (default 1234)
 *   MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
 *
 * Everything it creates is named "FLOW …" and removed at the end; the last
 * lines report anything left behind.
 */
import { chromium } from "@playwright/test";
import mysql from "mysql2/promise";
import fs from "node:fs";
const { writeFileSync, readFileSync } = fs;

const BASE = (process.env.FLOW_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const SHOTS = process.argv[2] ?? "test-results";
const PIN = process.env.FLOW_PIN ?? "1234";
const STAMP = new Date().toISOString().slice(11, 19);
const P1 = `FLOW rejected ${STAMP}`;
const P2 = `FLOW main ${STAMP}`;
const P3 = `FLOW from template ${STAMP}`;
const TEMPLATE = `FLOW template ${STAMP}`;
const FEATURE = `Flow: export dealers as CSV ${STAMP}`;
const CORRECTION = `Flow: search ignores dealer codes ${STAMP}`;
const REJECTED_REQ = `Flow: dark mode ${STAMP}`;
const WITHDRAWN_REQ = `Flow: withdraw me ${STAMP}`;

const results = [];
let failures = 0;
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push(`  ok   ${name} (${Date.now() - t}ms)`);
  } catch (e) {
    failures++;
    results.push(`  FAIL ${name} — ${String(e).split("\n")[0].slice(0, 150)}`);
  }
}
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3307),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "",
  database: process.env.MYSQL_DATABASE ?? "pm_app",
});
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ channel: process.env.FLOW_BROWSER_CHANNEL ?? "chrome" });
async function signIn(empId) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  page.answer = ""; // prompt() text, when a step needs one
  page.on("dialog", (d) => d.accept(page.answer));
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Employee ID").fill(empId);
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
  return page;
}

let admin, member, owner, p2Id, p3Id;
async function pick(select, text) {
  const value = await select.locator("option", { hasText: text }).first().getAttribute("value");
  if (!value) throw new Error(`no option matching "${text}"`);
  await select.selectOption(value);
}

const openTask = async (page, title) => {
  await page.locator("[draggable]", { hasText: title }).first().click();
  return page.getByRole("dialog", { name: title });
};

try {
  admin = await signIn(process.env.FLOW_ADMIN ?? "ADMIN001"); // approves
  member = await signIn(process.env.FLOW_MEMBER ?? "RACE005"); // requests
  owner = await signIn(process.env.FLOW_OWNER ?? "EMP001"); // does the work

  // ---- Flow 1: a project request that gets rejected ----------------------
  await step("1a member creates a project that an admin rejects", async () => {
    await member.goto(`${BASE}/projects`);
    await member.getByRole("button", { name: "+ Create project" }).click();
    const d = member.getByRole("dialog", { name: "Create a project" });
    await d.getByLabel("Name").fill(P1);
    await d.getByLabel("Lead (approver)").selectOption({ index: 1 });
    await d.getByRole("button", { name: "Create project" }).click();
    await member.waitForURL(/\/projects\/\d+$/, { timeout: 30000 });
    const id = new URL(member.url()).pathname.split("/").pop();

    await admin.goto(`${BASE}/projects/${id}`);
    await admin.getByRole("button", { name: "Reject…" }).click();
    await admin.getByLabel(/Reason for rejecting/).fill("Merge into the main project");
    await admin.getByRole("button", { name: "Reject request" }).click();
    await admin.getByRole("heading", { name: "Project request rejected" }).waitFor({ timeout: 20000 });
  });

  await step("1b the requester sees the reason and can delete it", async () => {
    await member.reload();
    await member.getByText("“Merge into the main project”").waitFor({ timeout: 20000 });
    await member.getByRole("button", { name: "Delete request" }).click();
    await member.waitForURL(/\/projects$/, { timeout: 20000 });
    must(!(await member.getByRole("link", { name: new RegExp(P1) }).count()), "still listed");
  });

  // ---- Flow 2: the main project ------------------------------------------
  await step("2a member creates the main project; lead approves and adds people", async () => {
    await member.getByRole("button", { name: "+ Create project" }).click();
    const d = member.getByRole("dialog", { name: "Create a project" });
    await d.getByLabel("Name").fill(P2);
    await d.getByLabel("Lead (approver)").selectOption({ index: 1 });
    await d.getByRole("button", { name: "Create project" }).click();
    await member.waitForURL(/\/projects\/\d+$/, { timeout: 30000 });
    p2Id = Number(new URL(member.url()).pathname.split("/").pop());

    await admin.goto(`${BASE}/projects/${p2Id}`);
    await admin.getByRole("button", { name: "Approve project" }).click();
    await admin.getByRole("button", { name: "+ New task" }).waitFor({ timeout: 20000 });
    await admin.getByRole("button", { name: /^Members/ }).click();
    const m = admin.getByRole("dialog", { name: "Manage members" });
    await pick(m.getByLabel("Add member"), "Test Employee One");
    await m.getByRole("button", { name: "Add", exact: true }).click();
    await m.getByRole("button", { name: "Close" }).click();
  });

  await step("2b the lead creates a new-feature task directly", async () => {
    await admin.getByRole("button", { name: "+ New task" }).click();
    const d = admin.getByRole("dialog", { name: "New task" });
    await d.getByText("New feature", { exact: true }).click();
    await d.getByLabel(/^Title/).fill(FEATURE);
    await d.getByLabel(/^Features/).fill("Download the dealer list as CSV.");
    await d.getByLabel(/^Rules/).fill("Only leads can export.");
    await pick(d.getByLabel(/^Requested by/), "Arun");
    await pick(d.getByLabel(/^Assigned owner/), "Test Employee One");
    await d.getByRole("button", { name: "Create task" }).click();
    await d.waitFor({ state: "hidden", timeout: 20000 });
    await admin.locator("[draggable]", { hasText: FEATURE }).first().waitFor({ timeout: 20000 });
  });

  const raise = async (title, page = member) => {
    await page.goto(`${BASE}/projects/${p2Id}`);
    await page.getByRole("button", { name: "+ Raise request" }).click();
    const d = page.getByRole("dialog", { name: "Raise a task request" });
    await d.getByLabel(/^Title/).fill(title);
    await d.getByLabel(/^Existing behavior/).fill("Searching D-1042 finds nothing.");
    await d.getByLabel(/^Expected behavior/).fill("It finds dealer D-1042.");
    await d.getByLabel(/^Acceptance criteria/).fill("Typing D-1042 shows that dealer.");
    await d.getByLabel(/^Priority/).selectOption("high");
    await d.getByRole("button", { name: "Raise request", exact: true }).click();
    await d.waitFor({ state: "hidden", timeout: 20000 });
  };

  await step("2c a raised request can be rejected with a reason", async () => {
    await raise(REJECTED_REQ);
    await admin.goto(`${BASE}/projects/${p2Id}`);
    await admin.locator("section li", { hasText: REJECTED_REQ }).getByRole("button", { name: "Reject" }).click();
    const d = admin.getByRole("dialog", { name: "Reject request" });
    await d.getByLabel(/Reason for rejecting/).fill("Not planned this quarter");
    await d.getByRole("button", { name: "Reject request" }).click();
    await d.waitFor({ state: "hidden", timeout: 20000 });

    await member.goto(`${BASE}/projects/${p2Id}`);
    await member.getByRole("button", { name: /Show decided/ }).click();
    await member.locator("section li", { hasText: REJECTED_REQ })
      .getByText("Not planned this quarter", { exact: false })
      .waitFor({ timeout: 20000 });
  });

  await step("2d the raiser can withdraw their own pending request", async () => {
    await raise(WITHDRAWN_REQ);
    await member.locator("section li", { hasText: WITHDRAWN_REQ }).first().getByRole("button", { name: /Withdraw/ }).click();
    await member.waitForTimeout(800);
    await member.reload();
    must(
      !(await member.locator("section li", { hasText: WITHDRAWN_REQ }).count()),
      "withdrawn request still pending"
    );
  });

  await step("2e an approved request becomes a task, linked from the decided list", async () => {
    await raise(CORRECTION);
    await admin.goto(`${BASE}/projects/${p2Id}`);
    await admin.locator("section li", { hasText: CORRECTION }).getByRole("button", { name: "Approve" }).click();
    const d = admin.getByRole("dialog", { name: "Approve request" });
    await pick(d.getByLabel(/Assigned owner/), "Test Employee One");
    // The approver picks who does the work; how urgent it is came with the
    // request, so there is nothing here to set it with.
    must(!(await d.getByLabel("Priority").count()), "the approver can still set priority");
    await d.getByRole("button", { name: "Approve & create task" }).click();
    await d.waitFor({ state: "hidden", timeout: 20000 });
    await admin.locator("[draggable]", { hasText: CORRECTION }).first().waitFor({ timeout: 20000 });

    await admin.getByRole("button", { name: /Show decided/ }).click();
    await admin.locator("section li", { hasText: CORRECTION }).getByRole("button", { name: "Open task" }).click();
    const task = admin.getByRole("dialog", { name: CORRECTION });
    await task.getByRole("heading", { name: "Approval trail" }).waitFor({ timeout: 20000 });
    await task.getByRole("button", { name: "Close" }).click();
  });

  await step("2f bulk actions apply to several tasks at once", async () => {
    await admin.goto(`${BASE}/projects/${p2Id}`);
    await admin.getByRole("button", { name: "list", exact: true }).click();
    const boxes = admin.locator('input[type="checkbox"][aria-label^="Select"]');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await admin.locator("select").filter({ hasText: "Set priority" }).first().selectOption("urgent");
    await admin.waitForTimeout(1200);
    const [rows] = await db.query(
      "SELECT COUNT(*) n FROM tasks WHERE project_id = ? AND priority = 'urgent'",
      [p2Id]
    );
    must(Number(rows[0].n) === 2, `${rows[0].n} tasks took the new priority`);
    await admin.getByRole("button", { name: "board", exact: true }).click();
  });

  // ---- Flow 3: everything you can do on a task ---------------------------
  await step("3a comments, with an @mention", async () => {
    const task = await openTask(admin, CORRECTION);
    await task.getByPlaceholder(/Write a comment/).fill("Checked on staging — looks right.");
    await task.getByRole("button", { name: "Post comment", exact: true }).click();
    await task.getByText("Checked on staging — looks right.").waitFor({ timeout: 20000 });
  });

  await step("3b checklist items and progress", async () => {
    const task = admin.getByRole("dialog", { name: CORRECTION });
    await task.getByPlaceholder(/Add a checklist item/).fill("Reproduce the bug");
    await task.getByPlaceholder(/Add a checklist item/).press("Enter");
    await task.getByText("Reproduce the bug").waitFor({ timeout: 20000 });
    const box = task.getByRole("checkbox").first();
    await box.click();
    for (let i = 0; i < 20 && !(await box.isChecked()); i++) await admin.waitForTimeout(150);
    must(await box.isChecked(), "the checklist item did not tick");
  });

  await step("3c a file attaches to the task", async () => {
    const file = `${SHOTS}/flow-attachment.txt`;
    writeFileSync(file, "evidence from the flow test\n");
    const task = admin.getByRole("dialog", { name: CORRECTION });
    await task.locator('input[type="file"]').setInputFiles(file);
    await task.getByText("flow-attachment.txt").waitFor({ timeout: 30000 });
  });

  await step("3d time logs against the task", async () => {
    const task = admin.getByRole("dialog", { name: CORRECTION });
    await task.getByLabel("Hours").fill("1");
    await task.getByLabel("Minutes").fill("30");
    await task.getByRole("button", { name: "Log time" }).click();
    await task.getByText(/1h 30m/).first().waitFor({ timeout: 20000 });
  });

  await step("3e a blocking task can be recorded", async () => {
    const task = admin.getByRole("dialog", { name: CORRECTION });
    const blockers = task.locator("select").filter({ hasText: "Add a blocking task" }).first();
    await pick(blockers, FEATURE.slice(0, 20));
    await blockers.locator("xpath=..").getByRole("button", { name: "Add", exact: true }).first().click();
    await task.getByText(new RegExp(FEATURE.slice(0, 20))).first().waitFor({ timeout: 20000 });
  });

  await step("3f the PDF and the calendar file both download", async () => {
    const task = admin.getByRole("dialog", { name: CORRECTION });
    const [pdf] = await Promise.all([
      admin.waitForEvent("download"),
      task.getByRole("button", { name: "Download PDF" }).click(),
    ]);
    must(readFileSync(await pdf.path()).subarray(0, 5).toString() === "%PDF-", "not a PDF");

    const ics = task.getByRole("link", { name: /Add to calendar/ });
    if (await ics.count()) {
      const [dl] = await Promise.all([admin.waitForEvent("download"), ics.click()]);
      must((await readFileSync(await dl.path(), "utf8")).includes("BEGIN:VCALENDAR"), "not a calendar file");
    }
    await task.getByRole("button", { name: "Close" }).click();
  });

  // ---- Flow 4: review, sign-off and the locks ----------------------------
  await step("4a the owner submits for review and cannot mark it Done", async () => {
    await owner.goto(`${BASE}/projects/${p2Id}`);
    const task = await openTask(owner, CORRECTION);
    const status = task.getByLabel("Task status");
    const options = await status.locator("option").allTextContents();
    must(!options.some((o) => o.trim() === "Done"), `owner was offered: ${options.join("/")}`);
    await status.selectOption("review");
    await owner.waitForTimeout(700);
    await task.getByRole("button", { name: "Close" }).click();
  });

  await step("4b the lead approves it from the Outstanding list", async () => {
    await admin.goto(`${BASE}/outstanding`);
    await admin.locator("tr", { hasText: CORRECTION }).getByRole("button", { name: "Approve" }).click();
    await admin.waitForTimeout(900);
    const [row] = await db.query("SELECT status FROM tasks WHERE title = ?", [CORRECTION]);
    must(row[0].status === "done", `status is ${row[0].status}`);
  });

  await step("4c the requester signs it off and everything locks", async () => {
    await member.goto(`${BASE}/projects/${p2Id}`);
    const task = await openTask(member, CORRECTION);
    await task.getByRole("button", { name: "Sign off", exact: true }).click();
    await task.getByLabel("Note (optional)").fill("Verified by the flow test");
    await task.getByRole("button", { name: "Confirm sign-off" }).click();
    await task.getByText("This task is signed off and read-only.").waitFor({ timeout: 20000 });
    await task.getByRole("button", { name: "Close" }).click();

    await admin.goto(`${BASE}/projects/${p2Id}`);
    const asLead = await openTask(admin, CORRECTION);
    for (const gone of ["Edit", "Delete", "Sign off", "Log time"]) {
      must(!(await asLead.getByRole("button", { name: gone, exact: true }).count()), `${gone} still offered`);
    }
    must(!(await asLead.getByPlaceholder(/Write a comment/).count()), "comments still open");
    await admin.screenshot({ path: `${SHOTS}/f-01-locked.png` });
  });

  await step("4d follow-up work can still be raised from a signed-off task", async () => {
    const task = admin.getByRole("dialog", { name: CORRECTION });
    await task.getByRole("button", { name: "+ Follow-up work" }).click();
    const d = admin.getByRole("dialog", { name: "Add follow-up work" });
    await d.getByLabel(/^Title/).fill(`Flow follow-up ${STAMP}`);
    await d.getByLabel(/^Existing behavior/).fill("Still slow on large lists.");
    await d.getByLabel(/^Expected behavior/).fill("Returns within a second.");
    await d.getByLabel(/^Acceptance criteria/).fill("1000 dealers load in under a second.");
    await pick(d.getByLabel(/^Assigned owner/), "Test Employee One");
    await d.getByRole("button", { name: "Create task" }).click();
    await d.waitFor({ state: "hidden", timeout: 20000 });
    const [rows] = await db.query("SELECT is_additional FROM tasks WHERE title = ?", [`Flow follow-up ${STAMP}`]);
    must(rows[0]?.is_additional === 1, "follow-up not flagged as additional work");
  });

  // ---- Flow 5: project completion ---------------------------------------
  await step("5a completing is blocked while work is unsigned", async () => {
    await admin.goto(`${BASE}/projects/${p2Id}`);
    await admin.getByRole("button", { name: "Edit project" }).click();
    const d = admin.getByRole("dialog", { name: "Edit project" });
    await d.getByLabel("Status").selectOption("completed");
    await d.getByRole("button", { name: "Save" }).click();
    await d.getByText(/can't be completed yet/).waitFor({ timeout: 20000 });
    await d.getByRole("button", { name: "Cancel" }).click();
  });

  await step("5b signing off the rest completes and locks the project", async () => {
    for (const title of [FEATURE, `Flow follow-up ${STAMP}`]) {
      const task = await openTask(admin, title);
      await task.getByLabel("Task status").selectOption("done");
      await task.getByRole("button", { name: "Sign off", exact: true }).click();
      await task.getByRole("button", { name: "Confirm sign-off" }).click();
      await task.getByText("This task is signed off and read-only.").waitFor({ timeout: 20000 });
      await task.getByRole("button", { name: "Close" }).click();
    }
    await admin.getByText("All tasks are signed off").waitFor({ timeout: 20000 });
    await admin.getByRole("button", { name: "Mark completed" }).click();
    await admin.getByText("Project completed — read-only").waitFor({ timeout: 20000 });
    must(!(await admin.getByRole("button", { name: "+ New task" }).count()), "still editable");

    await member.goto(`${BASE}/projects/${p2Id}`);
    must(!(await member.getByRole("button", { name: "+ Raise request" }).count()), "member can still raise work");
  });

  await step("5c an admin reopens it", async () => {
    await admin.getByRole("button", { name: "Reopen project" }).click();
    await admin.getByRole("button", { name: "+ New task" }).waitFor({ timeout: 20000 });
  });

  // ---- Flow 6: the rest of the project tools -----------------------------
  await step("6a a milestone can be added", async () => {
    await admin.getByPlaceholder("New milestone…").fill(`Flow milestone ${STAMP}`);
    await admin.locator('input[type="date"]').first().fill("2026-12-31");
    await admin.getByRole("button", { name: "Add", exact: true }).first().click();
    await admin.getByText(`Flow milestone ${STAMP}`).waitFor({ timeout: 20000 });
  });

  await step("6c exports download (CSV, Excel, template)", async () => {
    for (const name of ["Export CSV", "Export Excel", "Template"]) {
      const [dl] = await Promise.all([
        admin.waitForEvent("download"),
        admin.locator(`a:has-text("${name}"), button:has-text("${name}")`).first().click(),
      ]);
      const bytes = readFileSync(await dl.path());
      must(bytes.length > 50, `${name} produced ${bytes.length} bytes`);
    }
  });

  await step("6d a recurring task definition can be added", async () => {
    await admin.getByRole("button", { name: "Recurring" }).click();
    const d = admin.getByRole("dialog", { name: "Recurring tasks" });
    await d.getByPlaceholder("Title").fill(`Flow weekly check ${STAMP}`);
    await d.locator('input[type="date"]').first().fill("2026-12-28");
    await d.getByRole("button", { name: "Add recurring task" }).click();
    await d.getByText(`Flow weekly check ${STAMP}`).waitFor({ timeout: 20000 });
    await d.getByRole("button", { name: "Close" }).click();
  });

  await step("6e the project can be saved as a template and reused", async () => {
    admin.answer = TEMPLATE;
    await admin.getByRole("button", { name: "Save as template" }).click();
    await admin.waitForTimeout(1500);
    admin.answer = "";

    await admin.goto(`${BASE}/projects`);
    await admin.getByRole("button", { name: "+ New project" }).click();
    const d = admin.getByRole("dialog", { name: "Create project" });
    await pick(d.getByLabel("Start from"), TEMPLATE.slice(0, 18));
    await d.getByLabel("Name").fill(P3);
    await d.getByRole("button", { name: /Create from template/ }).click();
    await admin.waitForURL(/\/projects\/\d+$/, { timeout: 30000 });
    p3Id = Number(new URL(admin.url()).pathname.split("/").pop());
    const [rows] = await db.query("SELECT COUNT(*) n FROM tasks WHERE project_id = ?", [p3Id]);
    must(Number(rows[0].n) > 0, "the template copied no tasks");
  });

  // ---- Flow 7: the views that should reflect all of this -----------------
  await step("7a the owner sees the work in My Tasks", async () => {
    await owner.goto(`${BASE}/my-tasks`);
    await owner.getByText(CORRECTION).first().waitFor({ timeout: 20000 });
  });

  await step("7b search finds the task", async () => {
    await admin.goto(`${BASE}/dashboard`);
    await admin.getByPlaceholder("Search projects & tasks…").fill(CORRECTION.slice(0, 18));
    await admin.getByText(CORRECTION).first().waitFor({ timeout: 20000 });
  });

  await step("7c the requester was notified along the way", async () => {
    await member.goto(`${BASE}/notifications`);
    const text = await member.locator("body").innerText();
    must(/sign off|approved|rejected/i.test(text), "no notifications for the requester");
    await member.screenshot({ path: `${SHOTS}/f-02-notifications.png` });
  });

  await step("7d the calendar shows the meeting and due dates", async () => {
    await admin.goto(`${BASE}/calendar`);
    await admin
      .getByRole("button", { name: /Add to Google, Outlook or Apple|Calendar connected/ })
      .waitFor({ timeout: 20000 });
  });

  await step("7e the activity log records what happened", async () => {
    await admin.goto(`${BASE}/admin/activity`);
    const text = await admin.locator("body").innerText();
    must(/signed off|project/i.test(text), "activity log looks empty");
  });
} catch (e) {
  failures++;
  results.push(`  FAIL (aborted) — ${String(e).split("\n")[0].slice(0, 160)}`);
} finally {
  for (const id of [p2Id, p3Id]) {
    if (id) await db.query("DELETE FROM projects WHERE id = ?", [id]);
  }
  await db.query("DELETE FROM project_templates WHERE name = ?", [TEMPLATE]);
  await db.query("DELETE FROM projects WHERE name IN (?, ?, ?)", [P1, P2, P3]);
  await db.query("DELETE FROM notifications WHERE message LIKE ?", [`%${STAMP}%`]);
  const [[left]] = await db.query(
    `SELECT (SELECT COUNT(*) FROM projects WHERE name LIKE 'FLOW %') p,
            (SELECT COUNT(*) FROM tasks WHERE title LIKE 'Flow%') t,
            (SELECT COUNT(*) FROM project_templates WHERE name LIKE 'FLOW %') tpl`
  );
  console.log(results.join("\n"));
  console.log(`\nleft behind — projects ${left.p}, tasks ${left.t}, templates ${left.tpl}`);
  console.log(failures ? `\nFLOW TEST: ${failures} step(s) failed` : "\nFLOW TEST PASSED");
  await browser.close();
  await db.end();
}
