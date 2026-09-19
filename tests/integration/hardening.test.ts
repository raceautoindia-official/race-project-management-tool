import { beforeAll, describe, expect, it } from "vitest";
import { query, DbRow, DbResult } from "@/lib/db";
import { getTeamPerformance } from "@/lib/performance";
import type { Task, User } from "@/lib/types";
import { actAs, call, createLedProject, createUser } from "./helpers";

import * as projects from "@/app/api/projects/route";
import * as members from "@/app/api/projects/[id]/members/route";
import * as labels from "@/app/api/projects/[id]/labels/route";
import * as projectTasks from "@/app/api/projects/[id]/tasks/route";
import * as bulk from "@/app/api/projects/[id]/tasks/bulk/route";
import * as exportCsv from "@/app/api/projects/[id]/tasks/export/route";
import * as task from "@/app/api/tasks/[id]/route";
import * as signoff from "@/app/api/tasks/[id]/signoff/route";
import * as projectRequests from "@/app/api/projects/[id]/requests/route";
import * as requestDecision from "@/app/api/requests/[id]/decision/route";
import * as meetings from "@/app/api/meetings/route";

// Regression tests for issues found in the pre-production review.

type Json = Record<string, unknown> & { error?: string };

let admin: User, lead: User, alice: User, sam: User, zoe: User;
let projectId: number;

const correction = (title: string) => ({
  taskType: "correction",
  title,
  existingBehavior: "Wrong",
  expectedBehavior: "Right",
  acceptanceCriteria: "It is right",
});

async function createTask(body: Record<string, unknown>): Promise<Task> {
  actAs(lead);
  const res = await call<{ task: Task }>(projectTasks.POST, { method: "POST", id: projectId, body });
  expect(res.status).toBe(201);
  return res.body.task;
}

async function markDone(id: number) {
  actAs(lead);
  const res = await call(task.PATCH, { method: "PATCH", id, body: { status: "done" } });
  expect(res.status).toBe(200);
}

async function signOff(id: number, as: User = lead) {
  actAs(as);
  return call<Json & { task: Task }>(signoff.POST, { method: "POST", id, body: {} });
}

beforeAll(async () => {
  admin = await createUser("Hadmin", "admin");
  lead = await createUser("Hlead");
  alice = await createUser("Halice");
  sam = await createUser("Hsam");
  zoe = await createUser("Hzoe");

  actAs(admin);
  const created = await call<{ project: { id: number } }>(projects.POST, {
    method: "POST",
    body: { name: "Hardening", ownerId: lead.id, memberIds: [alice.id, sam.id] },
  });
  expect(created.status).toBe(201);
  projectId = created.body.project.id;
});

