import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import { assertProjectAccess, assertTaskEdit, canManageProject } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

async function loadTaskRef(taskId: number): Promise<DbRow> {
  const rows = await query<DbRow[]>(
    `SELECT id, project_id, assignee_id, status, title FROM tasks WHERE id = ? LIMIT 1`,
    [taskId]
  );
  if (!rows.length) throw new ApiError(404, "Task not found");
  return rows[0];
}

async function recomputeSpent(taskId: number): Promise<void> {
  await query(
    `UPDATE tasks
       SET spent_hours = (
         SELECT COALESCE(SUM(minutes), 0) / 60 FROM task_time_logs WHERE task_id = ?
       )
     WHERE id = ?`,
    [taskId, taskId]
  );
}

/** GET — the task's time-log entries + total minutes. */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const task = await loadTaskRef(taskId);
    await assertProjectAccess(user, task.project_id);

    const logs = await query<DbRow[]>(
      `SELECT l.id, l.minutes, l.note, l.logged_at, l.user_id, u.name AS user_name
         FROM task_time_logs l LEFT JOIN users u ON u.id = l.user_id
        WHERE l.task_id = ?
        ORDER BY l.logged_at DESC, l.id DESC`,
      [taskId]
    );
    const [{ total }] = await query<DbRow[]>(
      `SELECT COALESCE(SUM(minutes),0) AS total FROM task_time_logs WHERE task_id = ?`,
      [taskId]
    );
    return json({ logs, totalMinutes: Number(total) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST { minutes, note? } — add a time entry (assignee or manager). */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const task = await loadTaskRef(taskId);
    await assertTaskEdit(user, {
      project_id: task.project_id,
      assignee_id: task.assignee_id,
    });

    const body = await req.json().catch(() => ({}));
    const minutes = Math.round(Number(body.minutes));
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 100000) {
      throw new ApiError(400, "Enter a positive amount of time");
    }
    const note =
      typeof body.note === "string" ? body.note.slice(0, 255) : null;

    const result = (await query<DbResult>(
      `INSERT INTO task_time_logs (task_id, user_id, minutes, note)
       VALUES (?, ?, ?, ?)`,
      [taskId, user.id, minutes, note]
    )) as unknown as DbResult;

    await recomputeSpent(taskId);

    // Auto-advance a not-started task to In Progress when work is first logged.
    let newStatus = task.status as string;
    if (task.status === "todo") {
      await query(`UPDATE tasks SET status = 'in_progress' WHERE id = ?`, [taskId]);
      newStatus = "in_progress";
    }

    await logActivity({
      userId: user.id,
      action: "task.time_logged",
      entityType: "task",
      entityId: taskId,
      metadata: { minutes, title: task.title },
    });

    const [row] = await query<DbRow[]>(
      `SELECT l.id, l.minutes, l.note, l.logged_at, l.user_id, u.name AS user_name
         FROM task_time_logs l LEFT JOIN users u ON u.id = l.user_id
        WHERE l.id = ?`,
      [result.insertId]
    );
    const [{ total }] = await query<DbRow[]>(
      `SELECT COALESCE(SUM(minutes),0) AS total FROM task_time_logs WHERE task_id = ?`,
      [taskId]
    );
    return json({ log: row, totalMinutes: Number(total), status: newStatus }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE ?logId= — remove an entry (admin/lead, or the entry's author). */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const task = await loadTaskRef(taskId);
    const { projectRole } = await assertProjectAccess(user, task.project_id);

    const logId = Number(new URL(req.url).searchParams.get("logId"));
    if (!Number.isInteger(logId)) throw new ApiError(400, "Invalid logId");

    const [entry] = await query<DbRow[]>(
      `SELECT user_id FROM task_time_logs WHERE id = ? AND task_id = ? LIMIT 1`,
      [logId, taskId]
    );
    if (!entry) throw new ApiError(404, "Entry not found");
    if (!canManageProject(user, projectRole) && entry.user_id !== user.id) {
      throw forbidden("You can only remove your own time entries");
    }

    await query(`DELETE FROM task_time_logs WHERE id = ?`, [logId]);
    await recomputeSpent(taskId);
    const [{ total }] = await query<DbRow[]>(
      `SELECT COALESCE(SUM(minutes),0) AS total FROM task_time_logs WHERE task_id = ?`,
      [taskId]
    );
    return json({ ok: true, totalMinutes: Number(total) });
  } catch (err) {
    return errorResponse(err);
  }
}
