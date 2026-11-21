import { beforeAll, describe, expect, it } from "vitest";
import { query, DbRow, DbResult } from "@/lib/db";
import type { User } from "@/lib/types";
import { actAs, call, createLedProject, createUser } from "./helpers";

import * as projects from "@/app/api/projects/route";
import * as decision from "@/app/api/projects/[id]/decision/route";
import * as members from "@/app/api/projects/[id]/members/route";
import * as project from "@/app/api/projects/[id]/route";
import { getMyWork } from "@/lib/my-work";
import { dailySummary } from "@/lib/daily-summary";
import { weekSummary } from "@/lib/week-summary";
import { applySubtaskAction } from "@/lib/subtask-actions";
import { istDate } from "@/lib/recurring";

/**
 * The fixes of 21 Nov 2026: an admin staffs a project while approving it;
 * sign-offs reach everyone who can do them; subtask work shows in the daily
 * and weekly summaries.
 */

let admin: User;
let lead: User;
let asker: User;
let extra: User;
let doer: User;

beforeAll(async () => {
  admin = await createUser("NovAdmin", "admin");
  lead = await createUser("NovLead");
  asker = await createUser("NovAsker");
  extra = await createUser("NovExtra");
  doer = await createUser("NovDoer");
  // "lead" must already lead something to be nominated on a request.
  await createLedProject(lead, "Nov existing");
});

