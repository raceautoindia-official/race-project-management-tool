import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess, canManageProject } from "@/lib/rbac";
import { forbidden } from "@/lib/http";
import { createTaskSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";
import { attachTaskMeta, syncTaskLabels } from "@/lib/tasks";

type Params = { params: Promise<{ id: string }> };

const TASK_SELECT = `
  t.id, t.project_id, t.title, t.description, t.status, t.priority,
  t.estimated_hours, t.spent_hours, t.is_additional, t.parent_task_id,
  t.assignee_id, t.created_by, t.due_date, t.start_date, t.created_at, t.updated_at,
  a.name AS assignee_name, c.name AS creator_name,
  (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count
`;

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");

    await assertProjectAccess(user, projectId);

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? "";
    const priority = searchParams.get("priority") ?? "";
    const assignee = searchParams.get("assignee") ?? "";

    const where = ["t.project_id = ?"];
    const queryParams: unknown[] = [projectId];
    if (["todo", "in_progress", "review", "done"].includes(status)) {
      where.push("t.status = ?");
      queryParams.push(status);
    }
    if (["low", "medium", "high", "urgent"].includes(priority)) {
      where.push("t.priority = ?");
      queryParams.push(priority);
    }
    if (assignee && Number.isInteger(Number(assignee))) {
      where.push("t.assignee_id = ?");
      queryParams.push(Number(assignee));
    }

    const tasks = await query<DbRow[]>(
      `SELECT ${TASK_SELECT}
       FROM tasks t
       LEFT JOIN users a ON a.id = t.assignee_id
       LEFT JOIN users c ON c.id = t.created_by
       WHERE ${where.join(" AND ")}
       ORDER BY t.created_at DESC`,
      queryParams
    );

    await attachTaskMeta(tasks);
    return json({
      tasks: tasks.map((t) => ({ ...t, comment_count: Number(t.comment_count) })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");

    const { projectRole } = await assertProjectAccess(user, projectId);
    if (!canManageProject(user, projectRole)) {
      throw forbidden("Only an admin or project lead can create tasks");
    }
    const body = await req.json().catch(() => ({}));
    const data = createTaskSchema.parse(body);

    if (data.assigneeId) {
      const m = await query<DbRow[]>(
        `SELECT id FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1`,
        [projectId, data.assigneeId]
      );
      if (!m.length) {
        throw new ApiError(400, "Assignee must be a member of the project");
      }
    }

    // #7 — follow-up work: a parent must belong to the same project. Any task
    // linked to a parent (or explicitly flagged) is marked additional.
    if (data.parentTaskId) {
      const p = await query<DbRow[]>(
        `SELECT id FROM tasks WHERE id = ? AND project_id = ? LIMIT 1`,
        [data.parentTaskId, projectId]
      );
      if (!p.length) {
        throw new ApiError(400, "Parent task must be in the same project");
      }
    }
    const isAdditional = data.parentTaskId != null || data.isAdditional === true;

    const result = (await query<DbResult>(
      `INSERT INTO tasks
         (project_id, title, description, status, priority, estimated_hours,
          assignee_id, created_by, due_date, start_date, is_additional, parent_task_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        data.title,
        data.description ?? null,
        data.status ?? "todo",
        data.priority ?? "medium",
        data.estimatedHours ?? null,
        data.assigneeId ?? null,
        user.id,
        data.dueDate ?? null,
        data.startDate ?? null,
        isAdditional ? 1 : 0,
        data.parentTaskId ?? null,
      ]
    )) as unknown as DbResult;

    if (data.labelIds && data.labelIds.length > 0) {
      await syncTaskLabels(result.insertId, projectId, data.labelIds);
    }

    await logActivity({
      userId: user.id,
      action: "task.created",
      entityType: "task",
      entityId: result.insertId,
      metadata: { projectId, title: data.title },
    });
    if (data.assigneeId && data.assigneeId !== user.id) {
      await notify(
        data.assigneeId,
        "task_assigned",
        `You were assigned: "${data.title}"`,
        `/projects/${projectId}`
      );
    }

    const rows = await query<DbRow[]>(
      `SELECT ${TASK_SELECT}
       FROM tasks t
       LEFT JOIN users a ON a.id = t.assignee_id
       LEFT JOIN users c ON c.id = t.created_by
       WHERE t.id = ?`,
      [result.insertId]
    );
    await attachTaskMeta(rows);
    return json({ task: rows[0] }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
