import { beforeAll, describe, expect, it } from "vitest";
import { query, DbResult } from "@/lib/db";
import type { User } from "@/lib/types";
import { createLedProject, createUser } from "./helpers";
import { getAdminOverview } from "@/lib/admin-overview";

/**
 * The Control centre's figures: the portfolio worst-first, what waits on a
 * decision, whose reviews are piling up, who has nothing to do, and which
 * records need fixing.
 */
describe("the admin's control centre", () => {
  let admin: User, lead: User, busy: User, idle: User;
  let behind: number, healthy: number;
  const today = "2026-10-29";

  beforeAll(async () => {
    admin = await createUser("CcAdmin", "admin");
    lead = await createUser("CcLead");
    busy = await createUser("CcBusy");
    idle = await createUser("CcIdle");
    await query(`UPDATE users SET department = 'ADMIN001' WHERE id = ?`, [busy.id]);
    await query(`UPDATE users SET department = NULL WHERE id = ?`, [idle.id]);

    // Half its time gone, nothing approved: off track.
    behind = await createLedProject(lead, "Cc behind");
    await query(`UPDATE projects SET start_date = '2026-10-01', due_date = '2026-11-26' WHERE id = ?`, [behind]);
    // No dates and no owner: a record to fix.
    healthy = await createLedProject(lead, "Cc undated");
    await query(`UPDATE projects SET owner_id = NULL WHERE id = ?`, [healthy]);

    const t = (await query<DbResult>(
      `INSERT INTO tasks (project_id, title, task_type, assignee_id, status, due_date)
       VALUES (?, 'Cc wiring', 'general', ?, 'in_progress', '2026-10-20')`,
      [behind, lead.id]
    )) as unknown as DbResult;
    await query(
      `INSERT INTO subtasks (task_id, title, position, assignee_id, status, submitted_at)
       VALUES (?, 'Cc run cable', 0, ?, 'review', '2026-10-25 09:00:00'),
              (?, 'Cc fit panel', 1, ?, 'todo', NULL)`,
      [t.insertId, busy.id, t.insertId, busy.id]
    );
    await query(
      `INSERT INTO tasks (project_id, title, task_type, status) VALUES (?, 'Cc nobody owns this', 'general', 'todo')`,
      [healthy]
    );
    await query(`INSERT INTO projects (name, status, approval_status) VALUES ('Cc asked for', 'active', 'pending')`);
  });

  it("puts the project behind schedule first", async () => {
    const o = await getAdminOverview(admin, today);
    const mine = o.portfolio.filter((p) => p.name.startsWith("Cc "));
    expect(mine[0]).toMatchObject({ name: "Cc behind", health: "off_track", overdue_count: 1 });
    expect(mine.map((p) => p.name)).toContain("Cc undated");
    expect(o.portfolio.find((p) => p.name === "Cc undated")?.health).toBe("no_dates");
  });

  it("counts what waits on a decision", async () => {
    const o = await getAdminOverview(admin, today);
    expect(o.decisions.projectRequests).toBeGreaterThanOrEqual(1);
    expect(o.decisions.finishedSubtasks).toBeGreaterThanOrEqual(1);
  });

  it("names whose review the finished work is waiting on", async () => {
    const o = await getAdminOverview(admin, today);
    // The subtask waits on its task's owner.
    expect(o.reviewers.find((r) => r.reviewer_id === lead.id)?.waiting).toBeGreaterThanOrEqual(1);
  });

  it("shows who is busy and who has nothing open, leaving admins out", async () => {
    const o = await getAdminOverview(admin, today);
    expect(o.people.find((p) => p.id === busy.id)).toMatchObject({ open_items: 1, overdue: 0 });
    expect(o.idle.map((p) => p.id)).toContain(idle.id);
    expect([...o.people, ...o.idle].map((p) => p.id)).not.toContain(admin.id);
  });

  it("lists the records worth fixing", async () => {
    const o = await getAdminOverview(admin, today);
    const issue = (key: string) => o.dataIssues.find((i) => i.key === key)!;
    // Other tests leave people without one too; only a few are named.
    expect(issue("no-department").count).toBeGreaterThanOrEqual(1);
    expect(issue("odd-department").examples.join()).toContain("ADMIN001");
    expect(issue("project-no-due").examples).toContain("Cc undated");
    expect(issue("project-no-owner").examples).toContain("Cc undated");
    expect(issue("task-no-owner").count).toBeGreaterThanOrEqual(1);
  });
});
