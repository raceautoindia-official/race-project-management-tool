import { beforeAll, describe, expect, it } from "vitest";
import { query, DbRow } from "@/lib/db";
import type { Task, TaskRequest, User } from "@/lib/types";
import { actAs, call, createLedProject, createUser } from "./helpers";

import * as projects from "@/app/api/projects/route";
import * as project from "@/app/api/projects/[id]/route";
import * as projectDecision from "@/app/api/projects/[id]/decision/route";
import * as members from "@/app/api/projects/[id]/members/route";
import * as labels from "@/app/api/projects/[id]/labels/route";
import * as milestones from "@/app/api/projects/[id]/milestones/route";
import * as projectTasks from "@/app/api/projects/[id]/tasks/route";
import * as bulk from "@/app/api/projects/[id]/tasks/bulk/route";
import * as projectRequests from "@/app/api/projects/[id]/requests/route";
import * as request from "@/app/api/requests/[id]/route";
import * as requestDecision from "@/app/api/requests/[id]/decision/route";
import * as task from "@/app/api/tasks/[id]/route";
import * as signoff from "@/app/api/tasks/[id]/signoff/route";
import * as pdf from "@/app/api/tasks/[id]/pdf/route";
import * as subtasks from "@/app/api/tasks/[id]/subtasks/route";
import * as fromSpec from "@/app/api/tasks/[id]/subtasks/from-spec/route";
import * as subtask from "@/app/api/subtasks/[id]/route";
import * as comments from "@/app/api/tasks/[id]/comments/route";
import * as comment from "@/app/api/comments/[id]/route";
import * as timeLogs from "@/app/api/tasks/[id]/time-logs/route";
import * as attachments from "@/app/api/tasks/[id]/attachments/route";
import * as dependencies from "@/app/api/tasks/[id]/dependencies/route";

type Json = Record<string, unknown> & { error?: string };

const correction = {
  taskType: "correction",
  title: "Invoice totals round down",
  existingBehavior: "Totals are truncated to 2 decimals",
  expectedBehavior: "Totals round half-up",
  acceptanceCriteria: "12.345 shows as 12.35",
};
const feature = {
  taskType: "feature",
  title: "Export invoices as CSV",
  features: "Download the invoice list as CSV",
  rules: "Only leads can export",
};

let admin: User, lead: User, alice: User, sam: User, outsider: User;

beforeAll(async () => {
  admin = await createUser("Admin", "admin");
  lead = await createUser("Lee");
  alice = await createUser("Alice");
  sam = await createUser("Sam");
  outsider = await createUser("Olivia");
  // Only admins and existing leads can be nominated to approve a project.
  await createLedProject(lead);
});

