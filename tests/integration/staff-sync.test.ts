import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, DbRow } from "@/lib/db";
import type { User } from "@/lib/types";
import { listRetired, planStaffSync, looksLikeBadRoster, syncStaffWithAttendance, type RosterEntry } from "@/lib/staff-sync";
import { getTeamPerformance } from "@/lib/performance";
import { createLedProject, createUser } from "./helpers";

/**
 * People who leave Attendance are retired in PM: off the lists of current
 * staff, kept with their history, and back if Attendance takes them back.
 */
describe("planning the sweep", () => {
  const person = (id: number, active: boolean, retired_at: string | null = null) => ({
    id,
    employee_id: 1000 + id,
    name: `P${id}`,
    is_active: active,
    retired_at,
  });

  it("retires whoever Attendance dropped or switched off, and restores whoever came back", () => {
    const changes = planStaffSync(
      [person(1, true), person(2, true), person(3, true), person(4, false, "2026-10-01")],
      [
        { id: 1001, is_active: 1 },
        { id: 1003, is_active: 0 },
        { id: 1004, is_active: 1 },
      ]
    );
    expect(changes).toEqual([
      { userId: 2, name: "P2", change: "retire", reason: "removed" },
      { userId: 3, name: "P3", change: "retire", reason: "deactivated" },
      { userId: 4, name: "P4", change: "return", reason: null },
    ]);
  });

  it("leaves people who are already retired alone", () => {
    expect(planStaffSync([person(5, false, "2026-10-01")], [])).toEqual([]);
  });

  it("holds a change that would retire most of the company", () => {
    expect(looksLikeBadRoster(3, 4)).toBe(false); // a handful is believable
    expect(looksLikeBadRoster(30, 40)).toBe(true);
    expect(looksLikeBadRoster(6, 40)).toBe(false);
  });
});

describe("the sweep against the database", () => {
  let admin: User;
  let stays: User;
  let leaves: User;
  const crowd: User[] = [];
  /** Only this file's people: other files create users while this runs. */
  const mine = () => [admin, stays, leaves, ...crowd].map((u) => u.id);

  /** Attendance listing these people as working (and nobody else). */
  async function rosterOf(working: User[]): Promise<RosterEntry[]> {
    if (!working.length) return [];
    const rows = await query<DbRow[]>(
      `SELECT employee_id FROM users WHERE id IN (${working.map(() => "?").join(", ")})`,
      working.map((u) => u.id)
    );
    return rows.map((r) => ({ id: Number(r.employee_id), is_active: 1 }));
  }

  beforeAll(async () => {
    admin = await createUser("SweepAdmin", "admin");
    stays = await createUser("SweepStays");
    leaves = await createUser("SweepLeaves");
    const project = await createLedProject(admin, "Sweep project");
    await query(`INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'member')`, [project, leaves.id]);
    await query(
      `INSERT INTO tasks (project_id, title, status, assignee_id, created_by) VALUES (?, 'Left behind', 'todo', ?, ?)`,
      [project, leaves.id, admin.id]
    );
  });

  afterAll(async () => {
    // Leave everyone as other files expect them.
    await query(
      `UPDATE users SET is_active = 1, retired_at = NULL, retired_reason = NULL WHERE id IN (${mine().map(() => "?").join(", ")})`,
      mine()
    );
  });

  it("retires someone Attendance no longer has, and keeps their work", async () => {
    const res = await syncStaffWithAttendance({ roster: () => rosterOf([admin, stays]), only: mine() });
    expect(res.held).toBeNull();
    expect(res.retired.map((c) => c.userId)).toEqual([leaves.id]);

    const [row] = await query<DbRow[]>(`SELECT is_active, retired_at, retired_reason FROM users WHERE id = ?`, [leaves.id]);
    expect(Number(row.is_active)).toBe(0);
    expect(row.retired_at).toBeTruthy();
    expect(row.retired_reason).toBe("removed");

    const retired = (await listRetired()).find((p) => p.id === leaves.id);
    expect(retired?.open_tasks).toBe(1);

    const { members } = await getTeamPerformance(admin);
    expect(members.some((m) => m.id === leaves.id)).toBe(false);
    expect(members.some((m) => m.id === stays.id)).toBe(true);
  });

  it("does nothing on a second run", async () => {
    const res = await syncStaffWithAttendance({ roster: () => rosterOf([admin, stays]), only: mine() });
    expect(res.retired).toEqual([]);
    expect(res.returned).toEqual([]);
  });

  it("refuses an empty or unreachable Attendance", async () => {
    expect((await syncStaffWithAttendance({ roster: async () => [], only: mine() })).held).toMatch(/no employees/);
    const down = await syncStaffWithAttendance({
      roster: async () => {
        throw new Error("ECONNREFUSED");
      },
      only: mine(),
    });
    expect(down.held).toMatch(/could not be reached/);
    const [row] = await query<DbRow[]>(`SELECT is_active FROM users WHERE id = ?`, [stays.id]);
    expect(Number(row.is_active)).toBe(1);
  });

  it("holds a roster that would retire nearly everyone, unless an admin confirms", async () => {
    // Enough people that losing all but one cannot be a handful of leavers.
    for (let i = 0; i < 8; i++) crowd.push(await createUser(`SweepCrowd${i}`));
    const held = await syncStaffWithAttendance({ roster: () => rosterOf([stays]), only: mine() });
    expect(held.held).toMatch(/would retire/);
    const [row] = await query<DbRow[]>(`SELECT is_active FROM users WHERE id = ?`, [crowd[0].id]);
    expect(Number(row.is_active)).toBe(1);

    const forced = await syncStaffWithAttendance({ roster: () => rosterOf([stays]), only: crowd.map((u) => u.id), force: true });
    expect(forced.retired).toHaveLength(8);
  });

  it("brings people back when Attendance does", async () => {
    const res = await syncStaffWithAttendance({ roster: () => rosterOf([admin, stays, leaves, ...crowd]), only: mine() });
    expect(res.returned.map((c) => c.userId)).toContain(leaves.id);
    const [row] = await query<DbRow[]>(`SELECT is_active, retired_at FROM users WHERE id = ?`, [leaves.id]);
    expect(Number(row.is_active)).toBe(1);
    expect(row.retired_at).toBeNull();
  });
});
