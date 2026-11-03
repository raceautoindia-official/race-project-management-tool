import { beforeAll, describe, expect, it, vi } from "vitest";
import { query, DbResult, DbRow } from "@/lib/db";
import type { User } from "@/lib/types";
import type { ClockRow } from "@/lib/attendance-clock";
import { actAs, call, createLedProject, createUser } from "./helpers";

/**
 * The work timer only runs while someone is clocked in on the Attendance
 * app, stops at the clock-out time, and logs its minutes against the task
 * and subtask. Attendance is stood in for here: each test sets who is
 * clocked in.
 */

const clock = new Map<number, ClockRow[]>();
let attendanceDown = false;

vi.mock("@/lib/attendance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attendance")>()),
  fetchClockRows: vi.fn(async (ids: number[], from: string) => {
    if (attendanceDown) throw new Error("ECONNREFUSED");
    return ids.flatMap((id) => clock.get(id) ?? []).filter((r) => r.work_date >= from);
  }),
}));

import * as timerRoute from "@/app/api/work/timer/route";
import * as timeRoute from "@/app/api/tasks/[id]/time/route";
import * as timeLogs from "@/app/api/tasks/[id]/time-logs/route";
import { applySubtaskAction } from "@/lib/subtask-actions";
import { reconcileTimers, startWork } from "@/lib/work-timer";
import { istDay } from "@/lib/work-timer";
import { myItemTimes } from "@/lib/time-data";

const sql = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

let lead: User;
let doer: User;
let stranger: User;
let admin: User;
let taskId: number;
let sub1: number;
let sub2: number;
const emp = new Map<number, number>();

/** Clock this person in at `inAt` (and out at `outAt`, if given). */
function clockIn(user: User, inAt: Date, outAt: Date | null = null, banked = 0) {
  clock.set(emp.get(user.id)!, [
    {
      employee_id: emp.get(user.id)!,
      work_date: istDay(inAt),
      first_clock_in_utc: sql(inAt),
      clock_in_utc: sql(inAt),
      clock_out_utc: outAt ? sql(outAt) : null,
      total_minutes: outAt ? Math.round((outAt.getTime() - inAt.getTime()) / 60_000) + banked : null,
      banked_minutes: banked,
      session_count: 1,
      status: "present",
    },
  ]);
}

async function startViaRoute(user: User, body: Record<string, unknown>) {
  actAs(user);
  return call<{ running: { subtaskId: number | null } | null; error?: string }>(timerRoute.POST, {
    method: "POST",
    body: { action: "start", ...body },
  });
}

async function openSession(userId: number) {
  const [row] = await query<DbRow[]>(`SELECT * FROM work_sessions WHERE user_id = ? AND ended_at IS NULL`, [userId]);
  return row;
}

beforeAll(async () => {
  lead = await createUser("TimerLead");
  doer = await createUser("TimerDoer");
  stranger = await createUser("TimerStranger");
  admin = await createUser("TimerAdmin", "admin");
  for (const u of [lead, doer, stranger, admin]) {
    const [r] = await query<DbRow[]>(`SELECT employee_id FROM users WHERE id = ?`, [u.id]);
    emp.set(u.id, Number(r.employee_id));
  }
  const projectId = await createLedProject(lead, "Timer project");
  for (const u of [doer, stranger]) {
    await query(`INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'member')`, [projectId, u.id]);
  }
  const t = (await query<DbResult>(
    `INSERT INTO tasks (project_id, title, status, assignee_id, created_by, estimated_hours) VALUES (?, 'Timed task', 'todo', ?, ?, 2)`,
    [projectId, lead.id, lead.id]
  )) as unknown as DbResult;
  taskId = t.insertId;
  const s1 = (await query<DbResult>(
    `INSERT INTO subtasks (task_id, title, assignee_id, status, created_by) VALUES (?, 'First part', ?, 'todo', ?)`,
    [taskId, doer.id, lead.id]
  )) as unknown as DbResult;
  const s2 = (await query<DbResult>(
    `INSERT INTO subtasks (task_id, title, assignee_id, status, created_by) VALUES (?, 'Second part', ?, 'todo', ?)`,
    [taskId, doer.id, lead.id]
  )) as unknown as DbResult;
  sub1 = s1.insertId;
  sub2 = s2.insertId;
});