describe("approving a project request", () => {
  let projectId: number;

  it("lets the admin name the lead (the requester, here) and add members in the same step", async () => {
    actAs(asker);
    const made = await call<{ project: { id: number } }>(projects.POST, {
      method: "POST",
      body: { name: "Nov requested project", leadId: lead.id },
    });
    expect(made.status).toBe(201);
    projectId = made.body.project.id;

    actAs(admin);
    const res = await call<{ project: { owner_id: number; approval_status: string } }>(decision.POST, {
      method: "POST",
      id: projectId,
      body: { decision: "approve", leadId: asker.id, memberIds: [extra.id] },
    });
    expect(res.status).toBe(200);
    expect(res.body.project).toMatchObject({ owner_id: asker.id, approval_status: "approved" });

    const members = await query<DbRow[]>(`SELECT user_id, role_in_project FROM project_members WHERE project_id = ?`, [projectId]);
    const role = Object.fromEntries(members.map((m) => [m.user_id, m.role_in_project]));
    expect(role[asker.id]).toBe("lead");
    // The lead nominated on the request stays on it, as a member.
    expect(role[lead.id]).toBe("member");
    expect(role[extra.id]).toBe("member");
    const [note] = await query<DbRow[]>(`SELECT message FROM notifications WHERE user_id = ? AND type = 'project_member_added'`, [extra.id]);
    expect(note.message).toMatch(/Nov requested project/);
  });

  it("keeps staffing to admins: a nominated lead approves as before, without it", async () => {
    actAs(asker);
    const made = await call<{ project: { id: number } }>(projects.POST, { method: "POST", body: { name: "Nov second", leadId: lead.id } });
    actAs(lead);
    const refused = await call(decision.POST, { method: "POST", id: made.body.project.id, body: { decision: "approve", leadId: lead.id } });
    expect(refused.status).toBe(403);
    const ok = await call(decision.POST, { method: "POST", id: made.body.project.id, body: { decision: "approve" } });
    expect(ok.status).toBe(200);
  });

  it("lets a lead change someone's role later, and hand the project to a new owner", async () => {
    const roleOf = async (id: number) =>
      (await query<DbRow[]>(`SELECT role_in_project FROM project_members WHERE project_id = ? AND user_id = ?`, [projectId, id]))[0]?.role_in_project;

    // A member can't; the owner can.
    actAs(extra);
    expect((await call(members.PATCH, { method: "PATCH", id: projectId, body: { userId: extra.id, roleInProject: "lead" } })).status).toBe(403);
    actAs(asker);
    expect((await call(members.PATCH, { method: "PATCH", id: projectId, body: { userId: extra.id, roleInProject: "lead" } })).status).toBe(200);
    expect(await roleOf(extra.id)).toBe("lead");
    const [note] = await query<DbRow[]>(`SELECT message FROM notifications WHERE user_id = ? AND type = 'project_role_changed'`, [extra.id]);
    expect(note.message).toMatch(/now a lead/);

    // The owner must stay a lead; someone not on the project can't be given a role.
    expect((await call(members.PATCH, { method: "PATCH", id: projectId, body: { userId: asker.id, roleInProject: "member" } })).status).toBe(400);
    expect((await call(members.PATCH, { method: "PATCH", id: projectId, body: { userId: doer.id, roleInProject: "lead" } })).status).toBe(404);

    // Back to a member, then the project changes hands and back.
    await call(members.PATCH, { method: "PATCH", id: projectId, body: { userId: extra.id, roleInProject: "member" } });
    expect(await roleOf(extra.id)).toBe("member");
    expect((await call(project.PATCH, { method: "PATCH", id: projectId, body: { ownerId: extra.id } })).status).toBe(200);
    const [p] = await query<DbRow[]>(`SELECT owner_id FROM projects WHERE id = ?`, [projectId]);
    expect(p.owner_id).toBe(extra.id);
    expect(await roleOf(extra.id)).toBe("lead");
    expect(await roleOf(asker.id)).toBe("lead");
    actAs(extra);
    await call(project.PATCH, { method: "PATCH", id: projectId, body: { ownerId: asker.id } });
  });

  it("asks everyone who can sign a task off — its project's lead, not only whoever requested it", async () => {
    // A done task the doer both requested and owns: they can't sign it off themselves.
    const t = (await query<DbResult>(
      `INSERT INTO tasks (project_id, title, status, assignee_id, created_by, requested_by, request_approved_by, completed_at)
       VALUES (?, 'Nov done task', 'done', ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [projectId, doer.id, doer.id, doer.id, asker.id]
    )) as unknown as DbResult;
    await query(`INSERT IGNORE INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'member')`, [projectId, doer.id]);

    const forLead = (await getMyWork(asker)).attention.filter((a) => a.kind === "signoff");
    expect(forLead.map((a) => a.id)).toContain(t.insertId);
    expect(forLead.find((a) => a.id === t.insertId)?.link).toBe(`/projects/${projectId}/tasks/${t.insertId}`);
    const forOwner = (await getMyWork(doer)).attention.filter((a) => a.kind === "signoff");
    expect(forOwner.map((a) => a.id)).not.toContain(t.insertId);
  });

  it("shows finished subtasks in the day's and week's summary", async () => {
    const task = (await query<DbResult>(
      `INSERT INTO tasks (project_id, title, status, assignee_id, created_by, due_date) VALUES (?, 'Nov parent', 'todo', ?, ?, CURRENT_DATE())`,
      [projectId, asker.id, asker.id]
    )) as unknown as DbResult;
    const sub = (await query<DbResult>(
      `INSERT INTO subtasks (task_id, title, assignee_id, status, created_by) VALUES (?, 'Nov piece of work', ?, 'todo', ?)`,
      [task.insertId, doer.id, asker.id]
    )) as unknown as DbResult;

    const today = istDate();
    const monday = new Date(`${today}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const week = await weekSummary(doer.id, monday.toISOString().slice(0, 10));
    expect(week.upcoming.map((u) => u.title)).toContain("Nov piece of work");

    await applySubtaskAction(doer, sub.insertId, "submit");
    const day = await dailySummary(doer.id, today);
    expect(day.completed.map((c) => c.title)).toContain("Nov piece of work");
    expect(day.completed.find((c) => c.title === "Nov piece of work")?.project_name).toBe("Nov requested project › Nov parent");
    expect(day.empty).toBe(false);
  });
});
