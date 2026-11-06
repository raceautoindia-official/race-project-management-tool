import { beforeAll, describe, expect, it, vi } from "vitest";
import { query, DbRow } from "@/lib/db";
import type { User } from "@/lib/types";
import { actAs, call, createLedProject, createUser } from "./helpers";

/**
 * Recurring work: an admin approves a rule once (and says whether copies
 * need review); copies arrive as tasks with their subtasks, on working days,
 * without piling up, and routine copies finish without review. WorkLens is
 * stood in for: each test says which dates are holidays.
 */

const holidays = vi.hoisted(() => ({ dates: [] as string[] }));
vi.mock("@/lib/workdays", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/workdays")>();
  return {
    ...real,
    loadWorkCalendar: vi.fn(async () =>
      real.calendarFrom([], holidays.dates.map((date) => ({ date, name: "Test holiday", location_id: null })))
    ),
  };
});

import * as recurringRoute from "@/app/api/recurring/route";
import { actOnRule, createRule, runRecurringTasks, updateRule, type RuleInput } from "@/lib/recurring";
import { applySubtaskAction } from "@/lib/subtask-actions";
import { PROJECT_CREDITED_SQL, PROJECT_UNITS_SQL, projectPercent } from "@/lib/progress";
import { getProjectProgressRows } from "@/lib/work-views";
import { getMyWork } from "@/lib/my-work";

// 2027-03-01 is a Monday. 04:00 UTC is 09:30 in India.
const at = (day: string) => new Date(`${day}T04:00:00Z`);

let admin: User;
let lead: User;
let doer: User;
let helper: User;
let projectId: number;

function input(over: Partial<RuleInput> = {}): RuleInput {
  return {
    projectId,
    newProjectName: null,
    title: "Daily stock check",
    description: null,
    priority: "medium",
    ownerId: doer.id,
    estimatedHours: 0.5,
    frequency: "daily",
    interval: 1,
    weekdays: [],
    monthDay: null,
    startDate: "2027-03-01",
    endDate: null,
    dueAfterDays: 0,
    whenOpen: "skip",
    reviewMode: null,
    subtasks: [],
    ...over,
  };
}

async function copies(ruleId: number) {
  return query<DbRow[]>(
    `SELECT id, status, occurrence_date, auto_approve, weight, weight_mode, signed_off_at, assignee_id
       FROM tasks WHERE recurring_task_id = ? ORDER BY occurrence_date`,
    [ruleId]
  );
}

async function skips(ruleId: number) {
  return query<DbRow[]>(
    `SELECT occurrence_date, reason, moved_to FROM recurring_skips WHERE recurring_task_id = ? ORDER BY occurrence_date`,
    [ruleId]
  );
}

beforeAll(async () => {
  admin = await createUser("RecAdmin", "admin");
  lead = await createUser("RecLead");
  doer = await createUser("RecDoer");
  helper = await createUser("RecHelper");
  projectId = await createLedProject(lead, "Recurring project");
  for (const u of [doer, helper]) {
    await query(`INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'member')`, [projectId, u.id]);
  }
  // One ordinary task, done: the project is at 100%.
  await query(
    `INSERT INTO tasks (project_id, title, status, assignee_id, created_by, completed_at) VALUES (?, 'Real work', 'done', ?, ?, UTC_TIMESTAMP())`,
    [projectId, doer.id, lead.id]
  );
});

describe("a member's proposal", () => {
  let ruleId: number;

  it("waits for an admin, who is told; nothing is made yet", async () => {
    ruleId = await createRule(
      doer,
      input({ subtasks: [{ title: "Count the shelves", assigneeId: helper.id }, { title: "Update the sheet", assigneeId: doer.id }] }),
      at("2027-03-01")
    );
    const [r] = await query<DbRow[]>(`SELECT approval_status, review_mode FROM recurring_tasks WHERE id = ?`, [ruleId]);
    expect(r).toMatchObject({ approval_status: "pending", review_mode: null });
    expect(await copies(ruleId)).toHaveLength(0);
    const [note] = await query<DbRow[]>(`SELECT link FROM notifications WHERE user_id = ? AND type = 'recurring_request' ORDER BY id DESC LIMIT 1`, [admin.id]);
    expect(note.link).toBe(`/recurring?rule=${ruleId}`);
  });

  it("can only be approved by an admin, and turning it down needs a reason", async () => {
    await expect(actOnRule(lead, ruleId, { action: "approve", reviewMode: "review" })).rejects.toMatchObject({ status: 403 });
    await expect(actOnRule(admin, ruleId, { action: "reject", note: " " })).rejects.toMatchObject({ status: 400 });
  });

  it("once approved with no review needed, makes today's copy with its subtasks, weighted 0", async () => {
    await actOnRule(admin, ruleId, { action: "approve", reviewMode: "none" }, at("2027-03-01"));
    const [copy] = await copies(ruleId);
    expect(copy).toMatchObject({ status: "todo", occurrence_date: "2027-03-01", auto_approve: 1, weight_mode: "manual", assignee_id: doer.id });
    expect(Number(copy.weight)).toBe(0);
    const subs = await query<DbRow[]>(`SELECT title, assignee_id FROM subtasks WHERE task_id = ? ORDER BY position`, [copy.id]);
    expect(subs.map((s) => ({ ...s }))).toEqual([
      { title: "Count the shelves", assignee_id: helper.id },
      { title: "Update the sheet", assignee_id: doer.id },
    ]);
  });

  it("finishes and signs off a routine copy as soon as its work is complete", async () => {
    const [copy] = await copies(ruleId);
    const subs = await query<DbRow[]>(`SELECT id, assignee_id FROM subtasks WHERE task_id = ? ORDER BY position`, [copy.id]);
    expect(await applySubtaskAction(helper, subs[0].id, "submit")).toBe("done");
    await applySubtaskAction(doer, subs[1].id, "submit");
    const [after] = await copies(ruleId);
    expect(after.status).toBe("done");
    expect(after.signed_off_at).not.toBeNull();
  });

  it("doesn't move the project's progress bar", async () => {
    const [p] = await query<DbRow[]>(`SELECT ${PROJECT_UNITS_SQL} AS units, ${PROJECT_CREDITED_SQL} AS credited FROM projects p WHERE p.id = ?`, [projectId]);
    expect(projectPercent({ units: Number(p.units), credited: Number(p.credited) })).toBe(100);
  });
});