describe("starting work", () => {
  it("is refused when the person is not clocked in on Attendance", async () => {
    const res = await startViaRoute(doer, { subtaskId: sub1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not clocked in/i);
    expect(await openSession(doer.id)).toBeUndefined();
  });

  it("is refused when Attendance can't be reached", async () => {
    attendanceDown = true;
    try {
      const res = await startViaRoute(doer, { subtaskId: sub1 });
      expect(res.status).toBe(503);
    } finally {
      attendanceDown = false;
    }
  });

  it("runs the timer when clocked in, and moves the subtask and task to In progress", async () => {
    clockIn(doer, minutesAgo(120));
    const res = await startViaRoute(doer, { subtaskId: sub1 });
    expect(res.status).toBe(200);
    expect(res.body.running?.subtaskId).toBe(sub1);
    const [s] = await query<DbRow[]>(`SELECT status FROM subtasks WHERE id = ?`, [sub1]);
    const [t] = await query<DbRow[]>(`SELECT status FROM tasks WHERE id = ?`, [taskId]);
    expect(s.status).toBe("in_progress");
    expect(t.status).toBe("in_progress");
  });

  it("is refused to someone the subtask isn't theirs to work on", async () => {
    clockIn(stranger, minutesAgo(60));
    const res = await startViaRoute(stranger, { subtaskId: sub2 });
    expect(res.status).toBe(403);
  });
});

describe("timing", () => {
  const base = minutesAgo(300); // clocked in five hours ago
  const t0 = new Date(base.getTime() + 10 * 60_000);
  const t1 = new Date(t0.getTime() + 25 * 60_000);
  const out = new Date(t1.getTime() + 40 * 60_000);

  it("starting other work stops the first timer and logs its minutes against the subtask", async () => {
    await query(`DELETE FROM work_sessions WHERE user_id = ?`, [doer.id]);
    await query(`DELETE FROM task_time_logs WHERE task_id = ?`, [taskId]);
    clockIn(doer, base);
    await startWork(doer, { taskId, subtaskId: sub1 }, t0);
    await startWork(doer, { taskId, subtaskId: sub2 }, t1);

    const logs = await query<DbRow[]>(
      `SELECT minutes, source, subtask_id FROM task_time_logs WHERE task_id = ? ORDER BY id`,
      [taskId]
    );
    expect(logs.map((l) => ({ ...l }))).toEqual([{ minutes: 25, source: "timer", subtask_id: sub1 }]);
    const [first] = await query<DbRow[]>(
      `SELECT end_reason FROM work_sessions WHERE user_id = ? AND subtask_id = ?`,
      [doer.id, sub1]
    );
    expect(first.end_reason).toBe("switched");
  });

  it("clocking out on Attendance stops the timer at the clock-out time and tells them", async () => {
    clockIn(doer, base, out);
    const res = await reconcileTimers({ userIds: [doer.id] });
    expect(res.stopped).toEqual([expect.objectContaining({ userId: doer.id, reason: "clocked_out", minutes: 40 })]);
    expect(await openSession(doer.id)).toBeUndefined();

    const [{ spent }] = await query<DbRow[]>(`SELECT spent_hours AS spent FROM tasks WHERE id = ?`, [taskId]);
    expect(Number(spent)).toBeCloseTo(65 / 60, 2);
    const [note] = await query<DbRow[]>(
      `SELECT message FROM notifications WHERE user_id = ? AND type = 'work_paused' ORDER BY id DESC LIMIT 1`,
      [doer.id]
    );
    expect(note.message).toMatch(/clocked out/);
  });

  it("can't be started again until they clock back in", async () => {
    const res = await startViaRoute(doer, { subtaskId: sub2 });
    expect(res.status).toBe(409);
  });

  it("shows where the task's time went", async () => {
    actAs(lead);
    const res = await call<{
      timerMinutes: number;
      manualMinutes: number;
      estimateMinutes: number;
      bySubtask: { id: number; minutes: number }[];
    }>(timeRoute.GET, { id: taskId });
    expect(res.status).toBe(200);
    expect(res.body.timerMinutes).toBe(65);
    expect(res.body.manualMinutes).toBe(0);
    expect(res.body.estimateMinutes).toBe(120);
    expect(res.body.bySubtask.find((s) => s.id === sub1)?.minutes).toBe(25);
    expect(res.body.bySubtask.find((s) => s.id === sub2)?.minutes).toBe(40);
  });

  it("gives My Work each item's time and why it was last paused", async () => {
    const times = await myItemTimes(doer.id);
    expect(times[`s${sub1}`]).toMatchObject({ totalMinutes: 25, lastEndReason: "switched" });
    expect(times[`s${sub2}`]).toMatchObject({ totalMinutes: 40, lastEndReason: "clocked_out" });
  });
});

describe("finishing and correcting", () => {
  it("sending a subtask for review stops its timer", async () => {
    clockIn(doer, minutesAgo(30), minutesAgo(400));
    // The old clock-out is from before this clock-in: they're clocked in again.
    clock.get(emp.get(doer.id)!)![0].clock_out_utc = sql(minutesAgo(400));
    const res = await startViaRoute(doer, { subtaskId: sub1 });
    expect(res.status).toBe(200);
    await applySubtaskAction(doer, sub1, "submit");
    expect(await openSession(doer.id)).toBeUndefined();
    const [last] = await query<DbRow[]>(
      `SELECT end_reason FROM work_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [doer.id]
    );
    expect(last.end_reason).toBe("finished");
  });

  it("only an admin can remove time the timer logged", async () => {
    const [log] = await query<DbRow[]>(
      `SELECT id FROM task_time_logs WHERE task_id = ? AND source = 'timer' ORDER BY id LIMIT 1`,
      [taskId]
    );
    actAs(doer);
    const refused = await call(timeLogs.DELETE, { method: "DELETE", id: taskId, path: `/?logId=${log.id}` });
    expect(refused.status).toBe(403);
    actAs(admin);
    const removed = await call(timeLogs.DELETE, { method: "DELETE", id: taskId, path: `/?logId=${log.id}` });
    expect(removed.status).toBe(200);
  });
});
