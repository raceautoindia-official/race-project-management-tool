import { beforeAll, describe, expect, it } from "vitest";
import { query, DbResult, DbRow } from "@/lib/db";
import type { User } from "@/lib/types";
import { actAs, call, createLedProject, createUser } from "./helpers";

import * as subtasks from "@/app/api/tasks/[id]/subtasks/route";
import * as subtask from "@/app/api/subtasks/[id]/route";
import * as actions from "@/app/api/subtasks/[id]/actions/route";
import * as subtaskWeights from "@/app/api/tasks/[id]/subtasks/weights/route";
import * as taskWeights from "@/app/api/projects/[id]/tasks/weights/route";
import * as projectTasks from "@/app/api/projects/[id]/tasks/route";
import * as project from "@/app/api/projects/[id]/route";
import * as approval from "@/app/api/tasks/[id]/approval/route";
import * as levels from "@/app/api/designation-levels/route";
import { fetchTasks } from "@/lib/tasks";

/**
 * The redesign's spine (2026-10-17): a task owner splits a task into
 * subtasks for people, each is reviewed by the task owner before it counts,
 * and when all are approved the task goes to the project's managers.
 */

interface Sub {
  id: number;
  status: string;
  assignee_id: number | null;
  effective_weight: number;
  changes_requested: string | null;
}

let lead: User; // project owner
let owner: User; // task owner (assignee)
let doer: User; // subtask assignee
let outsider: User; // not on the project
let admin: User;
let projectId: number;
let taskId: number;

async function addMember(userId: number, role: "lead" | "member" = "member") {
  await query(`INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, ?)`, [projectId, userId, role]);
}

async function newTask(title: string): Promise<number> {
  actAs(lead);
  const res = await call<{ task: { id: number } }>(projectTasks.POST, {
    method: "POST",
    id: projectId,
    body: { title, assigneeId: owner.id, requestedById: lead.id },
  });
  expect(res.status).toBe(201);
  return res.body.task.id;
}

async function act(user: User, id: number, action: string, note?: string) {
  actAs(user);
  return call<{ status: string; subtask: Sub; taskStatus: string }>(actions.POST, {
    method: "POST",
    id,
    body: { action, note },
  });
}

async function taskStatus(id: number): Promise<string> {
  const [row] = await query<DbRow[]>(`SELECT status FROM tasks WHERE id = ?`, [id]);
  return row.status as string;
}

beforeAll(async () => {
  lead = await createUser("SpineLead");
  owner = await createUser("SpineOwner");
  doer = await createUser("SpineDoer");
  outsider = await createUser("SpineOutsider");
  admin = await createUser("SpineAdmin", "admin");
  projectId = await createLedProject(lead, "Spine project");
  await addMember(owner.id);
  await addMember(doer.id);
  taskId = await newTask("Build the report");
});