describe("copies over time", () => {
  it("make no new copy while the last one is still open, and say so", async () => {
    const id = await createRule(admin, input({ title: "Open check", reviewMode: "review" }), at("2027-03-01"));
    await runRecurringTasks({ now: at("2027-03-02"), ruleIds: [id] });
    expect((await copies(id)).map((c) => c.occurrence_date)).toEqual(["2027-03-01"]);
    expect((await skips(id)).map((s) => ({ ...s }))).toEqual([{ occurrence_date: "2027-03-02", reason: "still_open", moved_to: null }]);
    const [note] = await query<DbRow[]>(`SELECT message FROM notifications WHERE user_id = ? AND type = 'recurring_skipped' ORDER BY id DESC LIMIT 1`, [doer.id]);
    expect(note.message).toMatch(/still open/);

    // Set to make them anyway: the next date gets its copy.
    await updateRule(admin, id, input({ title: "Open check", reviewMode: "review", whenOpen: "create" }), at("2027-03-03"));
    expect((await copies(id)).map((c) => c.occurrence_date)).toEqual(["2027-03-01", "2027-03-03"]);
  });

  it("moves a weekly copy off a holiday to the next working day", async () => {
    holidays.dates = ["2027-03-08"];
    try {
      const id = await createRule(admin, input({ title: "Monday report", frequency: "weekly", weekdays: ["Mon"], reviewMode: "review", startDate: "2027-03-08" }), at("2027-03-02"));
      await runRecurringTasks({ now: at("2027-03-08"), ruleIds: [id] });
      expect(await copies(id)).toHaveLength(0);
      await runRecurringTasks({ now: at("2027-03-09"), ruleIds: [id] });
      expect((await copies(id)).map((c) => c.occurrence_date)).toEqual(["2027-03-09"]);
      expect((await skips(id)).map((s) => ({ ...s }))).toEqual([{ occurrence_date: "2027-03-08", reason: "holiday", moved_to: "2027-03-09" }]);
    } finally {
      holidays.dates = [];
    }
  });

  it("skips Sundays on a daily rule without counting them as news", async () => {
    const id = await createRule(admin, input({ title: "Weekend check", reviewMode: "none", whenOpen: "create", startDate: "2027-03-06" }), at("2027-03-06"));
    await runRecurringTasks({ now: at("2027-03-07"), ruleIds: [id] });
    await runRecurringTasks({ now: at("2027-03-08"), ruleIds: [id] });
    expect((await copies(id)).map((c) => c.occurrence_date)).toEqual(["2027-03-06", "2027-03-08"]);
    expect(await skips(id)).toHaveLength(0);
  });

  it("after downtime makes only the latest copy and records the rest as missed", async () => {
    const id = await createRule(admin, input({ title: "Downtime check", reviewMode: "review" }), at("2027-03-01"));
    await query(`UPDATE tasks SET status = 'done' WHERE recurring_task_id = ?`, [id]);
    await runRecurringTasks({ now: at("2027-03-05"), ruleIds: [id] });
    expect((await copies(id)).map((c) => c.occurrence_date)).toEqual(["2027-03-01", "2027-03-05"]);
    expect((await skips(id)).map((s) => `${s.occurrence_date} ${s.reason}`)).toEqual([
      "2027-03-02 missed",
      "2027-03-03 missed",
      "2027-03-04 missed",
    ]);
    // Running again the same day changes nothing.
    await runRecurringTasks({ now: at("2027-03-05"), ruleIds: [id] });
    expect(await copies(id)).toHaveLength(2);
  });

  it("can skip its next copy, and pauses when its owner leaves", async () => {
    const leaver = await createUser("RecLeaver");
    await query(`INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'member')`, [projectId, leaver.id]);
    const id = await createRule(admin, input({ title: "Skip check", ownerId: leaver.id, reviewMode: "none", whenOpen: "create" }), at("2027-03-01"));
    await actOnRule(admin, id, { action: "skip_next" }, at("2027-03-01"));
    await runRecurringTasks({ now: at("2027-03-02"), ruleIds: [id] });
    expect((await copies(id)).map((c) => c.occurrence_date)).toEqual(["2027-03-01"]);

    await query(`UPDATE users SET is_active = 0 WHERE id = ?`, [leaver.id]);
    await runRecurringTasks({ now: at("2027-03-03"), ruleIds: [id] });
    const [r] = await query<DbRow[]>(`SELECT is_active, paused_reason FROM recurring_tasks WHERE id = ?`, [id]);
    expect(r).toMatchObject({ is_active: 0, paused_reason: "RecLeaver has left" });
    expect(await copies(id)).toHaveLength(1);
  });
});

