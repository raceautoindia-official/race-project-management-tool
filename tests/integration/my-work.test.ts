import { beforeAll, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { getMyWork } from "@/lib/my-work";
import type { User } from "@/lib/types";
import { actAs, call, createLedProject, createUser } from "./helpers";

import * as projectTasks from "@/app/api/projects/[id]/tasks/route";
import * as subtasks from "@/app/api/tasks/[id]/subtasks/route";
import * as actions from "@/app/api/subtasks/[id]/actions/route";
import * as approval from "@/app/api/tasks/[id]/approval/route";

/**
 * My Work and Reviews read everything from getMyWork (lib/my-work.ts). These
 * walk one piece of work through the flow and check it shows up for the
 * right person at each step.
 */

let lead: User; // project owner
let owner: User; // task owner
let doer: User; // subtask assignee
let projectId: number;
let taskId: number;
let subtaskId: number;

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

beforeAll(async () => {
  lead = await createUser("WorkLead");
  owner = await createUser("WorkOwner");
  doer = await createUser("WorkDoer");
  projectId = await createLedProject(lead, "My Work project");
  for (const u of [owner, doer]) {
    await query(`INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'member')`, [projectId, u.id]);
  }
  taskId = await newTask("Write the brochure");
  actAs(owner);
  const res = await call<{ subtask: { id: number } }>(subtasks.POST, {
    method: "POST",
    id: taskId,
    body: { title: "Draft the copy", assigneeId: doer.id, dueDate: "2026-11-05" },
  });
  expect(res.status).toBe(201);
  subtaskId = res.body.subtask.id;
});

describe("getMyWork", () => {
  it("lists an assignee's open subtask in their to-do", async () => {
    const work = await getMyWork(doer);
    const item = work.todo.find((i) => i.kind === "subtask" && i.id === subtaskId);
    expect(item).toMatchObject({ task_id: taskId, project_id: projectId, title: "Draft the copy", due_date: "2026-11-05" });
    // The task owner does not get someone else's subtask as a to-do.
    expect((await getMyWork(owner)).todo.some((i) => i.kind === "subtask" && i.id === subtaskId)).toBe(false);
  });

  it("puts submitted work in the task owner's reviews and the assignee's sent list", async () => {
    actAs(doer);
    const r = await call(actions.POST, { method: "POST", id: subtaskId, body: { action: "submit" } });
    expect(r.status).toBe(200);

    const mine = await getMyWork(doer);
    expect(mine.todo.some((i) => i.kind === "subtask" && i.id === subtaskId)).toBe(false);
    expect(mine.submitted.find((i) => i.kind === "subtask" && i.id === subtaskId)).toMatchObject({
      status: "review",
      person_name: owner.name, // who it is waiting for
    });

    const theirs = await getMyWork(owner);
    expect(theirs.reviewSubtasks.find((i) => i.id === subtaskId)).toMatchObject({ status: "review", person_name: doer.name });
    expect(theirs.ownedTasks.find((t) => t.id === taskId)).toMatchObject({ waiting_for_me: 1, subtask_total: 1 });
    // The project owner does not review subtasks of a task that has an owner.
    expect((await getMyWork(lead)).reviewSubtasks.some((i) => i.id === subtaskId)).toBe(false);
  });

  it("puts a task in review in the project owner's reviews", async () => {
    const reviewTaskId = await newTask("Print run");
    await query(`UPDATE tasks SET status = 'review' WHERE id = ?`, [reviewTaskId]);

    const work = await getMyWork(lead);
    expect(work.reviewTasks.find((i) => i.id === reviewTaskId)).toMatchObject({ kind: "task", person_name: owner.name });
    // The task's own owner waits for it rather than reviewing it.
    expect((await getMyWork(owner)).reviewTasks.some((i) => i.id === reviewTaskId)).toBe(false);
    expect((await getMyWork(owner)).submitted.some((i) => i.kind === "task" && i.id === reviewTaskId)).toBe(true);

    // Approving it leaves the requester a sign-off to do.
    actAs(lead);
    const res = await call(approval.POST, { method: "POST", id: reviewTaskId, body: { decision: "approve" } });
    expect(res.status).toBe(200);
    const after = await getMyWork(lead);
    expect(after.reviewTasks.some((i) => i.id === reviewTaskId)).toBe(false);
    expect(after.attention.find((a) => a.kind === "signoff" && a.id === reviewTaskId)).toMatchObject({
      project_id: projectId,
      title: "Print run",
      link: `/projects/${projectId}/tasks/${reviewTaskId}`,
    });
  });

  it("does not ask anyone else to sign off", async () => {
    const work = await getMyWork(doer);
    expect(work.attention.some((a) => a.kind === "signoff")).toBe(false);
  });
});
