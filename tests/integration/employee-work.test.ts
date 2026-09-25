import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { query, DbRow, DbResult } from "@/lib/db";
import type { User } from "@/lib/types";
import { actAs, call, createLedProject, createUser } from "./helpers";

import * as employeeWork from "@/app/api/integrations/employee-work/route";

/**
 * The endpoint the Attendance app calls to show someone their PM work on the
 * screen they already open every morning.
 */

const KEY = "test-integration-key";
type Json = Record<string, unknown>;

let sam: User, empId: string, projectId: number;

beforeAll(async () => {
  sam = await createUser("Ewsam");
  const [row] = await query<DbRow[]>(`SELECT emp_id FROM users WHERE id = ?`, [sam.id]);
  empId = String(row.emp_id);
  projectId = await createLedProject(sam, "Employee work project");

  const mk = async (title: string, due: string | null, status = "todo") =>
    ((await query<DbResult>(
      `INSERT INTO tasks (project_id, title, assignee_id, created_by, requested_by,
                          request_approved_by, due_date, status, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'high')`,
      [projectId, title, sam.id, sam.id, sam.id, sam.id, due, status]
    )) as unknown as DbResult).insertId;

  const todayIst = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() + 330 * 60_000 - 86_400_000).toISOString().slice(0, 10);
  await mk("Due today", todayIst);
  await mk("Overdue already", yesterday);
  await mk("No deadline", null);
  const done = await mk("Finished", todayIst, "done");
  await query(`UPDATE tasks SET signed_off_at = UTC_TIMESTAMP() WHERE id = ?`, [done]);

  // Time logged today, and some logged long ago that must not count.
  const [open] = await query<DbRow[]>(
    `SELECT id FROM tasks WHERE project_id = ? AND title = 'Due today'`,
    [projectId]
  );
  await query(
    `INSERT INTO task_time_logs (task_id, user_id, minutes, logged_at)
     VALUES (?, ?, 90, UTC_TIMESTAMP()), (?, ?, 300, UTC_TIMESTAMP() - INTERVAL 30 DAY)`,
    [open.id, sam.id, open.id, sam.id]
  );
});

afterEach(() => vi.unstubAllEnvs());

const get = (key: string | null, qs = `empId=${encodeURIComponent(empId)}`) =>
  call<Json>(employeeWork.GET, {
    path: `/api/integrations/employee-work?${qs}`,
    headers: key === null ? {} : { "x-integration-key": key },
  });

describe("the Attendance app asking what someone has on", () => {
  it("refuses without the shared key", async () => {
    vi.stubEnv("INTEGRATION_API_KEY", KEY);
    expect((await get(null)).status).toBe(401);
    expect((await get("wrong-key")).status).toBe(401);
    // A key of a different length must be refused, not crash the comparison.
    expect((await get("short")).status).toBe(401);
  });

  it("says so when no key is configured, rather than letting anyone in", async () => {
    vi.stubEnv("INTEGRATION_API_KEY", "");
    const res = await get(KEY);
    expect(res.status).toBe(503);
  });

  it("returns the open work, soonest deadline first", async () => {
    vi.stubEnv("INTEGRATION_API_KEY", KEY);
    const { status, body } = await get(KEY);
    expect(status).toBe(200);
    expect(body.known).toBe(true);

    const titles = (body.tasks as { title: string }[]).map((t) => t.title);
    // Signed-off work is not something anyone can act on today.
    expect(titles).not.toContain("Finished");
    expect(titles).toEqual(["Overdue already", "Due today", "No deadline"]);

    expect(body.openCount).toBe(3);
    expect(body.dueTodayCount).toBe(1);
    expect(body.overdueCount).toBe(1);
    expect((body.tasks as { overdue: boolean }[])[0].overdue).toBe(true);
  });

  it("counts only today's logged time", async () => {
    vi.stubEnv("INTEGRATION_API_KEY", KEY);
    const { body } = await get(KEY);
    expect(body.loggedTodayMinutes).toBe(90); // not the 300 logged a month ago
  });

  it("answers quietly for an employee who has never opened PM", async () => {
    vi.stubEnv("INTEGRATION_API_KEY", KEY);
    const { status, body } = await get(KEY, "empId=NOBODY123");
    // Not an error: the Attendance app should show nothing, not a failure.
    expect(status).toBe(200);
    expect(body.known).toBe(false);
    expect(body.tasks).toEqual([]);
    expect(body.openCount).toBe(0);
  });

  it("needs an employee to ask about", async () => {
    vi.stubEnv("INTEGRATION_API_KEY", KEY);
    expect((await get(KEY, "empId=")).status).toBe(400);
  });

  it("never needs a signed-in user", async () => {
    // It is called by a server, not a person: no session is set here at all.
    actAs(null as unknown as User);
    vi.stubEnv("INTEGRATION_API_KEY", KEY);
    expect((await get(KEY)).status).toBe(200);
  });
});
