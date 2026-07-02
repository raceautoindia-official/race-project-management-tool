import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";
import { updateTaskSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";
import { attachTaskMeta, syncTaskLabels } from "@/lib/tasks";

type Params = { params: Promise<{ id: string }> };

const TASK_SELECT = `
  t.id, t.project_id, t.title, t.description, t.status, t.priority,
  t.assignee_id, t.created_by, t.due_date, t.created_at, t.updated_at,
  a.name AS assignee_name, c.name AS creator_name, p.name AS project_name,
  (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count
`;

async function loadTask(taskId: number): Promise<DbRow> {
  const rows = await query<DbRow[]>(
    `SELECT ${TASK_SELECT}
     FROM tasks t
     LEFT JOIN users a ON a.id = t.assignee_id
     LEFT JOIN users c ON c.id = t.created_by
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.id = ? LIMIT 1`,
    [taskId]
  );
  if (!rows.length) throw new ApiError(404, "Task not found");
  await attachTaskMeta(rows);
  return rows[0];
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const task = await loadTask(taskId);
    await assertProjectAccess(user, task.project_id);
    return json({ task: { ...task, comment_count: Number(task.comment_count) } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const task = await loadTask(taskId);
    await assertProjectAccess(user, task.project_id);
    const body = await req.json().catch(() => ({}));
    const data = updateTaskSchema.parse(body);

    if (data.assigneeId) {
      const m = await query<DbRow[]>(
        `SELECT id FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1`,
        [task.project_id, data.assigneeId]
      );
      if (!m.length) {
        throw new ApiError(400, "Assignee must be a member of the project");
      }
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    if (data.title !== undefined) {
      sets.push("title = ?");
      values.push(data.title);
    }
    if (data.description !== undefined) {
      sets.push("description = ?");
      values.push(data.description ?? null);
    }
    if (data.status !== undefined) {
      sets.push("status = ?");
      values.push(data.status);
    }
    if (data.priority !== undefined) {
      sets.push("priority = ?");
      values.push(data.priority);
    }
    if (data.assigneeId !== undefined) {
      sets.push("assignee_id = ?");
      values.push(data.assigneeId);
    }
    if (data.dueDate !== undefined) {
      sets.push("due_date = ?");
      values.push(data.dueDate);
    }
    if (sets.length > 0) {
      values.push(taskId);
      await query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, values);
    }
    if (data.labelIds !== undefined) {
      await syncTaskLabels(taskId, task.project_id, data.labelIds);
    }

    const statusChanged =
      data.status !== undefined && data.status !== task.status;
    await logActivity({
      userId: user.id,
      action: statusChanged ? "task.status_changed" : "task.updated",
      entityType: "task",
      entityId: taskId,
      metadata: statusChanged
        ? { from: task.status, to: data.status, title: task.title }
        : { title: task.title },
    });

    if (
      data.assigneeId !== undefined &&
      data.assigneeId !== null &&
      data.assigneeId !== task.assignee_id &&
      data.assigneeId !== user.id
    ) {
      await notify(
        data.assigneeId,
        "task_assigned",
        `You were assigned: "${task.title}"`,
        `/projects/${task.project_id}`
      );
    }

    const updated = await loadTask(taskId);
    return json({ task: { ...updated, comment_count: Number(updated.comment_count) } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const task = await loadTask(taskId);
    const { projectRole } = await assertProjectAccess(user, task.project_id);

    const canDelete =
      user.role === "admin" ||
      projectRole === "lead" ||
      task.created_by === user.id;
    if (!canDelete) {
      throw forbidden("Only an admin, project lead, or the task creator can delete this task");
    }

    await query(`DELETE FROM tasks WHERE id = ?`, [taskId]);
    await logActivity({
      userId: user.id,
      action: "task.deleted",
      entityType: "task",
      entityId: taskId,
      metadata: { title: task.title, projectId: task.project_id },
    });

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