describe("project request → lead approval", () => {
  let projectId: number;

  it("requires a nominated lead who isn't the requester", async () => {
    actAs(alice);
    const none = await call<Json>(projects.POST, { method: "POST", body: { name: "Portal" } });
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/Choose the lead/);

    const self = await call<Json>(projects.POST, {
      method: "POST",
      body: { name: "Portal", leadId: alice.id },
    });
    expect(self.status).toBe(400);

    const notALead = await call<Json>(projects.POST, {
      method: "POST",
      body: { name: "Portal", leadId: sam.id },
    });
    expect(notALead.status).toBe(400);
    expect(notALead.body.error).toMatch(/admin or an existing project lead/);
  });

  it("creates a pending, read-only project owned by the nominated lead", async () => {
    actAs(alice);
    const res = await call<{ project: { id: number; approval_status: string } }>(projects.POST, {
      method: "POST",
      body: { name: "Portal", description: "Customer portal", leadId: lead.id },
    });
    expect(res.status).toBe(201);
    expect(res.body.project.approval_status).toBe("pending");
    projectId = res.body.project.id;

    const [row] = await query<DbRow[]>(
      `SELECT owner_id, requested_by, approval_status FROM projects WHERE id = ?`,
      [projectId]
    );
    expect(row).toMatchObject({ owner_id: lead.id, requested_by: alice.id, approval_status: "pending" });
    const roles = await query<DbRow[]>(
      `SELECT user_id, role_in_project FROM project_members WHERE project_id = ? ORDER BY user_id`,
      [projectId]
    );
    expect(roles.map((r) => [r.user_id, r.role_in_project])).toEqual(
      [
        [lead.id, "lead"],
        [alice.id, "member"],
      ].sort((a, b) => Number(a[0]) - Number(b[0]))
    );

    // Nothing can be added while it awaits approval.
    const raised = await call<Json>(projectRequests.POST, {
      method: "POST",
      id: projectId,
      body: feature,
    });
    expect(raised.status).toBe(409);
    expect(raised.body.error).toMatch(/awaiting lead approval/);
  });

  it("only the nominated lead or an admin can decide", async () => {
    for (const user of [outsider, alice]) {
      actAs(user);
      const res = await call(projectDecision.POST, {
        method: "POST",
        id: projectId,
        body: { decision: "approve" },
      });
      expect(res.status).toBe(403);
    }
    actAs(lead);
    const noReason = await call<Json>(projectDecision.POST, {
      method: "POST",
      id: projectId,
      body: { decision: "reject" },
    });
    expect(noReason.status).toBe(400);
  });

  it("approves once, recording who approved", async () => {
    actAs(lead);
    const res = await call<{ project: Json }>(projectDecision.POST, {
      method: "POST",
      id: projectId,
      body: { decision: "approve" },
    });
    expect(res.status).toBe(200);
    expect(res.body.project).toMatchObject({ approval_status: "approved", decided_by: lead.id });

    const again = await call(projectDecision.POST, {
      method: "POST",
      id: projectId,
      body: { decision: "approve" },
    });
    expect(again.status).toBe(409);

    const added = await call(members.POST, {
      method: "POST",
      id: projectId,
      body: { userId: sam.id },
    });
    expect(added.status).toBe(201);
  });

  it("a rejected request stays read-only and the requester can delete it", async () => {
    actAs(alice);
    const created = await call<{ project: { id: number } }>(projects.POST, {
      method: "POST",
      body: { name: "Side quest", leadId: lead.id },
    });
    const sideId = created.body.project.id;

    actAs(admin);
    const rejected = await call(projectDecision.POST, {
      method: "POST",
      id: sideId,
      body: { decision: "reject", note: "Not this quarter" },
    });
    expect(rejected.status).toBe(200);

    actAs(lead);
    const edit = await call<Json>(project.PATCH, {
      method: "PATCH",
      id: sideId,
      body: { name: "Renamed" },
    });
    expect(edit.status).toBe(409);

    actAs(sam);
    expect((await call(project.DELETE, { method: "DELETE", id: sideId })).status).toBe(403);
    actAs(alice);
    expect((await call(project.DELETE, { method: "DELETE", id: sideId })).status).toBe(200);
  });

  describe("tasks, requests, sign-off and read-only locks", () => {
    let taskA: Task; // correction created by the lead, requested by Alice
    let taskB: Task; // feature raised by Sam and approved by the lead

    it("lead-created tasks need a type, its required fields and an owner", async () => {
      actAs(lead);
      const noType = await call<Json>(projectTasks.POST, {
        method: "POST",
        id: projectId,
        body: { title: "x", assigneeId: sam.id },
      });
      expect(noType.status).toBe(400);

      const { acceptanceCriteria: _omit, ...partial } = correction;
      void _omit;
      const missing = await call<Json>(projectTasks.POST, {
        method: "POST",
        id: projectId,
        body: { ...partial, assigneeId: sam.id },
      });
      expect(missing.status).toBe(400);
      expect(missing.body.error).toMatch(/Acceptance criteria is required/);

      const noOwner = await call<Json>(projectTasks.POST, {
        method: "POST",
        id: projectId,
        body: correction,
      });
      expect(noOwner.status).toBe(400);
      expect(noOwner.body.error).toMatch(/assigned owner is required/);

      const notMember = await call<Json>(projectTasks.POST, {
        method: "POST",
        id: projectId,
        body: { ...correction, assigneeId: outsider.id },
      });
      expect(notMember.status).toBe(400);

      actAs(sam);
      const member = await call<Json>(projectTasks.POST, {
        method: "POST",
        id: projectId,
        body: { ...correction, assigneeId: sam.id },
      });
      expect(member.status).toBe(403);
    });

    it("records requester, approver and a type-specific spec", async () => {
      actAs(lead);
      const res = await call<{ task: Task }>(projectTasks.POST, {
        method: "POST",
        id: projectId,
        body: {
          ...correction,
          reason: "  ",
          features: "belongs to another type — dropped",
          requestedById: alice.id,
          assigneeId: sam.id,
        },
      });
      expect(res.status).toBe(201);
      taskA = res.body.task;
      expect(taskA).toMatchObject({
        task_type: "correction",
        acceptance_criteria: "12.345 shows as 12.35",
        reason: null,
        features: null,
        requested_by: alice.id,
        requester_name: "Alice",
        request_approved_by: lead.id,
        request_approver_name: "Lee",
        assignee_id: sam.id,
        signed_off_at: null,
      });
      expect(taskA.request_approved_at).toBeTruthy();
      // Created and approved in the same request, so both stamps are the same
      // UTC moment regardless of the MySQL server's time zone.
      const utc = (s: string | null | undefined) => Date.parse(String(s).replace(" ", "T") + "Z");
      expect(Math.abs(utc(taskA.requested_at) - utc(taskA.request_approved_at))).toBeLessThan(60_000);
    });

    it("members raise requests that only the raiser and managers can see", async () => {
      actAs(sam);
      const invalid = await call<Json>(projectRequests.POST, {
        method: "POST",
        id: projectId,
        body: { ...feature, rules: "" },
      });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error).toMatch(/Rules is required/);

      const raised = await call<{ request: TaskRequest }>(projectRequests.POST, {
        method: "POST",
        id: projectId,
        body: feature,
      });
      expect(raised.status).toBe(201);
      expect(raised.body.request).toMatchObject({ status: "pending", requested_by: sam.id, flow: null });

      const count = async (u: User) => {
        actAs(u);
        const r = await call<{ requests: TaskRequest[] }>(projectRequests.GET, { id: projectId });
        return r.body.requests.length;
      };
      expect(await count(sam)).toBe(1);
      expect(await count(alice)).toBe(0);
      expect(await count(lead)).toBe(1);
    });

    it("approving a request creates the task with the full trail", async () => {
      actAs(lead);
      const list = await call<{ requests: TaskRequest[] }>(projectRequests.GET, { id: projectId });
      const req = list.body.requests[0];

      actAs(sam);
      expect(
        (await call(requestDecision.POST, { method: "POST", id: req.id, body: { decision: "approve", assigneeId: sam.id } }))
          .status
      ).toBe(403);

      actAs(lead);
      const noOwner = await call<Json>(requestDecision.POST, {
        method: "POST",
        id: req.id,
        body: { decision: "approve" },
      });
      expect(noOwner.status).toBe(400);

      const approved = await call<{ request: TaskRequest; task: Task }>(requestDecision.POST, {
        method: "POST",
        id: req.id,
        // priority and dueDate are sent but must be ignored: they belong to
        // the request, and this request was raised without either.
        body: { decision: "approve", assigneeId: sam.id, priority: "high", dueDate: "2026-12-31" },
      });
      expect(approved.status).toBe(200);
      expect(approved.body.task.due_date).toBeNull();
      taskB = approved.body.task;
      expect(approved.body.request).toMatchObject({ status: "approved", decided_by: lead.id, task_id: taskB.id });
      expect(taskB).toMatchObject({
        task_type: "feature",
        title: feature.title,
        features: feature.features,
        rules: feature.rules,
        request_id: req.id,
        requested_by: sam.id,
        request_approved_by: lead.id,
        assignee_id: sam.id,
        priority: "medium", // the request's own, not the approver's "high"
        status: "todo",
      });

      const again = await call(requestDecision.POST, {
        method: "POST",
        id: req.id,
        body: { decision: "reject", note: "late" },
      });
      expect(again.status).toBe(409);
    });

    it("rejects with a reason and lets only the raiser withdraw pending requests", async () => {
      actAs(sam);
      const second = await call<{ request: TaskRequest }>(projectRequests.POST, {
        method: "POST",
        id: projectId,
        body: { ...feature, title: "Dark mode" },
      });
      actAs(lead);
      const rejected = await call<{ request: TaskRequest }>(requestDecision.POST, {
        method: "POST",
        id: second.body.request.id,
        body: { decision: "reject", note: "Out of scope" },
      });
      expect(rejected.body.request).toMatchObject({ status: "rejected", decision_note: "Out of scope" });

      actAs(sam);
      const third = await call<{ request: TaskRequest }>(projectRequests.POST, {
        method: "POST",
        id: projectId,
        body: { ...correction, title: "Typo on login" },
      });
      actAs(alice);
      expect((await call(request.DELETE, { method: "DELETE", id: third.body.request.id })).status).toBe(403);
      actAs(sam);
      expect((await call(request.DELETE, { method: "DELETE", id: third.body.request.id })).status).toBe(200);
      expect((await call(request.DELETE, { method: "DELETE", id: second.body.request.id })).status).toBe(409);
    });

    it("sign-off needs Done, and the requester or a manager", async () => {
      actAs(sam); // assignee, neither requester nor manager
      expect((await call(signoff.POST, { method: "POST", id: taskA.id, body: {} })).status).toBe(403);

      actAs(alice);
      const early = await call<Json>(signoff.POST, { method: "POST", id: taskA.id, body: {} });
      expect(early.status).toBe(409);
      expect(early.body.error).toMatch(/marked Done/);

      actAs(sam);
      const review = await call<{ task: Task }>(task.PATCH, {
        method: "PATCH",
        id: taskA.id,
        body: { status: "review" },
      });
      expect(review.status).toBe(200);
      expect((await call(task.PATCH, { method: "PATCH", id: taskA.id, body: { status: "done" } })).status).toBe(403);

      actAs(lead);
      const done = await call<{ task: Task }>(task.PATCH, {
        method: "PATCH",
        id: taskA.id,
        body: { status: "done" },
      });
      expect(done.body.task.completed_at).toBeTruthy();

      const blank = await call<Json>(task.PATCH, {
        method: "PATCH",
        id: taskA.id,
        body: { existingBehavior: "" },
      });
      expect(blank.status).toBe(400);
      expect(blank.body.error).toMatch(/Existing behavior is required/);
    });

    it("signing off locks the task and everything on it", async () => {
      actAs(sam);
      const sub = await call<{ subtask: { id: number } }>(subtasks.POST, {
        method: "POST",
        id: taskA.id,
        body: { title: "Check rounding" },
      });
      const com = await call<{ comment: { id: number } }>(comments.POST, {
        method: "POST",
        id: taskA.id,
        body: { body: "Fixed on staging" },
      });
      const log = await call<{ log: { id: number } }>(timeLogs.POST, {
        method: "POST",
        id: taskA.id,
        body: { minutes: 45 },
      });
      expect([sub.status, com.status, log.status]).toEqual([201, 201, 201]);

      actAs(alice);
      const signed = await call<{ task: Task }>(signoff.POST, {
        method: "POST",
        id: taskA.id,
        body: { note: "Verified" },
      });
      expect(signed.status).toBe(200);
      expect(signed.body.task).toMatchObject({
        signed_off_by: alice.id,
        signer_name: "Alice",
        signoff_note: "Verified",
      });
      expect(signed.body.task.signed_off_at).toBeTruthy();

      const form = new FormData();
      form.append("file", new Blob(["hello"], { type: "text/plain" }), "note.txt");
      const attempts: [string, () => ReturnType<typeof call>][] = [
        ["edit", () => call(task.PATCH, { method: "PATCH", id: taskA.id, body: { priority: "low" } })],
        ["reopen", () => call(task.PATCH, { method: "PATCH", id: taskA.id, body: { status: "in_progress" } })],
        ["delete", () => call(task.DELETE, { method: "DELETE", id: taskA.id })],
        ["sign off again", () => call(signoff.POST, { method: "POST", id: taskA.id, body: {} })],
        ["add subtask", () => call(subtasks.POST, { method: "POST", id: taskA.id, body: { title: "x" } })],
        ["tick subtask", () => call(subtask.PATCH, { method: "PATCH", id: sub.body.subtask.id, body: { is_done: true } })],
        ["remove subtask", () => call(subtask.DELETE, { method: "DELETE", id: sub.body.subtask.id })],
        ["comment", () => call(comments.POST, { method: "POST", id: taskA.id, body: { body: "late" } })],
        ["edit comment", () => call(comment.PATCH, { method: "PATCH", id: com.body.comment.id, body: { body: "edit" } })],
        ["delete comment", () => call(comment.DELETE, { method: "DELETE", id: com.body.comment.id })],
        ["log time", () => call(timeLogs.POST, { method: "POST", id: taskA.id, body: { minutes: 10 } })],
        [
          "remove time log",
          () => call(timeLogs.DELETE, { method: "DELETE", id: taskA.id, path: `/?logId=${log.body.log.id}` }),
        ],
        ["attach file", () => call(attachments.POST, { method: "POST", id: taskA.id, body: form })],
        [
          "add blocker",
          () => call(dependencies.POST, { method: "POST", id: taskA.id, body: { dependsOnTaskId: taskB.id } }),
        ],
        [
          "bulk update",
          () =>
            call(bulk.POST, {
              method: "POST",
              id: projectId,
              body: { taskIds: [taskA.id, taskB.id], action: "priority", priority: "low" },
            }),
        ],
      ];
      for (const [label, attempt] of attempts) {
        actAs(label === "comment" || label === "edit comment" ? sam : lead);
        const res = await attempt();
        expect({ label, status: res.status }).toEqual({ label, status: 409 });
      }

      // Still readable.
      actAs(sam);
      expect((await call(task.GET, { id: taskA.id })).status).toBe(200);
    });

    it("downloads a task as a PDF (any member, any characters)", async () => {
      actAs(sam);
      const res = await call(pdf.GET, { id: taskA.id });
      expect(res.status).toBe(200);
      expect(res.res.headers.get("content-type")).toBe("application/pdf");
      expect(res.res.headers.get("content-disposition")).toMatch(
        new RegExp(`attachment; filename="task-${taskA.id}-invoice-totals-round-down\\.pdf"`)
      );
      const bytes = Buffer.from(await res.res.arrayBuffer());
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

      actAs(lead);
      await call(task.PATCH, {
        method: "PATCH",
        id: taskB.id,
        body: { title: "Export ₹ totals → CSV ✓ 导出" },
      });
      actAs(sam);
      expect((await call(pdf.GET, { id: taskB.id })).status).toBe(200);

      actAs(outsider);
      expect((await call(pdf.GET, { id: taskA.id })).status).toBe(403);
    });

    it("a project completes only when every task is signed off, then locks", async () => {
      actAs(lead);
      const early = await call<Json>(project.PATCH, {
        method: "PATCH",
        id: projectId,
        body: { status: "completed" },
      });
      expect(early.status).toBe(409);
      expect(early.body.error).toMatch(/1 task is not signed off yet/);

      await call(task.PATCH, { method: "PATCH", id: taskB.id, body: { status: "done" } });
      const signed = await call(signoff.POST, { method: "POST", id: taskB.id, body: {} });
      expect(signed.status).toBe(200); // a lead may sign off too

      const completed = await call(project.PATCH, {
        method: "PATCH",
        id: projectId,
        body: { status: "completed" },
      });
      expect(completed.status).toBe(200);

      const detail = await call<{ readOnlyReason: string }>(project.GET, { id: projectId });
      expect(detail.body.readOnlyReason).toMatch(/completed and read-only/);

      const blocked: [string, () => ReturnType<typeof call>][] = [
        ["new task", () => call(projectTasks.POST, { method: "POST", id: projectId, body: { ...correction, assigneeId: sam.id } })],
        ["label", () => call(labels.POST, { method: "POST", id: projectId, body: { name: "late" } })],
        ["member", () => call(members.POST, { method: "POST", id: projectId, body: { userId: outsider.id } })],
        ["milestone", () => call(milestones.POST, { method: "POST", id: projectId, body: { name: "v2" } })],
        ["rename", () => call(project.PATCH, { method: "PATCH", id: projectId, body: { name: "v2" } })],
      ];
      for (const [label, attempt] of blocked) {
        const res = await attempt();
        expect({ label, status: res.status }).toEqual({ label, status: 409 });
      }
      actAs(sam);
      const raise = await call(projectRequests.POST, { method: "POST", id: projectId, body: feature });
      expect(raise.status).toBe(409);

      actAs(lead);
      const leadReopen = await call(project.PATCH, {
        method: "PATCH",
        id: projectId,
        body: { status: "active" },
      });
      expect(leadReopen.status).toBe(403);

      actAs(admin);
      const reopened = await call(project.PATCH, {
        method: "PATCH",
        id: projectId,
        body: { status: "active" },
      });
      expect(reopened.status).toBe(200);
      actAs(lead);
      expect((await call(labels.POST, { method: "POST", id: projectId, body: { name: "v2" } })).status).toBe(201);

      // Signed-off tasks stay locked after the project is reopened.
      expect((await call(task.PATCH, { method: "PATCH", id: taskA.id, body: { priority: "low" } })).status).toBe(409);
    });
  });
});

