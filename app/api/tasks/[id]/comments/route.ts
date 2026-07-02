import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";
import { createCommentSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

async function loadTaskProject(taskId: number): Promise<DbRow> {
  const rows = await query<DbRow[]>(
    `SELECT id, project_id, title, assignee_id FROM tasks WHERE id = ? LIMIT 1`,
    [taskId]
  );
  const task = rows[0];
  if (!task) throw new ApiError(404, "Task not found");
  return task;
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const task = await loadTaskProject(taskId);
    await assertProjectAccess(user, task.project_id);

    const comments = await query<DbRow[]>(
      `SELECT tc.id, tc.task_id, tc.user_id, tc.body, tc.created_at, u.name AS user_name
       FROM task_comments tc
       JOIN users u ON u.id = tc.user_id
       WHERE tc.task_id = ?
       ORDER BY tc.created_at ASC`,
      [taskId]
    );
    return json({ comments });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const task = await loadTaskProject(taskId);
    await assertProjectAccess(user, task.project_id);

    const body = await req.json().catch(() => ({}));
    const { body: text } = createCommentSchema.parse(body);

    const result = (await query<DbResult>(
      `INSERT INTO task_comments (task_id, user_id, body) VALUES (?, ?, ?)`,
      [taskId, user.id, text]
    )) as unknown as DbResult;

    await logActivity({
      userId: user.id,
      action: "task.commented",
      entityType: "task",
      entityId: taskId,
    });
    if (task.assignee_id && task.assignee_id !== user.id) {
      await notify(
        task.assignee_id,
        "task_comment",
        `${user.name} commented on "${task.title}"`,
        `/projects/${task.project_id}`
      );
    }

    const rows = await query<DbRow[]>(
      `SELECT tc.id, tc.task_id, tc.user_id, tc.body, tc.created_at, u.name AS user_name
       FROM task_comments tc JOIN users u ON u.id = tc.user_id
       WHERE tc.id = ?`,
      [result.insertId]
    );
    return json({ comment: rows[0] }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
