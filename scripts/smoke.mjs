/**
 * Smoke test — drives a running deployment through the critical journeys in a
 * real browser, then deletes everything it created.
 *
 *   npm run smoke                        # against http://localhost:3000
 *   SMOKE_URL=https://pm.example.com npm run smoke
 *
 * Settings (env):
 *   SMOKE_URL       the deployment to test        (default http://localhost:3000)
 *   SMOKE_ADMIN     an admin's Employee ID        (default ADMIN001)
 *   SMOKE_MEMBER    a member's Employee ID        (default RACE005)
 *   SMOKE_PIN       the PIN for both              (default 1234)
 *   CRON_SECRET     checks the scheduled jobs too (optional)
 *
 * It signs in as two real people and creates one project and one meeting, both
 * named "SMOKE TEST <time>", then removes them through the app's own API — so
 * it needs no database access and is safe to point at production. If a step
 * fails, cleanup still runs; anything it could not remove is named at the end.
 */
import { chromium } from "@playwright/test";

const BASE = (process.env.SMOKE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN ?? "ADMIN001";
const MEMBER = process.env.SMOKE_MEMBER ?? "RACE005";
const PIN = process.env.SMOKE_PIN ?? "1234";
const CRON_SECRET = process.env.CRON_SECRET ?? "";

const STAMP = new Date().toISOString().slice(11, 19);
const PROJECT = `SMOKE TEST ${STAMP}`;
const TASK = "Smoke: search ignores dealer codes";
const MEETING = `SMOKE MEETING ${STAMP}`;

const results = [];
let failed = false;
/**
 * Something that isn't a failure but that someone should know — a setting
 * that will misbehave in front of real users. Printed with the results so it
 * isn't lost in the scroll.
 */
function warn(message) {
  results.push(`  warn ${message}`);
}
async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push(`  ok   ${name} (${Date.now() - started}ms)`);
  } catch (e) {
    failed = true;
    results.push(`  FAIL ${name} — ${String(e).split("\n")[0].slice(0, 160)}`);
    throw e;
  }
}

const browser = await chromium.launch({ channel: process.env.SMOKE_BROWSER_CHANNEL ?? "chrome" });
async function signIn(empId) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  page.on("dialog", (d) => d.accept()); // confirm prompts
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Employee ID").fill(empId);
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
  return page;
}

let member, admin, projectId;
console.log(`Smoke test against ${BASE}\n`);