describe("the requester states urgency and effort", () => {
  /**
   * Priority, estimated hours and a needed-by date used to be invented by
   * whoever approved the request. The person asking is closer to the work.
   */
  let pid: number;

  beforeAll(async () => {
    pid = await createLedProject(lead, "Requester-led figures");
    await query(`INSERT INTO project_members (project_id, user_id) VALUES (?, ?)`, [pid, sam.id]);
  });

  it("keeps what the requester asked for, and carries it onto the task", async () => {
    actAs(sam);
    const raised = await call<{ request: TaskRequest }>(projectRequests.POST, {
      method: "POST",
      id: pid,
      body: { ...feature, priority: "urgent", estimatedHours: 6.5, dueDate: "2026-12-24" },
    });
    expect(raised.status).toBe(201);
    expect(raised.body.request).toMatchObject({ priority: "urgent" });
    expect(Number(raised.body.request.estimated_hours)).toBe(6.5);
    expect(String(raised.body.request.due_date)).toContain("2026-12-24");

    // The approver supplies only the owner — the rest comes from the request.
    actAs(lead);
    const decided = await call<{ task: Task }>(requestDecision.POST, {
      method: "POST",
      id: raised.body.request.id,
      body: { decision: "approve", assigneeId: sam.id },
    });
    expect(decided.status).toBe(200);
    expect(decided.body.task).toMatchObject({ priority: "urgent" });
    expect(Number(decided.body.task.estimated_hours)).toBe(6.5);
    expect(String(decided.body.task.due_date)).toContain("2026-12-24");
  });

  it("cannot be quietly rewritten at the moment of approval", async () => {
    actAs(sam);
    const raised = await call<{ request: TaskRequest }>(projectRequests.POST, {
      method: "POST",
      id: pid,
      body: { ...feature, title: "Not overridable", priority: "urgent", estimatedHours: 6.5 },
    });

    // The approver sends their own figures anyway — straight at the API,
    // past the form, which no longer offers the fields at all.
    actAs(lead);
    const decided = await call<{ task: Task }>(requestDecision.POST, {
      method: "POST",
      id: raised.body.request.id,
      body: { decision: "approve", assigneeId: sam.id, priority: "low", estimatedHours: 1 },
    });
    expect(decided.status).toBe(200);
    expect(decided.body.task).toMatchObject({ priority: "urgent" });
    expect(Number(decided.body.task.estimated_hours)).toBe(6.5);
  });

  it("defaults sensibly when the requester says nothing", async () => {
    actAs(sam);
    const raised = await call<{ request: TaskRequest }>(projectRequests.POST, {
      method: "POST",
      id: pid,
      body: { ...feature, title: "No figures given" },
    });
    expect(raised.body.request.priority).toBe("medium");
    expect(raised.body.request.estimated_hours).toBeNull();
    expect(raised.body.request.due_date).toBeNull();
  });
});

