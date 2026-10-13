import { beforeAll, describe, expect, it } from "vitest";
import { query, DbRow, DbResult } from "@/lib/db";
import type { User } from "@/lib/types";
import { call, createUser } from "./helpers";

import * as dueDateAlerts from "@/app/api/cron/due-date-alerts/route";
import * as meetingReminders from "@/app/api/cron/meeting-reminders/route";
import * as recurring from "@/app/api/cron/recurring/route";
import * as reminders from "@/app/api/cron/reminders/route";
import * as weeklyDigest from "@/app/api/cron/weekly-digest/route";

// Runs every scheduled job for real against the test database. Email sending
// is stubbed, but the email templates (incl. HTML escaping) run.

const SECRET = "cron-test-secret";
const cron = (handler: Parameters<typeof call>[0]) =>
  call<Record<string, unknown>>(handler, { method: "POST", headers: { "x-cron-secret": SECRET } });

let lead: User, sam: User;
let openProject: number, completedProject: number;

async function project(name: string, status: string, approval = "approved"): Promise<number> {
  const res = (await query<DbResult>(
    `INSERT INTO projects (name, status, approval_status, owner_id) VALUES (?, ?, ?, ?)`,
    [name, status, approval, lead.id]
  )) as unknown as DbResult;
  await query(
    `INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'lead'), (?, ?, 'member')`,
    [res.insertId, lead.id, res.insertId, sam.id]
  );
  return res.insertId;
}

async function task(projectId: number, title: string, dueSql: string): Promise<number> {
  const res = (await query<DbResult>(
    `INSERT INTO tasks (project_id, title, assignee_id, created_by, requested_by, request_approved_by, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ${dueSql})`,
    [projectId, title, sam.id, lead.id, lead.id, lead.id]
  )) as unknown as DbResult;
  return res.insertId;
}

beforeAll(async () => {
  process.env.CRON_SECRET = SECRET;
  lead = await createUser("Clead");
  sam = await createUser("Csam");
  openProject = await project("Cron open <b>bold</b>", "active");
  completedProject = await project("Cron completed", "completed");
});

describe("scheduled jobs (cron endpoints)", () => {
  it("reject calls without the secret", async () => {
    const res = await call(dueDateAlerts.POST, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("due-date alerts flag open projects only", async () => {
    const soonOpen = await task(openProject, "Soon <script>x</script>", "UTC_DATE() + INTERVAL 1 DAY");
    const soonDone = await task(completedProject, "Soon but locked", "UTC_DATE() + INTERVAL 1 DAY");
    const lateOpen = await task(openProject, "Late & open", "UTC_DATE() - INTERVAL 3 DAY");
    const lateDone = await task(completedProject, "Late but locked", "UTC_DATE() - INTERVAL 3 DAY");

    const res = await cron(dueDateAlerts.POST);
    expect(res.status).toBe(200);

    const rows = await query<DbRow[]>(
      `SELECT id, due_alert_sent, outstanding FROM tasks WHERE id IN (?, ?, ?, ?)`,
      [soonOpen, soonDone, lateOpen, lateDone]
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[soonOpen].due_alert_sent).toBe(1);
    expect(byId[soonDone].due_alert_sent).toBe(0);
    expect(byId[lateOpen].outstanding).toBe(1);
    expect(byId[lateDone].outstanding).toBe(0);
  });

  it("recurring tasks are created with an approval trail, never in completed projects", async () => {
    const def = async (projectId: number, title: string) =>
      ((await query<DbResult>(
        `INSERT INTO recurring_tasks (project_id, title, assignee_id, recurrence, next_run, created_by)
         VALUES (?, ?, ?, 'weekly', UTC_DATE(), NULL)`,
        [projectId, title, sam.id]
      )) as unknown as DbResult).insertId;
    const openDef = await def(openProject, "Weekly backup check");
    const lockedDef = await def(completedProject, "Weekly locked check");

    const res = await cron(recurring.POST);
    expect(res.status).toBe(200);

    const [created] = await query<DbRow[]>(
      `SELECT requested_by, request_approved_by FROM tasks WHERE project_id = ? AND title = 'Weekly backup check'`,
      [openProject]
    );
    // No creator on the definition → the project owner is recorded.
    expect(created).toMatchObject({ requested_by: lead.id, request_approved_by: lead.id });
    const [locked] = await query<DbRow[]>(
      `SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND title = 'Weekly locked check'`,
      [completedProject]
    );
    expect(Number(locked.n)).toBe(0);
    const defs = await query<DbRow[]>(
      `SELECT id, next_run > UTC_DATE() AS advanced FROM recurring_tasks WHERE id IN (?, ?)`,
      [openDef, lockedDef]
    );
    expect(Object.fromEntries(defs.map((d) => [d.id, Number(d.advanced)]))).toEqual({ [openDef]: 1, [lockedDef]: 0 });
  });

  it("meeting reminders fire (with HTML in the text)", async () => {
    const res = (await query<DbResult>(
      `INSERT INTO meetings (title, description, project_id, location, start_time, reminder_minutes, created_by)
       VALUES ('Sync <i>now</i>', 'Agenda: "a" & <b>b</b>', ?, 'Room <1>', UTC_TIMESTAMP() + INTERVAL 20 MINUTE, 60, ?)`,
      [openProject, lead.id]
    )) as unknown as DbResult;
    await query(`INSERT INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)`, [res.insertId, sam.id]);

    const out = await cron(meetingReminders.POST);
    expect(out.status).toBe(200);
    const [m] = await query<DbRow[]>(`SELECT reminder_sent FROM meetings WHERE id = ?`, [res.insertId]);
    expect(m.reminder_sent).toBe(1);
  });

  it("personal reminders fire", async () => {
    const res = (await query<DbResult>(
      `INSERT INTO reminders (user_id, title, notes, scheduled_at, reminder_minutes, notify_email, notify_push)
       VALUES (?, 'Pay <vendor>', 'Ref #1 & more', UTC_TIMESTAMP() + INTERVAL 10 MINUTE, 30, 1, 0)`,
      [sam.id]
    )) as unknown as DbResult;
    const out = await cron(reminders.POST);
    expect(out.status).toBe(200);
    const [r] = await query<DbRow[]>(`SELECT reminder_sent FROM reminders WHERE id = ?`, [res.insertId]);
    expect(r.reminder_sent).toBe(1);
  });

  it("weekly digest runs", async () => {
    const out = await cron(weeklyDigest.POST);
    expect(out.status).toBe(200);
    expect(Number(out.body.digestsSent)).toBeGreaterThan(0);
  });
});