try {
  await step(`${MEMBER} signs in`, async () => (member = await signIn(MEMBER)));
  await step(`${ADMIN} signs in`, async () => (admin = await signIn(ADMIN)));

  await step("a member creates a project and nominates a lead", async () => {
    await member.goto(`${BASE}/projects`);
    await member.getByRole("button", { name: "+ Create project" }).click();
    const dialog = member.getByRole("dialog", { name: "Create a project" });
    await dialog.getByLabel("Name").fill(PROJECT);
    await dialog.getByLabel("Description").fill("Created by the smoke test — safe to delete");
    await dialog.getByLabel("Lead (approver)").selectOption({ index: 1 });
    await dialog.getByRole("button", { name: "Create project" }).click();
    await member.waitForURL(/\/projects\/\d+$/, { timeout: 30000 });
    projectId = Number(new URL(member.url()).pathname.split("/").pop());
  });

  await step("it is read-only until the lead approves", async () => {
    await member.getByText("Awaiting lead approval").waitFor({ timeout: 20000 });
    if (await member.getByRole("button", { name: "+ Raise request" }).count()) {
      throw new Error("the project accepted work before approval");
    }
  });

  await step("the lead approves it", async () => {
    await admin.goto(`${BASE}/projects/${projectId}`);
    await admin.getByRole("button", { name: "Approve project" }).click();
    await admin.getByRole("button", { name: "+ New task" }).waitFor({ timeout: 20000 });
  });

  await step("the lead adds a member", async () => {
    await admin.getByRole("button", { name: /^Members/ }).click();
    const dialog = admin.getByRole("dialog", { name: "Manage members" });
    await dialog.getByLabel("Add member").selectOption({ index: 1 });
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await dialog.getByRole("button", { name: "Close" }).click();
  });

  await step("a member raises a task request", async () => {
    await member.goto(`${BASE}/projects/${projectId}`);
    await member.getByRole("button", { name: "+ Raise request" }).click();
    const dialog = member.getByRole("dialog", { name: "Raise a task request" });
    await dialog.getByLabel(/^Title/).fill(TASK);
    await dialog.getByLabel(/^Existing behavior/).fill("Searching D-1042 finds nothing.");
    await dialog.getByLabel(/^Expected behavior/).fill("It finds dealer D-1042.");
    await dialog.getByLabel(/^Acceptance criteria/).fill("Typing D-1042 shows that dealer.");
    await dialog.getByRole("button", { name: "Raise request", exact: true }).click();
    await dialog.waitFor({ state: "hidden", timeout: 20000 });
  });

  await step("the lead approves it into a task with an owner", async () => {
    await admin.goto(`${BASE}/projects/${projectId}`);
    await admin.locator("section li", { hasText: TASK }).getByRole("button", { name: "Approve" }).click();
    const dialog = admin.getByRole("dialog", { name: "Approve request" });
    await dialog.getByLabel(/Assigned owner/).selectOption({ index: 1 });
    await dialog.getByRole("button", { name: "Approve & create task" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 20000 });
    await admin.locator("[draggable]", { hasText: TASK }).first().waitFor({ timeout: 20000 });
  });

  await step("the task carries its full approval trail", async () => {
    await admin.locator("[draggable]", { hasText: TASK }).first().click();
    const trail = admin
      .getByRole("dialog", { name: TASK })
      .getByRole("region", { name: "Approval trail" });
    await trail.getByRole("listitem").nth(4).waitFor({ timeout: 20000 });
  });

  await step("the task downloads as a PDF", async () => {
    const [download] = await Promise.all([
      admin.waitForEvent("download"),
      admin.getByRole("button", { name: "Download PDF" }).click(),
    ]);
    const { readFileSync } = await import("node:fs");
    const bytes = readFileSync(await download.path());
    if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("the download is not a PDF");
  });

  await step("the lead marks it Done", async () => {
    await admin.getByLabel("Task status").selectOption("done");
    await admin.getByRole("button", { name: "Close" }).click();
  });

  await step("the requester signs it off and it locks", async () => {
    await member.goto(`${BASE}/projects/${projectId}`);
    await member.locator("[draggable]", { hasText: TASK }).first().click();
    const task = member.getByRole("dialog", { name: TASK });
    await task.getByRole("button", { name: "Sign off", exact: true }).click();
    await task.getByLabel("Note (optional)").fill("Verified by the smoke test");
    await task.getByRole("button", { name: "Confirm sign-off" }).click();
    await task.getByText("This task is signed off and read-only.").waitFor({ timeout: 20000 });
    await task.getByRole("button", { name: "Close" }).click();
  });

  await step("the project completes and locks, and an admin can reopen it", async () => {
    await admin.goto(`${BASE}/projects/${projectId}`);
    await admin.getByText("All tasks are signed off").waitFor({ timeout: 20000 });
    await admin.getByRole("button", { name: "Mark completed" }).click();
    await admin.getByText("Project completed — read-only").waitFor({ timeout: 20000 });
    await admin.getByRole("button", { name: "Reopen project" }).click();
    await admin.getByRole("button", { name: "+ New task" }).waitFor({ timeout: 20000 });
  });

  await step("a meeting is scheduled with a video call", async () => {
    await admin.goto(`${BASE}/meetings`);
    await admin.getByRole("button", { name: "+ New meeting" }).click();
    const dialog = admin.getByRole("dialog", { name: "New meeting" });
    await dialog.getByLabel("Title").fill(MEETING);
    await dialog.getByLabel("Start").fill("2026-12-20T15:30");
    await dialog.getByLabel("Duration").selectOption("45");
    await dialog.getByRole("button", { name: "Schedule" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 20000 });
    const card = admin.locator("div.rounded-xl", { hasText: MEETING }).first();
    const href = await card.getByRole("link", { name: /Join video call/ }).getAttribute("href");
    if (!href?.includes("/meeting/")) throw new Error(`no usable join link (${href})`);
    await card.getByText("Add to calendar").click();
    for (const name of ["Google Calendar", /Outlook/, /Apple Calendar/]) {
      if (!(await card.getByRole("link", { name }).getAttribute("href"))) {
        throw new Error(`no ${name} link`);
      }
    }
  });

  await step("the calendar subscription serves that meeting", async () => {
    await admin.goto(`${BASE}/calendar`);
    // Reads "Calendar connected" once a calendar app has fetched the feed.
    await admin
      .getByRole("button", { name: /Add to Google, Outlook or Apple|Calendar connected/ })
      .click();
    const create = admin.getByRole("button", { name: "Create my calendar link" });
    if (await create.isVisible()) await create.click();
    const url = await admin.getByLabel("Your private calendar link").inputValue();

    // The link people are handed is built from APP_BASE_URL. If that points
    // somewhere other than the site under test, say so — a wrong
    // APP_BASE_URL is the reason a subscription silently never fills in —
    // then test the feed on the site we are actually smoke-testing, so
    // running on a spare port doesn't look like a broken feed.
    const feed = new URL(url);
    const base = new URL(BASE);
    let target = url;
    if (feed.origin !== base.origin) {
      warn(
        `APP_BASE_URL points at ${feed.origin}, not ${base.origin} — ` +
          `that is the address handed to Google, Outlook and Apple`
      );
      target = base.origin + feed.pathname + feed.search;
    }

    // The feed must work with no session at all — calendars send no cookies.
    const res = await admin.request.get(target, { headers: { cookie: "" } });
    if (res.status() !== 200) throw new Error(`feed returned ${res.status()}`);
    if (!(await res.text()).includes(`SUMMARY:${MEETING}`)) {
      throw new Error("the meeting is missing from the feed");
    }
  });

  if (CRON_SECRET) {
    await step("every scheduled job runs", async () => {
      for (const job of ["due-date-alerts", "meeting-reminders", "reminders", "recurring", "weekly-digest"]) {
        const res = await admin.request.post(`${BASE}/api/cron/${job}`, {
          headers: { "x-cron-secret": CRON_SECRET },
        });
        if (res.status() !== 200) throw new Error(`${job} returned ${res.status()}`);
      }
    });
  } else {
    results.push("  skip the scheduled jobs (set CRON_SECRET to include them)");
  }
} catch {
  // Recorded above; cleanup still runs.
} finally {
  const leftovers = [];
  if (admin) {
    if (projectId) {
      const res = await admin.request.delete(`${BASE}/api/projects/${projectId}`);
      if (!res.ok()) leftovers.push(`project "${PROJECT}" (id ${projectId})`);
    }
    const list = await admin.request.get(`${BASE}/api/meetings`);
    if (list.ok()) {
      for (const m of (await list.json()).meetings ?? []) {
        if (m.title === MEETING) {
          const res = await admin.request.delete(`${BASE}/api/meetings/${m.id}`);
          if (!res.ok()) leftovers.push(`meeting "${MEETING}" (id ${m.id})`);
        }
      }
    }
  }

  console.log(results.join("\n"));
  console.log(
    leftovers.length
      ? `\nCould not clean up: ${leftovers.join(", ")} — delete by hand.`
      : "\nCleaned up everything it created."
  );
  console.log(failed ? "\nSMOKE TEST FAILED" : "\nSMOKE TEST PASSED");
  await browser.close();
  process.exit(failed ? 1 : 0);
}