describe("review fixes", () => {
  it("a nominated lead of a pending request gains no team visibility", async () => {
    await createLedProject(lead, "Hardening ops");
    actAs(zoe);
    const res = await call(projects.POST, { method: "POST", body: { name: "Zoe's idea", leadId: lead.id } });
    expect(res.status).toBe(201);
    const team = await getTeamPerformance(lead);
    expect(team.members.map((m) => m.id)).not.toContain(zoe.id);
    expect(team.members.map((m) => m.id)).toContain(alice.id);
  });

  it("the project owner can't be demoted to member", async () => {
    actAs(admin);
    const res = await call<Json>(members.POST, {
      method: "POST",
      id: projectId,
      body: { userId: lead.id, roleInProject: "member" },
    });
    expect(res.status).toBe(400);
  });

  it("an assignee can't move a Done task back out of Done", async () => {
    const t = await createTask({ ...correction("Reopen guard"), requestedById: alice.id, assigneeId: sam.id });
    await markDone(t.id);
    actAs(sam);
    const res = await call<Json>(task.PATCH, { method: "PATCH", id: t.id, body: { status: "in_progress" } });
    expect(res.status).toBe(403);
    // A lead still can.
    actAs(lead);
    expect((await call(task.PATCH, { method: "PATCH", id: t.id, body: { status: "review" } })).status).toBe(200);
  });

  it("saving unchanged values is not mistaken for a sign-off conflict", async () => {
    const t = await createTask({ ...correction("Same values"), assigneeId: sam.id, priority: "high" });
    actAs(lead);
    const res = await call(task.PATCH, { method: "PATCH", id: t.id, body: { priority: "high" } });
    expect(res.status).toBe(200);
  });

  it("a task whose owner left the project can still be edited", async () => {
    const t = await createTask({ ...correction("Owner left"), assigneeId: sam.id });
    const extra = await createUser("Hleaver");
    await query(`INSERT INTO project_members (project_id, user_id) VALUES (?, ?)`, [projectId, extra.id]);
    await query(`UPDATE tasks SET assignee_id = ? WHERE id = ?`, [extra.id, t.id]);
    await query(`DELETE FROM project_members WHERE project_id = ? AND user_id = ?`, [projectId, extra.id]);
    actAs(lead);
    const res = await call(task.PATCH, {
      method: "PATCH",
      id: t.id,
      body: { title: "Owner left (renamed)", assigneeId: extra.id },
    });
    expect(res.status).toBe(200);
  });

  it("converting a general task to a typed one requires an owner", async () => {
    const res = (await query<DbResult>(
      `INSERT INTO tasks (project_id, title, created_by, requested_by, request_approved_by)
       VALUES (?, 'Legacy', ?, ?, ?)`,
      [projectId, lead.id, lead.id, lead.id]
    )) as unknown as DbResult;
    actAs(lead);
    const spec = { taskType: "feature", features: "F", rules: "R" };
    const noOwner = await call<Json>(task.PATCH, { method: "PATCH", id: res.insertId, body: spec });
    expect(noOwner.status).toBe(400);
    expect(noOwner.body.error).toMatch(/assigned owner is required/);
    const ok = await call(task.PATCH, {
      method: "PATCH",
      id: res.insertId,
      body: { ...spec, assigneeId: sam.id },
    });
    expect(ok.status).toBe(200);
  });

  it("a task with no recorded approver can be signed off by a lead (who becomes the approver)", async () => {
    const t = await createTask({ ...correction("No approver"), requestedById: alice.id, assigneeId: sam.id });
    await markDone(t.id);
    await query(`UPDATE tasks SET request_approved_by = NULL, request_approved_at = NULL WHERE id = ?`, [t.id]);

    const byRequester = await signOff(t.id, alice);
    expect(byRequester.status).toBe(409);
    expect(byRequester.body.error).toMatch(/Approved by is missing/);

    const byLead = await signOff(t.id, lead);
    expect(byLead.status).toBe(200);
    expect(byLead.body.task).toMatchObject({ request_approved_by: lead.id, signed_off_by: lead.id });
    expect(byLead.body.task.request_approved_at).toBeTruthy();
  });

  it("labels on signed-off tasks can't be deleted; unused labels can", async () => {
    actAs(lead);
    const used = await call<{ label: { id: number } }>(labels.POST, {
      method: "POST",
      id: projectId,
      body: { name: "Billed" },
    });
    const unused = await call<{ label: { id: number } }>(labels.POST, {
      method: "POST",
      id: projectId,
      body: { name: "Spare" },
    });
    const t = await createTask({ ...correction("Labelled"), assigneeId: sam.id, labelIds: [used.body.label.id] });
    await markDone(t.id);
    expect((await signOff(t.id)).status).toBe(200);

    actAs(lead);
    const blocked = await call<Json>(labels.DELETE, {
      method: "DELETE",
      id: projectId,
      path: `/?labelId=${used.body.label.id}`,
    });
    expect(blocked.status).toBe(409);
    const allowed = await call(labels.DELETE, {
      method: "DELETE",
      id: projectId,
      path: `/?labelId=${unused.body.label.id}`,
    });
    expect(allowed.status).toBe(200);
  });

  it("a task referenced by a signed-off follow-up can't be deleted", async () => {
    const parent = await createTask({ ...correction("Parent"), assigneeId: sam.id });
    const followUp = await createTask({ ...correction("Follow-up"), assigneeId: sam.id, parentTaskId: parent.id });
    await markDone(followUp.id);
    expect((await signOff(followUp.id)).status).toBe(200);

    actAs(lead);
    expect((await call(task.DELETE, { method: "DELETE", id: parent.id })).status).toBe(409);
    const bulkDelete = await call(bulk.POST, {
      method: "POST",
      id: projectId,
      body: { taskIds: [parent.id], action: "delete" },
    });
    expect(bulkDelete.status).toBe(409);
  });

  it("bulk Done keeps the original completion time of tasks already Done", async () => {
    const done = await createTask({ ...correction("Already done"), assigneeId: sam.id });
    const open = await createTask({ ...correction("Still open"), assigneeId: sam.id });
    await markDone(done.id);
    await query(`UPDATE tasks SET completed_at = '2026-01-01 00:00:00' WHERE id = ?`, [done.id]);

    actAs(lead);
    const res = await call(bulk.POST, {
      method: "POST",
      id: projectId,
      body: { taskIds: [done.id, open.id], action: "status", status: "done" },
    });
    expect(res.status).toBe(200);
    const rows = await query<DbRow[]>(
      `SELECT id, status, completed_at FROM tasks WHERE id IN (?, ?) ORDER BY id`,
      [done.id, open.id]
    );
    expect(rows[0].completed_at).toBe("2026-01-01 00:00:00");
    expect(rows[1]).toMatchObject({ status: "done" });
    expect(rows[1].completed_at).not.toBe("2026-01-01 00:00:00");
  });

  it("CSV export neutralizes spreadsheet formulas", async () => {
    await createTask({ ...correction('=HYPERLINK("https://evil.example","x")'), assigneeId: sam.id });
    actAs(lead);
    const res = await call(exportCsv.GET, { id: projectId });
    const body = await res.res.text();
    expect(body).toContain(`"'=HYPERLINK(""https://evil.example"",""x"")"`);
    expect(body).not.toMatch(/(^|,)"?=HYPERLINK/m);
  });
});

describe("separation of duties and small fixes", () => {
  it("the assigned owner can't sign off their own work; an admin can", async () => {
    const t = await createTask({ ...correction("Own work"), requestedById: lead.id, assigneeId: lead.id });
    await markDone(t.id);
    const own = await signOff(t.id, lead);
    expect(own.status).toBe(403);
    expect(own.body.error).toMatch(/can't sign off your own work/);
    expect((await signOff(t.id, admin)).status).toBe(200);
  });

  it("a lead can't decide their own task request; an admin can", async () => {
    actAs(lead);
    const raised = await call<{ request: { id: number } }>(projectRequests.POST, {
      method: "POST",
      id: projectId,
      body: { taskType: "feature", title: "Lead's own idea", features: "F", rules: "R" },
    });
    expect(raised.status).toBe(201);
    const own = await call<Json>(requestDecision.POST, {
      method: "POST",
      id: raised.body.request.id,
      body: { decision: "approve", assigneeId: sam.id },
    });
    expect(own.status).toBe(403);

    actAs(admin);
    const byAdmin = await call(requestDecision.POST, {
      method: "POST",
      id: raised.body.request.id,
      body: { decision: "approve", assigneeId: sam.id },
    });
    expect(byAdmin.status).toBe(200);
  });

  it("the requester can change before Done (and is logged), not after", async () => {
    const t = await createTask({ ...correction("Requester change"), requestedById: alice.id, assigneeId: sam.id });
    actAs(lead);
    const before = await call(task.PATCH, { method: "PATCH", id: t.id, body: { requestedById: lead.id } });
    expect(before.status).toBe(200);
    const [log] = await query<DbRow[]>(
      `SELECT metadata FROM activity_log WHERE action = 'task.requester_changed' AND entity_id = ?`,
      [t.id]
    );
    const meta = typeof log.metadata === "string" ? JSON.parse(log.metadata) : log.metadata;
    expect(meta).toMatchObject({ from: alice.id, to: lead.id });

    await markDone(t.id);
    actAs(lead);
    const after = await call<Json>(task.PATCH, { method: "PATCH", id: t.id, body: { requestedById: alice.id } });
    expect(after.status).toBe(409);
    // Re-sending the same requester (as the edit form does) is fine.
    const same = await call(task.PATCH, { method: "PATCH", id: t.id, body: { requestedById: lead.id, priority: "low" } });
    expect(same.status).toBe(200);
  });

  it("bulk Done asks the requester to sign off", async () => {
    const t = await createTask({ ...correction("Bulk notify"), requestedById: alice.id, assigneeId: sam.id });
    actAs(lead);
    await call(bulk.POST, { method: "POST", id: projectId, body: { taskIds: [t.id], action: "status", status: "done" } });
    const [row] = await query<DbRow[]>(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'signoff_requested' AND message LIKE ?`,
      [alice.id, '%"Bulk notify"%']
    );
    expect(Number(row.n)).toBe(1);
  });

  it("admins are notified of project requests", async () => {
    actAs(alice);
    const res = await call(projects.POST, { method: "POST", body: { name: "Notify admins", leadId: lead.id } });
    expect(res.status).toBe(201);
    const [row] = await query<DbRow[]>(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'project_requested' AND message LIKE ?`,
      [admin.id, '%"Notify admins"%']
    );
    expect(Number(row.n)).toBe(1);
  });

  it("meetings can only use accessible projects and real, active attendees", async () => {
    const outsiderProject = await createLedProject(await createUser("Hother"), "Not yours");
    actAs(sam);
    const start = "2026-12-01T10:00";
    const foreign = await call(meetings.POST, {
      method: "POST",
      body: { title: "Sneaky", projectId: outsiderProject, startTime: start },
    });
    expect(foreign.status).toBe(403);

    const inactive = await createUser("Hinactive");
    await query(`UPDATE users SET is_active = FALSE WHERE id = ?`, [inactive.id]);
    const badAttendee = await call<Json>(meetings.POST, {
      method: "POST",
      body: { title: "Ghosts", startTime: start, attendeeIds: [inactive.id, 99999999] },
    });
    expect(badAttendee.status).toBe(400);

    const ok = await call(meetings.POST, {
      method: "POST",
      body: { title: "Standup", projectId, startTime: start, attendeeIds: [alice.id] },
    });
    expect(ok.status).toBe(201);
  });
});