describe("a project of its own", () => {
  it("is created, with its people on it, when the proposal is approved", async () => {
    const id = await createRule(
      doer,
      input({ projectId: null, newProjectName: "Accounts — routine filings", title: "GST filing", frequency: "monthly", monthDay: 0, subtasks: [{ title: "Collect invoices", assigneeId: helper.id }] }),
      at("2027-03-01")
    );
    await actOnRule(admin, id, { action: "approve", reviewMode: "review" }, at("2027-03-01"));
    const [r] = await query<DbRow[]>(`SELECT project_id, new_project_name FROM recurring_tasks WHERE id = ?`, [id]);
    expect(r.new_project_name).toBeNull();
    const [p] = await query<DbRow[]>(`SELECT name, approval_status, owner_id FROM projects WHERE id = ?`, [r.project_id]);
    expect(p).toMatchObject({ name: "Accounts — routine filings", approval_status: "approved", owner_id: doer.id });
    const members = await query<DbRow[]>(`SELECT user_id FROM project_members WHERE project_id = ? ORDER BY user_id`, [r.project_id]);
    expect(members.map((m) => m.user_id).sort()).toEqual([doer.id, helper.id].sort());
    await runRecurringTasks({ now: at("2027-03-31"), ruleIds: [id] });
    expect((await copies(id)).map((c) => c.occurrence_date)).toEqual(["2027-03-31"]);
  });

  it("reads as Ongoing: judged on copies done on time, never ready to close", async () => {
    const [r] = await query<DbRow[]>(`SELECT project_id FROM recurring_tasks WHERE title = 'GST filing'`);
    // The March copy, done and signed off on time; an earlier one done late.
    await query(
      `UPDATE tasks SET status = 'done', completed_at = '2027-03-31 06:00:00', signed_off_at = '2027-03-31 06:00:00'
        WHERE project_id = ? AND occurrence_date = '2027-03-31'`,
      [r.project_id]
    );
    await query(
      `INSERT INTO tasks (project_id, title, status, assignee_id, created_by, recurring_task_id, occurrence_date, due_date, completed_at, signed_off_at, weight, weight_mode)
       SELECT ?, 'GST filing', 'done', ?, ?, id, '2027-02-28', '2027-02-28', '2027-03-03 06:00:00', '2027-03-03 06:00:00', 0, 'manual'
         FROM recurring_tasks WHERE title = 'GST filing'`,
      [r.project_id, doer.id, doer.id]
    );
    const rows = await getProjectProgressRows(admin);
    expect(rows.find((x) => x.id === r.project_id)?.ongoing).toEqual({ done: 2, onTime: 1 });
    // The ordinary project with recurring copies in it is not ongoing.
    expect(rows.find((x) => x.id === projectId)?.ongoing).toBeNull();

    const work = await getMyWork(doer);
    expect(work.ownedProjects.find((p) => p.id === r.project_id)).toMatchObject({ ready_to_close: false, ongoing: { done: 2, onTime: 1 } });
  });
});

describe("the API", () => {
  it("lists what a member can see, marking what comes to them", async () => {
    actAs(helper);
    const res = await call<{ rules: { title: string; mine: boolean; schedule: string }[] }>(recurringRoute.GET, { path: "/" });
    expect(res.status).toBe(200);
    const stock = res.body.rules.find((r) => r.title === "Daily stock check");
    expect(stock).toMatchObject({ mine: true, schedule: "Every working day" });
  });

  it("refuses a project the person isn't on", async () => {
    const outsider = await createUser("RecOutsider");
    actAs(outsider);
    const res = await call(recurringRoute.POST, { method: "POST", body: { ...input(), ownerId: outsider.id } });
    expect({ status: res.status, body: res.body }).toMatchObject({ status: 403 });
  });
});
