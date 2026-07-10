import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess, assertProjectManage } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

async function loadTaskRef(taskId: number): Promise<DbRow> {
  const rows = await query<DbRow[]>(
    `SELECT id, project_id, title FROM tasks WHERE id = ? LIMIT 1`,
    [taskId]
  );
  if (!rows.length) throw new ApiError(404, "Task not found");
  return rows[0];
}

/** GET — the tasks this task is blocked by, and whether it is currently blocked. */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const task = await loadTaskRef(taskId);
    await assertProjectAccess(user, task.project_id);

    const deps = await query<DbRow[]>(
      `SELECT d.depends_on_task_id AS id, t.title, t.status
         FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_task_id
        WHERE d.task_id = ?
        ORDER BY t.title`,
      [taskId]
    );
    const dependencies = deps.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      done: d.status === "done",
    }));
    return json({
      dependencies,
      blocked: dependencies.some((d) => !d.done),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST { dependsOnTaskId } — add a blocker (admin/lead only). */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const task = await loadTaskRef(taskId);
    await assertProjectManage(user, task.project_id);

    const body = await req.json().catch(() => ({}));
    const dependsOn = Number(body.dependsOnTaskId);
    if (!Number.isInteger(dependsOn)) throw new ApiError(400, "Invalid dependsOnTaskId");
    if (dependsOn === taskId) throw new ApiError(400, "A task cannot depend on itself");

    const other = await query<DbRow[]>(
      `SELECT id FROM tasks WHERE id = ? AND project_id = ? LIMIT 1`,
      [dependsOn, task.project_id]
    );
    if (!other.length) throw new ApiError(400, "The blocker must be a task in the same project");

    // Prevent an obvious cycle (the other task already depends on this one).
    const cycle = await query<DbRow[]>(
      `SELECT 1 FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ? LIMIT 1`,
      [dependsOn, taskId]
    );
    if (cycle.length) throw new ApiError(400, "That would create a circular dependency");

    await query(
      `INSERT IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)`,
      [taskId, dependsOn]
    );
    await logActivity({
      userId: user.id,
      action: "task.dependency_added",
      entityType: "task",
      entityId: taskId,
      metadata: { dependsOn },
    });
    return json({ ok: true }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE ?dependsOnTaskId= — remove a blocker (admin/lead only). */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const task = await loadTaskRef(taskId);
    await assertProjectManage(user, task.project_id);

    const dependsOn = Number(new URL(req.url).searchParams.get("dependsOnTaskId"));
    if (!Number.isInteger(dependsOn)) throw new ApiError(400, "Invalid dependsOnTaskId");

    await query(
      `DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?`,
      [taskId, dependsOn]
    );
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