describe("a request carries a date range", () => {
  let rangePid: number;

  beforeAll(async () => {
    rangePid = await createLedProject(lead, "Date range project");
    await query(`INSERT INTO project_members (project_id, user_id) VALUES (?, ?)`, [rangePid, sam.id]);
  });

  it("keeps both ends and puts them on the task", async () => {
    actAs(sam);
    const raised = await call<{ request: TaskRequest }>(projectRequests.POST, {
      method: "POST",
      id: rangePid,
      body: { ...feature, startDate: "2026-11-02", dueDate: "2026-11-20" },
    });
    expect(raised.status).toBe(201);
    expect(String(raised.body.request.start_date)).toContain("2026-11-02");
    expect(String(raised.body.request.due_date)).toContain("2026-11-20");

    actAs(lead);
    const decided = await call<{ task: Task }>(requestDecision.POST, {
      method: "POST",
      id: raised.body.request.id,
      body: { decision: "approve", assigneeId: sam.id },
    });
    expect(String(decided.body.task.start_date)).toContain("2026-11-02");
    expect(String(decided.body.task.due_date)).toContain("2026-11-20");
  });

  it("refuses a range that runs backwards", async () => {
    actAs(sam);
    const bad = await call<Json>(projectRequests.POST, {
      method: "POST",
      id: rangePid,
      body: { ...feature, title: "Backwards", startDate: "2026-11-20", dueDate: "2026-11-02" },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/end date can't be before the start date/i);
  });

  it("accepts one end on its own, and neither", async () => {
    actAs(sam);
    const onlyEnd = await call<{ request: TaskRequest }>(projectRequests.POST, {
      method: "POST",
      id: rangePid,
      body: { ...feature, title: "Only a deadline", dueDate: "2026-11-30" },
    });
    expect(onlyEnd.status).toBe(201);
    expect(onlyEnd.body.request.start_date).toBeNull();

    const neither = await call<{ request: TaskRequest }>(projectRequests.POST, {
      method: "POST",
      id: rangePid,
      body: { ...feature, title: "No dates at all" },
    });
    expect(neither.status).toBe(201);
    expect(neither.body.request.due_date).toBeNull();
  });
});

describe("an approved request arrives with its checklist", () => {
  it("builds the checklist from what the requester wrote", async () => {
    const pid = await createLedProject(lead, "Checklist from spec");
    await query(`INSERT INTO project_members (project_id, user_id) VALUES (?, ?)`, [pid, sam.id]);

    actAs(sam);
    const raised = await call<{ request: TaskRequest }>(projectRequests.POST, {
      method: "POST",
      id: pid,
      body: {
        ...feature,
        title: "Dealer export",
        features: "- Export as CSV\n- Email the file",
        rules: "Only leads can export",
      },
    });

    actAs(lead);
    const decided = await call<{ task: Task }>(requestDecision.POST, {
      method: "POST",
      id: raised.body.request.id,
      body: { decision: "approve", assigneeId: sam.id },
    });
    expect(decided.status).toBe(200);

    const items = await query<DbRow[]>(
      `SELECT title, is_done FROM subtasks WHERE task_id = ? ORDER BY position`,
      [decided.body.task.id]
    );
    expect(items.map((i) => i.title)).toEqual([
      "Export as CSV",
      "Email the file",
      "Only leads can export",
    ]);
    // Nothing is ticked: it is a list of work, not a record of it.
    expect(items.every((i) => Number(i.is_done) === 0)).toBe(true);
  });
});

describe("a task created before checklists can catch up with its spec", () => {
  let pid: number;
  let taskId: number;

  beforeAll(async () => {
    pid = await createLedProject(lead, "Catch up with the spec");
    await query(`INSERT INTO project_members (project_id, user_id) VALUES (?, ?)`, [pid, sam.id]);
    actAs(lead);
    const made = await call<{ task: Task }>(projectTasks.POST, {
      method: "POST",
      id: pid,
      body: {
        ...correction,
        title: "Old task",
        expectedBehavior: "Totals round half-up",
        acceptanceCriteria: "- 12.345 shows as 12.35\n- 12.344 shows as 12.34",
        assigneeId: sam.id,
      },
    });
    taskId = made.body.task.id;
    // How a task looked before its checklist came from its spec.
    await query(`DELETE FROM subtasks WHERE task_id = ?`, [taskId]);
  });

  it("adds what the specification asks for", async () => {
    actAs(sam);
    const res = await call<{ added: number; subtasks: { title: string }[] }>(
      fromSpec.POST,
      { method: "POST", id: taskId }
    );
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(3);
    expect(res.body.subtasks.map((s) => s.title)).toEqual([
      "Totals round half-up",
      "12.345 shows as 12.35",
      "12.344 shows as 12.34",
    ]);
  });

  it("adds nothing the second time, and keeps what was ticked", async () => {
    await query(`UPDATE subtasks SET is_done = 1 WHERE task_id = ? AND title = ?`, [
      taskId,
      "Totals round half-up",
    ]);
    actAs(sam);
    const again = await call<{ added: number; subtasks: { title: string; is_done: boolean }[] }>(
      fromSpec.POST,
      { method: "POST", id: taskId }
    );
    expect(again.status).toBe(200);
    expect(again.body.added).toBe(0);
    expect(again.body.subtasks).toHaveLength(3);
    expect(again.body.subtasks.find((s) => s.title === "Totals round half-up")?.is_done).toBe(true);
  });

  it("picks up a criterion added to the spec afterwards", async () => {
    actAs(lead);
    await call(task.PATCH, {
      method: "PATCH",
      id: taskId,
      body: {
        taskType: "correction",
        existingBehavior: "Totals are truncated to 2 decimals",
        expectedBehavior: "Totals round half-up",
        acceptanceCriteria: "- 12.345 shows as 12.35\n- 12.344 shows as 12.34\n- 0.005 shows as 0.01",
      },
    });
    const res = await call<{ added: number; subtasks: { title: string }[] }>(fromSpec.POST, {
      method: "POST",
      id: taskId,
    });
    expect(res.body.added).toBe(1);
    expect(res.body.subtasks.map((s) => s.title)).toContain("0.005 shows as 0.01");
  });

  it("is not open to someone outside the project", async () => {
    actAs(outsider);
    const res = await call(fromSpec.POST, { method: "POST", id: taskId });
    expect(res.status).toBe(403);
  });
});
