import { beforeAll, describe, expect, it } from "vitest";
import { query, DbResult, DbRow } from "@/lib/db";
import type { User } from "@/lib/types";
import { actAs, call, createLedProject, createUser } from "./helpers";

import * as taskTemplates from "@/app/api/task-templates/route";
import * as taskTemplate from "@/app/api/task-templates/[id]/route";

type Json = Record<string, string>;

/**
 * Task templates: the shape of a job a department does again and again.
 *
 * The interesting rules are who may make one, what a template keeps (the
 * form, never the task's own circumstances) and that a department tidies its
 * own shelf rather than everybody's.
 */
describe("task templates", () => {
  let admin: User;
  let lead: User;
  let member: User;
  let taskId: number;

  beforeAll(async () => {
    admin = await createUser("TplAdmin", "admin");
    lead = await createUser("TplLead");
    member = await createUser("TplMember");
    await query(`UPDATE users SET department = 'Production' WHERE id = ?`, [lead.id]);
    await query(`UPDATE users SET department = 'Design' WHERE id = ?`, [admin.id]);
    lead.department = "Production";
    admin.department = "Design";

    const projectId = await createLedProject(lead, "Template source");
    const res = (await query<DbResult>(
      `INSERT INTO tasks
         (project_id, title, task_type, existing_behavior, expected_behavior,
          acceptance_criteria, priority, estimated_hours, assignee_id, status)
       VALUES (?, 'Inspect batch 42 bearings', 'correction', 'Runs hot.',
               'Runs within tolerance.', 'Bench test passes.', 'high', 4, ?, 'todo')`,
      [projectId, lead.id]
    )) as unknown as DbResult;
    taskId = res.insertId;
  });

  it("a plain member cannot save one", async () => {
    actAs(member);
    const res = await call<Json>(taskTemplates.POST, {
      method: "POST",
      body: { name: "Batch inspection", taskId },
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admins and project leads/i);
  });

  it("a project lead saves one for their own department", async () => {
    actAs(lead);
    const res = await call<{ template: { id: number; department: string | null } }>(
      taskTemplates.POST,
      { method: "POST", body: { name: "Batch inspection", taskId } }
    );
    expect(res.status).toBe(201);
    // Stamped with the author's department without anyone choosing it.
    expect(res.body.template.department).toBe("Production");

    const [row] = await query<DbRow[]>(
      `SELECT data FROM task_templates WHERE id = ?`,
      [res.body.template.id]
    );
    const data =
      typeof row.data === "string"
        ? (JSON.parse(row.data) as Record<string, unknown>)
        : (row.data as Record<string, unknown>);

    // The name is the title the next task starts with — "batch 42" described
    // one occasion and would be wrong for the next one.
    expect(data.title).toBe("Batch inspection");
    expect(data.taskType).toBe("correction");
    expect(data.existingBehavior).toBe("Runs hot.");
    expect(data.acceptanceCriteria).toBe("Bench test passes.");
    expect(data.priority).toBe("high");
    expect(Number(data.estimatedHours)).toBe(4);
    // Nothing that belonged to that one piece of work.
    expect(data).not.toHaveProperty("assigneeId");
    expect(data).not.toHaveProperty("dueDate");
    expect(data).not.toHaveProperty("status");
  });

  it("everyone can see every department's templates", async () => {
    actAs(member);
    const res = await call<{ templates: { name: string; department: string }[] }>(
      taskTemplates.GET,
      { method: "GET" }
    );
    expect(res.status).toBe(200);
    expect(res.body.templates.map((t) => t.name)).toContain("Batch inspection");
  });

  it("a lead cannot delete another department's template", async () => {
    actAs(admin);
    const mine = await call<{ template: { id: number } }>(taskTemplates.POST, {
      method: "POST",
      body: { name: "Design review", taskId },
    });
    expect(mine.status).toBe(201);

    // Lead is Production; that one is Design's.
    actAs(lead);
    const refused = await call<Json>(taskTemplate.DELETE, {
      method: "DELETE",
      id: mine.body.template.id,
    });
    expect(refused.status).toBe(403);

    // An admin may.
    actAs(admin);
    const gone = await call<Json>(taskTemplate.DELETE, {
      method: "DELETE",
      id: mine.body.template.id,
    });
    expect(gone.status).toBe(200);
  });
});