describe("splitting a task into subtasks", () => {
  it("gives a subtask to the task owner unless told otherwise", async () => {
    actAs(owner);
    const mine = await call<{ subtask: Sub }>(subtasks.POST, { method: "POST", id: taskId, body: { title: "Outline" } });
    expect(mine.status).toBe(201);
    expect(mine.body.subtask.assignee_id).toBe(owner.id);

    const theirs = await call<{ subtask: Sub }>(subtasks.POST, {
      method: "POST",
      id: taskId,
      body: { title: "Charts", assigneeId: doer.id, startDate: "2026-11-01", dueDate: "2026-11-05" },
    });
    expect(theirs.status).toBe(201);
    expect(theirs.body.subtask).toMatchObject({ assignee_id: doer.id, effective_weight: 50 });

    const [note] = await query<DbRow[]>(
      `SELECT type FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [doer.id]
    );
    expect(note.type).toBe("subtask_assigned");
  });

  it("refuses people who may not shape the task, and outsiders as assignees", async () => {
    actAs(doer);
    expect((await call(subtasks.POST, { method: "POST", id: taskId, body: { title: "Sneaky" } })).status).toBe(403);
    actAs(owner);
    const r = await call(subtasks.POST, { method: "POST", id: taskId, body: { title: "x", assigneeId: outsider.id } });
    expect(r.status).toBe(403);
    const bad = await call(subtasks.POST, {
      method: "POST",
      id: taskId,
      body: { title: "x", startDate: "2026-11-05", dueDate: "2026-11-01" },
    });
    expect(bad.status).toBe(400);
  });
});

describe("review before it counts", () => {
  let mine: number;
  let theirs: number;

  beforeAll(async () => {
    const rows = await query<DbRow[]>(`SELECT id, assignee_id FROM subtasks WHERE task_id = ? ORDER BY id`, [taskId]);
    mine = rows.find((r) => r.assignee_id === owner.id)!.id;
    theirs = rows.find((r) => r.assignee_id === doer.id)!.id;
  });

  it("sends the assignee's finished work to the task owner", async () => {
    const r = await act(doer, theirs, "submit");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("review");
    // Starting work starts the task.
    expect(await taskStatus(taskId)).toBe("in_progress");
    const [n] = await query<DbRow[]>(`SELECT type FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [owner.id]);
    expect(n.type).toBe("subtask_submitted");
  });

  it("lets only the task owner review it — not the assignee, not a lead", async () => {
    expect((await act(doer, theirs, "approve")).status).toBe(403);
    expect((await act(lead, theirs, "approve")).status).toBe(403);
  });

  it("needs a note to send work back, and shows it to the assignee", async () => {
    expect((await act(owner, theirs, "request_changes")).status).toBe(400);
    const r = await act(owner, theirs, "request_changes", "Use last quarter's numbers");
    expect(r.body.subtask).toMatchObject({ status: "in_progress", changes_requested: "Use last quarter's numbers" });
  });

  it("counts approved work only, by weight", async () => {
    await act(doer, theirs, "submit");
    await act(owner, theirs, "approve");
    const [t] = await fetchTasks("t.id = ?", [taskId]);
    expect(t.progress_approved).toBe(50);
    expect(t.subtask_done).toBe(1);
  });

  it("approves the task owner's own subtask at once, and then sends the task for review", async () => {
    const r = await act(owner, mine, "submit");
    expect(r.body.status).toBe("done");
    expect(r.body.taskStatus).toBe("review");
    const [n] = await query<DbRow[]>(`SELECT type FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [lead.id]);
    expect(n.type).toBe("review_requested");
  });

  it("pulls the task back when approved work is reopened", async () => {
    await act(owner, theirs, "reopen");
    expect(await taskStatus(taskId)).toBe("in_progress");
    await act(doer, theirs, "submit");
    await act(owner, theirs, "approve");
    expect(await taskStatus(taskId)).toBe("review");
  });

  it("keeps an approved task's work frozen for members, and reopens it for a lead", async () => {
    actAs(lead);
    const done = await call(approval.POST, { method: "POST", id: taskId, body: { decision: "approve" } });
    expect(done.status).toBe(200);
    expect(await taskStatus(taskId)).toBe("done");

    expect((await act(owner, theirs, "reopen")).status).toBe(409);
    actAs(owner);
    expect((await call(subtasks.POST, { method: "POST", id: taskId, body: { title: "More" } })).status).toBe(409);

    expect((await act(lead, theirs, "reopen")).status).toBe(200);
    const [row] = await query<DbRow[]>(`SELECT status, completed_at FROM tasks WHERE id = ?`, [taskId]);
    expect(row).toMatchObject({ status: "in_progress", completed_at: null });
  });

  it("still understands the old tick box", async () => {
    actAs(owner);
    const ticked = await call<{ subtask: Sub }>(subtask.PATCH, { method: "PATCH", id: theirs, body: { is_done: true } });
    expect(ticked.status).toBe(200);
    // The task owner ticking an item they review approves it.
    expect(ticked.body.subtask.status).toBe("done");
  });
});

describe("cancelling and approving the whole task", () => {
  it("drops a cancelled subtask out of the weighting", async () => {
    const id = await newTask("Cancel test");
    actAs(owner);
    const a = await call<{ subtask: Sub }>(subtasks.POST, { method: "POST", id, body: { title: "A" } });
    const b = await call<{ subtask: Sub }>(subtasks.POST, { method: "POST", id, body: { title: "B" } });
    await act(owner, a.body.subtask.id, "submit");
    await act(owner, b.body.subtask.id, "cancel");
    const [t] = await fetchTasks("t.id = ?", [id]);
    expect(t.progress_approved).toBe(100);
    expect(await taskStatus(id)).toBe("review");
  });

  it("the review approval route approves or sends back a task waiting for review", async () => {
    const id = await newTask("Approval route");
    actAs(owner);
    await call(subtasks.POST, { method: "POST", id, body: { title: "Only" } });
    const [s] = await query<DbRow[]>(`SELECT id FROM subtasks WHERE task_id = ?`, [id]);
    await act(owner, s.id, "submit");
    actAs(owner);
    expect((await call(approval.POST, { method: "POST", id, body: { decision: "approve" } })).status).toBe(403);
    actAs(lead);
    const back = await call(approval.POST, { method: "POST", id, body: { decision: "reject", note: "Add totals" } });
    expect(back.status).toBe(200);
    expect(await taskStatus(id)).toBe("in_progress");
    expect((await call(approval.POST, { method: "POST", id, body: { decision: "approve" } })).status).toBe(409);
  });
});

describe("weights", () => {
  it("lets the task owner set subtask weights that add up to 100, or reset them", async () => {
    const id = await newTask("Weighted");
    actAs(owner);
    const a = await call<{ subtask: Sub }>(subtasks.POST, { method: "POST", id, body: { title: "Big" } });
    const b = await call<{ subtask: Sub }>(subtasks.POST, { method: "POST", id, body: { title: "Small" } });
    const bad = await call(subtaskWeights.PUT, {
      method: "PUT",
      id,
      body: { weights: [{ id: a.body.subtask.id, weight: 80 }, { id: b.body.subtask.id, weight: 30 }] },
    });
    expect(bad.status).toBe(400);
    const ok = await call<{ subtasks: Sub[] }>(subtaskWeights.PUT, {
      method: "PUT",
      id,
      body: { weights: [{ id: a.body.subtask.id, weight: 80 }, { id: b.body.subtask.id, weight: 20 }] },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.subtasks.map((s) => s.effective_weight)).toEqual([80, 20]);

    // A newcomer to a fully fixed set gets an even third.
    const c = await call<{ subtask: Sub }>(subtasks.POST, { method: "POST", id, body: { title: "New" } });
    expect(c.body.subtask.effective_weight).toBeCloseTo(33.3, 0);

    actAs(doer);
    expect((await call(subtaskWeights.PUT, { method: "PUT", id, body: { reset: true } })).status).toBe(403);
    actAs(owner);
    const reset = await call<{ subtasks: Sub[] }>(subtaskWeights.PUT, { method: "PUT", id, body: { reset: true } });
    expect(reset.body.subtasks.every((s) => Math.abs(s.effective_weight - 100 / 3) < 0.01)).toBe(true);
  });

  it("leaves task weights to the project's managers", async () => {
    const rows = await query<DbRow[]>(`SELECT id FROM tasks WHERE project_id = ?`, [projectId]);
    const even = 100 / rows.length;
    const body = { weights: rows.map((r, i) => ({ id: r.id, weight: i === 0 ? even * 2 : (100 - even * 2) / (rows.length - 1) })) };
    actAs(owner);
    expect((await call(taskWeights.PUT, { method: "PUT", id: projectId, body })).status).toBe(403);
    actAs(lead);
    const ok = await call<{ tasks: { effective_weight: number }[] }>(taskWeights.PUT, { method: "PUT", id: projectId, body });
    expect(ok.status).toBe(200);
    expect(ok.body.tasks.reduce((s, t) => s + t.effective_weight, 0)).toBeCloseTo(100, 1); // stored to 3 decimals
  });
});

describe("project dates and job levels", () => {
  it("keeps a project's due date after its start", async () => {
    actAs(lead);
    expect((await call(project.PATCH, { method: "PATCH", id: projectId, body: { startDate: "2026-11-01", dueDate: "2026-12-01" } })).status).toBe(200);
    expect((await call(project.PATCH, { method: "PATCH", id: projectId, body: { dueDate: "2026-10-01" } })).status).toBe(400);
  });

  it("lets admins give job titles a level", async () => {
    actAs(lead);
    expect((await call(levels.PUT, { method: "PUT", body: { title: "Analyst", level: 3 } })).status).toBe(403);
    actAs(admin);
    expect((await call(levels.PUT, { method: "PUT", body: { title: "Analyst", level: 3 } })).status).toBe(200);
    await query(`UPDATE users SET designation = 'Analyst' WHERE id = ?`, [doer.id]);
    actAs(doer);
    const list = await call<{ levels: { title: string; level: number; people: number }[] }>(levels.GET, {});
    expect(list.body.levels.find((l) => l.title === "Analyst")).toMatchObject({ level: 3, people: 1 });
  });
});

describe("ownership", () => {
  it("leaves no subtask without someone to do it", async () => {
    const res = (await query<DbResult>(
      `SELECT COUNT(*) AS n FROM subtasks s JOIN tasks t ON t.id = s.task_id
        WHERE t.project_id = ? AND s.assignee_id IS NULL`,
      [projectId]
    )) as unknown as DbRow[];
    expect(Number(res[0].n)).toBe(0);
  });
});

describe("templates keep the shape of the work", () => {
  it("saves each task's subtasks and recreates them, unassigned", async () => {
    const templates = await import("@/app/api/templates/route");
    const instantiate = await import("@/app/api/templates/[id]/instantiate/route");
    const id = await newTask("Template me");
    actAs(owner);
    await call(subtasks.POST, { method: "POST", id, body: { title: "Step one" } });
    await call(subtasks.POST, { method: "POST", id, body: { title: "Step two", assigneeId: doer.id } });

    actAs(admin);
    const saved = await call<{ template: { id: number } }>(templates.POST, {
      method: "POST",
      body: { name: "Spine shape", projectId },
    });
    expect(saved.status).toBe(201);
    const made = await call<{ project: { id: number } }>(instantiate.POST, {
      method: "POST",
      id: saved.body.template.id,
      body: { name: "From the template" },
    });
    expect(made.status).toBeLessThan(300);
    const rows = await query<DbRow[]>(
      `SELECT s.title, s.assignee_id FROM subtasks s JOIN tasks t ON t.id = s.task_id
        WHERE t.project_id = ? AND t.title = 'Template me' ORDER BY s.position`,
      [made.body.project.id]
    );
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { title: "Step one", assignee_id: null },
      { title: "Step two", assignee_id: null },
    ]);
  });
});
